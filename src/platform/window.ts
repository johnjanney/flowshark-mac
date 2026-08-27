/**
 * Window integration: the title, the edited indicator, and new windows.
 *
 * macOS restores window position and size itself when the window has a frame
 * autosave name, which the Tauri configuration sets. Native window tabs come
 * from the system Window menu and need no code here.
 */

import { isNative } from './environment';

export async function setWindowTitle(title: string): Promise<void> {
  if (!isNative()) {
    document.title = title;
    return;
  }
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch {
    document.title = title;
  }
}

/** Open a second document window. */
export async function openNewWindow(): Promise<boolean> {
  if (!isNative()) {
    window.open(window.location.href, '_blank');
    return true;
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_new_window');
    return true;
  } catch {
    return false;
  }
}

/** Ask the shell to close this window. */
export async function closeWindow(): Promise<void> {
  if (!isNative()) {
    window.close();
    return;
  }
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
}

/**
 * Listen for a file the Finder asked the app to open: a double-click, a drag
 * onto the Dock icon, or Open With.
 */
export async function onOpenFileRequest(
  handler: (path: string) => void,
): Promise<() => void> {
  if (!isNative()) return () => {};
  const { listen } = await import('@tauri-apps/api/event');
  const unlisten = await listen<string>('flowshark://open-file', (event) => {
    if (typeof event.payload === 'string') handler(event.payload);
  });
  return unlisten;
}

/** Ask the shell for any file the app was launched with. */
export async function pendingLaunchFile(): Promise<string | null> {
  if (!isNative()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string | null>('take_pending_open_file');
  } catch {
    return null;
  }
}
