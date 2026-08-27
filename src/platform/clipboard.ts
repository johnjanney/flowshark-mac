/**
 * Pasteboard access.
 *
 * FlowShark writes two standard macOS pasteboard types: `public.png` for
 * images and `public.utf8-plain-text` for text and for its own element data.
 * Applications such as Keynote, Pages, and Mail read the PNG type directly.
 *
 * Copying elements between FlowShark windows uses a JSON payload on the text
 * pasteboard, tagged with a marker so an ordinary text paste is never mistaken
 * for element data.
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

/** Put a PNG on the pasteboard as `public.png`. */
export async function writePng(bytes: Uint8Array): Promise<void> {
  if (isNative()) {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeImage(bytes);
    return;
  }
  const clipboard = navigator.clipboard;
  if (!clipboard || typeof ClipboardItem === 'undefined') {
    throw new Error('This browser does not allow copying images.');
  }
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  await clipboard.write([new ClipboardItem({ 'image/png': new Blob([buffer], { type: 'image/png' }) })]);
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
