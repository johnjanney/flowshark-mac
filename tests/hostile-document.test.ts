/**
 * Regression tests for documents written by someone other than the user.
 *
 * A `.flowshark` file is opened from disk, from the Finder, and from a drop on
 * the Dock icon, so every string in one is untrusted input. The scene it
 * produces is handed to `innerHTML` on screen, written into an exported `.svg`
 * that a recipient may open in a browser, and inserted into the print sheet —
 * three places where injected markup would run.
 *
 * The existing export tests build their documents from the bundled templates,
 * which never contain anything hostile, so they could not catch this.
 */

import { describe, expect, it } from 'vitest';
import { fromRaw, serializeDocument } from '../src/model/serialization';
import { createEmptyDocument } from '../src/model/defaults';
import { buildScene, type SceneOptions } from '../src/canvas/scene';
import { buildStandaloneSvg } from '../src/io/export-svg';
import { defaultExportOptions } from '../src/io/export';
import { markerId, markerMarkup } from '../src/connectors/markers';

const BREAKOUT = '" onmouseover="alert(1)';
const TAG_BREAKOUT = 'x"><image href="y" onerror="alert(1)"/><b c="';

function sceneOptions(overrides: Partial<SceneOptions> = {}): SceneOptions {
  return {
    theme: {
      background: null,
      gridLine: '#000000',
      gridLineStrong: '#000000',
      pageBoundary: '#000000',
    },
    showGrid: false,
    showPageBoundaries: false,
    interactive: true,
    accessible: true,
    ...overrides,
  };
}

function documentWith(elements: Record<string, unknown>, images: unknown = {}) {
  return fromRaw({
    schemaVersion: 1,
    layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false }],
    elements,
    order: Object.keys(elements),
    images,
  });
}

/**
 * True when the markup, once parsed, actually carries something executable.
 *
 * Checking the raw string with a regular expression is not good enough here:
 * escaped text such as `data-id="a&quot; onmouseover=&quot;…"` contains the
 * characters `onmouseover=` while being completely inert. What matters is
 * whether a parser sees a script element or an event-handler attribute, so
 * that is what this asks.
 */
function executableParts(markup: string): string[] {
  const parsed = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg">${markup}</svg>`,
    'image/svg+xml',
  );
  const found: string[] = [];
  for (const node of parsed.querySelectorAll('*')) {
    const name = node.nodeName.toLowerCase();
    if (name === 'script' || name === 'parsererror') found.push(`<${name}>`);
    for (const attribute of node.attributes) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith('on')) found.push(`${name}[${attributeName}]`);
      if (/^\s*javascript:/i.test(attribute.value)) found.push(`${name}[${attributeName}=js]`);
    }
  }
  return found;
}

function hasExecutableMarkup(markup: string): boolean {
  return executableParts(markup).length > 0;
}

describe('a document built to inject markup', () => {
  it('cannot break out of a gradient definition through its element id', () => {
    const doc = documentWith({
      a: {
        id: TAG_BREAKOUT,
        kind: 'shape',
        shape: 'process',
        layerId: 'l1',
        frame: { x: 0, y: 0, width: 100, height: 60 },
        style: { gradient: { from: '#ffffff', to: '#000000', angle: 90 } },
      },
    });
    const scene = buildScene(doc, sceneOptions());
    expect(hasExecutableMarkup(scene.defs)).toBe(false);
    expect(hasExecutableMarkup(scene.body)).toBe(false);
  });

  it('cannot break out of the fill reference that points at that gradient', () => {
    const doc = documentWith({
      a: {
        id: BREAKOUT,
        kind: 'shape',
        shape: 'process',
        layerId: 'l1',
        frame: { x: 0, y: 0, width: 100, height: 60 },
        style: { gradient: { from: '#ffffff', to: '#000000', angle: 90 } },
      },
    });
    const scene = buildScene(doc, sceneOptions());
    expect(hasExecutableMarkup(scene.body)).toBe(false);
    // The reference must still resolve to the definition it names.
    const referenced = /fill="url\(#([^)"]+)\)"/.exec(scene.body);
    expect(referenced).not.toBeNull();
    expect(scene.defs).toContain(`id="${referenced![1]}"`);
  });

  it('cannot break out of the clip path used for an embedded image', () => {
    const doc = documentWith(
      {
        a: {
          id: TAG_BREAKOUT,
          kind: 'shape',
          shape: 'image',
          layerId: 'l1',
          frame: { x: 0, y: 0, width: 100, height: 60 },
          imageRef: 'img1',
        },
      },
      { img1: { id: 'img1', mimeType: 'image/png', data: 'AAAA', width: 4, height: 4 } },
    );
    const scene = buildScene(doc, sceneOptions());
    expect(hasExecutableMarkup(scene.defs)).toBe(false);
    expect(hasExecutableMarkup(scene.body)).toBe(false);
    const referenced = /clip-path="url\(#([^)"]+)\)"/.exec(scene.body);
    expect(referenced).not.toBeNull();
    expect(scene.defs).toContain(`id="${referenced![1]}"`);
  });

  it('cannot break out of a connector marker through its stroke colour', () => {
    const doc = documentWith({
      c: {
        id: 'c',
        kind: 'connector',
        layerId: 'l1',
        source: { point: { x: 0, y: 0 } },
        target: { point: { x: 80, y: 80 } },
        style: { stroke: TAG_BREAKOUT, endMarker: 'arrow', startMarker: 'circle' },
      },
    });
    const scene = buildScene(doc, sceneOptions());
    expect(hasExecutableMarkup(scene.defs)).toBe(false);
    expect(hasExecutableMarkup(scene.body)).toBe(false);
  });

  it('produces an exported SVG with no scripts or event handlers', () => {
    const doc = documentWith({
      a: {
        id: TAG_BREAKOUT,
        kind: 'shape',
        shape: 'process',
        layerId: 'l1',
        name: TAG_BREAKOUT,
        altText: TAG_BREAKOUT,
        frame: { x: 0, y: 0, width: 100, height: 60 },
        text: { value: TAG_BREAKOUT },
        style: { gradient: { from: BREAKOUT, to: '#000000', angle: 45 }, stroke: BREAKOUT },
      },
      c: {
        id: BREAKOUT,
        kind: 'connector',
        layerId: 'l1',
        source: { point: { x: 0, y: 0 } },
        target: { point: { x: 80, y: 80 } },
        style: { stroke: TAG_BREAKOUT, endMarker: 'filled-arrow' },
        labels: [{ id: TAG_BREAKOUT, text: TAG_BREAKOUT, background: BREAKOUT, border: BREAKOUT }],
      },
    });
    const { svg } = buildStandaloneSvg(doc, defaultExportOptions(), []);
    const parsed = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(parsed.querySelector('parsererror')).toBeNull();
    const offenders: string[] = [];
    for (const node of parsed.querySelectorAll('*')) {
      if (node.nodeName.toLowerCase() === 'script') offenders.push('script');
      for (const attribute of node.attributes) {
        if (attribute.name.toLowerCase().startsWith('on')) offenders.push(attribute.name);
        if (/^\s*javascript:/i.test(attribute.value)) offenders.push(attribute.value);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps two elements from sharing one gradient', () => {
    // Two ids that a "strip the offending characters" scheme would collapse
    // onto the same name.
    const doc = documentWith({
      a: {
        id: 'a.b',
        kind: 'shape',
        shape: 'process',
        layerId: 'l1',
        frame: { x: 0, y: 0, width: 100, height: 60 },
        style: { gradient: { from: '#ff0000', to: '#000000', angle: 0 } },
      },
      b: {
        id: 'a-b',
        kind: 'shape',
        shape: 'process',
        layerId: 'l1',
        frame: { x: 200, y: 0, width: 100, height: 60 },
        style: { gradient: { from: '#00ff00', to: '#000000', angle: 0 } },
      },
    });
    const scene = buildScene(doc, sceneOptions());
    const ids = [...scene.defs.matchAll(/<linearGradient id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('gives two scenes in the same page different definition names', () => {
    // The canvas, a print sheet, and every template preview can be in the DOM
    // at once, and `url(#…)` resolves across the whole document. If two scenes
    // both named a gradient `fs-grad-1`, one would silently paint with the
    // other's colours.
    const build = () => {
      const doc = documentWith({
        a: {
          id: 'a',
          kind: 'shape',
          shape: 'process',
          layerId: 'l1',
          frame: { x: 0, y: 0, width: 100, height: 60 },
          style: { gradient: { from: '#ff0000', to: '#000000', angle: 0 } },
        },
      });
      const scene = buildScene(doc, sceneOptions());
      return /<linearGradient id="([^"]+)"/.exec(scene.defs)![1];
    };
    expect(build()).not.toBe(build());
  });

  it('keeps two colours from sharing one marker', () => {
    // Stripping punctuation would map both of these onto "fs-marker-arrow-ff0000".
    const withHash = markerId({ kind: 'arrow', color: '#ff0000', reverse: false });
    const withoutHash = markerId({ kind: 'arrow', color: 'ff0000', reverse: false });
    expect(withHash).not.toBe(withoutHash);
    expect(markerMarkup({ kind: 'arrow', color: '#ff0000', reverse: false })).toContain(withHash);
  });
});

describe('embedded images in a document', () => {
  it('refuses SVG, which FlowShark does not import and cannot sanitise', () => {
    const doc = documentWith(
      {},
      {
        good: { id: 'good', mimeType: 'image/png', data: 'AAAA', width: 1, height: 1 },
        bad: {
          id: 'bad',
          mimeType: 'image/svg+xml',
          data: 'PHN2Zz48c2NyaXB0PmFsZXJ0KDEpPC9zY3JpcHQ+PC9zdmc+',
          width: 1,
          height: 1,
        },
      },
    );
    expect(Object.keys(doc.images)).toEqual(['good']);
  });

  it('drops a payload that is not base64', () => {
    const doc = documentWith(
      {},
      { bad: { id: 'bad', mimeType: 'image/png', data: '"><script>', width: 1, height: 1 } },
    );
    expect(doc.images).toEqual({});
  });

  it('leaves a picture out of the saved file once nothing shows it', () => {
    const doc = documentWith(
      {
        a: {
          id: 'a',
          kind: 'shape',
          shape: 'image',
          layerId: 'l1',
          frame: { x: 0, y: 0, width: 10, height: 10 },
          imageRef: 'used',
        },
      },
      {
        used: { id: 'used', mimeType: 'image/png', data: 'AAAA', width: 1, height: 1 },
        orphan: { id: 'orphan', mimeType: 'image/png', data: 'BBBB', width: 1, height: 1 },
      },
    );
    const saved = JSON.parse(serializeDocument(doc)) as { images: Record<string, unknown> };
    expect(Object.keys(saved.images)).toEqual(['used']);
    // Serialising must not disturb the document itself, or undoing a delete
    // after a save would come back without its picture.
    expect(Object.keys(doc.images).sort()).toEqual(['orphan', 'used']);
  });
});

describe('style presets in a document', () => {
  it('keeps only the properties a preset actually sets', () => {
    const doc = fromRaw({
      schemaVersion: 1,
      presets: [
        { id: 'p1', name: 'Mine', shape: { fill: '#ff0000' }, text: {}, connector: {} },
      ],
    });
    expect(doc.presets[0].shape).toEqual({ fill: '#ff0000' });
    expect(doc.presets[0].text).toEqual({});
    expect(doc.presets[0].connector).toEqual({});
  });

  it('replaces values of the wrong type and drops keys that mean nothing', () => {
    // A preset is spread straight into an element's style when it is applied,
    // so it has to be type-checked on the way in like everything else.
    const doc = fromRaw({
      schemaVersion: 1,
      presets: [
        {
          id: 'p1',
          name: 'Broken',
          shape: { strokeWidth: 'wide', strokeStyle: 'squiggly', nonsense: 1 },
          text: { fontSize: null },
          connector: { endMarker: 'harpoon' },
        },
      ],
    });
    const preset = doc.presets[0];
    expect(typeof preset.shape.strokeWidth).toBe('number');
    expect(['solid', 'dashed', 'dotted']).toContain(preset.shape.strokeStyle);
    expect('nonsense' in preset.shape).toBe(false);
    expect(typeof preset.text.fontSize).toBe('number');
    expect(preset.connector.endMarker).not.toBe('harpoon');
  });

  it('round-trips the built-in presets unchanged', () => {
    const original = createEmptyDocument();
    const reloaded = fromRaw(JSON.parse(serializeDocument(original)));
    expect(reloaded.presets).toEqual(original.presets);
  });
});
