/**
 * The macOS menu bar.
 *
 * The structure comes from `src/ui/menus.ts` and the behaviour from the command
 * registry, so the menu bar, the toolbar, the context menus, and the shortcut
 * sheet can never disagree about what a command is called or what it does.
 *
 * Standard items — Quit, Hide, Services, Full Screen, window management — use
 * the system's own predefined menu items so they behave exactly as macOS users
 * expect.
 */

import type { CommandRegistry } from '../commands/registry';
import { MENU_BAR, type MenuEntry } from '../ui/menus';
import { isNative } from './environment';

type MenuItemHandle = { setEnabled(enabled: boolean): Promise<void> };
type CheckItemHandle = MenuItemHandle & { setChecked(checked: boolean): Promise<void> };

export interface RecentFileEntry {
  path: string;
  title: string;
}

export class NativeMenu {
  private itemsByCommand = new Map<string, MenuItemHandle>();
  private checkItemsByCommand = new Map<string, CheckItemHandle>();
  private installed = false;
  private recentProvider: () => RecentFileEntry[] = () => [];
  private openRecent: (path: string) => void = () => {};

  constructor(private readonly registry: CommandRegistry) {}

  onRecentFiles(provider: () => RecentFileEntry[], open: (path: string) => void): void {
    this.recentProvider = provider;
    this.openRecent = open;
  }

  async install(): Promise<boolean> {
    if (!isNative()) return false;
    try {
      const { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } = await import(
        '@tauri-apps/api/menu'
      );

      const buildItems = async (entries: readonly MenuEntry[]): Promise<unknown[]> => {
        const built: unknown[] = [];
        for (const entry of entries) {
          if (entry.separator) {
            built.push(await PredefinedMenuItem.new({ item: 'Separator' }));
            continue;
          }
          if (entry.predefined) {
            built.push(await this.buildPredefined(entry, PredefinedMenuItem));
            continue;
          }
          if (entry.submenu) {
            if (entry.title === 'Open Recent') {
              built.push(await this.buildRecentSubmenu(Submenu, MenuItem, PredefinedMenuItem));
              continue;
            }
            built.push(
              await Submenu.new({
                text: entry.title ?? '',
                items: (await buildItems(entry.submenu)) as never,
              }),
            );
            continue;
          }
          if (!entry.command) continue;
          const command = this.registry.get(entry.command);
          if (!command) continue;

          // An accelerator the system cannot parse must cost that one
          // shortcut, not the whole menu bar: retry without it.
          const create = async <T>(
            make: (accelerator: string | undefined) => Promise<T>,
          ): Promise<T> => {
            try {
              return await make(command.accelerator);
            } catch (error) {
              console.warn(
                `The shortcut "${command.accelerator}" for "${command.title}" was rejected.`,
                error,
              );
              return make(undefined);
            }
          };

          if (command.isChecked) {
            const item = await create((accelerator) =>
              CheckMenuItem.new({
                id: command.id,
                text: command.title,
                accelerator,
                checked: command.isChecked!(),
                enabled: this.registry.isEnabled(command.id),
                action: () => this.registry.run(command.id),
              }),
            );
            this.checkItemsByCommand.set(command.id, item as unknown as CheckItemHandle);
            built.push(item);
          } else {
            const item = await create((accelerator) =>
              MenuItem.new({
                id: command.id,
                text: command.title,
                accelerator,
                enabled: this.registry.isEnabled(command.id),
                action: () => this.registry.run(command.id),
              }),
            );
            this.itemsByCommand.set(command.id, item as unknown as MenuItemHandle);
            built.push(item);
          }
        }
        return built;
      };

      const submenus: unknown[] = [];
      for (const definition of MENU_BAR) {
        submenus.push(
          await Submenu.new({
            text: definition.title,
            items: (await buildItems(definition.items)) as never,
          }),
        );
      }

      const menu = await Menu.new({ items: submenus as never });
      await menu.setAsAppMenu();
      this.installed = true;
      return true;
    } catch (error) {
      console.warn('The native menu bar could not be created.', error);
      return false;
    }
  }

  private async buildPredefined(
    entry: MenuEntry,
    PredefinedMenuItem: typeof import('@tauri-apps/api/menu').PredefinedMenuItem,
  ): Promise<unknown> {
    const map: Record<string, Parameters<typeof PredefinedMenuItem.new>[0]> = {
      services: { item: 'Services', text: entry.title ?? 'Services' },
      hide: { item: 'Hide' },
      hideOthers: { item: 'HideOthers' },
      showAll: { item: 'ShowAll' },
      quit: { item: 'Quit' },
      separator: { item: 'Separator' },
      undo: { item: 'Undo' },
      redo: { item: 'Redo' },
      cut: { item: 'Cut' },
      copy: { item: 'Copy' },
      paste: { item: 'Paste' },
      selectAll: { item: 'SelectAll' },
      minimize: { item: 'Minimize' },
      maximize: { item: 'Maximize', text: entry.title ?? 'Zoom' },
      fullscreen: { item: 'Fullscreen' },
      closeWindow: { item: 'CloseWindow' },
      about: { item: { About: null } },
    };
    return PredefinedMenuItem.new(map[entry.predefined ?? 'separator']);
  }

  private async buildRecentSubmenu(
    Submenu: typeof import('@tauri-apps/api/menu').Submenu,
    MenuItem: typeof import('@tauri-apps/api/menu').MenuItem,
    PredefinedMenuItem: typeof import('@tauri-apps/api/menu').PredefinedMenuItem,
  ): Promise<unknown> {
    const recent = this.recentProvider();
    const items: unknown[] = [];
    for (const entry of recent) {
      items.push(
        await MenuItem.new({
          id: `recent:${entry.path}`,
          text: entry.title,
          action: () => this.openRecent(entry.path),
        }),
      );
    }
    if (recent.length > 0) items.push(await PredefinedMenuItem.new({ item: 'Separator' }));
    const clear = this.registry.get('file.clearRecent');
    if (clear) {
      items.push(
        await MenuItem.new({
          id: clear.id,
          text: clear.title,
          enabled: recent.length > 0,
          action: () => this.registry.run(clear.id),
        }),
      );
    }
    return Submenu.new({ text: 'Open Recent', items: items as never });
  }

  /** Push the current enabled and checked state into the menu bar. */
  async sync(): Promise<void> {
    if (!this.installed) return;
    const updates: Array<Promise<unknown>> = [];
    for (const [id, item] of this.itemsByCommand) {
      updates.push(item.setEnabled(this.registry.isEnabled(id)));
    }
    for (const [id, item] of this.checkItemsByCommand) {
      updates.push(item.setEnabled(this.registry.isEnabled(id)));
      updates.push(item.setChecked(this.registry.isChecked(id)));
    }
    await Promise.allSettled(updates);
  }

  /** Rebuild the whole menu. Needed when the Open Recent list changes. */
  async rebuild(): Promise<void> {
    if (!this.installed) return;
    this.itemsByCommand.clear();
    this.checkItemsByCommand.clear();
    this.installed = false;
    await this.install();
  }
}
