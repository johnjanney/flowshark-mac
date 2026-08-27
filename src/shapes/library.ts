/**
 * The FlowShark shape library.
 *
 * Each definition knows how to draw itself inside a frame, where its
 * connection points sit, and how much room the text gets. The canvas engine,
 * the sidebar, and every exporter share these definitions, so a shape looks
 * the same on screen, in a PNG, in an SVG, and in a PDF.
 */

import type { Point, Rect, Size } from '../model/geometry';
import {
  CLOSE,
  annotationPath,
  arcTo,
  blockArrowPath,
  calloutPath,
  cloudPath,
  curveTo,
  cylinderCapPath,
  cylinderPath,
  documentPath,
  ellipsePath,
  horizontalCylinderPath,
  lineTo,
  moveTo,
  polygon,
  polyline,
  rectPath,
  roundedRectPath,
  stadiumPath,
  starPath,
} from './paths';

export type ShapeCategory = 'flowchart' | 'general' | 'container' | 'annotation';

export interface ShapeDecoration {
  d: string;
  /** Draw with the fill colour instead of leaving the sub-path open. */
  filled?: boolean;
  /** Draw with the stroke colour at a lighter weight (used for guides). */
  hairline?: boolean;
}

export interface ShapeGeometry {
  /** The outline. Filled and stroked, and used for hit testing. */
  path: string;
  /** Extra strokes drawn on top of the outline. */
  decorations?: ShapeDecoration[];
  /** True when the outline is a line rather than a closed region. */
  open?: boolean;
}

export interface ShapeDefinition {
  key: string;
  name: string;
  category: ShapeCategory;
  keywords: string[];
  defaultSize: Size;
  /** Build geometry for a frame of `w` x `h` at the origin. */
  geometry(w: number, h: number, cornerRadius: number): ShapeGeometry;
  /** Connection points, as ratios of the frame (0..1). */
  connectionPoints?: readonly Point[];
  /** Region available for text, as ratios of the frame. */
  textBox?(w: number, h: number): Rect;
  /** Corner radius is meaningful for this shape. */
  roundable?: boolean;
  /** Shapes that hold other shapes; they render behind everything else. */
  container?: boolean;
  /** Default style overrides applied when the shape is created. */
  defaultStyle?: Record<string, unknown>;
  /** Default text applied when the shape is created. */
  defaultText?: string;
}

/** Edge midpoints plus corners: the connection points most shapes use. */
const EDGE_AND_CORNER_POINTS: readonly Point[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

const EDGE_POINTS: readonly Point[] = [
  { x: 0.5, y: 0 },
  { x: 1, y: 0.5 },
  { x: 0.5, y: 1 },
  { x: 0, y: 0.5 },
];

function inset(w: number, h: number, dx: number, dy: number): Rect {
  return { x: w * dx, y: h * dy, width: w * (1 - dx * 2), height: h * (1 - dy * 2) };
}

const definitions: ShapeDefinition[] = [
  // -------------------------------------------------------------------------
  // Flowchart shapes
  // -------------------------------------------------------------------------
  {
    key: 'process',
    name: 'Process',
    category: 'flowchart',
    keywords: ['process', 'action', 'step', 'rectangle', 'task'],
    defaultSize: { width: 140, height: 64 },
    roundable: true,
    geometry: (w, h, r) => ({ path: roundedRectPath(w, h, r) }),
    connectionPoints: EDGE_AND_CORNER_POINTS,
    defaultText: 'Process',
  },
  {
    key: 'decision',
    name: 'Decision',
    category: 'flowchart',
    keywords: ['decision', 'diamond', 'branch', 'if', 'choice'],
    defaultSize: { width: 140, height: 90 },
    geometry: (w, h) => ({
      path: polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]),
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.22, 0.26),
    defaultText: 'Decision?',
  },
  {
    key: 'terminator',
    name: 'Start / End',
    category: 'flowchart',
    keywords: ['terminator', 'start', 'end', 'stadium', 'pill', 'begin'],
    defaultSize: { width: 130, height: 52 },
    geometry: (w, h) => ({ path: stadiumPath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.12, 0.08),
    defaultText: 'Start',
  },
  {
    key: 'data',
    name: 'Input / Output',
    category: 'flowchart',
    keywords: ['data', 'input', 'output', 'parallelogram', 'io'],
    defaultSize: { width: 150, height: 64 },
    geometry: (w, h) => {
      const skew = Math.min(w * 0.18, 30);
      return {
        path: polygon([
          { x: skew, y: 0 },
          { x: w, y: 0 },
          { x: w - skew, y: h },
          { x: 0, y: h },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.14, 0.06),
    defaultText: 'Input',
  },
  {
    key: 'document',
    name: 'Document',
    category: 'flowchart',
    keywords: ['document', 'report', 'paper', 'wave'],
    defaultSize: { width: 140, height: 80 },
    geometry: (w, h) => ({ path: documentPath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.08, y: h * 0.06, width: w * 0.84, height: h * 0.72 }),
    defaultText: 'Document',
  },
  {
    key: 'multi-document',
    name: 'Multiple Documents',
    category: 'flowchart',
    keywords: ['documents', 'multiple', 'stack', 'reports'],
    defaultSize: { width: 150, height: 90 },
    geometry: (w, h) => {
      const step = Math.min(h * 0.12, 10);
      const front = documentPath(w - step * 2, h - step * 2);
      const shift = (dx: number, dy: number, d: string) =>
        `M ${dx} ${dy} ${d.slice(1)}`;
      return {
        path: `M ${step * 2} ${step * 2} ` + front.slice(1),
        decorations: [
          { d: shift(step, step, documentPath(w - step * 2, h - step * 2)) },
          { d: shift(0, 0, documentPath(w - step * 2, h - step * 2)) },
        ],
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.16, y: h * 0.22, width: w * 0.76, height: h * 0.56 }),
    defaultText: 'Documents',
  },
  {
    key: 'manual-input',
    name: 'Manual Input',
    category: 'flowchart',
    keywords: ['manual', 'input', 'keyboard', 'entry'],
    defaultSize: { width: 140, height: 70 },
    geometry: (w, h) => {
      const slope = Math.min(h * 0.28, 22);
      return {
        path: polygon([
          { x: 0, y: slope },
          { x: w, y: 0 },
          { x: w, y: h },
          { x: 0, y: h },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.08, y: h * 0.3, width: w * 0.84, height: h * 0.62 }),
    defaultText: 'Manual input',
  },
  {
    key: 'manual-operation',
    name: 'Manual Operation',
    category: 'flowchart',
    keywords: ['manual', 'operation', 'trapezoid'],
    defaultSize: { width: 150, height: 70 },
    geometry: (w, h) => {
      const skew = Math.min(w * 0.16, 26);
      return {
        path: polygon([
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w - skew, y: h },
          { x: skew, y: h },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.16, 0.08),
    defaultText: 'Manual operation',
  },
  {
    key: 'preparation',
    name: 'Preparation',
    category: 'flowchart',
    keywords: ['preparation', 'hexagon', 'setup', 'initialise'],
    defaultSize: { width: 150, height: 70 },
    geometry: (w, h) => {
      const notch = Math.min(w * 0.16, 26);
      return {
        path: polygon([
          { x: notch, y: 0 },
          { x: w - notch, y: 0 },
          { x: w, y: h / 2 },
          { x: w - notch, y: h },
          { x: notch, y: h },
          { x: 0, y: h / 2 },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.16, 0.08),
    defaultText: 'Preparation',
  },
  {
    key: 'predefined-process',
    name: 'Predefined Process',
    category: 'flowchart',
    keywords: ['predefined', 'subroutine', 'function', 'call'],
    defaultSize: { width: 150, height: 66 },
    geometry: (w, h) => {
      const bar = Math.min(w * 0.1, 14);
      return {
        path: rectPath(w, h),
        decorations: [
          { d: `${moveTo(bar, 0)} ${lineTo(bar, h)}` },
          { d: `${moveTo(w - bar, 0)} ${lineTo(w - bar, h)}` },
        ],
      };
    },
    connectionPoints: EDGE_AND_CORNER_POINTS,
    textBox: (w, h) => ({ x: w * 0.14, y: h * 0.06, width: w * 0.72, height: h * 0.88 }),
    defaultText: 'Subroutine',
  },
  {
    key: 'database',
    name: 'Database',
    category: 'flowchart',
    keywords: ['database', 'cylinder', 'store', 'disk', 'data store'],
    defaultSize: { width: 120, height: 90 },
    geometry: (w, h) => ({
      path: cylinderPath(w, h),
      decorations: [{ d: cylinderCapPath(w, h) }],
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.1, y: h * 0.28, width: w * 0.8, height: h * 0.5 }),
    defaultText: 'Database',
  },
  {
    key: 'internal-storage',
    name: 'Internal Storage',
    category: 'flowchart',
    keywords: ['internal', 'storage', 'memory'],
    defaultSize: { width: 130, height: 80 },
    geometry: (w, h) => {
      const bar = Math.min(w * 0.14, h * 0.22, 18);
      return {
        path: rectPath(w, h),
        decorations: [
          { d: `${moveTo(0, bar)} ${lineTo(w, bar)}` },
          { d: `${moveTo(bar, 0)} ${lineTo(bar, h)}` },
        ],
      };
    },
    connectionPoints: EDGE_AND_CORNER_POINTS,
    textBox: (w, h) => ({ x: w * 0.18, y: h * 0.28, width: w * 0.74, height: h * 0.64 }),
    defaultText: 'Internal storage',
  },
  {
    key: 'direct-access-storage',
    name: 'Direct Access Storage',
    category: 'flowchart',
    keywords: ['direct', 'access', 'storage', 'drum', 'disk'],
    defaultSize: { width: 140, height: 76 },
    geometry: (w, h) => {
      const rx = Math.min(w * 0.18, h * 0.28, 22);
      return {
        path: horizontalCylinderPath(w, h),
        decorations: [
          {
            d: `${moveTo(w - rx, 0)} ${arcTo(rx, h / 2, 0, 0, w - rx, h)}`,
          },
        ],
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.16, y: h * 0.14, width: w * 0.56, height: h * 0.72 }),
    defaultText: 'Direct access',
  },
  {
    key: 'sequential-access-storage',
    name: 'Sequential Access Storage',
    category: 'flowchart',
    keywords: ['sequential', 'tape', 'storage', 'magnetic'],
    defaultSize: { width: 110, height: 110 },
    geometry: (w, h) => {
      const r = Math.min(w, h) / 2;
      const cx = w / 2;
      const cy = h / 2;
      const tailY = cy + r * 0.72;
      const tailX = cx + r * 0.7;
      return {
        path: [
          moveTo(cx, cy - r),
          arcTo(r, r, 1, 1, tailX, tailY),
          lineTo(w, tailY),
          lineTo(w, h),
          lineTo(tailX, h),
          CLOSE,
        ].join(' '),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.2, 0.24),
    defaultText: 'Tape',
  },
  {
    key: 'display',
    name: 'Display',
    category: 'flowchart',
    keywords: ['display', 'screen', 'monitor', 'show'],
    defaultSize: { width: 150, height: 70 },
    geometry: (w, h) => {
      const curve = Math.min(w * 0.18, 28);
      return {
        path: [
          moveTo(curve, 0),
          lineTo(w - curve, 0),
          curveTo(w, h * 0.15, w, h * 0.85, w - curve, h),
          lineTo(curve, h),
          curveTo(0, h * 0.85, 0, h * 0.15, curve, 0),
          CLOSE,
        ].join(' '),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.16, 0.1),
    defaultText: 'Display',
  },
  {
    key: 'delay',
    name: 'Delay',
    category: 'flowchart',
    keywords: ['delay', 'wait', 'pause'],
    defaultSize: { width: 130, height: 64 },
    geometry: (w, h) => {
      const r = Math.min(h / 2, w * 0.4);
      return {
        path: [
          moveTo(0, 0),
          lineTo(w - r, 0),
          arcTo(r, h / 2, 0, 1, w - r, h),
          lineTo(0, h),
          CLOSE,
        ].join(' '),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.06, y: h * 0.1, width: w * 0.68, height: h * 0.8 }),
    defaultText: 'Delay',
  },
  {
    key: 'connector',
    name: 'Connector',
    category: 'flowchart',
    keywords: ['connector', 'circle', 'junction', 'on-page'],
    defaultSize: { width: 52, height: 52 },
    geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.16, 0.2),
    defaultText: 'A',
  },
  {
    key: 'off-page-connector',
    name: 'Off-page Connector',
    category: 'flowchart',
    keywords: ['off-page', 'connector', 'pentagon', 'reference'],
    defaultSize: { width: 80, height: 80 },
    geometry: (w, h) => {
      const shoulder = h * 0.68;
      return {
        path: polygon([
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: w, y: shoulder },
          { x: w / 2, y: h },
          { x: 0, y: shoulder },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.1, y: h * 0.08, width: w * 0.8, height: h * 0.56 }),
    defaultText: '1',
  },
  {
    key: 'merge',
    name: 'Merge',
    category: 'flowchart',
    keywords: ['merge', 'triangle', 'combine'],
    defaultSize: { width: 90, height: 60 },
    geometry: (w, h) => ({
      path: polygon([
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: w / 2, y: h },
      ]),
    }),
    connectionPoints: [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
    textBox: (w, h) => ({ x: w * 0.2, y: 0, width: w * 0.6, height: h * 0.5 }),
  },
  {
    key: 'extract',
    name: 'Extract',
    category: 'flowchart',
    keywords: ['extract', 'triangle', 'split'],
    defaultSize: { width: 90, height: 60 },
    geometry: (w, h) => ({
      path: polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]),
    }),
    connectionPoints: [
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 0.25, y: 0.5 },
      { x: 0.75, y: 0.5 },
    ],
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.5, width: w * 0.6, height: h * 0.5 }),
  },
  {
    key: 'sort',
    name: 'Sort',
    category: 'flowchart',
    keywords: ['sort', 'order', 'diamond'],
    defaultSize: { width: 110, height: 80 },
    geometry: (w, h) => ({
      path: polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]),
      decorations: [{ d: `${moveTo(0, h / 2)} ${lineTo(w, h / 2)}` }],
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.24, y: h * 0.08, width: w * 0.52, height: h * 0.34 }),
  },
  {
    key: 'collate',
    name: 'Collate',
    category: 'flowchart',
    keywords: ['collate', 'hourglass', 'gather'],
    defaultSize: { width: 90, height: 80 },
    geometry: (w, h) => ({
      path: polygon([
        { x: 0, y: 0 },
        { x: w, y: 0 },
        { x: 0, y: h },
        { x: w, y: h },
      ]),
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.36, width: w * 0.6, height: h * 0.28 }),
  },
  {
    key: 'stored-data',
    name: 'Stored Data',
    category: 'flowchart',
    keywords: ['stored', 'data', 'storage'],
    defaultSize: { width: 140, height: 74 },
    geometry: (w, h) => {
      const curve = Math.min(w * 0.16, 24);
      return {
        path: [
          moveTo(curve, 0),
          lineTo(w, 0),
          curveTo(w - curve * 0.8, h * 0.25, w - curve * 0.8, h * 0.75, w, h),
          lineTo(curve, h),
          curveTo(0, h * 0.75, 0, h * 0.25, curve, 0),
          CLOSE,
        ].join(' '),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.16, 0.1),
    defaultText: 'Stored data',
  },
  {
    key: 'annotation',
    name: 'Annotation',
    category: 'annotation',
    keywords: ['annotation', 'note', 'comment', 'bracket'],
    defaultSize: { width: 150, height: 70 },
    geometry: (w, h) => ({ path: annotationPath(w, h), open: true }),
    connectionPoints: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    textBox: (w, h) => ({ x: w * 0.16, y: h * 0.08, width: w * 0.8, height: h * 0.84 }),
    defaultStyle: { fill: 'none' },
    defaultText: 'Note',
  },
  {
    key: 'callout',
    name: 'Callout',
    category: 'annotation',
    keywords: ['callout', 'speech', 'bubble', 'comment'],
    defaultSize: { width: 150, height: 86 },
    roundable: true,
    geometry: (w, h, r) => ({ path: calloutPath(w, h, r || 8) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.08, y: h * 0.08, width: w * 0.84, height: h * 0.62 }),
    defaultText: 'Callout',
  },
  {
    key: 'swimlane',
    name: 'Swimlane',
    category: 'container',
    keywords: ['swimlane', 'lane', 'cross-functional', 'container'],
    defaultSize: { width: 640, height: 160 },
    container: true,
    geometry: (w, h) => {
      const band = Math.min(w * 0.12, 120);
      return {
        path: rectPath(w, h),
        decorations: [{ d: `${moveTo(band, 0)} ${lineTo(band, h)}` }],
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: 0, y: 0, width: Math.min(w * 0.12, 120), height: h }),
    defaultStyle: { fill: '#f4f6fa', stroke: '#8a93a6', cornerRadius: 0 },
    defaultText: 'Lane',
  },
  {
    key: 'phase',
    name: 'Phase',
    category: 'container',
    keywords: ['phase', 'section', 'stage', 'container', 'column'],
    defaultSize: { width: 200, height: 460 },
    container: true,
    geometry: (w, h) => {
      const band = Math.min(h * 0.09, 44);
      return {
        path: rectPath(w, h),
        decorations: [{ d: `${moveTo(0, band)} ${lineTo(w, band)}` }],
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: 0, y: 0, width: w, height: Math.min(h * 0.09, 44) }),
    defaultStyle: { fill: '#f7f8fb', stroke: '#8a93a6', cornerRadius: 0 },
    defaultText: 'Phase',
  },

  // -------------------------------------------------------------------------
  // General shapes
  // -------------------------------------------------------------------------
  {
    key: 'rectangle',
    name: 'Rectangle',
    category: 'general',
    keywords: ['rectangle', 'box', 'square'],
    defaultSize: { width: 130, height: 80 },
    geometry: (w, h) => ({ path: rectPath(w, h) }),
    connectionPoints: EDGE_AND_CORNER_POINTS,
    defaultStyle: { cornerRadius: 0 },
  },
  {
    key: 'rounded-rectangle',
    name: 'Rounded Rectangle',
    category: 'general',
    keywords: ['rounded', 'rectangle', 'box'],
    defaultSize: { width: 130, height: 80 },
    roundable: true,
    geometry: (w, h, r) => ({ path: roundedRectPath(w, h, r || 12) }),
    connectionPoints: EDGE_AND_CORNER_POINTS,
    defaultStyle: { cornerRadius: 12 },
  },
  {
    key: 'ellipse',
    name: 'Ellipse',
    category: 'general',
    keywords: ['ellipse', 'oval'],
    defaultSize: { width: 130, height: 84 },
    geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.15, 0.18),
  },
  {
    key: 'circle',
    name: 'Circle',
    category: 'general',
    keywords: ['circle', 'round'],
    defaultSize: { width: 100, height: 100 },
    geometry: (w, h) => ({ path: ellipsePath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.15, 0.18),
  },
  {
    key: 'triangle',
    name: 'Triangle',
    category: 'general',
    keywords: ['triangle'],
    defaultSize: { width: 110, height: 90 },
    geometry: (w, h) => ({
      path: polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ]),
    }),
    connectionPoints: [
      { x: 0.5, y: 0 },
      { x: 0.75, y: 0.5 },
      { x: 0.5, y: 1 },
      { x: 0.25, y: 0.5 },
    ],
    textBox: (w, h) => ({ x: w * 0.2, y: h * 0.45, width: w * 0.6, height: h * 0.5 }),
  },
  {
    key: 'diamond',
    name: 'Diamond',
    category: 'general',
    keywords: ['diamond', 'rhombus'],
    defaultSize: { width: 120, height: 90 },
    geometry: (w, h) => ({
      path: polygon([
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ]),
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.22, 0.26),
  },
  {
    key: 'hexagon',
    name: 'Hexagon',
    category: 'general',
    keywords: ['hexagon', 'six'],
    defaultSize: { width: 130, height: 90 },
    geometry: (w, h) => {
      const notch = w * 0.22;
      return {
        path: polygon([
          { x: notch, y: 0 },
          { x: w - notch, y: 0 },
          { x: w, y: h / 2 },
          { x: w - notch, y: h },
          { x: notch, y: h },
          { x: 0, y: h / 2 },
        ]),
      };
    },
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.2, 0.1),
  },
  {
    key: 'cylinder',
    name: 'Cylinder',
    category: 'general',
    keywords: ['cylinder', 'tube', 'can'],
    defaultSize: { width: 110, height: 100 },
    geometry: (w, h) => ({
      path: cylinderPath(w, h),
      decorations: [{ d: cylinderCapPath(w, h) }],
    }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => ({ x: w * 0.1, y: h * 0.28, width: w * 0.8, height: h * 0.5 }),
  },
  {
    key: 'cloud',
    name: 'Cloud',
    category: 'general',
    keywords: ['cloud', 'internet', 'network'],
    defaultSize: { width: 150, height: 100 },
    geometry: (w, h) => ({ path: cloudPath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.18, 0.3),
  },
  {
    key: 'star',
    name: 'Star',
    category: 'general',
    keywords: ['star', 'favourite', 'highlight'],
    defaultSize: { width: 110, height: 110 },
    geometry: (w, h) => ({ path: starPath(w, h) }),
    connectionPoints: EDGE_POINTS,
    textBox: (w, h) => inset(w, h, 0.28, 0.34),
  },
  {
    key: 'line',
    name: 'Line',
    category: 'general',
    keywords: ['line', 'rule', 'divider'],
    defaultSize: { width: 140, height: 2 },
    geometry: (w, h) => ({
      path: polyline([
        { x: 0, y: h / 2 },
        { x: w, y: h / 2 },
      ]),
      open: true,
    }),
    connectionPoints: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
    ],
    defaultStyle: { fill: 'none' },
  },
  {
    key: 'arrow',
    name: 'Arrow',
    category: 'general',
    keywords: ['arrow', 'block arrow', 'direction'],
    defaultSize: { width: 140, height: 60 },
    geometry: (w, h) => ({ path: blockArrowPath(w, h) }),
    connectionPoints: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0.4, y: 0.28 },
      { x: 0.4, y: 0.72 },
    ],
    textBox: (w, h) => ({ x: w * 0.06, y: h * 0.3, width: w * 0.55, height: h * 0.4 }),
  },
  {
    key: 'text-box',
    name: 'Text Box',
    category: 'general',
    keywords: ['text', 'label', 'caption', 'note'],
    defaultSize: { width: 160, height: 44 },
    geometry: (w, h) => ({ path: rectPath(w, h) }),
    connectionPoints: EDGE_AND_CORNER_POINTS,
    defaultStyle: { fill: 'none', stroke: 'none', cornerRadius: 0 },
    defaultText: 'Text',
  },
  {
    key: 'image',
    name: 'Image',
    category: 'general',
    keywords: ['image', 'picture', 'photo', 'placeholder'],
    defaultSize: { width: 160, height: 120 },
    geometry: (w, h) => ({
      path: rectPath(w, h),
      decorations: [
        {
          d: polyline([
            { x: w * 0.12, y: h * 0.78 },
            { x: w * 0.38, y: h * 0.44 },
            { x: w * 0.58, y: h * 0.64 },
            { x: w * 0.74, y: h * 0.48 },
            { x: w * 0.9, y: h * 0.78 },
          ]),
          hairline: true,
        },
      ],
    }),
    connectionPoints: EDGE_AND_CORNER_POINTS,
    defaultStyle: { fill: '#f0f2f6', stroke: '#8a93a6', cornerRadius: 0 },
  },
  {
    key: 'icon',
    name: 'Icon',
    category: 'general',
    keywords: ['icon', 'symbol', 'placeholder', 'glyph'],
    defaultSize: { width: 72, height: 72 },
    geometry: (w, h) => ({
      path: roundedRectPath(w, h, Math.min(w, h) * 0.2),
      decorations: [
        {
          d: `${moveTo(w * 0.3, h * 0.5)} ${lineTo(w * 0.7, h * 0.5)} ${moveTo(w * 0.5, h * 0.3)} ${lineTo(w * 0.5, h * 0.7)}`,
          hairline: true,
        },
      ],
    }),
    connectionPoints: EDGE_POINTS,
    defaultStyle: { fill: '#f0f2f6', stroke: '#8a93a6' },
  },
];

const byKey = new Map<string, ShapeDefinition>();
for (const definition of definitions) byKey.set(definition.key, definition);

export const SHAPE_DEFINITIONS: readonly ShapeDefinition[] = definitions;

/** Returns the definition for `key`, falling back to `process` for unknown keys. */
export function getShapeDefinition(key: string): ShapeDefinition {
  return byKey.get(key) ?? byKey.get('process')!;
}

export function hasShapeDefinition(key: string): boolean {
  return byKey.has(key);
}

export function shapesInCategory(category: ShapeCategory): ShapeDefinition[] {
  return definitions.filter((d) => d.category === category);
}

/** Case-insensitive search across shape names and keywords. */
export function searchShapes(query: string): ShapeDefinition[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...definitions];
  const terms = q.split(/\s+/);
  return definitions.filter((definition) => {
    const haystack = `${definition.name} ${definition.keywords.join(' ')} ${definition.key}`
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

/** Absolute connection points for a frame, in canvas coordinates. */
export function connectionPointsFor(definition: ShapeDefinition, frame: Rect): Point[] {
  const ratios = definition.connectionPoints ?? EDGE_AND_CORNER_POINTS;
  return ratios.map((r) => ({
    x: frame.x + frame.width * r.x,
    y: frame.y + frame.height * r.y,
  }));
}

/** The text region for a frame, in canvas coordinates. */
export function textBoxFor(definition: ShapeDefinition, frame: Rect): Rect {
  const local = definition.textBox
    ? definition.textBox(frame.width, frame.height)
    : { x: 0, y: 0, width: frame.width, height: frame.height };
  return {
    x: frame.x + local.x,
    y: frame.y + local.y,
    width: local.width,
    height: local.height,
  };
}
