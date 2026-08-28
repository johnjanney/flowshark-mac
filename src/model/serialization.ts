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

/**
 * Budgets a document has to fit inside.
 *
 * The native layer caps the *file* at 256 MB, which bounds nothing that
 * matters: JSON expands into an object graph several times its own size, and
 * every element then becomes SVG markup, a history snapshot, a serialised
 * copy, and possibly a raster canvas. A file well under the cap could stall or
 * exhaust the application while opening, rendering, exporting, or autosaving.
 *
 * These numbers are set far above any diagram a person would draw — the
 * documented performance target is 2,000 objects — and are here to turn a hang
 * into a message the user can act on. Anything over budget is refused whole
 * rather than truncated: quietly dropping half a diagram's connectors would be
 * worse than declining to open it.
 */
export const DOCUMENT_LIMITS = {
  elements: 50_000,
  layers: 1_000,
  presets: 1_000,
  waypointsPerConnector: 10_000,
  labelsPerConnector: 100,
  childrenPerGroup: 50_000,
  /** Characters in any single text, name, or alt-text field. */
  textLength: 100_000,
  images: 1_000,
  /** Decoded bytes for one embedded image. */
  imageBytes: 64 * 1024 * 1024,
  /** Decoded bytes for every embedded image together. */
  totalImageBytes: 256 * 1024 * 1024,
  /** Pixels in one embedded image, which bounds the canvases it can produce. */
  imagePixels: 100_000_000,
} as const;

/**
 * Bounds for geometry and styling.
 *
 * `Number.isFinite` was the only test before, so a coordinate of 1e300 or a
 * font size of 1e9 was accepted and went on to produce path data and text
 * layout that no renderer can cope with.
 */
const MAX_COORDINATE = 1e7;
const MAX_EXTENT = 1e6;
const MAX_FONT_SIZE = 4_000;
const MAX_STROKE_WIDTH = 10_000;
const MAX_CORNER_RADIUS = 100_000;

type Raw = Record<string, unknown>;

function overBudget(what: string, count: number, limit: number): never {
  throw new DocumentFormatError(
    'This document is too large for FlowShark to open.',
    `It contains ${count.toLocaleString()} ${what}, and the limit is ${limit.toLocaleString()}.`,
  );
}

function requireWithin(what: string, count: number, limit: number): void {
  if (count > limit) overBudget(what, count, limit);
}

function isObject(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A finite number held inside `[-limit, limit]`. */
function bounded(value: unknown, fallback: number, limit: number): number {
  const raw = num(value, fallback);
  return Math.min(limit, Math.max(-limit, raw));
}

/** A finite number held inside `[min, limit]`. */
function boundedPositive(
  value: unknown,
  fallback: number,
  limit: number,
  min = 0,
): number {
  const raw = num(value, fallback);
  return Math.min(limit, Math.max(min, raw));
}

/**
 * A string no longer than the text budget.
 *
 * Text is laid out word by word and measured on the UI thread, so an
 * unbounded string is a stall rather than a large label.
 */
function boundedStr(value: unknown, fallback = ''): string {
  const raw = str(value, fallback);
  return raw.length > DOCUMENT_LIMITS.textLength
    ? raw.slice(0, DOCUMENT_LIMITS.textLength)
    : raw;
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
    x: bounded(raw.x, 0, MAX_COORDINATE),
    y: bounded(raw.y, 0, MAX_COORDINATE),
    width: boundedPositive(raw.width, 100, MAX_EXTENT, 1),
    height: boundedPositive(raw.height, 60, MAX_EXTENT, 1),
  };
}

function normalisePoint(value: unknown) {
  const raw = isObject(value) ? value : {};
  return {
    x: bounded(raw.x, 0, MAX_COORDINATE),
    y: bounded(raw.y, 0, MAX_COORDINATE),
  };
}

function normaliseShapeStyle(value: unknown) {
  const raw = isObject(value) ? value : {};
  const base = defaultShapeStyle();
  const gradient = isObject(raw.gradient)
    ? {
        from: boundedStr(raw.gradient.from, base.fill === 'none' ? '#ffffff' : base.fill),
        to: boundedStr(raw.gradient.to, '#ffffff'),
        angle: bounded(raw.gradient.angle, 90, 3_600),
      }
    : null;
  return {
    fill: boundedStr(raw.fill, base.fill),
    fillOpacity: boundedPositive(raw.fillOpacity, base.fillOpacity, 1),
    gradient,
    stroke: boundedStr(raw.stroke, base.stroke),
    strokeWidth: boundedPositive(raw.strokeWidth, base.strokeWidth, MAX_STROKE_WIDTH),
    strokeStyle: pick(raw.strokeStyle, ['solid', 'dashed', 'dotted'] as const, base.strokeStyle),
    strokeOpacity: boundedPositive(raw.strokeOpacity, base.strokeOpacity, 1),
    cornerRadius: boundedPositive(raw.cornerRadius, base.cornerRadius, MAX_CORNER_RADIUS),
    shadow: bool(raw.shadow, base.shadow),
    opacity: boundedPositive(raw.opacity, base.opacity, 1),
  };
}

function normaliseTextStyle(value: unknown, fallbackStyle = defaultTextStyle()) {
  const raw = isObject(value) ? value : {};
  return {
    fontFamily: boundedStr(raw.fontFamily, fallbackStyle.fontFamily),
    fontSize: boundedPositive(raw.fontSize, fallbackStyle.fontSize, MAX_FONT_SIZE, 1),
    fontWeight: boundedPositive(raw.fontWeight, fallbackStyle.fontWeight, 1_000, 1),
    italic: bool(raw.italic, fallbackStyle.italic),
    underline: bool(raw.underline, fallbackStyle.underline),
    color: boundedStr(raw.color, fallbackStyle.color),
    align: pick(raw.align, ['left', 'center', 'right'] as const, fallbackStyle.align),
    verticalAlign: pick(
      raw.verticalAlign,
      ['top', 'middle', 'bottom'] as const,
      fallbackStyle.verticalAlign,
    ),
    lineHeight: boundedPositive(raw.lineHeight, fallbackStyle.lineHeight, 100, 0.1),
    wrap: bool(raw.wrap, fallbackStyle.wrap),
    background: typeof raw.background === 'string' ? boundedStr(raw.background) : null,
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
    stroke: boundedStr(raw.stroke, base.stroke),
    strokeWidth: boundedPositive(raw.strokeWidth, base.strokeWidth, MAX_STROKE_WIDTH, 0.1),
    strokeStyle: pick(raw.strokeStyle, ['solid', 'dashed', 'dotted'] as const, base.strokeStyle),
    opacity: boundedPositive(raw.opacity, base.opacity, 1),
    startMarker: pick(raw.startMarker, markers, base.startMarker),
    endMarker: pick(raw.endMarker, markers, base.endMarker),
    cornerRadius: boundedPositive(raw.cornerRadius, base.cornerRadius, MAX_CORNER_RADIUS),
  };
}

function normaliseAnchor(value: unknown): ConnectorElement['source']['anchor'] {
  if (!isObject(value)) return { mode: 'floating' };
  if (value.mode === 'fixed') {
    return { mode: 'fixed', index: boundedPositive(value.index, 0, 10_000) };
  }
  if (value.mode === 'ratio') {
    return {
      mode: 'ratio',
      rx: boundedPositive(value.rx, 0.5, 1),
      ry: boundedPositive(value.ry, 0.5, 1),
    };
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
  requireWithin('labels on one connector', value.length, DOCUMENT_LIMITS.labelsPerConnector);
  return value.filter(isObject).map((raw, index) => ({
    id: boundedStr(raw.id, `label_${index}`),
    text: boundedStr(raw.text),
    style: normaliseTextStyle(raw.style, defaultLabelTextStyle()),
    position: boundedPositive(raw.position, 0.5, 1),
    offset: bounded(raw.offset, 0, MAX_EXTENT),
    background: typeof raw.background === 'string' ? boundedStr(raw.background) : null,
    border: typeof raw.border === 'string' ? boundedStr(raw.border) : null,
  }));
}

function normaliseWaypoints(value: unknown) {
  if (!Array.isArray(value)) return [];
  requireWithin(
    'waypoints on one connector',
    value.length,
    DOCUMENT_LIMITS.waypointsPerConnector,
  );
  return value.map(normalisePoint);
}

function normaliseChildren(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  requireWithin('members of one group', value.length, DOCUMENT_LIMITS.childrenPerGroup);
  return value.filter((child): child is string => typeof child === 'string');
}

function normaliseElement(raw: Raw, fallbackLayer: string): DiagramElement | null {
  const id = str(raw.id);
  if (!id) return null;
  const base = {
    id,
    name: boundedStr(raw.name),
    layerId: boundedStr(raw.layerId, fallbackLayer),
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
      waypoints: normaliseWaypoints(raw.waypoints),
      routing: pick(raw.routing, ['dynamic', 'manual'] as const, 'dynamic'),
      avoidShapes: bool(raw.avoidShapes, false),
      style: normaliseConnectorStyle(raw.style),
      labels: normaliseLabels(raw.labels),
      altText: boundedStr(raw.altText),
    };
    return connector;
  }

  if (raw.kind === 'group') {
    const group: GroupElement = {
      ...base,
      kind: 'group',
      children: normaliseChildren(raw.children),
      altText: boundedStr(raw.altText),
    };
    return group;
  }

  const textRaw = isObject(raw.text) ? raw.text : {};
  const shape: ShapeElement = {
    ...base,
    kind: 'shape',
    shape: boundedStr(raw.shape, 'process'),
    frame: normaliseRect(raw.frame),
    rotation: bounded(raw.rotation, 0, 3_600),
    style: normaliseShapeStyle(raw.style),
    text: {
      value: boundedStr(textRaw.value),
      style: normaliseTextStyle(textRaw.style),
      padding: boundedPositive(textRaw.padding, 8, MAX_EXTENT),
    },
    autoSize: bool(raw.autoSize, false),
    imageRef: typeof raw.imageRef === 'string' ? boundedStr(raw.imageRef) : null,
    altText: boundedStr(raw.altText),
  };
  return shape;
}

function normaliseLayers(value: unknown): Layer[] {
  if (!Array.isArray(value) || value.length === 0) return [defaultLayer()];
  requireWithin('layers', value.length, DOCUMENT_LIMITS.layers);
  const layers = value.filter(isObject).map((raw, index) => ({
    id: boundedStr(raw.id, `layer_${index}`),
    name: boundedStr(raw.name, `Layer ${index + 1}`),
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
  requireWithin('style presets', value.length, DOCUMENT_LIMITS.presets);
  const presets = value.filter(isObject).map((raw, index) => {
    const shapeRaw = isObject(raw.shape) ? raw.shape : {};
    const textRaw = isObject(raw.text) ? raw.text : {};
    const connectorRaw = isObject(raw.connector) ? raw.connector : {};
    return {
      id: boundedStr(raw.id, `preset_${index}`),
      name: boundedStr(raw.name, `Style ${index + 1}`),
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

/**
 * Bytes a base64 payload decodes to, without decoding it.
 *
 * Decoding first would mean allocating the very buffer the budget exists to
 * prevent, so the size is computed from the encoded length instead.
 */
function decodedLength(base64: string): number {
  const compact = base64.replace(/\s+/g, '');
  const padding = compact.endsWith('==') ? 2 : compact.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((compact.length * 3) / 4) - padding);
}

/**
 * The first bytes of a base64 payload, as a lower-case hex string.
 *
 * Only the leading characters are decoded — enough to read a file signature —
 * so this stays cheap regardless of how large the payload is.
 */
function leadingBytesHex(base64: string, count: number): string {
  const compact = base64.replace(/\s+/g, '').slice(0, Math.ceil((count * 4) / 3) + 4);
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let accumulator = 0;
  let hex = '';
  for (const character of compact) {
    const index = alphabet.indexOf(character);
    if (index < 0) break;
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      hex += ((accumulator >> bits) & 0xff).toString(16).padStart(2, '0');
      if (hex.length >= count * 2) break;
    }
  }
  return hex.slice(0, count * 2);
}

/**
 * Signatures for the formats FlowShark draws, so a payload has to be what it
 * says it is.
 *
 * The declared MIME type is just a string in a file someone else may have
 * written. Checking the bytes means a record labelled `image/png` that holds
 * something else is refused here rather than being handed to the renderer, to
 * a canvas, and into every export.
 */
const IMAGE_SIGNATURES: Record<string, readonly string[]> = {
  'image/png': ['89504e470d0a1a0a'],
  'image/jpeg': ['ffd8ff'],
  'image/gif': ['474946383761', '474946383961'],
  // RIFF....WEBP: the four bytes at offset 4 are the payload length, so only
  // the container tag is fixed.
  'image/webp': ['52494646'],
};

function signatureMatches(mimeType: string, data: string): boolean {
  const signatures = IMAGE_SIGNATURES[mimeType];
  if (!signatures) return false;
  const head = leadingBytesHex(data, 8);
  if (mimeType === 'image/webp') {
    // Check the RIFF tag and the WEBP form type, skipping the length between.
    return head.startsWith('52494646') && leadingBytesHex(data, 12).slice(16) === '57454250';
  }
  return signatures.some((signature) => head.startsWith(signature));
}

function normaliseImages(value: unknown): FlowsharkDocument['images'] {
  const out: FlowsharkDocument['images'] = {};
  if (!isObject(value)) return out;
  const entries = Object.entries(value);
  requireWithin('embedded images', entries.length, DOCUMENT_LIMITS.images);

  let totalBytes = 0;
  for (const [key, raw] of entries) {
    if (!isObject(raw)) continue;
    const mimeType = str(raw.mimeType, 'image/png');
    // Only formats the renderer can actually draw are kept.
    if (!IMAGE_MIME_TYPES.has(mimeType)) continue;
    const data = str(raw.data);
    if (!/^[A-Za-z0-9+/=\s]*$/.test(data)) continue;
    // The bytes have to agree with the label before anything draws them.
    if (!signatureMatches(mimeType, data)) continue;

    const bytes = decodedLength(data);
    if (bytes > DOCUMENT_LIMITS.imageBytes) {
      overBudget('bytes in one embedded image', bytes, DOCUMENT_LIMITS.imageBytes);
    }
    totalBytes += bytes;
    if (totalBytes > DOCUMENT_LIMITS.totalImageBytes) {
      overBudget('bytes of embedded images', totalBytes, DOCUMENT_LIMITS.totalImageBytes);
    }

    const width = boundedPositive(raw.width, 1, MAX_EXTENT, 1);
    const height = boundedPositive(raw.height, 1, MAX_EXTENT, 1);
    if (width * height > DOCUMENT_LIMITS.imagePixels) {
      overBudget('pixels in one embedded image', width * height, DOCUMENT_LIMITS.imagePixels);
    }

    out[key] = {
      id: boundedStr(raw.id, key),
      mimeType,
      data,
      width,
      height,
      name: boundedStr(raw.name),
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

/**
 * Serialise a document for writing to disk.
 *
 * `modified` is a parameter rather than being taken from the clock here so the
 * caller can write the same timestamp into the file and into the in-memory
 * document once the write succeeds. Generating it inside meant the copy on
 * disk always claimed a modification time the running document did not have.
 */
export function serializeDocument(
  doc: FlowsharkDocument,
  pretty = true,
  modified = new Date().toISOString(),
): string {
  const payload: FlowsharkDocument = {
    ...doc,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: { ...doc.meta, modified, application: `FlowShark ${APP_VERSION}` },
    images: referencedImages(doc),
  };
  return JSON.stringify(payload, null, pretty ? 2 : 0);
}

/** Deep copy helper used by history snapshots and by duplicate/paste. */
export function deepClone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
