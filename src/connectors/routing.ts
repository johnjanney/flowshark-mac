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

/** Orthogonal route between two stub ends. */
function orthogonalRoute(
  start: Point,
  startDirection: Point,
  end: Point,
  endDirection: Point,
  obstacles: readonly Rect[],
): Point[] {
  const s = offsetPoint(start, startDirection, STUB_LENGTH);
  const e = offsetPoint(end, endDirection, STUB_LENGTH);
  const startHorizontal = Math.abs(startDirection.x) > Math.abs(startDirection.y);
  const endHorizontal = Math.abs(endDirection.x) > Math.abs(endDirection.y);

  let middle: Point[];
  if (startHorizontal && endHorizontal) {
    let mx = middleCoordinate(s.x, e.x, startDirection.x, endDirection.x);
    mx = avoidObstacles(mx, s.y, e.y, 'x', obstacles);
    middle = [
      { x: mx, y: s.y },
      { x: mx, y: e.y },
    ];
  } else if (!startHorizontal && !endHorizontal) {
    let my = middleCoordinate(s.y, e.y, startDirection.y, endDirection.y);
    my = avoidObstacles(my, s.x, e.x, 'y', obstacles);
    middle = [
      { x: s.x, y: my },
      { x: e.x, y: my },
    ];
  } else if (startHorizontal) {
    middle = [{ x: e.x, y: s.y }];
  } else {
    middle = [{ x: s.x, y: e.y }];
  }

  return simplify([start, s, ...middle, e, end]);
}

/** A single step: out, across the midpoint, and in. */
function stepRoute(
  start: Point,
  startDirection: Point,
  end: Point,
): Point[] {
  const startHorizontal = Math.abs(startDirection.x) > Math.abs(startDirection.y);
  if (startHorizontal) {
    const mx = (start.x + end.x) / 2;
    return simplify([
      start,
      { x: mx, y: start.y },
      { x: mx, y: end.y },
      end,
    ]);
  }
  const my = (start.y + end.y) / 2;
  return simplify([start, { x: start.x, y: my }, { x: end.x, y: my }, end]);
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
 * A Catmull-Rom spline converted to cubic Béziers, sampled back into a
 * polyline so hit testing and label placement follow the drawn line.
 */
function curvedPath(points: readonly Point[]): { d: string; sampled: Point[] } {
  if (points.length < 3) {
    return { d: pathFromPoints(points), sampled: points.map((p) => ({ ...p })) };
  }
  const pts = points;
  const parts = [`M ${round(pts[0].x, 2)} ${round(pts[0].y, 2)}`];
  const sampled: Point[] = [{ ...pts[0] }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] ?? pts[i + 1];
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    parts.push(
      `C ${round(c1.x, 2)} ${round(c1.y, 2)} ${round(c2.x, 2)} ${round(c2.y, 2)} ${round(p2.x, 2)} ${round(p2.y, 2)}`,
    );
    const steps = 12;
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
    points = simplify([source.point, ...waypoints, target.point]);
  } else if (kind === 'step') {
    points =
      waypoints.length > 0
        ? simplify([source.point, ...waypoints, target.point])
        : stepRoute(source.point, startDirection, target.point);
  } else {
    // Elbow. With manual waypoints, route orthogonally between each pair.
    if (waypoints.length > 0) {
      const chain: Point[] = [source.point];
      let previous = source.point;
      let previousDirection = startDirection;
      for (const waypoint of waypoints) {
        const leg = orthogonalRoute(
          previous,
          previousDirection,
          waypoint,
          { x: -previousDirection.x, y: -previousDirection.y },
          [],
        );
        chain.push(...leg.slice(1));
        previous = waypoint;
        previousDirection = directionBetween(chain[chain.length - 2] ?? previous, waypoint);
      }
      const finalLeg = orthogonalRoute(
        previous,
        previousDirection,
        target.point,
        endDirection,
        [],
      );
      chain.push(...finalLeg.slice(1));
      points = simplify(chain);
    } else {
      points = orthogonalRoute(
        source.point,
        startDirection,
        target.point,
        endDirection,
        obstacles,
      );
    }
  }

  if (points.length < 2) points = [source.point, target.point];

  let d: string;
  let sampled = points;
  if (kind === 'curved') {
    const curve = curvedPath(points);
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
