import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createConnectorElement, createShapeElement } from '../src/model/defaults';
import { addElement, refreshConnectorPoints, routeOf } from '../src/model/document';
import { routeConnector, simplify } from '../src/connectors/routing';
import { distanceToPolyline } from '../src/model/geometry';
import { resolveAnchor, sideForRatio } from '../src/connectors/anchors';
import { collectMarkers, markerId, markerInset, markerMarkup } from '../src/connectors/markers';
import type { FlowsharkDocument, ShapeElement } from '../src/model/types';

function twoShapes(): { doc: FlowsharkDocument; a: ShapeElement; b: ShapeElement } {
  const doc = createEmptyDocument();
  const a = createShapeElement({ shape: 'process', frame: { x: 0, y: 0, width: 100, height: 60 } });
  const b = createShapeElement({ shape: 'process', frame: { x: 300, y: 200, width: 100, height: 60 } });
  addElement(doc, a);
  addElement(doc, b);
  return { doc, a, b };
}

describe('connector routing', () => {
  it('routes an elbow connector orthogonally', () => {
    const { doc, a, b } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'fixed', index: 1 }, point: { x: 0, y: 0 } },
      target: { elementId: b.id, anchor: { mode: 'fixed', index: 3 }, point: { x: 0, y: 0 } },
      connectorKind: 'elbow',
    });
    addElement(doc, connector);
    const route = routeOf(doc, connector);

    expect(route.points.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < route.points.length - 1; i++) {
      const p = route.points[i];
      const q = route.points[i + 1];
      const horizontal = Math.abs(p.y - q.y) < 0.01;
      const vertical = Math.abs(p.x - q.x) < 0.01;
      expect(horizontal || vertical).toBe(true);
    }
    expect(route.points[0]).toEqual({ x: 100, y: 30 });
    expect(route.points[route.points.length - 1]).toEqual({ x: 300, y: 230 });
  });

  it('follows shapes when they move', () => {
    const { doc, a, b } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'floating' }, point: { x: 0, y: 0 } },
      target: { elementId: b.id, anchor: { mode: 'floating' }, point: { x: 0, y: 0 } },
    });
    addElement(doc, connector);
    const before = routeOf(doc, connector).points[0];

    (doc.elements[a.id] as ShapeElement).frame.x = 500;
    refreshConnectorPoints(doc);
    const after = routeOf(doc, connector).points[0];
    expect(after.x).not.toBe(before.x);
    expect(after.x).toBeGreaterThan(400);
  });

  it('keeps a straight connector to exactly two points', () => {
    const { doc, a, b } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'fixed', index: 1 }, point: { x: 0, y: 0 } },
      target: { elementId: b.id, anchor: { mode: 'fixed', index: 3 }, point: { x: 0, y: 0 } },
      connectorKind: 'straight',
    });
    addElement(doc, connector);
    expect(routeOf(doc, connector).points).toHaveLength(2);
  });

  it('samples a curved connector into a smooth polyline', () => {
    const { doc, a, b } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'fixed', index: 1 }, point: { x: 0, y: 0 } },
      target: { elementId: b.id, anchor: { mode: 'fixed', index: 3 }, point: { x: 0, y: 0 } },
      connectorKind: 'curved',
    });
    connector.waypoints = [{ x: 200, y: 40 }];
    addElement(doc, connector);
    const route = routeOf(doc, connector);
    expect(route.points.length).toBeGreaterThan(10);
    expect(route.d).toContain('C ');
  });

  it('honours manual waypoints', () => {
    const { doc, a, b } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'fixed', index: 1 }, point: { x: 0, y: 0 } },
      target: { elementId: b.id, anchor: { mode: 'fixed', index: 3 }, point: { x: 0, y: 0 } },
      connectorKind: 'elbow',
    });
    connector.routing = 'manual';
    connector.waypoints = [{ x: 220, y: 140 }];
    addElement(doc, connector);
    const route = routeOf(doc, connector);
    // The waypoint may be collapsed as a collinear vertex, but the drawn line
    // must still pass through it.
    expect(distanceToPolyline({ x: 220, y: 140 }, route.points)).toBeLessThan(0.01);
  });

  it('handles a connector with a free endpoint', () => {
    const { doc, a } = twoShapes();
    const connector = createConnectorElement({
      source: { elementId: a.id, anchor: { mode: 'floating' }, point: { x: 0, y: 0 } },
      target: { elementId: null, anchor: { mode: 'floating' }, point: { x: 400, y: 400 } },
      connectorKind: 'straight',
    });
    addElement(doc, connector);
    const route = routeConnector(connector, { elements: doc.elements });
    expect(route.points[route.points.length - 1]).toEqual({ x: 400, y: 400 });
  });

  it('drops collinear points', () => {
    expect(
      simplify([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toHaveLength(2);
  });
});

describe('anchors', () => {
  it('maps ratios to the nearest edge', () => {
    expect(sideForRatio({ x: 0.5, y: 0 })).toBe('top');
    expect(sideForRatio({ x: 1, y: 0.5 })).toBe('right');
    expect(sideForRatio({ x: 0.5, y: 1 })).toBe('bottom');
    expect(sideForRatio({ x: 0, y: 0.5 })).toBe('left');
  });

  it('picks the floating anchor that faces the other end', () => {
    const shape = createShapeElement({
      shape: 'process',
      frame: { x: 0, y: 0, width: 100, height: 60 },
    });
    const right = resolveAnchor(shape, { mode: 'floating' }, { x: 500, y: 30 });
    expect(right.side).toBe('right');
    const below = resolveAnchor(shape, { mode: 'floating' }, { x: 50, y: 500 });
    expect(below.side).toBe('bottom');
  });
});

describe('markers', () => {
  it('creates one definition per kind and colour', () => {
    const specs = collectMarkers([
      { style: { startMarker: 'none', endMarker: 'filled-arrow', stroke: '#000000' } },
      { style: { startMarker: 'none', endMarker: 'filled-arrow', stroke: '#000000' } },
      { style: { startMarker: 'circle', endMarker: 'filled-arrow', stroke: '#ff0000' } },
    ]);
    expect(specs).toHaveLength(3);
    expect(new Set(specs.map(markerId)).size).toBe(3);
  });

  it('produces markup with a matching id', () => {
    const spec = { kind: 'filled-arrow', color: '#123456', reverse: false } as const;
    const markup = markerMarkup(spec);
    expect(markup).toContain(`id="${markerId(spec)}"`);
    expect(markup).toContain('#123456');
  });

  it('reports no inset for the none marker', () => {
    expect(markerInset('none', 2)).toBe(0);
    expect(markerInset('filled-arrow', 2)).toBeGreaterThan(0);
  });
});
