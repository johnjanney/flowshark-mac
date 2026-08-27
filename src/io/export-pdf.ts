/**
 * PDF export.
 *
 * Two paths are available:
 *
 * - **Vector** (preferred). Shapes, connectors, and text become PDF drawing
 *   operators, so the file scales cleanly and the text is selectable and
 *   searchable. Text uses the PDF base-14 fonts with WinAnsi encoding.
 * - **Raster**. The diagram is rasterised and embedded as a single image.
 *
 * `auto` picks vector unless the document uses something vector output cannot
 * reproduce faithfully — text outside WinAnsi (Chinese, Japanese, Korean,
 * Cyrillic, Greek, and so on) or an embedded bitmap — in which case it falls
 * back to raster and says so in `warnings`.
 */

import type { Point, Rect } from '../model/geometry';
import { rectCenter, rotatePoint } from '../model/geometry';
import type { ElementId, FlowsharkDocument, ShapeElement, TextStyle } from '../model/types';
import { isConnector, isShape } from '../model/types';
import { getShapeDefinition, textBoxFor } from '../shapes/library';
import { routeOf, visibleElements } from '../model/document';
import { layoutText, positionLines } from '../text/layout';
import {
  markerGeometry,
  markerInset,
} from '../connectors/markers';
import { pointAlongPolyline, tangentAlongPolyline } from '../model/geometry';
import { parsePath, transformSegments, type PathSegment } from './svg-path';
import { PdfWriter, fmt, isWinAnsiSafe, pdfColor, pdfString } from './pdf-writer';
import { exportRegion, type ExportOptions } from './export';
import { buildStandaloneSvg } from './export-svg';
import { svgToCanvas } from './export-raster';

export type PdfMode = 'auto' | 'vector' | 'raster';

export interface PdfResult {
  bytes: Uint8Array;
  mode: 'vector' | 'raster';
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

type FontFamilyGroup = 'sans' | 'serif' | 'mono';

const SERIF_FAMILIES = new Set(['Georgia', 'Times New Roman', 'Optima']);
const MONO_FAMILIES = new Set(['Menlo', 'Courier New']);

function familyGroup(family: string): FontFamilyGroup {
  if (SERIF_FAMILIES.has(family)) return 'serif';
  if (MONO_FAMILIES.has(family)) return 'mono';
  return 'sans';
}

const BASE_FONTS: Record<FontFamilyGroup, Record<string, string>> = {
  sans: {
    regular: 'Helvetica',
    bold: 'Helvetica-Bold',
    italic: 'Helvetica-Oblique',
    bolditalic: 'Helvetica-BoldOblique',
  },
  serif: {
    regular: 'Times-Roman',
    bold: 'Times-Bold',
    italic: 'Times-Italic',
    bolditalic: 'Times-BoldItalic',
  },
  mono: {
    regular: 'Courier',
    bold: 'Courier-Bold',
    italic: 'Courier-Oblique',
    bolditalic: 'Courier-BoldOblique',
  },
};

function baseFontFor(style: TextStyle): string {
  const group = familyGroup(style.fontFamily);
  const bold = style.fontWeight >= 600;
  const key = bold && style.italic ? 'bolditalic' : bold ? 'bold' : style.italic ? 'italic' : 'regular';
  return BASE_FONTS[group][key];
}

// ---------------------------------------------------------------------------
// Content stream construction
// ---------------------------------------------------------------------------

class ContentStream {
  private parts: string[] = [];

  readonly fonts = new Map<string, string>();
  readonly extGStates = new Map<string, { fill: number; stroke: number }>();
  readonly shadings = new Map<string, { from: string; to: string; angle: number; box: Rect }>();

  push(line: string): void {
    this.parts.push(line);
  }

  toString(): string {
    return this.parts.join('\n');
  }

  fontResource(style: TextStyle): string {
    const base = baseFontFor(style);
    for (const [name, value] of this.fonts) if (value === base) return name;
    const name = `F${this.fonts.size + 1}`;
    this.fonts.set(name, base);
    return name;
  }

  opacityResource(fill: number, stroke: number): string | null {
    if (fill >= 1 && stroke >= 1) return null;
    const key = `${fill.toFixed(3)}:${stroke.toFixed(3)}`;
    for (const [name, value] of this.extGStates) {
      if (`${value.fill.toFixed(3)}:${value.stroke.toFixed(3)}` === key) return name;
    }
    const name = `GS${this.extGStates.size + 1}`;
    this.extGStates.set(name, { fill, stroke });
    return name;
  }

  shadingResource(from: string, to: string, angle: number, box: Rect): string {
    const name = `Sh${this.shadings.size + 1}`;
    this.shadings.set(name, { from, to, angle, box });
    return name;
  }
}

function emitPath(content: ContentStream, segments: readonly PathSegment[]): void {
  for (const segment of segments) {
    switch (segment.type) {
      case 'move':
        content.push(`${fmt(segment.to.x)} ${fmt(segment.to.y)} m`);
        break;
      case 'line':
        content.push(`${fmt(segment.to.x)} ${fmt(segment.to.y)} l`);
        break;
      case 'cubic':
        content.push(
          `${fmt(segment.c1.x)} ${fmt(segment.c1.y)} ${fmt(segment.c2.x)} ${fmt(
            segment.c2.y,
          )} ${fmt(segment.to.x)} ${fmt(segment.to.y)} c`,
        );
        break;
      case 'close':
        content.push('h');
        break;
    }
  }
}

function dashPattern(style: 'solid' | 'dashed' | 'dotted', width: number): string {
  const w = Math.max(width, 0.5);
  if (style === 'dashed') return `[${fmt(w * 3.5)} ${fmt(w * 2.5)}] 0 d`;
  if (style === 'dotted') return `[${fmt(w * 0.1)} ${fmt(w * 2)}] 0 d`;
  return '[] 0 d';
}

function setFill(content: ContentStream, color: string): void {
  const [r, g, b] = pdfColor(color);
  content.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} rg`);
}

function setStroke(content: ContentStream, color: string): void {
  const [r, g, b] = pdfColor(color);
  content.push(`${fmt(r)} ${fmt(g)} ${fmt(b)} RG`);
}

function drawText(
  content: ContentStream,
  value: string,
  style: TextStyle,
  box: Rect,
): void {
  if (!value.trim()) return;
  const layout = layoutText(value, style, Math.max(box.width, 1));
  const lines = positionLines(layout, box, style);
  if (lines.length === 0) return;

  const font = content.fontResource(style);
  setFill(content, style.color);
  content.push('BT');
  content.push(`/${font} ${fmt(style.fontSize)} Tf`);
  for (const line of lines) {
    if (!line.text) continue;
    // The page CTM flips y; the text matrix flips it back so glyphs sit upright.
    content.push(`1 0 0 -1 ${fmt(line.x)} ${fmt(line.y)} Tm`);
    content.push(`${pdfString(line.text)} Tj`);
  }
  content.push('ET');

  if (style.underline) {
    setStroke(content, style.color);
    content.push(`${fmt(Math.max(style.fontSize * 0.06, 0.4))} w [] 0 d`);
    for (const line of lines) {
      if (!line.text) continue;
      const y = line.y + style.fontSize * 0.14;
      content.push(`${fmt(line.x)} ${fmt(y)} m ${fmt(line.x + line.width)} ${fmt(y)} l S`);
    }
  }
}

function shapeTransform(element: ShapeElement): (p: Point) => Point {
  const centre = rectCenter({
    x: 0,
    y: 0,
    width: element.frame.width,
    height: element.frame.height,
  });
  return (p: Point): Point => {
    const rotated = element.rotation ? rotatePoint(p, centre, element.rotation) : p;
    return { x: rotated.x + element.frame.x, y: rotated.y + element.frame.y };
  };
}

function drawShape(content: ContentStream, doc: FlowsharkDocument, element: ShapeElement): void {
  const definition = getShapeDefinition(element.shape);
  const { style, frame } = element;
  const geometry = definition.geometry(frame.width, frame.height, style.cornerRadius);
  const transform = shapeTransform(element);

  content.push('q');
  const gs = content.opacityResource(
    style.opacity * style.fillOpacity,
    style.opacity * style.strokeOpacity,
  );
  if (gs) content.push(`/${gs} gs`);

  const outline = transformSegments(parsePath(geometry.path), transform);
  const hasFill = style.fill !== 'none' && !geometry.open;
  const hasStroke = style.stroke !== 'none' && style.strokeWidth > 0;

  if (hasFill && style.gradient) {
    // Clip to the outline and paint an axial shading across the frame.
    content.push('q');
    emitPath(content, outline);
    content.push('W n');
    const corners = [
      transform({ x: 0, y: 0 }),
      transform({ x: frame.width, y: 0 }),
      transform({ x: frame.width, y: frame.height }),
      transform({ x: 0, y: frame.height }),
    ];
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const box: Rect = {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      height: Math.max(...ys) - Math.min(...ys),
    };
    const shading = content.shadingResource(
      style.gradient.from,
      style.gradient.to,
      style.gradient.angle,
      box,
    );
    content.push(`/${shading} sh`);
    content.push('Q');
  } else if (hasFill) {
    setFill(content, style.fill);
    emitPath(content, outline);
    content.push('f');
  }

  if (hasStroke) {
    setStroke(content, style.stroke);
    content.push(`${fmt(style.strokeWidth)} w 1 j 1 J`);
    content.push(dashPattern(style.strokeStyle, style.strokeWidth));
    emitPath(content, outline);
    content.push('S');
  }

  for (const decoration of geometry.decorations ?? []) {
    if (!hasStroke) break;
    const width = decoration.hairline
      ? Math.max(style.strokeWidth * 0.75, 0.5)
      : style.strokeWidth;
    content.push(`${fmt(width)} w`);
    emitPath(content, transformSegments(parsePath(decoration.d), transform));
    content.push('S');
  }

  const localBox = textBoxFor(definition, {
    x: 0,
    y: 0,
    width: frame.width,
    height: frame.height,
  });
  const padded: Rect = {
    x: localBox.x + element.text.padding + frame.x,
    y: localBox.y + element.text.padding + frame.y,
    width: Math.max(localBox.width - element.text.padding * 2, 1),
    height: Math.max(localBox.height - element.text.padding * 2, 1),
  };
  drawText(content, element.text.value, element.text.style, padded);

  content.push('Q');
  void doc;
}

function drawMarker(
  content: ContentStream,
  kind: Parameters<typeof markerGeometry>[0],
  at: Point,
  direction: Point,
  color: string,
  strokeWidth: number,
): void {
  const geometry = markerGeometry(kind);
  if (!geometry) return;
  const scale = (geometry.size * Math.max(strokeWidth, 0.5)) / 12;
  const angle = Math.atan2(direction.y, direction.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  const transform = (p: Point): Point => {
    // View-box space -> marker space (ref point at the origin) -> canvas.
    const local = { x: (p.x - geometry.refX) * scale, y: (p.y - 6) * scale };
    return {
      x: at.x + local.x * cos - local.y * sin,
      y: at.y + local.x * sin + local.y * cos,
    };
  };

  const segments = transformSegments(parsePath(geometry.d), transform);
  setFill(content, color);
  setStroke(content, color);
  content.push(`${fmt(1.6 * scale)} w 1 j 1 J [] 0 d`);
  emitPath(content, segments);
  content.push(geometry.filled ? 'B' : 'S');
}

function drawConnector(
  content: ContentStream,
  doc: FlowsharkDocument,
  connector: FlowsharkDocument['elements'][string],
): void {
  if (!isConnector(connector)) return;
  const route = routeOf(doc, connector);
  const { style } = connector;

  content.push('q');
  const gs = content.opacityResource(style.opacity, style.opacity);
  if (gs) content.push(`/${gs} gs`);

  // Shorten the line so it does not show through a filled arrowhead.
  const points = [...route.points];
  const startInset = markerInset(style.startMarker, style.strokeWidth);
  const endInset = markerInset(style.endMarker, style.strokeWidth);
  if (startInset > 0 && points.length >= 2) {
    points[0] = {
      x: points[0].x + route.startDirection.x * startInset,
      y: points[0].y + route.startDirection.y * startInset,
    };
  }
  if (endInset > 0 && points.length >= 2) {
    const last = points.length - 1;
    points[last] = {
      x: points[last].x - route.endDirection.x * endInset,
      y: points[last].y - route.endDirection.y * endInset,
    };
  }

  setStroke(content, style.stroke);
  content.push(`${fmt(style.strokeWidth)} w 1 j 1 J`);
  content.push(dashPattern(style.strokeStyle, style.strokeWidth));
  // Reuse the rendered path so curves and rounded elbows match the screen.
  const segments = parsePath(route.d);
  if (startInset > 0 || endInset > 0) {
    content.push(`${fmt(points[0].x)} ${fmt(points[0].y)} m`);
    for (let i = 1; i < points.length; i++) {
      content.push(`${fmt(points[i].x)} ${fmt(points[i].y)} l`);
    }
  } else {
    emitPath(content, segments);
  }
  content.push('S');

  drawMarker(
    content,
    style.startMarker,
    route.points[0],
    { x: -route.startDirection.x, y: -route.startDirection.y },
    style.stroke,
    style.strokeWidth,
  );
  drawMarker(
    content,
    style.endMarker,
    route.points[route.points.length - 1],
    route.endDirection,
    style.stroke,
    style.strokeWidth,
  );

  for (const label of connector.labels) {
    if (!label.text.trim()) continue;
    const anchor = pointAlongPolyline(route.points, label.position);
    const tangent = tangentAlongPolyline(route.points, label.position);
    const normal = { x: -tangent.y, y: tangent.x };
    const centre = {
      x: anchor.x + normal.x * label.offset,
      y: anchor.y + normal.y * label.offset,
    };
    const layout = layoutText(label.text, label.style, 400);
    const width = Math.max(layout.width, 8) + 10;
    const height = layout.height + 6;
    const box: Rect = { x: centre.x - width / 2, y: centre.y - height / 2, width, height };
    if (label.background) {
      setFill(content, label.background);
      content.push(
        `${fmt(box.x)} ${fmt(box.y)} ${fmt(box.width)} ${fmt(box.height)} re ${
          label.border ? 'B' : 'f'
        }`,
      );
    }
    drawText(content, label.text, label.style, box);
  }

  content.push('Q');
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function collectSelection(
  doc: FlowsharkDocument,
  selection: readonly ElementId[],
): Set<ElementId> {
  const out = new Set<ElementId>();
  const stack = [...selection];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const element = doc.elements[id];
    if (!element) continue;
    out.add(id);
    if (element.kind === 'group') stack.push(...element.children);
  }
  return out;
}

function inspectDocument(
  doc: FlowsharkDocument,
  only: Set<ElementId> | undefined,
): { needsRaster: boolean; warnings: string[] } {
  const warnings: string[] = [];
  let needsRaster = false;
  for (const element of visibleElements(doc)) {
    if (only && !only.has(element.id)) continue;
    if (isShape(element)) {
      if (element.imageRef && doc.images[element.imageRef]) {
        needsRaster = true;
        warnings.push('The diagram contains an embedded image.');
      }
      if (!isWinAnsiSafe(element.text.value)) {
        needsRaster = true;
        warnings.push('Some text uses characters outside the Western European set.');
      }
    } else if (isConnector(element)) {
      for (const label of element.labels) {
        if (!isWinAnsiSafe(label.text)) {
          needsRaster = true;
          warnings.push('Some connector labels use characters outside the Western European set.');
        }
      }
    }
  }
  return { needsRaster, warnings: [...new Set(warnings)] };
}

function buildVectorPdf(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[],
): Uint8Array {
  const region = exportRegion(doc, options, selection);
  const only =
    options.scope === 'selection' && selection.length > 0
      ? collectSelection(doc, selection)
      : undefined;

  const content = new ContentStream();
  content.push('q');
  if (!options.transparent) {
    setFill(content, options.background);
    content.push(`0 0 ${fmt(region.width)} ${fmt(region.height)} re f`);
  }
  // Flip to a y-down coordinate system that matches the canvas.
  content.push(`1 0 0 -1 ${fmt(-region.x)} ${fmt(region.y + region.height)} cm`);

  for (const element of visibleElements(doc)) {
    if (only && !only.has(element.id)) continue;
    if (isShape(element)) drawShape(content, doc, element);
    else if (isConnector(element)) drawConnector(content, doc, element);
  }
  content.push('Q');

  const writer = new PdfWriter();
  const pagesId = writer.reserve();
  const contentId = writer.addStream('', content.toString());

  const fontIds = new Map<string, number>();
  for (const [name, base] of content.fonts) {
    fontIds.set(
      name,
      writer.add(
        `<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`,
      ),
    );
  }
  const gsIds = new Map<string, number>();
  for (const [name, value] of content.extGStates) {
    gsIds.set(
      name,
      writer.add(
        `<< /Type /ExtGState /ca ${fmt(value.fill)} /CA ${fmt(value.stroke)} >>`,
      ),
    );
  }
  const shadingIds = new Map<string, number>();
  for (const [name, value] of content.shadings) {
    const radians = ((value.angle % 360) * Math.PI) / 180;
    const halfW = value.box.width / 2;
    const halfH = value.box.height / 2;
    const cx = value.box.x + halfW;
    const cy = value.box.y + halfH;
    const x0 = cx - Math.cos(radians) * halfW;
    const y0 = cy - Math.sin(radians) * halfH;
    const x1 = cx + Math.cos(radians) * halfW;
    const y1 = cy + Math.sin(radians) * halfH;
    const [r0, g0, b0] = pdfColor(value.from);
    const [r1, g1, b1] = pdfColor(value.to);
    const functionId = writer.add(
      `<< /FunctionType 2 /Domain [0 1] /C0 [${fmt(r0)} ${fmt(g0)} ${fmt(b0)}] ` +
        `/C1 [${fmt(r1)} ${fmt(g1)} ${fmt(b1)}] /N 1 >>`,
    );
    shadingIds.set(
      name,
      writer.add(
        `<< /ShadingType 2 /ColorSpace /DeviceRGB /Coords [${fmt(x0)} ${fmt(y0)} ${fmt(
          x1,
        )} ${fmt(y1)}] /Function ${functionId} 0 R /Extend [true true] >>`,
      ),
    );
  }

  const resourceParts: string[] = ['/ProcSet [/PDF /Text]'];
  if (fontIds.size > 0) {
    resourceParts.push(
      `/Font << ${[...fontIds].map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >>`,
    );
  }
  if (gsIds.size > 0) {
    resourceParts.push(
      `/ExtGState << ${[...gsIds].map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >>`,
    );
  }
  if (shadingIds.size > 0) {
    resourceParts.push(
      `/Shading << ${[...shadingIds].map(([name, id]) => `/${name} ${id} 0 R`).join(' ')} >>`,
    );
  }

  const pageId = writer.add(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(region.width)} ${fmt(
      region.height,
    )}] /Resources << ${resourceParts.join(' ')} >> /Contents ${contentId} 0 R >>`,
  );
  writer.fill(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = writer.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const infoId = writer.add(
    `<< /Title ${pdfString(doc.meta.title || 'Untitled')} /Producer ${pdfString(
      doc.meta.application,
    )} /Creator ${pdfString('FlowShark')} >>`,
  );
  return writer.build(catalogId, infoId);
}

async function buildRasterPdf(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[],
): Promise<Uint8Array> {
  const { svg, region } = buildStandaloneSvg(doc, options, selection);
  const canvas = await svgToCanvas(
    svg,
    region.width,
    region.height,
    Math.max(options.scale, 2),
    options.background,
  );
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.94),
  );
  if (!blob) throw new Error('This system cannot encode the diagram as an image.');
  const jpeg = new Uint8Array(await blob.arrayBuffer());

  const writer = new PdfWriter();
  const pagesId = writer.reserve();
  const imageId = writer.addStream(
    `/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
    jpeg,
  );
  const contentId = writer.addStream(
    '',
    `q ${fmt(region.width)} 0 0 ${fmt(region.height)} 0 0 cm /Im0 Do Q`,
  );
  const pageId = writer.add(
    `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${fmt(region.width)} ${fmt(
      region.height,
    )}] /Resources << /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imageId} 0 R >> >> ` +
      `/Contents ${contentId} 0 R >>`,
  );
  writer.fill(pagesId, `<< /Type /Pages /Kids [${pageId} 0 R] /Count 1 >>`);
  const catalogId = writer.add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  const infoId = writer.add(
    `<< /Title ${pdfString(doc.meta.title || 'Untitled')} /Producer ${pdfString(
      doc.meta.application,
    )} >>`,
  );
  return writer.build(catalogId, infoId);
}

export async function exportPdf(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[] = [],
  mode: PdfMode = 'auto',
): Promise<PdfResult> {
  const only =
    options.scope === 'selection' && selection.length > 0
      ? collectSelection(doc, selection)
      : undefined;
  const inspection = inspectDocument(doc, only);

  const useRaster = mode === 'raster' || (mode === 'auto' && inspection.needsRaster);
  if (useRaster) {
    return {
      bytes: await buildRasterPdf(doc, options, selection),
      mode: 'raster',
      warnings:
        mode === 'auto' && inspection.warnings.length > 0
          ? [
              ...inspection.warnings,
              'FlowShark exported a picture-based PDF so the diagram looks exactly as it does on screen. The text in it is not selectable.',
            ]
          : [],
    };
  }

  return {
    bytes: buildVectorPdf(doc, options, selection),
    mode: 'vector',
    warnings:
      mode === 'vector' && inspection.needsRaster
        ? [
            ...inspection.warnings,
            'Vector PDF was requested, so some content may not appear as it does on screen.',
          ]
        : [],
  };
}

/** Synchronous vector-only export, used by the pasteboard and drag-out paths. */
export function exportVectorPdf(
  doc: FlowsharkDocument,
  options: ExportOptions,
  selection: readonly ElementId[] = [],
): Uint8Array {
  return buildVectorPdf(doc, options, selection);
}
