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
import { inspectImage } from '../src/util/image';

const PNG_4x4 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR42mO4Y2PzHxkzkC4AAO2YJTHTor4nAAAAAElFTkSuQmCC';

/** A PNG signature and IHDR declaring `width` x `height`, base64 encoded. */
function pngHeader(width: number, height: number): string {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0, 0, 0, 13], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const write = (value: number, at: number): void => {
    bytes[at] = (value >>> 24) & 0xff;
    bytes[at + 1] = (value >>> 16) & 0xff;
    bytes[at + 2] = (value >>> 8) & 0xff;
    bytes[at + 3] = value & 0xff;
  };
  write(width, 16);
  write(height, 20);
  return btoa(String.fromCharCode(...bytes));
}

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
  it('refuses a document with more elements than the budget allows', () => {
    // The headline budget: without it the reader builds the whole object
    // graph, and every element then becomes markup, a snapshot and a copy.
    const elements: Record<string, unknown> = {};
    for (let i = 0; i <= DOCUMENT_LIMITS.elements; i++) elements[`e${i}`] = shape(`e${i}`);
    expect(() => documentWith({ elements })).toThrow(DocumentFormatError);
  });

  it('refuses a document whose drawing order is absurdly long', () => {
    // The order list is read and filtered before it is bounded by the element
    // count, so it needs a budget of its own.
    const order = Array.from({ length: DOCUMENT_LIMITS.order + 1 }, (_, i) => `e${i}`);
    expect(() => documentWith({ elements: {}, order })).toThrow(DocumentFormatError);
  });

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

  it('refuses an image whose own header declares an absurd pixel count', () => {
    expect(() =>
      documentWith({
        images: {
          big: { id: 'big', mimeType: 'image/png', data: pngHeader(30_000, 30_000) },
        },
      }),
    ).toThrow(DocumentFormatError);
  });

  it('is not fooled by a document that understates a huge payload', () => {
    // `width` and `height` are separate fields from the payload, so a hostile
    // document can claim a picture is tiny. The renderer decodes the payload,
    // not the claim, so the budget has to follow the payload too.
    expect(() =>
      documentWith({
        images: {
          big: {
            id: 'big',
            mimeType: 'image/png',
            data: pngHeader(30_000, 30_000),
            width: 1,
            height: 1,
          },
        },
      }),
    ).toThrow(DocumentFormatError);
  });

  it('records the size the payload really is, not the size it was told', () => {
    const doc = documentWith({
      images: {
        small: {
          id: 'small',
          mimeType: 'image/png',
          data: PNG_4x4,
          width: 500_000,
          height: 500_000,
        },
      },
    });
    expect(doc.images.small.width).toBe(4);
    expect(doc.images.small.height).toBe(4);
  });

  it('drops a payload whose header is truncated rather than assuming it small', () => {
    // "Cannot tell" and "is small" must not be the same answer, or the budget
    // is bypassed by cutting the header off.
    const doc = documentWith({
      images: { cut: { id: 'cut', mimeType: 'image/png', data: PNG_4x4.slice(0, 8) } },
    });
    expect(doc.images).toEqual({});
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
  /** A minimal JPEG: SOI, an APP0 block, then the frame header. */
  function jpeg(width: number, height: number): Uint8Array {
    const bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
    for (let i = 0; i < 14; i++) bytes.push(0);
    bytes.push(0xff, 0xc0, 0x00, 0x11, 0x08);
    bytes.push((height >> 8) & 0xff, height & 0xff);
    bytes.push((width >> 8) & 0xff, width & 0xff);
    return Uint8Array.from(bytes);
  }

  /** A minimal extended WebP, which carries the canvas size. */
  function webpVP8X(width: number, height: number): Uint8Array {
    const bytes = new Uint8Array(30);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0);
    bytes.set([0x57, 0x45, 0x42, 0x50], 8);
    bytes.set([0x56, 0x50, 0x38, 0x58], 12);
    bytes[16] = 10;
    const w = width - 1;
    const h = height - 1;
    bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24);
    bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27);
    return bytes;
  }

  it('reads the format and the true size from the payload', () => {
    const png = Uint8Array.from(atob(PNG_4x4), (c) => c.charCodeAt(0));
    expect(inspectImage(png)).toEqual({ mimeType: 'image/png', width: 4, height: 4 });

    const gif = Uint8Array.from(
      atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'),
      (c) => c.charCodeAt(0),
    );
    expect(inspectImage(gif)).toEqual({ mimeType: 'image/gif', width: 1, height: 1 });

    expect(inspectImage(jpeg(640, 480))).toEqual({
      mimeType: 'image/jpeg',
      width: 640,
      height: 480,
    });

    expect(inspectImage(webpVP8X(800, 600))).toEqual({
      mimeType: 'image/webp',
      width: 800,
      height: 600,
    });
  });

  it('walks past metadata to reach a JPEG frame header', () => {
    expect(inspectImage(jpeg(1, 1))?.width).toBe(1);
  });

  it('does not accept RIFF that is not WebP', () => {
    // A RIFF container holding WAVE audio starts the same way a WebP does.
    const wave = new Uint8Array(30);
    wave.set([0x52, 0x49, 0x46, 0x46], 0);
    wave.set([0x57, 0x41, 0x56, 0x45], 8);
    expect(inspectImage(wave)).toBeNull();
  });

  it('refuses to guess when the header is absent or truncated', () => {
    // A signature alone says nothing about size, and answering "small" for a
    // payload whose header cannot be read would hand the budget a way through.
    expect(inspectImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBeNull();
    expect(inspectImage(new Uint8Array())).toBeNull();
    expect(inspectImage(new TextEncoder().encode('<html><script>x</script>'))).toBeNull();
  });

  it('still answers the simpler question of which format it is', () => {
    const png = Uint8Array.from(atob(PNG_4x4), (c) => c.charCodeAt(0));
    expect(detectImageType(png)).toBe('image/png');
    expect(detectImageType(new TextEncoder().encode('not an image'))).toBeNull();
  });
});
