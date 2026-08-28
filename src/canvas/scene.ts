/**
 * The scene builder.
 *
 * One function turns a document into SVG markup, and both the on-screen canvas
 * and the SVG, PNG, and PDF exporters use it. That is the only way to keep the
 * promise in the brief that an export matches the screen: there is no second
 * drawing path that can drift.
 *
 * Output is markup rather than DOM nodes because the screen renderer rebuilds
 * the whole scene only when the document changes — pan, zoom, and drags are
 * handled with transforms — so string building is both fast enough and exactly
 * what the exporters need.
 */

import type { Rect } from '../model/geometry';
import { rectCenter, round, unionRects } from '../model/geometry';
import type {
  ConnectorElement,
  ElementId,
  FlowsharkDocument,
  ShapeElement,
  TextStyle,
} from '../model/types';
import { isConnector, isShape } from '../model/types';
import { fontStack } from '../model/defaults';
import { getShapeDefinition, textBoxFor } from '../shapes/library';
import { collectMarkers, markerId, markerMarkup } from '../connectors/markers';
import { layoutText, positionLines } from '../text/layout';
import { elementBounds, routeOf, visibleElements } from '../model/document';
import { describeElement } from '../io/describe';
import {
  pointAlongPolyline,
  tangentAlongPolyline,
} from '../model/geometry';
import { escapeXml } from '../util/xml';

// Re-exported so callers that already build markup through the scene — the SVG
// exporter and its tests — have one obvious place to reach for escaping.
export { escapeXml } from '../util/xml';

export interface SceneTheme {
  /** Page background, or `null` for a transparent scene. */
  background: string | null;
  gridLine: string;
  gridLineStrong: string;
  pageBoundary: string;
}

export interface SceneOptions {
  theme: SceneTheme;
  showGrid: boolean;
  showPageBoundaries: boolean;
  /** Emit `data-id` hooks for pointer handling. Exports leave them out. */
  interactive: boolean;
  /** Emit `<title>` and ARIA roles for VoiceOver and accessible exports. */
  accessible: boolean;
  /** Restrict the scene to these elements (used by "export selection"). */
  only?: ReadonlySet<ElementId>;
  /** Area the grid should cover. Defaults to the content bounds. */
  gridArea?: Rect;
}

export interface Scene {
  defs: string;
  body: string;
  /** Bounds of the drawn content, or `null` when nothing is drawn. */
  contentBounds: Rect | null;
}

function dashArray(style: 'solid' | 'dashed' | 'dotted', strokeWidth: number): string {
  const w = Math.max(strokeWidth, 0.5);
  if (style === 'dashed') return `${round(w * 3.5, 2)} ${round(w * 2.5, 2)}`;
  if (style === 'dotted') return `${round(w * 0.1, 2)} ${round(w * 2, 2)}`;
  return '';
}

function opacityAttr(name: string, value: number): string {
  return value >= 1 ? '' : ` ${name}="${round(value, 3)}"`;
}

function transformFor(element: ShapeElement): string {
  const parts = [`translate(${round(element.frame.x, 2)} ${round(element.frame.y, 2)})`];
  if (element.rotation) {
    const cx = element.frame.width / 2;
    const cy = element.frame.height / 2;
    parts.push(`rotate(${round(element.rotation, 3)} ${round(cx, 2)} ${round(cy, 2)})`);
  }
  return parts.join(' ');
}

function textMarkup(
  value: string,
  style: TextStyle,
  box: Rect,
  className: string,
): string {
  if (!value.trim()) return '';
  const layout = layoutText(value, style, Math.max(box.width, 1));
  const lines = positionLines(layout, box, style);
  if (lines.length === 0) return '';

  const decoration = style.underline ? ' text-decoration="underline"' : '';
  const italic = style.italic ? ' font-style="italic"' : '';
  const background = style.background
    ? `<rect x="${round(box.x, 2)}" y="${round(
        lines[0].y - layout.lineHeight * 0.8,
        2,
      )}" width="${round(box.width, 2)}" height="${round(layout.height, 2)}" fill="${escapeXml(
        style.background,
      )}" rx="3"/>`
    : '';

  const tspans = lines
    .map(
      (line) =>
        `<tspan x="${round(line.x, 2)}" y="${round(line.y, 2)}">${
          escapeXml(line.text) || '&#160;'
        }</tspan>`,
    )
    .join('');

  return (
    background +
    `<text class="${className}" font-family="${escapeXml(fontStack(style.fontFamily))}" ` +
    `font-size="${round(style.fontSize, 2)}" font-weight="${style.fontWeight}"${italic}` +
    ` fill="${escapeXml(style.color)}"${decoration} xml:space="preserve">${tspans}</text>`
  );
}

function connectorAccessibleName(
  connector: ConnectorElement,
  doc: FlowsharkDocument,
): string {
  if (connector.altText) return connector.altText;
  const from = connector.source.elementId
    ? doc.elements[connector.source.elementId]
    : undefined;
  const to = connector.target.elementId ? doc.elements[connector.target.elementId] : undefined;
  const labels = connector.labels
    .map((label) => label.text.trim())
    .filter(Boolean)
    .join(', ');
  const base = `Connector from ${describeElement(doc, from)} to ${describeElement(doc, to)}`;
  return labels ? `${base}, labelled ${labels}` : base;
}

interface DefsCollector {
  gradients: string[];
  markers: string[];
  filters: Set<string>;
  clips: string[];
}

/**
 * Names gradients and clip paths independently of the document.
 *
 * An element id comes out of the document, so it can be any string at all,
 * including one carrying quotes and angle brackets. Interpolating it into an
 * `id` attribute — and into the `url(#…)` that points back at it — let a
 * crafted document inject markup into the rendered scene and into exported
 * SVG. A counter cannot, and nothing outside a scene refers to these
 * definitions by name.
 *
 * The counter is module-level rather than per scene because more than one
 * scene can be in the page at once — the canvas, a print sheet, and a preview
 * for each template in the chooser — and `url(#…)` resolves across the whole
 * document. Restarting at 1 for each scene would let a print sheet pick up the
 * canvas's gradient.
 */
let definitionCounter = 0;

function nextDefId(prefix: string): string {
  definitionCounter += 1;
  return `${prefix}-${definitionCounter}`;
}

function shapeMarkup(
  element: ShapeElement,
  doc: FlowsharkDocument,
  options: SceneOptions,
  defs: DefsCollector,
): string {
  const definition = getShapeDefinition(element.shape);
  const { style, frame } = element;
  const geometry = definition.geometry(frame.width, frame.height, style.cornerRadius);

  let fill = style.fill === 'none' ? 'none' : escapeXml(style.fill);
  if (style.gradient) {
    const id = nextDefId('fs-grad');
    const angle = ((style.gradient.angle % 360) + 360) % 360;
    const radians = (angle * Math.PI) / 180;
    const x1 = round(0.5 - Math.cos(radians) / 2, 4);
    const y1 = round(0.5 - Math.sin(radians) / 2, 4);
    const x2 = round(0.5 + Math.cos(radians) / 2, 4);
    const y2 = round(0.5 + Math.sin(radians) / 2, 4);
    defs.gradients.push(
      `<linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
        `<stop offset="0" stop-color="${escapeXml(style.gradient.from)}"/>` +
        `<stop offset="1" stop-color="${escapeXml(style.gradient.to)}"/></linearGradient>`,
    );
    fill = `url(#${id})`;
  }

  if (geometry.open) fill = 'none';

  const stroke = style.stroke === 'none' ? 'none' : escapeXml(style.stroke);
  const dash = dashArray(style.strokeStyle, style.strokeWidth);
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';
  const shadowAttr = style.shadow ? ' filter="url(#fs-shadow)"' : '';
  if (style.shadow) defs.filters.add('fs-shadow');

  const parts: string[] = [];
  if (options.interactive) {
    // A transparent copy of the outline underneath the real one, so that a
    // shape answers the pointer over its whole area even when it is drawn
    // with no fill or no stroke. Without it a text box — which is unfilled
    // and unstroked by default — has nothing for the pointer to land on and
    // cannot be selected or double-clicked to edit. Open outlines enclose no
    // area, so those get a fat stroke to hit instead.
    const hitStroke = geometry.open
      ? Math.max(style.strokeWidth * 3, 12)
      : Math.max(style.strokeWidth, 1);
    parts.push(
      `<path class="fs-shape-hit" d="${geometry.path}" fill="transparent" ` +
        `stroke="transparent" stroke-width="${round(hitStroke, 2)}" ` +
        `stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }
  parts.push(
    `<path class="fs-shape-path" d="${geometry.path}" fill="${fill}"` +
      opacityAttr('fill-opacity', style.fillOpacity) +
      ` stroke="${stroke}" stroke-width="${round(style.strokeWidth, 2)}"` +
      opacityAttr('stroke-opacity', style.strokeOpacity) +
      `${dashAttr} stroke-linejoin="round"${shadowAttr}/>`,
  );

  // Embedded image content is clipped to the shape outline.
  if (element.imageRef) {
    const image = doc.images[element.imageRef];
    if (image) {
      const clipId = nextDefId('fs-clip');
      defs.clips.push(`<clipPath id="${clipId}"><path d="${geometry.path}"/></clipPath>`);
      parts.push(
        `<image clip-path="url(#${clipId})" x="0" y="0" width="${round(frame.width, 2)}" ` +
          `height="${round(frame.height, 2)}" preserveAspectRatio="xMidYMid slice" ` +
          `href="data:${escapeXml(image.mimeType)};base64,${escapeXml(image.data)}"/>`,
      );
    }
  }

  for (const decoration of geometry.decorations ?? []) {
    parts.push(
      `<path d="${decoration.d}" fill="${decoration.filled ? fill : 'none'}" ` +
        `stroke="${stroke}" stroke-width="${round(
          decoration.hairline ? Math.max(style.strokeWidth * 0.75, 0.5) : style.strokeWidth,
          2,
        )}"${dashAttr} stroke-linejoin="round" stroke-linecap="round"/>`,
    );
  }

  const box = textBoxFor(definition, { x: 0, y: 0, width: frame.width, height: frame.height });
  const padded: Rect = {
    x: box.x + element.text.padding,
    y: box.y + element.text.padding,
    width: Math.max(box.width - element.text.padding * 2, 1),
    height: Math.max(box.height - element.text.padding * 2, 1),
  };
  parts.push(textMarkup(element.text.value, element.text.style, padded, 'fs-shape-text'));

  const attributes = [
    `class="fs-element fs-shape"`,
    options.interactive ? `data-id="${escapeXml(element.id)}" data-kind="shape"` : '',
    `transform="${transformFor(element)}"`,
    opacityAttr('opacity', style.opacity).trim(),
    options.accessible ? `role="img" aria-label="${escapeXml(describeElement(doc, element))}"` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = options.accessible
    ? `<title>${escapeXml(describeElement(doc, element))}</title>`
    : '';

  return `<g ${attributes}>${title}${parts.join('')}</g>`;
}

function connectorMarkup(
  connector: ConnectorElement,
  doc: FlowsharkDocument,
  options: SceneOptions,
  defs: DefsCollector,
): string {
  const route = routeOf(doc, connector);
  const { style } = connector;
  const dash = dashArray(style.strokeStyle, style.strokeWidth);
  const dashAttr = dash ? ` stroke-dasharray="${dash}"` : '';

  const startId =
    style.startMarker === 'none'
      ? ''
      : markerId({ kind: style.startMarker, color: style.stroke, reverse: true });
  const endId =
    style.endMarker === 'none'
      ? ''
      : markerId({ kind: style.endMarker, color: style.stroke, reverse: false });
  if (startId) {
    defs.markers.push(
      markerMarkup({ kind: style.startMarker, color: style.stroke, reverse: true }),
    );
  }
  if (endId) {
    defs.markers.push(
      markerMarkup({ kind: style.endMarker, color: style.stroke, reverse: false }),
    );
  }

  const parts: string[] = [];
  if (options.interactive) {
    // A fat transparent copy of the line makes thin connectors easy to hit.
    parts.push(
      `<path class="fs-connector-hit" d="${route.d}" fill="none" stroke="transparent" ` +
        `stroke-width="${round(Math.max(style.strokeWidth * 3, 12), 2)}" stroke-linecap="round"/>`,
    );
  }
  parts.push(
    `<path class="fs-connector-line" d="${route.d}" fill="none" ` +
      `stroke="${escapeXml(style.stroke)}" stroke-width="${round(style.strokeWidth, 2)}"` +
      `${dashAttr} stroke-linecap="round" stroke-linejoin="round"` +
      (startId ? ` marker-start="url(#${startId})"` : '') +
      (endId ? ` marker-end="url(#${endId})"` : '') +
      '/>',
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
    const box: Rect = {
      x: centre.x - width / 2,
      y: centre.y - height / 2,
      width,
      height,
    };
    const background = label.background
      ? `<rect x="${round(box.x, 2)}" y="${round(box.y, 2)}" width="${round(width, 2)}" ` +
        `height="${round(height, 2)}" rx="3" fill="${escapeXml(label.background)}"` +
        (label.border ? ` stroke="${escapeXml(label.border)}" stroke-width="1"` : '') +
        '/>'
      : '';
    const hook = options.interactive
      ? ` data-label-id="${escapeXml(label.id)}" data-id="${escapeXml(connector.id)}" data-kind="label"`
      : '';
    parts.push(
      `<g class="fs-connector-label"${hook}>${background}${textMarkup(
        label.text,
        label.style,
        box,
        'fs-label-text',
      )}</g>`,
    );
  }

  const attributes = [
    'class="fs-element fs-connector"',
    options.interactive ? `data-id="${escapeXml(connector.id)}" data-kind="connector"` : '',
    opacityAttr('opacity', style.opacity).trim(),
    options.accessible
      ? `role="img" aria-label="${escapeXml(connectorAccessibleName(connector, doc))}"`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  const title = options.accessible
    ? `<title>${escapeXml(connectorAccessibleName(connector, doc))}</title>`
    : '';

  return `<g ${attributes}>${title}${parts.join('')}</g>`;
}

function gridMarkup(area: Rect, size: number, theme: SceneTheme): string {
  if (size <= 0) return '';
  const lines: string[] = [];
  const startX = Math.floor(area.x / size) * size;
  const startY = Math.floor(area.y / size) * size;
  const endX = area.x + area.width;
  const endY = area.y + area.height;
  // Cap the line count so a huge area cannot stall the renderer.
  const maxLines = 4000;
  if ((endX - startX) / size + (endY - startY) / size > maxLines) return '';

  for (let x = startX; x <= endX; x += size) {
    const strong = Math.round(x / size) % 10 === 0;
    lines.push(
      `<line x1="${round(x, 2)}" y1="${round(area.y, 2)}" x2="${round(x, 2)}" y2="${round(
        endY,
        2,
      )}" stroke="${strong ? theme.gridLineStrong : theme.gridLine}" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
    );
  }
  for (let y = startY; y <= endY; y += size) {
    const strong = Math.round(y / size) % 10 === 0;
    lines.push(
      `<line x1="${round(area.x, 2)}" y1="${round(y, 2)}" x2="${round(endX, 2)}" y2="${round(
        y,
        2,
      )}" stroke="${strong ? theme.gridLineStrong : theme.gridLine}" stroke-width="1" vector-effect="non-scaling-stroke"/>`,
    );
  }
  return `<g class="fs-grid" aria-hidden="true">${lines.join('')}</g>`;
}

/** Build the scene for `doc`. */
export function buildScene(doc: FlowsharkDocument, options: SceneOptions): Scene {
  const defs: DefsCollector = {
    gradients: [],
    markers: [],
    filters: new Set(),
    clips: [],
  };

  const elements = visibleElements(doc).filter(
    (element) => !options.only || options.only.has(element.id),
  );

  const bodyParts: string[] = [];
  const rects: Rect[] = [];

  for (const element of elements) {
    const bounds = elementBounds(doc, element);
    if (bounds) rects.push(bounds);
    if (isShape(element)) bodyParts.push(shapeMarkup(element, doc, options, defs));
    else if (isConnector(element)) bodyParts.push(connectorMarkup(element, doc, options, defs));
  }

  const contentBounds = unionRects(rects);

  const layers: string[] = [];
  if (options.showGrid) {
    const area =
      options.gridArea ??
      (contentBounds
        ? {
            x: contentBounds.x - 200,
            y: contentBounds.y - 200,
            width: contentBounds.width + 400,
            height: contentBounds.height + 400,
          }
        : { x: 0, y: 0, width: 1200, height: 800 });
    layers.push(gridMarkup(area, doc.canvas.grid.size, options.theme));
  }
  if (options.showPageBoundaries) {
    const page = doc.canvas.page;
    const width = page.orientation === 'landscape' ? page.width : page.height;
    const height = page.orientation === 'landscape' ? page.height : page.width;
    layers.push(
      `<rect class="fs-page" x="0" y="0" width="${width}" height="${height}" fill="none" ` +
        `stroke="${options.theme.pageBoundary}" stroke-width="1" stroke-dasharray="6 4" ` +
        `vector-effect="non-scaling-stroke" aria-hidden="true"/>`,
    );
  }
  layers.push(...bodyParts);

  const uniqueMarkers = [...new Set(defs.markers)];
  const filterMarkup = defs.filters.has('fs-shadow')
    ? '<filter id="fs-shadow" x="-30%" y="-30%" width="160%" height="160%">' +
      '<feDropShadow dx="0" dy="2" stdDeviation="3" flood-opacity="0.28"/></filter>'
    : '';

  return {
    defs: [...defs.gradients, ...uniqueMarkers, ...defs.clips, filterMarkup].join(''),
    body: layers.join(''),
    contentBounds,
  };
}

/** Markers needed by the whole document, for the on-screen defs block. */
export function documentMarkers(doc: FlowsharkDocument): string {
  const connectors = Object.values(doc.elements).filter(isConnector);
  return collectMarkers(connectors).map(markerMarkup).join('');
}

/** Centre of an element's bounds, used to place popovers and inline editors. */
export function elementCentre(doc: FlowsharkDocument, id: ElementId) {
  const element = doc.elements[id];
  if (!element) return null;
  const bounds = elementBounds(doc, element);
  return bounds ? rectCenter(bounds) : null;
}
