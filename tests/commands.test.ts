import { describe, expect, it, vi } from 'vitest';
import {
  CommandRegistry,
  formatAccelerator,
  matchesAccelerator,
  parseAccelerator,
} from '../src/commands/registry';
import { MENU_BAR, SHORTCUT_GROUPS } from '../src/ui/menus';

function keyEvent(init: Partial<KeyboardEvent> & { key: string }): KeyboardEvent {
  return {
    key: init.key,
    code: init.code ?? '',
    metaKey: init.metaKey ?? false,
    shiftKey: init.shiftKey ?? false,
    altKey: init.altKey ?? false,
    ctrlKey: init.ctrlKey ?? false,
  } as KeyboardEvent;
}

describe('accelerators', () => {
  it('parses modifiers and the key', () => {
    expect(parseAccelerator('Cmd+Shift+N')).toEqual({
      meta: true,
      shift: true,
      alt: false,
      ctrl: false,
      key: 'n',
    });
  });

  it('renders the symbols macOS shows in menus', () => {
    expect(formatAccelerator('Cmd+N')).toBe('⌘N');
    expect(formatAccelerator('Cmd+Shift+Z')).toBe('⇧⌘Z');
    expect(formatAccelerator('Cmd+Alt+Shift+G')).toBe('⌥⇧⌘G');
    expect(formatAccelerator('Ctrl+Cmd+Space')).toBe('⌃⌘Space');
    expect(formatAccelerator('Delete')).toBe('⌫');
  });

  it('matches a key event', () => {
    expect(matchesAccelerator(keyEvent({ key: 'n', metaKey: true }), 'Cmd+N')).toBe(true);
    expect(matchesAccelerator(keyEvent({ key: 'n' }), 'Cmd+N')).toBe(false);
    expect(
      matchesAccelerator(keyEvent({ key: 'n', metaKey: true, shiftKey: true }), 'Cmd+N'),
    ).toBe(false);
  });

  it('falls back to the physical key when Option changes the character', () => {
    // Option-Command-G produces "©" on a US keyboard.
    const event = keyEvent({ key: '©', code: 'KeyG', metaKey: true, altKey: true });
    expect(matchesAccelerator(event, 'Cmd+Alt+G')).toBe(true);
  });

  it('accepts the unshifted keys for zoom in and out', () => {
    expect(
      matchesAccelerator(keyEvent({ key: '=', code: 'Equal', metaKey: true }), 'Cmd+Plus'),
    ).toBe(true);
    expect(
      matchesAccelerator(keyEvent({ key: '-', code: 'Minus', metaKey: true }), 'Cmd+Minus'),
    ).toBe(true);
  });
});

describe('command registry', () => {
  it('runs an enabled command and skips a disabled one', () => {
    const registry = new CommandRegistry();
    const enabled = vi.fn();
    const disabled = vi.fn();
    registry.register({ id: 'a', title: 'A', run: enabled });
    registry.register({ id: 'b', title: 'B', run: disabled, isEnabled: () => false });

    expect(registry.run('a')).toBe(true);
    expect(enabled).toHaveBeenCalledOnce();
    expect(registry.run('b')).toBe(false);
    expect(disabled).not.toHaveBeenCalled();
  });

  it('ignores a repeat of the same command within the guard window', () => {
    const registry = new CommandRegistry();
    const run = vi.fn();
    registry.register({ id: 'a', title: 'A', run });
    registry.run('a');
    registry.run('a');
    expect(run).toHaveBeenCalledOnce();
  });

  it('finds the command a key event triggers', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'save', title: 'Save', accelerator: 'Cmd+S', run: () => {} });
    expect(registry.matching(keyEvent({ key: 's', metaKey: true }))?.id).toBe('save');
    expect(registry.matching(keyEvent({ key: 's' }))).toBeUndefined();
  });
});

describe('menu structure', () => {
  it('uses the Apple menu titles the brief lists', () => {
    expect(MENU_BAR.map((menu) => menu.title)).toEqual([
      'FlowShark',
      'File',
      'Edit',
      'Insert',
      'Format',
      'Arrange',
      'View',
      'Window',
      'Help',
    ]);
  });

  it('has no duplicate command in one menu', () => {
    const collect = (items: readonly { command?: string; submenu?: unknown }[]): string[] =>
      items.flatMap((item) => [
        ...(item.command ? [item.command] : []),
        ...(item.submenu ? collect(item.submenu as never) : []),
      ]);
    for (const menu of MENU_BAR) {
      const commands = collect(menu.items);
      // Copy Style and Paste Style appear in both Edit and Format on purpose,
      // but never twice inside one menu.
      expect(new Set(commands).size).toBe(commands.length);
    }
  });

  it('lists shortcut groups that reference real commands', () => {
    const inMenus = new Set<string>();
    const walk = (items: readonly { command?: string; submenu?: unknown }[]): void => {
      for (const item of items) {
        if (item.command) inMenus.add(item.command);
        if (item.submenu) walk(item.submenu as never);
      }
    };
    for (const menu of MENU_BAR) walk(menu.items);
    for (const group of SHORTCUT_GROUPS) {
      for (const command of group.commands) {
        expect(inMenus.has(command)).toBe(true);
      }
    }
  });
});
