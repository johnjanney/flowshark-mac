/**
 * Line breaking and block placement for text inside shapes, on connectors, and
 * in standalone text boxes.
 *
 * The result is a list of positioned baselines. The SVG renderer, the SVG
 * exporter, and the PDF exporter all consume the same layout, so what the user
 * sees on the canvas is what lands in the export.
 */

import type { Rect } from '../model/geometry';
import type { TextStyle } from '../model/types';
import { measureText } from './measure';

export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  lines: TextLine[];
  /** Distance between baselines. */
  lineHeight: number;
  /** Total height of the block. */
  height: number;
  /** Width of the widest line. */
  width: number;
}

export interface PositionedLine extends TextLine {
  x: number;
  /** Baseline position. */
  y: number;
}

/** Break a single paragraph to fit `maxWidth`, breaking long words if needed. */
function wrapParagraph(
  paragraph: string,
  style: TextStyle,
  maxWidth: number,
): TextLine[] {
  if (paragraph.length === 0) return [{ text: '', width: 0 }];
  if (!style.wrap || maxWidth <= 0) {
    return [{ text: paragraph, width: measureText(paragraph, style) }];
  }

  const lines: TextLine[] = [];
  const words = paragraph.split(/(\s+)/).filter((part) => part.length > 0);
  let current = '';

  const pushCurrent = (): void => {
    const trimmed = current.replace(/\s+$/, '');
    lines.push({ text: trimmed, width: measureText(trimmed, style) });
    current = '';
  };

  for (const word of words) {
    const candidate = current + word;
    if (measureText(candidate.replace(/\s+$/, ''), style) <= maxWidth || current === '') {
      // A single word can still be wider than the box; break it by character.
      if (current === '' && measureText(word, style) > maxWidth && !/^\s+$/.test(word)) {
        let chunk = '';
        for (const character of word) {
          if (chunk && measureText(chunk + character, style) > maxWidth) {
            lines.push({ text: chunk, width: measureText(chunk, style) });
            chunk = character;
          } else {
            chunk += character;
          }
        }
        current = chunk;
        continue;
      }
      current = candidate;
    } else {
      pushCurrent();
      if (!/^\s+$/.test(word)) current = word;
    }
  }
  if (current !== '' || lines.length === 0) pushCurrent();
  return lines;
}

export function layoutText(
  value: string,
  style: TextStyle,
  maxWidth: number,
): TextLayout {
  const paragraphs = value.split('\n');
  const lines: TextLine[] = [];
  for (const paragraph of paragraphs) {
    lines.push(...wrapParagraph(paragraph, style, maxWidth));
  }
  const lineHeight = style.fontSize * style.lineHeight;
  const width = lines.reduce((max, line) => Math.max(max, line.width), 0);
  return { lines, lineHeight, height: lines.length * lineHeight, width };
}

/**
 * Place a laid-out block inside `box`, honouring horizontal and vertical
 * alignment. `y` values are baselines.
 */
export function positionLines(layout: TextLayout, box: Rect, style: TextStyle): PositionedLine[] {
  let top: number;
  if (style.verticalAlign === 'top') top = box.y;
  else if (style.verticalAlign === 'bottom') top = box.y + box.height - layout.height;
  else top = box.y + (box.height - layout.height) / 2;

  // Approximate cap height placement: baselines sit 78% down each line box.
  const baselineOffset = layout.lineHeight * 0.5 + style.fontSize * 0.34;

  return layout.lines.map((line, index) => {
    let x: number;
    if (style.align === 'left') x = box.x;
    else if (style.align === 'right') x = box.x + box.width - line.width;
    else x = box.x + (box.width - line.width) / 2;
    return { ...line, x, y: top + index * layout.lineHeight + baselineOffset };
  });
}

/** Height a shape needs to show `value` at `width`, including padding. */
export function measuredHeight(
  value: string,
  style: TextStyle,
  width: number,
  padding: number,
): number {
  const layout = layoutText(value, style, Math.max(width - padding * 2, 1));
  return layout.height + padding * 2;
}
