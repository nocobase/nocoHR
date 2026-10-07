/**
 * V4-14 审计导出 (extends V3-11; talent.audit, hr.admin and hr.auditor,
 * read-only). Each export writes `auditExports` like the V3-11 ones.
 *
 * - 持证操作追溯 (Excel, `exportStartTrace`): per step of a business document
 *   (the demo's work order or dispatch note), who registered, when, the certificate number and status at
 *   registration, the certificate's status now, and when the registrant
 *   completed the certification's required courses. Offered only where the
 *   demo start logs exist.
 * - 权限变化记录 (Excel, `exportPermissionChanges`): for a person or a
 *   certification over a period, the permission sets gained or lost through
 *   a certificate or a change of the certification subject's assignments.
 *   Sources, without new fields: the certificate's issue date (发证, or 续发
 *   when it superseded one: the sets continue), its verification time
 *   (external, 核验), the day it was marked expired or revoked (its
 *   `updatedAt`: 到期 / 吊销), the leaving date (离职), and the assignment
 *   history (分配变更, settings.ts). The sets a certification carried on a
 *   day are the current assignments with later history entries undone.
 *
 * Both limit people to the exporter's employee scope. Neither carries
 * mobile numbers, ID numbers or pay.
 */
import * as XLSX from 'xlsx';
import { z } from 'zod';

import { authorizeAction, policyOf } from '../authorize.js';
import type { DemoBatchService, SignoffTrace } from '../demo-batch.js';
import type { ActorContext } from '../framework-service.js';
import type { Platform } from '../platform.js';
import { HrError, isDateOnly, newId, str } from '../shared.js';
import type { GrantHistory } from './settings.js';

const AUDIT = 'talent.audit';

export type PermissionChangeReason =
  'issue' | 'renew' | 'expire' | 'revoke' | 'verify' | 'leave' | 'assignment';

export interface PermissionChangeRow {
  readonly date: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly employeeNo: string;
  readonly certificationId: string;
  readonly certification: string;
  readonly certificateNo: string;
  readonly change: 'gained' | 'lost' | 'kept';
  readonly permissionSets: readonly string[];
  readonly reason: PermissionChangeReason;
  /** The record the change rests on, as an application path. */
  readonly link: string;
}

const REASON_LABEL: Record<PermissionChangeReason, string> = {
  issue: '发证',
  renew: '续发',
  expire: '到期',
  revoke: '吊销',
  verify: '核验',
  leave: '离职',
  assignment: '分配变更',
};
const CHANGE_LABEL = { gained: '获得', lost: '失去', kept: '延续' } as const;
const STATUS_LABEL: Record<string, string> = {
  valid: '有效',
  expiring: '即将到期',
  expired: '已过期',
  revoked: '已吊销',
  superseded: '已续发',
  pending: '待核验',
};

const day = (value: unknown): string | null =>
  value === null || value === undefined || value === ''
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : str(value).slice(0, 10);

const permissionQuery = z
  .object({
    employeeId: z.string().min(1).max(64).optional(),
    certificationId: z.string().min(1).max(64).optional(),
    from: z.string().refine(isDateOnly),
    to: z.string().refine(isDateOnly),
  })
  .refine((q) => Boolean(q.employeeId) !== Boolean(q.certificationId))
  .refine((q) => q.from <= q.to);

export function createLicensedExports(deps: {
  readonly platform: Platform;
  readonly demoBatch: () => DemoBatchService;
  readonly grantHistory: () => Promise<GrantHistory>;
  readonly titleText: (title: unknown) => string;
}) {
  const { platform } = deps;
  const { database } = platform;
  /** A timestamp's day in the application time zone (date-only columns keep their own day). */
  const localDay = (value: unknown): string | null => {
    if (value === null || value === undefined || value === '') return null;
    const date = value instanceof Date ? value : new Date(str(value));
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: platform.timeZone,
    }).format(date);
  };

  async function scopedEmployees(
    ctx: ActorContext,
    action: string,
  ): Promise<Map<string, Record<string, unknown>>> {
    const policies = await authorizeAction(ctx.authz, AUDIT, action);
    const rows = (await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({})) as Record<string, unknown>[];
    return new Map(rows.map((row) => [str(row.id), row]));
  }

  async function log(
    ctx: ActorContext,
    entry: { kind: string; scope: unknown; fileName: string; summary: string },
  ): Promise<void> {
    const stamp = new Date();
    await database
      .query()
      .insertInto('auditExports')
      .values({
        id: newId(),
        kind: entry.kind,
        actorUserId: ctx.userId,
        scope: (entry.scope ?? null) as Record<string, unknown> | null,
        fileName: entry.fileName,
        summary: entry.summary.slice(0, 2000),
        via: 'page',
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
  }

  function workbook(rows: unknown[][], name: string): Uint8Array {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), name);
    return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Uint8Array;
  }

  /** Whether the demonstration start logs exist (the start trace is offered only then). */
  async function startTraceAvailable(): Promise<boolean> {
    return Boolean(
      await database
        .query()
        .selectFrom('demoBatchSignoffs')
        .select(['id'])
        .executeTakeFirst(),
    );
  }

  async function startTrace(
    ctx: ActorContext,
    input: { workOrderNo: string; step?: string; kind?: string },
  ): Promise<SignoffTrace[]> {
    const people = await scopedEmployees(ctx, 'exportStartTrace');
    return deps
      .demoBatch()
      .traceWithin(
        new Set(people.keys()),
        input.workOrderNo,
        input.step,
        input.kind,
      );
  }

  /** Permission sets per certification on a day: today's assignments with later entries undone. */
  function setsAt(
    history: GrantHistory,
    certificationId: string,
    date: string,
  ) {
    const sets = new Set(history.snapshot[certificationId] ?? []);
    for (const entry of [...history.entries].reverse()) {
      if (entry.certificationId !== certificationId || !entry.at) continue;
      if ((localDay(entry.at) ?? '') <= date) break;
      if (entry.change === 'assigned') sets.delete(entry.permissionSet);
      else sets.add(entry.permissionSet);
    }
    return sets;
  }

  async function permissionChanges(
    ctx: ActorContext,
    input: unknown,
  ): Promise<PermissionChangeRow[]> {
    const parsed = permissionQuery.safeParse(input);
    if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
    const query = parsed.data;
    const people = await scopedEmployees(ctx, 'exportPermissionChanges');
    if (query.employeeId && !people.has(query.employeeId))
      throw new HrError('NOT_FOUND', 404);
    let builder = database
      .query()
      .selectFrom('employeeCertificates')
      .selectAll();
    if (query.employeeId)
      builder = builder.where('employeeId', '=', query.employeeId);
    if (query.certificationId)
      builder = builder.where('certificationId', '=', query.certificationId);
    const certificates = (await builder.execute()).filter((row) =>
      people.has(str(row.employeeId)),
    );
    const certifications = new Map(
      (
        await database
          .query()
          .selectFrom('certifications')
          .select(['id', 'title'])
          .execute()
      ).map((row) => [str(row.id), str(row.title)]),
    );
    const titles = new Map(
      (await platform.authz.permissionSets.list()).map((set) => [
        set.key,
        deps.titleText(set.title ?? set.key) || set.key,
      ]),
    );
    const history = await deps.grantHistory();
    const superseding = new Set(
      certificates
        .filter((row) => row.supersededById)
        .map((row) => str(row.supersededById)),
    );
    const rows: PermissionChangeRow[] = [];
    const push = (
      row: Record<string, unknown>,
      date: string | null,
      change: PermissionChangeRow['change'],
      reason: PermissionChangeReason,
      sets: Iterable<string>,
      link?: string,
    ) => {
      const list = [...sets];
      if (!date || date < query.from || date > query.to || !list.length) return;
      const person = people.get(str(row.employeeId))!;
      rows.push({
        date,
        employeeId: str(row.employeeId),
        employeeName: str(person.name),
        employeeNo: str(person.employeeNo ?? ''),
        certificationId: str(row.certificationId),
        certification: certifications.get(str(row.certificationId)) ?? '',
        certificateNo: str(row.certificateNo),
        change,
        permissionSets: list.map((key) => titles.get(key) ?? key),
        reason,
        link:
          link ??
          `/talent/certifications/${encodeURIComponent(str(row.certificationId))}`,
      });
    };
    for (const row of certificates) {
      const certificationId = str(row.certificationId);
      const status = str(row.status);
      const external = str(row.source) === 'external';
      const start = external
        ? row.verifyStatus === 'verified'
          ? localDay(row.verifiedAt)
          : null
        : day(row.issuedAt);
      if (start) {
        const renewed = superseding.has(str(row.id));
        push(
          row,
          start,
          renewed ? 'kept' : 'gained',
          external ? 'verify' : renewed ? 'renew' : 'issue',
          setsAt(history, certificationId, start),
        );
      }
      let end: string | null = null;
      if (status === 'expired' || status === 'revoked') {
        end = localDay(row.updatedAt);
        push(
          row,
          end,
          'lost',
          status === 'expired' ? 'expire' : 'revoke',
          end ? setsAt(history, certificationId, end) : [],
        );
      }
      const person = people.get(str(row.employeeId))!;
      const leftOn =
        str(person.status) === 'leave' ? day(person.leaveDate) : null;
      if (
        leftOn &&
        start &&
        leftOn >= start &&
        (!end || leftOn < end) &&
        status !== 'superseded'
      ) {
        push(
          row,
          leftOn,
          'lost',
          'leave',
          setsAt(history, certificationId, leftOn),
          `/talent/employees/${encodeURIComponent(str(row.employeeId))}/profile`,
        );
        end = leftOn;
      }
      // The certification's assignments changed while this certificate was held.
      if (start && status !== 'pending')
        for (const entry of history.entries) {
          if (entry.certificationId !== certificationId || !entry.at) continue;
          const date = localDay(entry.at)!;
          const until =
            end ?? (status === 'superseded' ? localDay(row.updatedAt) : null);
          if (date < start || (until && date >= until)) continue;
          push(
            row,
            date,
            entry.change === 'assigned' ? 'gained' : 'lost',
            'assignment',
            [entry.permissionSet],
            '/settings/authorization/permission-sets',
          );
        }
    }
    return rows.sort(
      (a, b) =>
        a.date.localeCompare(b.date) ||
        a.employeeNo.localeCompare(b.employeeNo),
    );
  }

  return {
    startTraceAvailable,
    startTrace,
    permissionChanges,

    async startTraceFile(
      ctx: ActorContext,
      input: { workOrderNo: string; step?: string; kind?: string },
    ) {
      if (!input.workOrderNo || input.workOrderNo.length > 32)
        throw new HrError('INVALID_INPUT', 400);
      const trace = await startTrace(ctx, input);
      // Industry-neutral headers (业务单号 / 步骤 / 资产编号): a work order's operation and machine are
      // one industry's names for these; the data and the export's name in routes and permissions stay.
      const header = [
        '业务单号',
        '步骤',
        '资产编号',
        '登记人',
        '登记时间',
        '登记时证书编号',
        '登记时证书状态',
        '证书当前状态',
        '证书到期日',
        '必修课程完成时间',
        '依据记录',
      ];
      const body = trace.map((entry) => [
        input.workOrderNo,
        entry.step,
        entry.machineNo ?? '',
        entry.employeeName,
        entry.signedAt,
        entry.certificateNo ?? '',
        STATUS_LABEL[entry.certificateStatusAtSigning ?? ''] ??
          entry.certificateStatusAtSigning ??
          '',
        STATUS_LABEL[entry.certificateStatusNow ?? ''] ??
          entry.certificateStatusNow ??
          '',
        entry.certificateExpiresAt ?? '',
        entry.requiredCourses
          .map((c) => `${c.title}：${c.completedAt ?? '未完成'}`)
          .join('；'),
        entry.links.certificate ?? entry.links.employee,
      ]);
      const fileName = `start-trace-${input.workOrderNo}.xlsx`;
      await log(ctx, {
        kind: 'startTrace',
        scope: input,
        fileName,
        summary: `${input.workOrderNo}${input.step ? ` 步骤 ${input.step}` : ''}：${trace.length} 条登记`,
      });
      return {
        bytes: workbook([header, ...body], '持证操作追溯'),
        fileName,
        count: trace.length,
      };
    },

    async permissionChangesFile(ctx: ActorContext, input: unknown) {
      const rows = await permissionChanges(ctx, input);
      const query = input as {
        employeeId?: string;
        certificationId?: string;
        from: string;
        to: string;
      };
      const header = [
        '日期',
        '员工',
        '工号',
        '认证',
        '证书编号',
        '变化',
        '权限集',
        '原因',
        '依据记录',
      ];
      const body = rows.map((row) => [
        row.date,
        row.employeeName,
        row.employeeNo,
        row.certification,
        row.certificateNo,
        CHANGE_LABEL[row.change],
        row.permissionSets.join('、'),
        REASON_LABEL[row.reason],
        row.link,
      ]);
      const fileName = `permission-changes-${query.from}-${query.to}.xlsx`;
      await log(ctx, {
        kind: 'permissionChanges',
        scope: {
          employeeId: query.employeeId ?? null,
          certificationId: query.certificationId ?? null,
          from: query.from,
          to: query.to,
        },
        fileName,
        summary: `${query.from} ~ ${query.to}：${rows.length} 条权限变化`,
      });
      return {
        bytes: workbook([header, ...body], '权限变化记录'),
        fileName,
        count: rows.length,
      };
    },
  };
}

export type LicensedExports = ReturnType<typeof createLicensedExports>;
