/**
 * A minimal PDF 1.7 writer.
 *
 * FlowShark needs vector PDF output and nothing else — no forms, no
 * annotations, no font subsetting — so a focused writer is smaller and easier
 * to audit than a general-purpose library, and it adds no third-party code to
 * a signed and notarised bundle.
 */

export class PdfWriter {
  private objects: Array<Uint8Array | string> = [];

  /** Reserve an object number without writing its body yet. */
  reserve(): number {
    this.objects.push('');
    return this.objects.length;
  }

  /** Write the body of a reserved object. */
  fill(id: number, body: Uint8Array | string): void {
    this.objects[id - 1] = body;
  }

  add(body: Uint8Array | string): number {
    const id = this.reserve();
    this.fill(id, body);
    return id;
  }

  /** Build a stream object with the given dictionary entries and payload. */
  addStream(dictionary: string, payload: Uint8Array | string): number {
    const bytes =
      typeof payload === 'string' ? new TextEncoder().encode(payload) : payload;
    const header = new TextEncoder().encode(
      `<< ${dictionary} /Length ${bytes.length} >>\nstream\n`,
    );
    const footer = new TextEncoder().encode('\nendstream');
    const out = new Uint8Array(header.length + bytes.length + footer.length);
    out.set(header, 0);
    out.set(bytes, header.length);
    out.set(footer, header.length + bytes.length);
    return this.add(out);
  }

  build(rootId: number, infoId: number | null): Uint8Array {
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let length = 0;
    const push = (data: Uint8Array | string): void => {
      const bytes = typeof data === 'string' ? encoder.encode(data) : data;
      chunks.push(bytes);
      length += bytes.length;
    };

    push('%PDF-1.7\n');
    // A binary comment marks the file as containing binary data.
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

    const offsets: number[] = [];
    this.objects.forEach((body, index) => {
      offsets[index] = length;
      push(`${index + 1} 0 obj\n`);
      push(body);
      push('\nendobj\n');
    });

    const xrefOffset = length;
    push(`xref\n0 ${this.objects.length + 1}\n`);
    push('0000000000 65535 f \n');
    for (const offset of offsets) {
      push(`${String(offset).padStart(10, '0')} 00000 n \n`);
    }
    push(
      `trailer\n<< /Size ${this.objects.length + 1} /Root ${rootId} 0 R` +
        (infoId ? ` /Info ${infoId} 0 R` : '') +
        ` >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
    );

    const out = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) {
      out.set(chunk, cursor);
      cursor += chunk.length;
    }
    return out;
  }
}

/** CP1252 additions above 0x7F, keyed by Unicode code point. */
const WIN_ANSI_HIGH: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

/** True when every character in `value` can be written with WinAnsiEncoding. */
export function isWinAnsiSafe(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x7e) continue;
    if (code >= 0xa0 && code <= 0xff) continue;
    if (WIN_ANSI_HIGH[code] !== undefined) continue;
    return false;
  }
  return true;
}

/** Encode a string as a PDF literal string using WinAnsiEncoding. */
export function pdfString(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    let byte: number;
    if (code <= 0x7e) byte = code;
    else if (code >= 0xa0 && code <= 0xff) byte = code;
    else byte = WIN_ANSI_HIGH[code] ?? 0x3f; // '?' for anything unmapped
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, '0')}`;
    else out += String.fromCharCode(byte);
  }
  return `(${out})`;
}

/** Convert `#rrggbb` to PDF colour components in the 0..1 range. */
export function pdfColor(hex: string): [number, number, number] {
  const value = hex.trim();
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (!match) return [0, 0, 0];
  let body = match[1];
  if (body.length === 3) body = body.split('').map((c) => c + c).join('');
  return [
    parseInt(body.slice(0, 2), 16) / 255,
    parseInt(body.slice(2, 4), 16) / 255,
    parseInt(body.slice(4, 6), 16) / 255,
  ];
}

export function fmt(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 1000) / 1000) : '0';
}
