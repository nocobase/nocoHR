/** Reading and writing the payroll workbooks (导入模板, 派遣账单). */
import * as XLSX from 'xlsx';

import { HrError, str } from '../shared.js';

const MAX_ROWS = 20_000;

/** The first sheet as header-keyed rows, with each row's number in the sheet. */
export function readSheet(buffer: Uint8Array): {
  headers: string[];
  rows: { row: number; values: Record<string, unknown> }[];
} {
  let book: XLSX.WorkBook;
  try {
    book = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new HrError('IMPORT_FILE_INVALID', 400);
  }
  const sheet = book.Sheets[book.SheetNames[0] ?? ''];
  if (!sheet) throw new HrError('IMPORT_FILE_INVALID', 400);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  });
  if (!matrix.length) throw new HrError('IMPORT_FILE_EMPTY', 400);
  if (matrix.length > MAX_ROWS + 1) throw new HrError('SCOPE_TOO_LARGE', 400);
  const headers = (matrix[0] ?? []).map((cell) =>
    cell === null || cell === undefined ? '' : str(cell).trim(),
  );
  const rows = matrix.slice(1).map((cells, index) => ({
    row: index + 2,
    values: Object.fromEntries(
      headers.map((header, column) => [header, cells[column] ?? null]),
    ),
  }));
  return {
    headers,
    rows: rows.filter((r) =>
      Object.values(r.values).some((v) => v !== null && v !== ''),
    ),
  };
}

export function writeSheet(
  name: string,
  rows: readonly (readonly unknown[])[],
): Uint8Array {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet(rows as unknown[][]),
    name.slice(0, 31),
  );
  return new Uint8Array(
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as ArrayBuffer,
  );
}

/** A cell as a number: numbers, and text such as "2,400" or " 600 ". */
export function numberCell(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.replace(/[,，\s]/gu, '');
  if (!/^-?\d+(\.\d+)?$/u.test(text)) return null;
  return Number(text);
}

export function textCell(value: unknown): string {
  return value === null || value === undefined ? '' : str(value).trim();
}
