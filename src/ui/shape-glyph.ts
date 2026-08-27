/**
 * Small shape previews for the sidebar and the toolbar.
 *
 * The previews come from the same geometry functions the canvas uses, so a
 * shape in the library always looks like the shape you get when you place it.
 */

import { svg } from '../util/dom';
import { getShapeDefinition, type ShapeDefinition } from '../shapes/library';

export function shapeGlyph(definition: ShapeDefinition, width = 42, height = 30): SVGSVGElement {
  const inset = 3;
  const w = width - inset * 2;
  const h = height - inset * 2;
  const geometry = definition.geometry(w, h, Math.min(6, Math.min(w, h) / 4));
  const children = [
    svg('path', { d: geometry.path, class: geometry.open ? 'glyph-line' : 'glyph-fill' }),
    ...(geometry.decorations ?? []).map((decoration) =>
      svg('path', { d: decoration.d, class: 'glyph-line' }),
    ),
  ];
  return svg(
    'svg',
    { viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', focusable: 'false' },
    [svg('g', { transform: `translate(${inset} ${inset})` }, children)],
  );
}

export function shapeGlyphByKey(key: string, width?: number, height?: number): SVGSVGElement {
  return shapeGlyph(getShapeDefinition(key), width, height);
}
