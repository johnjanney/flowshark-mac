/**
 * The shape library sidebar.
 *
 * Shapes can be dragged onto the canvas or clicked to arm the shape tool.
 * Search covers names and keywords, so "diamond" finds the Decision shape and
 * "data store" finds the Database shape.
 */

import { clear, el, requireElement } from '../util/dom';
import { icon } from './icons';
import { shapeGlyph } from './shape-glyph';
import {
  SHAPE_DEFINITIONS,
  getShapeDefinition,
  searchShapes,
  type ShapeCategory,
  type ShapeDefinition,
} from '../shapes/library';
import type { Store } from '../state/store';
import type { CommandRegistry } from '../commands/registry';

const CATEGORY_TITLES: Array<{ key: ShapeCategory; title: string }> = [
  { key: 'flowchart', title: 'Flowchart' },
  { key: 'general', title: 'General' },
  { key: 'container', title: 'Containers' },
  { key: 'annotation', title: 'Annotation' },
];

const CONNECTOR_KINDS = [
  { key: 'straight', title: 'Straight', d: 'M 4 26 L 38 8' },
  { key: 'elbow', title: 'Elbow', d: 'M 4 26 L 21 26 L 21 8 L 38 8' },
  { key: 'curved', title: 'Curved', d: 'M 4 26 C 20 26 22 8 38 8' },
  { key: 'step', title: 'Step', d: 'M 4 26 L 14 26 L 14 17 L 28 17 L 28 8 L 38 8' },
  { key: 'freeform', title: 'Freeform', d: 'M 4 26 L 12 14 L 22 24 L 30 10 L 38 16' },
] as const;

export class Sidebar {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private searchField: HTMLInputElement;

  constructor(
    private readonly store: Store,
    private readonly registry: CommandRegistry,
  ) {
    this.root = requireElement<HTMLElement>('sidebar');
    this.searchField = el('input', {
      type: 'search',
      placeholder: 'Search shapes',
      'aria-label': 'Search shapes',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.body = el('div', { class: 'panel-body' });
  }

  mount(): void {
    clear(this.root);
    const toggle = el(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: 'Hide the shape library',
        'aria-label': 'Hide the shape library',
      },
      [icon('sidebar-left')],
    );
    toggle.addEventListener('click', () => this.registry.run('view.toggleSidebar'));

    this.searchField.addEventListener('input', () => {
      this.store.setUi({ shapeSearch: this.searchField.value });
    });

    this.root.append(
      el('div', { class: 'panel-header' }, [el('h2', {}, ['Shapes']), spacer(), toggle]),
      el('div', { class: 'shape-search' }, [this.searchField]),
      this.body,
    );
    this.render();
  }

  render(): void {
    const state = this.store.getState();
    const query = state.ui.shapeSearch.trim();
    clear(this.body);

    if (query) {
      const results = searchShapes(query);
      if (results.length === 0) {
        this.body.append(el('p', { class: 'empty-note' }, [`No shape matches “${query}”.`]));
        return;
      }
      this.body.append(this.section('Results', this.grid(results), true));
      return;
    }

    const recent = state.ui.recentShapes
      .map((key) => SHAPE_DEFINITIONS.find((definition) => definition.key === key))
      .filter((definition): definition is ShapeDefinition => !!definition);
    if (recent.length > 0) {
      this.body.append(this.section('Recently Used', this.grid(recent), true));
    }

    for (const category of CATEGORY_TITLES) {
      const shapes = SHAPE_DEFINITIONS.filter(
        (definition) => definition.category === category.key,
      );
      if (shapes.length === 0) continue;
      this.body.append(
        this.section(category.title, this.grid(shapes), category.key === 'flowchart'),
      );
    }

    this.body.append(this.section('Connectors', this.connectorGrid(), true));
  }

  private section(title: string, content: HTMLElement, open: boolean): HTMLElement {
    return el('details', { class: 'panel-section', open }, [
      el('summary', {}, [title]),
      content,
    ]);
  }

  private grid(shapes: readonly ShapeDefinition[]): HTMLElement {
    const grid = el('div', { class: 'shape-grid', role: 'group' });
    for (const definition of shapes) {
      const pending = this.store.getState().ui.pendingShape === definition.key;
      const tile = el(
        'button',
        {
          class: 'shape-tile',
          type: 'button',
          draggable: 'true',
          'data-shape': definition.key,
          'aria-pressed': pending ? 'true' : 'false',
          title: `${definition.name} — drag onto the canvas, or click and then click the canvas`,
        },
        [shapeGlyph(definition), el('span', {}, [definition.name])],
      );

      tile.addEventListener('click', () => {
        this.store.setUi({ pendingShape: definition.key });
        this.store.setTool('shape');
        this.render();
      });
      tile.addEventListener('dblclick', () => {
        this.registry.run('insert.pendingShapeAtCentre');
      });
      tile.addEventListener('dragstart', (event) => {
        event.dataTransfer?.setData('application/x-flowshark-shape', definition.key);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
        this.store.setUi({ pendingShape: definition.key });
      });
      grid.append(tile);
    }
    return grid;
  }

  private connectorGrid(): HTMLElement {
    const grid = el('div', { class: 'shape-grid', role: 'group' });
    for (const kind of CONNECTOR_KINDS) {
      const pending = this.store.getState().ui.pendingConnector === kind.key;
      const glyph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      glyph.setAttribute('viewBox', '0 0 42 34');
      glyph.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', kind.d);
      path.setAttribute('class', 'glyph-line');
      glyph.append(path);

      const tile = el(
        'button',
        {
          class: 'shape-tile',
          type: 'button',
          'aria-pressed': pending ? 'true' : 'false',
          title: `${kind.title} connector — click, then drag between two shapes`,
        },
        [glyph, el('span', {}, [kind.title])],
      );
      tile.addEventListener('click', () => {
        this.store.setUi({ pendingConnector: kind.key });
        this.store.setTool('connector');
        this.render();
      });
      grid.append(tile);
    }
    return grid;
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  focusSearch(): void {
    this.searchField.focus();
    this.searchField.select();
  }

  syncSearchField(): void {
    const value = this.store.getState().ui.shapeSearch;
    if (this.searchField.value !== value) this.searchField.value = value;
  }
}

function spacer(): HTMLElement {
  return el('div', { style: 'flex:1 1 auto' });
}

export { getShapeDefinition };
