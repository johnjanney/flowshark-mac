import { describe, expect, it } from 'vitest';
import { createEmptyDocument, createShapeElement } from '../src/model/defaults';
import { addElement } from '../src/model/document';
import { nearestConnectionPoint, snapMove, snapToGrid } from '../src/canvas/snap';
import { layoutText, measuredHeight, positionLines } from '../src/text/layout';
import { defaultTextStyle } from '../src/model/defaults';

function documentWithTwoShapes() {
  const doc = createEmptyDocument();
  const anchor = createShapeElement({
    shape: 'rectangle',
    frame: { x: 100, y: 100, width: 100, height: 60 },
  });
  const moving = createShapeElement({
    shape: 'rectangle',
    frame: { x: 300, y: 300, width: 100, height: 60 },
  });
  addElement(doc, anchor);
  addElement(doc, moving);
  return { doc, anchor, moving };
}

describe('snapping', () => {
  it('rounds to the grid', () => {
    expect(snapToGrid(23, 10)).toBe(20);
    expect(snapToGrid(26, 10)).toBe(30);
    expect(snapToGrid(-4, 10)).toBe(-0);
  });

  it('snaps a moving element to a neighbour left edge and reports a guide', () => {
    const { doc, moving } = documentWithTwoShapes();
    const proposed = { x: 103, y: 300, width: 100, height: 60 };
    const result = snapMove(doc, [moving.id], proposed, 1);
    expect(result.dx).toBeCloseTo(-3, 6);
    expect(result.guides.some((guide) => guide.orientation === 'vertical')).toBe(true);
  });

  it('ignores neighbours that are out of range', () => {
    const { doc, moving } = documentWithTwoShapes();
    const result = snapMove(doc, [moving.id], { x: 400, y: 400, width: 100, height: 60 }, 1);
    expect(result.guides.filter((guide) => guide.kind === 'align')).toHaveLength(0);
  });

  it('tightens the snap distance as the canvas is zoomed in', () => {
    const { doc, moving } = documentWithTwoShapes();
    const proposed = { x: 105, y: 300, width: 100, height: 60 };
    expect(snapMove(doc, [moving.id], proposed, 1).dx).toBeCloseTo(-5, 6);
    expect(snapMove(doc, [moving.id], proposed, 4).dx).toBe(0);
  });

  it('does not snap a moving element to itself', () => {
    const doc = createEmptyDocument();
    const only = createShapeElement({
      shape: 'rectangle',
      frame: { x: 100, y: 100, width: 100, height: 60 },
    });
    addElement(doc, only);
    const result = snapMove(doc, [only.id], { x: 103, y: 103, width: 100, height: 60 }, 1);
    expect(result.guides).toHaveLength(0);
  });

  it('finds the connection point under the pointer', () => {
    const { doc, anchor } = documentWithTwoShapes();
    const found = nearestConnectionPoint(doc, { x: 200, y: 130 }, 1);
    expect(found?.elementId).toBe(anchor.id);
    expect(found?.point).toEqual({ x: 200, y: 130 });
    expect(nearestConnectionPoint(doc, { x: 800, y: 800 }, 1)).toBeNull();
  });
});

describe('text layout', () => {
  it('wraps a paragraph to the available width', () => {
    const style = defaultTextStyle();
    const single = layoutText('Approve the invoice', style, 400);
    const wrapped = layoutText('Approve the invoice', style, 60);
    expect(single.lines).toHaveLength(1);
    expect(wrapped.lines.length).toBeGreaterThan(1);
  });

  it('keeps explicit line breaks', () => {
    const layout = layoutText('one\ntwo\nthree', defaultTextStyle(), 500);
    expect(layout.lines.map((line) => line.text)).toEqual(['one', 'two', 'three']);
  });

  it('breaks a word that cannot fit', () => {
    const layout = layoutText('supercalifragilistic', defaultTextStyle(), 30);
    expect(layout.lines.length).toBeGreaterThan(1);
    expect(layout.lines.map((line) => line.text).join('')).toBe('supercalifragilistic');
  });

  it('does not wrap when wrapping is switched off', () => {
    const style = { ...defaultTextStyle(), wrap: false };
    expect(layoutText('a long line of text that will not fit', style, 20).lines).toHaveLength(1);
  });

  it('aligns lines horizontally and vertically', () => {
    const style = defaultTextStyle();
    const box = { x: 0, y: 0, width: 200, height: 100 };
    const layout = layoutText('Hello', style, 200);

    const centred = positionLines(layout, box, style);
    const left = positionLines(layout, box, { ...style, align: 'left' });
    const right = positionLines(layout, box, { ...style, align: 'right' });
    expect(left[0].x).toBe(0);
    expect(centred[0].x).toBeGreaterThan(left[0].x);
    expect(right[0].x).toBeGreaterThan(centred[0].x);

    const top = positionLines(layout, box, { ...style, verticalAlign: 'top' });
    const bottom = positionLines(layout, box, { ...style, verticalAlign: 'bottom' });
    expect(bottom[0].y).toBeGreaterThan(top[0].y);
  });

  it('reports the height a shape needs for its text', () => {
    const style = defaultTextStyle();
    const short = measuredHeight('One line', style, 200, 8);
    const long = measuredHeight('One line\ntwo lines\nthree lines', style, 200, 8);
    expect(long).toBeGreaterThan(short);
  });
});
