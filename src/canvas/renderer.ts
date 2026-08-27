/**
 * The on-screen canvas.
 *
 * The scene is rebuilt from markup whenever the document changes, and pan,
 * zoom, and in-progress drags are handled with transforms instead. That keeps
 * the expensive work to once per edit rather than once per frame, and it means
 * the screen and every exporter share one drawing path.
 *
 * The overlay — selection outlines, handles, guides, the marquee — lives in a
 * second SVG in screen coordinates, so handles stay the same size at every
 * zoom level.
 */

import type { Point, Rect } from '../model/geometry';
import { rectCenter, rotatePoint, round } from '../model/geometry';
import type { ConnectorElement, ElementId, ShapeElement } from '../model/types';
import { isConnector, isGroup, isShape } from '../model/types';
import {
  boundsOf,
  connectorsAttachedTo,
  descendantsOf,
  elementBounds,
  expandSelection,
  rootOf,
  routeOf,
  visibleElements,
} from '../model/document';
import { connectionPointsFor, getShapeDefinition } from '../shapes/library';
import { buildScene, type SceneTheme } from './scene';
import { clear, el, svg } from '../util/dom';
import type { Guide, Store } from '../state/store';

export interface RendererElements {
  scroll: HTMLElement;
  canvas: SVGSVGElement;
  defs: SVGDefsElement;
  root: SVGGElement;
  overlay: SVGSVGElement;
  overlayRoot: SVGGElement;
  outline: HTMLElement;
}

/** Extra overlay state that is not part of the document. */
export interface OverlayState {
  marquee: Rect | null;
  guides: Guide[];
  /** Rubber-band line while a connector is being drawn. */
  pendingConnector: { from: Point; to: Point } | null;
  /** Connection points to reveal while connecting. */
  connectionHints: ElementId[];
  /** Connection point currently under the pointer. */
  activeConnection: Point | null;
  /** Ghost outline while a shape is dragged in from the sidebar. */
  dropPreview: Rect | null;
}

export function emptyOverlayState(): OverlayState {
  return {
    marquee: null,
    guides: [],
    pendingConnector: null,
    connectionHints: [],
    activeConnection: null,
    dropPreview: null,
  };
}

const HANDLE_SIZE = 7;

export type HandleId =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'
  | 'rotate';

const RESIZE_HANDLES: Array<{ id: HandleId; rx: number; ry: number; cursor: string }> = [
  { id: 'nw', rx: 0, ry: 0, cursor: 'nwse-resize' },
  { id: 'n', rx: 0.5, ry: 0, cursor: 'ns-resize' },
  { id: 'ne', rx: 1, ry: 0, cursor: 'nesw-resize' },
  { id: 'e', rx: 1, ry: 0.5, cursor: 'ew-resize' },
  { id: 'se', rx: 1, ry: 1, cursor: 'nwse-resize' },
  { id: 's', rx: 0.5, ry: 1, cursor: 'ns-resize' },
  { id: 'sw', rx: 0, ry: 1, cursor: 'nesw-resize' },
  { id: 'w', rx: 0, ry: 0.5, cursor: 'ew-resize' },
];

function themeFromCss(): SceneTheme {
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string): string =>
    styles.getPropertyValue(name).trim() || fallback;
  return {
    background: null,
    gridLine: read('--grid-line', '#e4e7ee'),
    gridLineStrong: read('--grid-line-strong', '#ccd2de'),
    pageBoundary: read('--page-boundary', '#b8bfcd'),
  };
}

export class CanvasRenderer {
  overlayState: OverlayState = emptyOverlayState();

  private gridRect: SVGRectElement;
  private gridDefs: SVGDefsElement;
  private nodeIndex = new Map<ElementId, SVGGElement>();
  private theme: SceneTheme = themeFromCss();

  constructor(
    private readonly store: Store,
    private readonly dom: RendererElements,
  ) {
    // A separate defs node: the grid pattern is rewritten on every pan and
    // zoom, and it must not take the scene's gradients and markers with it.
    this.gridDefs = svg('defs', { id: 'fs-grid-defs' });
    this.dom.canvas.insertBefore(this.gridDefs, this.dom.defs);

    this.gridRect = svg('rect', {
      class: 'fs-grid-background',
      x: 0,
      y: 0,
      width: '100%',
      height: '100%',
      fill: 'url(#fs-grid-pattern)',
      'pointer-events': 'none',
    });
    this.dom.canvas.insertBefore(this.gridRect, this.dom.root);
    this.installGridPattern();

    // Re-read colours when the system appearance changes.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', () => {
      this.theme = themeFromCss();
      this.installGridPattern();
      this.renderScene();
    });
  }

  refreshTheme(): void {
    this.theme = themeFromCss();
    this.installGridPattern();
  }

  // -------------------------------------------------------------------------
  // Coordinate conversion
  // -------------------------------------------------------------------------

  screenToCanvas(p: Point): Point {
    const { zoom, offset } = this.store.getState().view;
    return { x: p.x / zoom + offset.x, y: p.y / zoom + offset.y };
  }

  canvasToScreen(p: Point): Point {
    const { zoom, offset } = this.store.getState().view;
    return { x: (p.x - offset.x) * zoom, y: (p.y - offset.y) * zoom };
  }

  /** Pointer position relative to the canvas surface. */
  pointerPosition(event: { clientX: number; clientY: number }): Point {
    const rect = this.dom.scroll.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  viewportSize(): { width: number; height: number } {
    const rect = this.dom.scroll.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  }

  /** The canvas region currently on screen. */
  visibleRegion(): Rect {
    const { width, height } = this.viewportSize();
    const topLeft = this.screenToCanvas({ x: 0, y: 0 });
    const bottomRight = this.screenToCanvas({ x: width, y: height });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  // -------------------------------------------------------------------------
  // Scene
  // -------------------------------------------------------------------------

  renderScene(): void {
    const doc = this.store.document;
    const scene = buildScene(doc, {
      theme: this.theme,
      showGrid: false,
      showPageBoundaries: doc.canvas.page.showBoundaries,
      interactive: true,
      accessible: false,
    });
    this.dom.defs.innerHTML = scene.defs;
    this.installGridPattern();
    this.dom.root.innerHTML = scene.body;

    this.nodeIndex.clear();
    for (const node of this.dom.root.querySelectorAll<SVGGElement>('g[data-id]')) {
      const id = node.dataset.id;
      if (id) this.nodeIndex.set(id, node);
    }
    this.updateTransform();
    this.renderOutline();
  }

  nodeFor(id: ElementId): SVGGElement | undefined {
    return this.nodeIndex.get(id);
  }

  updateTransform(): void {
    const { zoom, offset } = this.store.getState().view;
    this.dom.root.setAttribute(
      'transform',
      `translate(${round(-offset.x * zoom, 3)} ${round(-offset.y * zoom, 3)}) scale(${round(zoom, 6)})`,
    );
    this.installGridPattern();
  }

  // -------------------------------------------------------------------------
  // Grid
  // -------------------------------------------------------------------------

  private gridPatternMarkup(): string {
    const doc = this.store.document;
    const { zoom, offset } = this.store.getState().view;
    const step = doc.canvas.grid.size * zoom;
    if (!doc.canvas.grid.visible || step < 3) {
      return '<pattern id="fs-grid-pattern" width="1" height="1" patternUnits="userSpaceOnUse"></pattern>';
    }
    const major = step * 10;
    const originX = round(-offset.x * zoom, 3);
    const originY = round(-offset.y * zoom, 3);
    return (
      `<pattern id="fs-grid-minor" width="${round(step, 3)}" height="${round(step, 3)}" ` +
      `patternUnits="userSpaceOnUse" x="${originX}" y="${originY}">` +
      `<path d="M ${round(step, 3)} 0 L 0 0 0 ${round(step, 3)}" fill="none" ` +
      `stroke="${this.theme.gridLine}" stroke-width="1"/></pattern>` +
      `<pattern id="fs-grid-pattern" width="${round(major, 3)}" height="${round(major, 3)}" ` +
      `patternUnits="userSpaceOnUse" x="${originX}" y="${originY}">` +
      `<rect width="${round(major, 3)}" height="${round(major, 3)}" fill="url(#fs-grid-minor)"/>` +
      `<path d="M ${round(major, 3)} 0 L 0 0 0 ${round(major, 3)}" fill="none" ` +
      `stroke="${this.theme.gridLineStrong}" stroke-width="1"/></pattern>`
    );
  }

  private installGridPattern(): void {
    const markup = this.gridPatternMarkup();
    if (this.gridDefs.innerHTML === markup) return;
    this.gridDefs.innerHTML = markup;
  }

  // -------------------------------------------------------------------------
  // Live drag support
  // -------------------------------------------------------------------------

  /**
   * Offset elements visually without touching the document. The move is
   * committed once, when the gesture ends, so undo records one step.
   */
  setDragOffset(ids: readonly ElementId[], dx: number, dy: number): void {
    const doc = this.store.document;
    const moving = new Set(expandSelection(doc, ids));
    for (const id of moving) {
      const node = this.nodeIndex.get(id);
      if (!node) continue;
      const element = doc.elements[id];
      if (isShape(element)) {
        node.setAttribute('transform', this.shapeTransform(element, dx, dy));
      } else if (isConnector(element)) {
        node.setAttribute('transform', `translate(${round(dx, 2)} ${round(dy, 2)})`);
      }
    }
    // Connectors with one end moving must be re-routed live.
    for (const connector of connectorsAttachedTo(doc, [...moving])) {
      if (moving.has(connector.id)) continue;
      this.previewConnector(connector, moving, dx, dy);
    }
  }

  clearDragOffset(ids: readonly ElementId[]): void {
    const doc = this.store.document;
    const moving = new Set(expandSelection(doc, ids));
    for (const id of moving) {
      const node = this.nodeIndex.get(id);
      const element = doc.elements[id];
      if (!node) continue;
      if (isShape(element)) node.setAttribute('transform', this.shapeTransform(element, 0, 0));
      else node.removeAttribute('transform');
    }
  }

  private shapeTransform(element: ShapeElement, dx: number, dy: number): string {
    const parts = [
      `translate(${round(element.frame.x + dx, 2)} ${round(element.frame.y + dy, 2)})`,
    ];
    if (element.rotation) {
      parts.push(
        `rotate(${round(element.rotation, 3)} ${round(element.frame.width / 2, 2)} ${round(
          element.frame.height / 2,
          2,
        )})`,
      );
    }
    return parts.join(' ');
  }

  /** Re-route one connector against a temporary offset applied to some shapes. */
  private previewConnector(
    connector: ConnectorElement,
    moving: ReadonlySet<ElementId>,
    dx: number,
    dy: number,
  ): void {
    const doc = this.store.document;
    const shifted: Record<string, (typeof doc.elements)[string]> = { ...doc.elements };
    for (const id of moving) {
      const element = doc.elements[id];
      if (!isShape(element)) continue;
      shifted[id] = {
        ...element,
        frame: { ...element.frame, x: element.frame.x + dx, y: element.frame.y + dy },
      };
    }
    const route = routeOf({ ...doc, elements: shifted }, connector);
    const node = this.nodeIndex.get(connector.id);
    if (!node) return;
    for (const path of node.querySelectorAll('path')) path.setAttribute('d', route.d);
  }

  /** Preview a resize without committing it. */
  setFramePreview(id: ElementId, frame: Rect): void {
    const doc = this.store.document;
    const element = doc.elements[id];
    if (!isShape(element)) return;
    const node = this.nodeIndex.get(id);
    if (!node) return;
    const definition = getShapeDefinition(element.shape);
    const geometry = definition.geometry(frame.width, frame.height, element.style.cornerRadius);
    const paths = node.querySelectorAll<SVGPathElement>('path.fs-shape-path');
    if (paths.length > 0) paths[0].setAttribute('d', geometry.path);
    node.setAttribute(
      'transform',
      this.shapeTransform({ ...element, frame } as ShapeElement, 0, 0),
    );
  }

  // -------------------------------------------------------------------------
  // Overlay
  // -------------------------------------------------------------------------

  renderOverlay(): void {
    const doc = this.store.document;
    const state = this.store.getState();
    const root = this.dom.overlayRoot;
    clear(root);

    const toScreen = (p: Point): Point => this.canvasToScreen(p);
    const selection = [...new Set(state.selection.map((id) => rootOf(doc, id)))];

    // Individual outlines for a multiple selection.
    if (selection.length > 1) {
      for (const id of selection) {
        const bounds = elementBounds(doc, doc.elements[id]);
        if (!bounds) continue;
        root.append(this.outlineRect(bounds, isGroup(doc.elements[id])));
      }
    }

    const bounds = boundsOf(doc, selection);
    const singleShape =
      selection.length === 1 ? doc.elements[selection[0]] : undefined;

    if (bounds) {
      root.append(this.outlineRect(bounds, selection.length > 1 || isGroup(singleShape)));

      const locked = selection.some((id) => doc.elements[id]?.locked);
      if (!locked && isShape(singleShape)) {
        root.append(...this.resizeHandles(singleShape));
        root.append(this.rotateHandle(singleShape));
      } else if (!locked && selection.length > 1) {
        root.append(...this.boundsHandles(bounds));
      } else if (locked) {
        const corner = toScreen({ x: bounds.x + bounds.width, y: bounds.y });
        root.append(
          svg('path', {
            class: 'lock-badge',
            transform: `translate(${round(corner.x - 14, 2)} ${round(corner.y - 2, 2)}) scale(0.6)`,
            d: 'M6 9 h8 v7 h-8 Z M7.5 9 V6.5 a2.5 2.5 0 0 1 5 0 V9',
          }),
        );
      }
    }

    if (isConnector(singleShape)) root.append(...this.connectorHandles(singleShape));

    for (const guide of this.overlayState.guides) root.append(...this.guideMarks(guide));

    if (doc.canvas.showRulers) root.append(this.rulers(bounds));

    if (this.overlayState.marquee) {
      const topLeft = toScreen({
        x: this.overlayState.marquee.x,
        y: this.overlayState.marquee.y,
      });
      const { zoom } = state.view;
      root.append(
        svg('rect', {
          class: 'marquee',
          x: round(topLeft.x, 2),
          y: round(topLeft.y, 2),
          width: round(this.overlayState.marquee.width * zoom, 2),
          height: round(this.overlayState.marquee.height * zoom, 2),
        }),
      );
    }

    if (this.overlayState.dropPreview) {
      const topLeft = toScreen(this.overlayState.dropPreview);
      const { zoom } = state.view;
      root.append(
        svg('rect', {
          class: 'drop-preview',
          x: round(topLeft.x, 2),
          y: round(topLeft.y, 2),
          width: round(this.overlayState.dropPreview.width * zoom, 2),
          height: round(this.overlayState.dropPreview.height * zoom, 2),
          rx: 4,
        }),
      );
    }

    for (const id of this.overlayState.connectionHints) {
      const element = doc.elements[id];
      if (!isShape(element)) continue;
      const definition = getShapeDefinition(element.shape);
      for (const point of connectionPointsFor(definition, element.frame)) {
        const screen = toScreen(point);
        root.append(
          svg('circle', {
            class: 'connection-point',
            cx: round(screen.x, 2),
            cy: round(screen.y, 2),
            r: 3.5,
          }),
        );
      }
    }

    if (this.overlayState.activeConnection) {
      const screen = toScreen(this.overlayState.activeConnection);
      root.append(
        svg('circle', {
          class: 'connection-point active',
          cx: round(screen.x, 2),
          cy: round(screen.y, 2),
          r: 5,
        }),
      );
    }

    if (this.overlayState.pendingConnector) {
      const from = toScreen(this.overlayState.pendingConnector.from);
      const to = toScreen(this.overlayState.pendingConnector.to);
      root.append(
        svg('path', {
          class: 'pending-connector',
          d: `M ${round(from.x, 2)} ${round(from.y, 2)} L ${round(to.x, 2)} ${round(to.y, 2)}`,
        }),
      );
    }
  }

  private outlineRect(bounds: Rect, dashed: boolean): SVGRectElement {
    const topLeft = this.canvasToScreen(bounds);
    const { zoom } = this.store.getState().view;
    return svg('rect', {
      class: `selection-outline${dashed ? ' group' : ''}`,
      x: round(topLeft.x - 0.5, 2),
      y: round(topLeft.y - 0.5, 2),
      width: round(bounds.width * zoom + 1, 2),
      height: round(bounds.height * zoom + 1, 2),
    });
  }

  private handleAt(p: Point, id: HandleId, cursor: string, className = ''): SVGRectElement {
    return svg('rect', {
      class: `handle ${className}`.trim(),
      x: round(p.x - HANDLE_SIZE / 2, 2),
      y: round(p.y - HANDLE_SIZE / 2, 2),
      width: HANDLE_SIZE,
      height: HANDLE_SIZE,
      rx: 1.5,
      'data-handle': id,
      style: `cursor:${cursor}`,
    });
  }

  /** Handles for a single shape, rotated with the shape. */
  private resizeHandles(element: ShapeElement): SVGElement[] {
    const centre = rectCenter(element.frame);
    return RESIZE_HANDLES.map((handle) => {
      const local = {
        x: element.frame.x + element.frame.width * handle.rx,
        y: element.frame.y + element.frame.height * handle.ry,
      };
      const rotated = element.rotation
        ? rotatePoint(local, centre, element.rotation)
        : local;
      return this.handleAt(this.canvasToScreen(rotated), handle.id, handle.cursor);
    });
  }

  private boundsHandles(bounds: Rect): SVGElement[] {
    return RESIZE_HANDLES.map((handle) =>
      this.handleAt(
        this.canvasToScreen({
          x: bounds.x + bounds.width * handle.rx,
          y: bounds.y + bounds.height * handle.ry,
        }),
        handle.id,
        handle.cursor,
      ),
    );
  }

  private rotateHandle(element: ShapeElement): SVGElement {
    const centre = rectCenter(element.frame);
    const local = { x: centre.x, y: element.frame.y - 22 };
    const rotated = element.rotation ? rotatePoint(local, centre, element.rotation) : local;
    const screen = this.canvasToScreen(rotated);
    return svg('circle', {
      class: 'handle rotate',
      cx: round(screen.x, 2),
      cy: round(screen.y, 2),
      r: 4.5,
      'data-handle': 'rotate',
      style: 'cursor:grab',
    });
  }

  private connectorHandles(connector: ConnectorElement): SVGElement[] {
    const route = routeOf(this.store.document, connector);
    const nodes: SVGElement[] = [];
    const ends: Array<[Point, string]> = [
      [route.points[0], 'source'],
      [route.points[route.points.length - 1], 'target'],
    ];
    for (const [point, role] of ends) {
      const screen = this.canvasToScreen(point);
      nodes.push(
        svg('circle', {
          class: 'handle endpoint',
          cx: round(screen.x, 2),
          cy: round(screen.y, 2),
          r: 5,
          'data-endpoint': role,
          style: 'cursor:crosshair',
        }),
      );
    }
    connector.waypoints.forEach((waypoint, index) => {
      const screen = this.canvasToScreen(waypoint);
      nodes.push(
        svg('circle', {
          class: 'handle waypoint',
          cx: round(screen.x, 2),
          cy: round(screen.y, 2),
          r: 4,
          'data-waypoint': index,
          style: 'cursor:move',
        }),
      );
    });
    return nodes;
  }

  /**
   * Rulers along the top and left edges.
   *
   * The tick spacing steps through 1, 2, 5, 10, 20, 50 … so the labels stay
   * readable at every zoom level, and the current selection is shaded on both
   * rulers the way a page layout application does it.
   */
  private rulers(selection: Rect | null): SVGGElement {
    const { zoom } = this.store.getState().view;
    const { width, height } = this.viewportSize();
    const thickness = 20;
    const group = svg('g', { class: 'fs-rulers', 'aria-hidden': 'true' });

    group.append(
      svg('rect', { class: 'ruler-band', x: 0, y: 0, width, height: thickness }),
      svg('rect', { class: 'ruler-band', x: 0, y: 0, width: thickness, height }),
    );

    // Pick a tick spacing that is at least 60 screen pixels apart.
    const target = 60 / zoom;
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)));
    const step =
      [1, 2, 5, 10].map((factor) => factor * magnitude).find((value) => value >= target) ??
      magnitude * 10;

    const region = this.visibleRegion();
    const startX = Math.floor(region.x / step) * step;
    for (let x = startX; x < region.x + region.width; x += step) {
      const screenX = this.canvasToScreen({ x, y: 0 }).x;
      if (screenX < thickness) continue;
      group.append(
        svg('line', {
          class: 'ruler-tick',
          x1: round(screenX, 1),
          y1: thickness - 6,
          x2: round(screenX, 1),
          y2: thickness,
        }),
        svg('text', { class: 'ruler-label', x: round(screenX + 3, 1), y: 11 }, [
          String(Math.round(x)),
        ]),
      );
    }

    const startY = Math.floor(region.y / step) * step;
    for (let y = startY; y < region.y + region.height; y += step) {
      const screenY = this.canvasToScreen({ x: 0, y }).y;
      if (screenY < thickness) continue;
      group.append(
        svg('line', {
          class: 'ruler-tick',
          x1: thickness - 6,
          y1: round(screenY, 1),
          x2: thickness,
          y2: round(screenY, 1),
        }),
        svg(
          'text',
          {
            class: 'ruler-label',
            x: 3,
            y: round(screenY - 3, 1),
            transform: `rotate(-90 3 ${round(screenY - 3, 1)})`,
          },
          [String(Math.round(y))],
        ),
      );
    }

    if (selection) {
      const topLeft = this.canvasToScreen(selection);
      group.append(
        svg('rect', {
          class: 'ruler-selection',
          x: round(topLeft.x, 1),
          y: 0,
          width: round(selection.width * zoom, 1),
          height: thickness,
        }),
        svg('rect', {
          class: 'ruler-selection',
          x: 0,
          y: round(topLeft.y, 1),
          width: thickness,
          height: round(selection.height * zoom, 1),
        }),
      );
    }

    return group;
  }

  private guideMarks(guide: Guide): SVGElement[] {
    const { zoom } = this.store.getState().view;
    const nodes: SVGElement[] = [];
    if (guide.orientation === 'vertical') {
      const x = this.canvasToScreen({ x: guide.position, y: 0 }).x;
      const y1 = this.canvasToScreen({ x: 0, y: guide.from }).y - 12;
      const y2 = this.canvasToScreen({ x: 0, y: guide.to }).y + 12;
      nodes.push(
        svg('line', {
          class: `guide${guide.kind === 'spacing' ? ' spacing' : ''}`,
          x1: round(x, 1),
          y1: round(y1, 1),
          x2: round(x, 1),
          y2: round(y2, 1),
        }),
      );
    } else {
      const y = this.canvasToScreen({ x: 0, y: guide.position }).y;
      const x1 = this.canvasToScreen({ x: guide.from, y: 0 }).x - 12;
      const x2 = this.canvasToScreen({ x: guide.to, y: 0 }).x + 12;
      nodes.push(
        svg('line', {
          class: `guide${guide.kind === 'spacing' ? ' spacing' : ''}`,
          x1: round(x1, 1),
          y1: round(y, 1),
          x2: round(x2, 1),
          y2: round(y, 1),
        }),
      );
    }
    void zoom;
    return nodes;
  }

  // -------------------------------------------------------------------------
  // Accessible outline
  // -------------------------------------------------------------------------

  /**
   * A VoiceOver-readable mirror of the diagram.
   *
   * A canvas has no accessible structure, so the brief calls for a parallel
   * object list. Each entry names the element and, for shapes, the connections
   * that leave it — "Process, Approve invoice, connects to Decision, Approved?"
   */
  renderOutline(): void {
    const doc = this.store.document;
    const outline = this.dom.outline;
    clear(outline);

    const describe = (id: ElementId): string => {
      const element = doc.elements[id];
      if (!element) return 'Unknown element';
      if (isShape(element)) {
        const definition = getShapeDefinition(element.shape);
        const text = element.text.value.trim().replace(/\s+/g, ' ');
        return element.altText || (text ? `${definition.name}, ${text}` : definition.name);
      }
      if (isConnector(element)) {
        const labels = element.labels.map((label) => label.text.trim()).filter(Boolean);
        return labels.length > 0 ? `Connector labelled ${labels.join(', ')}` : 'Connector';
      }
      return `Group of ${descendantsOf(doc, id).length} elements`;
    };

    for (const element of visibleElements(doc)) {
      if (!isShape(element)) continue;
      const outgoing = Object.values(doc.elements)
        .filter(isConnector)
        .filter((connector) => connector.source.elementId === element.id)
        .map((connector) => {
          const targetId = connector.target.elementId;
          const label = connector.labels
            .map((entry) => entry.text.trim())
            .filter(Boolean)
            .join(', ');
          const target = targetId ? describe(targetId) : 'a point on the canvas';
          return label ? `${label} to ${target}` : `to ${target}`;
        });

      const description =
        outgoing.length > 0
          ? `${describe(element.id)}. Connects ${outgoing.join('; ')}.`
          : `${describe(element.id)}.`;

      outline.append(
        el(
          'div',
          {
            role: 'treeitem',
            tabindex: -1,
            'data-id': element.id,
            'aria-selected': this.store.selection.includes(element.id) ? 'true' : 'false',
          },
          [description],
        ),
      );
    }
  }
}
