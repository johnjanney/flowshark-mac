/**
 * Describing a diagram in words.
 *
 * One description serves three purposes: what VoiceOver reads from the
 * accessible outline, the label on each element in an exported SVG, and the
 * plain-text representation put on the pasteboard so pasting into a text
 * editor gives something readable rather than nothing.
 */

import type { DiagramElement, FlowsharkDocument } from '../model/types';
import { isConnector, isGroup, isShape } from '../model/types';
import { descendantsOf, visibleElements } from '../model/document';
import { getShapeDefinition } from '../shapes/library';

/** A short name for one element: its alt text, or its kind and its text. */
export function describeElement(
  doc: FlowsharkDocument,
  element: DiagramElement | undefined,
): string {
  if (!element) return 'a point on the canvas';
  if (isShape(element)) {
    if (element.altText) return element.altText;
    const definition = getShapeDefinition(element.shape);
    const text = element.text.value.trim().replace(/\s+/g, ' ');
    return text ? `${definition.name}, ${text}` : definition.name;
  }
  if (isConnector(element)) {
    if (element.altText) return element.altText;
    const labels = element.labels.map((label) => label.text.trim()).filter(Boolean);
    return labels.length > 0 ? `Connector labelled ${labels.join(', ')}` : 'Connector';
  }
  if (isGroup(element)) {
    return element.altText || `Group of ${descendantsOf(doc, element.id).length} elements`;
  }
  return 'Element';
}

/** Where each connector leaving `elementId` goes, and under what label. */
export function describeConnections(
  doc: FlowsharkDocument,
  elementId: string,
): string[] {
  return Object.values(doc.elements)
    .filter(isConnector)
    .filter((connector) => connector.source.elementId === elementId)
    .map((connector) => {
      const target = connector.target.elementId
        ? doc.elements[connector.target.elementId]
        : undefined;
      const label = connector.labels
        .map((entry) => entry.text.trim())
        .filter(Boolean)
        .join(', ');
      const destination = describeElement(doc, target);
      return label ? `${label} to ${destination}` : `to ${destination}`;
    });
}

/** One sentence per element: what it is, and what it connects to. */
export function describeShape(doc: FlowsharkDocument, elementId: string): string {
  const element = doc.elements[elementId];
  const name = describeElement(doc, element);
  const outgoing = describeConnections(doc, elementId);
  return outgoing.length > 0 ? `${name}. Connects ${outgoing.join('; ')}.` : `${name}.`;
}

/** The whole diagram as plain text, for the pasteboard. */
export function describeDiagram(doc: FlowsharkDocument): string {
  const title = doc.meta.title || 'Untitled';
  const lines = visibleElements(doc)
    .filter(isShape)
    .map((element) => `- ${describeShape(doc, element.id)}`);
  if (lines.length === 0) return `${title} (empty diagram)`;
  return [title, '', ...lines].join('\n');
}
