/**
 * Toolbar and inspector icons.
 *
 * These are drawn as stroked paths on a 20x20 grid so they stay crisp at any
 * scale factor and pick up `currentColor`, which keeps them correct in both
 * appearances and under Increase Contrast.
 */

import { svg } from '../util/dom';

const PATHS: Record<string, string[]> = {
  select: ['M5 3.5 L15.5 10 L11 11 L13 15.5 L11 16.5 L9 12 L5 15 Z'],
  shape: ['M3.5 5.5 h13 v9 h-13 Z'],
  connector: ['M4 15 C 4 8, 16 12, 16 5', 'M13 5 h3 v3'],
  text: ['M4 5.5 h12', 'M10 5.5 v9', 'M7.5 14.5 h5'],
  image: ['M3.5 4.5 h13 v11 h-13 Z', 'M3.5 12.5 l4-4 3 3 2.5-2.5 3.5 3.5'],
  undo: ['M7 5.5 L3.5 9 L7 12.5', 'M3.5 9 h7 a5 5 0 0 1 0 10 h-2'],
  redo: ['M13 5.5 L16.5 9 L13 12.5', 'M16.5 9 h-7 a5 5 0 0 0 0 10 h2'],
  'zoom-in': ['M9 3.5 a5.5 5.5 0 1 0 0 11 a5.5 5.5 0 0 0 0-11 Z', 'M13 13 l3.5 3.5', 'M6.5 9 h5', 'M9 6.5 v5'],
  'zoom-out': ['M9 3.5 a5.5 5.5 0 1 0 0 11 a5.5 5.5 0 0 0 0-11 Z', 'M13 13 l3.5 3.5', 'M6.5 9 h5'],
  fit: ['M3.5 7 v-3.5 h3.5', 'M13 3.5 h3.5 v3.5', 'M16.5 13 v3.5 h-3.5', 'M7 16.5 h-3.5 v-3.5'],
  fill: ['M4 10.5 L9.5 5 L15 10.5 L9.5 16 Z', 'M15.5 12.5 c1.5 2 1.5 3.5 0 3.5 s-1.5-1.5 0-3.5'],
  border: ['M3.5 3.5 h13 v13 h-13 Z'],
  'line-style': ['M3.5 6.5 h13', 'M3.5 10 h3 M9 10 h3 M14.5 10 h2', 'M3.5 13.5 h1 M7 13.5 h1 M10.5 13.5 h1 M14 13.5 h1'],
  'arrow-style': ['M3.5 10 h9', 'M11 6.5 L16.5 10 L11 13.5 Z'],
  'align-left': ['M3.5 3 v14', 'M5.5 6 h9 v3 h-9 Z', 'M5.5 12 h6 v3 h-6 Z'],
  'align-center-h': ['M10 3 v14', 'M5 6 h10 v3 h-10 Z', 'M6.5 12 h7 v3 h-7 Z'],
  'align-right': ['M16.5 3 v14', 'M5.5 6 h9 v3 h-9 Z', 'M8.5 12 h6 v3 h-6 Z'],
  'align-top': ['M3 3.5 h14', 'M6 5.5 v9 h3 v-9 Z', 'M12 5.5 v6 h3 v-6 Z'],
  'align-center-v': ['M3 10 h14', 'M6 5 v10 h3 v-10 Z', 'M12 6.5 v7 h3 v-7 Z'],
  'align-bottom': ['M3 16.5 h14', 'M6 5.5 v9 h3 v-9 Z', 'M12 8.5 v6 h3 v-6 Z'],
  'distribute-h': ['M3.5 3 v14', 'M16.5 3 v14', 'M8.5 6 h3 v8 h-3 Z'],
  'distribute-v': ['M3 3.5 h14', 'M3 16.5 h14', 'M6 8.5 v3 h8 v-3 Z'],
  group: ['M3.5 3.5 h5 v5 h-5 Z', 'M11.5 11.5 h5 v5 h-5 Z', 'M3.5 11.5 h5 v5 h-5 Z', 'M11.5 3.5 h5 v5 h-5 Z'],
  ungroup: ['M3.5 3.5 h5 v5 h-5 Z', 'M11.5 11.5 h5 v5 h-5 Z'],
  export: ['M10 3.5 v9', 'M6.5 7 L10 3.5 L13.5 7', 'M4 12.5 v4 h12 v-4'],
  print: ['M6 3.5 h8 v4 h-8 Z', 'M4 7.5 h12 v6 h-3 v3 h-6 v-3 h-3 Z'],
  'sidebar-left': ['M3.5 4 h13 v12 h-13 Z', 'M8 4 v12'],
  'sidebar-right': ['M3.5 4 h13 v12 h-13 Z', 'M12 4 v12'],
  grid: ['M3.5 3.5 h13 v13 h-13 Z', 'M8 3.5 v13', 'M12.5 3.5 v13', 'M3.5 8 h13', 'M3.5 12.5 h13'],
  lock: ['M6 9 h8 v7 h-8 Z', 'M7.5 9 V6.5 a2.5 2.5 0 0 1 5 0 V9'],
  unlock: ['M6 9 h8 v7 h-8 Z', 'M7.5 9 V6.5 a2.5 2.5 0 0 1 5 0'],
  front: ['M6 3.5 h8 v8 h-8 Z', 'M4 8.5 v8 h8 v-2'],
  back: ['M8 8.5 h8 v8 h-8 Z', 'M4 3.5 h8 v8'],
  trash: ['M4.5 5.5 h11', 'M7 5.5 V4 h6 v1.5', 'M6 5.5 l1 11 h6 l1-11'],
  search: ['M9 3.5 a5.5 5.5 0 1 0 0 11 a5.5 5.5 0 0 0 0-11 Z', 'M13 13 l3.5 3.5'],
  plus: ['M10 4.5 v11', 'M4.5 10 h11'],
  minus: ['M4.5 10 h11'],
  copy: ['M6.5 3.5 h10 v10 h-10 Z', 'M3.5 6.5 v10 h10'],
  'new-document': ['M5 3.5 h6 l4 4 v9 h-10 Z', 'M11 3.5 v4 h4'],
  open: ['M3.5 5.5 h5 l1.5 2 h6.5 v8 h-13 Z'],
  save: ['M4 4.5 h9 l3 3 v8 h-12 Z', 'M6.5 4.5 v4 h6 v-4', 'M6.5 15.5 v-4 h7 v4'],
  template: ['M3.5 3.5 h13 v13 h-13 Z', 'M3.5 7.5 h13', 'M8 7.5 v9'],
  info: ['M10 4 a6 6 0 1 0 0 12 a6 6 0 0 0 0-12 Z', 'M10 9 v4', 'M10 6.9 v0.2'],
};

export function icon(name: string, title?: string): SVGSVGElement {
  const paths = PATHS[name] ?? PATHS.info;
  return svg(
    'svg',
    { viewBox: '0 0 20 20', 'aria-hidden': title ? null : 'true', focusable: 'false' },
    [
      title ? svg('title', {}, [title]) : null,
      ...paths.map((d) => svg('path', { d })),
    ],
  );
}

export function hasIcon(name: string): boolean {
  return name in PATHS;
}
