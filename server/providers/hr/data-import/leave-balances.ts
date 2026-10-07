/**
 * 期初假期余额导入: each employee's balance of a leave type for a year at
 * go-live, from Excel.
 *
 * - Only leave types that keep a balance (年假 by seniority, 调休 earned) may
 *   be imported; the type is named by its title or code.
 * - The balance is written through the same ledger as 余额 · 调整: one
 *   adjustment entry "期初导入" per row, by the importer, with the batch
 *   number, the opening balance, the days already used before go-live and
 *   the note. Its delta brings the balance's own days (应有 + 结转 + 调整)
 *   to the opening balance, so leave taken in the system afterwards is
 *   counted on top, and importing a row again corrects the balance with a
 *   new entry instead of adding to it. A missing balance row is created
 *   with nothing but that entry.
 * - 已用 is recorded in the entry, not as 已用: the system's 已用 counts
 *   only leave requested in the system.
 * - Employees who left are refused, as an adjustment is.
 */
import type { DatabaseConnection } from '@nocobase/db';

import { lockAttendanceSettings } from '../attendance-settings.js';
import { leaveBalanceAmounts, readAdjustmentHistory } from '../leave-policy.js';
import { HrError, newId, str } from '../shared.js';
import {
  assertNoErrors,
  buildTemplate,
  fourDecimals,
  newBatchId,
  parseNumber,
  readSheet,
  recordBatch,
  rowsFromBody,
  summarize,
  type ImportColumn,
  type ImportPreview,
  type ImportRow,
} from './shared.js';
import type { DataImportDeps } from './types.js';

type Key = 'employeeNo' | 'leaveType' | 'year' | 'opening' | 'used' | 'note';

export const LEAVE_BALANCE_COLUMNS: readonly ImportColumn<Key>[] = [
  { key: 'employeeNo', title: '工号', titleEn: 'Employee no.', required: true },
  {
    key: 'leaveType',
    title: '假期类型',
    titleEn: 'Leave type',
    required: true,
  },
  { key: 'year', title: '年度', titleEn: 'Year', required: true },
  {
    key: 'opening',
    title: '期初余额(天)',
    titleEn: 'Opening balance (days)',
    required: true,
  },
  { key: 'used', title: '已用(天)', titleEn: 'Used (days)' },
  { key: 'note', title: '备注', titleEn: 'Note' },
];

const BALANCE_RULES = new Set(['annualBySeniority', 'earned']);
const MAX_DAYS = 366;

export function createLeaveBalanceImport(deps: DataImportDeps) {
  const { database } = deps;

  async function load(connection?: DatabaseConnection) {
    const q = () => (connection ? connection.query : database.query());
    const [employees, types, balances] = await Promise.all([
      q()
        .selectFrom('employees')
        .select(['id', 'employeeNo', 'status'])
        .execute(),
      q()
        .selectFrom('leaveTypes')
        .select(['id', 'code', 'title', 'balanceRule', 'active'])
        .execute(),
      q()
        .selectFrom('leaveBalances')
        .select(['id', 'employeeId', 'leaveTypeId', 'year'])
        .execute(),
    ]);
    const typeByKey = new Map<string, Record<string, unknown>>();
    for (const t of types) {
      typeByKey.set(`title:${str(t.title).trim()}`, t);
      typeByKey.set(`code:${str(t.code).trim().toLowerCase()}`, t);
    }
    return {
      employeeByNo: new Map(employees.map((e) => [str(e.employeeNo), e])),
      typeOf: (cell: string) =>
        typeByKey.get(`code:${cell.toLowerCase()}`) ??
        typeByKey.get(`title:${cell}`),
      balanceKeys: new Set(
        balances.map(
          (b) => `${str(b.employeeId)}:${str(b.leaveTypeId)}:${Number(b.year)}`,
        ),
      ),
    };
  }

  async function validate(rows: ImportRow<Key>[]): Promise<ImportPreview<Key>> {
    const { employeeByNo, typeOf, balanceKeys } = await load();
    const seen = new Map<string, number>();
    // A type named by its title on one row and its code on another is the same balance.
    const keyOf = (row: ImportRow<Key>) =>
      `${row.cells.employeeNo}:${str(typeOf(row.cells.leaveType)?.id ?? row.cells.leaveType)}:${row.cells.year}`;
    for (const row of rows)
      seen.set(keyOf(row), (seen.get(keyOf(row)) ?? 0) + 1);
    for (const row of rows) {
      const c = row.cells;
      const errors = row.errors;
      const employee = c.employeeNo
        ? employeeByNo.get(c.employeeNo)
        : undefined;
      if (!c.employeeNo)
        errors.push({ column: 'employeeNo', code: 'REQUIRED' });
      else if (!employee)
        errors.push({ column: 'employeeNo', code: 'EMPLOYEE_NOT_FOUND' });
      else if (str(employee.status) === 'leave')
        errors.push({ column: 'employeeNo', code: 'EMPLOYEE_LEFT' });
      const type = c.leaveType ? typeOf(c.leaveType) : undefined;
      if (!c.leaveType) errors.push({ column: 'leaveType', code: 'REQUIRED' });
      else if (!type)
        errors.push({ column: 'leaveType', code: 'LEAVE_TYPE_NOT_FOUND' });
      else if (!BALANCE_RULES.has(str(type.balanceRule)))
        errors.push({ column: 'leaveType', code: 'LEAVE_TYPE_NO_BALANCE' });
      const year = Number(c.year);
      if (!c.year) errors.push({ column: 'year', code: 'REQUIRED' });
      else if (!/^\d{4}$/u.test(c.year) || year < 1900 || year > 2200)
        errors.push({ column: 'year', code: 'YEAR_INVALID' });
      const opening = parseNumber(c.opening);
      if (!c.opening) errors.push({ column: 'opening', code: 'REQUIRED' });
      else if (
        opening === null ||
        opening < 0 ||
        opening > MAX_DAYS ||
        !fourDecimals(opening)
      )
        errors.push({ column: 'opening', code: 'DAYS_INVALID' });
      if (c.used) {
        const used = parseNumber(c.used);
        if (used === null || used < 0 || used > MAX_DAYS || !fourDecimals(used))
          errors.push({ column: 'used', code: 'DAYS_INVALID' });
      }
      if (c.note.length > 500)
        errors.push({ column: 'note', code: 'TOO_LONG' });
      if ((seen.get(keyOf(row)) ?? 0) > 1)
        errors.push({ column: 'leaveType', code: 'DUPLICATE_IN_FILE' });
      row.action =
        employee &&
        type &&
        balanceKeys.has(`${str(employee.id)}:${str(type.id)}:${year}`)
          ? 'update'
          : 'create';
    }
    return summarize(rows);
  }

  return {
    columns: LEAVE_BALANCE_COLUMNS,

    template(): Buffer {
      const year = deps.currentDate().slice(0, 4);
      return buildTemplate(
        LEAVE_BALANCE_COLUMNS,
        [
          ['E1001', '年假', year, '7.5', '2.5', ''],
          ['E1002', '年假', year, '10', '', ''],
        ],
        'leave-balances',
      );
    },

    async preview(file: Buffer): Promise<ImportPreview<Key>> {
      return validate(readSheet(file, LEAVE_BALANCE_COLUMNS));
    },

    async commit(userId: string, body: unknown) {
      const preview = await validate(rowsFromBody(body, LEAVE_BALANCE_COLUMNS));
      assertNoErrors(preview);
      const today = deps.currentDate();
      const batchId = newBatchId('leaveBalances', today);
      return database.transaction(async (connection) => {
        // The lock every balance change takes, so a request approved meanwhile cannot interleave.
        await lockAttendanceSettings(connection, userId);
        const { employeeByNo, typeOf } = await load(connection);
        const created: string[] = [];
        const updated: string[] = [];
        for (const row of preview.rows) {
          const c = row.cells;
          const employeeId = str(employeeByNo.get(c.employeeNo)!.id);
          const leaveTypeId = str(typeOf(c.leaveType)!.id);
          const year = Number(c.year);
          const opening = Number(c.opening);
          const stored = await connection.query
            .selectFrom('leaveBalances')
            .selectAll()
            .where('employeeId', '=', employeeId)
            .where('leaveTypeId', '=', leaveTypeId)
            .where('year', '=', year)
            .executeTakeFirst();
          const stamp = new Date();
          let balance: Record<string, unknown>;
          if (stored) {
            balance = stored;
            updated.push(str(stored.id));
          } else {
            balance = {
              id: newId(),
              employeeId,
              leaveTypeId,
              year,
              entitled: 0,
              carriedOver: 0,
              used: 0,
              pending: 0,
              expiresAt: null,
              // The query builder serializes JSON columns itself.
              adjustments: [],
              createdAt: stamp,
              updatedAt: stamp,
            };
            await connection.query
              .insertInto('leaveBalances')
              .values(balance)
              .execute();
            created.push(str(balance.id));
          }
          const history = readAdjustmentHistory(parseJson(balance.adjustments));
          if (history.length >= 1000)
            throw new HrError('ADJUSTMENT_HISTORY_FULL', 409);
          const amounts = leaveBalanceAmounts(
            {
              entitled: balance.entitled,
              carriedOver: balance.carriedOver,
              used: balance.used,
              pending: balance.pending,
              expiresAt: balance.expiresAt,
              adjustments: history,
            },
            today,
          );
          // The balance's own days before anything taken in the system.
          const own = amounts.available + amounts.used + amounts.pending;
          const delta = Math.round((opening - own) * 10000) / 10000;
          const reason = [
            `期初导入 ${batchId}：期初余额 ${opening} 天`,
            c.used ? `已用 ${Number(c.used)} 天` : '',
            c.note,
          ]
            .filter(Boolean)
            .join('；');
          const adjustments = [
            ...history,
            {
              idempotencyKey: `opening-import:${batchId}:${row.line}`,
              delta,
              reason,
              by: userId,
              at: stamp.toISOString(),
            },
          ];
          await connection.query
            .updateTable('leaveBalances')
            .set({
              adjustments,
              updatedAt: new Date(
                Math.max(
                  stamp.getTime(),
                  new Date(str(balance.updatedAt)).getTime() + 1,
                ),
              ),
            })
            .where('id', '=', str(balance.id))
            .execute();
        }
        await recordBatch(connection, {
          id: batchId,
          kind: 'leaveBalances',
          userId,
          created,
          updated,
          unchanged: 0,
        });
        return {
          batchId,
          created: created.length,
          updated: updated.length,
          unchanged: 0,
        };
      });
    },

    async count(): Promise<number> {
      return database
        .repository('leaveBalances')
        .count({ filter: { year: Number(deps.currentDate().slice(0, 4)) } });
    },
  };
}

function parseJson(value: unknown): unknown {
  let current = value;
  for (let i = 0; i < 3 && typeof current === 'string'; i++)
    current = JSON.parse(current);
  return current ?? [];
}
