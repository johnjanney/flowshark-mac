/**
 * File access.
 *
 * Nothing here passes a pathname to the native layer. On macOS the Open and
 * Save panels are presented from Rust, which hands back a `FileHandle`: an
 * opaque token standing for the file the user chose, plus the path to show in
 * the title bar and the recent-documents menu. Reads and writes quote the
 * token. A path the user never picked has no token, so the web layer cannot
 * ask for one — see `src-tauri/src/grants.rs`.
 *
 * Writing still goes through the Rust command that writes atomically: contents
 * land in a temporary file beside the target and are then renamed over it, so
 * a failure part-way through never destroys the previous version.
 *
 * In a browser the same API is backed by a file input and a download, which
 * keeps development and testing possible without the native shell (D-022).
 * There is no capability to hold there, so the token is `null` and the path is
 * only ever a display name.
 */

import { isNative } from './environment';

export const DOCUMENT_EXTENSION = 'flowshark';

/**
 * A file the user chose, and permission to act on it.
 *
 * The path is for showing, not for asking: every operation quotes `token`.
 */
export interface FileHandle {
  token: string | null;
  path: string;
}

export interface OpenResult {
  handle: FileHandle;
  contents: string;
}

interface DialogModule {
  message(text: string, options?: unknown): Promise<void>;
  confirm(text: string, options?: unknown): Promise<boolean>;
  ask(text: string, options?: unknown): Promise<boolean>;
}

/** A handle for the browser build, where there is no capability to hold. */
function browserHandle(path: string): FileHandle {
  return { token: null, path };
}

function requireToken(handle: FileHandle): string {
  if (!handle.token) {
    throw new Error('FlowShark no longer has permission to use that file.');
  }
  return handle.token;
}

async function dialog(): Promise<DialogModule> {
  return (await import('@tauri-apps/plugin-dialog')) as unknown as DialogModule;
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

export async function openDocumentDialog(): Promise<OpenResult | null> {
  if (isNative()) {
    // The panel is presented by Rust, so the chosen path arrives already
    // carrying permission rather than needing to be trusted.
    const handle = await invoke<FileHandle | null>('pick_document');
    if (!handle) return null;
    const contents = await invoke<string>('read_text_file', { token: handle.token });
    return { handle, contents };
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
      resolve({ handle: browserHandle(file.name), contents: await file.text() });
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/** Choose an image file to place on the canvas. */
export async function openImageDialog(): Promise<{ path: string; bytes: Uint8Array } | null> {
  if (isNative()) {
    const handle = await invoke<FileHandle | null>('pick_image');
    if (!handle) return null;
    const result = await invoke<ArrayBuffer | number[]>('read_binary_file', {
      token: handle.token,
    });
    const bytes = result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array(result);
    return { path: handle.path, bytes };
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

/** Read a document FlowShark has been granted, by the Finder or a drop. */
export async function readDocument(handle: FileHandle): Promise<string> {
  if (!isNative()) throw new Error('Reading a file again needs the macOS application.');
  return invoke<string>('read_text_file', { token: requireToken(handle) });
}

// ---------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------

export async function chooseSavePath(
  suggestedName: string,
  extension = DOCUMENT_EXTENSION,
): Promise<FileHandle | null> {
  if (!isNative()) return browserHandle(suggestedName);
  return invoke<FileHandle | null>('pick_save_path', { suggestedName, extension });
}

export async function writeTextFile(handle: FileHandle, contents: string): Promise<void> {
  if (isNative()) {
    await invoke('save_text_atomic', { token: requireToken(handle), contents });
    return;
  }
  downloadInBrowser(handle.path, new TextEncoder().encode(contents), 'application/json');
}

export async function writeBinaryFile(
  handle: FileHandle,
  contents: Uint8Array,
  mimeType = 'application/octet-stream',
): Promise<void> {
  if (isNative()) {
    await invoke('save_binary_atomic', {
      token: requireToken(handle),
      contents: Array.from(contents),
    });
    return;
  }
  downloadInBrowser(handle.path, contents, mimeType);
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
export async function revealInFinder(handle: FileHandle): Promise<void> {
  if (!isNative() || !handle.token) return;
  try {
    await invoke('reveal_item', { token: handle.token });
  } catch {
    // Revealing is a convenience; a failure must not break the export.
  }
}

/**
 * An opaque marker for the file at `path`, used to notice that something else
 * replaced the document.
 *
 * Only ever compared for equality: two different strings mean the file is not
 * the one that was read. `null` means the question cannot be answered here —
 * the file is gone, or this is the browser build — and the caller treats that
 * as "no conflict known" rather than as a conflict.
 */
export async function fileFingerprint(handle: FileHandle): Promise<string | null> {
  if (!isNative() || !handle.token) return null;
  try {
    return await invoke<string>('file_fingerprint', { token: handle.token });
  } catch {
    return null;
  }
}

/**
 * Give up permission to a file, when its document is closed or replaced.
 *
 * A grant that is never withdrawn is a capability the web layer keeps for as
 * long as the process lives, which is exactly what this design is trying to
 * avoid.
 */
export async function revokeHandle(handle: FileHandle | null): Promise<void> {
  if (!isNative() || !handle?.token) return;
  try {
    await invoke('revoke_grant', { token: handle.token });
  } catch {
    // Withdrawing permission is best effort; the grant dies with the process.
  }
}

// ---------------------------------------------------------------------------
// Recent documents
// ---------------------------------------------------------------------------

/**
 * Documents the user has opened or saved before.
 *
 * The authoritative list lives in Rust, because "the user chose this path once"
 * is exactly the claim the web layer must not be able to make for itself.
 */
export async function recentDocuments(): Promise<string[]> {
  if (!isNative()) return [];
  try {
    return await invoke<string[]>('recent_documents');
  } catch {
    return [];
  }
}

/** Permission to reopen something from the recent-documents menu. */
export async function grantRecentDocument(path: string): Promise<FileHandle | null> {
  if (!isNative()) return browserHandle(path);
  return invoke<FileHandle | null>('grant_recent_document', { path });
}

export async function clearRecentDocuments(): Promise<void> {
  if (!isNative()) return;
  try {
    await invoke('clear_recent_documents');
  } catch {
    // The menu is a convenience.
  }
}
