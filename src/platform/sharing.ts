/**
 * Handing a diagram to another application.
 *
 * Three routes, all of which need a real macOS file or pasteboard behind them:
 * the system share sheet, a drag session that drops a file into the Finder or
 * Mail, and a temporary file to feed either of them.
 *
 * In a browser none of this exists. Each function reports that plainly so the
 * caller can offer the export path instead.
 */

import { isNative } from './environment';
import type { FileHandle } from './files';

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: call } = await import('@tauri-apps/api/core');
  return call<T>(command, args);
}

export function canShare(): boolean {
  return isNative();
}

/**
 * Write bytes to a temporary file and return its path.
 *
 * The file keeps the name it is given, so the Finder and Mail show the
 * diagram's own title rather than something generated.
 */
export async function writeTemporaryFile(
  name: string,
  bytes: Uint8Array,
): Promise<FileHandle> {
  if (!isNative()) throw new Error('Temporary files need the macOS application.');
  // Rust wrote the file, so Rust is the one that can vouch for it: the grant
  // comes back with it rather than being asked for by path afterwards.
  return invoke<FileHandle>('write_temp_file', { name, contents: Array.from(bytes) });
}

/** Present the system share sheet for `paths`, anchored near a screen point. */
export async function shareFiles(
  files: readonly FileHandle[],
  anchor: { x: number; y: number },
): Promise<void> {
  if (!isNative()) throw new Error('Sharing needs the macOS application.');
  const tokens = files.map((file) => file.token).filter((t): t is string => !!t);
  await invoke('share_files', { tokens, x: anchor.x, y: anchor.y });
}

/**
 * Start dragging `paths` out of the window.
 *
 * macOS only begins a drag while it is handling a mouse event, so this has to
 * be called from a pointer handler, not after an await that outlives it.
 */
export async function beginFileDrag(
  files: readonly FileHandle[],
  from: { x: number; y: number },
): Promise<void> {
  if (!isNative()) throw new Error('Dragging out needs the macOS application.');
  const tokens = files.map((file) => file.token).filter((t): t is string => !!t);
  await invoke('begin_file_drag', { tokens, x: from.x, y: from.y });
}
