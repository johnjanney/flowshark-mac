/**
 * Undo and redo.
 *
 * Every user action runs inside a transaction. The transaction deep-clones the
 * parts of the document it is allowed to touch, lets the action mutate the
 * document in place, then diffs the two states and stores the difference as a
 * pair of patches. Undo applies the "before" patch, redo applies the "after"
 * patch.
 *
 * Diffing rather than requiring each command to declare its own inverse means a
 * new command cannot silently break undo. Commands that touch only a handful of
 * elements pass a `scope`, which limits the clone and the diff to those ids and
 * keeps large documents responsive.
 */

import { deepClone } from '../model/serialization';
import type {
  CanvasSettings,
  DiagramElement,
  DocumentMeta,
  ElementId,
  EmbeddedImage,
  FlowsharkDocument,
  Layer,
  StylePreset,
} from '../model/types';

export interface DocumentPatch {
  /** `null` marks an element that must be removed when the patch is applied. */
  elements?: Record<ElementId, DiagramElement | null>;
  order?: ElementId[];
  layers?: Layer[];
  canvas?: CanvasSettings;
  meta?: DocumentMeta;
  presets?: StylePreset[];
  images?: Record<string, EmbeddedImage | null>;
}

export interface HistoryEntry {
  label: string;
  before: DocumentPatch;
  after: DocumentPatch;
  selectionBefore: ElementId[];
  selectionAfter: ElementId[];
  /** Consecutive entries sharing a key merge into one undo step. */
  coalesceKey: string | null;
  timestamp: number;
}

export interface TransactionOptions {
  /** Element ids the action may change. Omit when the action is unbounded. */
  scope?: readonly ElementId[];
  /** Merge with the previous entry when the keys match and it is recent. */
  coalesceKey?: string;
  /** Skip the history entry entirely (used for view-only changes). */
  transient?: boolean;
}

/** Milliseconds within which two same-key entries merge. */
const COALESCE_WINDOW_MS = 700;

/** Brief §8.15 asks for at least 100 undo steps. */
export const HISTORY_LIMIT = 200;

function shallowEqualArray(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

interface Snapshot {
  elements: Record<ElementId, DiagramElement | undefined>;
  order: ElementId[];
  layers: Layer[];
  canvas: CanvasSettings;
  meta: DocumentMeta;
  presets: StylePreset[];
  images: Record<string, EmbeddedImage | undefined>;
  scoped: boolean;
}

function snapshot(doc: FlowsharkDocument, scope?: readonly ElementId[]): Snapshot {
  const elements: Record<ElementId, DiagramElement | undefined> = {};
  if (scope) {
    for (const id of scope) {
      const element = doc.elements[id];
      elements[id] = element ? deepClone(element) : undefined;
    }
  } else {
    for (const [id, element] of Object.entries(doc.elements)) {
      elements[id] = deepClone(element);
    }
  }
  return {
    elements,
    order: [...doc.order],
    layers: deepClone(doc.layers),
    canvas: deepClone(doc.canvas),
    meta: { ...doc.meta },
    presets: deepClone(doc.presets),
    images: scope ? {} : deepClone(doc.images),
    scoped: !!scope,
  };
}

function diff(
  before: Snapshot,
  doc: FlowsharkDocument,
): { before: DocumentPatch; after: DocumentPatch; changed: boolean } {
  const beforePatch: DocumentPatch = {};
  const afterPatch: DocumentPatch = {};
  let changed = false;

  const ids = new Set<ElementId>(Object.keys(before.elements));
  if (!before.scoped) for (const id of Object.keys(doc.elements)) ids.add(id);

  const beforeElements: Record<ElementId, DiagramElement | null> = {};
  const afterElements: Record<ElementId, DiagramElement | null> = {};
  for (const id of ids) {
    const previous = before.elements[id];
    const current = doc.elements[id];
    if (previous === undefined && current === undefined) continue;
    if (previous && current && sameJson(previous, current)) continue;
    beforeElements[id] = previous ? deepClone(previous) : null;
    afterElements[id] = current ? deepClone(current) : null;
    changed = true;
  }
  if (changed) {
    beforePatch.elements = beforeElements;
    afterPatch.elements = afterElements;
  }

  if (!shallowEqualArray(before.order, doc.order)) {
    beforePatch.order = [...before.order];
    afterPatch.order = [...doc.order];
    changed = true;
  }
  if (!sameJson(before.layers, doc.layers)) {
    beforePatch.layers = deepClone(before.layers);
    afterPatch.layers = deepClone(doc.layers);
    changed = true;
  }
  if (!sameJson(before.canvas, doc.canvas)) {
    beforePatch.canvas = deepClone(before.canvas);
    afterPatch.canvas = deepClone(doc.canvas);
    changed = true;
  }
  if (!sameJson(before.presets, doc.presets)) {
    beforePatch.presets = deepClone(before.presets);
    afterPatch.presets = deepClone(doc.presets);
    changed = true;
  }
  if (!before.scoped && !sameJson(before.images, doc.images)) {
    const beforeImages: Record<string, EmbeddedImage | null> = {};
    const afterImages: Record<string, EmbeddedImage | null> = {};
    const keys = new Set([...Object.keys(before.images), ...Object.keys(doc.images)]);
    for (const key of keys) {
      beforeImages[key] = before.images[key] ? deepClone(before.images[key]!) : null;
      afterImages[key] = doc.images[key] ? deepClone(doc.images[key]) : null;
    }
    beforePatch.images = beforeImages;
    afterPatch.images = afterImages;
    changed = true;
  }
  // Title and description are user-visible; timestamps are not worth an entry.
  if (
    before.meta.title !== doc.meta.title ||
    before.meta.author !== doc.meta.author ||
    before.meta.description !== doc.meta.description
  ) {
    beforePatch.meta = { ...before.meta };
    afterPatch.meta = { ...doc.meta };
    changed = true;
  }

  return { before: beforePatch, after: afterPatch, changed };
}

export function applyPatch(doc: FlowsharkDocument, patch: DocumentPatch): void {
  if (patch.elements) {
    for (const [id, element] of Object.entries(patch.elements)) {
      if (element === null) delete doc.elements[id];
      else doc.elements[id] = deepClone(element);
    }
  }
  if (patch.order) doc.order = [...patch.order];
  if (patch.layers) doc.layers = deepClone(patch.layers);
  if (patch.canvas) doc.canvas = deepClone(patch.canvas);
  if (patch.meta) doc.meta = { ...patch.meta };
  if (patch.presets) doc.presets = deepClone(patch.presets);
  if (patch.images) {
    for (const [id, image] of Object.entries(patch.images)) {
      if (image === null) delete doc.images[id];
      else doc.images[id] = deepClone(image);
    }
  }
}

function mergePatches(older: DocumentPatch, newer: DocumentPatch): DocumentPatch {
  return {
    elements: older.elements || newer.elements
      ? { ...newer.elements, ...older.elements }
      : undefined,
    order: older.order ?? newer.order,
    layers: older.layers ?? newer.layers,
    canvas: older.canvas ?? newer.canvas,
    meta: older.meta ?? newer.meta,
    presets: older.presets ?? newer.presets,
    images: older.images || newer.images
      ? { ...newer.images, ...older.images }
      : undefined,
  };
}

function mergeAfter(older: DocumentPatch, newer: DocumentPatch): DocumentPatch {
  return {
    elements: older.elements || newer.elements
      ? { ...older.elements, ...newer.elements }
      : undefined,
    order: newer.order ?? older.order,
    layers: newer.layers ?? older.layers,
    canvas: newer.canvas ?? older.canvas,
    meta: newer.meta ?? older.meta,
    presets: newer.presets ?? older.presets,
    images: older.images || newer.images
      ? { ...older.images, ...newer.images }
      : undefined,
  };
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private depth = 0;
  private pending: Snapshot | null = null;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoLabel(): string | null {
    return this.undoStack[this.undoStack.length - 1]?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack[this.redoStack.length - 1]?.label ?? null;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /**
   * Run `action` against `doc` and record the change. Returns true when the
   * document actually changed.
   */
  transact(
    doc: FlowsharkDocument,
    label: string,
    selectionBefore: readonly ElementId[],
    action: () => void,
    getSelectionAfter: () => readonly ElementId[],
    options: TransactionOptions = {},
  ): boolean {
    // Nested transactions join the outer one.
    if (this.depth > 0) {
      action();
      return true;
    }

    this.depth = 1;
    this.pending = snapshot(doc, options.scope);
    try {
      action();
    } finally {
      this.depth = 0;
    }

    const before = this.pending;
    this.pending = null;
    if (!before) return false;

    const result = diff(before, doc);
    if (!result.changed) return false;
    if (options.transient) return true;

    const now = Date.now();
    const entry: HistoryEntry = {
      label,
      before: result.before,
      after: result.after,
      selectionBefore: [...selectionBefore],
      selectionAfter: [...getSelectionAfter()],
      coalesceKey: options.coalesceKey ?? null,
      timestamp: now,
    };

    const previous = this.undoStack[this.undoStack.length - 1];
    if (
      previous &&
      entry.coalesceKey &&
      previous.coalesceKey === entry.coalesceKey &&
      now - previous.timestamp <= COALESCE_WINDOW_MS
    ) {
      previous.before = mergePatches(previous.before, entry.before);
      previous.after = mergeAfter(previous.after, entry.after);
      previous.selectionAfter = entry.selectionAfter;
      previous.timestamp = now;
    } else {
      this.undoStack.push(entry);
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.redoStack = [];
    return true;
  }

  undo(doc: FlowsharkDocument): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    applyPatch(doc, entry.before);
    this.redoStack.push(entry);
    return entry;
  }

  redo(doc: FlowsharkDocument): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    applyPatch(doc, entry.after);
    this.undoStack.push(entry);
    return entry;
  }

  /** Stop the next action from merging with the previous one. */
  breakCoalescing(): void {
    const previous = this.undoStack[this.undoStack.length - 1];
    if (previous) previous.coalesceKey = null;
  }
}
