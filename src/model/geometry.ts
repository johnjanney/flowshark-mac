/**
 * Geometry primitives shared by the model, the canvas engine, and the
 * connector engine. Everything here is pure and has no DOM dependency, which
 * keeps it testable outside a browser.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EPSILON = 1e-9;

export function point(x: number, y: number): Point {
  return { x, y };
}

export function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}

export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

export function rectRight(r: Rect): number {
  return r.x + r.width;
}

export function rectBottom(r: Rect): number {
  return r.y + r.height;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectIntersects(a: Rect, b: Rect): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function rectFromPoints(a: Point, b: Point): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
    if (r.y + r.height > maxY) maxY = r.y + r.height;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function inflateRect(r: Rect, amount: number): Rect {
  return {
    x: r.x - amount,
    y: r.y - amount,
    width: r.width + amount * 2,
    height: r.height + amount * 2,
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Rotate `p` around `origin` by `degrees` (clockwise in screen coordinates). */
export function rotatePoint(p: Point, origin: Point, degrees: number): Point {
  if (degrees === 0) return { x: p.x, y: p.y };
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return {
    x: origin.x + dx * cos - dy * sin,
    y: origin.y + dx * sin + dy * cos,
  };
}

/**
 * Axis-aligned bounding box of a rectangle that has been rotated about its own
 * centre. Used for selection bounds and export bounds.
 */
export function rotatedBounds(r: Rect, degrees: number): Rect {
  if (!degrees) return { ...r };
  const c = rectCenter(r);
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x + r.width, y: r.y + r.height },
    { x: r.x, y: r.y + r.height },
  ].map((p) => rotatePoint(p, c, degrees));
  return unionRects(corners.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })))!;
}

/** Closest point to `p` on the segment `a`-`b`. */
export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return { ...a };
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared;
  t = clamp(t, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b));
}

/** Distance from `p` to the closest point on a polyline. */
export function distanceToPolyline(p: Point, points: readonly Point[]): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distance(p, points[0]);
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const d = distanceToSegment(p, points[i], points[i + 1]);
    if (d < best) best = d;
  }
  return best;
}

export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) total += distance(points[i], points[i + 1]);
  return total;
}

/** Point at normalised distance `t` (0..1) along a polyline. */
export function pointAlongPolyline(points: readonly Point[], t: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };
  const total = polylineLength(points);
  if (total < EPSILON) return { ...points[0] };
  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < points.length - 1; i++) {
    const segment = distance(points[i], points[i + 1]);
    if (target <= segment || i === points.length - 2) {
      const local = segment < EPSILON ? 0 : target / segment;
      return lerpPoint(points[i], points[i + 1], clamp(local, 0, 1));
    }
    target -= segment;
  }
  return { ...points[points.length - 1] };
}

/** Unit tangent of a polyline at normalised distance `t`. */
export function tangentAlongPolyline(points: readonly Point[], t: number): Point {
  if (points.length < 2) return { x: 1, y: 0 };
  const total = polylineLength(points);
  let target = clamp(t, 0, 1) * total;
  for (let i = 0; i < points.length - 1; i++) {
    const segment = distance(points[i], points[i + 1]);
    if (target <= segment || i === points.length - 2) {
      const dx = points[i + 1].x - points[i].x;
      const dy = points[i + 1].y - points[i].y;
      const len = Math.hypot(dx, dy) || 1;
      return { x: dx / len, y: dy / len };
    }
    target -= segment;
  }
  return { x: 1, y: 0 };
}

/** Round to a sensible number of decimals so serialised files stay small. */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
