import { describe, expect, it } from 'vitest';
import {
  SHAPE_DEFINITIONS,
  connectionPointsFor,
  getShapeDefinition,
  searchShapes,
  textBoxFor,
} from '../src/shapes/library';
import { parsePath } from '../src/io/svg-path';

/** Every shape in the brief must exist under a stable key. */
const REQUIRED_KEYS = [
  'process', 'decision', 'terminator', 'data', 'document', 'multi-document',
  'manual-input', 'manual-operation', 'preparation', 'predefined-process',
  'database', 'internal-storage', 'direct-access-storage',
  'sequential-access-storage', 'display', 'delay', 'connector',
  'off-page-connector', 'merge', 'extract', 'sort', 'collate', 'stored-data',
  'annotation', 'callout', 'swimlane', 'phase',
  'rectangle', 'rounded-rectangle', 'ellipse', 'circle', 'triangle', 'diamond',
  'hexagon', 'cylinder', 'cloud', 'star', 'line', 'arrow', 'text-box', 'image',
  'icon',
];

describe('shape library', () => {
  it('includes every required shape', () => {
    for (const key of REQUIRED_KEYS) {
      expect(SHAPE_DEFINITIONS.some((definition) => definition.key === key)).toBe(true);
    }
  });

  it('produces parsable geometry at several sizes', () => {
    for (const definition of SHAPE_DEFINITIONS) {
      for (const [w, h] of [[40, 30], [140, 80], [600, 400]] as const) {
        const geometry = definition.geometry(w, h, 8);
        expect(geometry.path.length).toBeGreaterThan(0);
        const segments = parsePath(geometry.path);
        expect(segments.length).toBeGreaterThan(1);
        for (const segment of segments) {
          if (segment.type === 'close') continue;
          expect(Number.isFinite(segment.to.x)).toBe(true);
          expect(Number.isFinite(segment.to.y)).toBe(true);
        }
        for (const decoration of geometry.decorations ?? []) {
          expect(parsePath(decoration.d).length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('places connection points inside the frame', () => {
    const frame = { x: 100, y: 50, width: 120, height: 80 };
    for (const definition of SHAPE_DEFINITIONS) {
      for (const point of connectionPointsFor(definition, frame)) {
        expect(point.x).toBeGreaterThanOrEqual(frame.x - 0.001);
        expect(point.x).toBeLessThanOrEqual(frame.x + frame.width + 0.001);
        expect(point.y).toBeGreaterThanOrEqual(frame.y - 0.001);
        expect(point.y).toBeLessThanOrEqual(frame.y + frame.height + 0.001);
      }
    }
  });

  it('keeps text boxes inside the frame', () => {
    const frame = { x: 0, y: 0, width: 200, height: 120 };
    for (const definition of SHAPE_DEFINITIONS) {
      const box = textBoxFor(definition, frame);
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.x).toBeGreaterThanOrEqual(-0.001);
      expect(box.x + box.width).toBeLessThanOrEqual(frame.width + 0.001);
      expect(box.y + box.height).toBeLessThanOrEqual(frame.height + 0.001);
    }
  });

  it('falls back to Process for an unknown key', () => {
    expect(getShapeDefinition('not-a-shape').key).toBe('process');
  });

  it('searches by name and keyword', () => {
    expect(searchShapes('diamond').some((d) => d.key === 'decision')).toBe(true);
    expect(searchShapes('data store').some((d) => d.key === 'database')).toBe(true);
    expect(searchShapes('zzzz')).toHaveLength(0);
  });
});
