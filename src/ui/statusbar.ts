/**
 * The status bar and the floating zoom controls.
 */

import { clear, el, requireElement } from '../util/dom';
import { icon } from './icons';
import type { Store } from '../state/store';
import type { CommandRegistry } from '../commands/registry';
import { MAX_ZOOM, MIN_ZOOM } from '../state/store';

export class StatusBar {
  private readonly root: HTMLElement;
  private readonly zoomRoot: HTMLElement;
  private messageNode: HTMLElement | null = null;
  private selectionNode: HTMLElement | null = null;
  private positionNode: HTMLElement | null = null;
  private zoomValue: HTMLElement | null = null;
  private zoomField: HTMLInputElement | null = null;

  constructor(
    private readonly store: Store,
    private readonly registry: CommandRegistry,
  ) {
    this.root = requireElement<HTMLElement>('statusbar');
    this.zoomRoot = requireElement<HTMLElement>('zoom-controls');
  }

  mount(): void {
    clear(this.root);
    this.messageNode = el('span', { class: 'status-message' }, ['Ready']);
    this.selectionNode = el('span', {}, ['Nothing selected']);
    this.positionNode = el('span', {}, ['']);
    this.root.append(this.messageNode, this.selectionNode, this.positionNode);

    clear(this.zoomRoot);
    const out = el(
      'button',
      { class: 'icon-button', type: 'button', 'aria-label': 'Zoom out', title: 'Zoom out' },
      [icon('zoom-out')],
    );
    out.addEventListener('click', () => this.registry.run('view.zoomOut'));

    this.zoomField = el('input', {
      type: 'text',
      class: 'zoom-value',
      'aria-label': 'Zoom level',
      inputmode: 'numeric',
      size: 5,
    });
    this.zoomField.addEventListener('change', () => {
      const value = Number.parseFloat(this.zoomField!.value.replace('%', ''));
      if (Number.isFinite(value) && value > 0) {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value / 100));
        const { width, height } = this.store.getState().view.viewport;
        this.store.zoomAt(
          { x: width / 2, y: height / 2 },
          zoom / this.store.getState().view.zoom,
        );
      }
      this.sync();
    });

    const inButton = el(
      'button',
      { class: 'icon-button', type: 'button', 'aria-label': 'Zoom in', title: 'Zoom in' },
      [icon('zoom-in')],
    );
    inButton.addEventListener('click', () => this.registry.run('view.zoomIn'));

    const fit = el(
      'button',
      { class: 'icon-button', type: 'button', 'aria-label': 'Zoom to fit', title: 'Zoom to fit' },
      [icon('fit')],
    );
    fit.addEventListener('click', () => this.registry.run('view.zoomToFit'));

    this.zoomRoot.append(out, this.zoomField, inButton, fit);
    this.sync();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  sync(): void {
    const state = this.store.getState();
    if (this.messageNode) {
      this.messageNode.textContent = state.ui.statusMessage || this.defaultMessage();
    }
    if (this.selectionNode) {
      const count = state.selection.length;
      this.selectionNode.textContent =
        count === 0
          ? 'Nothing selected'
          : count === 1
            ? '1 element selected'
            : `${count} elements selected`;
    }
    if (this.positionNode) {
      this.positionNode.textContent = `Grid ${state.document.canvas.grid.size} pt${
        state.document.canvas.grid.snap ? ' · snapping' : ''
      }`;
    }
    if (this.zoomField && document.activeElement !== this.zoomField) {
      this.zoomField.value = `${Math.round(state.view.zoom * 100)}%`;
    }
    if (this.zoomValue) this.zoomValue.textContent = `${Math.round(state.view.zoom * 100)}%`;
  }

  private defaultMessage(): string {
    const state = this.store.getState();
    if (state.file.dirty) return `${state.document.meta.title} — edited`;
    if (state.file.path) return state.file.path;
    return 'Ready';
  }
}
