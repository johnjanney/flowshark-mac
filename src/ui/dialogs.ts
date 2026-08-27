/**
 * Modal sheets: the template chooser, export options, settings, the shortcut
 * reference, and Find.
 *
 * Each sheet traps focus while it is open, restores focus to whatever had it
 * before, and closes on Escape — the behaviour a Mac user expects from a sheet.
 */

import { clear, el, requireElement } from '../util/dom';
import { formatAccelerator, type CommandRegistry } from '../commands/registry';
import { CANVAS_MODIFIERS, SHORTCUT_GROUPS } from './menus';
import { TEMPLATES, type TemplateDefinition } from '../templates';
import { buildScene } from '../canvas/scene';
import { documentBounds } from '../model/document';
import { defaultExportOptions, type ExportOptions, type ExportScope } from '../io/export';
import type { Preferences, Store } from '../state/store';
import { APP_VERSION } from '../model/defaults';

const layer = (): HTMLElement => requireElement<HTMLElement>('dialog-layer');

interface DialogOptions {
  title: string;
  description?: string;
  body: Node[];
  footer: Node[];
  narrow?: boolean;
}

let closeCurrent: (() => void) | null = null;

export function isDialogOpen(): boolean {
  return closeCurrent !== null;
}

export function closeDialog(): void {
  closeCurrent?.();
}

function openDialog(options: DialogOptions): void {
  closeDialog();
  const host = layer();
  const previousFocus = document.activeElement as HTMLElement | null;

  const dialog = el(
    'div',
    {
      class: `dialog${options.narrow ? ' narrow' : ''}`,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': options.title,
    },
    [
      el('div', { class: 'dialog-header' }, [
        el('h2', {}, [options.title]),
        options.description ? el('p', {}, [options.description]) : null,
      ]),
      el('div', { class: 'dialog-body' }, options.body),
      el('div', { class: 'dialog-footer' }, options.footer),
    ],
  );

  clear(host);
  host.append(dialog);
  host.classList.add('open');

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Keep Tab inside the sheet.
    const focusable = dialog.querySelectorAll<HTMLElement>(
      'button, input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onBackdrop = (event: MouseEvent): void => {
    if (event.target === host) close();
  };

  function close(): void {
    host.classList.remove('open');
    clear(host);
    window.removeEventListener('keydown', onKey, true);
    host.removeEventListener('mousedown', onBackdrop);
    closeCurrent = null;
    previousFocus?.focus?.();
  }

  closeCurrent = close;
  window.addEventListener('keydown', onKey, true);
  host.addEventListener('mousedown', onBackdrop);

  const firstField = dialog.querySelector<HTMLElement>(
    'input, select, textarea, button.primary, button',
  );
  firstField?.focus();
}

function button(label: string, onClick: () => void, primary = false): HTMLButtonElement {
  const node = el('button', { class: `button${primary ? ' primary' : ''}`, type: 'button' }, [
    label,
  ]);
  node.addEventListener('click', onClick);
  return node;
}

// ---------------------------------------------------------------------------
// Template chooser
// ---------------------------------------------------------------------------

function templatePreview(template: TemplateDefinition): SVGSVGElement {
  const doc = template.build();
  const scene = buildScene(doc, {
    theme: {
      background: null,
      gridLine: 'transparent',
      gridLineStrong: 'transparent',
      pageBoundary: 'transparent',
    },
    showGrid: false,
    showPageBoundaries: false,
    interactive: false,
    accessible: false,
  });
  const bounds = documentBounds(doc) ?? { x: 0, y: 0, width: 200, height: 120 };
  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  node.setAttribute(
    'viewBox',
    `${bounds.x - 12} ${bounds.y - 12} ${bounds.width + 24} ${bounds.height + 24}`,
  );
  node.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  node.setAttribute('aria-hidden', 'true');
  node.innerHTML = `<defs>${scene.defs}</defs>${scene.body}`;
  return node;
}

export function showTemplateChooser(onChoose: (template: TemplateDefinition) => void): void {
  let selected: TemplateDefinition = TEMPLATES[1] ?? TEMPLATES[0];
  const grid = el('div', { class: 'template-grid' });

  const cards = new Map<string, HTMLButtonElement>();
  for (const template of TEMPLATES) {
    const card = el('button', { class: 'template-card', type: 'button' }, [
      el('div', { class: 'preview' }, [templatePreview(template)]),
      el('strong', {}, [template.name]),
      el('span', {}, [template.description]),
    ]);
    card.addEventListener('click', () => {
      selected = template;
      for (const [, node] of cards) node.setAttribute('aria-pressed', 'false');
      card.setAttribute('aria-pressed', 'true');
    });
    card.addEventListener('dblclick', () => {
      closeDialog();
      onChoose(template);
    });
    cards.set(template.id, card);
    grid.append(card);
  }
  cards.get(selected.id)?.setAttribute('aria-pressed', 'true');

  openDialog({
    title: 'Choose a Template',
    description: 'Every template opens as an ordinary document that you can change.',
    body: [grid],
    footer: [
      el('div', { class: 'spacer' }),
      button('Cancel', () => closeDialog()),
      button(
        'Create',
        () => {
          closeDialog();
          onChoose(selected);
        },
        true,
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type ExportFormat = 'png' | 'svg' | 'pdf' | 'jpeg' | 'webp';

export interface ExportRequest extends ExportOptions {
  format: ExportFormat;
}

export function showExportDialog(
  store: Store,
  initialFormat: ExportFormat,
  onExport: (request: ExportRequest) => void,
): void {
  const preferences = store.getState().preferences;
  const options: ExportRequest = {
    ...defaultExportOptions(),
    scale: preferences.exportScale,
    format: initialFormat,
  };
  const hasSelection = store.selection.length > 0;

  const formatSelect = el(
    'select',
    { 'aria-label': 'Format' },
    [
      { value: 'png', label: 'PNG image' },
      { value: 'svg', label: 'SVG vector' },
      { value: 'pdf', label: 'PDF document' },
      { value: 'jpeg', label: 'JPEG image' },
      { value: 'webp', label: 'WebP image' },
    ].map((entry) => el('option', { value: entry.value }, [entry.label])),
  );
  formatSelect.value = initialFormat;

  const scopeSelect = el(
    'select',
    { 'aria-label': 'What to export' },
    [
      { value: 'document', label: 'Whole diagram' },
      { value: 'selection', label: 'Selected elements' },
      { value: 'page', label: 'Page area' },
    ].map((entry) =>
      el(
        'option',
        { value: entry.value, disabled: entry.value === 'selection' && !hasSelection },
        [entry.label],
      ),
    ),
  );
  scopeSelect.value = hasSelection ? 'selection' : 'document';
  options.scope = scopeSelect.value as ExportScope;

  const scaleSelect = el(
    'select',
    { 'aria-label': 'Resolution' },
    [
      { value: '1', label: '1x — 72 dpi' },
      { value: '2', label: '2x — Retina' },
      { value: '3', label: '3x — high resolution' },
    ].map((entry) => el('option', { value: entry.value }, [entry.label])),
  );
  scaleSelect.value = String(options.scale);

  const transparent = el('input', { type: 'checkbox' });
  const grid = el('input', { type: 'checkbox' });
  const margin = el('input', { type: 'number', value: '24', min: '0', max: '400', step: '4' });
  const background = el('input', { type: 'color', value: '#ffffff' });

  const rasterNote = el('p', { class: 'field-label' }, ['']);

  const refresh = (): void => {
    const format = formatSelect.value as ExportFormat;
    const raster = format === 'png' || format === 'jpeg' || format === 'webp';
    scaleSelect.disabled = !raster && format !== 'pdf';
    transparent.disabled = format === 'jpeg' || format === 'pdf';
    if (transparent.disabled) transparent.checked = false;
    background.disabled = transparent.checked;
    rasterNote.textContent =
      format === 'pdf'
        ? 'PDF is exported as vector art with selectable text. Diagrams that use non-Western text or an embedded picture are exported as a picture instead, and FlowShark will tell you when that happens.'
        : format === 'svg'
          ? 'SVG is a self-contained vector file with no scripts and no external references.'
          : `The image is written at ${scaleSelect.value}x the on-screen size.`;
  };

  formatSelect.addEventListener('change', refresh);
  scaleSelect.addEventListener('change', refresh);
  transparent.addEventListener('change', refresh);
  refresh();

  const row = (label: string, control: Node, hint?: string): HTMLElement =>
    el('div', { class: 'row-wide' }, [
      el('div', { class: 'field-label' }, [label]),
      control,
      hint ? el('div', { class: 'field-label' }, [hint]) : null,
    ]);

  openDialog({
    title: 'Export',
    description: 'Choose a format and what part of the diagram to write.',
    narrow: true,
    body: [
      row('Format', formatSelect),
      row('Include', scopeSelect),
      row('Resolution', scaleSelect),
      row('Margin (points)', margin),
      el('label', { class: 'row-inline' }, [transparent, el('span', {}, ['Transparent background'])]),
      el('label', { class: 'row-inline' }, [grid, el('span', {}, ['Include the grid'])]),
      row('Background colour', background),
      rasterNote,
    ],
    footer: [
      el('div', { class: 'spacer' }),
      button('Cancel', () => closeDialog()),
      button(
        'Export…',
        () => {
          const request: ExportRequest = {
            format: formatSelect.value as ExportFormat,
            scope: scopeSelect.value as ExportScope,
            scale: Number(scaleSelect.value) || 2,
            margin: Number(margin.value) || 0,
            transparent: transparent.checked,
            includeGrid: grid.checked,
            background: background.value,
          };
          store.setPreferences({ exportScale: (request.scale as 1 | 2 | 3) ?? 2 });
          closeDialog();
          onExport(request);
        },
        true,
      ),
    ],
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function showSettings(store: Store, onChange: (patch: Partial<Preferences>) => void): void {
  const preferences = store.getState().preferences;

  const appearance = el(
    'select',
    { 'aria-label': 'Appearance' },
    [
      { value: 'system', label: 'Match the system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' },
    ].map((entry) => el('option', { value: entry.value }, [entry.label])),
  );
  appearance.value = preferences.appearance;
  appearance.addEventListener('change', () =>
    onChange({ appearance: appearance.value as Preferences['appearance'] }),
  );

  const motion = el(
    'select',
    { 'aria-label': 'Motion' },
    [
      { value: 'system', label: 'Match the system' },
      { value: 'always', label: 'Always reduce motion' },
    ].map((entry) => el('option', { value: entry.value }, [entry.label])),
  );
  motion.value = preferences.reduceMotion;
  motion.addEventListener('change', () =>
    onChange({ reduceMotion: motion.value as Preferences['reduceMotion'] }),
  );

  const autoSave = el('input', { type: 'checkbox' });
  autoSave.checked = preferences.autoSave;
  autoSave.addEventListener('change', () => onChange({ autoSave: autoSave.checked }));

  const interval = el('input', {
    type: 'number',
    min: '5',
    max: '600',
    step: '5',
    value: String(preferences.autoSaveIntervalSeconds),
  });
  interval.addEventListener('change', () =>
    onChange({ autoSaveIntervalSeconds: Math.max(5, Number(interval.value) || 30) }),
  );

  const welcome = el('input', { type: 'checkbox' });
  welcome.checked = preferences.showWelcomeOnLaunch;
  welcome.addEventListener('change', () =>
    onChange({ showWelcomeOnLaunch: welcome.checked }),
  );

  const connector = el(
    'select',
    { 'aria-label': 'Default connector' },
    [
      { value: 'elbow', label: 'Elbow' },
      { value: 'straight', label: 'Straight' },
      { value: 'curved', label: 'Curved' },
      { value: 'step', label: 'Step' },
    ].map((entry) => el('option', { value: entry.value }, [entry.label])),
  );
  connector.value = preferences.defaultConnectorKind;
  connector.addEventListener('change', () =>
    onChange({
      defaultConnectorKind: connector.value as Preferences['defaultConnectorKind'],
    }),
  );

  const row = (label: string, control: Node): HTMLElement =>
    el('div', { class: 'row' }, [el('span', { class: 'row-label' }, [label]), control]);

  openDialog({
    title: 'Settings',
    narrow: true,
    body: [
      row('Appearance', appearance),
      row('Motion', motion),
      row('Connector', connector),
      el('label', { class: 'row-inline' }, [
        autoSave,
        el('span', {}, ['Save automatically while I work']),
      ]),
      row('Every (seconds)', interval),
      el('label', { class: 'row-inline' }, [
        welcome,
        el('span', {}, ['Show the template chooser at launch']),
      ]),
      el('p', { class: 'field-label' }, [
        'FlowShark collects no analytics and sends nothing off this Mac.',
      ]),
    ],
    footer: [el('div', { class: 'spacer' }), button('Done', () => closeDialog(), true)],
  });
}

// ---------------------------------------------------------------------------
// Shortcuts and About
// ---------------------------------------------------------------------------

export function showShortcutReference(registry: CommandRegistry): void {
  const columns = el('div', { class: 'shortcut-columns' });

  for (const group of SHORTCUT_GROUPS) {
    const list = el('dl');
    for (const commandId of group.commands) {
      const command = registry.get(commandId);
      if (!command?.accelerator) continue;
      list.append(
        el('dt', {}, [command.title]),
        el('dd', {}, [formatAccelerator(command.accelerator)]),
      );
    }
    columns.append(el('div', { class: 'shortcut-group' }, [el('h3', {}, [group.title]), list]));
  }

  const canvas = el('dl');
  for (const entry of CANVAS_MODIFIERS) {
    canvas.append(el('dt', {}, [entry.action]), el('dd', {}, [entry.keys]));
  }
  columns.append(
    el('div', { class: 'shortcut-group' }, [el('h3', {}, ['Canvas']), canvas]),
  );

  openDialog({
    title: 'Keyboard Shortcuts',
    description: 'Every command is also available from the menu bar.',
    body: [columns],
    footer: [el('div', { class: 'spacer' }), button('Done', () => closeDialog(), true)],
  });
}

export function showAbout(): void {
  openDialog({
    title: 'FlowShark',
    narrow: true,
    body: [
      el('p', {}, [`Version ${APP_VERSION}`]),
      el('p', {}, [
        'A flowchart editor for macOS. Diagrams are stored on this Mac in the ' +
          '.flowshark format, which is plain JSON with a versioned schema.',
      ]),
      el('p', { class: 'field-label' }, [
        'No analytics. No cloud services. Nothing leaves this Mac.',
      ]),
    ],
    footer: [el('div', { class: 'spacer' }), button('Done', () => closeDialog(), true)],
  });
}

// ---------------------------------------------------------------------------
// Find
// ---------------------------------------------------------------------------

export function showFind(store: Store, onSelect: (ids: string[]) => void): void {
  const field = el('input', {
    type: 'search',
    placeholder: 'Find text in the diagram',
    'aria-label': 'Find text',
  });
  const results = el('div', { class: 'row-wide' });

  const search = (): void => {
    clear(results);
    const query = field.value.trim().toLowerCase();
    if (!query) return;
    const doc = store.document;
    const matches: Array<{ id: string; label: string }> = [];
    for (const id of doc.order) {
      const element = doc.elements[id];
      if (!element) continue;
      if (element.kind === 'shape' && element.text.value.toLowerCase().includes(query)) {
        matches.push({ id, label: element.text.value.replace(/\s+/g, ' ').slice(0, 70) });
      } else if (element.kind === 'connector') {
        for (const label of element.labels) {
          if (label.text.toLowerCase().includes(query)) {
            matches.push({ id, label: `Connector: ${label.text}` });
            break;
          }
        }
      }
    }
    if (matches.length === 0) {
      results.append(el('p', { class: 'field-label' }, ['Nothing matches.']));
      return;
    }
    results.append(
      el('p', { class: 'field-label' }, [
        `${matches.length} match${matches.length === 1 ? '' : 'es'}`,
      ]),
    );
    for (const match of matches) {
      const entry = el('button', { class: 'button', type: 'button' }, [match.label]);
      entry.addEventListener('click', () => {
        onSelect([match.id]);
      });
      results.append(entry);
    }
  };

  field.addEventListener('input', search);

  openDialog({
    title: 'Find',
    narrow: true,
    body: [field, results],
    footer: [
      el('div', { class: 'spacer' }),
      button('Done', () => closeDialog(), true),
    ],
  });
}
