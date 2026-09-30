/**
 * A small text-only PDF writer for the audit exports (个人培训档案, 专项培训证明,
 * 审核包封面). The application ships no PDF library, and these documents are
 * text and simple tables, so this writes PDF 1.4 directly: A4 pages, the
 * standard Adobe CJK font STSong-Light (UniGB-UCS2-H, not embedded — every
 * PDF reader supplies it), wrapped lines and page breaks. Characters outside
 * the Basic Multilingual Plane print as "?".
 */

export type PdfBlock =
  | { readonly kind: 'title'; readonly text: string }
  | { readonly kind: 'heading'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'muted'; readonly text: string }
  /** A table: the first row is the header. */
  | { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] }
  | { readonly kind: 'space' };

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const USABLE = PAGE_WIDTH - MARGIN * 2;

/** Advance of one character in ems: CJK full width, ASCII half. */
function advance(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  return code < 0x80 ? 0.5 : 1;
}

function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += advance(char) * size;
  return width;
}

/** Splits text into lines no wider than `width` points. */
export function wrap(text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r?\n/u)) {
    let line = '';
    let current = 0;
    for (const char of paragraph) {
      const w = advance(char) * size;
      if (current + w > width && line) {
        lines.push(line);
        line = '';
        current = 0;
      }
      line += char;
      current += w;
    }
    lines.push(line);
  }
  return lines;
}

function hex(text: string): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    out += (code > 0xffff ? 63 : code).toString(16).padStart(4, '0');
  }
  return out;
}

interface Page {
  ops: string[];
}

/** Renders blocks into a PDF file. */
export function renderPdf(
  blocks: readonly PdfBlock[],
  meta: { title: string; footer?: string } = { title: '' },
): Uint8Array {
  const pages: Page[] = [];
  let page: Page = { ops: [] };
  pages.push(page);
  let y = PAGE_HEIGHT - MARGIN;
  const newPage = () => {
    page = { ops: [] };
    pages.push(page);
    y = PAGE_HEIGHT - MARGIN;
  };
  const line = (text: string, size: number, x = MARGIN, gray = false) => {
    if (y - size < MARGIN + 20) newPage();
    y -= size * 1.5;
    page.ops.push(
      `BT ${gray ? '0.45 g' : '0 g'} /F1 ${size} Tf ${x.toFixed(1)} ${y.toFixed(1)} Td <${hex(text)}> Tj ET`,
    );
  };
  for (const block of blocks) {
    switch (block.kind) {
      case 'title':
        for (const text of wrap(block.text, 18, USABLE)) line(text, 18);
        y -= 6;
        break;
      case 'heading':
        y -= 6;
        for (const text of wrap(block.text, 13, USABLE)) line(text, 13);
        break;
      case 'text':
        for (const text of wrap(block.text, 10, USABLE)) line(text, 10);
        break;
      case 'muted':
        for (const text of wrap(block.text, 9, USABLE))
          line(text, 9, MARGIN, true);
        break;
      case 'space':
        y -= 8;
        break;
      case 'table': {
        const columns = Math.max(...block.rows.map((r) => r.length), 1);
        // Column widths follow the longest cell, within the page.
        const natural = Array.from({ length: columns }, (_, i) =>
          Math.max(
            ...block.rows.map((r) => textWidth(r[i] ?? '', 9)),
            textWidth('    ', 9),
          ),
        );
        const total = natural.reduce((a, b) => a + b, 0) || 1;
        const widths = natural.map((w) =>
          Math.max(Math.min((w / total) * USABLE, USABLE), 30),
        );
        const scale = USABLE / widths.reduce((a, b) => a + b, 0);
        const final = widths.map((w) => w * scale);
        block.rows.forEach((row, index) => {
          const cells = final.map((w, i) => wrap(row[i] ?? '', 9, w - 6));
          const height = Math.max(...cells.map((c) => c.length), 1);
          if (y - height * 13.5 < MARGIN + 20) newPage();
          let x = MARGIN;
          const top = y;
          for (let i = 0; i < final.length; i += 1) {
            let rowY = top;
            for (const text of cells[i]) {
              rowY -= 13.5;
              page.ops.push(
                `BT ${index === 0 ? '0.35 g' : '0 g'} /F1 9 Tf ${(x + 3).toFixed(1)} ${rowY.toFixed(1)} Td <${hex(text)}> Tj ET`,
              );
            }
            x += final[i];
          }
          y = top - height * 13.5 - 3;
          page.ops.push(
            `0.85 G 0.5 w ${MARGIN} ${(y + 1).toFixed(1)} m ${PAGE_WIDTH - MARGIN} ${(y + 1).toFixed(1)} l S`,
          );
        });
        y -= 4;
        break;
      }
    }
  }
  if (meta.footer)
    pages.forEach((p, i) =>
      p.ops.push(
        `BT 0.45 g /F1 8 Tf ${MARGIN} 30 Td <${hex(`${meta.footer} · ${i + 1}/${pages.length}`)}> Tj ET`,
      ),
    );

  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const catalog = add('');
  const pagesId = add('');
  const font = add('');
  const cidFont = add('');
  const descriptor = add('');
  const info = add(`<< /Title <FEFF${hex(meta.title)}> /Producer (NocoHR) >>`);
  const pageIds: number[] = [];
  for (const p of pages) {
    const stream = p.ops.join('\n');
    const content = add(
      `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`,
    );
    pageIds.push(
      add(
        `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${content} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  objects[font - 1] =
    `<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cidFont} 0 R] >>`;
  objects[cidFont - 1] =
    `<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor ${descriptor} 0 R /DW 1000 /W [1 95 500] >>`;
  objects[descriptor - 1] =
    '<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>';

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets)
    out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, 'latin1'));
}

/** The text a PDF made here carries, for tests: every hex string decoded. */
export function pdfText(bytes: Uint8Array): string {
  const source = Buffer.from(bytes).toString('latin1');
  const parts: string[] = [];
  for (const match of source.matchAll(/<([0-9a-f]+)> Tj/gu)) {
    let text = '';
    for (let i = 0; i + 4 <= match[1].length; i += 4)
      text += String.fromCharCode(parseInt(match[1].slice(i, i + 4), 16));
    parts.push(text);
  }
  return parts.join('\n');
}
