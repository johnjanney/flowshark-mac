/**
 * The command registry.
 *
 * The brief requires that every command in the toolbar or the inspector also
 * appears in the menu bar, so that keyboard and VoiceOver users can reach all
 * of them. Registering commands in one place and building the menu bar, the
 * toolbar, the context menus, and the shortcut handler from that registry is
 * what keeps that promise true as the app grows.
 */

export interface CommandDefinition {
  id: string;
  title: string;
  /** Tauri-style accelerator, for example `Cmd+Shift+N`. */
  accelerator?: string;
  run(): void | Promise<void>;
  isEnabled?(): boolean;
  isChecked?(): boolean;
  /** Hidden from the shortcut reference sheet. */
  hidden?: boolean;
}

export interface ParsedAccelerator {
  meta: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  key: string;
}

/** Map an accelerator token onto the character `KeyboardEvent.key` reports. */
const KEY_ALIASES: Record<string, string> = {
  plus: '+',
  minus: '-',
  equal: '=',
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  space: ' ',
  delete: 'backspace',
  backspace: 'backspace',
  enter: 'enter',
  return: 'enter',
  escape: 'escape',
  tab: 'tab',
  left: 'arrowleft',
  right: 'arrowright',
  up: 'arrowup',
  down: 'arrowdown',
};

export function parseAccelerator(accelerator: string): ParsedAccelerator {
  const parts = accelerator.split('+').map((part) => part.trim().toLowerCase());
  const result: ParsedAccelerator = {
    meta: false,
    shift: false,
    alt: false,
    ctrl: false,
    key: '',
  };
  for (const part of parts) {
    if (part === 'cmd' || part === 'command' || part === 'cmdorctrl' || part === 'super') {
      result.meta = true;
    } else if (part === 'shift') result.shift = true;
    else if (part === 'alt' || part === 'option') result.alt = true;
    else if (part === 'ctrl' || part === 'control') result.ctrl = true;
    else result.key = KEY_ALIASES[part] ?? part;
  }
  return result;
}

/** Render an accelerator using the symbols macOS shows in menus. */
export function formatAccelerator(accelerator: string): string {
  const parsed = parseAccelerator(accelerator);
  const symbols: Record<string, string> = {
    arrowleft: '←',
    arrowright: '→',
    arrowup: '↑',
    arrowdown: '↓',
    backspace: '⌫',
    enter: '↩',
    escape: '⎋',
    tab: '⇥',
    ' ': 'Space',
  };
  const key = symbols[parsed.key] ?? parsed.key.toUpperCase();
  return (
    (parsed.ctrl ? '⌃' : '') +
    (parsed.alt ? '⌥' : '') +
    (parsed.shift ? '⇧' : '') +
    (parsed.meta ? '⌘' : '') +
    key
  );
}

export function matchesAccelerator(event: KeyboardEvent, accelerator: string): boolean {
  const parsed = parseAccelerator(accelerator);
  if (parsed.meta !== event.metaKey) return false;
  if (parsed.shift !== event.shiftKey) return false;
  if (parsed.alt !== event.altKey) return false;
  if (parsed.ctrl !== event.ctrlKey) return false;

  const key = event.key.toLowerCase();
  if (key === parsed.key) return true;
  // Option changes the character macOS reports, so fall back to the physical
  // key: Option-Command-G arrives as "©" but `event.code` is still "KeyG".
  if (parsed.key.length === 1 && event.code === `Key${parsed.key.toUpperCase()}`) return true;
  if (parsed.key === '+' && (key === '=' || event.code === 'Equal')) return true;
  if (parsed.key === '-' && event.code === 'Minus') return true;
  if (/^[0-9]$/.test(parsed.key) && event.code === `Digit${parsed.key}`) return true;
  return false;
}

export class CommandRegistry {
  private commands = new Map<string, CommandDefinition>();
  private lastRun = new Map<string, number>();

  register(definition: CommandDefinition): void {
    this.commands.set(definition.id, definition);
  }

  registerAll(definitions: readonly CommandDefinition[]): void {
    for (const definition of definitions) this.register(definition);
  }

  get(id: string): CommandDefinition | undefined {
    return this.commands.get(id);
  }

  all(): CommandDefinition[] {
    return [...this.commands.values()];
  }

  isEnabled(id: string): boolean {
    const command = this.commands.get(id);
    if (!command) return false;
    return command.isEnabled ? command.isEnabled() : true;
  }

  isChecked(id: string): boolean {
    const command = this.commands.get(id);
    return command?.isChecked ? command.isChecked() : false;
  }

  /**
   * Run a command.
   *
   * macOS normally consumes a menu accelerator before the web view sees it, but
   * if both paths fire the command would run twice; the short guard window
   * makes that harmless.
   */
  run(id: string): boolean {
    const command = this.commands.get(id);
    if (!command || !this.isEnabled(id)) return false;
    const now = Date.now();
    if (now - (this.lastRun.get(id) ?? 0) < 60) return false;
    this.lastRun.set(id, now);
    void command.run();
    return true;
  }

  /** Find the command whose accelerator matches `event`, if any. */
  matching(event: KeyboardEvent): CommandDefinition | undefined {
    for (const command of this.commands.values()) {
      if (command.accelerator && matchesAccelerator(event, command.accelerator)) {
        return command;
      }
    }
    return undefined;
  }
}
