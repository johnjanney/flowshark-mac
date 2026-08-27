/**
 * Files dragged onto the window.
 *
 * The Tauri window intercepts file drops before the web view sees them, so on
 * macOS the paths arrive through a Tauri event rather than through the DOM.
 * The browser path uses ordinary HTML drag and drop, so both hosts behave the
 * same way from the application's point of view.
 */

import { isNative } from './environment';

export interface FileDropEvent {
  paths: string[];
  /** Position within the window, in CSS pixels. */
  position: { x: number; y: number };
}

export type FileDropHandler = (event: FileDropEvent) => void;

export async function onFileDrop(handler: FileDropHandler): Promise<() => void> {
  if (!isNative()) return () => {};
  try {
    const { getCurrentWebview } = await import('@tauri-apps/api/webview');
    return await getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== 'drop') return;
      handler({
        paths: event.payload.paths,
        position: { x: event.payload.position.x, y: event.payload.position.y },
      });
    });
  } catch {
    return () => {};
  }
}

/** Read a dropped file from disk. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<ArrayBuffer | number[]>('read_binary_file', { path });
  return result instanceof ArrayBuffer ? new Uint8Array(result) : new Uint8Array(result);
}
