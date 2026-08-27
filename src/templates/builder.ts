/**
 * A compact way to declare starter diagrams.
 *
 * Templates are written as nodes and edges rather than as raw documents, so a
 * template stays readable and cannot drift out of step with the document
 * schema — it is built through the same factories the editor uses.
 */

import { createEmptyDocument, createShapeElement, createConnectorElement } from '../model/defaults';
import { addElement, refreshConnectorPoints } from '../model/document';
import { getShapeDefinition } from '../shapes/library';
import type {
  ConnectorElement,
  FlowsharkDocument,
  ShapeStyle,
  TextStyle,
} from '../model/types';

/** Anchor indices shared by every shape: 0 top, 1 right, 2 bottom, 3 left. */
export const TOP = 0;
export const RIGHT = 1;
export const BOTTOM = 2;
export const LEFT = 3;

export interface NodeSpec {
  id: string;
  shape: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  style?: Partial<ShapeStyle>;
  textStyle?: Partial<TextStyle>;
}

export interface EdgeSpec {
  from: string;
  to: string;
  label?: string;
  kind?: ConnectorElement['connectorKind'];
  fromAnchor?: number;
  toAnchor?: number;
  style?: Partial<ConnectorElement['style']>;
}

export function buildTemplateDocument(
  title: string,
  nodes: readonly NodeSpec[],
  edges: readonly EdgeSpec[],
  description = '',
): FlowsharkDocument {
  const doc = createEmptyDocument(title);
  doc.meta.description = description;
  const ids = new Map<string, string>();

  for (const node of nodes) {
    const definition = getShapeDefinition(node.shape);
    const element = createShapeElement({
      shape: node.shape,
      frame: {
        x: node.x,
        y: node.y,
        width: node.width ?? definition.defaultSize.width,
        height: node.height ?? definition.defaultSize.height,
      },
      text: node.text ?? '',
      style: { ...((definition.defaultStyle ?? {}) as Partial<ShapeStyle>), ...node.style },
      textStyle: node.textStyle,
    });
    ids.set(node.id, element.id);
    addElement(doc, element);
    if (definition.container) {
      // Containers sit behind their contents.
      doc.order = [element.id, ...doc.order.filter((id) => id !== element.id)];
    }
  }

  for (const edge of edges) {
    const sourceId = ids.get(edge.from);
    const targetId = ids.get(edge.to);
    if (!sourceId || !targetId) continue;
    const connector = createConnectorElement({
      source: {
        elementId: sourceId,
        anchor:
          edge.fromAnchor === undefined
            ? { mode: 'floating' }
            : { mode: 'fixed', index: edge.fromAnchor },
        point: { x: 0, y: 0 },
      },
      target: {
        elementId: targetId,
        anchor:
          edge.toAnchor === undefined
            ? { mode: 'floating' }
            : { mode: 'fixed', index: edge.toAnchor },
        point: { x: 0, y: 0 },
      },
      connectorKind: edge.kind ?? 'elbow',
      label: edge.label,
      style: edge.style,
    });
    addElement(doc, connector);
  }

  refreshConnectorPoints(doc);
  return doc;
}
