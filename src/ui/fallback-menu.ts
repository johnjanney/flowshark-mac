/**
 * An in-app menu bar for the browser.
 *
 * On macOS the menu bar is the system one. This fallback exists so the whole
 * application, including every command, is still reachable when the front end
 * runs in a plain browser for development and testing.
 */

import { clear, el, requireElement } from '../util/dom';
import { formatAccelerator, type CommandRegistry } from '../commands/registry';
import { MENU_BAR, type MenuEntry } from './menus';

export class FallbackMenuBar {
  private readonly root: HTMLElement;
  private openRoot: HTMLElement | null = null;
  private recentProvider: () => Array<{ path: string; title: string }> = () => [];
  private openRecent: (path: string) => void = () => {};

  constructor(private readonly registry: CommandRegistry) {
    this.root = requireElement<HTMLElement>('fallback-menubar');
  }

  onRecentFiles(
    provider: () => Array<{ path: string; title: string }>,
    open: (path: string) => void,
  ): void {
    this.recentProvider = provider;
    this.openRecent = open;
  }

  mount(): void {
    this.root.hidden = false;
    this.render();
    window.addEventListener('pointerdown', (event) => {
      if (!this.root.contains(event.target as Node)) this.close();
    });
  }

  private render(): void {
    clear(this.root);
    for (const definition of MENU_BAR) {
      const container = el('div', { class: 'menu-root' });
      const button = el('button', { type: 'button' }, [definition.title]);
      const popup = el('div', { class: 'menu-popup', hidden: true, role: 'menu' });

      button.addEventListener('click', (event) => {
        event.stopPropagation();
        const isOpen = container.classList.contains('open');
        this.close();
        if (isOpen) return;
        clear(popup);
        this.buildItems(definition.items, popup);
        container.classList.add('open');
        popup.hidden = false;
        this.openRoot = container;
      });

      container.append(button, popup);
      this.root.append(container);
    }
  }

  private buildItems(entries: readonly MenuEntry[], parent: HTMLElement): void {
    for (const entry of entries) {
      if (entry.separator || entry.predefined === 'separator') {
        parent.append(el('hr'));
        continue;
      }
      if (entry.predefined) {
        const button = el('button', { type: 'button', disabled: true }, [
          el('span', {}, [entry.title ?? predefinedLabel(entry.predefined)]),
          el('span', { class: 'shortcut' }, ['System']),
        ]);
        parent.append(button);
        continue;
      }
      if (entry.submenu) {
        parent.append(
          el('div', { class: 'field-label', style: 'padding:6px 8px 2px' }, [entry.title ?? '']),
        );
        if (entry.title === 'Open Recent') {
          for (const recent of this.recentProvider()) {
            const button = el('button', { type: 'button' }, [el('span', {}, [recent.title])]);
            button.addEventListener('click', () => {
              this.close();
              this.openRecent(recent.path);
            });
            parent.append(button);
          }
        }
        this.buildItems(entry.submenu, parent);
        continue;
      }
      if (!entry.command) continue;
      const command = this.registry.get(entry.command);
      if (!command) continue;
      const button = el('button', { type: 'button', role: 'menuitem' }, [
        el('span', {}, [
          (this.registry.isChecked(command.id) ? '✓ ' : '') + command.title,
        ]),
        command.accelerator
          ? el('span', { class: 'shortcut' }, [formatAccelerator(command.accelerator)])
          : null,
      ]);
      button.disabled = !this.registry.isEnabled(command.id);
      button.addEventListener('click', () => {
        this.close();
        this.registry.run(command.id);
      });
      parent.append(button);
    }
  }

  private close(): void {
    if (!this.openRoot) return;
    this.openRoot.classList.remove('open');
    const popup = this.openRoot.querySelector<HTMLElement>('.menu-popup');
    if (popup) popup.hidden = true;
    this.openRoot = null;
  }
}

function predefinedLabel(kind: string): string {
  const labels: Record<string, string> = {
    about: 'About FlowShark',
    services: 'Services',
    hide: 'Hide FlowShark',
    hideOthers: 'Hide Others',
    showAll: 'Show All',
    quit: 'Quit FlowShark',
    minimize: 'Minimise',
    maximize: 'Zoom',
    fullscreen: 'Enter Full Screen',
    closeWindow: 'Close Window',
  };
  return labels[kind] ?? kind;
}
