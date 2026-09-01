/**
 * Connector routing.
 *
 * A route is produced in two forms: an SVG path string for rendering and a
 * polyline for hit testing and label placement. Curved routes are sampled so
 * that both forms describe the same line.
 */

import type { Point, Rect } from '../model/geometry';
import { distance, rectIntersects, round } from '../model/geometry';
import type {
  ConnectorElement,
  ConnectorKind,
  DiagramElement,
  ShapeElement,
} from '../model/types';
import { isShape } from '../model/types';
import { resolveAnchor, type ResolvedAnchor } from './anchors';

/** Distance the line travels straight out of a shape before it may turn. */
export const STUB_LENGTH = 18;

/** Bézier handle length, as a fraction of the segment the handle belongs to. */
const HANDLE_FRACTION = 0.4;

export interface RoutedPath {
  /** Polyline approximation, always at least two points. */
  points: Point[];
  /** SVG path data. */
  d: string;
  /** Unit vector pointing out of the source. */
  startDirection: Point;
  /** Unit vector pointing into the target. */
  endDirection: Point;
}

function samePoint(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
}

/** Drop duplicate and collinear points so paths stay short and clean. */
export function simplify(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (out.length === 0 || !samePoint(out[out.length - 1], p)) out.push({ ...p });
  }
  if (out.length < 3) return out;
  const result: Point[] = [out[0]];
  for (let i = 1; i < out.length - 1; i++) {
    const a = result[result.length - 1];
    const b = out[i];
    const c = out[i + 1];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(cross) > 0.01) result.push(b);
  }
  result.push(out[out.length - 1]);
  return result;
}

function offsetPoint(p: Point, direction: Point, length: number): Point {
  return { x: p.x + direction.x * length, y: p.y + direction.y * length };
}

/**
 * Choose the coordinate of the shared middle line for an orthogonal route.
 * When both stubs face the same way the line goes past the far one, which
 * avoids the doubling back that a plain midpoint produces.
 */
function middleCoordinate(a: number, b: number, dirA: number, dirB: number): number {
  if (dirA > 0 && dirB > 0) return Math.max(a, b) + STUB_LENGTH;
  if (dirA < 0 && dirB < 0) return Math.min(a, b) - STUB_LENGTH;
  return (a + b) / 2;
}

/**
 * Move a vertical (or horizontal) middle line sideways until it clears every
 * obstacle. Returns the original value when no clear alternative is found.
 */
function avoidObstacles(
  value: number,
  from: number,
  to: number,
  axis: 'x' | 'y',
  obstacles: readonly Rect[],
): number {
  if (obstacles.length === 0) return value;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const blocked = (candidate: number): boolean =>
    obstacles.some((r) => {
      const span: Rect =
        axis === 'x'
          ? { x: candidate - 1, y: lo, width: 2, height: hi - lo }
          : { x: lo, y: candidate - 1, width: hi - lo, height: 2 };
      return rectIntersects(span, r);
    });
  if (!blocked(value)) return value;
  const candidates: number[] = [];
  for (const r of obstacles) {
    const min = axis === 'x' ? r.x : r.y;
    const size = axis === 'x' ? r.width : r.height;
    candidates.push(min - STUB_LENGTH, min + size + STUB_LENGTH);
  }
  candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value));
  for (const candidate of candidates) if (!blocked(candidate)) return candidate;
  return value;
}

/** True when a direction runs more across the canvas than up and down. */
function isHorizontal(direction: Point): boolean {
  return Math.abs(direction.x) > Math.abs(direction.y);
}

/** Does the axis-aligned segment `a`-`b` touch any obstacle? */
function segmentBlocked(a: Point, b: Point, obstacles: readonly Rect[]): boolean {
  if (obstacles.length === 0) return false;
  const span: Rect = {
    x: Math.min(a.x, b.x) - 0.5,
    y: Math.min(a.y, b.y) - 0.5,
    width: Math.abs(a.x - b.x) + 1,
    height: Math.abs(a.y - b.y) + 1,
  };
  return obstacles.some((r) => rectIntersects(span, r));
}

/** Does any leg of a polyline touch an obstacle? */
function polylineBlocked(points: readonly Point[], obstacles: readonly Rect[]): boolean {
  if (obstacles.length === 0) return false;
  for (let i = 0; i < points.length - 1; i++) {
    if (segmentBlocked(points[i], points[i + 1], obstacles)) return true;
  }
  return false;
}

/**
 * Step the middle of the route sideways, across the stubs rather than along
 * them. This is what rescues the case `avoidObstacles` cannot help with: two
 * stubs on the same line with something sitting between them, where there is
 * no middle line to move. Returns null when nothing clears.
 */
function detourMiddle(
  s: Point,
  e: Point,
  axis: 'x' | 'y',
  obstacles: readonly Rect[],
): Point[] | null {
  if (obstacles.length === 0) return null;
  const base = axis === 'y' ? s.y : s.x;
  const candidates: number[] = [];
  for (const r of obstacles) {
    if (axis === 'y') candidates.push(r.y - STUB_LENGTH, r.y + r.height + STUB_LENGTH);
    else candidates.push(r.x - STUB_LENGTH, r.x + r.width + STUB_LENGTH);
  }
  candidates.sort((a, b) => Math.abs(a - base) - Math.abs(b - base));
  for (const value of candidates) {
    const middle =
      axis === 'y'
        ? [
            { x: s.x, y: value },
            { x: e.x, y: value },
          ]
        : [
            { x: value, y: s.y },
            { x: value, y: e.y },
          ];
    if (!polylineBlocked([s, ...middle, e], obstacles)) return middle;
  }
  return null;
}

/**
 * Orthogonal route between two stub ends.
 *
 * `style` picks how the shared middle line is placed: an elbow runs it past
 * the further stub when both face the same way, which is what stops a route
 * doubling back; a step always splits the difference, giving the single
 * right-angled step its name promises.
 */
function orthogonalRoute(
  start: Point,
  startDirection: Point,
  end: Point,
  endDirection: Point,
  obstacles: readonly Rect[],
  style: 'elbow' | 'step' = 'elbow',
): Point[] {
  const s = offsetPoint(start, startDirection, STUB_LENGTH);
  const e = offsetPoint(end, endDirection, STUB_LENGTH);
  const startHorizontal = isHorizontal(startDirection);
  const endHorizontal = isHorizontal(endDirection);

  let middle: Point[];
  if (startHorizontal && endHorizontal) {
    let mx =
      style === 'step'
        ? (s.x + e.x) / 2
        : middleCoordinate(s.x, e.x, startDirection.x, endDirection.x);
    mx = avoidObstacles(mx, s.y, e.y, 'x', obstacles);
    middle = [
      { x: mx, y: s.y },
      { x: mx, y: e.y },
    ];
    if (polylineBlocked([s, ...middle, e], obstacles)) {
      middle = detourMiddle(s, e, 'y', obstacles) ?? middle;
    }
  } else if (!startHorizontal && !endHorizontal) {
    let my =
      style === 'step'
        ? (s.y + e.y) / 2
        : middleCoordinate(s.y, e.y, startDirection.y, endDirection.y);
    my = avoidObstacles(my, s.x, e.x, 'y', obstacles);
    middle = [
      { x: s.x, y: my },
      { x: e.x, y: my },
    ];
    if (polylineBlocked([s, ...middle, e], obstacles)) {
      middle = detourMiddle(s, e, 'x', obstacles) ?? middle;
    }
  } else if (startHorizontal) {
    middle = [{ x: e.x, y: s.y }];
  } else {
    middle = [{ x: s.x, y: e.y }];
  }

  return simplify([start, s, ...middle, e, end]);
}

/**
 * Chain orthogonal legs through the bend points the user placed. Each leg
 * arrives at its bend point along the direction the previous one left in, so
 * the corners land on the bend points instead of overshooting them.
 */
function orthogonalChain(
  start: Point,
  startDirection: Point,
  waypoints: readonly Point[],
  end: Point,
  endDirection: Point,
  style: 'elbow' | 'step',
): Point[] {
  const chain: Point[] = [start];
  const knots = [...waypoints, end];
  let previous = start;
  let previousDirection = startDirection;
  for (let i = 0; i < knots.length; i++) {
    const knot = knots[i];
    const last = i === knots.length - 1;
    const arrival = last
      ? endDirection
      : { x: -previousDirection.x, y: -previousDirection.y };
    const leg = orthogonalRoute(previous, previousDirection, knot, arrival, [], style);
    chain.push(...leg.slice(1));
    previous = knot;
    const before = chain[chain.length - 2];
    const next = before ? directionBetween(before, knot) : previousDirection;
    if (next.x !== 0 || next.y !== 0) previousDirection = next;
  }
  return simplify(chain);
}

function pathFromPoints(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const parts = [`M ${round(points[0].x, 2)} ${round(points[0].y, 2)}`];
  for (let i = 1; i < points.length; i++) {
    parts.push(`L ${round(points[i].x, 2)} ${round(points[i].y, 2)}`);
  }
  return parts.join(' ');
}

/** Round the corners of an orthogonal polyline with quadratic joins. */
function roundedPathFromPoints(points: readonly Point[], radius: number): string {
  if (radius <= 0 || points.length < 3) return pathFromPoints(points);
  const parts = [`M ${round(points[0].x, 2)} ${round(points[0].y, 2)}`];
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const inLength = distance(previous, corner);
    const outLength = distance(corner, next);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    if (r < 0.5) {
      parts.push(`L ${round(corner.x, 2)} ${round(corner.y, 2)}`);
      continue;
    }
    const enter = {
      x: corner.x + ((previous.x - corner.x) / inLength) * r,
      y: corner.y + ((previous.y - corner.y) / inLength) * r,
    };
    const exit = {
      x: corner.x + ((next.x - corner.x) / outLength) * r,
      y: corner.y + ((next.y - corner.y) / outLength) * r,
    };
    parts.push(`L ${round(enter.x, 2)} ${round(enter.y, 2)}`);
    parts.push(
      `Q ${round(corner.x, 2)} ${round(corner.y, 2)} ${round(exit.x, 2)} ${round(exit.y, 2)}`,
    );
  }
  const last = points[points.length - 1];
  parts.push(`L ${round(last.x, 2)} ${round(last.y, 2)}`);
  return parts.join(' ');
}

/**
 * Strip the straight stubs from an orthogonal route so it can be smoothed.
 *
 * A spline does not need them: its end handles already carry the line out of
 * the shape along the edge normal. Left in, the stub knot sits a few points
 * from the endpoint with a near-perpendicular tangent, and the curve hooks
 * back on itself getting to it.
 */
function splineSpine(points: readonly Point[]): Point[] {
  if (points.length <= 3) return points.map((p) => ({ ...p }));
  const first = points[0];
  const last = points[points.length - 1];
  const out = points.filter((p, i) => {
    if (i === 0 || i === points.length - 1) return true;
    return (
      distance(p, first) > STUB_LENGTH + 0.01 && distance(p, last) > STUB_LENGTH + 0.01
    );
  });
  return out.length >= 2 ? out.map((p) => ({ ...p })) : points.map((p) => ({ ...p }));
}

/**
 * The Bézier handle at an end of the spline.
 *
 * It points along `direction` — the direction the line leaves (or, at the far
 * end, enters) its shape — so a curve meets a shape square to its edge rather
 * than cutting across the corner. Its length is a fraction of the segment it
 * belongs to, which keeps the bulge proportionate on both short and long runs.
 */
function endHandle(from: Point, direction: Point, toward: Point): Point {
  const length = distance(from, toward) * HANDLE_FRACTION;
  return { x: from.x + direction.x * length, y: from.y + direction.y * length };
}

/**
 * Shorten a handle so it never reaches further than its own segment.
 *
 * Without this the Catmull-Rom tangent at a tight corner — a short stub next
 * to a long run, which is what an orthogonal spine is made of — is longer than
 * the segment it controls, and the curve loops back on itself.
 */
function clampHandle(anchor: Point, handle: Point, limit: number): Point {
  const dx = handle.x - anchor.x;
  const dy = handle.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length <= limit || length === 0) return handle;
  const scale = limit / length;
  return { x: anchor.x + dx * scale, y: anchor.y + dy * scale };
}

/**
 * A Catmull-Rom spline converted to cubic Béziers, sampled back into a
 * polyline so hit testing and label placement follow the drawn line.
 *
 * The two end tangents come from the anchors rather than from the spline, so a
 * curve with no bend points is still a curve: it leaves the source along its
 * edge normal and arrives at the target along that shape's.
 */
function curvedPath(
  points: readonly Point[],
  startDirection: Point,
  endDirection: Point,
): { d: string; sampled: Point[] } {
  if (points.length < 2) {
    return { d: pathFromPoints(points), sampled: points.map((p) => ({ ...p })) };
  }
  const pts = points;
  const last = pts.length - 1;
  const parts = [`M ${round(pts[0].x, 2)} ${round(pts[0].y, 2)}`];
  const sampled: Point[] = [{ ...pts[0] }];
  for (let i = 0; i < last; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const limit = distance(p1, p2) * HANDLE_FRACTION;
    const c1 =
      i === 0
        ? endHandle(p1, startDirection, p2)
        : clampHandle(
            p1,
            { x: p1.x + (p2.x - pts[i - 1].x) / 6, y: p1.y + (p2.y - pts[i - 1].y) / 6 },
            limit,
          );
    // `endDirection` points out of the target, which is exactly where the
    // incoming handle has to sit.
    const c2 =
      i === last - 1
        ? endHandle(p2, endDirection, p1)
        : clampHandle(
            p2,
            { x: p2.x - (pts[i + 2].x - p1.x) / 6, y: p2.y - (pts[i + 2].y - p1.y) / 6 },
            limit,
          );
    parts.push(
      `C ${round(c1.x, 2)} ${round(c1.y, 2)} ${round(c2.x, 2)} ${round(c2.y, 2)} ${round(p2.x, 2)} ${round(p2.y, 2)}`,
    );
    // Sample densely enough that hit testing and labels follow the curve, but
    // not so densely that a long diagram carries thousands of points.
    const steps = Math.max(12, Math.min(48, Math.round(distance(p1, p2) / 8)));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const mt = 1 - t;
      sampled.push({
        x: mt ** 3 * p1.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p2.x,
        y: mt ** 3 * p1.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p2.y,
      });
    }
  }
  return { d: parts.join(' '), sampled };
}

function directionBetween(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

export interface RouteContext {
  elements: Readonly<Record<string, DiagramElement>>;
  /** Shapes the route should try to avoid. Ignored when empty. */
  obstacles?: readonly Rect[];
}

function endpointPoint(
  connector: ConnectorElement,
  which: 'source' | 'target',
  context: RouteContext,
  toward: Point,
): { point: Point; direction: Point; attached: boolean } {
  const endpoint = connector[which];
  if (endpoint.elementId) {
    const element = context.elements[endpoint.elementId];
    if (isShape(element)) {
      const resolved: ResolvedAnchor = resolveAnchor(element, endpoint.anchor, toward);
      return { point: resolved.point, direction: resolved.direction, attached: true };
    }
  }
  return { point: { ...endpoint.point }, direction: { x: 0, y: 0 }, attached: false };
}

/**
 * Compute the route for `connector`.
 *
 * Anchor resolution is done twice for floating anchors: once against the other
 * endpoint's cached position, then again against the resolved point. Two passes
 * are enough to settle on a stable pair without oscillating.
 */
export function routeConnector(
  connector: ConnectorElement,
  context: RouteContext,
): RoutedPath {
  let sourceHint = connector.target.point;
  let targetHint = connector.source.point;
  let source = endpointPoint(connector, 'source', context, sourceHint);
  let target = endpointPoint(connector, 'target', context, targetHint);
  sourceHint = target.point;
  targetHint = source.point;
  source = endpointPoint(connector, 'source', context, sourceHint);
  target = endpointPoint(connector, 'target', context, targetHint);

  const waypoints = connector.waypoints.map((p) => ({ ...p }));
  const kind: ConnectorKind = connector.connectorKind;

  // Free endpoints get a direction inferred from the line itself.
  const startDirection = source.attached
    ? source.direction
    : directionBetween(source.point, waypoints[0] ?? target.point);
  const endDirection = target.attached
    ? target.direction
    : directionBetween(target.point, waypoints[waypoints.length - 1] ?? source.point);

  const obstacles =
    connector.avoidShapes && context.obstacles ? context.obstacles : [];

  let points: Point[];
  if (kind === 'straight' || kind === 'freeform') {
    points = simplify([source.point, ...waypoints, target.point]);
  } else if (kind === 'curved') {
    // The spline normally runs straight through the bend points. It only
    // borrows an orthogonal spine when the user asked the connector to route
    // around shapes and the direct line would cut through one, so ticking the
    // box does not change a curve that was already clear.
    const direct = simplify([source.point, ...waypoints, target.point]);
    points =
      waypoints.length === 0 && polylineBlocked(direct, obstacles)
        ? splineSpine(
            orthogonalRoute(
              source.point,
              startDirection,
              target.point,
              endDirection,
              obstacles,
            ),
          )
        : direct;
  } else if (kind === 'step') {
    points =
      waypoints.length > 0
        ? orthogonalChain(
            source.point,
            startDirection,
            waypoints,
            target.point,
            endDirection,
            'step',
          )
        : orthogonalRoute(
            source.point,
            startDirection,
            target.point,
            endDirection,
            obstacles,
            'step',
          );
  } else {
    // Elbow. With manual bend points, route orthogonally between each pair.
    points =
      waypoints.length > 0
        ? orthogonalChain(
            source.point,
            startDirection,
            waypoints,
            target.point,
            endDirection,
            'elbow',
          )
        : orthogonalRoute(
            source.point,
            startDirection,
            target.point,
            endDirection,
            obstacles,
          );
  }

  if (points.length < 2) points = [source.point, target.point];

  let d: string;
  let sampled = points;
  if (kind === 'curved') {
    const curve = curvedPath(points, startDirection, endDirection);
    d = curve.d;
    sampled = curve.sampled;
  } else if (kind === 'elbow' || kind === 'step') {
    d = roundedPathFromPoints(points, connector.style.cornerRadius);
  } else {
    d = pathFromPoints(points);
  }

  const first = sampled[0];
  const second = sampled[1] ?? first;
  const last = sampled[sampled.length - 1];
  const penultimate = sampled[sampled.length - 2] ?? last;

  return {
    points: sampled,
    d,
    startDirection: directionBetween(first, second),
    endDirection: directionBetween(penultimate, last),
  };
}

/** Bounding rectangles of every shape except the two the connector joins. */
export function obstaclesFor(
  connector: ConnectorElement,
  elements: Readonly<Record<string, DiagramElement>>,
): Rect[] {
  const skip = new Set<string>();
  if (connector.source.elementId) skip.add(connector.source.elementId);
  if (connector.target.elementId) skip.add(connector.target.elementId);
  const out: Rect[] = [];
  for (const element of Object.values(elements)) {
    if (!isShape(element) || skip.has(element.id) || element.hidden) continue;
    const shape = element as ShapeElement;
    out.push(shape.frame);
  }
  return out;
}
