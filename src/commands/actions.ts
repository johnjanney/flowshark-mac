/**
 * Editing commands.
 *
 * Every user action — from the menu bar, the toolbar, the inspector, a
 * shortcut, or a canvas gesture — funnels through a function here, and every
 * function that changes the document does so inside `store.mutate`. That is
 * what makes undo cover the whole application rather than a subset of it.
 */

import type { Point, Rect } from '../model/geometry';
import { rectCenter, unionRects } from '../model/geometry';
import { createId } from '../model/ids';
import {
  DEFAULT_LABEL_OFFSET,
  createConnectorElement,
  createShapeElement,
  defaultLabelTextStyle,
  defaultShapeStyle,
  defaultTextStyle,
} from '../model/defaults';
import {
  addElement,
  boundsOf,
  connectorsAttachedTo,
  descendantsOf,
  elementBounds,
  expandSelection,
  createGroup,
  refreshConnectorPoints,
  removeElement,
  reorder,
  rootOf,
  translateElements,
  ungroup,
  visibleElements,
} from '../model/document';
import { deepClone } from '../model/serialization';
import type {
  ConnectorElement,
  ConnectorStyle,
  DiagramElement,
  ElementId,
  ShapeElement,
  ShapeStyle,
  TextStyle,
} from '../model/types';
import { isConnector, isGroup, isShape } from '../model/types';
import { getShapeDefinition } from '../shapes/library';
import { measuredHeight } from '../text/layout';
import type { Store } from '../state/store';

export interface CopiedStyle {
  shape?: Partial<ShapeStyle>;
  text?: Partial<TextStyle>;
  connector?: Partial<ConnectorStyle>;
}

/** The style clipboard used by Copy Style and Paste Style. */
let styleClipboard: CopiedStyle | null = null;

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

export interface AddShapeOptions {
  /** Top-left corner. When omitted the shape is centred on `center`. */
  at?: Point;
  center?: Point;
  size?: { width: number; height: number };
  text?: string;
  select?: boolean;
}

export function addShape(
  store: Store,
  shapeKey: string,
  options: AddShapeOptions = {},
): ShapeElement | null {
  const definition = getShapeDefinition(shapeKey);
  const size = options.size ?? definition.defaultSize;
  const at =
    options.at ??
    (options.center
      ? { x: options.center.x - size.width / 2, y: options.center.y - size.height / 2 }
      : { x: 0, y: 0 });

  const element = createShapeElement({
    shape: shapeKey,
    frame: { x: at.x, y: at.y, width: size.width, height: size.height },
    text: options.text ?? definition.defaultText ?? '',
    style: (definition.defaultStyle ?? {}) as Partial<ShapeStyle>,
    layerId: store.document.layers[0]?.id ?? 'layer_default',
  });

  const created = store.mutate(`Add ${definition.name}`, () => {
    addElement(store.document, element);
    // Containers belong behind everything else so shapes stay clickable.
    if (definition.container) reorder(store.document, [element.id], 'back');
  });
  if (!created) return null;
  store.noteShapeUse(shapeKey);
  if (options.select !== false) store.setSelection([element.id]);
  return element;
}

export function addConnector(
  store: Store,
  source: ConnectorElement['source'],
  target: ConnectorElement['target'],
  kind: ConnectorElement['connectorKind'],
): ConnectorElement | null {
  const connector = createConnectorElement({
    source,
    target,
    connectorKind: kind,
    layerId: store.document.layers[0]?.id ?? 'layer_default',
  });
  const created = store.mutate('Add Connector', () => {
    addElement(store.document, connector);
    refreshConnectorPoints(store.document);
  });
  if (!created) return null;
  store.setSelection([connector.id]);
  return connector;
}

// ---------------------------------------------------------------------------
// Deletion, duplication, movement
// ---------------------------------------------------------------------------

export function deleteSelection(store: Store): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  store.mutate('Delete', () => {
    for (const id of ids) removeElement(store.document, id);
  });
  store.clearSelection();
}

export function duplicateSelection(store: Store, offset: Point = { x: 16, y: 16 }): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const newIds: ElementId[] = [];
  store.mutate('Duplicate', () => {
    const copies = cloneElements(store, ids, offset);
    for (const copy of copies) {
      addElement(store.document, copy);
      newIds.push(copy.id);
    }
    refreshConnectorPoints(store.document);
  });
  if (newIds.length > 0) store.setSelection(newIds);
}

/**
 * Deep-copy a set of elements, remapping ids so groups stay grouped and
 * connectors between copied shapes stay attached to the copies.
 */
export function cloneElements(
  store: Store,
  ids: readonly ElementId[],
  offset: Point,
): DiagramElement[] {
  const doc = store.document;
  const roots = new Set(ids.map((id) => rootOf(doc, id)));
  const involved = new Set<ElementId>();
  for (const id of roots) {
    involved.add(id);
    for (const child of descendantsOf(doc, id)) involved.add(child);
  }
  // Bring along connectors whose two ends are both being copied.
  for (const element of Object.values(doc.elements)) {
    if (!isConnector(element)) continue;
    const source = element.source.elementId;
    const target = element.target.elementId;
    if (source && target && involved.has(source) && involved.has(target)) {
      involved.add(element.id);
    }
  }

  const idMap = new Map<ElementId, ElementId>();
  for (const id of involved) {
    const element = doc.elements[id];
    if (!element) continue;
    idMap.set(id, createId(element.kind === 'connector' ? 'c' : element.kind === 'group' ? 'g' : 's'));
  }

  const copies: DiagramElement[] = [];
  for (const [oldId, newId] of idMap) {
    const original = doc.elements[oldId];
    if (!original) continue;
    const copy = deepClone(original);
    copy.id = newId;
    copy.groupId = copy.groupId ? idMap.get(copy.groupId) ?? null : null;
    if (isShape(copy)) {
      copy.frame = { ...copy.frame, x: copy.frame.x + offset.x, y: copy.frame.y + offset.y };
    } else if (isConnector(copy)) {
      copy.waypoints = copy.waypoints.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y }));
      copy.source = remapEndpoint(copy.source, idMap, offset);
      copy.target = remapEndpoint(copy.target, idMap, offset);
      copy.labels = copy.labels.map((label) => ({ ...label, id: createId('l') }));
    } else if (isGroup(copy)) {
      copy.children = copy.children
        .map((child) => idMap.get(child))
        .filter((child): child is ElementId => !!child);
    }
    copies.push(copy);
  }
  return copies;
}

function remapEndpoint(
  endpoint: ConnectorElement['source'],
  idMap: Map<ElementId, ElementId>,
  offset: Point,
): ConnectorElement['source'] {
  const mapped = endpoint.elementId ? idMap.get(endpoint.elementId) : undefined;
  return {
    elementId: mapped ?? null,
    anchor: endpoint.anchor,
    point: { x: endpoint.point.x + offset.x, y: endpoint.point.y + offset.y },
  };
}

export function nudgeSelection(store: Store, dx: number, dy: number): void {
  const ids = [...store.selection];
  if (ids.length === 0) return;
  const scope = scopeFor(store, ids);
  store.mutate(
    'Move',
    () => translateElements(store.document, ids, dx, dy),
    { scope, coalesceKey: `nudge:${ids.join(',')}` },
  );
}

export function moveSelection(store: Store, dx: number, dy: number, label = 'Move'): void {
  const ids = [...store.selection];
  if (ids.length === 0 || (dx === 0 && dy === 0)) return;
  store.mutate(label, () => translateElements(store.document, ids, dx, dy), {
    scope: scopeFor(store, ids),
  });
}

/** Element ids a transaction over `ids` may touch, including their connectors. */
export function scopeFor(store: Store, ids: readonly ElementId[]): ElementId[] {
  const doc = store.document;
  const scope = new Set<ElementId>();
  for (const id of ids) {
    const root = rootOf(doc, id);
    scope.add(root);
    scope.add(id);
    for (const child of descendantsOf(doc, root)) scope.add(child);
  }
  for (const connector of connectorsAttachedTo(doc, [...scope])) scope.add(connector.id);
  // Dynamic connectors elsewhere can re-route when shapes move.
  for (const element of Object.values(doc.elements)) {
    if (isConnector(element) && element.avoidShapes) scope.add(element.id);
  }
  return [...scope];
}

// ---------------------------------------------------------------------------
// Geometry edits
// ---------------------------------------------------------------------------

export function setFrame(store: Store, id: ElementId, frame: Rect, label = 'Resize'): void {
  const element = store.document.elements[id];
  if (!isShape(element)) return;
  store.mutate(
    label,
    () => {
      const target = store.document.elements[id];
      if (!isShape(target)) return;
      target.frame = { ...frame };
      refreshConnectorPoints(store.document);
    },
    { scope: scopeFor(store, [id]) },
  );
}

export function setRotation(store: Store, ids: readonly ElementId[], degrees: number): void {
  if (ids.length === 0) return;
  store.mutate(
    'Rotate',
    () => {
      for (const id of expandSelection(store.document, ids)) {
        const element = store.document.elements[id];
        if (isShape(element) && !element.locked) element.rotation = degrees;
      }
      refreshConnectorPoints(store.document);
    },
    { scope: scopeFor(store, ids) },
  );
}

/** Grow a shape's height so its text fits. Used by the auto-size option. */
export function applyAutoSize(store: Store, id: ElementId): void {
  const element = store.document.elements[id];
  if (!isShape(element) || !element.autoSize) return;
  const definition = getShapeDefinition(element.shape);
  const local = definition.textBox
    ? definition.textBox(element.frame.width, element.frame.height)
    : { x: 0, y: 0, width: element.frame.width, height: element.frame.height };
  const needed = measuredHeight(
    element.text.value,
    element.text.style,
    local.width,
    element.text.padding,
  );
  const extra = element.frame.height - local.height;
  const height = Math.max(element.frame.height, Math.ceil(needed + extra));
  if (height === element.frame.height) return;
  // Share the text edit's coalesce key so typing produces one undo step, not
  // two.
  store.mutate(
    'Edit Text',
    () => {
      const target = store.document.elements[id];
      if (isShape(target)) target.frame = { ...target.frame, height };
      refreshConnectorPoints(store.document);
    },
    { scope: scopeFor(store, [id]), coalesceKey: `text:${id}` },
  );
}

// ---------------------------------------------------------------------------
// Alignment, distribution, size matching
// ---------------------------------------------------------------------------

export type AlignMode = 'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom';

const ALIGN_LABELS: Record<AlignMode, string> = {
  left: 'Align Left',
  'center-h': 'Align Centre',
  right: 'Align Right',
  top: 'Align Top',
  'center-v': 'Align Middle',
  bottom: 'Align Bottom',
};

function alignTargets(store: Store): Array<{ id: ElementId; bounds: Rect }> {
  const doc = store.document;
  const roots = [...new Set(store.selection.map((id) => rootOf(doc, id)))];
  const out: Array<{ id: ElementId; bounds: Rect }> = [];
  for (const id of roots) {
    const element = doc.elements[id];
    if (!element || element.locked) continue;
    const bounds = elementBounds(doc, element);
    if (bounds) out.push({ id, bounds });
  }
  return out;
}

export function alignSelection(store: Store, mode: AlignMode): void {
  const targets = alignTargets(store);
  if (targets.length < 2) return;
  const overall = unionRects(targets.map((t) => t.bounds));
  if (!overall) return;

  store.mutate(
    ALIGN_LABELS[mode],
    () => {
      for (const target of targets) {
        let dx = 0;
        let dy = 0;
        switch (mode) {
          case 'left':
            dx = overall.x - target.bounds.x;
            break;
          case 'right':
            dx = overall.x + overall.width - (target.bounds.x + target.bounds.width);
            break;
          case 'center-h':
            dx = rectCenter(overall).x - rectCenter(target.bounds).x;
            break;
          case 'top':
            dy = overall.y - target.bounds.y;
            break;
          case 'bottom':
            dy = overall.y + overall.height - (target.bounds.y + target.bounds.height);
            break;
          case 'center-v':
            dy = rectCenter(overall).y - rectCenter(target.bounds).y;
            break;
        }
        if (dx !== 0 || dy !== 0) translateElements(store.document, [target.id], dx, dy);
      }
    },
    { scope: scopeFor(store, store.selection) },
  );
}

export type DistributeMode =
  | 'horizontal-gaps'
  | 'vertical-gaps'
  | 'horizontal-centers'
  | 'vertical-centers';

const DISTRIBUTE_LABELS: Record<DistributeMode, string> = {
  'horizontal-gaps': 'Distribute Horizontally',
  'vertical-gaps': 'Distribute Vertically',
  'horizontal-centers': 'Distribute Centres Horizontally',
  'vertical-centers': 'Distribute Centres Vertically',
};

export function distributeSelection(store: Store, mode: DistributeMode): void {
  const targets = alignTargets(store);
  if (targets.length < 3) return;
  const horizontal = mode.startsWith('horizontal');
  const sorted = [...targets].sort((a, b) =>
    horizontal
      ? rectCenter(a.bounds).x - rectCenter(b.bounds).x
      : rectCenter(a.bounds).y - rectCenter(b.bounds).y,
  );

  store.mutate(
    DISTRIBUTE_LABELS[mode],
    () => {
      if (mode === 'horizontal-centers' || mode === 'vertical-centers') {
        const first = rectCenter(sorted[0].bounds);
        const last = rectCenter(sorted[sorted.length - 1].bounds);
        const step =
          (horizontal ? last.x - first.x : last.y - first.y) / (sorted.length - 1);
        sorted.forEach((target, index) => {
          if (index === 0 || index === sorted.length - 1) return;
          const centre = rectCenter(target.bounds);
          const wanted = (horizontal ? first.x : first.y) + step * index;
          const delta = wanted - (horizontal ? centre.x : centre.y);
          translateElements(
            store.document,
            [target.id],
            horizontal ? delta : 0,
            horizontal ? 0 : delta,
          );
        });
        return;
      }

      // Equal gaps: keep the outermost elements, spread the space between.
      const totalSpan = horizontal
        ? sorted[sorted.length - 1].bounds.x +
          sorted[sorted.length - 1].bounds.width -
          sorted[0].bounds.x
        : sorted[sorted.length - 1].bounds.y +
          sorted[sorted.length - 1].bounds.height -
          sorted[0].bounds.y;
      const used = sorted.reduce(
        (sum, target) => sum + (horizontal ? target.bounds.width : target.bounds.height),
        0,
      );
      const gap = (totalSpan - used) / (sorted.length - 1);
      let cursor = horizontal ? sorted[0].bounds.x : sorted[0].bounds.y;
      sorted.forEach((target, index) => {
        if (index > 0) {
          const current = horizontal ? target.bounds.x : target.bounds.y;
          const delta = cursor - current;
          if (delta !== 0) {
            translateElements(
              store.document,
              [target.id],
              horizontal ? delta : 0,
              horizontal ? 0 : delta,
            );
          }
        }
        cursor += (horizontal ? target.bounds.width : target.bounds.height) + gap;
      });
    },
    { scope: scopeFor(store, store.selection) },
  );
}

export type SizeMatchMode = 'width' | 'height' | 'both';

export function matchSize(store: Store, mode: SizeMatchMode): void {
  const doc = store.document;
  const ids = expandSelection(doc, store.selection).filter((id) => isShape(doc.elements[id]));
  if (ids.length < 2) return;
  const reference = doc.elements[ids[ids.length - 1]];
  if (!isShape(reference)) return;
  const { width, height } = reference.frame;

  store.mutate(
    mode === 'width' ? 'Make Same Width' : mode === 'height' ? 'Make Same Height' : 'Make Same Size',
    () => {
      for (const id of ids) {
        const element = doc.elements[id];
        if (!isShape(element) || element.locked) continue;
        element.frame = {
          ...element.frame,
          width: mode === 'height' ? element.frame.width : width,
          height: mode === 'width' ? element.frame.height : height,
        };
      }
      refreshConnectorPoints(doc);
    },
    { scope: scopeFor(store, ids) },
  );
}

// ---------------------------------------------------------------------------
// Grouping, ordering, locking
// ---------------------------------------------------------------------------

export function groupSelection(store: Store): void {
  const doc = store.document;
  const roots = [...new Set(store.selection.map((id) => rootOf(doc, id)))];
  if (roots.length < 2) return;
  const groupId = createId('g');
  const created = store.mutate('Group', () => {
    createGroup(doc, groupId, roots, doc.layers[0]?.id ?? 'layer_default');
    reorder(doc, roots, 'front');
  });
  if (created) store.setSelection([groupId]);
}

export function ungroupSelection(store: Store): void {
  const doc = store.document;
  const groups = store.selection
    .map((id) => rootOf(doc, id))
    .filter((id) => isGroup(doc.elements[id]));
  if (groups.length === 0) return;
  const released: ElementId[] = [];
  store.mutate('Ungroup', () => {
    for (const id of new Set(groups)) released.push(...ungroup(doc, id));
  });
  if (released.length > 0) store.setSelection(released);
}

export function orderSelection(
  store: Store,
  mode: 'front' | 'back' | 'forward' | 'backward',
): void {
  const ids = expandSelection(store.document, store.selection);
  if (ids.length === 0) return;
  const labels = {
    front: 'Bring to Front',
    back: 'Send to Back',
    forward: 'Bring Forward',
    backward: 'Send Backward',
  } as const;
  store.mutate(labels[mode], () => reorder(store.document, ids, mode));
}

export function setLocked(store: Store, locked: boolean): void {
  const ids = store.selection.map((id) => rootOf(store.document, id));
  if (ids.length === 0) return;
  store.mutate(
    locked ? 'Lock' : 'Unlock',
    () => {
      for (const id of new Set(ids)) {
        const element = store.document.elements[id];
        if (element) element.locked = locked;
        for (const child of descendantsOf(store.document, id)) {
          const target = store.document.elements[child];
          if (target) target.locked = locked;
        }
      }
    },
    { scope: scopeFor(store, ids) },
  );
}

export function setHidden(store: Store, hidden: boolean): void {
  const ids = expandSelection(store.document, store.selection);
  if (ids.length === 0) return;
  store.mutate(
    hidden ? 'Hide' : 'Show',
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (element) element.hidden = hidden;
      }
    },
    { scope: scopeFor(store, ids) },
  );
}

// ---------------------------------------------------------------------------
// Styles and text
// ---------------------------------------------------------------------------

function targetShapes(store: Store): ShapeElement[] {
  return expandSelection(store.document, store.selection)
    .map((id) => store.document.elements[id])
    .filter((element): element is ShapeElement => isShape(element) && !element.locked);
}

function targetConnectors(store: Store): ConnectorElement[] {
  return expandSelection(store.document, store.selection)
    .map((id) => store.document.elements[id])
    .filter((element): element is ConnectorElement => isConnector(element) && !element.locked);
}

export function updateShapeStyle(
  store: Store,
  patch: Partial<ShapeStyle>,
  label = 'Change Style',
): void {
  const shapes = targetShapes(store);
  if (shapes.length === 0) return;
  const ids = shapes.map((shape) => shape.id);
  store.mutate(
    label,
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isShape(element)) element.style = { ...element.style, ...patch };
      }
    },
    { scope: ids, coalesceKey: `shape-style:${Object.keys(patch).join(',')}:${ids.join(',')}` },
  );
}

export function updateConnectorStyle(
  store: Store,
  patch: Partial<ConnectorStyle>,
  label = 'Change Connector Style',
): void {
  const connectors = targetConnectors(store);
  if (connectors.length === 0) return;
  const ids = connectors.map((connector) => connector.id);
  store.mutate(
    label,
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isConnector(element)) element.style = { ...element.style, ...patch };
      }
    },
    { scope: ids, coalesceKey: `connector-style:${Object.keys(patch).join(',')}:${ids.join(',')}` },
  );
}

export function updateTextStyle(
  store: Store,
  patch: Partial<TextStyle>,
  label = 'Change Text Style',
): void {
  const shapes = targetShapes(store);
  const connectors = targetConnectors(store);
  if (shapes.length === 0 && connectors.length === 0) return;
  const ids = [...shapes.map((s) => s.id), ...connectors.map((c) => c.id)];
  store.mutate(
    label,
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isShape(element)) {
          element.text.style = { ...element.text.style, ...patch };
        } else if (isConnector(element)) {
          element.labels = element.labels.map((entry) => ({
            ...entry,
            style: { ...entry.style, ...patch },
          }));
        }
      }
    },
    { scope: ids, coalesceKey: `text-style:${Object.keys(patch).join(',')}:${ids.join(',')}` },
  );
}

export function setElementText(store: Store, id: ElementId, value: string): void {
  const element = store.document.elements[id];
  if (!element) return;
  store.mutate(
    'Edit Text',
    () => {
      const target = store.document.elements[id];
      if (isShape(target)) target.text = { ...target.text, value };
    },
    { scope: [id], coalesceKey: `text:${id}` },
  );
  applyAutoSize(store, id);
}

export function setConnectorLabelText(
  store: Store,
  connectorId: ElementId,
  labelId: string,
  value: string,
): void {
  store.mutate(
    'Edit Label',
    () => {
      const element = store.document.elements[connectorId];
      if (!isConnector(element)) return;
      element.labels = element.labels.map((label) =>
        label.id === labelId ? { ...label, text: value } : label,
      );
    },
    { scope: [connectorId], coalesceKey: `label:${connectorId}:${labelId}` },
  );
}

export function addConnectorLabel(store: Store, connectorId: ElementId): string | null {
  const labelId = createId('l');
  const added = store.mutate(
    'Add Label',
    () => {
      const element = store.document.elements[connectorId];
      if (!isConnector(element)) return;
      element.labels = [
        ...element.labels,
        {
          id: labelId,
          text: 'Label',
          style: defaultLabelTextStyle(),
          position: 0.5,
          offset: DEFAULT_LABEL_OFFSET,
          background: null,
          border: null,
        },
      ];
    },
    { scope: [connectorId] },
  );
  return added ? labelId : null;
}

export function removeConnectorLabel(
  store: Store,
  connectorId: ElementId,
  labelId: string,
): void {
  store.mutate(
    'Remove Label',
    () => {
      const element = store.document.elements[connectorId];
      if (!isConnector(element)) return;
      element.labels = element.labels.filter((label) => label.id !== labelId);
    },
    { scope: [connectorId] },
  );
}

export function updateConnectorLabel(
  store: Store,
  connectorId: ElementId,
  labelId: string,
  patch: Partial<ConnectorElement['labels'][number]>,
  label = 'Change Label',
): void {
  store.mutate(
    label,
    () => {
      const element = store.document.elements[connectorId];
      if (!isConnector(element)) return;
      element.labels = element.labels.map((entry) =>
        entry.id === labelId ? { ...entry, ...patch } : entry,
      );
    },
    { scope: [connectorId], coalesceKey: `label-style:${connectorId}:${labelId}` },
  );
}

export function setConnectorKind(
  store: Store,
  kind: ConnectorElement['connectorKind'],
): void {
  const connectors = targetConnectors(store);
  if (connectors.length === 0) return;
  const ids = connectors.map((c) => c.id);
  store.mutate(
    'Change Connector Type',
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isConnector(element)) element.connectorKind = kind;
      }
      refreshConnectorPoints(store.document);
    },
    { scope: ids },
  );
}

export function setConnectorRouting(
  store: Store,
  patch: { routing?: ConnectorElement['routing']; avoidShapes?: boolean },
): void {
  const connectors = targetConnectors(store);
  if (connectors.length === 0) return;
  const ids = connectors.map((c) => c.id);
  store.mutate(
    'Change Routing',
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (!isConnector(element)) continue;
        if (patch.routing) element.routing = patch.routing;
        if (patch.avoidShapes !== undefined) element.avoidShapes = patch.avoidShapes;
        if (patch.routing === 'dynamic') element.waypoints = [];
      }
      refreshConnectorPoints(store.document);
    },
    { scope: ids },
  );
}

export function copyStyle(store: Store): boolean {
  const doc = store.document;
  const id = store.selection[0];
  const element = id ? doc.elements[id] : undefined;
  if (isShape(element)) {
    styleClipboard = { shape: { ...element.style }, text: { ...element.text.style } };
    return true;
  }
  if (isConnector(element)) {
    styleClipboard = {
      connector: { ...element.style },
      text: element.labels[0] ? { ...element.labels[0].style } : undefined,
    };
    return true;
  }
  return false;
}

export function hasCopiedStyle(): boolean {
  return styleClipboard !== null;
}

export function pasteStyle(store: Store): void {
  if (!styleClipboard) return;
  const clip = styleClipboard;
  const ids = expandSelection(store.document, store.selection);
  if (ids.length === 0) return;
  store.mutate(
    'Paste Style',
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isShape(element) && !element.locked) {
          if (clip.shape) element.style = { ...element.style, ...clip.shape };
          if (clip.text) element.text.style = { ...element.text.style, ...clip.text };
        } else if (isConnector(element) && !element.locked) {
          if (clip.connector) element.style = { ...element.style, ...clip.connector };
          if (clip.text) {
            element.labels = element.labels.map((label) => ({
              ...label,
              style: { ...label.style, ...clip.text },
            }));
          }
        }
      }
    },
    { scope: ids },
  );
}

export function applyPreset(store: Store, presetId: string): void {
  const preset = store.document.presets.find((entry) => entry.id === presetId);
  if (!preset) return;
  const ids = expandSelection(store.document, store.selection);
  if (ids.length === 0) return;
  store.mutate(
    `Apply ${preset.name}`,
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isShape(element) && !element.locked) {
          element.style = { ...element.style, ...preset.shape };
          element.text.style = { ...element.text.style, ...preset.text };
        } else if (isConnector(element) && !element.locked) {
          element.style = { ...element.style, ...preset.connector };
        }
      }
    },
    { scope: ids },
  );
}

export function resetStyle(store: Store): void {
  const ids = expandSelection(store.document, store.selection);
  if (ids.length === 0) return;
  store.mutate(
    'Reset Style',
    () => {
      for (const id of ids) {
        const element = store.document.elements[id];
        if (isShape(element) && !element.locked) {
          const definition = getShapeDefinition(element.shape);
          element.style = {
            ...defaultShapeStyle(),
            ...((definition.defaultStyle ?? {}) as Partial<ShapeStyle>),
          };
          element.text.style = defaultTextStyle();
        }
      }
    },
    { scope: ids },
  );
}

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

export function selectAll(store: Store): void {
  const doc = store.document;
  const ids = visibleElements(doc)
    .filter((element) => !element.locked)
    .map((element) => rootOf(doc, element.id));
  store.setSelection([...new Set(ids)]);
}

/** Select everything reachable from the current selection through connectors. */
export function selectConnected(store: Store): void {
  const doc = store.document;
  const seen = new Set(expandSelection(doc, store.selection));
  let added = true;
  while (added) {
    added = false;
    for (const element of Object.values(doc.elements)) {
      if (!isConnector(element)) continue;
      const source = element.source.elementId;
      const target = element.target.elementId;
      const touches =
        seen.has(element.id) || (source && seen.has(source)) || (target && seen.has(target));
      if (!touches) continue;
      for (const id of [element.id, source, target]) {
        if (id && !seen.has(id)) {
          seen.add(id);
          added = true;
        }
      }
    }
  }
  store.setSelection([...new Set([...seen].map((id) => rootOf(doc, id)))]);
}

export function selectionBounds(store: Store): Rect | null {
  return boundsOf(
    store.document,
    store.selection.map((id) => rootOf(store.document, id)),
  );
}
