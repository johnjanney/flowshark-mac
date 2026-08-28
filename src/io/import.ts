/**
 * Importing images and documents.
 *
 * Images are embedded in the document as base64 so a `.flowshark` file is
 * always self-contained — moving or emailing one never leaves a broken
 * reference behind.
 *
 * Only bitmap formats the renderer can draw are accepted. SVG is deliberately
 * not imported as vector art in this release: doing that safely means parsing
 * and sanitising untrusted markup, which is worth doing properly rather than
 * quickly (see DECISIONS.md, D-010).
 */

import { createId } from '../model/ids';
import { addElement } from '../model/document';
import { createShapeElement } from '../model/defaults';
import type { Point } from '../model/geometry';
import type { EmbeddedImage, ShapeElement } from '../model/types';
import type { Store } from '../state/store';

export const IMPORTABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);

const EXTENSION_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export function imageTypeForPath(path: string): string | null {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_TYPES[extension] ?? null;
}

/**
 * File signatures for the formats FlowShark draws.
 *
 * A filename extension is a claim, not evidence, and so is the MIME type a
 * browser or a drag source reports. Reading the first bytes is what actually
 * establishes what a file is, and it happens before the bytes are embedded in
 * a document that will be saved, rendered, and exported.
 */
const SIGNATURES: Record<string, ReadonlyArray<readonly number[]>> = {
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/gif': [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  'image/webp': [[0x52, 0x49, 0x46, 0x46]],
};

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  if (bytes.length < signature.length) return false;
  return signature.every((byte, index) => bytes[index] === byte);
}

/** The format `bytes` actually is, or `null` when it is not one FlowShark draws. */
export function detectImageType(bytes: Uint8Array): string | null {
  for (const [mimeType, signatures] of Object.entries(SIGNATURES)) {
    if (!signatures.some((signature) => startsWith(bytes, signature))) continue;
    if (mimeType === 'image/webp') {
      // RIFF is a container; the form type at offset 8 says it holds WebP.
      const form = [0x57, 0x45, 0x42, 0x50];
      const matches =
        bytes.length >= 12 && form.every((byte, index) => bytes[8 + index] === byte);
      if (!matches) continue;
    }
    return mimeType;
  }
  return null;
}

export function isDocumentPath(path: string): boolean {
  return path.toLowerCase().endsWith('.flowshark');
}

function toBase64(bytes: Uint8Array): string {
  // Chunked so a large image does not blow the argument limit of `apply`.
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('The image could not be read.'));
    image.src = dataUrl;
  });
}

export interface ImportImageOptions {
  /** Where to place the image, in canvas coordinates. Defaults to the centre. */
  at?: Point;
  name?: string;
  /** Longest edge of the placed image, in points. */
  maxSize?: number;
}

/** Embed an image and place it on the canvas. */
export async function importImage(
  store: Store,
  bytes: Uint8Array,
  mimeType: string,
  options: ImportImageOptions = {},
): Promise<ShapeElement | null> {
  if (!IMPORTABLE_IMAGE_TYPES.has(mimeType)) {
    throw new Error(`FlowShark does not import ${mimeType} files.`);
  }
  // The caller's type came from a filename extension or from whatever the drag
  // source claimed. Believe the bytes instead.
  const detected = detectImageType(bytes);
  if (!detected) {
    throw new Error('This file is not a PNG, JPEG, WebP, or GIF image.');
  }
  if (detected !== mimeType) {
    throw new Error(
      `This file is named as ${mimeType} but its contents are ${detected}. Rename it and try again.`,
    );
  }
  const data = toBase64(bytes);
  const { width, height } = await measure(`data:${mimeType};base64,${data}`);

  const maxSize = options.maxSize ?? 420;
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const frameWidth = Math.max(24, Math.round(width * scale));
  const frameHeight = Math.max(24, Math.round(height * scale));
  const at = options.at ?? { x: 0, y: 0 };

  const image: EmbeddedImage = {
    id: createId('img'),
    mimeType,
    data,
    width,
    height,
    name: options.name ?? 'Image',
  };

  const element = createShapeElement({
    shape: 'image',
    frame: {
      x: at.x - frameWidth / 2,
      y: at.y - frameHeight / 2,
      width: frameWidth,
      height: frameHeight,
    },
    style: { fill: 'none', stroke: 'none', cornerRadius: 0 },
    layerId: store.document.layers[0]?.id ?? 'layer_default',
  });
  element.imageRef = image.id;
  element.altText = options.name ?? 'Imported image';

  const added = store.mutate('Insert Image', () => {
    store.document.images[image.id] = image;
    addElement(store.document, element);
  });
  if (!added) return null;
  store.setSelection([element.id]);
  return element;
}

/** Re-encode raw RGBA pixels as PNG, for pasteboard images. */
export async function rgbaToPng(
  rgba: Uint8Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This system does not provide a 2D drawing context.');
  const buffer = new Uint8ClampedArray(rgba.length);
  buffer.set(rgba);
  context.putImageData(new ImageData(buffer, width, height), 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The image could not be encoded.');
  return new Uint8Array(await blob.arrayBuffer());
}
