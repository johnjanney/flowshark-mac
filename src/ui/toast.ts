/**
 * Transient messages.
 *
 * Toasts report the outcome of something the user started — an export that
 * finished, a document that could not be read. They are mirrored into an ARIA
 * live region so VoiceOver announces them too.
 */

import { el, requireElement } from '../util/dom';

export type ToastKind = 'info' | 'warning' | 'error';

let layer: HTMLElement | null = null;
let live: HTMLElement | null = null;

function ensureElements(): void {
  layer ??= requireElement<HTMLElement>('toast-layer');
  live ??= requireElement<HTMLElement>('live-region');
}

export function showToast(message: string, kind: ToastKind = 'info', durationMs = 4200): void {
  ensureElements();
  const node = el('div', { class: `toast ${kind}` }, [message]);
  layer!.append(node);
  announce(message);
  setTimeout(() => node.remove(), durationMs);
}

/** Send a message to assistive technology without showing a toast. */
export function announce(message: string): void {
  ensureElements();
  // Clearing first makes VoiceOver repeat an identical message.
  live!.textContent = '';
  requestAnimationFrame(() => {
    live!.textContent = message;
  });
}
