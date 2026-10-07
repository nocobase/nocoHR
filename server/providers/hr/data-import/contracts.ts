/**
 * 劳动合同导入: an employee's labour contracts, the history included, from
 * Excel, created by 合同编号.
 *
 * - A 合同编号 already in the system is refused unless the row says the same
 *   as the stored contract, which is then left alone ("unchanged"), so a
 *   file can be imported again after fixing other rows.
 * - Per employee, contracts may not overlap — with each other or with the
 *   stored ones (terminated ones aside) — and at most one may still be in
 *   effect.
 * - Status follows the dates as of today: a contract that ended is
 *   `renewed` when a later one follows it, else `expired`; the others are
 *   `active`. Each imported contract links the contract before it
 *   (`previousContractId`), the chain 用工合规检查 reads for a second
 *   consecutive fixed-term contract.
 * - Side effects: unlike saving one contract, the import does not run a
 *   compliance check per employee. A contract that ended is history, with
 *   no renewal reminder (those read active contracts only); once the import
 *   committed, one full 用工合规检查 runs in the background, which raises
 *   only what is true today.
 * - 试用期结束日期 updates the employee's probation end when it belongs to
 *   the contract in effect; for an ended contract it is kept in the note.
 */
import type { DatabaseConnection } from '@nocobase/db';

import { newId, str, toDateOnly } from '../shared.js';
import {
  assertNoErrors,
  buildTemplate,
  newBatchId,
  readSheet,
  recordBatch,
  rowsFromBody,
  summarize,
  validDate,
  type ImportColumn,
  type ImportPreview,
  type ImportRow,
} from './shared.js';
import type { DataImportDeps } from './types.js';

type Key =
  | 'employeeNo'
  | 'contractNo'
  | 'type'
  | 'startDate'
  | 'endDate'
  | 'signedAt'
  | 'probationEndDate'
  | 'note';

export const CONTRACT_COLUMNS: readonly ImportColumn<Key>[] = [
  { key: 'employeeNo', title: '工号', titleEn: 'Employee no.', required: true },
  {
    key: 'contractNo',
    title: '合同编号',
    titleEn: 'Contract no.',
    required: true,
  },
  { key: 'type', title: '合同类型', titleEn: 'Contract type', required: true },
  {
    key: 'startDate',
    title: '开始日期',
    titleEn: 'Start date',
    required: true,
    date: true,
  },
  { key: 'endDate', title: '结束日期', titleEn: 'End date', date: true },
  { key: 'signedAt', title: '签订日期', titleEn: 'Signed on', date: true },
  {
    key: 'probationEndDate',
    title: '试用期结束日期',
    titleEn: 'Probation ends',
    date: true,
  },
  { key: 'note', title: '备注', titleEn: 'Note' },
];

/** The type column accepts the Chinese and English names and the stored codes. */
const TYPES: Record<string, string> = {
  固定期限: 'fixedTerm',
  固定期限劳动合同: 'fixedTerm',
  无固定期限: 'openEnded',
  无固定期限劳动合同: 'openEnded',
  实习: 'internship',
  实习协议: 'internship',
  劳务: 'labor',
  劳务合同: 'labor',
  劳务协议: 'labor',
  'fixed term': 'fixedTerm',
  'fixed-term': 'fixedTerm',
  'open-ended': 'openEnded',
  'open ended': 'openEnded',
  internship: 'internship',
  labor: 'labor',
  labour: 'labor',
  fixedterm: 'fixedTerm',
  openended: 'openEnded',
};

export function contractType(cell: string): string | undefined {
  return TYPES[cell.trim().toLowerCase()] ?? TYPES[cell.trim()];
}

interface Span {
  readonly key: string;
  readonly start: string;
  readonly end: string | null;
}

const TERM_COLUMNS = new Set(['employeeNo', 'type', 'startDate', 'endDate']);

const overlaps = (a: Span, b: Span) =>
  a.start <= (b.end ?? '9999-12-31') && b.start <= (a.end ?? '9999-12-31');

export function createContractImport(deps: DataImportDeps) {
  const { database } = deps;

  async function load(connection?: DatabaseConnection) {
    const q = () => (connection ? connection.query : database.query());
    const [employees, contracts] = await Promise.all([
      q()
        .selectFrom('employees')
        .select(['id', 'employeeNo', 'probationEndDate'])
        .execute(),
      q()
        .selectFrom('employmentContracts')
        .select([
          'id',
          'employeeId',
          'contractNo',
          'type',
          'startDate',
          'endDate',
          'signedAt',
          'status',
          'note',
        ])
        .execute(),
    ]);
    return {
      employeeByNo: new Map(employees.map((e) => [str(e.employeeNo), e])),
      contractByNo: new Map(contracts.map((c) => [str(c.contractNo), c])),
      contracts,
    };
  }

  function same(
    stored: Record<string, unknown>,
    employeeId: string,
    row: ImportRow<Key>,
  ): boolean {
    const type = contractType(row.cells.type);
    return (
      str(stored.employeeId) === employeeId &&
      str(stored.type) === type &&
      toDateOnly(stored.startDate as string) === row.cells.startDate &&
      (toDateOnly(stored.endDate as string | null) ?? '') ===
        (type === 'openEnded' ? '' : row.cells.endDate) &&
      (!row.cells.signedAt ||
        toDateOnly(stored.signedAt as string | null) === row.cells.signedAt)
    );
  }

  async function validate(rows: ImportRow<Key>[]): Promise<ImportPreview<Key>> {
    const { employeeByNo, contractByNo, contracts } = await load();
    const today = deps.currentDate();
    const counts = new Map<string, number>();
    for (const row of rows)
      if (row.cells.contractNo)
        counts.set(
          row.cells.contractNo,
          (counts.get(row.cells.contractNo) ?? 0) + 1,
        );
    // Per employee, the spans to check: the stored contracts and the valid rows so far.
    const spans = new Map<string, Span[]>();
    for (const c of contracts) {
      if (str(c.status) === 'terminated') continue;
      const list = spans.get(str(c.employeeId)) ?? [];
      list.push({
        key: `stored:${str(c.id)}`,
        start: toDateOnly(c.startDate as string) ?? '',
        end: toDateOnly(c.endDate as string | null),
      });
      spans.set(str(c.employeeId), list);
    }
    const sorted = [...rows].sort((a, b) =>
      a.cells.startDate.localeCompare(b.cells.startDate),
    );
    for (const row of sorted) {
      const c = row.cells;
      const errors = row.errors;
      const employee = c.employeeNo
        ? employeeByNo.get(c.employeeNo)
        : undefined;
      if (!c.employeeNo)
        errors.push({ column: 'employeeNo', code: 'REQUIRED' });
      else if (!employee)
        errors.push({ column: 'employeeNo', code: 'EMPLOYEE_NOT_FOUND' });
      if (!c.contractNo)
        errors.push({ column: 'contractNo', code: 'REQUIRED' });
      else if (c.contractNo.length > 64)
        errors.push({ column: 'contractNo', code: 'TOO_LONG' });
      else if ((counts.get(c.contractNo) ?? 0) > 1)
        errors.push({ column: 'contractNo', code: 'DUPLICATE_IN_FILE' });
      const type = contractType(c.type);
      if (!c.type) errors.push({ column: 'type', code: 'REQUIRED' });
      else if (!type)
        errors.push({ column: 'type', code: 'CONTRACT_TYPE_INVALID' });
      const datesValid = (
        ['startDate', 'endDate', 'signedAt', 'probationEndDate'] as const
      )
        .map((key) => {
          if (validDate(c[key])) return true;
          errors.push({ column: key, code: 'DATE_INVALID' });
          return false;
        })
        .every(Boolean);
      if (!c.startDate) errors.push({ column: 'startDate', code: 'REQUIRED' });
      if (type === 'openEnded' && c.endDate)
        errors.push({ column: 'endDate', code: 'OPEN_ENDED_HAS_END' });
      if (type === 'fixedTerm' && !c.endDate)
        errors.push({ column: 'endDate', code: 'END_REQUIRED' });
      if (datesValid && c.startDate && c.endDate && c.endDate < c.startDate)
        errors.push({ column: 'endDate', code: 'END_BEFORE_START' });
      if (
        datesValid &&
        c.probationEndDate &&
        c.startDate &&
        (c.probationEndDate < c.startDate ||
          (c.endDate && type !== 'openEnded' && c.probationEndDate > c.endDate))
      )
        errors.push({ column: 'probationEndDate', code: 'PROBATION_OUTSIDE' });
      if (c.note.length > 4000)
        errors.push({ column: 'note', code: 'TOO_LONG' });
      row.action = 'create';
      const stored = c.contractNo ? contractByNo.get(c.contractNo) : undefined;
      if (stored && employee) {
        if (same(stored, str(employee.id), row)) row.action = 'unchanged';
        else errors.push({ column: 'contractNo', code: 'CONTRACT_NO_TAKEN' });
      } else if (stored)
        errors.push({ column: 'contractNo', code: 'CONTRACT_NO_TAKEN' });
      // A row whose term is readable takes part in the overlap check even when another cell is wrong,
      // so every problem shows in one preview.
      if (
        !employee ||
        row.action === 'unchanged' ||
        errors.some((e) => TERM_COLUMNS.has(e.column))
      )
        continue;
      const span: Span = {
        key: `row:${row.line}`,
        start: c.startDate,
        end: type === 'openEnded' ? null : c.endDate || null,
      };
      const list = spans.get(str(employee.id)) ?? [];
      if (list.some((other) => overlaps(other, span)))
        errors.push({ column: 'startDate', code: 'CONTRACT_OVERLAP' });
      else {
        // In effect (or yet to start) besides another such contract: only one may be.
        const current = (s: Span) => (s.end ?? '9999-12-31') >= today;
        if (current(span) && list.some(current))
          errors.push({ column: 'startDate', code: 'CONTRACT_ACTIVE_EXISTS' });
        else {
          list.push(span);
          spans.set(str(employee.id), list);
        }
      }
    }
    return summarize(rows);
  }

  return {
    columns: CONTRACT_COLUMNS,

    template(): Buffer {
      return buildTemplate(
        CONTRACT_COLUMNS,
        [
          [
            'E1001',
            'HT-2021-001',
            '固定期限',
            '2021-03-01',
            '2024-02-29',
            '2021-03-01',
            '2021-05-31',
            '',
          ],
          [
            'E1001',
            'HT-2024-015',
            '固定期限',
            '2024-03-01',
            '2027-02-28',
            '2024-02-20',
            '',
            '续签',
          ],
          [
            'E1002',
            'HT-2019-007',
            '无固定期限',
            '2019-07-01',
            '',
            '2019-06-28',
            '',
            '',
          ],
        ],
        'contracts',
      );
    },

    async preview(file: Buffer): Promise<ImportPreview<Key>> {
      return validate(readSheet(file, CONTRACT_COLUMNS));
    },

    async commit(userId: string, body: unknown) {
      const preview = await validate(rowsFromBody(body, CONTRACT_COLUMNS));
      assertNoErrors(preview);
      const today = deps.currentDate();
      const batchId = newBatchId('contracts', today);
      const result = await database.transaction(async (connection) => {
        const { employeeByNo, contracts } = await load(connection);
        const stamp = new Date();
        const work = preview.rows.filter((r) => r.action === 'create');
        // Per employee, every contract after the import, oldest first, to chain and date them.
        type Entry = {
          id: string;
          start: string;
          end: string | null;
          row?: ImportRow<Key>;
        };
        const timeline = new Map<string, Entry[]>();
        for (const c of contracts) {
          if (str(c.status) === 'terminated') continue;
          const list = timeline.get(str(c.employeeId)) ?? [];
          list.push({
            id: str(c.id),
            start: toDateOnly(c.startDate as string) ?? '',
            end: toDateOnly(c.endDate as string | null),
          });
          timeline.set(str(c.employeeId), list);
        }
        for (const row of work) {
          const employeeId = str(employeeByNo.get(row.cells.employeeNo)!.id);
          const list = timeline.get(employeeId) ?? [];
          list.push({
            id: newId(),
            start: row.cells.startDate,
            end:
              contractType(row.cells.type) === 'openEnded'
                ? null
                : row.cells.endDate || null,
            row,
          });
          timeline.set(employeeId, list);
        }
        const created: string[] = [];
        const probation: { employeeId: string; date: string }[] = [];
        let activeImported = 0;
        for (const [employeeId, list] of timeline) {
          list.sort((a, b) => a.start.localeCompare(b.start));
          for (const [index, entry] of list.entries()) {
            const row = entry.row;
            if (!row) continue;
            const previous = index > 0 ? list[index - 1] : undefined;
            const next = list[index + 1];
            const ended = entry.end !== null && entry.end < today;
            const status = !ended ? 'active' : next ? 'renewed' : 'expired';
            if (status === 'active') activeImported += 1;
            const notes = [row.cells.note];
            if (row.cells.probationEndDate) {
              if (status === 'active')
                probation.push({
                  employeeId,
                  date: row.cells.probationEndDate,
                });
              else notes.push(`试用期结束日期：${row.cells.probationEndDate}`);
            }
            const note = notes.filter(Boolean).join('；');
            await connection.query
              .insertInto('employmentContracts')
              .values({
                id: entry.id,
                employeeId,
                contractNo: row.cells.contractNo,
                type: contractType(row.cells.type)!,
                startDate: row.cells.startDate,
                endDate: entry.end,
                signedAt: row.cells.signedAt || null,
                status,
                previousContractId: previous?.id ?? null,
                fileId: null,
                note: note || null,
                createdAt: stamp,
                updatedAt: stamp,
              })
              .execute();
            created.push(entry.id);
          }
        }
        for (const { employeeId, date } of probation)
          await connection.query
            .updateTable('employees')
            .set({ probationEndDate: date, updatedAt: stamp })
            .where('id', '=', employeeId)
            .execute();
        await recordBatch(connection, {
          id: batchId,
          kind: 'contracts',
          userId,
          created,
          updated: [],
          unchanged: preview.unchanged,
        });
        return {
          batchId,
          created: created.length,
          updated: 0,
          unchanged: preview.unchanged,
          active: activeImported,
        };
      });
      if (result.created) deps.onContractsImported?.();
      return result;
    },

    async count(): Promise<number> {
      return database.repository('employmentContracts').count();
    },
  };
}
