/**
 * What an image file actually is, read from its own bytes.
 *
 * Two questions get asked of every image FlowShark handles, and neither can be
 * answered by anything the file says about itself:
 *
 * 1. **What format is it?** A filename extension is a claim, and so is the
 *    `mimeType` recorded in a document — both are just strings someone else
 *    may have written.
 * 2. **How large is it?** A document records `width` and `height` alongside an
 *    embedded payload, but those fields are separate from the payload. A
 *    hostile file can declare `1 x 1` for a picture whose header says
 *    30000 x 30000, and the renderer, which decodes the payload rather than
 *    the record, would then be handed the very image a pixel budget exists to
 *    refuse.
 *
 * This module answers both from the leading bytes, and has no dependencies, so
 * the importer and the document reader can share one answer instead of keeping
 * two that can disagree.
 */

export interface ImageInfo {
  mimeType: string;
  width: number;
  height: number;
}

const BASE64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Decode at most `limit` bytes from the front of a base64 payload.
 *
 * Only the head is decoded: enough to read a signature and a header, without
 * allocating the whole picture just to find out how big it claims to be.
 */
export function decodeBase64Prefix(base64: string, limit: number): Uint8Array {
  const out = new Uint8Array(limit);
  let length = 0;
  let bits = 0;
  let accumulator = 0;
  for (const character of base64) {
    if (character === '=' ) break;
    const index = BASE64_ALPHABET.indexOf(character);
    // Whitespace is legal in the stored payload; anything else ends the run.
    if (index < 0) {
      if (/\s/.test(character)) continue;
      break;
    }
    accumulator = (accumulator << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[length] = (accumulator >> bits) & 0xff;
      length += 1;
      if (length >= limit) break;
    }
  }
  return out.subarray(0, length);
}

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0): boolean {
  if (bytes.length < at + signature.length) return false;
  return signature.every((byte, index) => bytes[at + index] === byte);
}

function u16be(bytes: Uint8Array, at: number): number {
  return (bytes[at] << 8) | bytes[at + 1];
}

function u16le(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u32be(bytes: Uint8Array, at: number): number {
  return (
    bytes[at] * 0x1000000 + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3])
  );
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = [0x47, 0x49, 0x46, 0x38, 0x37, 0x61];
const GIF89 = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const JPEG = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

/** Frame types that carry the image's dimensions in a JPEG. */
const JPEG_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function pngSize(bytes: Uint8Array): ImageInfo | null {
  // Signature (8) + chunk length (4) + "IHDR" (4), then width and height.
  if (bytes.length < 24) return null;
  if (!startsWith(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return null;
  return { mimeType: 'image/png', width: u32be(bytes, 16), height: u32be(bytes, 20) };
}

function gifSize(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 10) return null;
  return { mimeType: 'image/gif', width: u16le(bytes, 6), height: u16le(bytes, 8) };
}

function jpegSize(bytes: Uint8Array): ImageInfo | null {
  // Walk the segment chain to the start-of-frame, which is the only place the
  // dimensions appear. Metadata such as an EXIF thumbnail can sit in front of
  // it, so this is a scan rather than a fixed offset.
  let i = 2;
  // Enough room to read a marker and its length; the frame branch checks that
  // it can reach the dimensions before it reads them, so a frame header that
  // ends exactly at the end of the window is still read.
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    // Standalone markers carry no payload.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = u16be(bytes, i + 2);
    if (length < 2) return null;
    if (JPEG_FRAME_MARKERS.has(marker)) {
      if (i + 8 >= bytes.length) return null;
      return {
        mimeType: 'image/jpeg',
        height: u16be(bytes, i + 5),
        width: u16be(bytes, i + 7),
      };
    }
    i += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageInfo | null {
  if (bytes.length < 16 || !startsWith(bytes, WEBP, 8)) return null;
  const form = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);

  if (form === 'VP8 ' && bytes.length >= 30) {
    // Lossy: a three-byte frame tag, the start code, then 14-bit dimensions.
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return {
      mimeType: 'image/webp',
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  if (form === 'VP8L' && bytes.length >= 25) {
    if (bytes[20] !== 0x2f) return null;
    const packed =
      bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return {
      mimeType: 'image/webp',
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }
  if (form === 'VP8X' && bytes.length >= 30) {
    // Extended: the canvas size, held as three-byte little-endian values.
    const width = (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1;
    const height = (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1;
    return { mimeType: 'image/webp', width, height };
  }
  return null;
}

/**
 * The format and true pixel size of an image, or `null` when the bytes are not
 * a format FlowShark draws — or are truncated before the header that says.
 *
 * Returning `null` for a payload whose header cannot be read is deliberate:
 * "we could not tell" and "it is small" must not be the same answer, or the
 * budget is bypassed by truncation.
 */
export function inspectImage(bytes: Uint8Array): ImageInfo | null {
  if (startsWith(bytes, PNG)) return pngSize(bytes);
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return gifSize(bytes);
  if (startsWith(bytes, JPEG)) return jpegSize(bytes);
  if (startsWith(bytes, RIFF)) return webpSize(bytes);
  return null;
}

/**
 * How much of a payload has to be decoded before `inspectImage` can answer.
 *
 * PNG, GIF and WebP put their dimensions in a fixed-size header. A JPEG can
 * carry metadata ahead of its frame header, so the scan needs room; 64 KB
 * covers an EXIF block and its thumbnail without decoding the picture.
 */
export const IMAGE_HEADER_BYTES = 64 * 1024;

/** `inspectImage`, for a payload still held as base64. */
export function inspectBase64Image(base64: string): ImageInfo | null {
  return inspectImage(decodeBase64Prefix(base64, IMAGE_HEADER_BYTES));
}
