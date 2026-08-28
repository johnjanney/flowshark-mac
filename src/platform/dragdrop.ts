/**
 * Files dragged onto the window.
 *
 * The Tauri window intercepts file drops before the web view sees them. Tauri's
 * own drag-drop event would hand the web view the dropped pathnames, which
 * would put the renderer back in the business of naming files; FlowShark
 * listens for the drop in Rust instead and emits grants, so what arrives here
 * is permission for what the user dropped.
 *
 * The browser path uses ordinary HTML drag and drop, so both hosts behave the
 * same way from the application's point of view — there is nothing to grant
 * there, because the browser hands over the file's contents directly.
 */

import { isNative } from './environment';
import type { FileHandle } from './files';

export interface FileDropEvent {
  files: FileHandle[];
  /** Position within the window, in CSS pixels. */
  position: { x: number; y: number };
}

export type FileDropHandler = (event: FileDropEvent) => void;

interface DropPayload {
  grants: FileHandle[];
  position: [number, number];
}

export async function onFileDrop(handler: FileDropHandler): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const { listen } = await import('@tauri-apps/api/event');
    return await listen<DropPayload>('flowshark://drop-files', (event) => {
      const payload = event.payload;
      if (!payload?.grants?.length) return;
      handler({
        files: payload.grants,
        position: { x: payload.position[0], y: payload.position[1] },
      });
    });
  } catch {
    return () => {};
  }
}

/** Read a dropped file, using the permission that came with it. */
export async function readFileBytes(handle: FileHandle): Promise<Uint8Array> {
  if (!handle.token) throw new Error('FlowShark was not given permission to read that file.');
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<ArrayBuffer | number[]>('read_binary_file', {
    token: handle.token,
  });
  return result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array(result);
}
