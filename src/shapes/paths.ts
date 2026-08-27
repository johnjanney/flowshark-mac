/**
 * SVG path builders used by the shape library.
 *
 * Every builder works in the shape's own coordinate space: the frame starts at
 * (0, 0) and is `w` wide and `h` tall. The renderer translates and rotates the
 * result, so nothing here needs to know where the shape sits on the canvas.
 */

import type { Point } from '../model/geometry';
import { clamp, round } from '../model/geometry';

function n(value: number): string {
  return String(round(value, 3));
}

export function moveTo(x: number, y: number): string {
  return `M ${n(x)} ${n(y)}`;
}

export function lineTo(x: number, y: number): string {
  return `L ${n(x)} ${n(y)}`;
}

export function curveTo(
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  x: number,
  y: number,
): string {
  return `C ${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)}`;
}

export function quadTo(cx: number, cy: number, x: number, y: number): string {
  return `Q ${n(cx)} ${n(cy)} ${n(x)} ${n(y)}`;
}

export function arcTo(
  rx: number,
  ry: number,
  largeArc: 0 | 1,
  sweep: 0 | 1,
  x: number,
  y: number,
): string {
  return `A ${n(rx)} ${n(ry)} 0 ${largeArc} ${sweep} ${n(x)} ${n(y)}`;
}

export const CLOSE = 'Z';

export function polygon(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const parts = [moveTo(points[0].x, points[0].y)];
  for (let i = 1; i < points.length; i++) parts.push(lineTo(points[i].x, points[i].y));
  parts.push(CLOSE);
  return parts.join(' ');
}

export function polyline(points: readonly Point[]): string {
  if (points.length === 0) return '';
  const parts = [moveTo(points[0].x, points[0].y)];
  for (let i = 1; i < points.length; i++) parts.push(lineTo(points[i].x, points[i].y));
  return parts.join(' ');
}

export function rectPath(w: number, h: number): string {
  return polygon([
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ]);
}

export function roundedRectPath(w: number, h: number, radius: number): string {
  const r = clamp(radius, 0, Math.min(w, h) / 2);
  if (r <= 0) return rectPath(w, h);
  return [
    moveTo(r, 0),
    lineTo(w - r, 0),
    arcTo(r, r, 0, 1, w, r),
    lineTo(w, h - r),
    arcTo(r, r, 0, 1, w - r, h),
    lineTo(r, h),
    arcTo(r, r, 0, 1, 0, h - r),
    lineTo(0, r),
    arcTo(r, r, 0, 1, r, 0),
    CLOSE,
  ].join(' ');
}

export function ellipsePath(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return [
    moveTo(0, ry),
    arcTo(rx, ry, 0, 1, w, ry),
    arcTo(rx, ry, 0, 1, 0, ry),
    CLOSE,
  ].join(' ');
}

/** A rectangle whose left and right ends are half-circles. */
export function stadiumPath(w: number, h: number): string {
  const r = Math.min(h / 2, w / 2);
  return [
    moveTo(r, 0),
    lineTo(w - r, 0),
    arcTo(r, r, 0, 1, w - r, h),
    lineTo(r, h),
    arcTo(r, r, 0, 1, r, 0),
    CLOSE,
  ].join(' ');
}

/** Wavy bottom edge, used by the document shapes. */
export function wavePath(w: number, y: number, amplitude: number, reverse = false): string {
  const a = amplitude;
  if (reverse) {
    return [
      curveTo(w * 0.75, y + a * 2, w * 0.25, y - a * 2, 0, y),
    ].join(' ');
  }
  return [curveTo(w * 0.25, y + a * 2, w * 0.75, y - a * 2, w, y)].join(' ');
}

export function documentPath(w: number, h: number): string {
  const wave = Math.max(4, Math.min(h * 0.16, 18));
  const baseline = h - wave;
  return [
    moveTo(0, 0),
    lineTo(w, 0),
    lineTo(w, baseline),
    wavePath(w, baseline, wave / 2, true),
    CLOSE,
  ].join(' ');
}

export function cylinderPath(w: number, h: number): string {
  const ry = Math.min(h * 0.18, w * 0.28, 22);
  return [
    moveTo(0, ry),
    arcTo(w / 2, ry, 0, 1, w, ry),
    lineTo(w, h - ry),
    arcTo(w / 2, ry, 0, 1, 0, h - ry),
    CLOSE,
  ].join(' ');
}

/** The visible ellipse across the top of a cylinder. */
export function cylinderCapPath(w: number, h: number): string {
  const ry = Math.min(h * 0.18, w * 0.28, 22);
  return [moveTo(0, ry), arcTo(w / 2, ry, 0, 0, w, ry)].join(' ');
}

export function horizontalCylinderPath(w: number, h: number): string {
  const rx = Math.min(w * 0.18, h * 0.28, 22);
  return [
    moveTo(rx, 0),
    lineTo(w - rx, 0),
    arcTo(rx, h / 2, 0, 1, w - rx, h),
    lineTo(rx, h),
    arcTo(rx, h / 2, 0, 1, rx, 0),
    CLOSE,
  ].join(' ');
}

export function starPath(w: number, h: number, points = 5, innerRatio = 0.42): string {
  const cx = w / 2;
  const cy = h / 2;
  const outerX = w / 2;
  const outerY = h / 2;
  const vertices: Point[] = [];
  const step = Math.PI / points;
  for (let i = 0; i < points * 2; i++) {
    const ratio = i % 2 === 0 ? 1 : innerRatio;
    const angle = -Math.PI / 2 + i * step;
    vertices.push({
      x: cx + Math.cos(angle) * outerX * ratio,
      y: cy + Math.sin(angle) * outerY * ratio,
    });
  }
  return polygon(vertices);
}

export function cloudPath(w: number, h: number): string {
  // Five overlapping arcs traced clockwise from the lower left.
  const sx = w / 100;
  const sy = h / 100;
  const p = (x: number, y: number): [number, number] => [x * sx, y * sy];
  const [m0x, m0y] = p(22, 88);
  return [
    moveTo(m0x, m0y),
    curveTo(...p(4, 88), ...p(-2, 62), ...p(14, 54)),
    curveTo(...p(6, 30), ...p(32, 14), ...p(46, 28)),
    curveTo(...p(56, 2), ...p(92, 8), ...p(88, 36)),
    curveTo(...p(104, 42), ...p(102, 76), ...p(84, 84)),
    curveTo(...p(80, 96), ...p(36, 100), ...p(m0x / sx, m0y / sy)),
    CLOSE,
  ].join(' ');
}

/** A right-pointing block arrow that fills the frame. */
export function blockArrowPath(w: number, h: number): string {
  const headWidth = Math.min(w * 0.4, h);
  const shaftTop = h * 0.28;
  const shaftBottom = h * 0.72;
  return polygon([
    { x: 0, y: shaftTop },
    { x: w - headWidth, y: shaftTop },
    { x: w - headWidth, y: 0 },
    { x: w, y: h / 2 },
    { x: w - headWidth, y: h },
    { x: w - headWidth, y: shaftBottom },
    { x: 0, y: shaftBottom },
  ]);
}

/** A curly-brace style annotation bracket down the left edge. */
export function annotationPath(w: number, h: number): string {
  const inset = Math.min(w * 0.18, 16);
  return [
    moveTo(inset, 0),
    lineTo(0, 0),
    lineTo(0, h),
    lineTo(inset, h),
  ].join(' ');
}

export function calloutPath(w: number, h: number, radius: number): string {
  const tailHeight = Math.min(h * 0.22, 18);
  const bodyHeight = h - tailHeight;
  const r = clamp(radius, 0, Math.min(w, bodyHeight) / 2);
  const tailX = Math.min(w * 0.28, 48);
  return [
    moveTo(r, 0),
    lineTo(w - r, 0),
    arcTo(r, r, 0, 1, w, r),
    lineTo(w, bodyHeight - r),
    arcTo(r, r, 0, 1, w - r, bodyHeight),
    lineTo(tailX + 24, bodyHeight),
    lineTo(tailX, h),
    lineTo(tailX, bodyHeight),
    lineTo(r, bodyHeight),
    arcTo(r, r, 0, 1, 0, bodyHeight - r),
    lineTo(0, r),
    arcTo(r, r, 0, 1, r, 0),
    CLOSE,
  ].join(' ');
}
