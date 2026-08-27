/**
 * Element identifiers.
 *
 * Ids only need to be unique inside one document, so a short random string is
 * enough. `crypto.getRandomValues` is available in WKWebView and in Node 20+,
 * with a `Math.random` fallback for exotic test environments.
 */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const cryptoObject = globalThis.crypto;
  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    cryptoObject.getRandomValues(bytes);
    return bytes;
  }
  for (let i = 0; i < length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return bytes;
}

export function createId(prefix = 'e'): string {
  const bytes = randomBytes(10);
  let out = '';
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Ensure `id` is not already present in `taken`, appending a suffix if needed. */
export function uniqueId(taken: ReadonlySet<string>, prefix = 'e'): string {
  let id = createId(prefix);
  while (taken.has(id)) id = createId(prefix);
  return id;
}
