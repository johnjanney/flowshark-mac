/**
 * File access.
 *
 * On macOS this goes through the standard Open and Save panels and through a
 * Rust command that writes atomically: contents land in a temporary file
 * beside the target and are then renamed over it, so a failure part-way
 * through never destroys the previous version of a document.
 *
 * In a browser the same API is backed by a file input and a download, which
 * keeps development and testing possible without the native shell.
 */

import { isNative } from './environment';

export const DOCUMENT_EXTENSION = 'flowshark';

export interface OpenResult {
  path: string;
  contents: string;
}

export interface SaveTarget {
  path: string;
}

interface DialogModule {
  open(options: unknown): Promise<string | string[] | null>;
  save(options: unknown): Promise<string | null>;
  message(text: string, options?: unknown): Promise<void>;
  confirm(text: string, options?: unknown): Promise<boolean>;
  ask(text: string, options?: unknown): Promise<boolean>;
}

async function dialog(): Promise<DialogModule> {
  return (await import('@tauri-apps/plugin-dialog')) as unknown as DialogModule;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

const DOCUMENT_FILTER = {
  name: 'FlowShark Document',
  extensions: [DOCUMENT_EXTENSION],
};

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export async function openDocumentDialog(): Promise<OpenResult | null> {
  if (isNative()) {
    const { open } = await dialog();
    const selected = await open({ multiple: false, filters: [DOCUMENT_FILTER] });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    const contents = await invoke<string>('read_text_file', { path });
    return { path, contents };
  }
  return openWithFileInput();
}

function openWithFileInput(): Promise<OpenResult | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `.${DOCUMENT_EXTENSION},application/json`;
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ path: file.name, contents: await file.text() });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Choose an image file to place on the canvas. */
export async function openImageDialog(): Promise<{ path: string; bytes: Uint8Array } | null> {
  if (isNative()) {
    const { open } = await dialog();
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    });
    const path = Array.isArray(selected) ? selected[0] : selected;
    if (!path) return null;
    const result = await invoke<ArrayBuffer | number[]>('read_binary_file', { path });
    const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array(result);
    return { path, bytes };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({ path: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Read a document that the Finder or a drag onto the Dock icon handed us. */
export async function readDocument(path: string): Promise<string> {
  if (!isNative()) throw new Error('Reading files by path needs the macOS application.');
  return invoke<string>('read_text_file', { path });
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function chooseSavePath(
  suggestedName: string,
  extension = DOCUMENT_EXTENSION,
): Promise<string | null> {
  if (!isNative()) return suggestedName;
  const { save } = await dialog();
  return save({
    defaultPath: suggestedName,
    filters: [
      extension === DOCUMENT_EXTENSION
        ? DOCUMENT_FILTER
        : { name: extension.toUpperCase(), extensions: [extension] },
    ],
  });
}

export async function writeTextFile(path: string, contents: string): Promise<void> {
  if (isNative()) {
    await invoke('save_text_atomic', { path, contents });
    return;
  }
  downloadInBrowser(path, new TextEncoder().encode(contents), 'application/json');
}

export async function writeBinaryFile(
  path: string,
  contents: Uint8Array,
  mimeType = 'application/octet-stream',
): Promise<void> {
  if (isNative()) {
    await invoke('save_binary_atomic', { path, contents: Array.from(contents) });
    return;
  }
  downloadInBrowser(path, contents, mimeType);
}

function downloadInBrowser(name: string, bytes: Uint8Array, mimeType: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blob = new Blob([buffer], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name.split('/').pop() ?? name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

export async function showMessage(
  title: string,
  detail: string,
  kind: 'info' | 'warning' | 'error' = 'info',
): Promise<void> {
  if (isNative()) {
    const { message } = await dialog();
    await message(detail, { title, kind });
    return;
  }
  window.alert(`${title}\n\n${detail}`);
}

export async function askToDiscardChanges(documentTitle: string): Promise<boolean> {
  const question = `Do you want to discard the changes you made to “${documentTitle}”?`;
  if (isNative()) {
    const { confirm } = await dialog();
    return confirm(question, { title: 'Unsaved Changes', kind: 'warning' });
  }
  return window.confirm(question);
}

/** Reveal an exported file in the Finder. */
export async function revealInFinder(path: string): Promise<void> {
  if (!isNative()) return;
  try {
    const { revealItemInDir } = await import('@tauri-apps/plugin-opener');
    await revealItemInDir(path);
  } catch {
    // Revealing is a convenience; a failure must not break the export.
  }
}

/** Modification time of a file, used to notice external edits. */
export async function fileModifiedAt(path: string): Promise<number | null> {
  if (!isNative()) return null;
  try {
    return await invoke<number>('file_modified_at', { path });
  } catch {
    return null;
  }
}
