import { describe, expect, it } from 'vitest';
import { Store } from '../src/state/store';
import { createEmptyDocument } from '../src/model/defaults';
import {
  addShape,
  alignSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  matchSize,
  nudgeSelection,
  orderSelection,
  ungroupSelection,
  updateShapeStyle,
} from '../src/commands/actions';
import { getTemplate } from '../src/templates';
import { isShape, type ShapeElement } from '../src/model/types';
import { HISTORY_LIMIT } from '../src/commands/history';

function shape(store: Store, id: string): ShapeElement {
  const element = store.document.elements[id];
  if (!isShape(element)) throw new Error('expected a shape');
  return element;
}

describe('undo and redo', () => {
  it('restores a deleted element', () => {
    const store = new Store(createEmptyDocument());
    const element = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    expect(Object.keys(store.document.elements)).toHaveLength(1);

    deleteSelection(store);
    expect(Object.keys(store.document.elements)).toHaveLength(0);

    store.undo();
    expect(Object.keys(store.document.elements)).toHaveLength(1);
    expect(store.document.elements[element.id]).toBeDefined();

    store.redo();
    expect(Object.keys(store.document.elements)).toHaveLength(0);
  });

  it('restores geometry after a move', () => {
    const store = new Store(createEmptyDocument());
    const element = addShape(store, 'process', { at: { x: 10, y: 20 } })!;
    nudgeSelection(store, 50, 30);
    expect(shape(store, element.id).frame.x).toBe(60);
    store.undo();
    expect(shape(store, element.id).frame.x).toBe(10);
    expect(shape(store, element.id).frame.y).toBe(20);
  });

  it('merges rapid nudges into one undo step', () => {
    const store = new Store(createEmptyDocument());
    const element = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    nudgeSelection(store, 1, 0);
    nudgeSelection(store, 1, 0);
    nudgeSelection(store, 1, 0);
    expect(shape(store, element.id).frame.x).toBe(3);
    store.undo();
    expect(shape(store, element.id).frame.x).toBe(0);
  });

  it('restores styles', () => {
    const store = new Store(createEmptyDocument());
    const element = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    const original = shape(store, element.id).style.fill;
    updateShapeStyle(store, { fill: '#123456' });
    expect(shape(store, element.id).style.fill).toBe('#123456');
    store.undo();
    expect(shape(store, element.id).style.fill).toBe(original);
  });

  it('restores z-order', () => {
    const store = new Store(createEmptyDocument());
    const a = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    const b = addShape(store, 'process', { at: { x: 200, y: 0 } })!;
    expect(store.document.order).toEqual([a.id, b.id]);
    store.setSelection([a.id]);
    orderSelection(store, 'front');
    expect(store.document.order).toEqual([b.id, a.id]);
    store.undo();
    expect(store.document.order).toEqual([a.id, b.id]);
  });

  it('restores grouping', () => {
    const store = new Store(createEmptyDocument());
    const a = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    const b = addShape(store, 'process', { at: { x: 200, y: 0 } })!;
    store.setSelection([a.id, b.id]);
    groupSelection(store);
    expect(store.selection).toHaveLength(1);
    const groupId = store.selection[0];
    expect(store.document.elements[groupId].kind).toBe('group');

    ungroupSelection(store);
    expect(store.document.elements[groupId]).toBeUndefined();
    store.undo();
    expect(store.document.elements[groupId]).toBeDefined();
  });

  it('undoes a document-wide template edit', () => {
    const store = new Store(getTemplate('basic-flowchart')!.build());
    const count = Object.keys(store.document.elements).length;
    store.setSelection(store.document.order.slice(0, 3));
    deleteSelection(store);
    expect(Object.keys(store.document.elements).length).toBeLessThan(count);
    store.undo();
    expect(Object.keys(store.document.elements).length).toBe(count);
  });

  it('caps the history at the documented limit', () => {
    const store = new Store(createEmptyDocument());
    addShape(store, 'process', { at: { x: 0, y: 0 } });
    for (let i = 0; i < HISTORY_LIMIT + 40; i++) {
      updateShapeStyle(store, { strokeWidth: 1 + (i % 7) }, `Change ${i}`);
      store.history.breakCoalescing();
    }
    let undone = 0;
    while (store.undo()) undone += 1;
    expect(undone).toBeLessThanOrEqual(HISTORY_LIMIT);
    expect(undone).toBeGreaterThan(100);
  });

  it('reports whether undo and redo are available', () => {
    const store = new Store(createEmptyDocument());
    expect(store.history.canUndo).toBe(false);
    addShape(store, 'process', { at: { x: 0, y: 0 } });
    expect(store.history.canUndo).toBe(true);
    expect(store.history.canRedo).toBe(false);
    store.undo();
    expect(store.history.canRedo).toBe(true);
  });
});

describe('layout commands', () => {
  it('aligns left edges', () => {
    const store = new Store(createEmptyDocument());
    const a = addShape(store, 'rectangle', { at: { x: 0, y: 0 }, size: { width: 50, height: 50 } })!;
    const b = addShape(store, 'rectangle', { at: { x: 90, y: 80 }, size: { width: 50, height: 50 } })!;
    store.setSelection([a.id, b.id]);
    alignSelection(store, 'left');
    expect(shape(store, b.id).frame.x).toBe(0);
    expect(shape(store, a.id).frame.x).toBe(0);
  });

  it('centres elements vertically', () => {
    const store = new Store(createEmptyDocument());
    const a = addShape(store, 'rectangle', { at: { x: 0, y: 0 }, size: { width: 50, height: 50 } })!;
    const b = addShape(store, 'rectangle', { at: { x: 90, y: 100 }, size: { width: 50, height: 20 } })!;
    store.setSelection([a.id, b.id]);
    alignSelection(store, 'center-v');
    const centreA = shape(store, a.id).frame.y + shape(store, a.id).frame.height / 2;
    const centreB = shape(store, b.id).frame.y + shape(store, b.id).frame.height / 2;
    expect(centreA).toBeCloseTo(centreB, 6);
  });

  it('distributes three elements with equal gaps', () => {
    const store = new Store(createEmptyDocument());
    const size = { width: 40, height: 40 };
    const a = addShape(store, 'rectangle', { at: { x: 0, y: 0 }, size })!;
    const b = addShape(store, 'rectangle', { at: { x: 55, y: 0 }, size })!;
    const c = addShape(store, 'rectangle', { at: { x: 240, y: 0 }, size })!;
    store.setSelection([a.id, b.id, c.id]);
    distributeSelection(store, 'horizontal-gaps');

    const gap1 = shape(store, b.id).frame.x - (shape(store, a.id).frame.x + 40);
    const gap2 = shape(store, c.id).frame.x - (shape(store, b.id).frame.x + 40);
    expect(gap1).toBeCloseTo(gap2, 6);
    expect(shape(store, a.id).frame.x).toBe(0);
    expect(shape(store, c.id).frame.x).toBe(240);
  });

  it('matches sizes against the last selected element', () => {
    const store = new Store(createEmptyDocument());
    const a = addShape(store, 'rectangle', { at: { x: 0, y: 0 }, size: { width: 50, height: 50 } })!;
    const b = addShape(store, 'rectangle', { at: { x: 90, y: 0 }, size: { width: 130, height: 70 } })!;
    store.setSelection([a.id, b.id]);
    matchSize(store, 'both');
    expect(shape(store, a.id).frame.width).toBe(130);
    expect(shape(store, a.id).frame.height).toBe(70);
  });

  it('duplicates a selection with its connectors intact', () => {
    const store = new Store(getTemplate('basic-flowchart')!.build());
    const count = Object.keys(store.document.elements).length;
    store.setSelection(store.document.order);
    duplicateSelection(store);
    expect(Object.keys(store.document.elements).length).toBe(count * 2);
    store.undo();
    expect(Object.keys(store.document.elements).length).toBe(count);
  });
});
