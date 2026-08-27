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
