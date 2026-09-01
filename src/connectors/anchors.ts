/**
 * Anchor resolution: turning a `ConnectorEndpoint` into a concrete point on
 * the canvas plus the direction the line should leave the shape in.
 *
 * Floating anchors pick the connection point that faces the other end of the
 * connector. That keeps routes tidy without an obstacle-avoidance pass, and it
 * gives the same answer every time the document is loaded.
 */

import type { Point, Rect } from '../model/geometry';
import { distance, rectCenter, rotatePoint } from '../model/geometry';
import type { AnchorSpec, ShapeElement } from '../model/types';
import { getShapeDefinition } from '../shapes/library';

export type Side = 'top' | 'right' | 'bottom' | 'left';

export interface ResolvedAnchor {
  point: Point;
  /** Unit vector pointing away from the shape. */
  direction: Point;
  side: Side;
  /** The ratio position inside the frame that produced this point. */
  ratio: Point;
}

const DIRECTIONS: Record<Side, Point> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

/** Which edge a 0..1 ratio position belongs to. */
export function sideForRatio(ratio: Point): Side {
  const distances: Array<[Side, number]> = [
    ['left', ratio.x],
    ['right', 1 - ratio.x],
    ['top', ratio.y],
    ['bottom', 1 - ratio.y],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

function ratioToPoint(frame: Rect, ratio: Point): Point {
  return { x: frame.x + frame.width * ratio.x, y: frame.y + frame.height * ratio.y };
}

/** Convert a canvas point into a 0..1 ratio inside `frame`, clamped to the edge. */
export function pointToRatio(frame: Rect, p: Point): Point {
  const rx = frame.width === 0 ? 0.5 : (p.x - frame.x) / frame.width;
  const ry = frame.height === 0 ? 0.5 : (p.y - frame.y) / frame.height;
  return { x: Math.min(1, Math.max(0, rx)), y: Math.min(1, Math.max(0, ry)) };
}

/** The connection-point ratios declared by a shape's definition. */
export function anchorRatios(shape: ShapeElement): readonly Point[] {
  const definition = getShapeDefinition(shape.shape);
  return (
    definition.connectionPoints ?? [
      { x: 0.5, y: 0 },
      { x: 1, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0.5 },
    ]
  );
}

function applyRotation(shape: ShapeElement, p: Point): Point {
  if (!shape.rotation) return p;
  return rotatePoint(p, rectCenter(shape.frame), shape.rotation);
}

function rotateDirection(shape: ShapeElement, d: Point): Point {
  if (!shape.rotation) return d;
  const rad = (shape.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos };
}

/**
 * Resolve an anchor on `shape`. `toward` is the other end of the connector and
 * is only used by floating anchors.
 */
export function resolveAnchor(
  shape: ShapeElement,
  anchor: AnchorSpec,
  toward: Point,
): ResolvedAnchor {
  const ratios = anchorRatios(shape);
  let ratio: Point;

  if (anchor.mode === 'fixed') {
    ratio = ratios[anchor.index] ?? ratios[0] ?? { x: 0.5, y: 0.5 };
  } else if (anchor.mode === 'ratio') {
    ratio = { x: anchor.rx, y: anchor.ry };
  } else {
    // Floating: choose the declared connection point closest to the far end,
    // but never the point the far end is standing on. On a connector that
    // joins a shape to itself that is the nearest point of all, and taking it
    // collapses the line to nothing.
    let best: Point | null = null;
    let bestDistance = Infinity;
    for (const candidate of ratios) {
      const p = applyRotation(shape, ratioToPoint(shape.frame, candidate));
      const d = distance(p, toward);
      if (d < 0.01) continue;
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
    ratio = best ?? ratios[0] ?? { x: 0.5, y: 0.5 };
  }

  const side = sideForRatio(ratio);
  return {
    point: applyRotation(shape, ratioToPoint(shape.frame, ratio)),
    direction: rotateDirection(shape, DIRECTIONS[side]),
    side,
    ratio,
  };
}

/** The anchor spec produced by dropping a connector end on `p` over `shape`. */
export function anchorForDrop(
  shape: ShapeElement,
  p: Point,
  snapTolerance: number,
): AnchorSpec {
  const ratios = anchorRatios(shape);
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < ratios.length; i++) {
    const candidate = applyRotation(shape, ratioToPoint(shape.frame, ratios[i]));
    const d = distance(candidate, p);
    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  if (bestIndex >= 0 && bestDistance <= snapTolerance) {
    return { mode: 'fixed', index: bestIndex };
  }
  return { mode: 'floating' };
}
