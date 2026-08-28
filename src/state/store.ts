/**
 * Application state.
 *
 * One store holds the document, the selection, the viewport, and the UI flags.
 * Views subscribe and are told which slices changed, so a style edit does not
 * force a full canvas rebuild and a pan does not rebuild the inspector.
 */

import type { Point, Rect } from '../model/geometry';
import { clamp } from '../model/geometry';
import { createEmptyDocument } from '../model/defaults';
import type { ElementId, FlowsharkDocument } from '../model/types';
import { History, type TransactionOptions } from '../commands/history';

export type ToolId = 'select' | 'shape' | 'connector' | 'text' | 'pan';

export type StateSlice =
  | 'document'
  | 'selection'
  | 'view'
  | 'tool'
  | 'ui'
  | 'history'
  | 'file'
  | 'preferences'
  /**
   * The status-bar message only. It has its own slice because it changes on
   * every pointer move during a drag, and the panels must not rebuild for it.
   */
  | 'status';

export interface ViewState {
  zoom: number;
  /** Canvas coordinate shown at the top-left of the viewport. */
  offset: Point;
  /** Viewport size in CSS pixels. */
  viewport: { width: number; height: number };
}

export interface Guide {
  orientation: 'horizontal' | 'vertical';
  /** Canvas coordinate of the guide line. */
  position: number;
  /** Extent of the guide, used to draw only as far as it is relevant. */
  from: number;
  to: number;
  /** Equal-spacing guides are drawn with a different decoration. */
  kind: 'align' | 'spacing';
  label?: string;
}

export interface UiState {
  sidebarVisible: boolean;
  inspectorVisible: boolean;
  statusBarVisible: boolean;
  minimapVisible: boolean;
  shapeSearch: string;
  recentShapes: string[];
  /** Shape key armed for the shape tool. */
  pendingShape: string;
  /** Connector kind armed for the connector tool. */
  pendingConnector: 'straight' | 'elbow' | 'curved' | 'step' | 'freeform';
  /** Element currently being edited inline, and the label within it. */
  editing: { elementId: ElementId; labelId: string | null } | null;
  marquee: Rect | null;
  guides: Guide[];
  statusMessage: string;
}

export interface Preferences {
  appearance: 'system' | 'light' | 'dark';
  autoSave: boolean;
  autoSaveIntervalSeconds: number;
  showWelcomeOnLaunch: boolean;
  defaultConnectorKind: UiState['pendingConnector'];
  reduceMotion: 'system' | 'always';
  exportScale: 1 | 2 | 3;
}

export interface FileState {
  path: string | null;
  dirty: boolean;
  /** Most recently opened paths, newest first. */
  recent: string[];
}

export interface AppState {
  document: FlowsharkDocument;
  selection: ElementId[];
  view: ViewState;
  tool: ToolId;
  ui: UiState;
  file: FileState;
  preferences: Preferences;
}

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;

const PREFERENCES_KEY = 'flowshark.preferences';
const RECENT_KEY = 'flowshark.recentFiles';
const MAX_RECENT = 12;

function defaultPreferences(): Preferences {
  return {
    appearance: 'system',
    autoSave: true,
    autoSaveIntervalSeconds: 30,
    showWelcomeOnLaunch: true,
    defaultConnectorKind: 'elbow',
    reduceMotion: 'system',
    exportScale: 2,
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as object) } as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in a private window; preferences are optional.
  }
}

export type Listener = (changed: ReadonlySet<StateSlice>) => void;

export class Store {
  readonly history = new History();

  private state: AppState;
  private listeners = new Set<Listener>();
  private changed = new Set<StateSlice>();
  private notifyScheduled = false;
  private batchDepth = 0;
  private revision = 0;

  constructor(document: FlowsharkDocument = createEmptyDocument()) {
    this.state = {
      document,
      selection: [],
      view: { zoom: 1, offset: { x: -80, y: -80 }, viewport: { width: 1200, height: 800 } },
      tool: 'select',
      ui: {
        sidebarVisible: true,
        inspectorVisible: true,
        statusBarVisible: true,
        minimapVisible: false,
        shapeSearch: '',
        recentShapes: [],
        pendingShape: 'process',
        pendingConnector: 'elbow',
        editing: null,
        marquee: null,
        guides: [],
        statusMessage: '',
      },
      file: {
        path: null,
        dirty: false,
        recent: readJson<{ list: string[] }>(RECENT_KEY, { list: [] }).list,
      },
      preferences: readJson(PREFERENCES_KEY, defaultPreferences()),
    };
  }

  getState(): Readonly<AppState> {
    return this.state;
  }

  /**
   * A counter that advances every time the document changes.
   *
   * Saving is asynchronous and the editor stays live while it runs, so
   * "is this document still the one I serialised?" cannot be answered by the
   * dirty flag alone — the flag is a boolean and the write clears it. Capturing
   * the revision before a write and comparing it afterwards is what stops an
   * edit made mid-save from being marked as saved and then lost.
   */
  get documentRevision(): number {
    return this.revision;
  }

  get document(): FlowsharkDocument {
    return this.state.document;
  }

  get selection(): readonly ElementId[] {
    return this.state.selection;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Group several updates into a single notification. */
  batch(fn: () => void): void {
    this.batchDepth += 1;
    try {
      fn();
    } finally {
      this.batchDepth -= 1;
      this.flush();
    }
  }

  markChanged(...slices: StateSlice[]): void {
    for (const slice of slices) this.changed.add(slice);
    // Every path that changes the document funnels through here, so this is
    // the one place the revision can be advanced without a caller forgetting.
    // It reads the argument rather than the pending set, which still holds
    // earlier slices until the next flush and would double-count.
    if (slices.includes('document')) this.revision += 1;
    this.flush();
  }

  private flush(): void {
    if (this.batchDepth > 0 || this.changed.size === 0 || this.notifyScheduled) return;
    this.notifyScheduled = true;
    const dispatch = (): void => {
      this.notifyScheduled = false;
      const changed = this.changed;
      this.changed = new Set();
      for (const listener of [...this.listeners]) listener(changed);
    };
    // Coalesce bursts of updates into one render per frame.
    if (typeof queueMicrotask === 'function') queueMicrotask(dispatch);
    else dispatch();
  }

  // -------------------------------------------------------------------------
  // Document
  // -------------------------------------------------------------------------

  /** Run a document edit inside a history transaction. */
  mutate(label: string, action: () => void, options: TransactionOptions = {}): boolean {
    const selectionBefore = [...this.state.selection];
    const changed = this.history.transact(
      this.state.document,
      label,
      selectionBefore,
      action,
      () => this.state.selection,
      options,
    );
    if (changed) {
      this.state.file.dirty = true;
      this.markChanged('document', 'history', 'file');
    }
    return changed;
  }

  undo(): boolean {
    const entry = this.history.undo(this.state.document);
    if (!entry) return false;
    this.state.selection = entry.selectionBefore.filter(
      (id) => id in this.state.document.elements,
    );
    this.state.file.dirty = true;
    this.state.ui.editing = null;
    this.markChanged('document', 'selection', 'history', 'file', 'ui');
    return true;
  }

  redo(): boolean {
    const entry = this.history.redo(this.state.document);
    if (!entry) return false;
    this.state.selection = entry.selectionAfter.filter(
      (id) => id in this.state.document.elements,
    );
    this.state.file.dirty = true;
    this.state.ui.editing = null;
    this.markChanged('document', 'selection', 'history', 'file', 'ui');
    return true;
  }

  replaceDocument(document: FlowsharkDocument, path: string | null, dirty = false): void {
    this.state.document = document;
    this.state.selection = [];
    this.state.ui.editing = null;
    this.state.file.path = path;
    this.state.file.dirty = dirty;
    this.history.clear();
    if (path) this.addRecentFile(path);
    this.markChanged('document', 'selection', 'history', 'file', 'ui');
  }

  /**
   * Record that `path` now holds the document as it stood at `savedRevision`.
   *
   * The dirty flag is cleared only when nothing has changed since that
   * revision. The editor stays live while a save is in flight, so an edit made
   * during the write is still unsaved when the write finishes; clearing the
   * flag unconditionally would hide it from the close prompt and from
   * automatic saving, and the edit would be lost.
   */
  markSaved(path: string, savedRevision: number): void {
    this.state.file.path = path;
    this.state.file.dirty = this.revision !== savedRevision;
    this.addRecentFile(path);
    this.markChanged('file');
  }

  addRecentFile(path: string): void {
    const recent = [path, ...this.state.file.recent.filter((item) => item !== path)];
    this.state.file.recent = recent.slice(0, MAX_RECENT);
    writeJson(RECENT_KEY, { list: this.state.file.recent });
    this.markChanged('file');
  }

  /**
   * Replace the remembered documents wholesale.
   *
   * Used at start-up on macOS, where the authoritative list lives in the
   * native layer: it is the record of which files the user actually chose, and
   * only those can be reopened without choosing again.
   */
  setRecentFiles(paths: readonly string[]): void {
    this.state.file.recent = paths.slice(0, MAX_RECENT);
    writeJson(RECENT_KEY, { list: this.state.file.recent });
    this.markChanged('file');
  }

  clearRecentFiles(): void {
    this.state.file.recent = [];
    writeJson(RECENT_KEY, { list: [] });
    this.markChanged('file');
  }

  // -------------------------------------------------------------------------
  // Selection
  // -------------------------------------------------------------------------

  setSelection(ids: readonly ElementId[]): void {
    const filtered = ids.filter((id) => id in this.state.document.elements);
    if (
      filtered.length === this.state.selection.length &&
      filtered.every((id, index) => this.state.selection[index] === id)
    ) {
      return;
    }
    this.state.selection = filtered;
    this.markChanged('selection');
  }

  toggleSelection(id: ElementId): void {
    const current = new Set(this.state.selection);
    if (current.has(id)) current.delete(id);
    else current.add(id);
    this.setSelection([...current]);
  }

  addToSelection(ids: readonly ElementId[]): void {
    this.setSelection([...new Set([...this.state.selection, ...ids])]);
  }

  clearSelection(): void {
    this.setSelection([]);
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------

  setView(patch: Partial<ViewState>): void {
    const next = { ...this.state.view, ...patch };
    next.zoom = clamp(next.zoom, MIN_ZOOM, MAX_ZOOM);
    this.state.view = next;
    this.markChanged('view');
  }

  /** Zoom about a fixed point in viewport (screen) coordinates. */
  zoomAt(screenPoint: Point, factor: number): void {
    const { zoom, offset } = this.state.view;
    const nextZoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    if (nextZoom === zoom) return;
    const canvasX = offset.x + screenPoint.x / zoom;
    const canvasY = offset.y + screenPoint.y / zoom;
    this.setView({
      zoom: nextZoom,
      offset: { x: canvasX - screenPoint.x / nextZoom, y: canvasY - screenPoint.y / nextZoom },
    });
  }

  panBy(dx: number, dy: number): void {
    const { offset, zoom } = this.state.view;
    this.setView({ offset: { x: offset.x + dx / zoom, y: offset.y + dy / zoom } });
  }

  // -------------------------------------------------------------------------
  // Tool and UI
  // -------------------------------------------------------------------------

  setTool(tool: ToolId): void {
    if (this.state.tool === tool) return;
    this.state.tool = tool;
    this.markChanged('tool');
  }

  setUi(patch: Partial<UiState>): void {
    this.state.ui = { ...this.state.ui, ...patch };
    this.markChanged('ui');
  }

  setStatusMessage(message: string): void {
    if (this.state.ui.statusMessage === message) return;
    this.state.ui.statusMessage = message;
    this.markChanged('status');
  }

  noteShapeUse(shapeKey: string): void {
    const recent = [shapeKey, ...this.state.ui.recentShapes.filter((k) => k !== shapeKey)];
    this.setUi({ recentShapes: recent.slice(0, 12) });
  }

  setPreferences(patch: Partial<Preferences>): void {
    this.state.preferences = { ...this.state.preferences, ...patch };
    writeJson(PREFERENCES_KEY, this.state.preferences);
    this.markChanged('preferences');
  }
}
