import { describe, expect, it } from 'vitest';
import { getTemplate } from '../src/templates';
import { buildStandaloneSvg } from '../src/io/export-svg';
import {
  defaultExportOptions,
  expandExportSelection,
  exportRegion,
} from '../src/io/export';
import { boundsOf } from '../src/model/document';
import { exportVectorPdf } from '../src/io/export-pdf';
import { isWinAnsiSafe, pdfColor, pdfString } from '../src/io/pdf-writer';
import { parsePath, trimSegments } from '../src/io/svg-path';
import { buildScene, escapeXml } from '../src/canvas/scene';
import {
  createConnectorElement,
  createEmptyDocument,
  createShapeElement,
  defaultLabelTextStyle,
} from '../src/model/defaults';
import { addElement } from '../src/model/document';

const decoder = new TextDecoder('latin1');

describe('SVG export', () => {
  it('produces a standalone document with a viewBox', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const { svg, region } = buildStandaloneSvg(doc, defaultExportOptions(), []);
    expect(svg.startsWith('<?xml')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(`viewBox="${region.x} ${region.y} ${region.width} ${region.height}"`);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
  });

  it('contains no script or event handlers', () => {
    const doc = getTemplate('software-logic')!.build();
    const { svg } = buildStandaloneSvg(doc, defaultExportOptions(), []);
    expect(svg).not.toMatch(/<script/i);
    expect(svg).not.toMatch(/\son[a-z]+=/i);
    expect(svg).not.toContain('javascript:');
  });

  it('omits the background when transparency is requested', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const opaque = buildStandaloneSvg(doc, defaultExportOptions(), []).svg;
    const transparent = buildStandaloneSvg(
      doc,
      { ...defaultExportOptions(), transparent: true },
      [],
    ).svg;
    expect(opaque).toContain('fill="#ffffff"');
    expect(transparent.length).toBeLessThan(opaque.length);
  });

  it('exports only the selection when asked', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const one = doc.order[0];
    const all = buildStandaloneSvg(doc, defaultExportOptions(), []).svg;
    const some = buildStandaloneSvg(
      doc,
      { ...defaultExportOptions(), scope: 'selection' },
      [one],
    ).svg;
    expect(some.length).toBeLessThan(all.length);
  });

  it('keeps the connector between two selected shapes', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const connector = Object.values(doc.elements).find(
      (element) => element.kind === 'connector',
    );
    if (!connector || connector.kind !== 'connector') throw new Error('no connector');
    const shapes = [connector.source.elementId!, connector.target.elementId!];

    const expanded = expandExportSelection(doc, shapes);
    expect(expanded.has(connector.id)).toBe(true);

    // The region has to grow to hold the connector, not just the two shapes.
    const withConnector = exportRegion(
      doc,
      { ...defaultExportOptions(), scope: 'selection' },
      shapes,
    );
    const shapesOnly = boundsOf(doc, shapes)!;
    expect(withConnector.height).toBeGreaterThanOrEqual(shapesOnly.height);
  });

  it('excludes a connector when only one of its ends is selected', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const connector = Object.values(doc.elements).find(
      (element) => element.kind === 'connector',
    );
    if (!connector || connector.kind !== 'connector') throw new Error('no connector');
    const expanded = expandExportSelection(doc, [connector.source.elementId!]);
    expect(expanded.has(connector.id)).toBe(false);
  });

  it('escapes user text so it cannot inject markup', () => {
    const doc = createEmptyDocument();
    addElement(
      doc,
      createShapeElement({
        shape: 'process',
        frame: { x: 0, y: 0, width: 100, height: 60 },
        text: '</text><script>alert(1)</script>',
      }),
    );
    const { svg } = buildStandaloneSvg(doc, defaultExportOptions(), []);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;');
  });

  it('escapes the five XML metacharacters', () => {
    expect(escapeXml(`<&>"'`)).toBe('&lt;&amp;&gt;&quot;&apos;');
  });

  it('adds the requested margin to the region', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const tight = exportRegion(doc, { ...defaultExportOptions(), margin: 10 }, []);
    const loose = exportRegion(doc, { ...defaultExportOptions(), margin: 50 }, []);
    expect(loose.width).toBeCloseTo(tight.width + 80, 4);
    expect(loose.height).toBeCloseTo(tight.height + 80, 4);
  });
});

describe('PDF export', () => {
  it('writes a well-formed PDF', () => {
    const doc = getTemplate('process-map')!.build();
    const bytes = exportVectorPdf(doc, defaultExportOptions(), []);
    const text = decoder.decode(bytes);
    expect(text.startsWith('%PDF-1.7')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Type /Pages');
    expect(text).toContain('/Type /Page');
    expect(text).toContain('startxref');
  });

  it('records cross-reference offsets that point at real objects', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const bytes = exportVectorPdf(doc, defaultExportOptions(), []);
    const text = decoder.decode(bytes);
    const xrefIndex = text.lastIndexOf('\nxref\n') + 1;
    const startxref = Number(/startxref\s+(\d+)/.exec(text)![1]);
    expect(startxref).toBe(xrefIndex);

    const entries = text
      .slice(xrefIndex)
      .split('\n')
      .filter((line) => /^\d{10} \d{5} n $/.test(line));
    expect(entries.length).toBeGreaterThan(3);
    for (const [index, entry] of entries.entries()) {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    }
  });

  it('sizes the page to the export region', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const options = defaultExportOptions();
    const region = exportRegion(doc, options, []);
    const text = decoder.decode(exportVectorPdf(doc, options, []));
    const media = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text)!;
    expect(Number(media[1])).toBeCloseTo(region.width, 1);
    expect(Number(media[2])).toBeCloseTo(region.height, 1);
  });

  it('embeds text as selectable content', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const text = decoder.decode(exportVectorPdf(doc, defaultExportOptions(), []));
    expect(text).toContain('/Type /Font');
    expect(text).toContain('/WinAnsiEncoding');
    expect(text).toContain('(Start) Tj');
  });

  it('draws a connector label border in the label\u2019s own colour', () => {
    // The connector's stroke colour is still the current one when the label
    // box is drawn, so a bordered label used to be outlined in the line's
    // colour instead of its own.
    const doc = createEmptyDocument();
    const from = createShapeElement({ shape: 'process', frame: { x: 0, y: 0, width: 80, height: 40 } });
    const to = createShapeElement({ shape: 'process', frame: { x: 300, y: 0, width: 80, height: 40 } });
    addElement(doc, from);
    addElement(doc, to);
    const connector = createConnectorElement({
      source: { elementId: from.id, anchor: { mode: 'floating' }, point: { x: 0, y: 0 } },
      target: { elementId: to.id, anchor: { mode: 'floating' }, point: { x: 0, y: 0 } },
    });
    connector.style.stroke = '#ff0000';
    connector.labels = [
      {
        id: 'label_1',
        text: 'Yes',
        style: defaultLabelTextStyle(),
        position: 0.5,
        offset: 0,
        background: '#ffffff',
        border: '#0000ff',
      },
    ];
    addElement(doc, connector);

    const text = decoder.decode(exportVectorPdf(doc, defaultExportOptions(), []));
    const boxIndex = text.search(/-?[\d.]+ -?[\d.]+ -?[\d.]+ -?[\d.]+ re B/);
    expect(boxIndex).toBeGreaterThan(-1);
    // The last stroke colour set before the bordered box must be the border's
    // blue, not the connector's red.
    const strokes = [...text.slice(0, boxIndex).matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) RG/g)];
    const last = strokes[strokes.length - 1];
    expect(last).toBeDefined();
    expect([Number(last[1]), Number(last[2]), Number(last[3])]).toEqual([0, 0, 1]);
  });
});

describe('PDF primitives', () => {
  it('escapes PDF string delimiters', () => {
    expect(pdfString('a(b)c\\d')).toBe('(a\\(b\\)c\\\\d)');
  });

  it('maps common punctuation into WinAnsi', () => {
    expect(isWinAnsiSafe('Café — "quoted"')).toBe(true);
    expect(isWinAnsiSafe('你好')).toBe(false);
  });

  it('parses hex colours', () => {
    expect(pdfColor('#ffffff')).toEqual([1, 1, 1]);
    expect(pdfColor('#000')).toEqual([0, 0, 0]);
    const [r, g, b] = pdfColor('#336699');
    expect(r).toBeCloseTo(0.2, 2);
    expect(g).toBeCloseTo(0.4, 2);
    expect(b).toBeCloseTo(0.6, 2);
  });
});

describe('SVG path parsing', () => {
  it('converts an arc to cubic segments that end at the right point', () => {
    const segments = parsePath('M 0 10 A 10 10 0 0 1 20 10');
    expect(segments[0].type).toBe('move');
    const last = segments[segments.length - 1];
    expect(last.type).toBe('cubic');
    if (last.type !== 'cubic') return;
    expect(last.to.x).toBeCloseTo(20, 3);
    expect(last.to.y).toBeCloseTo(10, 3);
  });

  it('elevates a quadratic to a cubic', () => {
    const segments = parsePath('M 0 0 Q 5 10 10 0');
    expect(segments[1].type).toBe('cubic');
  });

  it('handles relative commands and implicit line-to repetition', () => {
    const segments = parsePath('m 10 10 l 5 0 5 0 z');
    expect(segments).toHaveLength(4);
    const second = segments[2];
    if (second.type !== 'line') throw new Error('expected a line');
    expect(second.to).toEqual({ x: 20, y: 10 });
  });
});

describe('path trimming', () => {
  it('shortens a straight path at both ends', () => {
    const segments = trimSegments(parsePath('M 0 0 L 100 0'), 10, 20);
    expect(segments[0]).toEqual({ type: 'move', to: { x: 10, y: 0 } });
    expect(segments[1]).toEqual({ type: 'line', to: { x: 80, y: 0 } });
  });

  it('drops whole segments the trim swallows', () => {
    const segments = trimSegments(parsePath('M 0 0 L 50 0 L 100 0'), 60, 10);
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ type: 'move', to: { x: 60, y: 0 } });
    expect(segments[1]).toEqual({ type: 'line', to: { x: 90, y: 0 } });
  });

  it('keeps a curve a curve', () => {
    const segments = trimSegments(parsePath('M 0 0 C 40 0 60 100 100 100'), 10, 10);
    expect(segments).toHaveLength(2);
    expect(segments[1].type).toBe('cubic');
    const start = segments[0];
    if (start.type !== 'move') throw new Error('expected a move');
    // Roughly ten points along the curve, not ten points along the chord.
    expect(Math.hypot(start.to.x, start.to.y)).toBeGreaterThan(8);
    expect(Math.hypot(start.to.x, start.to.y)).toBeLessThan(11);
  });

  it('leaves a path alone when there is nothing to trim', () => {
    const original = parsePath('M 0 0 L 100 0');
    expect(trimSegments(original, 0, 0)).toEqual(original);
  });

  it('survives a trim longer than the path', () => {
    const segments = trimSegments(parsePath('M 0 0 L 100 0'), 200, 0);
    expect(segments).toEqual([{ type: 'move', to: { x: 100, y: 0 } }]);
  });
});

describe('interactive scene', () => {
  const sceneOptions = (interactive: boolean) => ({
    theme: {
      background: '#ffffff',
      gridLine: '#eeeeee',
      gridLineStrong: '#dddddd',
      pageBoundary: '#cccccc',
    },
    showGrid: false,
    showPageBoundaries: false,
    interactive,
    accessible: false,
  });

  /**
   * A text box has neither a fill nor a border, so without a hit area of its
   * own there is nothing on screen for a click to land on and it can neither
   * be selected nor double-clicked to edit.
   */
  it('gives an unfilled, unstroked shape something to hit', () => {
    const doc = createEmptyDocument();
    const box = createShapeElement({
      shape: 'text-box',
      frame: { x: 0, y: 0, width: 160, height: 44 },
      text: 'Caption',
      style: { fill: 'none', stroke: 'none' },
      layerId: doc.layers[0].id,
    });
    addElement(doc, box);

    const scene = buildScene(doc, sceneOptions(true));
    expect(scene.body).toContain('class="fs-shape-hit"');
    expect(scene.body).toContain('fill="transparent"');
    expect(scene.body).toContain('stroke="transparent"');
  });

  it('gives every shape a hit area, whatever its style', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const scene = buildScene(doc, sceneOptions(true));
    const shapes = doc.order.filter((id) => doc.elements[id].kind === 'shape').length;
    expect(scene.body.match(/class="fs-shape-hit"/g)).toHaveLength(shapes);
  });

  it('leaves the hit areas out of exports', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const scene = buildScene(doc, sceneOptions(false));
    expect(scene.body).not.toContain('fs-shape-hit');
  });
});
