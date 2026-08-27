/**
 * The window's title bar is the toolbar strip, and dragging it is what moves
 * the window. That behaviour is not CSS: `-webkit-app-region` is a Chromium
 * extension and WKWebView ignores it, so the shipped app once had a title bar
 * that could not be grabbed at all. Tauri instead injects a document-level
 * mousedown handler that walks the composed path looking for
 * `data-tauri-drag-region`, and calls `plugin:window|start_dragging`.
 *
 * Three things have to line up for that to work, and each can break silently:
 * the attribute has to be on the strip, the strip's children must not look
 * clickable to the walk, and the capability file has to grant
 * `core:window:allow-start-dragging`. These tests pin all three.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { CommandRegistry } from '../src/commands/registry';
import { Store } from '../src/state/store';
import { Toolbar } from '../src/ui/toolbar';

function repoFile(relative: string): string {
  // Vitest runs from the repository root; `import.meta.url` is rewritten by
  // the Vite transform and does not point at the file on disk.
  return readFileSync(resolve(process.cwd(), relative), 'utf8');
}

/**
 * A faithful port of the walk in Tauri 2.11's `src/window/scripts/drag.js`.
 * Reimplemented rather than imported because the real copy lives inside the
 * Rust crate and is injected into the webview at runtime; if a Tauri upgrade
 * changes the rules, this port is the thing that should be updated to match.
 */
const CLICKABLE_TAGS = new Set(['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL', 'SUMMARY']);
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'tab',
  'checkbox',
  'radio',
  'switch',
  'option',
]);

function isClickableElement(node: HTMLElement): boolean {
  return (
    CLICKABLE_TAGS.has(node.tagName) ||
    (node.hasAttribute('contenteditable') && node.getAttribute('contenteditable') !== 'false') ||
    (node.hasAttribute('tabindex') && node.getAttribute('tabindex') !== '-1') ||
    INTERACTIVE_ROLES.has(node.getAttribute('role') ?? '')
  );
}

/** Walks from `target` up to the document, the way the composed path does. */
function dragsTheWindow(target: Node): boolean {
  const path: Node[] = [];
  for (let node: Node | null = target; node; node = node.parentNode) path.push(node);

  for (const node of path) {
    if (!(node instanceof window.HTMLElement)) continue;
    const attr = node.getAttribute('data-tauri-drag-region');
    if (isClickableElement(node) && attr === null) return false;
    if (attr === null) continue;
    if (attr === 'false') return false;
    if (attr === 'deep') return true;
    if (attr === '' || attr === 'true') return node === path[0];
  }
  return false;
}

describe('title bar drag region', () => {
  beforeEach(() => {
    document.body.innerHTML = repoFile('index.html')
      .replace(/[\s\S]*<body>/, '')
      .replace(/<\/body>[\s\S]*/, '');
    new Toolbar(new Store(), new CommandRegistry()).mount();
  });

  it('marks the toolbar as a drag region', () => {
    const toolbar = document.getElementById('toolbar');
    expect(toolbar?.getAttribute('data-tauri-drag-region')).toBe('deep');
  });

  it('drags the window from the strip, its spacers and its title', () => {
    for (const selector of ['#toolbar', '.toolbar-spacer', '.toolbar-title', '.toolbar-title strong']) {
      const node = document.querySelector(selector);
      expect(node, selector).not.toBeNull();
      expect(dragsTheWindow(node as Node), selector).toBe(true);
    }
  });

  it('leaves every toolbar button clickable', () => {
    const buttons = Array.from(document.querySelectorAll('#toolbar button'));
    expect(buttons.length).toBeGreaterThan(10);
    for (const button of buttons) {
      expect(dragsTheWindow(button), button.getAttribute('data-command') ?? '').toBe(false);
      // Clicks usually land on the icon inside the button, not the button.
      const icon = button.firstElementChild;
      if (icon) expect(dragsTheWindow(icon), 'icon').toBe(false);
    }
  });

  it('grants the permission the drag handler invokes', () => {
    const capabilities = JSON.parse(repoFile('src-tauri/capabilities/default.json')) as {
      permissions: string[];
    };
    expect(capabilities.permissions).toContain('core:window:allow-start-dragging');
  });

  it('does not rely on Chromium-only app regions', () => {
    // A declaration, not the word: the stylesheet explains in a comment why
    // `-webkit-app-region` is the wrong tool. Chromium honours the property,
    // so a browser smoke test cannot catch it coming back.
    for (const sheet of readdirSync(resolve(process.cwd(), 'src/styles'))) {
      const css = repoFile(`src/styles/${sheet}`).replace(/\/\*[\s\S]*?\*\//g, '');
      expect(css, sheet).not.toMatch(/app-region\s*:/);
    }
  });
});
