/**
 * Pasteboard access.
 *
 * A copied diagram is written as one pasteboard item carrying several
 * representations — `com.adobe.pdf`, `public.png`, `public.svg-image`, and
 * `public.utf8-plain-text`. Each receiving application then takes the best one
 * it understands: Keynote and Pages take the vector PDF, a browser or a design
 * tool takes the SVG, Mail and Messages take the PNG.
 *
 * Copying elements between FlowShark windows is a separate, much cheaper path:
 * a JSON payload on the text pasteboard, tagged with a marker so an ordinary
 * text paste is never mistaken for element data.
 */

import { isNative } from './environment';

/** Marks the text-pasteboard payload as FlowShark element data. */
export const ELEMENT_CLIPBOARD_MARKER = 'flowshark/elements-v1:';

export async function writeText(text: string): Promise<void> {
  if (isNative()) {
    const { writeText: write } = await import('@tauri-apps/plugin-clipboard-manager');
    await write(text);
    return;
  }
  await navigator.clipboard?.writeText(text);
}

export async function readText(): Promise<string> {
  if (isNative()) {
    const { readText: read } = await import('@tauri-apps/plugin-clipboard-manager');
    return read();
  }
  try {
    return (await navigator.clipboard?.readText()) ?? '';
  } catch {
    return '';
  }
}

export interface DiagramPasteboardPayload {
  /** PNG bytes, written as `public.png`. */
  png?: Uint8Array;
  /** PDF bytes, written as `com.adobe.pdf`. */
  pdf?: Uint8Array;
  /** SVG source, written as `public.svg-image`. */
  svg?: string;
  /** Plain text, written as `public.utf8-plain-text`. */
  text?: string;
}

/**
 * Write every representation of a diagram to the pasteboard at once.
 *
 * A browser can only offer PNG and text, and only from a user gesture, so the
 * fallback writes what it can rather than failing.
 */
export async function writeDiagram(payload: DiagramPasteboardPayload): Promise<void> {
  if (isNative()) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('copy_diagram_to_pasteboard', {
      payload: {
        png: payload.png ? Array.from(payload.png) : null,
        pdf: payload.pdf ? Array.from(payload.pdf) : null,
        svg: payload.svg ?? null,
        text: payload.text ?? null,
      },
    });
    return;
  }

  const clipboard = navigator.clipboard;
  if (clipboard && typeof ClipboardItem !== 'undefined' && payload.png) {
    const buffer = new ArrayBuffer(payload.png.byteLength);
    new Uint8Array(buffer).set(payload.png);
    const parts: Record<string, Blob> = {
      'image/png': new Blob([buffer], { type: 'image/png' }),
    };
    if (payload.text) {
      parts['text/plain'] = new Blob([payload.text], { type: 'text/plain' });
    }
    await clipboard.write([new ClipboardItem(parts)]);
    return;
  }
  if (payload.text) {
    await writeText(payload.text);
    return;
  }
  throw new Error('This browser does not allow copying images.');
}

export interface PasteboardImage {
  /** Raw RGBA pixels. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

/**
 * Read an image from the pasteboard.
 *
 * The macOS path returns raw pixels, which callers re-encode as PNG before
 * embedding; the browser path decodes the PNG it finds on the clipboard so
 * both hosts hand back the same shape of data.
 */
export async function readImage(): Promise<PasteboardImage | null> {
  if (isNative()) {
    try {
      const { readImage: read } = await import('@tauri-apps/plugin-clipboard-manager');
      const image = await read();
      const size = await image.size();
      const rgba = await image.rgba();
      return {
        rgba: rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba),
        width: size.width,
        height: size.height,
      };
    } catch {
      return null;
    }
  }
  try {
    const items = await navigator.clipboard?.read();
    for (const item of items ?? []) {
      const type = item.types.find((entry) => entry.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(bitmap, 0, 0);
      const data = context.getImageData(0, 0, bitmap.width, bitmap.height);
      return {
        rgba: new Uint8Array(data.data.buffer.slice(0)),
        width: bitmap.width,
        height: bitmap.height,
      };
    }
  } catch {
    // Reading images from the pasteboard needs permission in a browser.
  }
  return null;
}
