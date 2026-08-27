/**
 * Platform detection.
 *
 * FlowShark ships as a macOS application, but the same front end runs in a
 * plain browser during development and in the automated tests. Everything that
 * needs the native shell goes through this module so the browser path stays a
 * first-class, working fallback rather than a broken stub.
 */

export type Host = 'macos' | 'web';

let cached: Host | null = null;

export function host(): Host {
  if (cached) return cached;
  const isTauri =
    typeof window !== 'undefined' &&
    (('__TAURI_INTERNALS__' in window) || ('__TAURI__' in window));
  cached = isTauri ? 'macos' : 'web';
  return cached;
}

export function isNative(): boolean {
  return host() === 'macos';
}

/** Tag the document so CSS can adjust for the native title bar. */
export function applyHostAttributes(): void {
  document.body.dataset.platform = host();
}
