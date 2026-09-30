/**
 * V4-14 调岗资质检查: after a transfer or promotion (a V1-02 personnel action
 * or a V1-03 external-mode sync) the employee may still hold a certificate
 * that brings permissions although the new position no longer requires it.
 * Listed ("需 HR 决定") are the employee's valid or expiring certificates
 * whose certification
 *
 * 1. assesses a qualification the old position currently requires (its
 *    confirmed mandatory requirements) and the new one does not, and
 * 2. has at least one permission set assigned to its subject.
 *
 * A certificate the old position never required (李敏's 叉车证) is not
 * listed. Nothing changes the certificate: whether to revoke it is HR's
 * decision through the V3-10 revocation. The same judgement is the change
 * checklist's 操作权限 item (provider `grants`), shown before and after the
 * change takes effect.
 */
import type { AppAuthorization } from '@nocobase/app-plugin-authorization/server';
import type { DatabaseManager } from '@nocobase/db';

import { requiredCertificationsOf } from '../certificate-hooks.js';
import type {
  ChecklistProvider,
  ProviderContext,
  ProviderItem,
} from '../change-checklists.js';
import { str } from '../shared.js';
import { readPack } from './pack.js';

export interface RetainedCertificate {
  readonly certificateId: string;
  readonly certificationId: string;
  readonly title: string;
  readonly expiresAt: string | null;
  readonly status: string;
  readonly permissionSets: readonly { key: string; title: string }[];
  /** Display names of the pages and operations those sets open. */
  readonly operations: readonly string[];
}

export interface TransferJudgement {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly fromPosition: { id: string; title: string } | null;
  readonly toPosition: { id: string; title: string } | null;
  readonly certificates: readonly RetainedCertificate[];
}

export function createTransferCheck(deps: {
  readonly database: DatabaseManager;
  readonly authz: AppAuthorization;
  /** Permission sets assigned to a certification subject, with display names. */
  readonly grantsOf: (
    certificationId: string,
  ) => Promise<{ key: string; title: string; operations: string[] }[]>;
}) {
  const { database } = deps;

  async function positionOf(id: string | null) {
    if (!id) return null;
    const row = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? { id: str(row.id), title: str(row.title) } : null;
  }

  /** The judgement for one employee moving between two positions. */
  async function judge(
    employeeId: string,
    fromPositionId: string | null,
    toPositionId: string | null,
  ): Promise<TransferJudgement | undefined> {
    if (!fromPositionId || !toPositionId || fromPositionId === toPositionId)
      return undefined;
    const employee = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'name'])
      .where('id', '=', employeeId)
      .executeTakeFirst();
    if (!employee) return undefined;
    const before = await requiredCertificationsOf(database, fromPositionId);
    if (!before.length) return undefined;
    const after = new Set(
      (await requiredCertificationsOf(database, toPositionId)).map((c) => c.id),
    );
    const dropped = before.filter((c) => !after.has(c.id));
    if (!dropped.length) return undefined;
    const held = await database
      .query()
      .selectFrom('employeeCertificates')
      .select(['id', 'certificationId', 'expiresAt', 'status'])
      .where('employeeId', '=', employeeId)
      .where('status', 'in', ['valid', 'expiring'])
      .where(
        'certificationId',
        'in',
        dropped.map((c) => c.id),
      )
      .execute();
    const certificates: RetainedCertificate[] = [];
    for (const row of held) {
      const grants = await deps.grantsOf(str(row.certificationId));
      if (!grants.length) continue;
      certificates.push({
        certificateId: str(row.id),
        certificationId: str(row.certificationId),
        title: dropped.find((c) => c.id === str(row.certificationId))!.title,
        expiresAt:
          row.expiresAt == null
            ? null
            : row.expiresAt instanceof Date
              ? row.expiresAt.toISOString().slice(0, 10)
              : str(row.expiresAt).slice(0, 10),
        status: str(row.status),
        permissionSets: grants.map(({ key, title }) => ({ key, title })),
        operations: [...new Set(grants.flatMap((g) => g.operations))],
      });
    }
    if (!certificates.length) return undefined;
    return {
      employeeId,
      employeeName: str(employee.name),
      fromPosition: await positionOf(fromPositionId),
      toPosition: await positionOf(toPositionId),
      certificates,
    };
  }

  /** Whether the check runs at all: the pack and its transfer check are on. */
  async function active(): Promise<boolean> {
    const pack = await readPack(database.query());
    return pack.enabled && pack.transferCheckEnabled;
  }

  /** The judgement of a processed transfer or promotion event. */
  async function judgeEvent(
    eventId: string,
  ): Promise<
    | (TransferJudgement & { eventId: string; toDepartmentId: string | null })
    | undefined
  > {
    const event = await database
      .query()
      .selectFrom('jobEvents')
      .select([
        'id',
        'employeeId',
        'eventType',
        'fromPositionId',
        'toPositionId',
        'toDepartmentId',
      ])
      .where('id', '=', eventId)
      .executeTakeFirst();
    if (!event || !['transfer', 'promote'].includes(str(event.eventType)))
      return undefined;
    const result = await judge(
      str(event.employeeId),
      event.fromPositionId == null ? null : str(event.fromPositionId),
      event.toPositionId == null ? null : str(event.toPositionId),
    );
    return result
      ? {
          ...result,
          eventId,
          toDepartmentId:
            event.toDepartmentId == null ? null : str(event.toDepartmentId),
        }
      : undefined;
  }

  /** 变动影响清单 · 操作权限 (provider `grants`). */
  function checklistProvider(): ChecklistProvider {
    return {
      key: 'grants',
      kinds: ['change'],
      async items(ctx: ProviderContext): Promise<ProviderItem[]> {
        const employee = ctx.employee;
        if (!employee || !(await active())) return [];
        const toPositionId =
          ctx.action?.toPositionId ?? ctx.event?.toPositionId ?? null;
        const fromPositionId =
          ctx.action?.fromPositionId ??
          ctx.event?.fromPositionId ??
          (ctx.effective ? null : employee.positionId);
        const result = await judge(employee.id, fromPositionId, toPositionId);
        if (!result) return [];
        return result.certificates.map((certificate) => ({
          key: `grantsRetained:${certificate.certificationId}`,
          code: 'licensedGrantsRetained',
          params: {
            title: certificate.title,
            operations: certificate.operations.join('、'),
            position: result.toPosition?.title ?? '',
          },
          status: 'todo',
          link: `/talent/certifications/${encodeURIComponent(certificate.certificationId)}`,
        }));
      },
    };
  }

  return { judge, judgeEvent, active, checklistProvider };
}

export type TransferCheck = ReturnType<typeof createTransferCheck>;
