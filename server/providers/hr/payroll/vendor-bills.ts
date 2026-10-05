/**
 * V2-06 派遣账单核对. A labour vendor's monthly bill (Excel: 工号、姓名、工时、
 * 金额) is parsed and previewed (unknown employee numbers named row by row),
 * then stored per vendor and month — a second upload replaces the lines and
 * keeps the earlier upload in `uploads`. The server reconciles each line
 * against the hours in the locked attendance of the month (the sum of the
 * daily records' worked minutes; a month not locked cannot be reconciled):
 * notMatched (no such employee number), notInAttendance (no attendance that
 * month), diff (hours differ). An AI employee may then write notes; the
 * payroll specialist confirms the bill or marks it disputed, and exports the
 * reconciliation (hours only) to reply to the vendor — sending it is theirs.
 *
 * Bill amounts are payroll data: only talent.vendorBill grants read bills,
 * and the reconciliation and exports carry hours, never amounts.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  iso,
  json,
  loadEmployees,
  monthRange,
  MONTH,
  num,
  toCsv,
} from './common.js';
import type { PayrollContext } from './context.js';
import { storeUpload } from './context.js';
import { numberCell, readSheet, textCell } from './excel.js';

const BILL = 'talent.vendorBill';

export interface BillLine {
  row: number;
  employeeNo: string;
  name: string;
  billedHours: number;
  amount: number | null;
}

export interface ReconciliationLine {
  employeeId: string | null;
  employeeNo: string;
  name: string;
  billedHours: number;
  attendanceHours: number | null;
  diffHours: number | null;
  reason: 'notMatched' | 'diff' | 'notInAttendance' | null;
}

const uploadSchema = z
  .object({
    vendorName: z.string().trim().min(1).max(200),
    month: z.string().regex(MONTH),
  })
  .strict();

export function toBill(row: Record<string, unknown>, withAmounts: boolean) {
  const lines = json<BillLine[]>(row.lines, []);
  return {
    id: str(row.id),
    vendorName: str(row.vendorName),
    month: str(row.month),
    fileId: str(row.fileId),
    lines: withAmounts ? lines : lines.map((l) => ({ ...l, amount: null })),
    reconciliation: json<ReconciliationLine[]>(row.reconciliation, []),
    aiNotes: row.aiNotes ? str(row.aiNotes) : null,
    status: str(row.status) as
      'uploaded' | 'reconciled' | 'confirmed' | 'disputed',
    confirmedBy: row.confirmedBy ? str(row.confirmedBy) : null,
    confirmedAt: iso(row.confirmedAt),
    uploads: json<{ fileId: string; by: string; at: string; rows: number }[]>(
      row.uploads,
      [],
    ),
    // V2-06 邮件往来: the billing mailbox message the bill came from.
    sourceMailId: row.sourceMailId ? str(row.sourceMailId) : null,
    updatedAt: iso(row.updatedAt),
  };
}

export function totalsOf(reconciliation: readonly ReconciliationLine[]) {
  const matched = reconciliation.filter((l) => l.employeeId);
  const round = (v: number) => Math.round(v * 100) / 100;
  return {
    billedHours: round(matched.reduce((s, l) => s + l.billedHours, 0)),
    attendanceHours: round(
      matched.reduce((s, l) => s + (l.attendanceHours ?? 0), 0),
    ),
    diffHours: round(matched.reduce((s, l) => s + (l.diffHours ?? 0), 0)),
    diffPeople: matched.filter((l) => l.reason === 'diff').length,
    unmatched: reconciliation.filter((l) => l.reason === 'notMatched').length,
    notInAttendance: reconciliation.filter(
      (l) => l.reason === 'notInAttendance',
    ).length,
  };
}

export function createVendorBillService(ctx: PayrollContext) {
  const { platform } = ctx;
  const { database } = platform;

  function parse(buffer: Uint8Array): {
    lines: BillLine[];
    errors: { row: number; code: string }[];
  } {
    const { rows } = readSheet(buffer);
    const lines: BillLine[] = [];
    const errors: { row: number; code: string }[] = [];
    for (const r of rows) {
      const v = r.values;
      const employeeNo = textCell(v['工号'] ?? v.employeeNo);
      const hours = numberCell(v['工时'] ?? v['账单工时'] ?? v.billedHours);
      const amount = numberCell(v['金额'] ?? v['账单金额'] ?? v.amount);
      if (!employeeNo) {
        errors.push({ row: r.row, code: 'EMPLOYEE_NO_REQUIRED' });
        continue;
      }
      if (hours === null || hours < 0) {
        errors.push({ row: r.row, code: 'HOURS_INVALID' });
        continue;
      }
      lines.push({
        row: r.row,
        employeeNo,
        name: textCell(v['姓名'] ?? v.name),
        billedHours: hours,
        amount,
      });
    }
    return { lines, errors };
  }

  async function reconcile(month: string, lines: readonly BillLine[]) {
    const employees = new Map(
      (await loadEmployees(database.query())).map((e) => [e.employeeNo, e]),
    );
    const { from, to } = monthRange(month);
    const matchedIds = lines
      .map((l) => employees.get(l.employeeNo)?.id)
      .filter((id): id is string => Boolean(id));
    const summaries = matchedIds.length
      ? await database
          .query()
          .selectFrom('attendanceMonthlySummaries')
          .select(['employeeId', 'status'])
          .where('month', '=', month)
          .where('employeeId', 'in', matchedIds)
          .execute()
      : [];
    const locked = new Set(
      summaries
        .filter((s) => str(s.status) === 'locked')
        .map((s) => str(s.employeeId)),
    );
    const withSummary = new Set(summaries.map((s) => str(s.employeeId)));
    const notLocked = matchedIds.filter(
      (id) => withSummary.has(id) && !locked.has(id),
    );
    if (notLocked.length)
      throw new HrError('BILL_ATTENDANCE_NOT_LOCKED', 409, {
        names: notLocked.map(
          (id) => [...employees.values()].find((e) => e.id === id)?.name ?? id,
        ),
      });
    const records = matchedIds.length
      ? await database
          .query()
          .selectFrom('attendanceRecords')
          .select(['employeeId', 'workedMinutes'])
          .where('date', '>=', from)
          .where('date', '<=', to)
          .where('employeeId', 'in', matchedIds)
          .execute()
      : [];
    const minutes = new Map<string, number>();
    for (const r of records)
      minutes.set(
        str(r.employeeId),
        (minutes.get(str(r.employeeId)) ?? 0) + num(r.workedMinutes),
      );
    return lines.map<ReconciliationLine>((line) => {
      const employee = employees.get(line.employeeNo);
      if (!employee)
        return {
          employeeId: null,
          employeeNo: line.employeeNo,
          name: line.name,
          billedHours: line.billedHours,
          attendanceHours: null,
          diffHours: null,
          reason: 'notMatched',
        };
      if (!locked.has(employee.id))
        return {
          employeeId: employee.id,
          employeeNo: line.employeeNo,
          name: employee.name,
          billedHours: line.billedHours,
          attendanceHours: 0,
          diffHours: line.billedHours,
          reason: 'notInAttendance',
        };
      const hours =
        Math.round(((minutes.get(employee.id) ?? 0) / 60) * 100) / 100;
      const diff = Math.round((line.billedHours - hours) * 100) / 100;
      return {
        employeeId: employee.id,
        employeeNo: line.employeeNo,
        name: employee.name,
        billedHours: line.billedHours,
        attendanceHours: hours,
        diffHours: diff,
        reason: Math.abs(diff) > 0.01 ? 'diff' : null,
      };
    });
  }

  async function row(id: string) {
    const found = await database
      .query()
      .selectFrom('laborVendorBills')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('BILL_NOT_FOUND', 404);
    return found as Record<string, unknown>;
  }

  const service = {
    reconcile,
    totalsOf,

    async list(actor: ActorContext) {
      await authorizeAction(actor.authz, BILL, 'view');
      const rows = await database
        .query()
        .selectFrom('laborVendorBills')
        .selectAll()
        .orderBy('month', 'desc')
        .execute();
      return rows.map((r) => {
        const bill = toBill(r, true);
        return { ...bill, totals: totalsOf(bill.reconciliation) };
      });
    },

    async get(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, BILL, 'view');
      const bill = toBill(await row(id), true);
      return { ...bill, totals: totalsOf(bill.reconciliation) };
    },

    async preview(actor: ActorContext, input: unknown, buffer: Uint8Array) {
      await authorizeAction(actor.authz, BILL, 'upload');
      const meta = uploadSchema.safeParse(input);
      if (!meta.success) throw new HrError('INVALID_INPUT', 400);
      const parsed = parse(buffer);
      const employees = new Map(
        (await loadEmployees(database.query())).map((e) => [e.employeeNo, e]),
      );
      return {
        vendorName: meta.data.vendorName,
        month: meta.data.month,
        lines: parsed.lines.map((l) => ({
          ...l,
          employeeId: employees.get(l.employeeNo)?.id ?? null,
          matched: employees.has(l.employeeNo),
        })),
        unmatched: parsed.lines
          .filter((l) => !employees.has(l.employeeNo))
          .map((l) => ({
            row: l.row,
            employeeNo: l.employeeNo,
            name: l.name,
            code: 'EMPLOYEE_NOT_FOUND',
          })),
        errors: parsed.errors,
      };
    },

    async upload(
      actor: ActorContext,
      input: unknown,
      file: { name: string; bytes: Uint8Array },
    ) {
      await authorizeAction(actor.authz, BILL, 'upload');
      const meta = uploadSchema.safeParse(input);
      if (!meta.success) throw new HrError('INVALID_INPUT', 400);
      const parsed = parse(file.bytes);
      if (!parsed.lines.length) throw new HrError('IMPORT_FILE_EMPTY', 400);
      if (parsed.errors.length)
        throw new HrError('IMPORT_HAS_ERRORS', 400, {
          rows: parsed.errors.map((e) => e.row),
        });
      const reconciliation = await reconcile(meta.data.month, parsed.lines);
      const fileId = await storeUpload(ctx, actor, file);
      const existing = await database
        .query()
        .selectFrom('laborVendorBills')
        .selectAll()
        .where('vendorName', '=', meta.data.vendorName)
        .where('month', '=', meta.data.month)
        .executeTakeFirst();
      const now = new Date();
      const upload = {
        fileId,
        by: actor.userId,
        at: now.toISOString(),
        rows: parsed.lines.length,
      };
      let id: string;
      if (existing) {
        id = str(existing.id);
        await database
          .query()
          .updateTable('laborVendorBills')
          .set({
            fileId,
            lines: parsed.lines,
            reconciliation,
            aiNotes: null,
            status: 'uploaded',
            confirmedBy: null,
            confirmedAt: null,
            uploads: [...json<unknown[]>(existing.uploads, []), upload],
            updatedAt: now,
          })
          .where('id', '=', id)
          .execute();
      } else {
        id = newId();
        await database
          .query()
          .insertInto('laborVendorBills')
          .values({
            id,
            vendorName: meta.data.vendorName,
            month: meta.data.month,
            fileId,
            lines: parsed.lines,
            reconciliation,
            aiNotes: null,
            status: 'uploaded',
            confirmedBy: null,
            confirmedAt: null,
            uploads: [upload],
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      ctx.audit({
        event: 'payroll.vendorBill.upload',
        billId: id,
        month: meta.data.month,
        by: actor.userId,
      });
      ctx.onBillUploaded(id);
      const bill = toBill(await row(id), true);
      return { ...bill, totals: totalsOf(bill.reconciliation) };
    },

    /** getVendorBillReconciliation: hours only, never amounts. */
    async reconciliationFor(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, BILL, 'view');
      const bill = toBill(await row(id), false);
      return {
        id: bill.id,
        vendorName: bill.vendorName,
        month: bill.month,
        status: bill.status,
        lines: bill.reconciliation,
        totals: totalsOf(bill.reconciliation),
      };
    },

    /** saveVendorBillNotes: only the notes; lines and reconciliation stay. */
    async saveNotes(actor: ActorContext, id: string, notes: unknown) {
      await authorizeAction(actor.authz, BILL, 'upload');
      if (typeof notes !== 'string' || !notes.trim())
        throw new HrError('INVALID_INPUT', 400);
      const bill = toBill(await row(id), false);
      if (bill.status === 'confirmed') throw new HrError('BILL_CONFIRMED', 409);
      await database
        .query()
        .updateTable('laborVendorBills')
        .set({
          aiNotes: notes.trim().slice(0, 4000),
          status: bill.status === 'disputed' ? 'disputed' : 'reconciled',
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return {
        id,
        status: bill.status === 'disputed' ? 'disputed' : 'reconciled',
      };
    },

    async decide(
      actor: ActorContext,
      id: string,
      decision: 'confirmed' | 'disputed',
    ) {
      await authorizeAction(actor.authz, BILL, 'confirm');
      await row(id);
      const now = new Date();
      await database
        .query()
        .updateTable('laborVendorBills')
        .set({
          status: decision,
          confirmedBy: actor.userId,
          confirmedAt: now,
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      const bill = toBill(await row(id), true);
      return { ...bill, totals: totalsOf(bill.reconciliation) };
    },

    async exportCsv(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, BILL, 'export');
      const bill = toBill(await row(id), false);
      const reasons: Record<string, string> = {
        notMatched: '工号不存在',
        diff: '工时不一致',
        notInAttendance: '无考勤记录',
      };
      const rows: unknown[][] = [
        [
          '派遣公司',
          '月份',
          '工号',
          '姓名',
          '账单工时',
          '考勤工时',
          '差异工时',
          '核对结果',
        ],
      ];
      for (const line of bill.reconciliation)
        rows.push([
          bill.vendorName,
          bill.month,
          line.employeeNo,
          line.name,
          line.billedHours,
          line.attendanceHours ?? '',
          line.diffHours ?? '',
          line.reason ? reasons[line.reason] : '一致',
        ]);
      const totals = totalsOf(bill.reconciliation);
      rows.push([
        bill.vendorName,
        bill.month,
        '合计',
        '',
        totals.billedHours,
        totals.attendanceHours,
        totals.diffHours,
        '',
      ]);
      if (bill.aiNotes) rows.push(['说明', bill.aiNotes]);
      ctx.audit({
        event: 'payroll.export',
        kind: 'vendorBill',
        billId: id,
        by: actor.userId,
      });
      return {
        filename: `${bill.month}-${bill.vendorName}-reconciliation.csv`,
        content: toCsv(rows),
      };
    },
  };
  return service;
}

export type VendorBillService = ReturnType<typeof createVendorBillService>;
