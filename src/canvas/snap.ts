/**
 * Snapping and alignment guides.
 *
 * Two independent sources of snapping are combined: the grid, and the other
 * elements on the canvas. Element snapping wins when both are in range, because
 * lining up with a neighbour is almost always what the user meant.
 *
 * Tolerances are expressed in canvas units and divided by the zoom factor, so
 * the snap feels the same distance on screen at every zoom level.
 */

import type { Point, Rect } from '../model/geometry';
import { rectCenter } from '../model/geometry';
import type { CanvasSettings, ElementId, FlowsharkDocument } from '../model/types';
import { elementBounds, expandSelection, visibleElements } from '../model/document';
import { connectionPointsFor, getShapeDefinition } from '../shapes/library';
import { isShape } from '../model/types';
import type { Guide } from '../state/store';

export interface SnapResult {
  /** Adjustment to add to the proposed delta. */
  dx: number;
  dy: number;
  guides: Guide[];
}

interface Candidate {
  value: number;
  /** Extent of the matched element, used to draw a guide of sensible length. */
  from: number;
  to: number;
}

export function snapToGrid(value: number, size: number): number {
  return Math.round(value / size) * size;
}

export function snapPointToGrid(p: Point, settings: CanvasSettings): Point {
  if (!settings.grid.snap) return p;
  return {
    x: snapToGrid(p.x, settings.grid.size),
    y: snapToGrid(p.y, settings.grid.size),
  };
}

/** Bounds of every element that is not part of the current drag. */
export function staticBounds(
  doc: FlowsharkDocument,
  movingIds: readonly ElementId[],
): Rect[] {
  const moving = new Set(expandSelection(doc, movingIds));
  const out: Rect[] = [];
  for (const element of visibleElements(doc)) {
    if (moving.has(element.id) || element.kind === 'connector') continue;
    const bounds = elementBounds(doc, element);
    if (bounds) out.push(bounds);
  }
  return out;
}

function bestMatch(
  targets: readonly number[],
  candidates: readonly Candidate[],
  tolerance: number,
): { delta: number; candidate: Candidate; target: number } | null {
  let best: { delta: number; candidate: Candidate; target: number } | null = null;
  for (const target of targets) {
    for (const candidate of candidates) {
      const delta = candidate.value - target;
      if (Math.abs(delta) > tolerance) continue;
      if (!best || Math.abs(delta) < Math.abs(best.delta)) {
        best = { delta, candidate, target };
      }
    }
  }
  return best;
}

/**
 * Snap a proposed move of `bounds`.
 *
 * `bounds` is the union of everything being dragged, already offset by the
 * raw pointer delta.
 */
export function snapMove(
  doc: FlowsharkDocument,
  movingIds: readonly ElementId[],
  bounds: Rect,
  zoom: number,
  settings: CanvasSettings = doc.canvas,
): SnapResult {
  const tolerance = settings.snapTolerance / Math.max(zoom, 0.01);
  const guides: Guide[] = [];
  let dx = 0;
  let dy = 0;

  const others = settings.snapToElement ? staticBounds(doc, movingIds) : [];
  const centre = rectCenter(bounds);

  // Horizontal (x axis) alignment.
  const xTargets = [bounds.x, centre.x, bounds.x + bounds.width];
  const xCandidates: Candidate[] = [];
  for (const other of others) {
    const otherCentre = rectCenter(other);
    xCandidates.push(
      { value: other.x, from: other.y, to: other.y + other.height },
      { value: otherCentre.x, from: other.y, to: other.y + other.height },
      { value: other.x + other.width, from: other.y, to: other.y + other.height },
    );
  }
  const xMatch = bestMatch(xTargets, xCandidates, tolerance);
  if (xMatch) {
    dx = xMatch.delta;
    guides.push({
      orientation: 'vertical',
      position: xMatch.candidate.value,
      from: Math.min(xMatch.candidate.from, bounds.y),
      to: Math.max(xMatch.candidate.to, bounds.y + bounds.height),
      kind: 'align',
    });
  } else if (settings.grid.snap) {
    const snapped = snapToGrid(bounds.x, settings.grid.size);
    if (Math.abs(snapped - bounds.x) <= tolerance) dx = snapped - bounds.x;
  }

  // Vertical (y axis) alignment.
  const yTargets = [bounds.y, centre.y, bounds.y + bounds.height];
  const yCandidates: Candidate[] = [];
  for (const other of others) {
    const otherCentre = rectCenter(other);
    yCandidates.push(
      { value: other.y, from: other.x, to: other.x + other.width },
      { value: otherCentre.y, from: other.x, to: other.x + other.width },
      { value: other.y + other.height, from: other.x, to: other.x + other.width },
    );
  }
  const yMatch = bestMatch(yTargets, yCandidates, tolerance);
  if (yMatch) {
    dy = yMatch.delta;
    guides.push({
      orientation: 'horizontal',
      position: yMatch.candidate.value,
      from: Math.min(yMatch.candidate.from, bounds.x),
      to: Math.max(yMatch.candidate.to, bounds.x + bounds.width),
      kind: 'align',
    });
  } else if (settings.grid.snap) {
    const snapped = snapToGrid(bounds.y, settings.grid.size);
    if (Math.abs(snapped - bounds.y) <= tolerance) dy = snapped - bounds.y;
  }

  // Equal spacing: look for a neighbour pair whose gap matches this one.
  if (settings.snapToElement && others.length >= 2) {
    const spacing = equalSpacing(bounds, others, tolerance, dx, dy);
    if (spacing) {
      if (spacing.axis === 'x' && !xMatch) {
        dx = spacing.delta;
        guides.push(...spacing.guides);
      } else if (spacing.axis === 'y' && !yMatch) {
        dy = spacing.delta;
        guides.push(...spacing.guides);
      }
    }
  }

  return { dx, dy, guides: settings.showGuides ? guides : [] };
}

interface SpacingMatch {
  axis: 'x' | 'y';
  delta: number;
  guides: Guide[];
}

/**
 * Detect the "equal gaps" case: the dragged element sits to the right of (or
 * below) two elements that are themselves evenly spaced, and lands so the gap
 * repeats.
 */
function equalSpacing(
  bounds: Rect,
  others: readonly Rect[],
  tolerance: number,
  dx: number,
  dy: number,
): SpacingMatch | null {
  const moved: Rect = { ...bounds, x: bounds.x + dx, y: bounds.y + dy };

  for (const axis of ['x', 'y'] as const) {
    const size = axis === 'x' ? 'width' : 'height';
    const cross = axis === 'x' ? 'y' : 'x';
    const crossSize = axis === 'x' ? 'height' : 'width';

    // Only consider elements that overlap on the cross axis.
    const row = others.filter(
      (other) =>
        other[cross] < moved[cross] + moved[crossSize] &&
        other[cross] + other[crossSize] > moved[cross],
    );
    if (row.length < 2) continue;
    const sorted = [...row].sort((a, b) => a[axis] - b[axis]);

    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const gap = b[axis] - (a[axis] + a[size]);
      if (gap <= 0) continue;

      // Place after b, or before a, with the same gap.
      const afterValue = b[axis] + b[size] + gap;
      const beforeValue = a[axis] - gap - moved[size];
      for (const wanted of [afterValue, beforeValue]) {
        const delta = wanted - moved[axis];
        if (Math.abs(delta) > tolerance) continue;
        const guides: Guide[] = [
          {
            orientation: axis === 'x' ? 'vertical' : 'horizontal',
            position: a[axis] + a[size] + gap / 2,
            from: Math.min(a[cross], b[cross]),
            to: Math.max(a[cross] + a[crossSize], b[cross] + b[crossSize]),
            kind: 'spacing',
            label: `${Math.round(gap)}`,
          },
        ];
        return { axis, delta: delta + (axis === 'x' ? dx : dy), guides };
      }
    }
  }
  return null;
}

/** Snap a resize handle position to the grid and to nearby element edges. */
export function snapResizePoint(
  doc: FlowsharkDocument,
  movingIds: readonly ElementId[],
  p: Point,
  zoom: number,
  settings: CanvasSettings = doc.canvas,
): { point: Point; guides: Guide[] } {
  const tolerance = settings.snapTolerance / Math.max(zoom, 0.01);
  const guides: Guide[] = [];
  let x = p.x;
  let y = p.y;

  if (settings.snapToElement) {
    const others = staticBounds(doc, movingIds);
    let bestX: { delta: number; candidate: Candidate } | null = null;
    let bestY: { delta: number; candidate: Candidate } | null = null;
    for (const other of others) {
      const centre = rectCenter(other);
      for (const value of [other.x, centre.x, other.x + other.width]) {
        const delta = value - x;
        if (Math.abs(delta) <= tolerance && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, candidate: { value, from: other.y, to: other.y + other.height } };
        }
      }
      for (const value of [other.y, centre.y, other.y + other.height]) {
        const delta = value - y;
        if (Math.abs(delta) <= tolerance && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, candidate: { value, from: other.x, to: other.x + other.width } };
        }
      }
    }
    if (bestX) {
      x += bestX.delta;
      guides.push({
        orientation: 'vertical',
        position: bestX.candidate.value,
        from: bestX.candidate.from,
        to: bestX.candidate.to,
        kind: 'align',
      });
    }
    if (bestY) {
      y += bestY.delta;
      guides.push({
        orientation: 'horizontal',
        position: bestY.candidate.value,
        from: bestY.candidate.from,
        to: bestY.candidate.to,
        kind: 'align',
      });
    }
  }

  if (settings.grid.snap) {
    if (guides.every((guide) => guide.orientation !== 'vertical')) {
      x = snapToGrid(x, settings.grid.size);
    }
    if (guides.every((guide) => guide.orientation !== 'horizontal')) {
      y = snapToGrid(y, settings.grid.size);
    }
  }

  return { point: { x, y }, guides: settings.showGuides ? guides : [] };
}

export interface ConnectionTarget {
  elementId: ElementId;
  point: Point;
  index: number;
}

/** The connection point nearest to `p`, within tolerance. */
export function nearestConnectionPoint(
  doc: FlowsharkDocument,
  p: Point,
  zoom: number,
  excludeId?: ElementId,
): ConnectionTarget | null {
  const tolerance = Math.max(doc.canvas.snapTolerance * 2, 10) / Math.max(zoom, 0.01);
  let best: ConnectionTarget | null = null;
  let bestDistance = Infinity;
  for (const element of visibleElements(doc)) {
    if (!isShape(element) || element.id === excludeId || element.locked) continue;
    const definition = getShapeDefinition(element.shape);
    const points = connectionPointsFor(definition, element.frame);
    points.forEach((candidate, index) => {
      const d = Math.hypot(candidate.x - p.x, candidate.y - p.y);
      if (d <= tolerance && d < bestDistance) {
        bestDistance = d;
        best = { elementId: element.id, point: candidate, index };
      }
    });
  }
  return best;
}
