/**
 * The FlowShark document model.
 *
 * Design rules that the rest of the code depends on:
 *
 * 1. A document is a plain, JSON-serialisable value. No class instances, no
 *    functions, no cycles. That keeps save/load, undo snapshots, and structural
 *    comparison trivial.
 * 2. Elements live in a keyed map (`elements`) and z-order lives in a single
 *    array (`order`, bottom-most first). The array position *is* the z-index;
 *    there is no separate field that could drift out of sync.
 * 3. Colours are sRGB hex strings (`#rrggbb`). Opacity is a separate 0..1
 *    number so a colour can be reused without carrying an alpha channel.
 */

import type { Point, Rect } from './geometry';

export type ElementId = string;
export type LayerId = string;

/** Bumped whenever the on-disk shape of a `.flowshark` file changes. */
export const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

export type StrokeStyle = 'solid' | 'dashed' | 'dotted';

export interface Gradient {
  from: string;
  to: string;
  /** Degrees, 0 = left-to-right, increasing clockwise. */
  angle: number;
}

export interface ShapeStyle {
  fill: string | 'none';
  fillOpacity: number;
  gradient: Gradient | null;
  stroke: string | 'none';
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  strokeOpacity: number;
  /** Corner radius in points; only meaningful for shapes that round corners. */
  cornerRadius: number;
  shadow: boolean;
  /** Whole-element opacity, multiplied with fill/stroke opacity. */
  opacity: number;
}

export type TextAlign = 'left' | 'center' | 'right';
export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  /** 400 regular, 500 medium, 600 semibold, 700 bold. */
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  /** Multiplier applied to font size. */
  lineHeight: number;
  wrap: boolean;
  /** Background behind the text run; `null` means transparent. */
  background: string | null;
}

export interface TextContent {
  value: string;
  style: TextStyle;
  /** Inset between the shape edge and the text box, in points. */
  padding: number;
}

export type MarkerKind =
  | 'none'
  | 'arrow'
  | 'open-arrow'
  | 'filled-arrow'
  | 'diamond'
  | 'filled-diamond'
  | 'circle'
  | 'filled-circle'
  | 'square'
  | 'filled-square'
  | 'bar';

export interface ConnectorStyle {
  stroke: string;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  opacity: number;
  startMarker: MarkerKind;
  endMarker: MarkerKind;
  /** Radius used to round elbow corners. 0 gives square corners. */
  cornerRadius: number;
}

export interface StylePreset {
  id: string;
  name: string;
  shape: Partial<ShapeStyle>;
  text: Partial<TextStyle>;
  connector: Partial<ConnectorStyle>;
}

// ---------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------

export interface ElementBase {
  id: ElementId;
  /** Shown in the layers list and read out by VoiceOver. */
  name: string;
  layerId: LayerId;
  locked: boolean;
  hidden: boolean;
  /** Id of the enclosing group element, or `null` at the top level. */
  groupId: ElementId | null;
}

export interface ShapeElement extends ElementBase {
  kind: 'shape';
  /** Key into the shape library (see `src/shapes/library.ts`). */
  shape: string;
  frame: Rect;
  /** Degrees clockwise about the frame centre. */
  rotation: number;
  style: ShapeStyle;
  text: TextContent;
  /** Grow the frame height to fit the text when true. */
  autoSize: boolean;
  /** Key into `document.images` for the `image` shape. */
  imageRef: string | null;
  /** Alternative text used by VoiceOver and by accessible exports. */
  altText: string;
}

export type ConnectorKind = 'straight' | 'elbow' | 'curved' | 'step' | 'freeform';

export type AnchorSpec =
  /** Attach to the nearest sensible point on the outline. */
  | { mode: 'floating' }
  /** Attach to a numbered connection point from the shape definition. */
  | { mode: 'fixed'; index: number }
  /** Attach to a proportional position inside the frame (0..1 on each axis). */
  | { mode: 'ratio'; rx: number; ry: number };

export interface ConnectorEndpoint {
  /** `null` when the endpoint floats free on the canvas. */
  elementId: ElementId | null;
  anchor: AnchorSpec;
  /** Canvas position. Authoritative when `elementId` is null, cached otherwise. */
  point: Point;
}

export interface ConnectorLabel {
  id: string;
  text: string;
  style: TextStyle;
  /** Position along the path, 0 = source end, 1 = target end. */
  position: number;
  /** Perpendicular offset from the line, in points. */
  offset: number;
  background: string | null;
  border: string | null;
}

export interface ConnectorElement extends ElementBase {
  kind: 'connector';
  connectorKind: ConnectorKind;
  source: ConnectorEndpoint;
  target: ConnectorEndpoint;
  /** User-placed bend points in canvas coordinates. */
  waypoints: Point[];
  /**
   * `dynamic` re-routes whenever a connected shape moves. `manual` keeps the
   * user's waypoints and only moves the endpoints.
   */
  routing: 'dynamic' | 'manual';
  /** Try to route around other shapes. Only used by elbow/step connectors. */
  avoidShapes: boolean;
  style: ConnectorStyle;
  labels: ConnectorLabel[];
  altText: string;
}

export interface GroupElement extends ElementBase {
  kind: 'group';
  children: ElementId[];
  altText: string;
}

export type DiagramElement = ShapeElement | ConnectorElement | GroupElement;

/** Elements that occupy a rectangular frame on the canvas. */
export type FramedElement = ShapeElement;

// ---------------------------------------------------------------------------
// Layers, canvas, document
// ---------------------------------------------------------------------------

export interface Layer {
  id: LayerId;
  name: string;
  visible: boolean;
  locked: boolean;
}

export interface GridSettings {
  visible: boolean;
  /** Spacing in points. */
  size: number;
  snap: boolean;
}

export interface PageSetup {
  /** Points, at 72 dpi. US Letter is 612 x 792. */
  width: number;
  height: number;
  margin: number;
  orientation: 'portrait' | 'landscape';
  /** Draw the page boundary on the canvas. */
  showBoundaries: boolean;
}

export interface CanvasSettings {
  /** `auto` follows the system appearance. */
  background: string | 'auto';
  grid: GridSettings;
  snapToElement: boolean;
  /** Snap distance in canvas points at 100% zoom. */
  snapTolerance: number;
  showGuides: boolean;
  showRulers: boolean;
  page: PageSetup;
}

export interface EmbeddedImage {
  id: string;
  /** MIME type, e.g. `image/png`. */
  mimeType: string;
  /** Base64 payload without the data-URL prefix. */
  data: string;
  width: number;
  height: number;
  name: string;
}

export interface DocumentMeta {
  title: string;
  /** ISO-8601 timestamps. */
  created: string;
  modified: string;
  author: string;
  /** Application version that last wrote the file. */
  application: string;
  description: string;
}

export interface FlowsharkDocument {
  schemaVersion: number;
  meta: DocumentMeta;
  canvas: CanvasSettings;
  layers: Layer[];
  elements: Record<ElementId, DiagramElement>;
  /** Global z-order, bottom-most first. Position in this array is the z-index. */
  order: ElementId[];
  presets: StylePreset[];
  images: Record<string, EmbeddedImage>;
}

// ---------------------------------------------------------------------------
// Narrowing helpers
// ---------------------------------------------------------------------------

export function isShape(element: DiagramElement | undefined): element is ShapeElement {
  return !!element && element.kind === 'shape';
}

export function isConnector(
  element: DiagramElement | undefined,
): element is ConnectorElement {
  return !!element && element.kind === 'connector';
}

export function isGroup(element: DiagramElement | undefined): element is GroupElement {
  return !!element && element.kind === 'group';
}
