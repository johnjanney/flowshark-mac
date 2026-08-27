/**
 * Text measurement.
 *
 * A single offscreen 2D canvas context does the measuring. It is the cheapest
 * accurate option in a WebView and it matches what the SVG renderer draws,
 * because both use the same font stack.
 *
 * Environments without a canvas (the unit test runner, for example) fall back
 * to a per-character width estimate. Layout stays deterministic there, which
 * is what the serialisation and geometry tests need.
 */

import { fontStack } from '../model/defaults';
import type { TextStyle } from '../model/types';

let context: CanvasRenderingContext2D | null | undefined;

function getContext(): CanvasRenderingContext2D | null {
  if (context !== undefined) return context;
  try {
    const canvas = document.createElement('canvas');
    context = canvas.getContext('2d');
  } catch {
    context = null;
  }
  return context;
}

export function cssFont(style: TextStyle): string {
  const italic = style.italic ? 'italic ' : '';
  return `${italic}${style.fontWeight} ${style.fontSize}px ${fontStack(style.fontFamily)}`;
}

/** Rough per-character width used when no canvas is available. */
function estimateWidth(text: string, style: TextStyle): number {
  let units = 0;
  for (const character of text) {
    if (character === ' ') units += 0.28;
    else if (/[iljtfIr.,;:'!|]/.test(character)) units += 0.32;
    else if (/[mwMW]/.test(character)) units += 0.86;
    else if (/[A-Z]/.test(character)) units += 0.66;
    else if (/[0-9]/.test(character)) units += 0.56;
    else units += 0.53;
  }
  const weightFactor = style.fontWeight >= 600 ? 1.04 : 1;
  return units * style.fontSize * weightFactor;
}

export function measureText(text: string, style: TextStyle): number {
  if (text.length === 0) return 0;
  const ctx = getContext();
  if (!ctx) return estimateWidth(text, style);
  ctx.font = cssFont(style);
  return ctx.measureText(text).width;
}

/** Clear the cached context. Used by tests that swap the DOM environment. */
export function resetMeasureCache(): void {
  context = undefined;
}
