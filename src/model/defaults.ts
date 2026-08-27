/**
 * Default styles and factory functions for new documents and new elements.
 *
 * The default palette is chosen to stay legible in both light and dark
 * appearance and to remain distinguishable under the common forms of colour
 * vision deficiency (see DECISIONS.md, D-011).
 */

import { createId } from './ids';
import {
  CURRENT_SCHEMA_VERSION,
  type CanvasSettings,
  type ConnectorElement,
  type ConnectorStyle,
  type DocumentMeta,
  type FlowsharkDocument,
  type Layer,
  type ShapeElement,
  type ShapeStyle,
  type StylePreset,
  type TextContent,
  type TextStyle,
} from './types';
import type { Rect } from './geometry';

export const APP_VERSION = '0.1.0';

/** The macOS system font stack. WKWebView resolves `-apple-system` first. */
export const SYSTEM_FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif';

export const FONT_FAMILIES = [
  'System',
  'Helvetica Neue',
  'Avenir Next',
  'SF Pro Rounded',
  'Georgia',
  'Times New Roman',
  'Menlo',
  'Courier New',
  'Verdana',
  'Optima',
] as const;

/** Map a stored family name onto a CSS font stack. */
export function fontStack(family: string): string {
  if (family === 'System' || !family) return SYSTEM_FONT_STACK;
  const monospace = family === 'Menlo' || family === 'Courier New';
  const serif =
    family === 'Georgia' || family === 'Times New Roman' || family === 'Optima';
  const fallback = monospace ? 'monospace' : serif ? 'serif' : SYSTEM_FONT_STACK;
  return `"${family}", ${fallback}`;
}

export function defaultShapeStyle(): ShapeStyle {
  return {
    fill: '#e8f0fe',
    fillOpacity: 1,
    gradient: null,
    stroke: '#2b5fd9',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    strokeOpacity: 1,
    cornerRadius: 6,
    shadow: false,
    opacity: 1,
  };
}

export function defaultTextStyle(): TextStyle {
  return {
    fontFamily: 'System',
    fontSize: 13,
    fontWeight: 400,
    italic: false,
    underline: false,
    color: '#10151f',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.3,
    wrap: true,
    background: null,
  };
}

export function defaultTextContent(value = ''): TextContent {
  return { value, style: defaultTextStyle(), padding: 8 };
}

export function defaultConnectorStyle(): ConnectorStyle {
  return {
    stroke: '#44506b',
    strokeWidth: 1.5,
    strokeStyle: 'solid',
    opacity: 1,
    startMarker: 'none',
    endMarker: 'filled-arrow',
    cornerRadius: 6,
  };
}

/**
 * Connector labels sit just off the line rather than on top of it, which is
 * how a "Yes" or "No" beside a decision branch is conventionally drawn and
 * what keeps the text readable over the grid.
 */
export const DEFAULT_LABEL_OFFSET = -12;

export function defaultLabelTextStyle(): TextStyle {
  return {
    ...defaultTextStyle(),
    fontSize: 11,
    align: 'center',
    verticalAlign: 'middle',
    wrap: false,
  };
}

export function defaultCanvasSettings(): CanvasSettings {
  return {
    background: 'auto',
    grid: { visible: true, size: 10, snap: true },
    snapToElement: true,
    snapTolerance: 6,
    showGuides: true,
    showRulers: false,
    page: {
      width: 792,
      height: 612,
      margin: 36,
      orientation: 'landscape',
      showBoundaries: false,
    },
  };
}

export function defaultLayer(): Layer {
  return { id: 'layer_default', name: 'Layer 1', visible: true, locked: false };
}

export function builtinPresets(): StylePreset[] {
  const base = { text: {}, connector: {} };
  return [
    {
      id: 'preset_blue',
      name: 'Blue',
      ...base,
      shape: { fill: '#e8f0fe', stroke: '#2b5fd9' },
      text: { color: '#10151f' },
      connector: { stroke: '#2b5fd9' },
    },
    {
      id: 'preset_slate',
      name: 'Slate',
      ...base,
      shape: { fill: '#eceff4', stroke: '#54607a' },
      text: { color: '#1d232e' },
      connector: { stroke: '#54607a' },
    },
    {
      id: 'preset_green',
      name: 'Green',
      ...base,
      shape: { fill: '#e4f5ea', stroke: '#1f7a4d' },
      text: { color: '#0e2a1c' },
      connector: { stroke: '#1f7a4d' },
    },
    {
      id: 'preset_amber',
      name: 'Amber',
      ...base,
      shape: { fill: '#fdf1dc', stroke: '#a86a12' },
      text: { color: '#33240a' },
      connector: { stroke: '#a86a12' },
    },
    {
      id: 'preset_rose',
      name: 'Rose',
      ...base,
      shape: { fill: '#fbe6ea', stroke: '#a8283f' },
      text: { color: '#33101a' },
      connector: { stroke: '#a8283f' },
    },
    {
      id: 'preset_outline',
      name: 'Outline',
      ...base,
      shape: { fill: 'none', stroke: '#44506b', strokeWidth: 1.5 },
      text: { color: '#10151f' },
      connector: { stroke: '#44506b' },
    },
  ];
}

export function defaultMeta(title = 'Untitled'): DocumentMeta {
  const now = new Date().toISOString();
  return {
    title,
    created: now,
    modified: now,
    author: '',
    application: `FlowShark ${APP_VERSION}`,
    description: '',
  };
}

export function createEmptyDocument(title = 'Untitled'): FlowsharkDocument {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    meta: defaultMeta(title),
    canvas: defaultCanvasSettings(),
    layers: [defaultLayer()],
    elements: {},
    order: [],
    presets: builtinPresets(),
    images: {},
  };
}

export interface CreateShapeOptions {
  shape: string;
  frame: Rect;
  text?: string;
  layerId?: string;
  style?: Partial<ShapeStyle>;
  textStyle?: Partial<TextStyle>;
  name?: string;
  id?: string;
}

export function createShapeElement(options: CreateShapeOptions): ShapeElement {
  return {
    id: options.id ?? createId('s'),
    kind: 'shape',
    name: options.name ?? '',
    layerId: options.layerId ?? 'layer_default',
    locked: false,
    hidden: false,
    groupId: null,
    shape: options.shape,
    frame: { ...options.frame },
    rotation: 0,
    style: { ...defaultShapeStyle(), ...options.style },
    text: {
      value: options.text ?? '',
      style: { ...defaultTextStyle(), ...options.textStyle },
      padding: 8,
    },
    autoSize: false,
    imageRef: null,
    altText: '',
  };
}

export interface CreateConnectorOptions {
  source: ConnectorElement['source'];
  target: ConnectorElement['target'];
  connectorKind?: ConnectorElement['connectorKind'];
  style?: Partial<ConnectorStyle>;
  layerId?: string;
  id?: string;
  label?: string;
}

export function createConnectorElement(
  options: CreateConnectorOptions,
): ConnectorElement {
  const connector: ConnectorElement = {
    id: options.id ?? createId('c'),
    kind: 'connector',
    name: '',
    layerId: options.layerId ?? 'layer_default',
    locked: false,
    hidden: false,
    groupId: null,
    connectorKind: options.connectorKind ?? 'elbow',
    source: options.source,
    target: options.target,
    waypoints: [],
    routing: 'dynamic',
    avoidShapes: false,
    style: { ...defaultConnectorStyle(), ...options.style },
    labels: [],
    altText: '',
  };
  if (options.label) {
    connector.labels.push({
      id: createId('l'),
      text: options.label,
      style: defaultLabelTextStyle(),
      position: 0.5,
      offset: DEFAULT_LABEL_OFFSET,
      background: null,
      border: null,
    });
  }
  return connector;
}
