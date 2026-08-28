/**
 * The dirty flag around asynchronous saves.
 *
 * Saving serialises the document, then awaits a write that crosses IPC and
 * touches the disk. The editor stays live for the whole of that await, so the
 * document can move on before the write lands. Clearing the dirty flag on
 * completion — without asking whether the document is still the one that was
 * written — hides that edit from the close prompt and from automatic saving,
 * and it is lost when the window closes.
 *
 * These tests drive `Store` directly with a deferred write, which is what makes
 * the race deterministic rather than a matter of timing.
 */

import { describe, expect, it } from 'vitest';
import { Store } from '../src/state/store';
import { createEmptyDocument } from '../src/model/defaults';
import { addShape } from '../src/commands/actions';
import { serializeDocument } from '../src/model/serialization';

/** A promise whose resolution the test controls. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * The save sequence as `performWrite` runs it: capture the revision with the
 * text, await the write, then report what was saved.
 */
async function save(store: Store, write: (text: string) => Promise<void>): Promise<void> {
  const revision = store.documentRevision;
  const text = serializeDocument(store.document);
  await write(text);
  store.markSaved('/tmp/doc.flowshark', revision);
}

describe('saving while the document is still being edited', () => {
  it('leaves the document dirty when an edit lands mid-save', async () => {
    const store = new Store(createEmptyDocument());
    addShape(store, 'process', { at: { x: 0, y: 0 } });
    expect(store.getState().file.dirty).toBe(true);

    const write = deferred<void>();
    const saving = save(store, () => write.promise);

    // The edit the user makes while the write is in flight.
    addShape(store, 'decision', { at: { x: 200, y: 0 } });

    write.resolve();
    await saving;

    expect(store.getState().file.dirty).toBe(true);
    expect(store.getState().file.path).toBe('/tmp/doc.flowshark');
  });

  it('clears the dirty flag when nothing changed during the save', async () => {
    const store = new Store(createEmptyDocument());
    addShape(store, 'process', { at: { x: 0, y: 0 } });

    const write = deferred<void>();
    const saving = save(store, () => write.promise);
    write.resolve();
    await saving;

    expect(store.getState().file.dirty).toBe(false);
  });

  it('treats an undo during a save as an edit', async () => {
    const store = new Store(createEmptyDocument());
    addShape(store, 'process', { at: { x: 0, y: 0 } });

    const write = deferred<void>();
    const saving = save(store, () => write.promise);
    store.undo();
    write.resolve();
    await saving;

    expect(store.getState().file.dirty).toBe(true);
  });

  it('advances the revision for every kind of document change', () => {
    const store = new Store(createEmptyDocument());
    const start = store.documentRevision;

    addShape(store, 'process', { at: { x: 0, y: 0 } });
    const afterAdd = store.documentRevision;
    expect(afterAdd).toBeGreaterThan(start);

    store.undo();
    const afterUndo = store.documentRevision;
    expect(afterUndo).toBeGreaterThan(afterAdd);

    store.redo();
    expect(store.documentRevision).toBeGreaterThan(afterUndo);

    const afterRedo = store.documentRevision;
    store.replaceDocument(createEmptyDocument(), null, false);
    expect(store.documentRevision).toBeGreaterThan(afterRedo);
  });

  it('does not advance the revision for selection, view, or status changes', () => {
    const store = new Store(createEmptyDocument());
    const element = addShape(store, 'process', { at: { x: 0, y: 0 } })!;
    const revision = store.documentRevision;

    store.setSelection([element.id]);
    store.setView({ zoom: 2 });
    store.setStatusMessage('Working');
    store.setTool('pan');

    expect(store.documentRevision).toBe(revision);
  });

  it('does not report a save as complete when the write fails', async () => {
    const store = new Store(createEmptyDocument());
    addShape(store, 'process', { at: { x: 0, y: 0 } });

    const write = deferred<void>();
    const saving = save(store, () => write.promise).catch(() => undefined);
    write.reject(new Error('disk full'));
    await saving;

    expect(store.getState().file.dirty).toBe(true);
  });
});

describe('serialising the document', () => {
  it('writes the modification time the caller supplies', () => {
    // The caller writes the same timestamp into the file and into the document
    // once the write succeeds, so the two cannot disagree.
    const store = new Store(createEmptyDocument());
    const stamp = '2026-01-02T03:04:05.000Z';
    const written = JSON.parse(serializeDocument(store.document, true, stamp)) as {
      meta: { modified: string };
    };
    expect(written.meta.modified).toBe(stamp);
  });
});

describe('the recent-documents list', () => {
  it('can be replaced by the authoritative native list', () => {
    // On macOS the list of documents the user has chosen lives in Rust,
    // because that is the only side that can vouch for the claim. The store
    // holds a copy for the menu to draw, seeded at start-up.
    const store = new Store(createEmptyDocument());
    store.markSaved('/tmp/one.flowshark', store.documentRevision);
    store.markSaved('/tmp/two.flowshark', store.documentRevision);
    expect(store.getState().file.recent).toContain('/tmp/one.flowshark');

    store.setRecentFiles(['/tmp/three.flowshark']);
    expect(store.getState().file.recent).toEqual(['/tmp/three.flowshark']);
  });

  it('does not let the copy grow past the menu length', () => {
    const store = new Store(createEmptyDocument());
    store.setRecentFiles(Array.from({ length: 100 }, (_, i) => `/tmp/${i}.flowshark`));
    expect(store.getState().file.recent.length).toBeLessThanOrEqual(12);
  });
});
