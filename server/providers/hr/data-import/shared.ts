/**
 * 初始数据导入: what the department, position, contract and opening-balance
 * importers share. They follow the employee import (talent-service.ts):
 * a template with an example row → upload → a preview that lists every
 * row's problems without writing → a commit in one transaction, refused
 * while any row still has a problem → a batch record in `dataImportBatches`.
 *
 * Columns are found by their title, Chinese or English, so a reordered file
 * still imports; a file without a required column is refused as a whole.
 * Every cell reaches the importer as trimmed text; date columns are read as
 * `YYYY-MM-DD` whether Excel stored a date, a serial number or text.
 */
import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import * as XLSX from 'xlsx';

import { parseImportDate } from '../competency-service.js';
import { HrError, newId, str } from '../shared.js';

export const IMPORT_ROW_LIMIT = 2000;

export type ImportKind =
  'departments' | 'positions' | 'contracts' | 'leaveBalances';

const BATCH_PREFIX: Record<ImportKind, string> = {
  departments: 'DEP',
  positions: 'POS',
  contracts: 'CON',
  leaveBalances: 'LVB',
};

export interface ImportColumn<K extends string = string> {
  readonly key: K;
  /** The template's header, which a file is matched by. */
  readonly title: string;
  /** The English header, also accepted. */
  readonly titleEn: string;
  readonly required?: boolean;
  readonly date?: boolean;
}

/** One problem of one row: the column (its key) and a stable code the page translates. */
export interface ImportCellError {
  readonly column: string;
  readonly code: string;
}

export type ImportAction = 'create' | 'update' | 'unchanged';

export interface ImportRow<K extends string = string> {
  /** The spreadsheet row number, the header being row 1. */
  readonly line: number;
  readonly cells: Record<K, string>;
  errors: ImportCellError[];
  action: ImportAction;
}

export interface ImportPreview<K extends string = string> {
  readonly rows: ImportRow<K>[];
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface ImportResult {
  readonly batchId: string;
  readonly created: number;
  readonly updated: number;
  readonly unchanged: number;
}

export interface ImportStatus {
  /** How many records of the kind the system holds now. */
  readonly count: number;
  /** When the latest import of the kind committed; null before the first. */
  readonly lastImportedAt: string | null;
}

/** The template: the headers and example rows, one sheet. */
export function buildTemplate(
  columns: readonly ImportColumn[],
  examples: readonly (readonly string[])[],
  sheetName: string,
): Buffer {
  const sheet = XLSX.utils.aoa_to_sheet([
    columns.map((c) => c.title),
    ...examples.map((row) => [...row]),
  ]);
  // Text columns stay text when someone types 001 into them.
  sheet['!cols'] = columns.map(() => ({ wch: 16 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

/** Reads the first sheet into rows of trimmed text, skipping empty rows. */
export function readSheet<K extends string>(
  file: Buffer,
  columns: readonly ImportColumn<K>[],
): ImportRow<K>[] {
  let workbook: XLSX.WorkBook;
  try {
    // Without cellDates a date cell stays its serial number, which reads without a time-zone shift.
    workbook = XLSX.read(file, { type: 'buffer' });
  } catch {
    throw new HrError('IMPORT_FILE_INVALID', 400);
  }
  const sheet = workbook.Sheets[workbook.SheetNames[0] ?? ''];
  if (!sheet) throw new HrError('IMPORT_FILE_INVALID', 400);
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: '',
  });
  const [header = [], ...body] = raw;
  const titles = header.map((h) => str(h ?? '').trim());
  const index = new Map<K, number>();
  for (const column of columns) {
    const at = titles.findIndex(
      (t) => t === column.title || t === column.titleEn,
    );
    if (at >= 0) index.set(column.key, at);
    else if (column.required)
      throw new HrError('DATA_IMPORT_HEADER_INVALID', 400, {
        expected: columns.map((c) => c.title).join('、'),
      });
  }
  const rows: ImportRow<K>[] = [];
  body.forEach((row, offset) => {
    if (!row.some((value) => str(value ?? '').trim() !== '')) return;
    const cells = {} as Record<K, string>;
    for (const column of columns) {
      const at = index.get(column.key);
      const value = at === undefined ? '' : row[at];
      cells[column.key] = column.date ? dateCell(value) : textCell(value);
    }
    rows.push({ line: offset + 2, cells, errors: [], action: 'create' });
  });
  if (rows.length > IMPORT_ROW_LIMIT)
    throw new HrError('IMPORT_TOO_MANY_ROWS', 400, {
      limit: IMPORT_ROW_LIMIT,
    });
  return rows;
}

function textCell(value: unknown): string {
  if (value instanceof Date)
    return Number.isNaN(value.getTime())
      ? ''
      : value.toISOString().slice(0, 10);
  return str(value ?? '').trim();
}

/** A valid date as `YYYY-MM-DD`; anything else as the text it was, for the preview to flag. */
function dateCell(value: unknown): string {
  const parsed = parseImportDate(
    typeof value === 'string' ? value.trim() : value,
  );
  if (parsed.date) return parsed.date;
  return textCell(value);
}

/** A cell already normalized by `readSheet`: valid when empty or a real calendar date. */
export function validDate(value: string): boolean {
  if (!value) return true;
  const parsed = parseImportDate(value);
  return !parsed.invalid && parsed.date === value;
}

/**
 * The rows a commit sends back: only their line and cells are trusted, and
 * only the known columns, as text. The preview runs again on them.
 */
export function rowsFromBody<K extends string>(
  body: unknown,
  columns: readonly ImportColumn<K>[],
): ImportRow<K>[] {
  if (
    !body ||
    typeof body !== 'object' ||
    !Array.isArray((body as { rows?: unknown }).rows)
  )
    throw new HrError('INVALID_INPUT', 400);
  const input = (body as { rows: unknown[] }).rows;
  if (input.length > IMPORT_ROW_LIMIT)
    throw new HrError('IMPORT_TOO_MANY_ROWS', 400, {
      limit: IMPORT_ROW_LIMIT,
    });
  return input.map((item) => {
    const record = (item ?? {}) as { line?: unknown; cells?: unknown };
    const source = (record.cells ?? {}) as Record<string, unknown>;
    const cells = {} as Record<K, string>;
    for (const column of columns) {
      const value = source[column.key];
      cells[column.key] =
        typeof value === 'string' || typeof value === 'number'
          ? String(value).trim().slice(0, 4000)
          : '';
    }
    const line = Number(record.line);
    return {
      line: Number.isInteger(line) && line > 0 ? line : 0,
      cells,
      errors: [],
      action: 'create' as const,
    };
  });
}

export function summarize<K extends string>(
  rows: ImportRow<K>[],
): ImportPreview<K> {
  return {
    rows,
    created: rows.filter((r) => !r.errors.length && r.action === 'create')
      .length,
    updated: rows.filter((r) => !r.errors.length && r.action === 'update')
      .length,
    unchanged: rows.filter((r) => !r.errors.length && r.action === 'unchanged')
      .length,
  };
}

/** Refuses a commit while any row has a problem, answering the rows so the page can show them. */
export function assertNoErrors(preview: ImportPreview): void {
  if (!preview.rows.length) throw new HrError('IMPORT_EMPTY', 400);
  if (preview.rows.some((row) => row.errors.length))
    throw new HrError('IMPORT_HAS_ERRORS', 400, { rows: preview.rows });
}

export function newBatchId(kind: ImportKind, date: string): string {
  return `IMP-${BATCH_PREFIX[kind]}-${date.replace(/-/gu, '')}-${newId()
    .replace(/[^a-z0-9]/giu, '')
    .slice(-4)
    .toUpperCase()}`;
}

export async function recordBatch(
  connection: DatabaseConnection,
  input: {
    id: string;
    kind: ImportKind;
    userId: string;
    created: readonly string[];
    updated: readonly string[];
    unchanged: number;
  },
): Promise<void> {
  const stamp = new Date();
  await connection.query
    .insertInto('dataImportBatches')
    .values({
      id: input.id,
      kind: input.kind,
      importedByUserId: input.userId,
      createdCount: input.created.length,
      updatedCount: input.updated.length,
      unchangedCount: input.unchanged,
      recordIds: {
        created: input.created,
        updated: input.updated,
      },
      createdAt: stamp,
      updatedAt: stamp,
    })
    .execute();
}

export async function lastImportedAt(
  database: DatabaseManager,
  kind: ImportKind,
): Promise<string | null> {
  const row = await database
    .query()
    .selectFrom('dataImportBatches')
    .select(['createdAt'])
    .where('kind', '=', kind)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (!row?.createdAt) return null;
  const date = new Date(str(row.createdAt));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Numbers as a sheet holds them: 1,5 or ５ are not numbers; up to four decimals. */
export function parseNumber(value: string): number | null {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function fourDecimals(value: number): boolean {
  return Math.abs(value * 10000 - Math.round(value * 10000)) < 1e-7;
}
