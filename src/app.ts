/**
 * The application controller.
 *
 * This module owns the store, the canvas, the panels, and the command
 * registry, and it is where the front end meets the platform layer. Everything
 * a user can do is registered here as a command, which the menu bar, the
 * toolbar, the context menus, and the keyboard all drive.
 */

import { Store, type Preferences, type ToolId } from './state/store';
import { CanvasRenderer, emptyOverlayState } from './canvas/renderer';
import { CanvasInteraction } from './canvas/interaction';
import { InlineTextEditor } from './text/editor';
import { CommandRegistry, type CommandDefinition } from './commands/registry';
import { Toolbar } from './ui/toolbar';
import { Sidebar } from './ui/sidebar';
import { Inspector } from './ui/inspector';
import { StatusBar } from './ui/statusbar';
import { ContextMenu, contextMenuFor } from './ui/context-menu';
import { FallbackMenuBar } from './ui/fallback-menu';
import { NativeMenu } from './platform/menu';
import { announce, showToast } from './ui/toast';
import {
  closeDialog,
  isDialogOpen,
  showAbout,
  showExportDialog,
  showFind,
  showSettings,
  showShortcutReference,
  showTemplateChooser,
  type ExportFormat,
  type ExportRequest,
} from './ui/dialogs';
import { requireElement } from './util/dom';
import {
  addConnectorLabel,
  addShape,
  alignSelection,
  applyPreset,
  copyStyle,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  groupSelection,
  hasCopiedStyle,
  matchSize,
  nudgeSelection,
  orderSelection,
  pasteStyle,
  resetStyle,
  scopeFor,
  selectAll,
  selectConnected,
  selectionBounds,
  setHidden,
  setLocked,
  ungroupSelection,
  updateShapeStyle,
  updateTextStyle,
} from './commands/actions';
import {
  addElement,
  documentBounds,
  refreshConnectorPoints,
  rootOf,
  visibleElements,
} from './model/document';
import { createEmptyDocument, defaultShapeStyle } from './model/defaults';
import {
  isConnector,
  isGroup,
  isShape,
  type ElementId,
  type FlowsharkDocument,
} from './model/types';
import {
  DocumentFormatError,
  deepClone,
  fromRaw,
  parseDocument,
  serializeDocument,
} from './model/serialization';
import { createId } from './model/ids';
import { TEMPLATES, getTemplate, type TemplateDefinition } from './templates';
import { buildStandaloneSvg } from './io/export-svg';
import { exportRaster } from './io/export-raster';
import { exportPdf } from './io/export-pdf';
import { exportFileName, type ExportOptions } from './io/export';
import {
  DOCUMENT_EXTENSION,
  askToDiscardChanges,
  chooseSavePath,
  clearRecentDocuments,
  fileFingerprint,
  grantRecentDocument,
  recentDocuments,
  revokeHandle,
  type FileHandle,
  openDocumentDialog,
  openImageDialog,
  readDocument,
  revealInFinder,
  showMessage,
  writeBinaryFile,
  writeTextFile,
} from './platform/files';
import {
  ELEMENT_CLIPBOARD_MARKER,
  readImage as readPasteboardImage,
  readText as readClipboardText,
  writeDiagram,
  writeText as writeClipboardText,
} from './platform/clipboard';
import {
  beginFileDrag,
  canShare,
  shareFiles,
  writeTemporaryFile,
} from './platform/sharing';
import { describeDiagram } from './io/describe';
import { onFileDrop, readFileBytes } from './platform/dragdrop';
import {
  IMPORTABLE_IMAGE_TYPES,
  imageTypeForPath,
  importImage,
  isDocumentPath,
  rgbaToPng,
} from './io/import';
import { applyHostAttributes, isNative } from './platform/environment';
import {
  closeWindow,
  onOpenFileRequest,
  openNewWindow,
  pendingLaunchFile,
  printWindow,
  setWindowTitle,
} from './platform/window';

const AUTOSAVE_KEY = 'flowshark.recovery';

export class FlowSharkApp {
  private readonly store = new Store(createEmptyDocument());
  private readonly registry = new CommandRegistry();
  private readonly renderer: CanvasRenderer;
  private readonly interaction: CanvasInteraction;
  private readonly editor: InlineTextEditor;
  private readonly toolbar: Toolbar;
  private readonly sidebar: Sidebar;
  private readonly inspector: Inspector;
  private readonly statusBar: StatusBar;
  private readonly contextMenu: ContextMenu;
  private readonly nativeMenu: NativeMenu;
  private readonly fallbackMenu: FallbackMenuBar;

  private readonly surface: HTMLElement;
  private autosaveTimer: number | null = null;
  /**
   * What the document's file looked like when it was last read or written.
   *
   * `null` means there is nothing to compare against — no file yet, or the
   * browser build, where there is no filesystem to ask.
   */
  private lastKnownFingerprint: string | null = null;
  /**
   * Permission to read and write the open document.
   *
   * `store.file.path` is the same file's path, kept for the title bar and the
   * recent-documents menu. Showing a path is not permission to use it, so the
   * two are deliberately separate: this is what every read and write quotes.
   */
  private fileHandle: FileHandle | null = null;
  /** Serialises writes so two saves can never be in flight at once. */
  private saveQueue: Promise<void> = Promise.resolve();
  /** Document revision the last recovery snapshot captured. */
  private lastSnapshotRevision = -1;
  private overlayFrame = 0;
  private menuSyncTimer: number | null = null;

  constructor() {
    this.surface = requireElement<HTMLElement>('canvas-scroll');
    this.renderer = new CanvasRenderer(this.store, {
      scroll: this.surface,
      canvas: requireElement<SVGSVGElement>('canvas'),
      defs: requireElement<SVGDefsElement>('canvas-defs'),
      root: requireElement<SVGGElement>('canvas-root'),
      overlay: requireElement<SVGSVGElement>('overlay'),
      overlayRoot: requireElement<SVGGElement>('overlay-root'),
      outline: requireElement<HTMLElement>('diagram-outline'),
    });
    this.editor = new InlineTextEditor(
      this.store,
      this.renderer,
      requireElement<HTMLElement>('text-editor-layer'),
      { onCommit: () => this.surface.focus({ preventScroll: true }) },
    );
    this.interaction = new CanvasInteraction(this.store, this.renderer, this.surface, {
      beginTextEdit: (id, labelId) => this.editor.begin(id, labelId ?? null),
      showContextMenu: (event, id) => {
        const kind = id ? this.store.document.elements[id]?.kind ?? null : null;
        this.contextMenu.show(event.clientX, event.clientY, contextMenuFor(kind));
      },
      refreshOverlay: () => this.scheduleOverlay(),
      announce: (message) => this.store.setStatusMessage(message),
      filesDropped: (files, at) => void this.handleBrowserFileDrop(files, at),
    });
    this.toolbar = new Toolbar(this.store, this.registry);
    this.sidebar = new Sidebar(this.store, this.registry);
    this.inspector = new Inspector(this.store, this.registry);
    this.statusBar = new StatusBar(this.store, this.registry);
    this.contextMenu = new ContextMenu(this.registry);
    this.nativeMenu = new NativeMenu(this.registry);
    this.fallbackMenu = new FallbackMenuBar(this.registry);
  }

  // -------------------------------------------------------------------------
  // Start-up
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    applyHostAttributes();
    this.registerCommands();
    this.applyPreferences();

    this.toolbar.mount();
    const exportButton = document.querySelector<HTMLElement>('[data-command="file.export"]');
    if (exportButton) {
      this.makeDragSource(exportButton);
      exportButton.title = `${exportButton.title} — drag to copy the diagram out`;
    }
    this.sidebar.mount();
    this.inspector.mount();
    this.statusBar.mount();
    this.interaction.attach();

    this.store.subscribe((changed) => this.onStateChange(changed));
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('resize', () => this.onResize());
    window.addEventListener('beforeunload', (event) => {
      if (this.store.getState().file.dirty) {
        event.preventDefault();
        event.returnValue = '';
      }
    });
    this.surface.addEventListener('focus', () => this.scheduleOverlay());
    requireElement<HTMLElement>('diagram-outline').addEventListener('focusin', (event) => {
      const id = (event.target as HTMLElement).dataset.id;
      if (id) this.store.setSelection([id]);
    });

    const installed = await this.nativeMenu.install();
    if (!installed) this.fallbackMenu.mount();
    this.nativeMenu.onRecentFiles(
      () => this.recentEntries(),
      (path) => void this.openRecent(path),
    );
    this.fallbackMenu.onRecentFiles(
      () => this.recentEntries(),
      (path) => void this.openRecent(path),
    );

    // Rust keeps the authoritative list of documents the user has chosen, so
    // the menu is seeded from there rather than from browser storage, which
    // would let a stale entry claim a permission that was never granted.
    await this.seedRecentDocuments();

    await onOpenFileRequest((handle) => void this.openHandle(handle));
    await onFileDrop((event) => void this.handleFileDrop(event.files, event.position));
    const launchFile = await pendingLaunchFile();

    this.onResize();
    if (launchFile) {
      await this.openHandle(launchFile);
    } else if (!(await this.offerRecovery())) {
      const template = getTemplate('basic-flowchart');
      if (template) this.loadTemplate(template, false);
      if (this.store.getState().preferences.showWelcomeOnLaunch) {
        showTemplateChooser((chosen) => this.loadTemplate(chosen, true));
      }
    }

    this.renderer.renderScene();
    this.zoomToFit();
    this.refreshAll();
    this.startAutosave();
  }

  private applyPreferences(): void {
    const preferences = this.store.getState().preferences;
    document.documentElement.dataset.appearance = preferences.appearance;
    document.documentElement.dataset.reduceMotion = preferences.reduceMotion;
    this.store.setUi({ pendingConnector: preferences.defaultConnectorKind });
  }

  /** Replace the remembered documents with the ones Rust will actually grant. */
  private async seedRecentDocuments(): Promise<void> {
    if (!isNative()) return;
    const known = await recentDocuments();
    this.store.setRecentFiles(known);
  }

  private recentEntries(): Array<{ path: string; title: string }> {
    return this.store.getState().file.recent.map((path) => ({
      path,
      title: path.split('/').pop() ?? path,
    }));
  }

  // -------------------------------------------------------------------------
  // State plumbing
  // -------------------------------------------------------------------------

  private onStateChange(changed: ReadonlySet<string>): void {
    // A status message changes on every pointer move during a drag. Nothing
    // else may rebuild for it.
    if (changed.size === 1 && changed.has('status')) {
      this.statusBar.sync();
      return;
    }

    if (changed.has('document')) {
      this.renderer.renderScene();
      this.editor.reposition();
    }
    if (changed.has('view')) {
      this.renderer.updateTransform();
      this.editor.reposition();
    }
    if (changed.has('selection') || changed.has('document')) {
      this.inspector.update(changed.has('selection'));
      this.renderer.renderOutline();
    }
    if (changed.has('ui')) {
      this.sidebar.syncSearchField();
      this.sidebar.render();
      this.sidebar.setVisible(this.store.getState().ui.sidebarVisible);
      this.inspector.setVisible(this.store.getState().ui.inspectorVisible);
      this.statusBar.setVisible(this.store.getState().ui.statusBarVisible);
    }
    if (changed.has('tool')) {
      this.surface.dataset.tool = this.store.getState().tool;
      this.sidebar.render();
    }
    if (changed.has('preferences')) this.applyPreferences();
    if (changed.has('file')) void this.updateWindowTitle();

    this.scheduleOverlay();
    this.toolbar.sync();
    this.statusBar.sync();
    this.scheduleMenuSync();
  }

  /**
   * Pushing enabled and checked state into the native menu crosses the
   * process boundary, so it is coalesced rather than run on every change.
   */
  private scheduleMenuSync(): void {
    if (this.menuSyncTimer !== null) return;
    this.menuSyncTimer = window.setTimeout(() => {
      this.menuSyncTimer = null;
      void this.nativeMenu.sync();
    }, 120);
  }

  private refreshAll(): void {
    this.surface.dataset.tool = this.store.getState().tool;
    this.sidebar.setVisible(this.store.getState().ui.sidebarVisible);
    this.inspector.setVisible(this.store.getState().ui.inspectorVisible);
    this.statusBar.setVisible(this.store.getState().ui.statusBarVisible);
    this.inspector.update(true);
    this.toolbar.sync();
    this.statusBar.sync();
    this.scheduleOverlay();
    void this.updateWindowTitle();
    this.scheduleMenuSync();
  }

  private scheduleOverlay(): void {
    if (this.overlayFrame) return;
    this.overlayFrame = requestAnimationFrame(() => {
      this.overlayFrame = 0;
      this.renderer.renderOverlay();
    });
  }

  private onResize(): void {
    const { width, height } = this.renderer.viewportSize();
    this.store.setView({ viewport: { width, height } });
    this.editor.reposition();
  }

  private async updateWindowTitle(): Promise<void> {
    const state = this.store.getState();
    const edited = state.file.dirty ? ' — Edited' : '';
    await setWindowTitle(`${state.document.meta.title || 'Untitled'}${edited}`);
  }

  // -------------------------------------------------------------------------
  // Keyboard
  // -------------------------------------------------------------------------

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.editor.isEditing) return;
    const target = event.target as HTMLElement | null;
    const inField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target?.isContentEditable === true;

    if (isDialogOpen() && event.key !== 'Escape') return;

    // Commands with accelerators work everywhere except inside a text field,
    // where the system's own editing shortcuts must win.
    if (!inField || event.metaKey) {
      const command = this.registry.matching(event);
      if (command) {
        event.preventDefault();
        this.registry.run(command.id);
        return;
      }
    }
    if (inField) return;

    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (this.store.selection.length === 0) return;
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
        const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
        nudgeSelection(this.store, dx, dy);
        return;
      }
      case 'Tab': {
        event.preventDefault();
        this.stepSelection(event.shiftKey ? -1 : 1);
        return;
      }
      case 'Enter': {
        const id = this.store.selection[0];
        if (!id) return;
        event.preventDefault();
        const element = this.store.document.elements[id];
        if (isShape(element)) this.editor.begin(id);
        else if (isConnector(element) && element.labels[0]) {
          this.editor.begin(id, element.labels[0].id);
        }
        return;
      }
      case 'Escape': {
        if (isDialogOpen()) {
          closeDialog();
          return;
        }
        this.contextMenu.hide();
        if (this.store.getState().tool !== 'select') this.store.setTool('select');
        else this.store.clearSelection();
        return;
      }
      default:
        break;
    }
  };

  /** Move the selection to the next or previous element in z-order. */
  private stepSelection(direction: 1 | -1): void {
    const doc = this.store.document;
    const elements = visibleElements(doc).filter((element) => !element.locked);
    if (elements.length === 0) return;
    const current = this.store.selection[0];
    const index = elements.findIndex((element) => element.id === current);
    const next = elements[(index + direction + elements.length) % elements.length];
    this.store.setSelection([rootOf(doc, next.id)]);
    this.scrollSelectionIntoView();
    const node = requireElement<HTMLElement>('diagram-outline').querySelector<HTMLElement>(
      `[data-id="${next.id}"]`,
    );
    node?.focus();
  }

  private scrollSelectionIntoView(): void {
    const bounds = selectionBounds(this.store);
    if (!bounds) return;
    const view = this.renderer.visibleRegion();
    const margin = 40 / this.store.getState().view.zoom;
    let { x, y } = this.store.getState().view.offset;
    if (bounds.x < view.x + margin) x = bounds.x - margin;
    if (bounds.y < view.y + margin) y = bounds.y - margin;
    if (bounds.x + bounds.width > view.x + view.width - margin) {
      x = bounds.x + bounds.width - view.width + margin;
    }
    if (bounds.y + bounds.height > view.y + view.height - margin) {
      y = bounds.y + bounds.height - view.height + margin;
    }
    this.store.setView({ offset: { x, y } });
  }

  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  private async confirmDiscard(): Promise<boolean> {
    if (!this.store.getState().file.dirty) return true;
    return askToDiscardChanges(this.store.document.meta.title || 'Untitled');
  }

  private loadTemplate(template: TemplateDefinition, markDirty: boolean): void {
    this.lastKnownFingerprint = null;
    void this.replaceHandle(null);
    this.store.replaceDocument(template.build(), null, markDirty);
    this.renderer.renderScene();
    this.zoomToFit();
    this.refreshAll();
  }

  async newDocument(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    this.lastKnownFingerprint = null;
    void this.replaceHandle(null);
    this.store.replaceDocument(createEmptyDocument(), null, false);
    this.renderer.renderScene();
    this.store.setView({ zoom: 1, offset: { x: -80, y: -80 } });
    this.refreshAll();
    showToast('New document created.');
  }

  newFromTemplate(): void {
    showTemplateChooser(async (template) => {
      if (!(await this.confirmDiscard())) return;
      this.loadTemplate(template, false);
      showToast(`Created a diagram from the ${template.name} template.`);
    });
  }

  async open(): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const result = await openDocumentDialog();
      if (!result) return;
      await this.applyLoadedDocument(result.contents, result.handle);
    } catch (error) {
      await this.reportError('The document could not be opened.', error);
    }
  }

  /** Open a document FlowShark has been granted permission to read. */
  async openHandle(handle: FileHandle): Promise<void> {
    if (!(await this.confirmDiscard())) return;
    try {
      const contents = await readDocument(handle);
      await this.applyLoadedDocument(contents, handle);
    } catch (error) {
      await this.reportError('The document could not be opened.', error);
    }
  }

  /**
   * Open something from the recent-documents menu.
   *
   * The path goes to Rust to be exchanged for permission, and Rust refuses
   * unless it already knows the user chose that file. A menu entry is a
   * reminder, not an authorisation.
   */
  async openRecent(path: string): Promise<void> {
    const handle = await grantRecentDocument(path);
    if (!handle) {
      await this.reportError(
        'That document can no longer be opened from this menu.',
        new Error(`FlowShark has no record of you choosing ${path}. Open it again.`),
      );
      return;
    }
    await this.openHandle(handle);
  }

  private async applyLoadedDocument(contents: string, handle: FileHandle): Promise<void> {
    const doc = parseDocument(contents);
    // Clear first and capture before returning. Leaving the previous
    // document's fingerprint in place, even briefly, would have the next save
    // compare this file against the last one.
    this.lastKnownFingerprint = null;
    void this.replaceHandle(handle);
    this.store.replaceDocument(doc, handle.path, false);
    this.renderer.renderScene();
    this.zoomToFit();
    this.refreshAll();
    this.lastKnownFingerprint = await fileFingerprint(handle);
    void this.nativeMenu.rebuild();
    showToast(`Opened ${doc.meta.title}.`);
  }

  /** Take permission for a new document and give up the previous one. */
  private async replaceHandle(handle: FileHandle | null): Promise<void> {
    const previous = this.fileHandle;
    this.fileHandle = handle;
    if (previous && previous.token !== handle?.token) await revokeHandle(previous);
  }

  async save(): Promise<boolean> {
    const handle = this.fileHandle;
    if (!handle) return this.saveAs();
    return this.writeDocument(handle);
  }

  async saveAs(): Promise<boolean> {
    const suggested = `${this.store.document.meta.title || 'Untitled'}.${DOCUMENT_EXTENSION}`;
    const handle = await chooseSavePath(suggested);
    if (!handle) return false;
    await this.replaceHandle(handle);
    return this.writeDocument(handle);
  }

  /**
   * Run one write at a time.
   *
   * Two saves overlapping is not merely wasteful. Both serialise the document,
   * both write, and — because the Rust side names its temporary file after the
   * target — both write through the *same* temporary path before renaming it
   * over the document. Interleaved, that produces a file holding parts of two
   * payloads. Automatic saving fires on a timer and the user can press ⌘S at
   * any moment, so the two really can meet.
   */
  private enqueueSave(task: () => Promise<boolean>): Promise<boolean> {
    const result = this.saveQueue.then(task, task);
    // Keep the chain usable after a rejected save.
    this.saveQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private writeDocument(
    handle: FileHandle,
    options: { silent?: boolean } = {},
  ): Promise<boolean> {
    return this.enqueueSave(() => this.performWrite(handle, options));
  }

  private async performWrite(
    handle: FileHandle,
    options: { silent?: boolean } = {},
  ): Promise<boolean> {
    const silent = options.silent === true;
    try {
      // Warn if the file changed underneath us — iCloud Drive and Dropbox do
      // this, and silently overwriting someone else's edit is not acceptable.
      if (await this.fileChangedUnderneath(handle)) {
        if (silent) {
          // An automatic save must not put a modal question on screen with
          // nobody there to answer it. Leave the document dirty and say so;
          // the next explicit save asks properly.
          showToast(
            'The file on disk has changed, so automatic saving has paused. Save to resolve it.',
            'warning',
            6000,
          );
          return false;
        }
        const overwrite = await askToDiscardChanges(
          `${this.store.document.meta.title} (the file on disk changed since you opened it)`,
        );
        if (!overwrite) return false;
      }

      // Capture the revision alongside the text. The editor stays live across
      // the await below, so by the time the write lands the document may have
      // moved on, and only this pair can tell.
      const revision = this.store.documentRevision;
      const modified = new Date().toISOString();
      const text = serializeDocument(this.store.document, true, modified);

      await writeTextFile(handle, text);

      // Keep the in-memory timestamp in step with what actually reached disk.
      this.store.document.meta.modified = modified;
      this.store.markSaved(handle.path, revision);
      this.lastKnownFingerprint = await fileFingerprint(handle);
      if (this.store.documentRevision === revision) this.clearRecovery();
      void this.nativeMenu.rebuild();
      if (!silent) showToast('Saved.');
      return true;
    } catch (error) {
      if (silent) {
        showToast('Automatic saving failed. Save to see why.', 'warning', 6000);
        return false;
      }
      await this.reportError('The document could not be saved.', error);
      return false;
    }
  }

  /**
   * True when the file is not the one FlowShark last read or wrote.
   *
   * The previous test asked whether the modification time was more than a
   * second *newer*. An equal, older, or coarse timestamp slipped through, and
   * a sync service resolving a conflict or a restore from backup produces
   * exactly those. Comparing a fingerprint catches any difference.
   */
  private async fileChangedUnderneath(handle: FileHandle): Promise<boolean> {
    if (this.lastKnownFingerprint === null) return false;
    const current = await fileFingerprint(handle);
    // A file that cannot be read is not evidence of a conflict; the write
    // itself will report the real problem.
    if (current === null) return false;
    return current !== this.lastKnownFingerprint;
  }

  async revert(): Promise<void> {
    const handle = this.fileHandle;
    if (!handle) return;
    if (!(await askToDiscardChanges(this.store.document.meta.title))) return;
    try {
      await this.applyLoadedDocument(await readDocument(handle), handle);
    } catch (error) {
      await this.reportError('The document could not be reloaded.', error);
    }
  }

  private async reportError(title: string, error: unknown): Promise<void> {
    const detail =
      error instanceof DocumentFormatError
        ? `${error.message}${error.detail ? `\n\n${error.detail}` : ''}`
        : error instanceof Error
          ? error.message
          : String(error);
    showToast(title, 'error', 6000);
    await showMessage(title, detail, 'error');
  }

  // -------------------------------------------------------------------------
  // Automatic save and recovery
  // -------------------------------------------------------------------------

  private startAutosave(): void {
    if (this.autosaveTimer !== null) window.clearInterval(this.autosaveTimer);
    const preferences = this.store.getState().preferences;
    if (!preferences.autoSave) return;
    this.autosaveTimer = window.setInterval(
      () => this.writeRecoverySnapshot(),
      Math.max(5, preferences.autoSaveIntervalSeconds) * 1000,
    );
  }

  /**
   * Keep an unsaved copy so work survives a crash. Saved documents are written
   * back to their own file instead, when automatic saving is switched on.
   *
   * This runs on a timer with nobody necessarily watching, so it is silent: no
   * "Saved" toast, and no modal question. It also does nothing when the
   * document has not moved since the last snapshot, which matters because
   * serialising is whole-document work on the UI thread.
   */
  private writeRecoverySnapshot(): void {
    const state = this.store.getState();
    if (!state.file.dirty) return;
    const revision = this.store.documentRevision;
    if (revision === this.lastSnapshotRevision) return;

    if (this.fileHandle) {
      const handle = this.fileHandle;
      this.lastSnapshotRevision = revision;
      void this.writeDocument(handle, { silent: true }).then((written) => {
        // A refused or failed automatic save must be retried on the next tick,
        // not treated as done.
        if (!written) this.lastSnapshotRevision = -1;
      });
      return;
    }
    try {
      // The document is stored as its own JSON value rather than as a string
      // inside another one. Double-encoding escaped every quote in the
      // document and roughly doubled what had to fit in the quota.
      globalThis.localStorage?.setItem(
        AUTOSAVE_KEY,
        `{"savedAt":${JSON.stringify(new Date().toISOString())},"document":${serializeDocument(
          this.store.document,
          false,
        )}}`,
      );
      this.lastSnapshotRevision = revision;
    } catch {
      // A full or unavailable store must not interrupt editing. The quota is
      // small, so a document with photographs in it will not fit; that is why
      // the recovery snapshot is a backstop and not a substitute for saving.
    }
  }

  private clearRecovery(): void {
    try {
      globalThis.localStorage?.removeItem(AUTOSAVE_KEY);
    } catch {
      // Ignored.
    }
  }

  private async offerRecovery(): Promise<boolean> {
    let payload: { savedAt?: string; document?: unknown } | null = null;
    try {
      const raw = globalThis.localStorage?.getItem(AUTOSAVE_KEY);
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      payload = null;
    }
    // Snapshots written before the document was stored as its own JSON value
    // hold it as a string; both shapes are accepted so an upgrade does not
    // throw away work that was waiting to be recovered.
    const document = payload?.document;
    if (document === undefined || document === null) return false;

    const when = new Date(payload?.savedAt ?? '').toLocaleString();
    const restore = window.confirm(
      `FlowShark has unsaved work from ${when}. Do you want to recover it?`,
    );
    if (!restore) {
      this.clearRecovery();
      return false;
    }
    try {
      const recovered =
        typeof document === 'string' ? parseDocument(document) : fromRaw(document);
      this.lastKnownFingerprint = null;
      void this.replaceHandle(null);
      this.store.replaceDocument(recovered, null, true);
      showToast('Recovered your unsaved diagram.');
      return true;
    } catch {
      this.clearRecovery();
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Export, print, share
  // -------------------------------------------------------------------------

  private exportOptionsFrom(request: ExportRequest): ExportOptions {
    return {
      scope: request.scope,
      transparent: request.transparent,
      includeGrid: request.includeGrid,
      scale: request.scale,
      margin: request.margin,
      background: request.background,
    };
  }

  showExport(format: ExportFormat = 'png'): void {
    showExportDialog(this.store, format, (request) => void this.runExport(request));
  }

  async runExport(request: ExportRequest): Promise<void> {
    const options = this.exportOptionsFrom(request);
    const selection = this.store.selection;
    try {
      const name = exportFileName(this.store.document, request.format);
      const target = await chooseSavePath(name, request.format);
      if (!target) return;

      if (request.format === 'svg') {
        const { svg } = buildStandaloneSvg(this.store.document, options, selection);
        await writeTextFile(target, svg);
      } else if (request.format === 'pdf') {
        const result = await exportPdf(this.store.document, options, selection, 'auto');
        await writeBinaryFile(target, result.bytes, 'application/pdf');
        for (const warning of result.warnings) showToast(warning, 'warning', 7000);
      } else {
        const result = await exportRaster(this.store.document, options, selection, request.format);
        await writeBinaryFile(target, result.bytes, result.mimeType);
      }

      showToast(`Exported ${target.path.split('/').pop()}.`);
      await revealInFinder(target);
    } catch (error) {
      await this.reportError('The diagram could not be exported.', error);
    }
  }

  /** Export straight to a file with the standard options. */
  async quickExport(format: ExportFormat): Promise<void> {
    const options: ExportOptions = {
      scope: this.store.selection.length > 0 ? 'selection' : 'document',
      transparent: format === 'png' || format === 'svg',
      includeGrid: false,
      scale: this.store.getState().preferences.exportScale,
      margin: 24,
      background: '#ffffff',
    };
    await this.runExport({ ...options, format });
  }

  /** The options used when handing the diagram to another application. */
  private handoffOptions(transparent: boolean): ExportOptions {
    return {
      scope: this.store.selection.length > 0 ? 'selection' : 'document',
      transparent,
      includeGrid: false,
      scale: Math.max(this.store.getState().preferences.exportScale, 2),
      margin: 16,
      background: '#ffffff',
    };
  }

  /**
   * Copy the diagram under every pasteboard type at once, so each receiving
   * application takes the representation it handles best.
   */
  async copyAsImage(): Promise<void> {
    try {
      const selection = this.store.selection;
      const doc = this.store.document;
      const png = await exportRaster(doc, this.handoffOptions(true), selection, 'png');
      const { svg } = buildStandaloneSvg(doc, this.handoffOptions(true), selection);
      const pdf = await exportPdf(doc, this.handoffOptions(false), selection, 'auto');
      await writeDiagram({
        png: png.bytes,
        pdf: pdf.bytes,
        svg,
        text: describeDiagram(doc),
      });
      showToast('Copied the diagram as PDF, PNG, and SVG.');
    } catch (error) {
      await this.reportError('The diagram could not be copied.', error);
    }
  }

  /** Where a popover or a drag should start from, in window coordinates. */
  private commandAnchor(commandId: string): { x: number; y: number } {
    const node = document.querySelector<HTMLElement>(`[data-command="${commandId}"]`);
    if (!node) {
      const { width } = this.store.getState().view.viewport;
      return { x: width / 2, y: 60 };
    }
    const rect = node.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.bottom };
  }

  /** Hand the diagram to the system share sheet. */
  async share(): Promise<void> {
    if (!canShare()) {
      showToast('Sharing needs the macOS application.', 'warning');
      return;
    }
    try {
      const selection = this.store.selection;
      const doc = this.store.document;
      const png = await exportRaster(doc, this.handoffOptions(false), selection, 'png');
      const file = await writeTemporaryFile(exportFileName(doc, 'png'), png.bytes);
      await shareFiles([file], this.commandAnchor('file.share'));
    } catch (error) {
      await this.reportError('The diagram could not be shared.', error);
    }
  }

  /**
   * Prepare a file for dragging out of the window.
   *
   * PDF is used because it exports in a few milliseconds, so the file is on
   * disk by the time the pointer has moved far enough to start a drag, and
   * because Keynote, Pages, and Mail all embed it as vector art.
   */
  private async prepareDragFile(): Promise<FileHandle> {
    const doc = this.store.document;
    const pdf = await exportPdf(doc, this.handoffOptions(false), this.store.selection, 'auto');
    return writeTemporaryFile(exportFileName(doc, 'pdf'), pdf.bytes);
  }

  /**
   * Let a control act as a drag source for the diagram.
   *
   * The file is written as soon as the pointer goes down, so the drag can
   * begin on the first movement — macOS only starts a drag session while it is
   * handling a mouse event.
   */
  private makeDragSource(node: HTMLElement): void {
    if (!canShare()) return;
    let pending: Promise<FileHandle> | null = null;
    let origin: { x: number; y: number } | null = null;
    let dragged = false;

    const finish = (): void => {
      pending = null;
      origin = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    const onMove = (event: PointerEvent): void => {
      if (!origin || !pending) return;
      if (Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 5) return;
      const from = { x: event.clientX, y: event.clientY };
      const file = pending;
      dragged = true;
      finish();
      void file
        .then((file) => beginFileDrag([file], from))
        .catch((error) => void this.reportError('The diagram could not be dragged out.', error));
    };

    const onUp = (): void => finish();

    node.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      dragged = false;
      origin = { x: event.clientX, y: event.clientY };
      pending = this.prepareDragFile();
      // A rejection here is reported only if a drag actually starts.
      pending.catch(() => {});
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });

    // A drag must not also open the export sheet.
    node.addEventListener(
      'click',
      (event) => {
        if (!dragged) return;
        dragged = false;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }

  /**
   * Print through the system Print panel, which also offers Save as PDF.
   * A print-only container holds the diagram so the interface is not printed.
   */
  print(): void {
    const options: ExportOptions = {
      scope: 'document',
      transparent: false,
      includeGrid: false,
      scale: 1,
      margin: 24,
      background: '#ffffff',
    };
    const { svg } = buildStandaloneSvg(this.store.document, options, []);
    const container = document.createElement('div');
    container.className = 'print-sheet';
    container.innerHTML = svg.replace(/<\?xml[^>]*\?>\s*/, '');
    document.body.append(container);
    const cleanUp = (): void => {
      container.remove();
      window.removeEventListener('afterprint', cleanUp);
    };
    window.addEventListener('afterprint', cleanUp);
    void printWindow().catch((error) => {
      cleanUp();
      void this.reportError('The Print panel could not be opened.', error);
    });
    // The sheet is removed on afterprint, but not every host fires it.
    setTimeout(cleanUp, 8000);
  }

  // -------------------------------------------------------------------------
  // Clipboard
  // -------------------------------------------------------------------------

  private serializeSelection(): string | null {
    const doc = this.store.document;
    const roots = [...new Set(this.store.selection.map((id) => rootOf(doc, id)))];
    if (roots.length === 0) return null;
    const ids = new Set<ElementId>();
    const stack = [...roots];
    while (stack.length > 0) {
      const id = stack.pop()!;
      const element = doc.elements[id];
      if (!element || ids.has(id)) continue;
      ids.add(id);
      if (isGroup(element)) stack.push(...element.children);
    }
    for (const element of Object.values(doc.elements)) {
      if (!isConnector(element)) continue;
      const source = element.source.elementId;
      const target = element.target.elementId;
      if (source && target && ids.has(source) && ids.has(target)) ids.add(element.id);
    }
    // Carry the pictures the copied shapes point at. Without them a paste into
    // another window or another document would land a shape whose `imageRef`
    // resolves to nothing, and the picture would silently vanish.
    const images: FlowsharkDocument['images'] = {};
    for (const id of ids) {
      const element = doc.elements[id];
      if (element && isShape(element) && element.imageRef) {
        const image = doc.images[element.imageRef];
        if (image) images[element.imageRef] = deepClone(image);
      }
    }

    const payload = {
      version: 1,
      elements: [...ids].map((id) => deepClone(doc.elements[id])),
      order: doc.order.filter((id) => ids.has(id)),
      images,
    };
    return ELEMENT_CLIPBOARD_MARKER + JSON.stringify(payload);
  }

  async copy(): Promise<void> {
    const payload = this.serializeSelection();
    if (!payload) return;
    await writeClipboardText(payload);
    showToast('Copied.');
  }

  async cut(): Promise<void> {
    const payload = this.serializeSelection();
    if (!payload) return;
    await writeClipboardText(payload);
    deleteSelection(this.store);
  }

  async paste(matchStyle = false): Promise<void> {
    const text = await readClipboardText();
    if (!text) {
      await this.pasteImageFromPasteboard();
      return;
    }

    if (text.startsWith(ELEMENT_CLIPBOARD_MARKER)) {
      this.pasteElements(text.slice(ELEMENT_CLIPBOARD_MARKER.length), matchStyle);
      return;
    }

    // Plain text becomes a text box at the centre of the view.
    const centre = this.renderer.screenToCanvas({
      x: this.store.getState().view.viewport.width / 2,
      y: this.store.getState().view.viewport.height / 2,
    });
    addShape(this.store, 'text-box', { center: centre, text: text.slice(0, 4000) });
    showToast('Pasted text as a text box.');
  }

  private pasteElements(json: string, matchStyle: boolean): void {
    let payload: { elements?: unknown[]; order?: string[]; images?: unknown };
    try {
      payload = JSON.parse(json);
    } catch {
      showToast('The pasteboard did not contain a diagram.', 'warning');
      return;
    }
    const elements = Array.isArray(payload.elements) ? payload.elements : [];
    if (elements.length === 0) return;

    // Rebuild the fragment through the document parser so a hand-edited
    // pasteboard payload cannot produce a malformed element.
    const fragment = parseDocument(
      JSON.stringify({
        schemaVersion: 1,
        elements: Object.fromEntries(
          elements
            .filter((element): element is Record<string, unknown> => !!element && typeof element === 'object')
            .map((element) => [String((element as { id?: string }).id ?? createId('e')), element]),
        ),
        order: payload.order ?? [],
        images: payload.images ?? {},
      }),
    );

    const idMap = new Map<string, string>();
    for (const id of Object.keys(fragment.elements)) idMap.set(id, createId('p'));
    const offset = { x: 20, y: 20 };
    const created: ElementId[] = [];

    this.store.mutate('Paste', () => {
      const doc = this.store.document;
      // The parser has already dropped anything that is not a format the
      // renderer can draw, so these are safe to merge in.
      for (const [id, image] of Object.entries(fragment.images)) {
        if (!doc.images[id]) doc.images[id] = image;
      }
      for (const [oldId, newId] of idMap) {
        const element = deepClone(fragment.elements[oldId]);
        element.id = newId;
        element.layerId = doc.layers[0]?.id ?? 'layer_default';
        element.groupId = element.groupId ? idMap.get(element.groupId) ?? null : null;
        if (isShape(element)) {
          element.frame = {
            ...element.frame,
            x: element.frame.x + offset.x,
            y: element.frame.y + offset.y,
          };
          if (matchStyle) {
            element.style = { ...defaultShapeStyle() };
          }
        } else if (isConnector(element)) {
          element.waypoints = element.waypoints.map((p) => ({
            x: p.x + offset.x,
            y: p.y + offset.y,
          }));
          for (const end of ['source', 'target'] as const) {
            const endpoint = element[end];
            element[end] = {
              elementId: endpoint.elementId ? idMap.get(endpoint.elementId) ?? null : null,
              anchor: endpoint.anchor,
              point: { x: endpoint.point.x + offset.x, y: endpoint.point.y + offset.y },
            };
          }
        } else if (isGroup(element)) {
          element.children = element.children
            .map((child) => idMap.get(child))
            .filter((child): child is string => !!child);
        }
        addElement(doc, element);
        created.push(newId);
      }
      refreshConnectorPoints(doc);
    });

    if (created.length > 0) {
      this.store.setSelection(
        created.filter((id) => !this.store.document.elements[id]?.groupId),
      );
      showToast(`Pasted ${created.length} element${created.length === 1 ? '' : 's'}.`);
    }
  }

  // -------------------------------------------------------------------------
  // View
  // -------------------------------------------------------------------------

  private zoomBy(factor: number): void {
    const { width, height } = this.store.getState().view.viewport;
    this.store.zoomAt({ x: width / 2, y: height / 2 }, factor);
  }

  zoomToFit(): void {
    const bounds = documentBounds(this.store.document);
    this.fitTo(bounds);
  }

  zoomToSelection(): void {
    this.fitTo(selectionBounds(this.store));
  }

  private fitTo(bounds: { x: number; y: number; width: number; height: number } | null): void {
    const { width, height } = this.renderer.viewportSize();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      this.store.setView({ zoom: 1, offset: { x: -80, y: -80 } });
      return;
    }
    const padding = 56;
    const zoom = Math.min(
      (width - padding * 2) / bounds.width,
      (height - padding * 2) / bounds.height,
      2,
    );
    const clamped = Math.max(0.05, zoom);
    this.store.setView({
      zoom: clamped,
      offset: {
        x: bounds.x + bounds.width / 2 - width / (2 * clamped),
        y: bounds.y + bounds.height / 2 - height / (2 * clamped),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private hasSelection(): boolean {
    return this.store.selection.length > 0;
  }

  private selectionCount(): number {
    return this.store.selection.length;
  }

  private registerCommands(): void {
    const store = this.store;
    const commands: CommandDefinition[] = [
      // Application ---------------------------------------------------------
      { id: 'app.about', title: 'About FlowShark', run: () => showAbout() },
      {
        id: 'app.settings',
        title: 'Settings…',
        accelerator: 'Cmd+,',
        run: () =>
          showSettings(store, (patch: Partial<Preferences>) => {
            store.setPreferences(patch);
            this.startAutosave();
          }),
      },

      // File ----------------------------------------------------------------
      { id: 'file.new', title: 'New', accelerator: 'Cmd+N', run: () => this.newDocument() },
      {
        id: 'file.newFromTemplate',
        title: 'New from Template…',
        accelerator: 'Cmd+Shift+N',
        run: () => this.newFromTemplate(),
      },
      { id: 'file.open', title: 'Open…', accelerator: 'Cmd+O', run: () => this.open() },
      {
        id: 'file.clearRecent',
        title: 'Clear Menu',
        run: () => {
          store.clearRecentFiles();
          // Clearing the menu also withdraws the ability to reopen those
          // documents without choosing them again, which is the point: the
          // entries were the record of permission, not just a convenience.
          void clearRecentDocuments();
          void this.nativeMenu.rebuild();
        },
      },
      {
        id: 'file.close',
        title: 'Close Window',
        accelerator: 'Cmd+W',
        run: async () => {
          if (await this.confirmDiscard()) await closeWindow();
        },
      },
      { id: 'file.save', title: 'Save', accelerator: 'Cmd+S', run: () => this.save() },
      {
        id: 'file.saveAs',
        title: 'Save As…',
        accelerator: 'Cmd+Shift+S',
        run: () => this.saveAs(),
      },
      {
        id: 'file.revert',
        title: 'Revert to Saved',
        run: () => this.revert(),
        isEnabled: () => !!store.getState().file.path && store.getState().file.dirty,
      },
      {
        id: 'file.export',
        title: 'Export…',
        accelerator: 'Cmd+Shift+E',
        run: () => this.showExport('png'),
      },
      { id: 'file.exportPng', title: 'Export as PNG…', run: () => this.quickExport('png') },
      { id: 'file.exportSvg', title: 'Export as SVG…', run: () => this.quickExport('svg') },
      { id: 'file.exportPdf', title: 'Export as PDF…', run: () => this.quickExport('pdf') },
      {
        id: 'file.share',
        title: 'Share…',
        run: () => this.share(),
        isEnabled: () => canShare(),
      },
      {
        id: 'file.copyAsImage',
        title: 'Copy as Image',
        accelerator: 'Cmd+Shift+C',
        run: () => this.copyAsImage(),
      },
      { id: 'file.print', title: 'Print…', accelerator: 'Cmd+P', run: () => this.print() },

      // Edit ----------------------------------------------------------------
      {
        id: 'edit.undo',
        title: 'Undo',
        accelerator: 'Cmd+Z',
        run: () => {
          if (store.undo()) announce(`Undid ${store.history.redoLabel ?? 'the last change'}.`);
        },
        isEnabled: () => store.history.canUndo,
      },
      {
        id: 'edit.redo',
        title: 'Redo',
        accelerator: 'Cmd+Shift+Z',
        run: () => {
          if (store.redo()) announce('Redone.');
        },
        isEnabled: () => store.history.canRedo,
      },
      {
        id: 'edit.cut',
        title: 'Cut',
        accelerator: 'Cmd+X',
        run: () => this.cut(),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'edit.copy',
        title: 'Copy',
        accelerator: 'Cmd+C',
        run: () => this.copy(),
        isEnabled: () => this.hasSelection(),
      },
      { id: 'edit.paste', title: 'Paste', accelerator: 'Cmd+V', run: () => this.paste(false) },
      {
        id: 'edit.pasteMatchStyle',
        title: 'Paste and Match Style',
        accelerator: 'Cmd+Alt+Shift+V',
        run: () => this.paste(true),
      },
      {
        id: 'edit.duplicate',
        title: 'Duplicate',
        accelerator: 'Cmd+D',
        run: () => duplicateSelection(store),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'edit.delete',
        title: 'Delete',
        accelerator: 'Delete',
        run: () => deleteSelection(store),
        isEnabled: () => this.hasSelection(),
      },
      { id: 'edit.selectAll', title: 'Select All', accelerator: 'Cmd+A', run: () => selectAll(store) },
      {
        id: 'edit.deselectAll',
        title: 'Deselect All',
        accelerator: 'Cmd+Shift+A',
        run: () => store.clearSelection(),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'edit.selectConnected',
        title: 'Select Connected Elements',
        run: () => selectConnected(store),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'edit.find',
        title: 'Find…',
        accelerator: 'Cmd+F',
        run: () =>
          showFind(store, (ids) => {
            store.setSelection(ids);
            this.zoomToSelection();
          }),
      },
      {
        id: 'edit.copyStyle',
        title: 'Copy Style',
        accelerator: 'Cmd+Alt+C',
        run: () => {
          if (copyStyle(store)) showToast('Style copied.');
        },
        isEnabled: () => this.selectionCount() === 1,
      },
      {
        id: 'edit.pasteStyle',
        title: 'Paste Style',
        accelerator: 'Cmd+Alt+V',
        run: () => pasteStyle(store),
        isEnabled: () => this.hasSelection() && hasCopiedStyle(),
      },
      {
        id: 'edit.spelling',
        title: 'Check Spelling While Typing',
        run: () =>
          showToast('Spelling is checked by macOS while you edit text in a shape.'),
      },
      {
        id: 'edit.emoji',
        title: 'Emoji and Symbols',
        // Deliberately no accelerator: ⌃⌘Space belongs to macOS, and claiming
        // it here would stop the system picker from opening.
        run: () =>
          showToast('Press Control-Command-Space while editing text to open the picker.'),
      },

      // Tools ---------------------------------------------------------------
      ...(
        [
          ['select', 'Selection Tool', 'Cmd+1'],
          ['shape', 'Shape Tool', 'Cmd+2'],
          ['connector', 'Connector Tool', 'Cmd+3'],
          ['text', 'Text Tool', 'Cmd+4'],
        ] as Array<[ToolId, string, string]>
      ).map(([tool, title, accelerator]) => ({
        id: `tool.${tool}`,
        title,
        accelerator,
        run: () => store.setTool(tool),
        isChecked: () => store.getState().tool === tool,
      })),

      // Insert --------------------------------------------------------------
      ...[
        ['process', 'Process'],
        ['decision', 'Decision'],
        ['terminator', 'Start or End'],
        ['data', 'Input or Output'],
      ].map(([key, title]) => ({
        id: `insert.${key}`,
        title: `${title} Shape`,
        run: () => this.insertAtCentre(key),
      })),
      {
        id: 'insert.pendingShapeAtCentre',
        title: 'Insert Selected Shape',
        hidden: true,
        run: () => this.insertAtCentre(store.getState().ui.pendingShape),
      },
      {
        id: 'insert.connector',
        title: 'Connector',
        run: () => store.setTool('connector'),
      },
      { id: 'insert.textBox', title: 'Text Box', run: () => this.insertAtCentre('text-box') },
      { id: 'insert.image', title: 'Image…', run: () => this.insertImage() },
      {
        id: 'insert.imagePlaceholder',
        title: 'Image Placeholder',
        run: () => this.insertAtCentre('image'),
      },
      {
        id: 'insert.connectorLabel',
        title: 'Label on Connector',
        run: () => this.addLabelToSelectedConnector(),
        isEnabled: () => {
          const id = store.selection[0];
          return !!id && isConnector(store.document.elements[id]);
        },
      },
      {
        id: 'connector.addBendPoint',
        title: 'Add Bend Point',
        run: () => this.addBendPoint(),
        isEnabled: () => {
          const id = store.selection[0];
          return !!id && isConnector(store.document.elements[id]);
        },
      },
      {
        id: 'connector.clearBendPoints',
        title: 'Clear Bend Points',
        run: () => {
          const id = store.selection[0];
          if (!id) return;
          store.mutate(
            'Clear Bend Points',
            () => {
              const element = store.document.elements[id];
              if (isConnector(element)) {
                element.waypoints = [];
                element.routing = 'dynamic';
              }
              refreshConnectorPoints(store.document);
            },
            { scope: [id] },
          );
        },
        isEnabled: () => {
          const id = store.selection[0];
          const element = id ? store.document.elements[id] : undefined;
          return isConnector(element) && element.waypoints.length > 0;
        },
      },

      // Format --------------------------------------------------------------
      {
        id: 'format.fillNone',
        title: 'No Fill',
        run: () => updateShapeStyle(store, { fill: 'none' }, 'Change Fill'),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.fillWhite',
        title: 'White Fill',
        run: () => updateShapeStyle(store, { fill: '#ffffff' }, 'Change Fill'),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.fillAccent',
        title: 'Accent Fill',
        run: () => updateShapeStyle(store, { fill: '#e8f0fe' }, 'Change Fill'),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.borderNone',
        title: 'No Border',
        run: () => updateShapeStyle(store, { stroke: 'none' }, 'Change Border'),
        isEnabled: () => this.hasSelection(),
      },
      ...(['solid', 'dashed', 'dotted'] as const).map((style) => ({
        id: `format.border${style[0].toUpperCase()}${style.slice(1)}`,
        title: `${style[0].toUpperCase()}${style.slice(1)} Border`,
        run: () => updateShapeStyle(store, { strokeStyle: style }, 'Change Border'),
        isEnabled: () => this.hasSelection(),
      })),
      {
        id: 'format.borderThicker',
        title: 'Thicker Border',
        run: () => this.stepBorderWidth(0.5),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.borderThinner',
        title: 'Thinner Border',
        run: () => this.stepBorderWidth(-0.5),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.bold',
        title: 'Bold',
        accelerator: 'Cmd+B',
        run: () => this.toggleBold(),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.italic',
        title: 'Italic',
        accelerator: 'Cmd+I',
        run: () => this.toggleTextFlag('italic'),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.underline',
        title: 'Underline',
        accelerator: 'Cmd+U',
        run: () => this.toggleTextFlag('underline'),
        isEnabled: () => this.hasSelection(),
      },
      ...(['left', 'center', 'right'] as const).map((align) => ({
        id: `format.alignText${align[0].toUpperCase()}${align.slice(1)}`,
        title: `Align Text ${align[0].toUpperCase()}${align.slice(1)}`,
        run: () => updateTextStyle(store, { align }),
        isEnabled: () => this.hasSelection(),
      })),
      {
        id: 'format.biggerText',
        title: 'Bigger Text',
        accelerator: 'Cmd+Shift+Plus',
        run: () => this.stepFontSize(1),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.smallerText',
        title: 'Smaller Text',
        accelerator: 'Cmd+Shift+Minus',
        run: () => this.stepFontSize(-1),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.stylePresets',
        title: 'Apply Blue Preset',
        run: () => applyPreset(store, 'preset_blue'),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'format.resetStyle',
        title: 'Reset Style',
        run: () => resetStyle(store),
        isEnabled: () => this.hasSelection(),
      },

      // Arrange -------------------------------------------------------------
      ...(
        [
          ['alignLeft', 'Align Left', 'left'],
          ['alignCenterH', 'Align Horizontal Centres', 'center-h'],
          ['alignRight', 'Align Right', 'right'],
          ['alignTop', 'Align Top', 'top'],
          ['alignCenterV', 'Align Vertical Centres', 'center-v'],
          ['alignBottom', 'Align Bottom', 'bottom'],
        ] as const
      ).map(([id, title, mode]) => ({
        id: `arrange.${id}`,
        title,
        run: () => alignSelection(store, mode),
        isEnabled: () => this.selectionCount() > 1,
      })),
      ...(
        [
          ['distributeH', 'Distribute Horizontally', 'horizontal-gaps'],
          ['distributeV', 'Distribute Vertically', 'vertical-gaps'],
          ['distributeCentersH', 'Distribute Centres Horizontally', 'horizontal-centers'],
          ['distributeCentersV', 'Distribute Centres Vertically', 'vertical-centers'],
        ] as const
      ).map(([id, title, mode]) => ({
        id: `arrange.${id}`,
        title,
        run: () => distributeSelection(store, mode),
        isEnabled: () => this.selectionCount() > 2,
      })),
      ...(
        [
          ['sameWidth', 'Make Same Width', 'width'],
          ['sameHeight', 'Make Same Height', 'height'],
          ['sameSize', 'Make Same Size', 'both'],
        ] as const
      ).map(([id, title, mode]) => ({
        id: `arrange.${id}`,
        title,
        run: () => matchSize(store, mode),
        isEnabled: () => this.selectionCount() > 1,
      })),
      {
        id: 'arrange.group',
        title: 'Group',
        accelerator: 'Cmd+Alt+G',
        run: () => groupSelection(store),
        isEnabled: () => this.selectionCount() > 1,
      },
      {
        id: 'arrange.ungroup',
        title: 'Ungroup',
        accelerator: 'Cmd+Alt+Shift+G',
        run: () => ungroupSelection(store),
        isEnabled: () =>
          store.selection.some((id) => isGroup(store.document.elements[rootOf(store.document, id)])),
      },
      {
        id: 'arrange.lock',
        title: 'Lock',
        accelerator: 'Cmd+L',
        run: () => setLocked(store, true),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'arrange.unlock',
        title: 'Unlock',
        accelerator: 'Cmd+Alt+L',
        run: () => setLocked(store, false),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'arrange.hide',
        title: 'Hide',
        run: () => setHidden(store, true),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'arrange.show',
        title: 'Show Hidden Elements',
        run: () => {
          const hidden = Object.values(store.document.elements)
            .filter((element) => element.hidden)
            .map((element) => element.id);
          if (hidden.length === 0) return;
          store.mutate(
            'Show',
            () => {
              for (const id of hidden) {
                const element = store.document.elements[id];
                if (element) element.hidden = false;
              }
            },
            { scope: hidden },
          );
          store.setSelection(hidden);
        },
        isEnabled: () =>
          Object.values(store.document.elements).some((element) => element.hidden),
      },
      ...(
        [
          ['bringForward', 'Bring Forward', 'forward', 'Cmd+Alt+F'],
          ['bringToFront', 'Bring to Front', 'front', 'Cmd+Alt+Shift+F'],
          ['sendBackward', 'Send Backward', 'backward', 'Cmd+Alt+B'],
          ['sendToBack', 'Send to Back', 'back', 'Cmd+Alt+Shift+B'],
        ] as const
      ).map(([id, title, mode, accelerator]) => ({
        id: `arrange.${id}`,
        title,
        accelerator,
        run: () => orderSelection(store, mode),
        isEnabled: () => this.hasSelection(),
      })),

      // View ----------------------------------------------------------------
      { id: 'view.zoomIn', title: 'Zoom In', accelerator: 'Cmd+Plus', run: () => this.zoomBy(1.25) },
      {
        id: 'view.zoomOut',
        title: 'Zoom Out',
        accelerator: 'Cmd+Minus',
        run: () => this.zoomBy(0.8),
      },
      {
        id: 'view.actualSize',
        title: 'Actual Size',
        accelerator: 'Cmd+0',
        run: () => this.zoomBy(1 / store.getState().view.zoom),
      },
      {
        id: 'view.zoomToFit',
        title: 'Zoom to Fit',
        accelerator: 'Cmd+Shift+0',
        run: () => this.zoomToFit(),
      },
      {
        id: 'view.zoomToSelection',
        title: 'Zoom to Selection',
        accelerator: 'Cmd+Alt+0',
        run: () => this.zoomToSelection(),
        isEnabled: () => this.hasSelection(),
      },
      {
        id: 'view.toggleGrid',
        title: 'Show Grid',
        run: () =>
          store.mutate('Toggle Grid', () => {
            store.document.canvas.grid.visible = !store.document.canvas.grid.visible;
          }),
        isChecked: () => store.document.canvas.grid.visible,
      },
      {
        id: 'view.toggleSnapGrid',
        title: 'Snap to Grid',
        run: () =>
          store.mutate('Toggle Snapping', () => {
            store.document.canvas.grid.snap = !store.document.canvas.grid.snap;
          }),
        isChecked: () => store.document.canvas.grid.snap,
      },
      {
        id: 'view.toggleSnapElement',
        title: 'Snap to Elements',
        run: () =>
          store.mutate('Toggle Snapping', () => {
            store.document.canvas.snapToElement = !store.document.canvas.snapToElement;
          }),
        isChecked: () => store.document.canvas.snapToElement,
      },
      {
        id: 'view.toggleGuides',
        title: 'Show Alignment Guides',
        run: () =>
          store.mutate('Toggle Guides', () => {
            store.document.canvas.showGuides = !store.document.canvas.showGuides;
          }),
        isChecked: () => store.document.canvas.showGuides,
      },
      {
        id: 'view.toggleRulers',
        title: 'Show Rulers',
        run: () =>
          store.mutate('Toggle Rulers', () => {
            store.document.canvas.showRulers = !store.document.canvas.showRulers;
          }),
        isChecked: () => store.document.canvas.showRulers,
      },
      {
        id: 'view.togglePageBoundaries',
        title: 'Show Page Boundaries',
        run: () =>
          store.mutate('Toggle Page Boundaries', () => {
            store.document.canvas.page.showBoundaries = !store.document.canvas.page.showBoundaries;
          }),
        isChecked: () => store.document.canvas.page.showBoundaries,
      },
      {
        id: 'view.toggleSidebar',
        title: 'Show Shape Library',
        accelerator: 'Cmd+Alt+S',
        run: () => store.setUi({ sidebarVisible: !store.getState().ui.sidebarVisible }),
        isChecked: () => store.getState().ui.sidebarVisible,
      },
      {
        id: 'view.toggleInspector',
        title: 'Show Inspector',
        accelerator: 'Cmd+Alt+I',
        run: () => store.setUi({ inspectorVisible: !store.getState().ui.inspectorVisible }),
        isChecked: () => store.getState().ui.inspectorVisible,
      },
      {
        id: 'view.toggleStatusBar',
        title: 'Show Status Bar',
        run: () => store.setUi({ statusBarVisible: !store.getState().ui.statusBarVisible }),
        isChecked: () => store.getState().ui.statusBarVisible,
      },

      // Window and Help -----------------------------------------------------
      {
        id: 'window.new',
        title: 'New Window',
        run: async () => {
          if (!(await openNewWindow())) showToast('A new window could not be opened.', 'warning');
        },
      },
      {
        id: 'help.instructions',
        title: 'FlowShark Help',
        run: () => showShortcutReference(this.registry),
      },
      {
        id: 'help.shortcuts',
        title: 'Keyboard Shortcuts',
        accelerator: 'Cmd+/',
        run: () => showShortcutReference(this.registry),
      },
      { id: 'help.about', title: 'About FlowShark', run: () => showAbout() },
    ];

    this.registry.registerAll(commands);
  }

  private viewCentre(): { x: number; y: number } {
    const { width, height } = this.store.getState().view.viewport;
    return this.renderer.screenToCanvas({ x: width / 2, y: height / 2 });
  }

  /** Choose an image file and place it on the canvas. */
  async insertImage(): Promise<void> {
    try {
      const chosen = await openImageDialog();
      if (!chosen) return;
      const mimeType = imageTypeForPath(chosen.path);
      if (!mimeType || !IMPORTABLE_IMAGE_TYPES.has(mimeType)) {
        showToast('FlowShark can place PNG, JPEG, WebP, and GIF images.', 'warning');
        return;
      }
      await importImage(this.store, chosen.bytes, mimeType, {
        at: this.viewCentre(),
        name: chosen.path.split('/').pop() ?? 'Image',
      });
      showToast('Image placed.');
    } catch (error) {
      await this.reportError('The image could not be placed.', error);
    }
  }

  private async pasteImageFromPasteboard(): Promise<void> {
    try {
      const image = await readPasteboardImage();
      if (!image) return;
      const png = await rgbaToPng(image.rgba, image.width, image.height);
      await importImage(this.store, png, 'image/png', {
        at: this.viewCentre(),
        name: 'Pasted image',
      });
      showToast('Pasted an image.');
    } catch (error) {
      await this.reportError('The image on the pasteboard could not be pasted.', error);
    }
  }

  /**
   * Handle files dropped onto the window: a `.flowshark` file opens, an image
   * is placed where it was dropped, and anything else is reported.
   */
  private async handleFileDrop(
    files: readonly FileHandle[],
    position: { x: number; y: number },
  ): Promise<void> {
    if (files.length === 0) return;
    const documents = files.filter((file) => isDocumentPath(file.path));
    if (documents.length > 0) {
      await this.openHandle(documents[0]);
      if (documents.length > 1) {
        showToast('Only the first FlowShark document was opened.', 'warning');
      }
      return;
    }

    const rect = this.surface.getBoundingClientRect();
    const at = this.renderer.screenToCanvas({
      x: position.x - rect.left,
      y: position.y - rect.top,
    });

    let placed = 0;
    for (const file of files) {
      const mimeType = imageTypeForPath(file.path);
      if (!mimeType) continue;
      try {
        const bytes = await readFileBytes(file);
        await importImage(this.store, bytes, mimeType, {
          at: { x: at.x + placed * 24, y: at.y + placed * 24 },
          name: file.path.split('/').pop() ?? 'Image',
        });
        placed += 1;
      } catch (error) {
        await this.reportError('That image could not be placed.', error);
        return;
      }
    }
    if (placed === 0) {
      showToast('FlowShark opens .flowshark documents and places PNG, JPEG, WebP, and GIF images.', 'warning');
    } else {
      showToast(`Placed ${placed} image${placed === 1 ? '' : 's'}.`);
    }
  }

  /** The browser fallback for dropped files. */
  private async handleBrowserFileDrop(
    files: FileList,
    at: { x: number; y: number },
  ): Promise<void> {
    let placed = 0;
    for (const file of Array.from(files)) {
      if (isDocumentPath(file.name)) {
        if (!(await this.confirmDiscard())) return;
        await this.applyLoadedDocument(await file.text(), { token: null, path: file.name });
        return;
      }
      const mimeType = file.type || imageTypeForPath(file.name) || '';
      if (!IMPORTABLE_IMAGE_TYPES.has(mimeType)) continue;
      try {
        await importImage(this.store, new Uint8Array(await file.arrayBuffer()), mimeType, {
          at: { x: at.x + placed * 24, y: at.y + placed * 24 },
          name: file.name,
        });
        placed += 1;
      } catch (error) {
        await this.reportError('That image could not be placed.', error);
        return;
      }
    }
    if (placed > 0) showToast(`Placed ${placed} image${placed === 1 ? '' : 's'}.`);
  }

  private insertAtCentre(shapeKey: string): void {
    const { width, height } = this.store.getState().view.viewport;
    const centre = this.renderer.screenToCanvas({ x: width / 2, y: height / 2 });
    const placed = addShape(this.store, shapeKey, { center: centre });
    if (placed) announce(`Inserted ${placed.shape}.`);
  }

  private addBendPoint(): void {
    const id = this.store.selection[0];
    const element = id ? this.store.document.elements[id] : undefined;
    if (!isConnector(element)) return;
    const start = element.source.point;
    const end = element.target.point;
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    this.store.mutate(
      'Add Bend Point',
      () => {
        const connector = this.store.document.elements[id];
        if (!isConnector(connector)) return;
        connector.waypoints = [...connector.waypoints, midpoint];
        connector.routing = 'manual';
        refreshConnectorPoints(this.store.document);
      },
      { scope: scopeFor(this.store, [id]) },
    );
  }

  private toggleBold(): void {
    const shapes = this.store.selection
      .map((id) => this.store.document.elements[id])
      .filter(isShape);
    const bold = shapes[0]?.text.style.fontWeight ?? 400;
    updateTextStyle(this.store, { fontWeight: bold >= 600 ? 400 : 700 }, 'Bold');
  }

  private toggleTextFlag(key: 'italic' | 'underline'): void {
    const shapes = this.store.selection
      .map((id) => this.store.document.elements[id])
      .filter(isShape);
    const current = shapes[0]?.text.style[key] ?? false;
    updateTextStyle(this.store, { [key]: !current }, key === 'italic' ? 'Italic' : 'Underline');
  }

  private stepFontSize(delta: number): void {
    const shapes = this.store.selection
      .map((id) => this.store.document.elements[id])
      .filter(isShape);
    const size = shapes[0]?.text.style.fontSize ?? 13;
    updateTextStyle(this.store, { fontSize: Math.max(4, size + delta) }, 'Change Text Size');
  }

  /** Add a label to the selected connector and start editing it. */
  private addLabelToSelectedConnector(): void {
    const id = this.store.selection[0];
    if (!id) return;
    const element = this.store.document.elements[id];
    if (!isConnector(element)) return;
    const labelId = addConnectorLabel(this.store, id);
    if (labelId) this.editor.begin(id, labelId);
  }

  private stepBorderWidth(delta: number): void {
    const shapes = this.store.selection
      .map((id) => this.store.document.elements[id])
      .filter(isShape);
    const width = shapes[0]?.style.strokeWidth ?? 1;
    updateShapeStyle(this.store, { strokeWidth: Math.max(0, width + delta) }, 'Change Border');
  }
}

export { isNative, TEMPLATES, emptyOverlayState };
