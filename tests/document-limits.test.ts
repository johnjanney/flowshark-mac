/**
 * Budgets a document has to fit inside.
 *
 * The native layer caps the file at 256 MB, which bounds nothing that matters:
 * JSON expands into an object graph several times its size, and every element
 * then becomes SVG markup, a history snapshot, and a serialised copy. These
 * tests hold the line at each boundary the reader now enforces, and check that
 * a document that is merely large still opens.
 */

import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_LIMITS,
  DocumentFormatError,
  fromRaw,
} from '../src/model/serialization';
import { detectImageType } from '../src/io/import';

const PNG_4x4 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR42mO4Y2PzHxkzkC4AAO2YJTHTor4nAAAAAElFTkSuQmCC';

function shape(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: 'shape',
    shape: 'process',
    layerId: 'l1',
    frame: { x: 0, y: 0, width: 100, height: 60 },
    ...extra,
  };
}

function documentWith(raw: Record<string, unknown>) {
  return fromRaw({
    schemaVersion: 1,
    layers: [{ id: 'l1', name: 'Layer 1', visible: true, locked: false }],
    ...raw,
  });
}

describe('structural budgets', () => {
  it('refuses a document with too many layers', () => {
    const layers = Array.from({ length: DOCUMENT_LIMITS.layers + 1 }, (_, i) => ({
      id: `l${i}`,
      name: `Layer ${i}`,
      visible: true,
      locked: false,
    }));
    expect(() => fromRaw({ schemaVersion: 1, layers })).toThrow(DocumentFormatError);
  });

  it('refuses a document with too many style presets', () => {
    const presets = Array.from({ length: DOCUMENT_LIMITS.presets + 1 }, (_, i) => ({
      id: `p${i}`,
      name: `Preset ${i}`,
      shape: {},
      text: {},
      connector: {},
    }));
    expect(() => documentWith({ presets })).toThrow(DocumentFormatError);
  });

  it('refuses a connector carrying an absurd number of waypoints', () => {
    const waypoints = Array.from(
      { length: DOCUMENT_LIMITS.waypointsPerConnector + 1 },
      () => ({ x: 0, y: 0 }),
    );
    expect(() =>
      documentWith({
        elements: {
          c: {
            id: 'c',
            kind: 'connector',
            layerId: 'l1',
            source: { point: { x: 0, y: 0 } },
            target: { point: { x: 1, y: 1 } },
            waypoints,
          },
        },
      }),
    ).toThrow(DocumentFormatError);
  });

  it('refuses a connector carrying an absurd number of labels', () => {
    const labels = Array.from({ length: DOCUMENT_LIMITS.labelsPerConnector + 1 }, () => ({
      text: 'x',
    }));
    expect(() =>
      documentWith({
        elements: {
          c: {
            id: 'c',
            kind: 'connector',
            layerId: 'l1',
            source: { point: { x: 0, y: 0 } },
            target: { point: { x: 1, y: 1 } },
            labels,
          },
        },
      }),
    ).toThrow(DocumentFormatError);
  });

  it('says what was over budget, so the message is actionable', () => {
    const layers = Array.from({ length: DOCUMENT_LIMITS.layers + 1 }, (_, i) => ({
      id: `l${i}`,
    }));
    try {
      fromRaw({ schemaVersion: 1, layers });
      throw new Error('expected the document to be refused');
    } catch (error) {
      expect(error).toBeInstanceOf(DocumentFormatError);
      const detail = (error as DocumentFormatError).detail;
      expect(detail).toContain('layers');
      expect(detail).toContain(DOCUMENT_LIMITS.layers.toLocaleString());
    }
  });

  it('still opens a document that is large but within budget', () => {
    const elements: Record<string, unknown> = {};
    for (let i = 0; i < 2_000; i++) elements[`e${i}`] = shape(`e${i}`);
    const doc = documentWith({ elements });
    expect(Object.keys(doc.elements)).toHaveLength(2_000);
  });
});

describe('numeric clamping', () => {
  it('holds coordinates and sizes inside a range a renderer can draw', () => {
    const doc = documentWith({
      elements: {
        a: shape('a', {
          frame: { x: 1e300, y: -1e300, width: 1e308, height: Number.MAX_VALUE },
          rotation: 1e12,
        }),
      },
    });
    const element = doc.elements.a;
    expect(element.kind).toBe('shape');
    if (element.kind !== 'shape') return;
    for (const value of [
      element.frame.x,
      element.frame.y,
      element.frame.width,
      element.frame.height,
      element.rotation,
    ]) {
      expect(Number.isFinite(value)).toBe(true);
      expect(Math.abs(value)).toBeLessThanOrEqual(1e7);
    }
  });

  it('holds font size, stroke width, and opacity inside sane ranges', () => {
    const doc = documentWith({
      elements: {
        a: shape('a', {
          style: { strokeWidth: 1e9, opacity: 500, fillOpacity: -20 },
          text: { value: 'x', style: { fontSize: 1e9, fontWeight: 1e9 } },
        }),
      },
    });
    const element = doc.elements.a;
    if (element.kind !== 'shape') throw new Error('expected a shape');
    expect(element.style.strokeWidth).toBeLessThanOrEqual(10_000);
    expect(element.style.opacity).toBeLessThanOrEqual(1);
    expect(element.style.fillOpacity).toBeGreaterThanOrEqual(0);
    expect(element.text.style.fontSize).toBeLessThanOrEqual(4_000);
  });

  it('truncates a text field rather than laying out a megabyte of it', () => {
    const doc = documentWith({
      elements: {
        a: shape('a', { text: { value: 'x'.repeat(DOCUMENT_LIMITS.textLength * 2) } }),
      },
    });
    const element = doc.elements.a;
    if (element.kind !== 'shape') throw new Error('expected a shape');
    expect(element.text.value).toHaveLength(DOCUMENT_LIMITS.textLength);
  });
});

describe('embedded image budgets', () => {
  it('refuses a document with too many image records', () => {
    const images: Record<string, unknown> = {};
    for (let i = 0; i <= DOCUMENT_LIMITS.images; i++) {
      images[`i${i}`] = { id: `i${i}`, mimeType: 'image/png', data: PNG_4x4 };
    }
    expect(() => documentWith({ images })).toThrow(DocumentFormatError);
  });

  it('refuses an image whose declared pixel count is absurd', () => {
    expect(() =>
      documentWith({
        images: {
          big: {
            id: 'big',
            mimeType: 'image/png',
            data: PNG_4x4,
            width: 500_000,
            height: 500_000,
          },
        },
      }),
    ).toThrow(DocumentFormatError);
  });

  it('measures a payload without decoding it', () => {
    // A payload over the per-image budget is refused, and refusing it must not
    // require allocating the buffer the budget exists to prevent.
    const encodedLength = Math.ceil((DOCUMENT_LIMITS.imageBytes + 1024) / 3) * 4;
    const data = 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(encodedLength);
    expect(() =>
      documentWith({
        images: { big: { id: 'big', mimeType: 'image/png', data, width: 1, height: 1 } },
      }),
    ).toThrow(DocumentFormatError);
  });
});

describe('what an image actually is', () => {
  it('identifies the formats FlowShark draws from their signatures', () => {
    const png = Uint8Array.from(atob(PNG_4x4), (c) => c.charCodeAt(0));
    expect(detectImageType(png)).toBe('image/png');

    const gif = Uint8Array.from(
      atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
      (c) => c.charCodeAt(0),
    );
    expect(detectImageType(gif)).toBe('image/gif');

    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('does not accept RIFF that is not WebP', () => {
    // A RIFF container holding WAVE audio starts the same way a WebP does.
    const wave = new Uint8Array(12);
    wave.set([0x52, 0x49, 0x46, 0x46], 0);
    wave.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(detectImageType(wave)).toBeNull();

    const webp = new Uint8Array(12);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(detectImageType(webp)).toBe('image/webp');
  });

  it('rejects something that is not an image at all', () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    expect(detectImageType(html)).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});
