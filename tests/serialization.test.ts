import { describe, expect, it } from 'vitest';
import {
  DocumentFormatError,
  NewerSchemaError,
  parseDocument,
  serializeDocument,
} from '../src/model/serialization';
import { CURRENT_SCHEMA_VERSION } from '../src/model/types';
import { createEmptyDocument } from '../src/model/defaults';
import { getTemplate } from '../src/templates';
import { addElement } from '../src/model/document';
import { createShapeElement } from '../src/model/defaults';

/** A real 4x4 PNG, so payloads are checked against their declared type. */
const PNG_4x4 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAEklEQVR42mO4Y2PzHxkzkC4AAO2YJTHTor4nAAAAAElFTkSuQmCC';

describe('document serialization', () => {
  it('round-trips a template without losing elements', () => {
    const original = getTemplate('basic-flowchart')!.build();
    const restored = parseDocument(serializeDocument(original));
    expect(Object.keys(restored.elements).length).toBe(
      Object.keys(original.elements).length,
    );
    expect(restored.order).toEqual(original.order);
    expect(restored.meta.title).toBe(original.meta.title);
  });

  it('preserves shape geometry and style exactly', () => {
    const doc = createEmptyDocument();
    const shape = createShapeElement({
      shape: 'decision',
      frame: { x: 12.5, y: -8, width: 140, height: 90 },
      text: 'Ship it?',
    });
    shape.style.fill = '#ff8800';
    shape.rotation = 30;
    addElement(doc, shape);

    const restored = parseDocument(serializeDocument(doc));
    const result = restored.elements[shape.id];
    expect(result.kind).toBe('shape');
    if (result.kind !== 'shape') return;
    expect(result.frame).toEqual({ x: 12.5, y: -8, width: 140, height: 90 });
    expect(result.style.fill).toBe('#ff8800');
    expect(result.rotation).toBe(30);
    expect(result.text.value).toBe('Ship it?');
  });

  it('rejects a document written by a newer version', () => {
    const doc = createEmptyDocument();
    const payload = JSON.parse(serializeDocument(doc));
    payload.schemaVersion = CURRENT_SCHEMA_VERSION + 5;
    expect(() => parseDocument(JSON.stringify(payload))).toThrow(NewerSchemaError);
  });

  it('reports invalid JSON with a readable message', () => {
    expect(() => parseDocument('{ not json')).toThrow(DocumentFormatError);
    try {
      parseDocument('{ not json');
    } catch (error) {
      expect((error as DocumentFormatError).message).toMatch(/not a valid FlowShark document/);
    }
  });

  it('migrates a document that predates schemaVersion', () => {
    const doc = createEmptyDocument();
    const payload = JSON.parse(serializeDocument(doc));
    delete payload.schemaVersion;
    const restored = parseDocument(JSON.stringify(payload));
    expect(restored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('drops dangling references instead of failing', () => {
    const doc = getTemplate('basic-flowchart')!.build();
    const payload = JSON.parse(serializeDocument(doc));
    const connectorId = Object.keys(payload.elements).find(
      (id) => payload.elements[id].kind === 'connector',
    )!;
    payload.elements[connectorId].source.elementId = 'does-not-exist';
    const restored = parseDocument(JSON.stringify(payload));
    const connector = restored.elements[connectorId];
    expect(connector.kind).toBe('connector');
    if (connector.kind !== 'connector') return;
    expect(connector.source.elementId).toBeNull();
  });

  it('rejects embedded images with an unsupported type or payload', () => {
    const doc = createEmptyDocument();
    const payload = JSON.parse(serializeDocument(doc));
    payload.images = {
      bad: { id: 'bad', mimeType: 'text/html', data: 'AAA', width: 1, height: 1, name: 'x' },
      worse: { id: 'worse', mimeType: 'image/png', data: '<script>', width: 1, height: 1, name: 'y' },
      mislabelled: {
        // A real GIF claiming to be a PNG: the label alone is not evidence.
        id: 'mislabelled',
        mimeType: 'image/png',
        data: 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        width: 1,
        height: 1,
        name: 'w',
      },
      good: { id: 'good', mimeType: 'image/png', data: PNG_4x4, width: 2, height: 2, name: 'z' },
    };
    const restored = parseDocument(JSON.stringify(payload));
    expect(Object.keys(restored.images)).toEqual(['good']);
  });

  it('normalises a document that is missing every optional field', () => {
    const restored = parseDocument(
      JSON.stringify({ schemaVersion: 1, elements: { a: { id: 'a', kind: 'shape' } } }),
    );
    const element = restored.elements.a;
    expect(element.kind).toBe('shape');
    if (element.kind !== 'shape') return;
    expect(element.shape).toBe('process');
    expect(element.frame.width).toBeGreaterThan(0);
    expect(restored.layers.length).toBe(1);
    expect(restored.order).toEqual(['a']);
  });
});
