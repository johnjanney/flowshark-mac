/**
 * Queries and structural operations over a `FlowsharkDocument`.
 *
 * Functions named `get*`/`find*`/`collect*` are pure reads. Functions that
 * change the document mutate it in place and are only ever called from inside
 * a history transaction (see `src/commands/history.ts`), which is what makes
 * undo reliable.
 */

import type { Point, Rect } from './geometry';
import { rectIntersects, rotatedBounds, unionRects } from './geometry';
import type {
  ConnectorElement,
  DiagramElement,
  ElementId,
  FlowsharkDocument,
  GroupElement,
  Layer,
  ShapeElement,
} from './types';
import { isConnector, isGroup, isShape } from './types';
import { obstaclesFor, routeConnector } from '../connectors/routing';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export function getElement(
  doc: FlowsharkDocument,
  id: ElementId | null | undefined,
): DiagramElement | undefined {
  return id ? doc.elements[id] : undefined;
}

export function getLayer(doc: FlowsharkDocument, id: string): Layer | undefined {
  return doc.layers.find((layer) => layer.id === id);
}

/** Elements in paint order: layer order first, then z-order within the layer. */
export function elementsInPaintOrder(doc: FlowsharkDocument): DiagramElement[] {
  const layerRank = new Map<string, number>();
  doc.layers.forEach((layer, index) => layerRank.set(layer.id, index));
  const items: Array<{ element: DiagramElement; layer: number; z: number }> = [];
  doc.order.forEach((id, z) => {
    const element = doc.elements[id];
    if (!element || element.kind === 'group') return;
    items.push({ element, layer: layerRank.get(element.layerId) ?? 0, z });
  });
  items.sort((a, b) => (a.layer === b.layer ? a.z - b.z : a.layer - b.layer));
  return items.map((item) => item.element);
}

/** Visible, unlocked-or-not elements in paint order, filtered by layer visibility. */
export function visibleElements(doc: FlowsharkDocument): DiagramElement[] {
  return elementsInPaintOrder(doc).filter((element) => {
    if (element.hidden) return false;
    const layer = getLayer(doc, element.layerId);
    return layer ? layer.visible : true;
  });
}

export function zIndexOf(doc: FlowsharkDocument, id: ElementId): number {
  return doc.order.indexOf(id);
}

/** The outermost group containing `id`, or `id` itself when it is top level. */
export function rootOf(doc: FlowsharkDocument, id: ElementId): ElementId {
  let current = doc.elements[id];
  let result = id;
  const guard = new Set<ElementId>();
  while (current && current.groupId && !guard.has(current.groupId)) {
    guard.add(current.groupId);
    result = current.groupId;
    current = doc.elements[current.groupId];
  }
  return result;
}

/** Every element inside `group`, recursively, excluding the group itself. */
export function descendantsOf(doc: FlowsharkDocument, groupId: ElementId): ElementId[] {
  const group = doc.elements[groupId];
  if (!isGroup(group)) return [];
  const out: ElementId[] = [];
  const stack = [...group.children];
  const guard = new Set<ElementId>();
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (guard.has(id)) continue;
    guard.add(id);
    out.push(id);
    const child = doc.elements[id];
    if (isGroup(child)) stack.push(...child.children);
  }
  return out;
}

/** Expand a selection of ids into the concrete elements they cover. */
export function expandSelection(
  doc: FlowsharkDocument,
  ids: readonly ElementId[],
): ElementId[] {
  const out = new Set<ElementId>();
  for (const id of ids) {
    const element = doc.elements[id];
    if (!element) continue;
    if (isGroup(element)) {
      for (const child of descendantsOf(doc, id)) {
        if (!isGroup(doc.elements[child])) out.add(child);
      }
    } else {
      out.add(id);
    }
  }
  return [...out];
}

export function connectorsAttachedTo(
  doc: FlowsharkDocument,
  elementIds: readonly ElementId[],
): ConnectorElement[] {
  const set = new Set(elementIds);
  const out: ConnectorElement[] = [];
  for (const element of Object.values(doc.elements)) {
    if (!isConnector(element)) continue;
    if (
      (element.source.elementId && set.has(element.source.elementId)) ||
      (element.target.elementId && set.has(element.target.elementId))
    ) {
      out.push(element);
    }
  }
  return out;
}

/** Axis-aligned bounds of a single element, including rotation. */
export function elementBounds(
  doc: FlowsharkDocument,
  element: DiagramElement,
): Rect | null {
  if (isShape(element)) return rotatedBounds(element.frame, element.rotation);
  if (isConnector(element)) {
    const route = routeConnector(element, { elements: doc.elements });
    return unionRects(route.points.map((p) => ({ x: p.x, y: p.y, width: 0, height: 0 })));
  }
  if (isGroup(element)) {
    const rects: Rect[] = [];
    for (const id of descendantsOf(doc, element.id)) {
      const child = doc.elements[id];
      if (!child || isGroup(child)) continue;
      const bounds = elementBounds(doc, child);
      if (bounds) rects.push(bounds);
    }
    return unionRects(rects);
  }
  return null;
}

export function boundsOf(
  doc: FlowsharkDocument,
  ids: readonly ElementId[],
): Rect | null {
  const rects: Rect[] = [];
  for (const id of ids) {
    const element = doc.elements[id];
    if (!element) continue;
    const bounds = elementBounds(doc, element);
    if (bounds) rects.push(bounds);
  }
  return unionRects(rects);
}

/** Bounds of the whole diagram, or `null` when the document is empty. */
export function documentBounds(doc: FlowsharkDocument): Rect | null {
  return boundsOf(
    doc,
    visibleElements(doc).map((element) => element.id),
  );
}

/** Shapes whose bounds intersect `region`, in paint order. */
export function elementsIntersecting(
  doc: FlowsharkDocument,
  region: Rect,
): DiagramElement[] {
  return visibleElements(doc).filter((element) => {
    const bounds = elementBounds(doc, element);
    return bounds ? rectIntersects(bounds, region) : false;
  });
}

export function shapesOf(doc: FlowsharkDocument): ShapeElement[] {
  return doc.order
    .map((id) => doc.elements[id])
    .filter((element): element is ShapeElement => isShape(element));
}

export function connectorsOf(doc: FlowsharkDocument): ConnectorElement[] {
  return doc.order
    .map((id) => doc.elements[id])
    .filter((element): element is ConnectorElement => isConnector(element));
}

/** Route a connector against the current document, with obstacle avoidance. */
export function routeOf(doc: FlowsharkDocument, connector: ConnectorElement) {
  return routeConnector(connector, {
    elements: doc.elements,
    obstacles: connector.avoidShapes ? obstaclesFor(connector, doc.elements) : [],
  });
}

// ---------------------------------------------------------------------------
// Mutations (call only inside a history transaction)
// ---------------------------------------------------------------------------

export function addElement(doc: FlowsharkDocument, element: DiagramElement): void {
  doc.elements[element.id] = element;
  if (!doc.order.includes(element.id)) doc.order.push(element.id);
}

/**
 * Remove `id` and everything that depends on it: group children, group
 * membership, and connectors that no longer have both ends.
 */
export function removeElement(doc: FlowsharkDocument, id: ElementId): ElementId[] {
  const element = doc.elements[id];
  if (!element) return [];
  const removed: ElementId[] = [];

  const removeOne = (targetId: ElementId): void => {
    const target = doc.elements[targetId];
    if (!target) return;
    delete doc.elements[targetId];
    const index = doc.order.indexOf(targetId);
    if (index >= 0) doc.order.splice(index, 1);
    removed.push(targetId);
  };

  if (isGroup(element)) {
    for (const child of descendantsOf(doc, id)) removeOne(child);
  }

  // Detach the element from its parent group.
  if (element.groupId) {
    const parent = doc.elements[element.groupId];
    if (isGroup(parent)) {
      parent.children = parent.children.filter((child) => child !== id);
      if (parent.children.length < 2) {
        // A group with fewer than two members is not useful; dissolve it.
        for (const child of parent.children) {
          const childElement = doc.elements[child];
          if (childElement) childElement.groupId = parent.groupId;
        }
        removeOne(parent.id);
      }
    }
  }

  removeOne(id);

  // Connectors lose their attachment; a connector with no shape at either end
  // and no free geometry is removed too.
  const removedSet = new Set(removed);
  for (const candidate of Object.values(doc.elements)) {
    if (!isConnector(candidate)) continue;
    if (candidate.source.elementId && removedSet.has(candidate.source.elementId)) {
      candidate.source = { ...candidate.source, elementId: null };
    }
    if (candidate.target.elementId && removedSet.has(candidate.target.elementId)) {
      candidate.target = { ...candidate.target, elementId: null };
    }
  }
  return removed;
}

/** Move `ids` within the global z-order. */
export function reorder(
  doc: FlowsharkDocument,
  ids: readonly ElementId[],
  mode: 'front' | 'back' | 'forward' | 'backward',
): void {
  const moving = doc.order.filter((id) => ids.includes(id));
  if (moving.length === 0) return;
  const rest = doc.order.filter((id) => !ids.includes(id));

  if (mode === 'front') {
    doc.order = [...rest, ...moving];
    return;
  }
  if (mode === 'back') {
    doc.order = [...moving, ...rest];
    return;
  }

  const order = [...doc.order];
  if (mode === 'forward') {
    for (let i = order.length - 2; i >= 0; i--) {
      if (ids.includes(order[i]) && !ids.includes(order[i + 1])) {
        [order[i], order[i + 1]] = [order[i + 1], order[i]];
      }
    }
  } else {
    for (let i = 1; i < order.length; i++) {
      if (ids.includes(order[i]) && !ids.includes(order[i - 1])) {
        [order[i], order[i - 1]] = [order[i - 1], order[i]];
      }
    }
  }
  doc.order = order;
}

/** Translate every framed element and free connector endpoint by (dx, dy). */
export function translateElements(
  doc: FlowsharkDocument,
  ids: readonly ElementId[],
  dx: number,
  dy: number,
): void {
  const set = new Set(expandSelection(doc, ids));
  for (const id of set) {
    const element = doc.elements[id];
    if (!element || element.locked) continue;
    if (isShape(element)) {
      element.frame = { ...element.frame, x: element.frame.x + dx, y: element.frame.y + dy };
    } else if (isConnector(element)) {
      element.waypoints = element.waypoints.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      if (!element.source.elementId || set.has(element.source.elementId)) {
        element.source = {
          ...element.source,
          point: { x: element.source.point.x + dx, y: element.source.point.y + dy },
        };
      }
      if (!element.target.elementId || set.has(element.target.elementId)) {
        element.target = {
          ...element.target,
          point: { x: element.target.point.x + dx, y: element.target.point.y + dy },
        };
      }
    }
  }
  refreshConnectorPoints(doc);
}

/** Re-cache the endpoint positions of every attached connector. */
export function refreshConnectorPoints(doc: FlowsharkDocument): void {
  for (const element of Object.values(doc.elements)) {
    if (!isConnector(element)) continue;
    if (!element.source.elementId && !element.target.elementId) continue;
    const route = routeConnector(element, { elements: doc.elements });
    const first = route.points[0];
    const last = route.points[route.points.length - 1];
    if (element.source.elementId && first) element.source = { ...element.source, point: first };
    if (element.target.elementId && last) element.target = { ...element.target, point: last };
  }
}

export function createGroup(
  doc: FlowsharkDocument,
  groupId: ElementId,
  memberIds: readonly ElementId[],
  layerId: string,
): GroupElement | null {
  const members = memberIds.filter((id) => doc.elements[id] && !doc.elements[id].locked);
  if (members.length < 2) return null;
  const group: GroupElement = {
    id: groupId,
    kind: 'group',
    name: 'Group',
    layerId,
    locked: false,
    hidden: false,
    groupId: null,
    children: [...members],
    altText: '',
  };
  // The group inherits the parent of its members, if they shared one.
  const parents = new Set(members.map((id) => doc.elements[id].groupId));
  if (parents.size === 1) {
    const parentId = [...parents][0];
    group.groupId = parentId;
    const parent = doc.elements[parentId ?? ''];
    if (isGroup(parent)) {
      parent.children = parent.children.filter((child) => !members.includes(child));
      parent.children.push(groupId);
    }
  }
  for (const id of members) doc.elements[id].groupId = groupId;
  doc.elements[groupId] = group;
  return group;
}

export function ungroup(doc: FlowsharkDocument, groupId: ElementId): ElementId[] {
  const group = doc.elements[groupId];
  if (!isGroup(group)) return [];
  const children = [...group.children];
  for (const id of children) {
    const child = doc.elements[id];
    if (child) child.groupId = group.groupId;
  }
  if (group.groupId) {
    const parent = doc.elements[group.groupId];
    if (isGroup(parent)) {
      parent.children = parent.children.filter((child) => child !== groupId);
      parent.children.push(...children);
    }
  }
  delete doc.elements[groupId];
  return children;
}

/** Point-in-element test used by the marquee and by keyboard navigation. */
export function elementAtPoint(
  doc: FlowsharkDocument,
  p: Point,
): DiagramElement | undefined {
  const elements = visibleElements(doc);
  for (let i = elements.length - 1; i >= 0; i--) {
    const bounds = elementBounds(doc, elements[i]);
    if (
      bounds &&
      p.x >= bounds.x &&
      p.x <= bounds.x + bounds.width &&
      p.y >= bounds.y &&
      p.y <= bounds.y + bounds.height
    ) {
      return elements[i];
    }
  }
  return undefined;
}
