/**
 * Connector endpoint markers (arrowheads and terminators).
 *
 * Markers are emitted as explicit `<marker>` definitions with a baked-in
 * colour and, for start markers, baked-in mirrored geometry. Relying on
 * `context-stroke` or `orient="auto-start-reverse"` would render correctly in
 * WKWebView but not in every application that opens an exported SVG, and
 * export fidelity matters more here than a few bytes.
 */

import type { MarkerKind } from '../model/types';

export interface MarkerSpec {
  kind: MarkerKind;
  color: string;
  /** True for `marker-start`, where the geometry points the other way. */
  reverse: boolean;
}

/** All marker kinds, in the order the inspector lists them. */
export const MARKER_KINDS: readonly MarkerKind[] = [
  'none',
  'arrow',
  'open-arrow',
  'filled-arrow',
  'diamond',
  'filled-diamond',
  'circle',
  'filled-circle',
  'square',
  'filled-square',
  'bar',
];

export const MARKER_LABELS: Record<MarkerKind, string> = {
  none: 'None',
  arrow: 'Standard arrow',
  'open-arrow': 'Open arrow',
  'filled-arrow': 'Filled arrow',
  diamond: 'Diamond',
  'filled-diamond': 'Filled diamond',
  circle: 'Circle',
  'filled-circle': 'Filled circle',
  square: 'Square',
  'filled-square': 'Filled square',
  bar: 'Bar',
};

/**
 * Marker geometry inside a 12x12 view box, drawn pointing right with the tip
 * at x = 12 and the line arriving along y = 6.
 */
export interface MarkerGeometry {
  d: string;
  filled: boolean;
  /** Where the path's own end should sit inside the view box. */
  refX: number;
  /** Size of the marker in stroke-width units. */
  size: number;
  /** How far the line must be pulled back so it does not poke through. */
  inset: number;
}

const GEOMETRY: Record<Exclude<MarkerKind, 'none'>, MarkerGeometry> = {
  arrow: {
    d: 'M 2 1 L 11 6 L 2 11',
    filled: false,
    refX: 11,
    size: 5,
    inset: 4,
  },
  'open-arrow': {
    d: 'M 1 1 L 11 6 L 1 11 Z',
    filled: false,
    refX: 11,
    size: 5,
    inset: 5,
  },
  'filled-arrow': {
    d: 'M 1 1 L 11 6 L 1 11 Z',
    filled: true,
    refX: 11,
    size: 5,
    inset: 5,
  },
  diamond: {
    d: 'M 1 6 L 6 1.5 L 11 6 L 6 10.5 Z',
    filled: false,
    refX: 11,
    size: 5,
    inset: 5,
  },
  'filled-diamond': {
    d: 'M 1 6 L 6 1.5 L 11 6 L 6 10.5 Z',
    filled: true,
    refX: 11,
    size: 5,
    inset: 5,
  },
  circle: {
    d: 'M 2 6 A 4 4 0 1 1 10 6 A 4 4 0 1 1 2 6 Z',
    filled: false,
    refX: 10,
    size: 4.5,
    inset: 4,
  },
  'filled-circle': {
    d: 'M 2 6 A 4 4 0 1 1 10 6 A 4 4 0 1 1 2 6 Z',
    filled: true,
    refX: 10,
    size: 4.5,
    inset: 4,
  },
  square: {
    d: 'M 2 2 L 10 2 L 10 10 L 2 10 Z',
    filled: false,
    refX: 10,
    size: 4.5,
    inset: 4,
  },
  'filled-square': {
    d: 'M 2 2 L 10 2 L 10 10 L 2 10 Z',
    filled: true,
    refX: 10,
    size: 4.5,
    inset: 4,
  },
  bar: {
    d: 'M 10 1 L 10 11',
    filled: false,
    refX: 10,
    size: 4.5,
    inset: 1,
  },
};

function sanitiseColor(color: string): string {
  return color.replace(/[^a-zA-Z0-9]/g, '');
}

export function markerId(spec: MarkerSpec): string {
  return `fs-marker-${spec.kind}-${sanitiseColor(spec.color)}${spec.reverse ? '-r' : ''}`;
}

/** Geometry for `kind`, for exporters that draw markers themselves. */
export function markerGeometry(kind: MarkerKind): MarkerGeometry | null {
  return kind === 'none' ? null : GEOMETRY[kind];
}

/** How far the drawn line should stop short of the endpoint, in points. */
export function markerInset(kind: MarkerKind, strokeWidth: number): number {
  if (kind === 'none') return 0;
  return GEOMETRY[kind].inset * Math.max(strokeWidth, 0.5);
}

/** Build the `<marker>` element markup for `spec`. */
export function markerMarkup(spec: MarkerSpec): string {
  if (spec.kind === 'none') return '';
  const geometry = GEOMETRY[spec.kind];
  const id = markerId(spec);
  const fill = geometry.filled ? spec.color : 'none';
  // Mirror about the view-box centre so start markers point backwards.
  const transform = spec.reverse ? ' transform="rotate(180 6 6)"' : '';
  const refX = spec.reverse ? 12 - geometry.refX : geometry.refX;
  return (
    `<marker id="${id}" viewBox="0 0 12 12" refX="${refX}" refY="6" ` +
    `markerWidth="${geometry.size}" markerHeight="${geometry.size}" ` +
    `markerUnits="strokeWidth" orient="auto">` +
    `<path d="${geometry.d}" fill="${fill}" stroke="${spec.color}" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${transform}/>` +
    `</marker>`
  );
}

/** Deduplicate the markers a set of connectors needs. */
export function collectMarkers(
  connectors: ReadonlyArray<{
    style: { startMarker: MarkerKind; endMarker: MarkerKind; stroke: string };
  }>,
): MarkerSpec[] {
  const seen = new Map<string, MarkerSpec>();
  for (const connector of connectors) {
    const { startMarker, endMarker, stroke } = connector.style;
    if (startMarker !== 'none') {
      const spec: MarkerSpec = { kind: startMarker, color: stroke, reverse: true };
      seen.set(markerId(spec), spec);
    }
    if (endMarker !== 'none') {
      const spec: MarkerSpec = { kind: endMarker, color: stroke, reverse: false };
      seen.set(markerId(spec), spec);
    }
  }
  return [...seen.values()];
}
