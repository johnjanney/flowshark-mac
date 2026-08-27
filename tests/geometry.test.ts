import { describe, expect, it } from 'vitest';
import {
  closestPointOnSegment,
  distanceToPolyline,
  pointAlongPolyline,
  rectFromPoints,
  rectIntersects,
  rotatePoint,
  rotatedBounds,
  tangentAlongPolyline,
  unionRects,
} from '../src/model/geometry';

describe('geometry', () => {
  it('builds a rectangle from two corners in any order', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 4, y: 2 })).toEqual({
      x: 4,
      y: 2,
      width: 6,
      height: 18,
    });
  });

  it('detects rectangle overlap', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectIntersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(rectIntersects(a, { x: 20, y: 0, width: 5, height: 5 })).toBe(false);
  });

  it('unions rectangles', () => {
    expect(
      unionRects([
        { x: 0, y: 0, width: 10, height: 10 },
        { x: 20, y: -5, width: 10, height: 10 },
      ]),
    ).toEqual({ x: 0, y: -5, width: 30, height: 15 });
  });

  it('rotates a point clockwise about an origin', () => {
    const result = rotatePoint({ x: 1, y: 0 }, { x: 0, y: 0 }, 90);
    expect(result.x).toBeCloseTo(0, 6);
    expect(result.y).toBeCloseTo(1, 6);
  });

  it('computes the bounds of a rotated rectangle', () => {
    const bounds = rotatedBounds({ x: 0, y: 0, width: 10, height: 10 }, 45);
    expect(bounds.width).toBeCloseTo(Math.SQRT2 * 10, 4);
    expect(bounds.height).toBeCloseTo(Math.SQRT2 * 10, 4);
  });

  it('finds the closest point on a segment, clamped to the ends', () => {
    expect(closestPointOnSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      x: 5,
      y: 0,
    });
    expect(closestPointOnSegment({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });

  it('measures distance to a polyline', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(distanceToPolyline({ x: 5, y: 3 }, line)).toBeCloseTo(3, 6);
    expect(distanceToPolyline({ x: 13, y: 5 }, line)).toBeCloseTo(3, 6);
  });

  it('walks along a polyline and reports its tangent', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    const midpoint = pointAlongPolyline(line, 0.5);
    expect(midpoint).toEqual({ x: 10, y: 0 });
    expect(tangentAlongPolyline(line, 0.9)).toEqual({ x: 0, y: 1 });
  });
});
