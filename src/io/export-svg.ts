/**
 * SVG export.
 *
 * The output is a standalone document: no external references, no scripts, and
 * an explicit sRGB colour interpretation so the file looks the same in Preview,
 * in a browser, and in Keynote.
 */

import type { Rect } from '../model/geometry';
import { round } from '../model/geometry';
import type { ElementId, FlowsharkDocument } from '../model/types';
import { buildScene, escapeXml, type SceneTheme } from '../canvas/scene';
import { exportRegion, type ExportOptions } from './export';

const EXPORT_THEME: SceneTheme = {
  background: null,
  gridLine: '#e4e7ee',
  gridLineStrong: '#ccd2de',
  pageBoundary: '#b8bfcd',
};

export interface SvgExportResult {
  svg: string;
  region: Rect;
}

export function buildStandaloneSvg(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[] = [],
): SvgExportResult {
  const region = exportRegion(doc, options, selection);
  const only =
    options.scope === 'selection' && selection.length > 0
      ? new Set<ElementId>(collectSelection(doc, selection))
      : undefined;

  const scene = buildScene(doc, {
    theme: EXPORT_THEME,
    showGrid: options.includeGrid,
    showPageBoundaries: false,
    interactive: false,
    accessible: true,
    only,
    gridArea: region,
  });

  const background = options.transparent
    ? ''
    : `<rect x="${round(region.x, 2)}" y="${round(region.y, 2)}" width="${round(
        region.width,
        2,
      )}" height="${round(region.height, 2)}" fill="${escapeXml(options.background)}"/>`;

  const title = escapeXml(doc.meta.title || 'Untitled');
  const description = escapeXml(
    doc.meta.description || `FlowShark diagram with ${Object.keys(doc.elements).length} elements.`,
  );

  const svg =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ` +
    `version="1.1" width="${round(region.width, 2)}" height="${round(region.height, 2)}" ` +
    `viewBox="${round(region.x, 2)} ${round(region.y, 2)} ${round(region.width, 2)} ${round(
      region.height,
      2,
    )}" color-interpolation="sRGB">` +
    `<title>${title}</title><desc>${description}</desc>` +
    `<defs>${scene.defs}</defs>${background}${scene.body}</svg>\n`;

  return { svg, region };
}

/** Selection plus the descendants of any selected group. */
function collectSelection(
  doc: FlowsharkDocument,
  selection: readonly ElementId[],
): ElementId[] {
  const out = new Set<ElementId>();
  const stack = [...selection];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const element = doc.elements[id];
    if (!element) continue;
    out.add(id);
    if (element.kind === 'group') stack.push(...element.children);
  }
  return [...out];
}
