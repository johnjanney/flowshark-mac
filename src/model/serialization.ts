/**
 * Reading and writing `.flowshark` files.
 *
 * The file is JSON with an integer `schemaVersion`. Loading is deliberately
 * forgiving about missing fields — every element is normalised against the
 * current defaults — and deliberately strict about structure, so a corrupt or
 * hostile file fails with a message the user can act on rather than producing
 * a half-loaded document.
 *
 * Nothing in a document is ever executed. Text, names, and alt text are stored
 * as plain strings and are escaped at render time.
 */

import {
  CURRENT_SCHEMA_VERSION,
  type ConnectorElement,
  type ConnectorLabel,
  type DiagramElement,
  type FlowsharkDocument,
  type GroupElement,
  type Layer,
  type ShapeElement,
  type StylePreset,
} from './types';
import {
  APP_VERSION,
  builtinPresets,
  defaultCanvasSettings,
  defaultConnectorStyle,
  defaultLabelTextStyle,
  defaultLayer,
  defaultShapeStyle,
  defaultTextStyle,
} from './defaults';

export class DocumentFormatError extends Error {
  readonly detail: string;

  constructor(message: string, detail = '') {
    super(message);
    this.name = 'DocumentFormatError';
    this.detail = detail;
  }
}

export class NewerSchemaError extends DocumentFormatError {
  readonly fileVersion: number;

  constructor(fileVersion: number) {
    super(
      'This document was created by a newer version of FlowShark.',
      `The file uses document format ${fileVersion}; this copy of FlowShark reads up to format ${CURRENT_SCHEMA_VERSION}. Update FlowShark and try again.`,
    );
    this.name = 'NewerSchemaError';
    this.fileVersion = fileVersion;
  }
}

type Raw = Record<string, unknown>;

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function normaliseRect(value: unknown) {
  const raw = isObject(value) ? value : {};
  return {
    x: num(raw.x, 0),
    y: num(raw.y, 0),
    width: Math.max(1, num(raw.width, 100)),
    height: Math.max(1, num(raw.height, 60)),
  };
}

function normalisePoint(value: unknown) {
  const raw = isObject(value) ? value : {};
  return { x: num(raw.x, 0), y: num(raw.y, 0) };
}

function normaliseShapeStyle(value: unknown) {
  const raw = isObject(value) ? value : {};
  const base = defaultShapeStyle();
  const gradient = isObject(raw.gradient)
    ? {
        from: str(raw.gradient.from, base.fill === 'none' ? '#ffffff' : base.fill),
        to: str(raw.gradient.to, '#ffffff'),
        angle: num(raw.gradient.angle, 90),
      }
    : null;
  return {
    fill: str(raw.fill, base.fill),
    fillOpacity: num(raw.fillOpacity, base.fillOpacity),
    gradient,
    stroke: str(raw.stroke, base.stroke),
    strokeWidth: Math.max(0, num(raw.strokeWidth, base.strokeWidth)),
    strokeStyle: pick(raw.strokeStyle, ['solid', 'dashed', 'dotted'] as const, base.strokeStyle),
    strokeOpacity: num(raw.strokeOpacity, base.strokeOpacity),
    cornerRadius: Math.max(0, num(raw.cornerRadius, base.cornerRadius)),
    shadow: bool(raw.shadow, base.shadow),
    opacity: num(raw.opacity, base.opacity),
  };
}

function normaliseTextStyle(value: unknown, fallbackStyle = defaultTextStyle()) {
  const raw = isObject(value) ? value : {};
  return {
    fontFamily: str(raw.fontFamily, fallbackStyle.fontFamily),
    fontSize: Math.max(1, num(raw.fontSize, fallbackStyle.fontSize)),
    fontWeight: num(raw.fontWeight, fallbackStyle.fontWeight),
    italic: bool(raw.italic, fallbackStyle.italic),
    underline: bool(raw.underline, fallbackStyle.underline),
    color: str(raw.color, fallbackStyle.color),
    align: pick(raw.align, ['left', 'center', 'right'] as const, fallbackStyle.align),
    verticalAlign: pick(
      raw.verticalAlign,
      ['top', 'middle', 'bottom'] as const,
      fallbackStyle.verticalAlign,
    ),
    lineHeight: num(raw.lineHeight, fallbackStyle.lineHeight),
    wrap: bool(raw.wrap, fallbackStyle.wrap),
    background: typeof raw.background === 'string' ? raw.background : null,
  };
}

function normaliseConnectorStyle(value: unknown) {
  const raw = isObject(value) ? value : {};
  const base = defaultConnectorStyle();
  const markers = [
    'none',
    'arrow',
    'open-arrow',
    'filled-arrow',
    'diamond',
    'filled-diamond',
    'circle',
    'filled-circle',
    'square',
    'filled-square',
    'bar',
  ] as const;
  return {
    stroke: str(raw.stroke, base.stroke),
    strokeWidth: Math.max(0.1, num(raw.strokeWidth, base.strokeWidth)),
    strokeStyle: pick(raw.strokeStyle, ['solid', 'dashed', 'dotted'] as const, base.strokeStyle),
    opacity: num(raw.opacity, base.opacity),
    startMarker: pick(raw.startMarker, markers, base.startMarker),
    endMarker: pick(raw.endMarker, markers, base.endMarker),
    cornerRadius: Math.max(0, num(raw.cornerRadius, base.cornerRadius)),
  };
}

function normaliseAnchor(value: unknown): ConnectorElement['source']['anchor'] {
  if (!isObject(value)) return { mode: 'floating' };
  if (value.mode === 'fixed') return { mode: 'fixed', index: Math.max(0, num(value.index, 0)) };
  if (value.mode === 'ratio') {
    return { mode: 'ratio', rx: num(value.rx, 0.5), ry: num(value.ry, 0.5) };
  }
  return { mode: 'floating' };
}

function normaliseEndpoint(value: unknown): ConnectorElement['source'] {
  const raw = isObject(value) ? value : {};
  return {
    elementId: typeof raw.elementId === 'string' ? raw.elementId : null,
    anchor: normaliseAnchor(raw.anchor),
    point: normalisePoint(raw.point),
  };
}

function normaliseLabels(value: unknown): ConnectorLabel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((raw, index) => ({
    id: str(raw.id, `label_${index}`),
    text: str(raw.text),
    style: normaliseTextStyle(raw.style, defaultLabelTextStyle()),
    position: Math.min(1, Math.max(0, num(raw.position, 0.5))),
    offset: num(raw.offset, 0),
    background: typeof raw.background === 'string' ? raw.background : null,
    border: typeof raw.border === 'string' ? raw.border : null,
  }));
}

function normaliseElement(raw: Raw, fallbackLayer: string): DiagramElement | null {
  const id = str(raw.id);
  if (!id) return null;
  const base = {
    id,
    name: str(raw.name),
    layerId: str(raw.layerId, fallbackLayer),
    locked: bool(raw.locked, false),
    hidden: bool(raw.hidden, false),
    groupId: typeof raw.groupId === 'string' ? raw.groupId : null,
  };

  if (raw.kind === 'connector') {
    const connector: ConnectorElement = {
      ...base,
      kind: 'connector',
      connectorKind: pick(
        raw.connectorKind,
        ['straight', 'elbow', 'curved', 'step', 'freeform'] as const,
        'elbow',
      ),
      source: normaliseEndpoint(raw.source),
      target: normaliseEndpoint(raw.target),
      waypoints: Array.isArray(raw.waypoints) ? raw.waypoints.map(normalisePoint) : [],
      routing: pick(raw.routing, ['dynamic', 'manual'] as const, 'dynamic'),
      avoidShapes: bool(raw.avoidShapes, false),
      style: normaliseConnectorStyle(raw.style),
      labels: normaliseLabels(raw.labels),
      altText: str(raw.altText),
    };
    return connector;
  }

  if (raw.kind === 'group') {
    const group: GroupElement = {
      ...base,
      kind: 'group',
      children: Array.isArray(raw.children)
        ? raw.children.filter((child): child is string => typeof child === 'string')
        : [],
      altText: str(raw.altText),
    };
    return group;
  }

  const textRaw = isObject(raw.text) ? raw.text : {};
  const shape: ShapeElement = {
    ...base,
    kind: 'shape',
    shape: str(raw.shape, 'process'),
    frame: normaliseRect(raw.frame),
    rotation: num(raw.rotation, 0),
    style: normaliseShapeStyle(raw.style),
    text: {
      value: str(textRaw.value),
      style: normaliseTextStyle(textRaw.style),
      padding: Math.max(0, num(textRaw.padding, 8)),
    },
    autoSize: bool(raw.autoSize, false),
    imageRef: typeof raw.imageRef === 'string' ? raw.imageRef : null,
    altText: str(raw.altText),
  };
  return shape;
}

function normaliseLayers(value: unknown): Layer[] {
  if (!Array.isArray(value) || value.length === 0) return [defaultLayer()];
  const layers = value.filter(isObject).map((raw, index) => ({
    id: str(raw.id, `layer_${index}`),
    name: str(raw.name, `Layer ${index + 1}`),
    visible: bool(raw.visible, true),
    locked: bool(raw.locked, false),
  }));
  return layers.length > 0 ? layers : [defaultLayer()];
}

/**
 * Keep the keys the preset actually set, with the values the normalisers gave
 * them.
 *
 * A preset is a patch — only the properties it mentions are applied — so it
 * cannot simply be normalised into a whole style. Normalising the whole style
 * and then keeping only the keys that were present gives every value the same
 * type checking the rest of the document gets, and drops keys that mean
 * nothing. Without this, presets were the one part of a document that reached
 * an element's style uninspected, and applying one from a hand-written file
 * could put a string where the renderer expects a number.
 */
function presentKeysOnly<T extends object>(raw: Raw, normalised: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(normalised) as Array<keyof T & string>) {
    if (key in raw) out[key] = normalised[key];
  }
  return out;
}

function normalisePresets(value: unknown): StylePreset[] {
  if (!Array.isArray(value)) return builtinPresets();
  const presets = value.filter(isObject).map((raw, index) => {
    const shapeRaw = isObject(raw.shape) ? raw.shape : {};
    const textRaw = isObject(raw.text) ? raw.text : {};
    const connectorRaw = isObject(raw.connector) ? raw.connector : {};
    return {
      id: str(raw.id, `preset_${index}`),
      name: str(raw.name, `Style ${index + 1}`),
      shape: presentKeysOnly(shapeRaw, normaliseShapeStyle(shapeRaw)),
      text: presentKeysOnly(textRaw, normaliseTextStyle(textRaw)),
      connector: presentKeysOnly(connectorRaw, normaliseConnectorStyle(connectorRaw)),
    };
  });
  return presets.length > 0 ? presets : builtinPresets();
}

function normaliseCanvas(value: unknown): FlowsharkDocument['canvas'] {
  const raw = isObject(value) ? value : {};
  const base = defaultCanvasSettings();
  const grid = isObject(raw.grid) ? raw.grid : {};
  const page = isObject(raw.page) ? raw.page : {};
  return {
    background: str(raw.background, base.background),
    grid: {
      visible: bool(grid.visible, base.grid.visible),
      size: Math.max(1, num(grid.size, base.grid.size)),
      snap: bool(grid.snap, base.grid.snap),
    },
    snapToElement: bool(raw.snapToElement, base.snapToElement),
    snapTolerance: Math.max(0, num(raw.snapTolerance, base.snapTolerance)),
    showGuides: bool(raw.showGuides, base.showGuides),
    showRulers: bool(raw.showRulers, base.showRulers),
    page: {
      width: Math.max(1, num(page.width, base.page.width)),
      height: Math.max(1, num(page.height, base.page.height)),
      margin: Math.max(0, num(page.margin, base.page.margin)),
      orientation: pick(
        page.orientation,
        ['portrait', 'landscape'] as const,
        base.page.orientation,
      ),
      showBoundaries: bool(page.showBoundaries, base.page.showBoundaries),
    },
  };
}

/**
 * Image formats a document may carry.
 *
 * This is deliberately the same list `IMPORTABLE_IMAGE_TYPES` accepts, and it
 * deliberately excludes SVG. FlowShark does not import SVG because doing it
 * safely means sanitising untrusted markup (DECISIONS.md, D-010); accepting
 * SVG here would have let a hand-written document carry exactly the payload
 * that decision refuses, straight through to the renderer and into every
 * export.
 */
const IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

function normaliseImages(value: unknown): FlowsharkDocument['images'] {
  const out: FlowsharkDocument['images'] = {};
  if (!isObject(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    if (!isObject(raw)) continue;
    const mimeType = str(raw.mimeType, 'image/png');
    // Only formats the renderer can actually draw are kept.
    if (!IMAGE_MIME_TYPES.has(mimeType)) continue;
    const data = str(raw.data);
    if (!/^[A-Za-z0-9+/=\s]*$/.test(data)) continue;
    out[key] = {
      id: str(raw.id, key),
      mimeType,
      data,
      width: Math.max(1, num(raw.width, 1)),
      height: Math.max(1, num(raw.height, 1)),
      name: str(raw.name),
    };
  }
  return out;
}

/**
 * Forward migrations. Each entry upgrades a document from version `n` to
 * version `n + 1` and is applied in sequence. There is only one format so far;
 * the machinery exists so the first real change is a one-line addition.
 */
const MIGRATIONS: Array<(raw: Raw) => Raw> = [
  // 0 -> 1: pre-release documents that predate `schemaVersion`.
  (raw) => ({ ...raw, schemaVersion: 1 }),
];

export function migrateRaw(raw: Raw): Raw {
  let version = num(raw.schemaVersion, 0);
  let current = raw;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS[version];
    if (!migration) break;
    current = migration(current);
    version += 1;
  }
  return { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
}

/** Parse the JSON text of a `.flowshark` file. */
export function parseDocument(text: string): FlowsharkDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new DocumentFormatError(
      'This file is not a valid FlowShark document.',
      error instanceof Error ? error.message : String(error),
    );
  }
  return fromRaw(raw);
}

export function fromRaw(raw: unknown): FlowsharkDocument {
  if (!isObject(raw)) {
    throw new DocumentFormatError('This file is not a valid FlowShark document.');
  }
  const fileVersion = num(raw.schemaVersion, 0);
  if (fileVersion > CURRENT_SCHEMA_VERSION) throw new NewerSchemaError(fileVersion);

  const migrated = migrateRaw(raw);
  const layers = normaliseLayers(migrated.layers);
  const fallbackLayer = layers[0].id;
  const layerIds = new Set(layers.map((layer) => layer.id));

  const elements: Record<string, DiagramElement> = {};
  const rawElements = isObject(migrated.elements) ? migrated.elements : {};
  for (const value of Object.values(rawElements)) {
    if (!isObject(value)) continue;
    const element = normaliseElement(value, fallbackLayer);
    if (!element) continue;
    if (!layerIds.has(element.layerId)) element.layerId = fallbackLayer;
    elements[element.id] = element;
  }

  // Order: keep the recorded sequence, drop unknown ids, append anything missing.
  const recorded = Array.isArray(migrated.order)
    ? migrated.order.filter(
        (id): id is string => typeof id === 'string' && id in elements,
      )
    : [];
  const seen = new Set(recorded);
  const order = [...recorded];
  for (const id of Object.keys(elements)) if (!seen.has(id)) order.push(id);

  // Drop dangling references so the renderer never sees a broken document.
  for (const element of Object.values(elements)) {
    if (element.groupId && !(element.groupId in elements)) element.groupId = null;
    if (element.kind === 'group') {
      element.children = element.children.filter((child) => child in elements);
    }
    if (element.kind === 'connector') {
      if (element.source.elementId && !(element.source.elementId in elements)) {
        element.source = { ...element.source, elementId: null };
      }
      if (element.target.elementId && !(element.target.elementId in elements)) {
        element.target = { ...element.target, elementId: null };
      }
    }
  }

  const metaRaw = isObject(migrated.meta) ? migrated.meta : {};
  const now = new Date().toISOString();

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: {
      title: str(metaRaw.title, 'Untitled'),
      created: str(metaRaw.created, now),
      modified: str(metaRaw.modified, now),
      author: str(metaRaw.author),
      application: str(metaRaw.application, `FlowShark ${APP_VERSION}`),
      description: str(metaRaw.description),
    },
    canvas: normaliseCanvas(migrated.canvas),
    layers,
    elements,
    order,
    presets: normalisePresets(migrated.presets),
    images: normaliseImages(migrated.images),
  };
}

/**
 * Embedded images that some element still refers to.
 *
 * Deleting the shape that showed a picture leaves the picture itself in
 * `doc.images`, because undo has to be able to put the shape back. Dropping
 * the unreferenced ones on the way out means a document that has had images
 * deleted shrinks again on the next save, instead of carrying the base64 of
 * every picture it has ever held. This reads the document rather than
 * changing it, so undo after a save still restores both shape and picture.
 */
function referencedImages(doc: FlowsharkDocument): FlowsharkDocument['images'] {
  const used = new Set<string>();
  for (const element of Object.values(doc.elements)) {
    if (element.kind === 'shape' && element.imageRef) used.add(element.imageRef);
  }
  const out: FlowsharkDocument['images'] = {};
  for (const [id, image] of Object.entries(doc.images)) {
    if (used.has(id)) out[id] = image;
  }
  return out;
}

/** Serialise a document for writing to disk. */
export function serializeDocument(doc: FlowsharkDocument, pretty = true): string {
  const payload: FlowsharkDocument = {
    ...doc,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...doc.meta, modified: new Date().toISOString(), application: `FlowShark ${APP_VERSION}` },
    images: referencedImages(doc),
  };
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

/** Deep copy helper used by history snapshots and by duplicate/paste. */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
