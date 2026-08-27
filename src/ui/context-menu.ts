/**
 * Right-click and Control-click menus.
 *
 * The entries are the same commands the menu bar uses, so a context menu can
 * never offer something the keyboard cannot reach.
 */

import { el, requireElement } from '../util/dom';
import { formatAccelerator, type CommandRegistry } from '../commands/registry';

export interface ContextMenuEntry {
  command?: string;
  separator?: boolean;
}

export class ContextMenu {
  private node: HTMLElement | null = null;
  private readonly layer: HTMLElement;

  constructor(private readonly registry: CommandRegistry) {
    this.layer = requireElement<HTMLElement>('dialog-layer').parentElement as HTMLElement;
  }

  show(x: number, y: number, entries: readonly ContextMenuEntry[]): void {
    this.hide();
    const menu = el('div', { class: 'context-menu', role: 'menu' });

    for (const entry of entries) {
      if (entry.separator) {
        menu.append(el('hr'));
        continue;
      }
      if (!entry.command) continue;
      const command = this.registry.get(entry.command);
      if (!command) continue;
      const button = el('button', { type: 'button', role: 'menuitem' }, [
        el('span', {}, [command.title]),
        command.accelerator
          ? el('span', { class: 'shortcut' }, [formatAccelerator(command.accelerator)])
          : null,
      ]);
      button.disabled = !this.registry.isEnabled(command.id);
      button.addEventListener('click', () => {
        this.hide();
        this.registry.run(command.id);
      });
      menu.append(button);
    }

    this.node = menu;
    this.layer.append(menu);

    // Keep the menu inside the window.
    const rect = menu.getBoundingClientRect();
    const left = Math.min(x, window.innerWidth - rect.width - 8);
    const top = Math.min(y, window.innerHeight - rect.height - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    setTimeout(() => {
      window.addEventListener('pointerdown', this.onDismiss, { once: true });
      window.addEventListener('keydown', this.onKey);
    }, 0);
  }

  hide(): void {
    if (!this.node) return;
    this.node.remove();
    this.node = null;
    window.removeEventListener('keydown', this.onKey);
  }

  private onDismiss = (): void => this.hide();

  private onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.hide();
  };
}

export function contextMenuFor(kind: string | null): ContextMenuEntry[] {
  if (kind === 'connector' || kind === 'label') {
    return [
      { command: 'edit.cut' },
      { command: 'edit.copy' },
      { command: 'edit.duplicate' },
      { command: 'edit.delete' },
      { separator: true },
      { command: 'insert.connectorLabel' },
      { command: 'connector.addBendPoint' },
      { command: 'connector.clearBendPoints' },
      { separator: true },
      { command: 'edit.copyStyle' },
      { command: 'edit.pasteStyle' },
    ];
  }
  if (kind) {
    return [
      { command: 'edit.cut' },
      { command: 'edit.copy' },
      { command: 'edit.duplicate' },
      { command: 'edit.delete' },
      { separator: true },
      { command: 'arrange.bringToFront' },
      { command: 'arrange.sendToBack' },
      { separator: true },
      { command: 'arrange.group' },
      { command: 'arrange.ungroup' },
      { command: 'arrange.lock' },
      { command: 'arrange.unlock' },
      { separator: true },
      { command: 'edit.copyStyle' },
      { command: 'edit.pasteStyle' },
    ];
  }
  return [
    { command: 'edit.paste' },
    { command: 'edit.selectAll' },
    { separator: true },
    { command: 'view.toggleGrid' },
    { command: 'view.zoomToFit' },
    { command: 'view.actualSize' },
  ];
}
