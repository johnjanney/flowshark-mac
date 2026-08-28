/**
 * Pointer, gesture, and keyboard handling on the canvas.
 *
 * All canvas gestures run through one small state machine. A gesture previews
 * itself with renderer transforms and commits exactly once on release, so a
 * drag of any length is a single undo step.
 *
 * Trackpad conventions follow macOS: two-finger scroll pans, pinch zooms
 * (Safari reports it as a wheel event with `ctrlKey`), and Command with scroll
 * zooms as well.
 */

import type { Point, Rect } from '../model/geometry';
import { clamp, distance, rectCenter, rectFromPoints, rotatePoint } from '../model/geometry';
import type { ConnectorElement, ElementId, ShapeElement } from '../model/types';
import { isConnector, isShape } from '../model/types';
import {
  boundsOf,
  elementBounds,
  expandSelection,
  refreshConnectorPoints,
  rootOf,
  routeOf,
  visibleElements,
} from '../model/document';
import { anchorForDrop } from '../connectors/anchors';
import {
  nearestConnectionPoint,
  snapMove,
  snapPointToGrid,
  snapResizePoint,
} from './snap';
import { addConnector, addShape, cloneElements, scopeFor } from '../commands/actions';
import { addElement } from '../model/document';
import type { Store } from '../state/store';
import type { CanvasRenderer, HandleId } from './renderer';
import { emptyOverlayState } from './renderer';

export interface InteractionCallbacks {
  /** Begin inline text editing on an element. */
  beginTextEdit(elementId: ElementId, labelId?: string | null): void;
  /** Show the context menu for the element under the pointer. */
  showContextMenu(event: MouseEvent, elementId: ElementId | null): void;
  /** Redraw the overlay after transient state changes. */
  refreshOverlay(): void;
  /** Announce something to assistive technology and the status bar. */
  announce(message: string): void;
  /** Files dropped through the DOM. The macOS shell delivers paths instead. */
  filesDropped(files: FileList, at: Point): void;
}

type Gesture =
  | { type: 'none' }
  | { type: 'pending'; start: Point; canvasStart: Point; ids: ElementId[]; additive: boolean }
  | { type: 'marquee'; canvasStart: Point; additive: boolean }
  | {
      type: 'move';
      ids: ElementId[];
      canvasStart: Point;
      delta: Point;
      startBounds: Rect;
      duplicated: boolean;
    }
  | {
      type: 'resize';
      id: ElementId;
      handle: HandleId;
      startFrame: Rect;
      canvasStart: Point;
      frame: Rect;
    }
  | { type: 'rotate'; id: ElementId; centre: Point; startAngle: number; startRotation: number; rotation: number }
  | {
      type: 'connect';
      sourceId: ElementId | null;
      sourcePoint: Point;
      sourceAnchorIndex: number | null;
      current: Point;
    }
  | { type: 'endpoint'; connectorId: ElementId; which: 'source' | 'target'; current: Point }
  | { type: 'waypoint'; connectorId: ElementId; index: number; current: Point }
  | { type: 'pan'; startClient: Point; startOffset: Point };

const DRAG_THRESHOLD = 3;

export class CanvasInteraction {
  private gesture: Gesture = { type: 'none' };
  private spaceHeld = false;

  constructor(
    private readonly store: Store,
    private readonly renderer: CanvasRenderer,
    private readonly surface: HTMLElement,
    private readonly callbacks: InteractionCallbacks,
  ) {}

  attach(): void {
    this.surface.addEventListener('pointerdown', this.onPointerDown);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerUp);
    this.surface.addEventListener('dblclick', this.onDoubleClick);
    this.surface.addEventListener('contextmenu', this.onContextMenu);
    this.surface.addEventListener('wheel', this.onWheel, { passive: false });
    this.surface.addEventListener('dragover', this.onDragOver);
    this.surface.addEventListener('drop', this.onDrop);
    this.surface.addEventListener('dragleave', this.onDragLeave);
    window.addEventListener('keydown', this.onSpaceDown);
    window.addEventListener('keyup', this.onSpaceUp);
    window.addEventListener('blur', this.onWindowBlur);
  }

  detach(): void {
    this.surface.removeEventListener('pointerdown', this.onPointerDown);
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
    this.surface.removeEventListener('dblclick', this.onDoubleClick);
    this.surface.removeEventListener('contextmenu', this.onContextMenu);
    this.surface.removeEventListener('wheel', this.onWheel);
    this.surface.removeEventListener('dragover', this.onDragOver);
    this.surface.removeEventListener('drop', this.onDrop);
    this.surface.removeEventListener('dragleave', this.onDragLeave);
    window.removeEventListener('keydown', this.onSpaceDown);
    window.removeEventListener('keyup', this.onSpaceUp);
    window.removeEventListener('blur', this.onWindowBlur);
  }

  get isDragging(): boolean {
    return this.gesture.type !== 'none' && this.gesture.type !== 'pending';
  }

  // -------------------------------------------------------------------------
  // Hit testing
  // -------------------------------------------------------------------------

  /**
   * The element id under a pointer event, using the SVG's own hit testing.
   *
   * `event.target` is preferred, but while a pointer is captured the browser
   * retargets click and double-click events to the capture element, so the
   * position is re-tested against the document when that happens.
   */
  private hitTest(event: PointerEvent | MouseEvent): {
    id: ElementId | null;
    kind: string | null;
    labelId: string | null;
  } {
    let target = event.target as Element | null;
    if (!target?.closest?.('g[data-id]')) {
      target = document.elementFromPoint(event.clientX, event.clientY);
    }
    const group = target?.closest?.('g[data-id]') as SVGGElement | null;
    if (!group) return { id: null, kind: null, labelId: null };
    const labelHost = target?.closest?.('[data-label-id]') as SVGGElement | null;
    return {
      id: group.dataset.id ?? null,
      kind: group.dataset.kind ?? null,
      labelId: labelHost?.dataset.labelId ?? null,
    };
  }

  private handleUnder(event: PointerEvent): {
    handle: HandleId | null;
    endpoint: 'source' | 'target' | null;
    waypoint: number | null;
  } {
    const target = event.target as Element | null;
    const node = target?.closest?.('[data-handle],[data-endpoint],[data-waypoint]') as
      | SVGElement
      | null;
    if (!node) return { handle: null, endpoint: null, waypoint: null };
    const waypoint = node.dataset.waypoint;
    return {
      handle: (node.dataset.handle as HandleId | undefined) ?? null,
      endpoint: (node.dataset.endpoint as 'source' | 'target' | undefined) ?? null,
      waypoint: waypoint === undefined ? null : Number(waypoint),
    };
  }

  // -------------------------------------------------------------------------
  // Pointer handling
  // -------------------------------------------------------------------------

  private onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const surfaceHasFocus = this.surface.contains(document.activeElement);
    if (!surfaceHasFocus) this.surface.focus({ preventScroll: true });

    const screen = this.renderer.pointerPosition(event);
    const canvasPoint = this.renderer.screenToCanvas(screen);
    const state = this.store.getState();

    // Panning: the pan tool, the space bar, or the middle button.
    if (state.tool === 'pan' || this.spaceHeld) {
      this.gesture = {
        type: 'pan',
        startClient: { x: event.clientX, y: event.clientY },
        startOffset: { ...state.view.offset },
      };
      this.surface.setPointerCapture(event.pointerId);
      this.surface.dataset.panning = 'true';
      return;
    }

    // Overlay handles take priority over the elements beneath them.
    const handles = this.handleUnder(event);
    if (handles.handle && handles.handle !== 'rotate') {
      const id = this.singleSelectedShapeId();
      if (id) {
        const shape = this.store.document.elements[id] as ShapeElement;
        this.gesture = {
          type: 'resize',
          id,
          handle: handles.handle,
          startFrame: { ...shape.frame },
          canvasStart: canvasPoint,
          frame: { ...shape.frame },
        };
        this.surface.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (handles.handle === 'rotate') {
      const id = this.singleSelectedShapeId();
      if (id) {
        const shape = this.store.document.elements[id] as ShapeElement;
        const centre = rectCenter(shape.frame);
        this.gesture = {
          type: 'rotate',
          id,
          centre,
          startAngle: Math.atan2(canvasPoint.y - centre.y, canvasPoint.x - centre.x),
          startRotation: shape.rotation,
          rotation: shape.rotation,
        };
        this.surface.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (handles.endpoint) {
      const id = this.store.selection[0];
      if (id && isConnector(this.store.document.elements[id])) {
        this.gesture = {
          type: 'endpoint',
          connectorId: id,
          which: handles.endpoint,
          current: canvasPoint,
        };
        this.renderer.overlayState.connectionHints = this.connectableIds();
        this.surface.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (handles.waypoint !== null) {
      const id = this.store.selection[0];
      if (id && isConnector(this.store.document.elements[id])) {
        this.gesture = {
          type: 'waypoint',
          connectorId: id,
          index: handles.waypoint,
          current: canvasPoint,
        };
        this.surface.setPointerCapture(event.pointerId);
        return;
      }
    }

    const hit = this.hitTest(event);

    // Shape tool: click or drag out a new shape.
    if (state.tool === 'shape') {
      const placed = addShape(this.store, state.ui.pendingShape, {
        center: snapPointToGrid(canvasPoint, this.store.document.canvas),
      });
      if (placed) {
        this.callbacks.announce(`Added ${placed.name || state.ui.pendingShape}.`);
        this.store.setTool('select');
      }
      return;
    }

    if (state.tool === 'text') {
      // The mouse events the browser synthesises from this pointer down would
      // move focus to the canvas surface, blurring the field the text editor
      // is about to open and committing it before a key is pressed.
      event.preventDefault();
      const placed = addShape(this.store, 'text-box', {
        center: snapPointToGrid(canvasPoint, this.store.document.canvas),
        text: '',
      });
      if (placed) {
        this.store.setTool('select');
        this.callbacks.announce(`Added ${placed.name || 'Text Box'}.`);
        this.callbacks.beginTextEdit(placed.id);
      }
      return;
    }

    if (state.tool === 'connector') {
      const target = nearestConnectionPoint(this.store.document, canvasPoint, state.view.zoom);
      this.gesture = {
        type: 'connect',
        sourceId: target?.elementId ?? (hit.kind === 'shape' ? hit.id : null),
        sourcePoint: target?.point ?? canvasPoint,
        sourceAnchorIndex: target?.index ?? null,
        current: canvasPoint,
      };
      this.renderer.overlayState.connectionHints = this.connectableIds();
      this.surface.setPointerCapture(event.pointerId);
      return;
    }

    // Select tool.
    if (!hit.id) {
      if (!event.shiftKey) this.store.clearSelection();
      this.gesture = { type: 'marquee', canvasStart: canvasPoint, additive: event.shiftKey };
      this.surface.setPointerCapture(event.pointerId);
      return;
    }

    const rootId = rootOf(this.store.document, hit.id);
    const alreadySelected = this.store.selection.includes(rootId);
    if (event.shiftKey) {
      this.store.toggleSelection(rootId);
    } else if (!alreadySelected) {
      this.store.setSelection([rootId]);
    }

    const ids = [...this.store.selection];
    const startBounds = boundsOf(this.store.document, ids);
    if (startBounds && ids.every((id) => !this.store.document.elements[id]?.locked)) {
      // Capture is deferred until the pointer actually moves: capturing here
      // would retarget the click and double-click events to the surface.
      this.gesture = {
        type: 'pending',
        start: screen,
        canvasStart: canvasPoint,
        ids,
        additive: event.shiftKey,
      };
    }
  };

  private onPointerMove = (event: PointerEvent): void => {
    const screen = this.renderer.pointerPosition(event);
    const canvasPoint = this.renderer.screenToCanvas(screen);

    switch (this.gesture.type) {
      case 'none':
        return;

      case 'pending': {
        if (distance(screen, this.gesture.start) < DRAG_THRESHOLD) return;
        const startBounds = boundsOf(this.store.document, this.gesture.ids);
        if (!startBounds) {
          this.gesture = { type: 'none' };
          return;
        }
        let ids = this.gesture.ids;
        let duplicated = false;
        if (event.altKey) {
          // Option-drag leaves a copy behind and drags the new one.
          const copies = cloneElements(this.store, ids, { x: 0, y: 0 });
          this.store.mutate('Duplicate', () => {
            for (const copy of copies) addElement(this.store.document, copy);
            refreshConnectorPoints(this.store.document);
          });
          ids = copies.map((copy) => copy.id);
          this.store.setSelection(ids);
          duplicated = true;
        }
        this.gesture = {
          type: 'move',
          ids,
          canvasStart: this.gesture.canvasStart,
          delta: { x: 0, y: 0 },
          startBounds,
          duplicated,
        };
        this.surface.setPointerCapture(event.pointerId);
        return;
      }

      case 'move': {
        let dx = canvasPoint.x - this.gesture.canvasStart.x;
        let dy = canvasPoint.y - this.gesture.canvasStart.y;
        if (event.shiftKey) {
          // Constrain to the dominant axis.
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const proposed: Rect = {
          ...this.gesture.startBounds,
          x: this.gesture.startBounds.x + dx,
          y: this.gesture.startBounds.y + dy,
        };
        const snap = snapMove(
          this.store.document,
          this.gesture.ids,
          proposed,
          this.store.getState().view.zoom,
        );
        dx += snap.dx;
        dy += snap.dy;
        this.gesture.delta = { x: dx, y: dy };
        this.renderer.overlayState.guides = snap.guides;
        this.renderer.setDragOffset(this.gesture.ids, dx, dy);
        this.callbacks.refreshOverlay();
        this.callbacks.announce(`Moving by ${Math.round(dx)}, ${Math.round(dy)} points.`);
        return;
      }

      case 'resize': {
        const snapped = snapResizePoint(
          this.store.document,
          [this.gesture.id],
          canvasPoint,
          this.store.getState().view.zoom,
        );
        const frame = this.resizeFrame(
          this.gesture.startFrame,
          this.gesture.handle,
          snapped.point,
          event.shiftKey,
          event.altKey,
        );
        this.gesture.frame = frame;
        this.renderer.overlayState.guides = snapped.guides;
        this.renderer.setFramePreview(this.gesture.id, frame);
        this.callbacks.refreshOverlay();
        this.callbacks.announce(
          `${Math.round(frame.width)} by ${Math.round(frame.height)} points.`,
        );
        return;
      }

      case 'rotate': {
        const angle = Math.atan2(
          canvasPoint.y - this.gesture.centre.y,
          canvasPoint.x - this.gesture.centre.x,
        );
        let degrees =
          this.gesture.startRotation + ((angle - this.gesture.startAngle) * 180) / Math.PI;
        if (event.shiftKey) degrees = Math.round(degrees / 15) * 15;
        degrees = ((degrees % 360) + 360) % 360;
        this.gesture.rotation = degrees;
        const element = this.store.document.elements[this.gesture.id];
        if (isShape(element)) {
          const node = this.renderer.nodeFor(this.gesture.id);
          node?.setAttribute(
            'transform',
            `translate(${element.frame.x} ${element.frame.y}) rotate(${degrees.toFixed(2)} ${
              element.frame.width / 2
            } ${element.frame.height / 2})`,
          );
        }
        this.callbacks.announce(`Rotated ${Math.round(degrees)} degrees.`);
        return;
      }

      case 'connect':
      case 'endpoint': {
        const target = nearestConnectionPoint(
          this.store.document,
          canvasPoint,
          this.store.getState().view.zoom,
        );
        this.gesture.current = target?.point ?? canvasPoint;
        this.renderer.overlayState.activeConnection = target?.point ?? null;
        if (this.gesture.type === 'connect') {
          this.renderer.overlayState.pendingConnector = {
            from: this.gesture.sourcePoint,
            to: this.gesture.current,
          };
        } else {
          const connector = this.store.document.elements[this.gesture.connectorId];
          if (isConnector(connector)) {
            const route = routeOf(this.store.document, connector);
            const anchor =
              this.gesture.which === 'source'
                ? route.points[route.points.length - 1]
                : route.points[0];
            this.renderer.overlayState.pendingConnector = {
              from: anchor,
              to: this.gesture.current,
            };
          }
        }
        this.callbacks.refreshOverlay();
        return;
      }

      case 'waypoint': {
        this.gesture.current = snapPointToGrid(canvasPoint, this.store.document.canvas);
        const connector = this.store.document.elements[this.gesture.connectorId];
        if (isConnector(connector)) {
          const waypoints = [...connector.waypoints];
          waypoints[this.gesture.index] = this.gesture.current;
          const preview: ConnectorElement = { ...connector, waypoints, routing: 'manual' };
          const route = routeOf(this.store.document, preview);
          const node = this.renderer.nodeFor(connector.id);
          if (node) {
            for (const path of node.querySelectorAll('path')) path.setAttribute('d', route.d);
          }
        }
        this.callbacks.refreshOverlay();
        return;
      }

      case 'marquee': {
        this.renderer.overlayState.marquee = rectFromPoints(this.gesture.canvasStart, canvasPoint);
        this.callbacks.refreshOverlay();
        return;
      }

      case 'pan': {
        const { zoom } = this.store.getState().view;
        this.store.setView({
          offset: {
            x: this.gesture.startOffset.x - (event.clientX - this.gesture.startClient.x) / zoom,
            y: this.gesture.startOffset.y - (event.clientY - this.gesture.startClient.y) / zoom,
          },
        });
        return;
      }
    }
  };

  private onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    this.gesture = { type: 'none' };
    delete this.surface.dataset.panning;
    if (this.surface.hasPointerCapture(event.pointerId)) {
      this.surface.releasePointerCapture(event.pointerId);
    }

    switch (gesture.type) {
      case 'move': {
        const { x: dx, y: dy } = gesture.delta;
        this.renderer.clearDragOffset(gesture.ids);
        if (dx !== 0 || dy !== 0) {
          this.store.mutate(
            gesture.duplicated ? 'Duplicate' : 'Move',
            () => {
              const doc = this.store.document;
              for (const id of expandSelection(doc, gesture.ids)) {
                const element = doc.elements[id];
                if (!element || element.locked) continue;
                if (isShape(element)) {
                  element.frame = {
                    ...element.frame,
                    x: element.frame.x + dx,
                    y: element.frame.y + dy,
                  };
                } else if (isConnector(element)) {
                  element.waypoints = element.waypoints.map((p) => ({
                    x: p.x + dx,
                    y: p.y + dy,
                  }));
                  if (!element.source.elementId) {
                    element.source = {
                      ...element.source,
                      point: {
                        x: element.source.point.x + dx,
                        y: element.source.point.y + dy,
                      },
                    };
                  }
                  if (!element.target.elementId) {
                    element.target = {
                      ...element.target,
                      point: {
                        x: element.target.point.x + dx,
                        y: element.target.point.y + dy,
                      },
                    };
                  }
                }
              }
              refreshConnectorPoints(doc);
            },
            { scope: scopeFor(this.store, gesture.ids) },
          );
        }
        break;
      }

      case 'resize': {
        const frame = gesture.frame;
        this.store.mutate(
          'Resize',
          () => {
            const element = this.store.document.elements[gesture.id];
            if (isShape(element)) element.frame = frame;
            refreshConnectorPoints(this.store.document);
          },
          { scope: scopeFor(this.store, [gesture.id]) },
        );
        break;
      }

      case 'rotate': {
        const rotation = gesture.rotation;
        this.store.mutate(
          'Rotate',
          () => {
            const element = this.store.document.elements[gesture.id];
            if (isShape(element)) element.rotation = rotation;
            refreshConnectorPoints(this.store.document);
          },
          { scope: scopeFor(this.store, [gesture.id]) },
        );
        break;
      }

      case 'connect': {
        const target = nearestConnectionPoint(
          this.store.document,
          gesture.current,
          this.store.getState().view.zoom,
        );
        const targetHit = this.elementAt(gesture.current);
        const targetId = target?.elementId ?? targetHit;
        if (gesture.sourceId && targetId && gesture.sourceId !== targetId) {
          const kind = this.store.getState().ui.pendingConnector;
          addConnector(
            this.store,
            {
              elementId: gesture.sourceId,
              anchor:
                gesture.sourceAnchorIndex === null
                  ? { mode: 'floating' }
                  : { mode: 'fixed', index: gesture.sourceAnchorIndex },
              point: gesture.sourcePoint,
            },
            {
              elementId: targetId,
              anchor: target
                ? { mode: 'fixed', index: target.index }
                : { mode: 'floating' },
              point: gesture.current,
            },
            kind,
          );
          this.callbacks.announce('Connector added.');
        } else if (gesture.sourceId) {
          // Dropping on empty canvas leaves a free endpoint.
          const kind = this.store.getState().ui.pendingConnector;
          addConnector(
            this.store,
            {
              elementId: gesture.sourceId,
              anchor:
                gesture.sourceAnchorIndex === null
                  ? { mode: 'floating' }
                  : { mode: 'fixed', index: gesture.sourceAnchorIndex },
              point: gesture.sourcePoint,
            },
            { elementId: null, anchor: { mode: 'floating' }, point: gesture.current },
            kind,
          );
        }
        this.store.setTool('select');
        break;
      }

      case 'endpoint': {
        const target = nearestConnectionPoint(
          this.store.document,
          gesture.current,
          this.store.getState().view.zoom,
          gesture.connectorId,
        );
        const targetId = target?.elementId ?? this.elementAt(gesture.current);
        this.store.mutate(
          'Move Connector End',
          () => {
            const connector = this.store.document.elements[gesture.connectorId];
            if (!isConnector(connector)) return;
            const shape = targetId ? this.store.document.elements[targetId] : undefined;
            const endpoint = {
              elementId: isShape(shape) ? targetId : null,
              anchor: isShape(shape)
                ? anchorForDrop(
                    shape,
                    gesture.current,
                    this.store.document.canvas.snapTolerance * 2,
                  )
                : ({ mode: 'floating' } as const),
              point: gesture.current,
            };
            if (gesture.which === 'source') connector.source = endpoint;
            else connector.target = endpoint;
            refreshConnectorPoints(this.store.document);
          },
          { scope: [gesture.connectorId] },
        );
        break;
      }

      case 'waypoint': {
        const point = gesture.current;
        this.store.mutate(
          'Move Bend Point',
          () => {
            const connector = this.store.document.elements[gesture.connectorId];
            if (!isConnector(connector)) return;
            const waypoints = [...connector.waypoints];
            waypoints[gesture.index] = point;
            connector.waypoints = waypoints;
            connector.routing = 'manual';
            refreshConnectorPoints(this.store.document);
          },
          { scope: [gesture.connectorId] },
        );
        break;
      }

      case 'marquee': {
        const region = this.renderer.overlayState.marquee;
        if (region && (region.width > 2 || region.height > 2)) {
          const doc = this.store.document;
          const hits = visibleElements(doc)
            .filter((element) => {
              if (element.locked) return false;
              const bounds = elementBounds(doc, element);
              if (!bounds) return false;
              // A marquee selects what it fully encloses, as in Keynote.
              return (
                bounds.x >= region.x &&
                bounds.y >= region.y &&
                bounds.x + bounds.width <= region.x + region.width &&
                bounds.y + bounds.height <= region.y + region.height
              );
            })
            .map((element) => rootOf(doc, element.id));
          const unique = [...new Set(hits)];
          if (gesture.additive) this.store.addToSelection(unique);
          else this.store.setSelection(unique);
        }
        break;
      }

      case 'pending':
      case 'pan':
      case 'none':
        break;
    }

    this.renderer.overlayState = emptyOverlayState();
    this.callbacks.refreshOverlay();
  };

  private onDoubleClick = (event: MouseEvent): void => {
    const hit = this.hitTest(event);
    if (!hit.id) return;
    event.preventDefault();
    const element = this.store.document.elements[hit.id];
    if (!element || element.locked) return;
    if (isConnector(element)) {
      this.callbacks.beginTextEdit(hit.id, hit.labelId ?? element.labels[0]?.id ?? null);
    } else if (isShape(element)) {
      this.store.setSelection([hit.id]);
      this.callbacks.beginTextEdit(hit.id);
    }
  };

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    const hit = this.hitTest(event);
    if (hit.id) {
      const rootId = rootOf(this.store.document, hit.id);
      if (!this.store.selection.includes(rootId)) this.store.setSelection([rootId]);
    }
    this.callbacks.showContextMenu(event, hit.id);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const screen = this.renderer.pointerPosition(event);
    // Safari reports a trackpad pinch as a wheel event with ctrlKey set.
    if (event.ctrlKey || event.metaKey) {
      const factor = Math.exp(-event.deltaY * 0.01);
      this.store.zoomAt(screen, factor);
      return;
    }
    const { zoom } = this.store.getState().view;
    const offset = this.store.getState().view.offset;
    this.store.setView({
      offset: { x: offset.x + event.deltaX / zoom, y: offset.y + event.deltaY / zoom },
    });
  };

  // -------------------------------------------------------------------------
  // Drag and drop from the shape library
  // -------------------------------------------------------------------------

  private onDragOver = (event: DragEvent): void => {
    if (!event.dataTransfer) return;
    const hasShape = event.dataTransfer.types.includes('application/x-flowshark-shape');
    const hasFiles = event.dataTransfer.types.includes('Files');
    if (!hasShape && !hasFiles) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (hasShape) {
      const canvasPoint = this.renderer.screenToCanvas(this.renderer.pointerPosition(event));
      this.renderer.overlayState.dropPreview = {
        x: canvasPoint.x - 60,
        y: canvasPoint.y - 30,
        width: 120,
        height: 60,
      };
      this.callbacks.refreshOverlay();
    }
  };

  private onDragLeave = (): void => {
    this.renderer.overlayState.dropPreview = null;
    this.callbacks.refreshOverlay();
  };

  private onDrop = (event: DragEvent): void => {
    this.renderer.overlayState.dropPreview = null;
    const shapeKey = event.dataTransfer?.getData('application/x-flowshark-shape');
    const canvasPoint = this.renderer.screenToCanvas(this.renderer.pointerPosition(event));
    if (shapeKey) {
      event.preventDefault();
      const placed = addShape(this.store, shapeKey, {
        center: snapPointToGrid(canvasPoint, this.store.document.canvas),
      });
      if (placed) this.callbacks.announce('Shape added.');
    } else if (event.dataTransfer?.files?.length) {
      event.preventDefault();
      this.callbacks.filesDropped(event.dataTransfer.files, canvasPoint);
    }
    this.callbacks.refreshOverlay();
  };

  // -------------------------------------------------------------------------
  // Space bar panning
  // -------------------------------------------------------------------------

  private onSpaceDown = (event: KeyboardEvent): void => {
    if (event.code !== 'Space' || this.spaceHeld) return;
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    if (active?.getAttribute('contenteditable') === 'true') return;
    this.spaceHeld = true;
    this.surface.dataset.space = 'true';
    event.preventDefault();
  };

  private onSpaceUp = (event: KeyboardEvent): void => {
    if (event.code !== 'Space') return;
    this.spaceHeld = false;
    delete this.surface.dataset.space;
  };

  private onWindowBlur = (): void => {
    this.spaceHeld = false;
    delete this.surface.dataset.space;
  };

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private singleSelectedShapeId(): ElementId | null {
    if (this.store.selection.length !== 1) return null;
    const id = this.store.selection[0];
    return isShape(this.store.document.elements[id]) ? id : null;
  }

  private connectableIds(): ElementId[] {
    return visibleElements(this.store.document)
      .filter((element) => isShape(element) && !element.locked)
      .map((element) => element.id);
  }

  private elementAt(canvasPoint: Point): ElementId | null {
    const doc = this.store.document;
    const elements = visibleElements(doc);
    for (let i = elements.length - 1; i >= 0; i--) {
      const element = elements[i];
      if (!isShape(element)) continue;
      const bounds = elementBounds(doc, element);
      if (
        bounds &&
        canvasPoint.x >= bounds.x &&
        canvasPoint.x <= bounds.x + bounds.width &&
        canvasPoint.y >= bounds.y &&
        canvasPoint.y <= bounds.y + bounds.height
      ) {
        return element.id;
      }
    }
    return null;
  }

  /**
   * Work out the new frame for a resize.
   *
   * Shift keeps the aspect ratio, Option resizes about the centre — the same
   * modifiers Keynote and Pages use.
   */
  private resizeFrame(
    start: Rect,
    handle: HandleId,
    pointer: Point,
    keepRatio: boolean,
    fromCentre: boolean,
  ): Rect {
    const minimum = 8;
    let { x, y, width, height } = start;
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    const centre = rectCenter(start);

    const west = handle === 'nw' || handle === 'w' || handle === 'sw';
    const east = handle === 'ne' || handle === 'e' || handle === 'se';
    const north = handle === 'nw' || handle === 'n' || handle === 'ne';
    const south = handle === 'sw' || handle === 's' || handle === 'se';

    if (fromCentre) {
      if (west || east) {
        const half = Math.max(Math.abs(pointer.x - centre.x), minimum / 2);
        x = centre.x - half;
        width = half * 2;
      }
      if (north || south) {
        const half = Math.max(Math.abs(pointer.y - centre.y), minimum / 2);
        y = centre.y - half;
        height = half * 2;
      }
    } else {
      if (west) {
        x = Math.min(pointer.x, right - minimum);
        width = right - x;
      }
      if (east) width = Math.max(pointer.x - start.x, minimum);
      if (north) {
        y = Math.min(pointer.y, bottom - minimum);
        height = bottom - y;
      }
      if (south) height = Math.max(pointer.y - start.y, minimum);
    }

    if (keepRatio && start.width > 0 && start.height > 0) {
      const ratio = start.width / start.height;
      if (width / height > ratio) width = height * ratio;
      else height = width / ratio;
      if (west && !fromCentre) x = right - width;
      if (north && !fromCentre) y = bottom - height;
      if (fromCentre) {
        x = centre.x - width / 2;
        y = centre.y - height / 2;
      }
    }

    return {
      x,
      y,
      width: Math.max(width, minimum),
      height: Math.max(height, minimum),
    };
  }
}

/** Rotate a point for hit testing against a rotated shape. */
export function unrotatePoint(p: Point, frame: Rect, rotation: number): Point {
  if (!rotation) return p;
  return rotatePoint(p, rectCenter(frame), -rotation);
}

export { clamp };
