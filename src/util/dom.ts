/**
 * Small DOM helpers.
 *
 * FlowShark builds its interface with plain DOM calls rather than a framework:
 * the canvas is the performance-critical surface and it is drawn as SVG markup,
 * so a virtual DOM would add weight without earning it, and the bundle inside a
 * signed app stays small and auditable.
 */

export type Attributes = Record<string, string | number | boolean | null | undefined>;

const SVG_NS = 'http://www.w3.org/2000/svg';

function applyAttributes(node: Element, attributes: Attributes): void {
  for (const [name, value] of Object.entries(attributes)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) node.setAttribute(name, '');
    else node.setAttribute(name, String(value));
  }
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  applyAttributes(node, attributes);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Attributes = {},
  children: Array<Node | string | null | undefined> = [],
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  applyAttributes(node, attributes);
  for (const child of children) {
    if (child === null || child === undefined) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function requireElement<T extends Element = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`The interface element "${id}" is missing from the page.`);
  return node as unknown as T;
}

/** Run `fn` on the next animation frame, collapsing repeat calls. */
export function rafThrottle<T extends unknown[]>(fn: (...args: T) => void): (...args: T) => void {
  let scheduled = false;
  let latest: T;
  return (...args: T) => {
    latest = args;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...latest);
    });
  };
}
