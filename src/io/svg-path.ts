/**
 * A small SVG path-data parser.
 *
 * The shape library and the connector router emit path data, and the PDF
 * exporter needs the same geometry as drawing operators. Parsing the strings we
 * generated ourselves keeps a single source of truth for every shape outline:
 * if a shape changes, the PDF changes with it, automatically.
 *
 * Only the commands FlowShark emits are supported (M, L, C, Q, A, Z, and their
 * relative forms). Arcs are converted to cubic Béziers, and quadratics are
 * elevated to cubics, so consumers only ever see move/line/cubic/close.
 */

import type { Point } from '../model/geometry';
import { distance } from '../model/geometry';

export type PathSegment =
  | { type: 'move'; to: Point }
  | { type: 'line'; to: Point }
  | { type: 'cubic'; c1: Point; c2: Point; to: Point }
  | { type: 'close' };

const NUMBER = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g;

function tokenize(data: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  let index = 0;
  while (index < data.length) {
    const character = data[index];
    if (/[a-zA-Z]/.test(character)) {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (/[\s,]/.test(character)) {
      index += 1;
      continue;
    }
    NUMBER.lastIndex = index;
    const match = NUMBER.exec(data);
    if (!match || match.index !== index) {
      index += 1;
      continue;
    }
    tokens.push(Number(match[0]));
    index = NUMBER.lastIndex;
  }
  return tokens;
}

/** Convert an elliptical arc to a sequence of cubic Bézier segments. */
function arcToCubics(
  from: Point,
  rx: number,
  ry: number,
  rotationDegrees: number,
  largeArc: boolean,
  sweep: boolean,
  to: Point,
): PathSegment[] {
  if (rx === 0 || ry === 0) return [{ type: 'line', to }];
  const phi = (rotationDegrees * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx2 = (from.x - to.x) / 2;
  const dy2 = (from.y - to.y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  let radiusX = Math.abs(rx);
  let radiusY = Math.abs(ry);
  const lambda = (x1p * x1p) / (radiusX * radiusX) + (y1p * y1p) / (radiusY * radiusY);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    radiusX *= scale;
    radiusY *= scale;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const numerator =
    radiusX * radiusX * radiusY * radiusY -
    radiusX * radiusX * y1p * y1p -
    radiusY * radiusY * x1p * x1p;
  const denominator = radiusX * radiusX * y1p * y1p + radiusY * radiusY * x1p * x1p;
  const coefficient = sign * Math.sqrt(Math.max(0, numerator / denominator));

  const cxp = (coefficient * (radiusX * y1p)) / radiusY;
  const cyp = (coefficient * -(radiusY * x1p)) / radiusX;
  const cx = cosPhi * cxp - sinPhi * cyp + (from.x + to.x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (from.y + to.y) / 2;

  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let value = Math.acos(Math.min(1, Math.max(-1, dot / (length || 1))));
    if (ux * vy - uy * vx < 0) value = -value;
    return value;
  };

  const startAngle = angle(1, 0, (x1p - cxp) / radiusX, (y1p - cyp) / radiusY);
  let deltaAngle = angle(
    (x1p - cxp) / radiusX,
    (y1p - cyp) / radiusY,
    (-x1p - cxp) / radiusX,
    (-y1p - cyp) / radiusY,
  );
  if (!sweep && deltaAngle > 0) deltaAngle -= 2 * Math.PI;
  if (sweep && deltaAngle < 0) deltaAngle += 2 * Math.PI;

  const segmentCount = Math.max(1, Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2)));
  const step = deltaAngle / segmentCount;
  const alpha = (4 / 3) * Math.tan(step / 4);

  const segments: PathSegment[] = [];
  let theta = startAngle;
  let current = { ...from };
  for (let i = 0; i < segmentCount; i++) {
    const next = theta + step;
    const cosTheta = Math.cos(theta);
    const sinTheta = Math.sin(theta);
    const cosNext = Math.cos(next);
    const sinNext = Math.sin(next);

    const pointAt = (c: number, s: number): Point => ({
      x: cx + cosPhi * radiusX * c - sinPhi * radiusY * s,
      y: cy + sinPhi * radiusX * c + cosPhi * radiusY * s,
    });
    const derivativeAt = (c: number, s: number): Point => ({
      x: -cosPhi * radiusX * s - sinPhi * radiusY * c,
      y: -sinPhi * radiusX * s + cosPhi * radiusY * c,
    });

    const end = pointAt(cosNext, sinNext);
    const d1 = derivativeAt(cosTheta, sinTheta);
    const d2 = derivativeAt(cosNext, sinNext);
    segments.push({
      type: 'cubic',
      c1: { x: current.x + alpha * d1.x, y: current.y + alpha * d1.y },
      c2: { x: end.x - alpha * d2.x, y: end.y - alpha * d2.y },
      to: end,
    });
    current = end;
    theta = next;
  }
  return segments;
}

export function parsePath(data: string): PathSegment[] {
  const tokens = tokenize(data);
  const segments: PathSegment[] = [];
  let index = 0;
  let command = '';
  let current: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };

  const nextNumber = (): number => {
    const value = tokens[index++];
    return typeof value === 'number' ? value : 0;
  };

  while (index < tokens.length) {
    const token = tokens[index];
    if (typeof token === 'string') {
      command = token;
      index += 1;
    } else if (command === 'M') {
      command = 'L';
    } else if (command === 'm') {
      command = 'l';
    }

    const relative = command === command.toLowerCase();
    const base = relative ? current : { x: 0, y: 0 };

    switch (command.toUpperCase()) {
      case 'M': {
        const to = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        segments.push({ type: 'move', to });
        current = to;
        start = to;
        break;
      }
      case 'L': {
        const to = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        segments.push({ type: 'line', to });
        current = to;
        break;
      }
      case 'H': {
        const to = { x: base.x + nextNumber(), y: current.y };
        segments.push({ type: 'line', to });
        current = to;
        break;
      }
      case 'V': {
        const to = { x: current.x, y: base.y + nextNumber() };
        segments.push({ type: 'line', to });
        current = to;
        break;
      }
      case 'C': {
        const c1 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const c2 = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const to = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        segments.push({ type: 'cubic', c1, c2, to });
        current = to;
        break;
      }
      case 'Q': {
        const q = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        const to = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        // Elevate the quadratic to a cubic.
        segments.push({
          type: 'cubic',
          c1: { x: current.x + (2 / 3) * (q.x - current.x), y: current.y + (2 / 3) * (q.y - current.y) },
          c2: { x: to.x + (2 / 3) * (q.x - to.x), y: to.y + (2 / 3) * (q.y - to.y) },
          to,
        });
        current = to;
        break;
      }
      case 'A': {
        const rx = nextNumber();
        const ry = nextNumber();
        const rotation = nextNumber();
        const largeArc = nextNumber() !== 0;
        const sweep = nextNumber() !== 0;
        const to = { x: base.x + nextNumber(), y: base.y + nextNumber() };
        segments.push(...arcToCubics(current, rx, ry, rotation, largeArc, sweep, to));
        current = to;
        break;
      }
      case 'Z': {
        segments.push({ type: 'close' });
        current = start;
        break;
      }
      default:
        // Unknown command: skip a token to guarantee progress.
        index += 1;
        break;
    }
  }
  return segments;
}

/** Apply an affine transform to every point in a segment list. */
export function transformSegments(
  segments: readonly PathSegment[],
  transform: (p: Point) => Point,
): PathSegment[] {
  return segments.map((segment) => {
    switch (segment.type) {
      case 'move':
        return { type: 'move', to: transform(segment.to) };
      case 'line':
        return { type: 'line', to: transform(segment.to) };
      case 'cubic':
        return {
          type: 'cubic',
          c1: transform(segment.c1),
          c2: transform(segment.c2),
          to: transform(segment.to),
        };
      default:
        return segment;
    }
  });
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function cubicAt(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t ** 3 * p1.x,
    y: mt ** 3 * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t ** 3 * p1.y,
  };
}

const FLATTEN_STEPS = 24;

/** Approximate arc length of a cubic, by flattening it. */
function cubicLength(p0: Point, c1: Point, c2: Point, p1: Point): number {
  let total = 0;
  let previous = p0;
  for (let i = 1; i <= FLATTEN_STEPS; i++) {
    const next = cubicAt(p0, c1, c2, p1, i / FLATTEN_STEPS);
    total += distance(previous, next);
    previous = next;
  }
  return total;
}

/** The parameter at which a cubic has covered `length` from its start. */
function cubicParameterAt(p0: Point, c1: Point, c2: Point, p1: Point, length: number): number {
  let travelled = 0;
  let previous = p0;
  for (let i = 1; i <= FLATTEN_STEPS; i++) {
    const t = i / FLATTEN_STEPS;
    const next = cubicAt(p0, c1, c2, p1, t);
    const step = distance(previous, next);
    if (travelled + step >= length) {
      const within = step === 0 ? 0 : (length - travelled) / step;
      return (i - 1 + within) / FLATTEN_STEPS;
    }
    travelled += step;
    previous = next;
  }
  return 1;
}

/** The part of a cubic from `t` to 1, by de Casteljau subdivision. */
function cubicAfter(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  t: number,
): { from: Point; c1: Point; c2: Point; to: Point } {
  const a = lerp(p0, c1, t);
  const b = lerp(c1, c2, t);
  const c = lerp(c2, p1, t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const f = lerp(d, e, t);
  return { from: f, c1: e, c2: c, to: p1 };
}

function reverseSegments(segments: readonly PathSegment[]): PathSegment[] {
  const points: Point[] = [];
  let cursor: Point = { x: 0, y: 0 };
  for (const segment of segments) {
    if (segment.type === 'close') continue;
    points.push(cursor);
    cursor = segment.to;
  }
  const out: PathSegment[] = [{ type: 'move', to: cursor }];
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i];
    if (segment.type === 'move' || segment.type === 'close') continue;
    const from = points[i];
    if (segment.type === 'line') out.push({ type: 'line', to: from });
    else out.push({ type: 'cubic', c1: segment.c2, c2: segment.c1, to: from });
  }
  return out;
}

/** Drop `length` from the start of an open path, splitting the segment it lands in. */
function trimSegmentsStart(segments: readonly PathSegment[], length: number): PathSegment[] {
  if (length <= 0 || segments.length === 0) return [...segments];
  let cursor: Point = segments[0].type === 'move' ? segments[0].to : { x: 0, y: 0 };
  let remaining = length;
  const out: PathSegment[] = [];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment.type === 'move') {
      cursor = segment.to;
      continue;
    }
    if (segment.type === 'close') continue;
    if (out.length > 0) {
      out.push(segment);
      cursor = segment.to;
      continue;
    }
    if (segment.type === 'line') {
      const span = distance(cursor, segment.to);
      if (span <= remaining) {
        remaining -= span;
        cursor = segment.to;
        continue;
      }
      const start = lerp(cursor, segment.to, span === 0 ? 0 : remaining / span);
      out.push({ type: 'move', to: start }, { type: 'line', to: segment.to });
      cursor = segment.to;
      continue;
    }
    const span = cubicLength(cursor, segment.c1, segment.c2, segment.to);
    if (span <= remaining) {
      remaining -= span;
      cursor = segment.to;
      continue;
    }
    const t = cubicParameterAt(cursor, segment.c1, segment.c2, segment.to, remaining);
    const part = cubicAfter(cursor, segment.c1, segment.c2, segment.to, t);
    out.push(
      { type: 'move', to: part.from },
      { type: 'cubic', c1: part.c1, c2: part.c2, to: part.to },
    );
    cursor = segment.to;
  }
  // Nothing survived the trim: keep the path's last point so callers still
  // have somewhere to draw.
  return out.length > 0 ? out : [{ type: 'move', to: cursor }];
}

/**
 * Shorten an open path at both ends.
 *
 * Connectors use this to stop the line short of an endpoint marker without
 * giving up the curves and rounded corners the screen draws — trimming the
 * geometry keeps the exported shape identical to the rendered one.
 */
export function trimSegments(
  segments: readonly PathSegment[],
  startLength: number,
  endLength: number,
): PathSegment[] {
  let out = trimSegmentsStart(segments, startLength);
  if (endLength > 0) {
    out = reverseSegments(trimSegmentsStart(reverseSegments(out), endLength));
  }
  return out;
}
