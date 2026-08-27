/**
 * Shared export configuration.
 *
 * The SVG, PNG, JPEG, and PDF exporters all start from the same region
 * calculation so a diagram exported three ways lines up the same way.
 */

import type { Rect } from '../model/geometry';
import { inflateRect, unionRects } from '../model/geometry';
import { boundsOf, documentBounds, rootOf } from '../model/document';
import type { ElementId, FlowsharkDocument } from '../model/types';

export type ExportScope = 'document' | 'selection' | 'page';

/** Extra points added around the content so strokes are never clipped. */
export const STROKE_SLACK = 2;

export interface ExportOptions {
  scope: ExportScope;
  /** PNG and SVG only. PDF and JPEG always paint a background. */
  transparent: boolean;
  includeGrid: boolean;
  /** Raster multiplier. 2 matches a Retina display. */
  scale: number;
  margin: number;
  background: string;
}

export function defaultExportOptions(): ExportOptions {
  return {
    scope: 'document',
    transparent: false,
    includeGrid: false,
    scale: 2,
    margin: 24,
    background: '#ffffff',
  };
}

/** The region an export covers, already including the margin. */
export function exportRegion(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[] = [],
): Rect {
  if (options.scope === 'page') {
    const page = doc.canvas.page;
    const width = page.orientation === 'landscape' ? page.width : page.height;
    const height = page.orientation === 'landscape' ? page.height : page.width;
    return { x: 0, y: 0, width, height };
  }

  let bounds: Rect | null;
  if (options.scope === 'selection' && selection.length > 0) {
    bounds = boundsOf(doc, [...new Set(selection.map((id) => rootOf(doc, id)))]);
  } else {
    bounds = documentBounds(doc);
  }
  if (!bounds) bounds = { x: 0, y: 0, width: 400, height: 300 };
  // Element bounds follow the path, but a stroke straddles it, so a couple of
  // points of slack keep thick borders and shadows inside the exported image.
  const padded = inflateRect(bounds, options.margin + STROKE_SLACK);
  return unionRects([padded]) ?? padded;
}

export function exportFileName(doc: FlowsharkDocument, extension: string): string {
  const base = (doc.meta.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-').trim();
  return `${base || 'Untitled'}.${extension}`;
}
