/**
 * The inspector.
 *
 * The panel is rebuilt when the kind of selection changes and only refreshed in
 * place when values change, so a field keeps focus and its insertion point
 * while the user is typing in it.
 */

import { clear, el, requireElement } from '../util/dom';
import { icon } from './icons';
import type { Store } from '../state/store';
import type { CommandRegistry } from '../commands/registry';
import {
  FONT_FAMILIES,
  defaultLabelTextStyle,
} from '../model/defaults';
import type {
  ConnectorElement,
  MarkerKind,
  ShapeElement,
  ShapeStyle,
  TextStyle,
} from '../model/types';
import { isConnector, isShape } from '../model/types';
import { expandSelection, rootOf } from '../model/document';
import { getShapeDefinition } from '../shapes/library';
import { MARKER_KINDS, MARKER_LABELS } from '../connectors/markers';
import {
  addConnectorLabel,
  applyPreset,
  removeConnectorLabel,
  setConnectorKind,
  setConnectorRouting,
  setFrame,
  setRotation,
  updateConnectorLabel,
  updateConnectorStyle,
  updateShapeStyle,
  updateTextStyle,
} from '../commands/actions';

const PALETTE = [
  '#ffffff', '#f2f4f8', '#dfe4ec', '#b9c1d0', '#7d879a', '#44506b', '#10151f',
  '#e8f0fe', '#c5dbfd', '#2b5fd9', '#1a3f9a',
  '#e4f5ea', '#b6e3c8', '#1f7a4d', '#0f4f30',
  '#fdf1dc', '#f7dcae', '#a86a12', '#7a4a06',
  '#fbe6ea', '#f3c2cc', '#a8283f', '#75162a',
  '#f2e7fb', '#dcc4f2', '#7a3fb8',
];

type Updater = () => void;

export class Inspector {
  private readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private updaters: Updater[] = [];
  private lastSignature = '';

  constructor(
    private readonly store: Store,
    private readonly registry: CommandRegistry,
  ) {
    this.root = requireElement<HTMLElement>('inspector');
    this.body = el('div', { class: 'panel-body' });
  }

  mount(): void {
    clear(this.root);
    const toggle = el(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: 'Hide the inspector',
        'aria-label': 'Hide the inspector',
      },
      [icon('sidebar-right')],
    );
    toggle.addEventListener('click', () => this.registry.run('view.toggleInspector'));
    this.root.append(
      el('div', { class: 'panel-header' }, [
        el('h2', { id: 'inspector-title' }, ['Inspector']),
        el('div', { style: 'flex:1 1 auto' }),
        toggle,
      ]),
      this.body,
    );
    this.render();
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  /** Rebuild only when the selection changes shape; otherwise refresh values. */
  update(force = false): void {
    const signature = this.signature();
    if (force || signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.render();
      return;
    }
    this.sync();
  }

  private signature(): string {
    const doc = this.store.document;
    const kinds = this.store.selection
      .map((id) => doc.elements[id]?.kind ?? 'gone')
      .sort()
      .join(',');
    const shapeKeys = this.store.selection
      .map((id) => {
        const element = doc.elements[id];
        return isShape(element) ? element.shape : '';
      })
      .join(',');
    return `${this.store.selection.length}|${kinds}|${shapeKeys}`;
  }

  private sync(): void {
    const active = document.activeElement;
    for (const update of this.updaters) {
      try {
        update();
      } catch {
        // A stale updater after a delete is harmless.
      }
    }
    if (active instanceof HTMLElement && this.body.contains(active)) active.focus();
  }

  private render(): void {
    clear(this.body);
    this.updaters = [];
    const doc = this.store.document;
    const selection = [...new Set(this.store.selection.map((id) => rootOf(doc, id)))];
    const expanded = expandSelection(doc, selection);
    const shapes = expanded
      .map((id) => doc.elements[id])
      .filter((element): element is ShapeElement => isShape(element));
    const connectors = expanded
      .map((id) => doc.elements[id])
      .filter((element): element is ConnectorElement => isConnector(element));

    if (selection.length === 0) {
      this.renderDocumentSection();
      return;
    }

    this.body.append(this.arrangeSection());
    if (shapes.length > 0) {
      this.body.append(this.geometrySection(shapes));
      this.body.append(this.fillSection(shapes));
      this.body.append(this.borderSection(shapes));
    }
    if (connectors.length > 0) {
      this.body.append(this.connectorSection(connectors));
      this.body.append(this.labelSection(connectors));
    }
    if (shapes.length > 0 || connectors.length > 0) {
      this.body.append(this.textSection(shapes, connectors));
      this.body.append(this.presetSection());
    }
    this.sync();
  }

  // -------------------------------------------------------------------------
  // Section builders
  // -------------------------------------------------------------------------

  private section(title: string, content: Node[], open = true): HTMLElement {
    return el('details', { class: 'panel-section', open }, [
      el('summary', {}, [title]),
      el('div', { class: 'section-content' }, content),
    ]);
  }

  private renderDocumentSection(): void {
    const doc = this.store.document;

    const titleField = el('input', { type: 'text', value: doc.meta.title });
    titleField.addEventListener('change', () => {
      this.store.mutate('Rename Document', () => {
        this.store.document.meta.title = titleField.value.trim() || 'Untitled';
      });
    });

    const descriptionField = el('textarea', { rows: 3, placeholder: 'Used as the description in exported files.' });
    descriptionField.value = doc.meta.description;
    descriptionField.addEventListener('change', () => {
      this.store.mutate('Change Description', () => {
        this.store.document.meta.description = descriptionField.value;
      });
    });

    const gridSize = this.numberField(
      'Grid size',
      () => this.store.document.canvas.grid.size,
      (value) =>
        this.store.mutate('Change Grid', () => {
          this.store.document.canvas.grid.size = Math.max(1, value);
        }),
      { min: 1, max: 200, step: 1 },
    );

    const tolerance = this.numberField(
      'Snap range',
      () => this.store.document.canvas.snapTolerance,
      (value) =>
        this.store.mutate('Change Snap Range', () => {
          this.store.document.canvas.snapTolerance = Math.max(0, value);
        }),
      { min: 0, max: 40, step: 1 },
    );

    const orientation = this.selectField(
      'Page',
      [
        { value: 'landscape', label: 'Landscape' },
        { value: 'portrait', label: 'Portrait' },
      ],
      () => this.store.document.canvas.page.orientation,
      (value) =>
        this.store.mutate('Change Page Setup', () => {
          this.store.document.canvas.page.orientation = value as 'portrait' | 'landscape';
        }),
    );

    this.body.append(
      this.section('Document', [
        this.row('Title', titleField),
        el('div', { class: 'row-wide' }, [
          el('div', { class: 'field-label' }, ['Description']),
          descriptionField,
        ]),
      ]),
      this.section('Canvas', [
        gridSize,
        tolerance,
        orientation,
        this.checkboxRow(
          'Show grid',
          () => this.store.document.canvas.grid.visible,
          () => this.registry.run('view.toggleGrid'),
        ),
        this.checkboxRow(
          'Snap to grid',
          () => this.store.document.canvas.grid.snap,
          () => this.registry.run('view.toggleSnapGrid'),
        ),
        this.checkboxRow(
          'Snap to elements',
          () => this.store.document.canvas.snapToElement,
          () => this.registry.run('view.toggleSnapElement'),
        ),
        this.checkboxRow(
          'Show page boundaries',
          () => this.store.document.canvas.page.showBoundaries,
          () => this.registry.run('view.togglePageBoundaries'),
        ),
      ]),
      this.section('Diagram', [
        el('p', { class: 'field-label' }, [
          `${Object.keys(this.store.document.elements).length} elements on ${
            this.store.document.layers.length
          } layer${this.store.document.layers.length === 1 ? '' : 's'}.`,
        ]),
        el('p', { class: 'field-label' }, ['Select an element to edit its style.']),
      ]),
    );
    this.sync();
  }

  private geometrySection(shapes: readonly ShapeElement[]): HTMLElement {
    const first = shapes[0];
    const single = shapes.length === 1;

    const makeFrameField = (
      label: string,
      read: (shape: ShapeElement) => number,
      write: (shape: ShapeElement, value: number) => void,
    ): HTMLElement =>
      this.numberField(
        label,
        () => {
          const target = this.currentShapes()[0];
          return target ? Math.round(read(target)) : 0;
        },
        (value) => {
          for (const shape of this.currentShapes()) {
            const next = { ...shape.frame };
            write({ ...shape, frame: next } as ShapeElement, value);
            setFrame(this.store, shape.id, next, 'Change Size');
          }
        },
        { step: 1 },
      );

    const rotation = this.numberField(
      'Rotation',
      () => Math.round(this.currentShapes()[0]?.rotation ?? 0),
      (value) => setRotation(this.store, this.store.selection, ((value % 360) + 360) % 360),
      { min: -360, max: 360, step: 1 },
    );

    const autoSize = this.checkboxRow(
      'Auto-size to text',
      () => this.currentShapes()[0]?.autoSize ?? false,
      (checked) => {
        const ids = this.currentShapes().map((shape) => shape.id);
        this.store.mutate(
          'Change Auto-size',
          () => {
            for (const id of ids) {
              const element = this.store.document.elements[id];
              if (isShape(element)) element.autoSize = checked;
            }
          },
          { scope: ids },
        );
      },
    );

    return this.section('Position and Size', [
      el('div', { class: 'grid-2' }, [
        makeFrameField('X', (s) => s.frame.x, (s, v) => (s.frame.x = v)),
        makeFrameField('Y', (s) => s.frame.y, (s, v) => (s.frame.y = v)),
        makeFrameField('Width', (s) => s.frame.width, (s, v) => (s.frame.width = Math.max(8, v))),
        makeFrameField('Height', (s) => s.frame.height, (s, v) => (s.frame.height = Math.max(8, v))),
      ]),
      rotation,
      autoSize,
      single
        ? el('p', { class: 'field-label' }, [getShapeDefinition(first.shape).name])
        : el('p', { class: 'field-label' }, [`${shapes.length} shapes selected`]),
    ]);
  }

  private fillSection(shapes: readonly ShapeElement[]): HTMLElement {
    const gradientToggle = this.checkboxRow(
      'Gradient',
      () => !!this.currentShapes()[0]?.style.gradient,
      (checked) => {
        const base = this.currentShapes()[0]?.style;
        updateShapeStyle(
          this.store,
          {
            gradient: checked
              ? { from: base?.fill === 'none' ? '#ffffff' : base?.fill ?? '#ffffff', to: '#ffffff', angle: 90 }
              : null,
          },
          'Change Fill',
        );
      },
    );

    const gradientTo = this.colorRow(
      'To',
      () => this.currentShapes()[0]?.style.gradient?.to ?? '#ffffff',
      (value) => {
        const gradient = this.currentShapes()[0]?.style.gradient;
        if (!gradient) return;
        updateShapeStyle(this.store, { gradient: { ...gradient, to: value } }, 'Change Fill');
      },
      false,
    );

    return this.section('Fill', [
      this.colorRow(
        'Colour',
        () => this.currentShapes()[0]?.style.fill ?? '#ffffff',
        (value) => updateShapeStyle(this.store, { fill: value }, 'Change Fill'),
        true,
      ),
      this.sliderRow(
        'Opacity',
        () => (this.currentShapes()[0]?.style.fillOpacity ?? 1) * 100,
        (value) => updateShapeStyle(this.store, { fillOpacity: value / 100 }, 'Change Fill'),
      ),
      gradientToggle,
      gradientTo,
      this.checkboxRow(
        'Shadow',
        () => this.currentShapes()[0]?.style.shadow ?? false,
        (checked) => updateShapeStyle(this.store, { shadow: checked }, 'Change Shadow'),
      ),
      this.swatchRow((value) =>
        updateShapeStyle(this.store, { fill: value }, 'Change Fill'),
      ),
      el('p', { class: 'field-label' }, [`${shapes.length} shape${shapes.length === 1 ? '' : 's'}`]),
    ]);
  }

  private borderSection(_shapes: readonly ShapeElement[]): HTMLElement {
    return this.section('Border', [
      this.colorRow(
        'Colour',
        () => this.currentShapes()[0]?.style.stroke ?? '#000000',
        (value) => updateShapeStyle(this.store, { stroke: value }, 'Change Border'),
        true,
      ),
      this.numberField(
        'Thickness',
        () => this.currentShapes()[0]?.style.strokeWidth ?? 1,
        (value) => updateShapeStyle(this.store, { strokeWidth: Math.max(0, value) }, 'Change Border'),
        { min: 0, max: 40, step: 0.5 },
      ),
      this.selectField(
        'Style',
        [
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ],
        () => this.currentShapes()[0]?.style.strokeStyle ?? 'solid',
        (value) =>
          updateShapeStyle(
            this.store,
            { strokeStyle: value as ShapeStyle['strokeStyle'] },
            'Change Border',
          ),
      ),
      this.numberField(
        'Corners',
        () => this.currentShapes()[0]?.style.cornerRadius ?? 0,
        (value) =>
          updateShapeStyle(this.store, { cornerRadius: Math.max(0, value) }, 'Change Corners'),
        { min: 0, max: 200, step: 1 },
      ),
      this.sliderRow(
        'Opacity',
        () => (this.currentShapes()[0]?.style.opacity ?? 1) * 100,
        (value) => updateShapeStyle(this.store, { opacity: value / 100 }, 'Change Opacity'),
      ),
    ]);
  }

  private connectorSection(connectors: readonly ConnectorElement[]): HTMLElement {
    const markerOptions = MARKER_KINDS.map((kind) => ({
      value: kind,
      label: MARKER_LABELS[kind],
    }));

    return this.section('Connector', [
      this.selectField(
        'Type',
        [
          { value: 'straight', label: 'Straight' },
          { value: 'elbow', label: 'Elbow' },
          { value: 'curved', label: 'Curved' },
          { value: 'step', label: 'Step' },
          { value: 'freeform', label: 'Freeform' },
        ],
        () => this.currentConnectors()[0]?.connectorKind ?? 'elbow',
        (value) => setConnectorKind(this.store, value as ConnectorElement['connectorKind']),
      ),
      this.colorRow(
        'Colour',
        () => this.currentConnectors()[0]?.style.stroke ?? '#000000',
        (value) => updateConnectorStyle(this.store, { stroke: value }, 'Change Connector'),
        false,
      ),
      this.numberField(
        'Thickness',
        () => this.currentConnectors()[0]?.style.strokeWidth ?? 1,
        (value) =>
          updateConnectorStyle(
            this.store,
            { strokeWidth: Math.max(0.1, value) },
            'Change Connector',
          ),
        { min: 0.25, max: 30, step: 0.25 },
      ),
      this.selectField(
        'Line',
        [
          { value: 'solid', label: 'Solid' },
          { value: 'dashed', label: 'Dashed' },
          { value: 'dotted', label: 'Dotted' },
        ],
        () => this.currentConnectors()[0]?.style.strokeStyle ?? 'solid',
        (value) =>
          updateConnectorStyle(
            this.store,
            { strokeStyle: value as ShapeStyle['strokeStyle'] },
            'Change Connector',
          ),
      ),
      this.selectField(
        'Start',
        markerOptions,
        () => this.currentConnectors()[0]?.style.startMarker ?? 'none',
        (value) =>
          updateConnectorStyle(this.store, { startMarker: value as MarkerKind }, 'Change Endpoint'),
      ),
      this.selectField(
        'End',
        markerOptions,
        () => this.currentConnectors()[0]?.style.endMarker ?? 'filled-arrow',
        (value) =>
          updateConnectorStyle(this.store, { endMarker: value as MarkerKind }, 'Change Endpoint'),
      ),
      this.numberField(
        'Corners',
        () => this.currentConnectors()[0]?.style.cornerRadius ?? 0,
        (value) =>
          updateConnectorStyle(
            this.store,
            { cornerRadius: Math.max(0, value) },
            'Change Connector',
          ),
        { min: 0, max: 40, step: 1 },
      ),
      this.sliderRow(
        'Opacity',
        () => (this.currentConnectors()[0]?.style.opacity ?? 1) * 100,
        (value) => updateConnectorStyle(this.store, { opacity: value / 100 }, 'Change Connector'),
      ),
      this.checkboxRow(
        'Route around shapes',
        () => this.currentConnectors()[0]?.avoidShapes ?? false,
        (checked) => setConnectorRouting(this.store, { avoidShapes: checked }),
      ),
      this.checkboxRow(
        'Keep my bend points',
        () => this.currentConnectors()[0]?.routing === 'manual',
        (checked) => setConnectorRouting(this.store, { routing: checked ? 'manual' : 'dynamic' }),
      ),
      el('p', { class: 'field-label' }, [
        `${connectors.length} connector${connectors.length === 1 ? '' : 's'}`,
      ]),
    ]);
  }

  private labelSection(connectors: readonly ConnectorElement[]): HTMLElement {
    const content: Node[] = [];
    const connector = connectors[0];

    for (const label of connector.labels) {
      const field = el('input', { type: 'text', value: label.text, 'aria-label': 'Label text' });
      field.addEventListener('change', () => {
        updateConnectorLabel(this.store, connector.id, label.id, { text: field.value });
      });

      const position = el('input', {
        type: 'range',
        min: '0',
        max: '100',
        value: String(Math.round(label.position * 100)),
        'aria-label': 'Position along the connector',
      });
      position.addEventListener('input', () => {
        updateConnectorLabel(this.store, connector.id, label.id, {
          position: Number(position.value) / 100,
        });
      });

      const offset = el('input', {
        type: 'number',
        value: String(label.offset),
        step: '1',
        'aria-label': 'Offset from the line',
      });
      offset.addEventListener('change', () => {
        updateConnectorLabel(this.store, connector.id, label.id, {
          offset: Number(offset.value) || 0,
        });
      });

      const background = el('input', {
        type: 'checkbox',
        'aria-label': 'Label background',
      });
      background.checked = !!label.background;
      background.addEventListener('change', () => {
        updateConnectorLabel(this.store, connector.id, label.id, {
          background: background.checked ? '#ffffff' : null,
        });
      });

      const remove = el(
        'button',
        { class: 'icon-button', type: 'button', 'aria-label': 'Remove this label' },
        [icon('trash')],
      );
      remove.addEventListener('click', () =>
        removeConnectorLabel(this.store, connector.id, label.id),
      );

      content.push(
        el('div', { class: 'row-wide' }, [
          el('div', { class: 'row-inline' }, [field, remove]),
          el('div', { class: 'row-inline' }, [
            el('span', { class: 'field-label' }, ['Along']),
            position,
          ]),
          el('div', { class: 'row-inline' }, [
            el('span', { class: 'field-label' }, ['Offset']),
            offset,
            el('label', { class: 'row-inline' }, [background, ' Background']),
          ]),
        ]),
      );
    }

    const add = el('button', { class: 'button', type: 'button' }, ['Add label']);
    add.addEventListener('click', () => addConnectorLabel(this.store, connector.id));
    content.push(add);

    return this.section('Labels', content, connector.labels.length > 0);
  }

  private textSection(
    shapes: readonly ShapeElement[],
    connectors: readonly ConnectorElement[],
  ): HTMLElement {
    const readStyle = (): TextStyle => {
      const shape = this.currentShapes()[0];
      if (shape) return shape.text.style;
      const connector = this.currentConnectors()[0];
      return connector?.labels[0]?.style ?? defaultLabelTextStyle();
    };

    const toggle = (
      label: string,
      key: 'italic' | 'underline',
    ): HTMLElement =>
      this.checkboxRow(
        label,
        () => readStyle()[key],
        (checked) => updateTextStyle(this.store, { [key]: checked } as Partial<TextStyle>),
      );

    const alignRow = el('div', { class: 'row' }, [
      el('span', { class: 'row-label' }, ['Align']),
      this.segmented(
        [
          { value: 'left', label: 'Left', iconName: 'align-left' },
          { value: 'center', label: 'Centre', iconName: 'align-center-h' },
          { value: 'right', label: 'Right', iconName: 'align-right' },
        ],
        () => readStyle().align,
        (value) => updateTextStyle(this.store, { align: value as TextStyle['align'] }),
      ),
    ]);

    const verticalRow = el('div', { class: 'row' }, [
      el('span', { class: 'row-label' }, ['Vertical']),
      this.segmented(
        [
          { value: 'top', label: 'Top', iconName: 'align-top' },
          { value: 'middle', label: 'Middle', iconName: 'align-center-v' },
          { value: 'bottom', label: 'Bottom', iconName: 'align-bottom' },
        ],
        () => readStyle().verticalAlign,
        (value) =>
          updateTextStyle(this.store, { verticalAlign: value as TextStyle['verticalAlign'] }),
      ),
    ]);

    return this.section('Text', [
      this.selectField(
        'Font',
        FONT_FAMILIES.map((family) => ({ value: family, label: family })),
        () => readStyle().fontFamily,
        (value) => updateTextStyle(this.store, { fontFamily: value }),
      ),
      el('div', { class: 'grid-2' }, [
        this.numberField(
          'Size',
          () => readStyle().fontSize,
          (value) => updateTextStyle(this.store, { fontSize: Math.max(4, value) }),
          { min: 4, max: 200, step: 1 },
        ),
        this.selectField(
          'Weight',
          [
            { value: '400', label: 'Regular' },
            { value: '500', label: 'Medium' },
            { value: '600', label: 'Semibold' },
            { value: '700', label: 'Bold' },
          ],
          () => String(readStyle().fontWeight),
          (value) => updateTextStyle(this.store, { fontWeight: Number(value) }),
        ),
      ]),
      toggle('Italic', 'italic'),
      toggle('Underline', 'underline'),
      this.colorRow(
        'Colour',
        () => readStyle().color,
        (value) => updateTextStyle(this.store, { color: value }),
        false,
      ),
      alignRow,
      verticalRow,
      this.numberField(
        'Line height',
        () => readStyle().lineHeight,
        (value) => updateTextStyle(this.store, { lineHeight: Math.max(0.8, value) }),
        { min: 0.8, max: 4, step: 0.05 },
      ),
      this.checkboxRow(
        'Wrap text',
        () => readStyle().wrap,
        (checked) => updateTextStyle(this.store, { wrap: checked }),
      ),
      shapes.length > 0
        ? this.numberField(
            'Padding',
            () => this.currentShapes()[0]?.text.padding ?? 8,
            (value) => {
              const ids = this.currentShapes().map((shape) => shape.id);
              this.store.mutate(
                'Change Padding',
                () => {
                  for (const id of ids) {
                    const element = this.store.document.elements[id];
                    if (isShape(element)) element.text.padding = Math.max(0, value);
                  }
                },
                { scope: ids },
              );
            },
            { min: 0, max: 80, step: 1 },
          )
        : el('span', { hidden: true }),
      connectors.length > 0
        ? el('p', { class: 'field-label' }, ['Text settings apply to connector labels too.'])
        : el('span', { hidden: true }),
    ]);
  }

  private presetSection(): HTMLElement {
    const row = el('div', { class: 'preset-row' });
    for (const preset of this.store.document.presets) {
      const chip = el('button', { class: 'preset-chip', type: 'button' }, [
        el('span', {
          class: 'dot',
          style: `background:${preset.shape.fill ?? 'transparent'};border-color:${
            preset.shape.stroke ?? 'currentColor'
          }`,
        }),
        preset.name,
      ]);
      chip.addEventListener('click', () => applyPreset(this.store, preset.id));
      row.append(chip);
    }
    const reset = el('button', { class: 'button', type: 'button' }, ['Reset to default style']);
    reset.addEventListener('click', () => this.registry.run('format.resetStyle'));
    return this.section('Style Presets', [row, reset]);
  }

  private arrangeSection(): HTMLElement {
    const makeGrid = (entries: Array<{ command: string; iconName: string; label: string }>) => {
      const grid = el('div', { class: 'button-grid' });
      for (const entry of entries) {
        const button = el(
          'button',
          {
            class: 'icon-button',
            type: 'button',
            title: entry.label,
            'aria-label': entry.label,
          },
          [icon(entry.iconName)],
        );
        button.addEventListener('click', () => this.registry.run(entry.command));
        this.updaters.push(() => {
          button.disabled = !this.registry.isEnabled(entry.command);
        });
        grid.append(button);
      }
      return grid;
    };

    return this.section('Arrange', [
      makeGrid([
        { command: 'arrange.alignLeft', iconName: 'align-left', label: 'Align Left' },
        { command: 'arrange.alignCenterH', iconName: 'align-center-h', label: 'Align Centre' },
        { command: 'arrange.alignRight', iconName: 'align-right', label: 'Align Right' },
        { command: 'arrange.alignTop', iconName: 'align-top', label: 'Align Top' },
        { command: 'arrange.alignCenterV', iconName: 'align-center-v', label: 'Align Middle' },
        { command: 'arrange.alignBottom', iconName: 'align-bottom', label: 'Align Bottom' },
      ]),
      makeGrid([
        { command: 'arrange.distributeH', iconName: 'distribute-h', label: 'Distribute Horizontally' },
        { command: 'arrange.distributeV', iconName: 'distribute-v', label: 'Distribute Vertically' },
        { command: 'arrange.group', iconName: 'group', label: 'Group' },
        { command: 'arrange.ungroup', iconName: 'ungroup', label: 'Ungroup' },
        { command: 'arrange.lock', iconName: 'lock', label: 'Lock' },
        { command: 'arrange.unlock', iconName: 'unlock', label: 'Unlock' },
      ]),
      makeGrid([
        { command: 'arrange.bringToFront', iconName: 'front', label: 'Bring to Front' },
        { command: 'arrange.bringForward', iconName: 'front', label: 'Bring Forward' },
        { command: 'arrange.sendBackward', iconName: 'back', label: 'Send Backward' },
        { command: 'arrange.sendToBack', iconName: 'back', label: 'Send to Back' },
        { command: 'arrange.sameWidth', iconName: 'distribute-h', label: 'Make Same Width' },
        { command: 'arrange.sameHeight', iconName: 'distribute-v', label: 'Make Same Height' },
      ]),
    ]);
  }

  // -------------------------------------------------------------------------
  // Field builders
  // -------------------------------------------------------------------------

  private currentShapes(): ShapeElement[] {
    const doc = this.store.document;
    return expandSelection(doc, this.store.selection)
      .map((id) => doc.elements[id])
      .filter((element): element is ShapeElement => isShape(element));
  }

  private currentConnectors(): ConnectorElement[] {
    const doc = this.store.document;
    return expandSelection(doc, this.store.selection)
      .map((id) => doc.elements[id])
      .filter((element): element is ConnectorElement => isConnector(element));
  }

  private row(label: string, control: HTMLElement): HTMLElement {
    const id = `field-${Math.random().toString(36).slice(2, 8)}`;
    control.id = id;
    return el('div', { class: 'row' }, [el('label', { for: id }, [label]), control]);
  }

  private numberField(
    label: string,
    read: () => number,
    write: (value: number) => void,
    options: { min?: number; max?: number; step?: number } = {},
  ): HTMLElement {
    const input = el('input', {
      type: 'number',
      min: options.min,
      max: options.max,
      step: options.step ?? 1,
    });
    input.addEventListener('change', () => {
      const value = Number(input.value);
      if (Number.isFinite(value)) write(value);
    });
    this.updaters.push(() => {
      if (document.activeElement === input) return;
      const value = read();
      const text = String(Math.round(value * 100) / 100);
      if (input.value !== text) input.value = text;
    });
    return this.row(label, input);
  }

  private selectField(
    label: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    read: () => string,
    write: (value: string) => void,
  ): HTMLElement {
    const select = el(
      'select',
      {},
      options.map((option) => el('option', { value: option.value }, [option.label])),
    );
    select.addEventListener('change', () => write(select.value));
    this.updaters.push(() => {
      const value = read();
      if (select.value !== value) select.value = value;
    });
    return this.row(label, select);
  }

  private colorRow(
    label: string,
    read: () => string,
    write: (value: string) => void,
    allowNone: boolean,
  ): HTMLElement {
    const input = el('input', { type: 'color', 'aria-label': `${label} colour` });
    input.addEventListener('input', () => write(input.value));
    const controls: Node[] = [input];
    if (allowNone) {
      const none = el(
        'button',
        { class: 'swatch none', type: 'button', title: 'No fill', 'aria-label': 'No fill' },
        [],
      );
      none.addEventListener('click', () => write('none'));
      controls.push(none);
    }
    this.updaters.push(() => {
      const value = read();
      if (value !== 'none' && /^#[0-9a-f]{6}$/i.test(value) && input.value !== value) {
        input.value = value;
      }
    });
    return el('div', { class: 'row' }, [
      el('span', { class: 'row-label' }, [label]),
      el('div', { class: 'row-inline' }, controls),
    ]);
  }

  private swatchRow(write: (value: string) => void): HTMLElement {
    const row = el('div', { class: 'swatch-row' });
    for (const color of PALETTE) {
      const swatch = el('button', {
        class: 'swatch',
        type: 'button',
        style: `background:${color}`,
        title: color,
        'aria-label': `Set the colour to ${color}`,
      });
      swatch.addEventListener('click', () => write(color));
      row.append(swatch);
    }
    return row;
  }

  private sliderRow(
    label: string,
    read: () => number,
    write: (value: number) => void,
  ): HTMLElement {
    const input = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      'aria-label': label,
    });
    input.addEventListener('input', () => write(Number(input.value)));
    this.updaters.push(() => {
      if (document.activeElement === input) return;
      input.value = String(Math.round(read()));
    });
    return el('div', { class: 'row' }, [el('span', { class: 'row-label' }, [label]), input]);
  }

  private checkboxRow(
    label: string,
    read: () => boolean,
    write: (checked: boolean) => void,
  ): HTMLElement {
    const input = el('input', { type: 'checkbox' });
    input.addEventListener('change', () => write(input.checked));
    this.updaters.push(() => {
      input.checked = read();
    });
    return el('label', { class: 'row-inline' }, [input, el('span', {}, [label])]);
  }

  private segmented(
    options: ReadonlyArray<{ value: string; label: string; iconName: string }>,
    read: () => string,
    write: (value: string) => void,
  ): HTMLElement {
    const group = el('div', { class: 'segmented', role: 'group' });
    const buttons: Array<{ value: string; node: HTMLButtonElement }> = [];
    for (const option of options) {
      const button = el(
        'button',
        { type: 'button', title: option.label, 'aria-label': option.label },
        [icon(option.iconName)],
      );
      button.addEventListener('click', () => write(option.value));
      buttons.push({ value: option.value, node: button });
      group.append(button);
    }
    this.updaters.push(() => {
      const value = read();
      for (const entry of buttons) {
        entry.node.setAttribute('aria-pressed', entry.value === value ? 'true' : 'false');
      }
    });
    return group;
  }
}
