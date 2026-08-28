/**
 * XML escaping and identifier safety for generated markup.
 *
 * The scene is built as a markup string and then handed to `innerHTML` on the
 * screen, written into an exported `.svg`, and inserted into the print sheet.
 * Every value that reaches that markup from a document — and a document may
 * have been written by someone else — has to be escaped here first, including
 * the values that end up inside `id` attributes and `url(#…)` references.
 */

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escape the five XML metacharacters in text and attribute values. */
export function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => XML_ESCAPES[character]);
}

/**
 * Reduce an arbitrary string to characters that are safe in an `id` attribute
 * and inside a `url(#…)` reference.
 *
 * Escaping alone is not enough for an identifier: `&quot;` is safe markup but
 * still breaks the `url(#…)` that has to point at it, so unsafe characters are
 * encoded away instead. The encoding is reversible in principle — each
 * offending character becomes `_<code point>_` — which matters because two
 * different inputs must never collapse onto the same identifier and quietly
 * share a gradient or a marker.
 */
export function safeIdToken(value: string): string {
  let out = '';
  for (const character of value) {
    if (/[A-Za-z0-9]/.test(character)) out += character;
    else out += `_${character.codePointAt(0)}_`;
  }
  return out;
}
