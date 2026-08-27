/**
 * The unified title bar and toolbar.
 *
 * Every toolbar control runs a registered command, which is what keeps the
 * brief's rule true: nothing is reachable from the toolbar that is not also in
 * the menu bar and therefore on the keyboard.
 */

import { clear, el, requireElement } from '../util/dom';
import { icon } from './icons';
import type { CommandRegistry } from '../commands/registry';
import type { Store, ToolId } from '../state/store';
import { formatAccelerator } from '../commands/registry';

interface ToolbarButton {
  command: string;
  iconName: string;
  label: string;
}

const TOOL_BUTTONS: Array<{ tool: ToolId; iconName: string; label: string; command: string }> = [
  { tool: 'select', iconName: 'select', label: 'Select', command: 'tool.select' },
  { tool: 'shape', iconName: 'shape', label: 'Shape', command: 'tool.shape' },
  { tool: 'connector', iconName: 'connector', label: 'Connector', command: 'tool.connector' },
  { tool: 'text', iconName: 'text', label: 'Text', command: 'tool.text' },
];

const ALIGN_BUTTONS: ToolbarButton[] = [
  { command: 'arrange.alignLeft', iconName: 'align-left', label: 'Align Left' },
  { command: 'arrange.alignCenterH', iconName: 'align-center-h', label: 'Align Centre' },
  { command: 'arrange.alignRight', iconName: 'align-right', label: 'Align Right' },
  { command: 'arrange.alignTop', iconName: 'align-top', label: 'Align Top' },
  { command: 'arrange.alignCenterV', iconName: 'align-center-v', label: 'Align Middle' },
  { command: 'arrange.alignBottom', iconName: 'align-bottom', label: 'Align Bottom' },
];

const ARRANGE_BUTTONS: ToolbarButton[] = [
  { command: 'arrange.distributeH', iconName: 'distribute-h', label: 'Distribute Horizontally' },
  { command: 'arrange.distributeV', iconName: 'distribute-v', label: 'Distribute Vertically' },
  { command: 'arrange.group', iconName: 'group', label: 'Group' },
  { command: 'arrange.ungroup', iconName: 'ungroup', label: 'Ungroup' },
];

export class Toolbar {
  private readonly root: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();
  private toolButtons = new Map<ToolId, HTMLButtonElement>();
  private titleNode: HTMLElement | null = null;
  private subtitleNode: HTMLElement | null = null;

  constructor(
    private readonly store: Store,
    private readonly registry: CommandRegistry,
  ) {
    this.root = requireElement<HTMLElement>('toolbar');
  }

  mount(): void {
    clear(this.root);
    this.buttons.clear();
    this.toolButtons.clear();

    const tools = el('div', { class: 'toolbar-group', role: 'radiogroup', 'aria-label': 'Tools' });
    for (const entry of TOOL_BUTTONS) {
      const button = this.makeButton(entry.command, entry.iconName, entry.label, 'radio');
      this.toolButtons.set(entry.tool, button);
      tools.append(button);
    }

    const history = el('div', { class: 'toolbar-group' }, [
      this.makeButton('edit.undo', 'undo', 'Undo'),
      this.makeButton('edit.redo', 'redo', 'Redo'),
    ]);

    const align = el('div', { class: 'toolbar-group', 'aria-label': 'Align and distribute' });
    for (const entry of ALIGN_BUTTONS) {
      align.append(this.makeButton(entry.command, entry.iconName, entry.label));
    }

    const arrange = el('div', { class: 'toolbar-group' });
    for (const entry of ARRANGE_BUTTONS) {
      arrange.append(this.makeButton(entry.command, entry.iconName, entry.label));
    }

    const output = el('div', { class: 'toolbar-group' }, [
      this.makeButton('file.export', 'export', 'Export'),
      this.makeButton('file.print', 'print', 'Print'),
    ]);

    const panels = el('div', { class: 'toolbar-group' }, [
      this.makeButton('view.toggleSidebar', 'sidebar-left', 'Shape Library'),
      this.makeButton('view.toggleInspector', 'sidebar-right', 'Inspector'),
    ]);

    this.titleNode = el('strong', {}, ['Untitled']);
    this.subtitleNode = el('span', {}, ['']);
    const title = el('div', { class: 'toolbar-title' }, [this.titleNode, this.subtitleNode]);

    this.root.append(
      tools,
      history,
      el('div', { class: 'toolbar-spacer' }),
      title,
      el('div', { class: 'toolbar-spacer' }),
      align,
      arrange,
      output,
      panels,
    );
    this.sync();
  }

  private makeButton(
    commandId: string,
    iconName: string,
    label: string,
    role?: string,
  ): HTMLButtonElement {
    const command = this.registry.get(commandId);
    const hint = command?.accelerator
      ? `${label} (${formatAccelerator(command.accelerator)})`
      : label;
    const button = el(
      'button',
      {
        class: 'icon-button',
        type: 'button',
        title: hint,
        'aria-label': label,
        role,
        'data-command': commandId,
      },
      [icon(iconName)],
    );
    button.addEventListener('click', () => this.registry.run(commandId));
    this.buttons.set(commandId, button);
    return button;
  }

  sync(): void {
    const state = this.store.getState();
    for (const [commandId, button] of this.buttons) {
      button.disabled = !this.registry.isEnabled(commandId);
      if (this.registry.get(commandId)?.isChecked) {
        button.setAttribute('aria-pressed', this.registry.isChecked(commandId) ? 'true' : 'false');
      }
    }
    for (const [tool, button] of this.toolButtons) {
      const active = state.tool === tool;
      button.setAttribute('aria-checked', active ? 'true' : 'false');
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
    if (this.titleNode) this.titleNode.textContent = state.document.meta.title || 'Untitled';
    if (this.subtitleNode) {
      const parts: string[] = [];
      if (state.file.dirty) parts.push('Edited');
      const count = state.selection.length;
      if (count === 1) parts.push('1 element selected');
      else if (count > 1) parts.push(`${count} elements selected`);
      this.subtitleNode.textContent = parts.join(' · ');
    }
  }
}
