/**
 * PNG, JPEG, and WebP export.
 *
 * The diagram is drawn once as SVG and rasterised through an `Image`. Doing it
 * this way rather than with a second Canvas renderer means the pixels come from
 * the same geometry, the same fonts, and the same styling as the screen.
 *
 * WKWebView will not load an SVG into an `Image` from a blob URL when the page
 * has a strict CSP, so the SVG is passed as a UTF-8 data URL instead.
 */

import type { FlowsharkDocument } from '../model/types';
import type { ElementId } from '../model/types';
import { buildStandaloneSvg } from './export-svg';
import type { ExportOptions } from './export';

export type RasterFormat = 'png' | 'jpeg' | 'webp';

const MIME: Record<RasterFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

export interface RasterResult {
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

function svgDataUrl(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/%20/g, ' ');
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

export async function svgToCanvas(
  svg: string,
  width: number,
  height: number,
  scale: number,
  background: string | null,
): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.decoding = 'sync';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The diagram could not be rasterised.'));
  });
  image.src = svgDataUrl(svg);
  await loaded;
  if (typeof image.decode === 'function') {
    try {
      await image.decode();
    } catch {
      // Safari resolves `onload` before `decode` in some cases; ignore.
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This system does not provide a 2D drawing context.');
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

async function canvasToBytes(
  canvas: HTMLCanvasElement,
  format: RasterFormat,
  quality: number,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, MIME[format], quality),
  );
  if (!blob) throw new Error(`This system cannot encode ${format.toUpperCase()} images.`);
  return new Uint8Array(await blob.arrayBuffer());
}

export async function exportRaster(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[],
  format: RasterFormat,
): Promise<RasterResult> {
  const { svg, region } = buildStandaloneSvg(doc, options, selection);
  // JPEG has no alpha channel, so it always needs a painted background.
  const background =
    format === 'jpeg' || !options.transparent ? options.background : null;
  const canvas = await svgToCanvas(
    svg,
    region.width,
    region.height,
    options.scale,
    background,
  );
  const bytes = await canvasToBytes(canvas, format, format === 'jpeg' ? 0.92 : 0.95);
  return { bytes, mimeType: MIME[format], width: canvas.width, height: canvas.height };
}
