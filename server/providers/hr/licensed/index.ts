/**
 * V4-14 行业方案 · 持证上岗 (the industry pack). Nothing of steps 1–13 depends
 * on it: with the pack off the certification subject has no members, the
 * schedule checks and the transfer check do nothing, and every earlier page
 * works as before.
 *
 * - settings.ts: 设置 / 持证上岗, 只能经认证获得 through the authorization
 *   plugin's assignment check, the assignment history.
 * - qualification.ts: 排班资质校验 (schedule-validation / schedule-preflight
 *   / replacement.ts read it); `afterDailyRevalidate` here tells the
 *   scheduler about new qualification blocks once and asks the HR assistant
 *   for certified cover once per conflict.
 * - transfer.ts: 调岗资质检查 (job-event handler, checklist provider
 *   `grants`); the certification steward's notice goes to the task owner
 *   (hr01 by default) and the new department's head, once per event.
 * - exports.ts: 持证操作追溯 and 权限变化记录.
 * - the pages a certificate unlocks come from the enabled industry content
 *   packs (../industry-packs/); the manufacturing pack's pages are
 *   demo-batch.ts. A pack that is off contributes no page, set or operation
 *   to what a certificate is said to allow.
 *
 * Certificate states and permissions follow rules only; no AI employee
 * changes a certificate, a permission or a schedule.
 */
import { z } from 'zod';

import type { AIRunner } from '../ai-runner.js';
import { AIUnavailableError } from '../ai-runner.js';
import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type {
  AutomationRunContext,
  AutomationService,
  RunOutcome,
} from '../automation.js';
import type { DemoBatchService } from '../demo-batch.js';
import type { IndustryPackService } from '../industry-packs/service.js';
import type { ActorContext } from '../framework-service.js';
import { json, type Platform } from '../platform.js';
import { addDays, HrError, str } from '../shared.js';
import { createLicensedExports } from './exports.js';
import {
  CERTIFICATION_SUBJECT_TYPE,
  readPack,
  type LicensedPack,
} from './pack.js';
import { SHIFT_RESOURCE, LICENSED_SETTINGS } from './resources.js';
import { createLicensedSettings } from './settings.js';
import { createTransferCheck, type TransferJudgement } from './transfer.js';

export const TRANSFER_CHECK_TASK = 'certificationSteward.transferCheck';
const STEWARD = 'talent.certificationSteward';

export interface CertificationGrant {
  readonly key: string;
  readonly title: string;
  /** Pages the set opens; an industry pack's page carries its name and route, any other page its id and no path. */
  readonly pages: readonly { id: string; title: string; path: string | null }[];
  readonly operations: readonly {
    resource: string;
    action: string;
    title: string;
  }[];
}

export interface MyCertificateGrant {
  readonly certificateId: string;
  readonly certificationId: string;
  readonly title: string;
  readonly status: string;
  readonly expiresAt: string | null;
  readonly expiring: boolean;
  /** Page resources the certificate opens. */
  readonly pages: readonly string[];
  /** The enabled industry packs' pages among them, with name and route (they have no menu entry). */
  readonly pageLinks: readonly { id: string; title: string; path: string }[];
  readonly permissionSets: readonly string[];
}

export interface LicensedServicesDeps {
  readonly platform: Platform;
  readonly demoBatch: () => DemoBatchService;
  readonly industryPacks: () => IndustryPackService;
  readonly automation: () => AutomationService;
  readonly ai: AIRunner;
  readonly titleText: (title: unknown) => string;
  readonly audit: (event: Record<string, unknown>) => void;
  /** V2-05 顶班推荐, with its own dedupe key (automation-tasks.ts). */
  readonly qualificationCover: () => (
    scheduleId: string,
    dedupeKey: string,
  ) => Promise<RunOutcome>;
}

const dateOnly = (value: unknown): string | null =>
  value === null || value === undefined
    ? null
    : value instanceof Date
      ? value.toISOString().slice(0, 10)
      : str(value).slice(0, 10);

const shiftRequirementInput = z
  .object({
    certificationIds: z
      .array(z.string().min(1).max(64))
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export function createLicensedServices(deps: LicensedServicesDeps) {
  const { platform } = deps;
  const { database, authz } = platform;

  const settings = createLicensedSettings({
    database,
    authz,
    titleText: deps.titleText,
    audit: deps.audit,
  });

  /**
   * Permission sets assigned to a certification subject, with the pages and operations they open. A set,
   * page or operation of an industry pack that is off is left out.
   */
  async function certificationGrants(
    certificationId: string,
    locale?: string,
  ): Promise<CertificationGrant[]> {
    const composites = new Map(
      authz.compositeResources.list().map((c) => [c.name, c]),
    );
    const catalog = await deps.industryPacks().catalog(locale);
    const result: CertificationGrant[] = [];
    for (const set of await authz.permissionSets.list()) {
      if (catalog.hiddenSet(set.key)) continue;
      const assignments = await authz.permissionSets.listAssignments(set.key);
      if (
        !assignments.some(
          (a) =>
            a.subject.type === CERTIFICATION_SUBJECT_TYPE &&
            a.subject.id === certificationId,
        )
      )
        continue;
      const pages = set.grants
        .filter(
          (grant) =>
            grant.resource.type === 'page' &&
            !catalog.hiddenPage(grant.resource.id),
        )
        .map((grant) => {
          const page = catalog.page(grant.resource.id);
          return {
            id: grant.resource.id,
            title: page?.title ?? grant.resource.id,
            path: page?.path ?? null,
          };
        });
      const operations = set.grants
        .filter(
          (grant) =>
            grant.resource.type === 'composite' &&
            !catalog.hiddenResource(grant.resource.id),
        )
        .flatMap((grant) =>
          grant.actions.map((action) => {
            const composite = composites.get(grant.resource.id);
            const definition = authz.compositeResources.getAction(
              grant.resource.id,
              action.action,
            );
            const title = [
              composite ? deps.titleText(composite.title) : grant.resource.id,
              definition ? deps.titleText(definition.title) : action.action,
            ]
              .filter(Boolean)
              .join(' · ');
            return {
              resource: grant.resource.id,
              action: action.action,
              title,
            };
          }),
        );
      result.push({
        key: set.key,
        title: deps.titleText(set.title ?? set.key) || set.key,
        pages,
        operations,
      });
    }
    return result;
  }

  /** The business operations a certificate lets its holder use, by display name. */
  async function operationsOf(certificationId: string): Promise<string[]> {
    const grants = await certificationGrants(certificationId);
    const names = grants.flatMap((g) =>
      g.pages.length ? g.pages.map((p) => p.title) : [g.title],
    );
    return [...new Set(names)];
  }

  const transfer = createTransferCheck({
    database,
    authz,
    grantsOf: async (certificationId) =>
      (await certificationGrants(certificationId)).map((grant) => ({
        key: grant.key,
        title: grant.title,
        operations: grant.pages.length
          ? grant.pages.map((p) => p.title)
          : [grant.title],
      })),
  });

  const exports = createLicensedExports({
    platform,
    demoBatch: deps.demoBatch,
    industryPacks: deps.industryPacks,
    grantHistory: () => settings.grantHistory(),
    titleText: deps.titleText,
  });

  async function pack(): Promise<LicensedPack> {
    return readPack(database.query());
  }

  /** The transfer check notice's recipients: the task owner and the new department's head (walking up). */
  async function transferRecipients(
    judgement: { toDepartmentId: string | null },
    ownerUserId: string | null,
  ): Promise<string[]> {
    const head = judgement.toDepartmentId
      ? await platform.organization.resolveHead(judgement.toDepartmentId)
      : undefined;
    return [
      ...new Set(
        [ownerUserId, head?.userId].filter((v): v is string => Boolean(v)),
      ),
    ];
  }

  function composeTransferNotice(judgement: TransferJudgement): string {
    const lines = judgement.certificates.map(
      (c) => `仍持有${c.title}，仍可使用${c.operations.join('、')}`,
    );
    return `${judgement.employeeName}已调岗为${judgement.toPosition?.title ?? '新岗位'}：${lines.join('；')}。新岗位不要求这些证书，请 HR 决定保留或按吊销流程处理。`;
  }

  /** Sends the transfer check notice once per event; answers whether it was sent now. */
  async function sendTransferNotice(
    eventId: string,
    recipients: readonly string[],
    content: string,
    judgement: TransferJudgement,
  ): Promise<boolean> {
    if (!recipients.length) return false;
    const [certificate] = judgement.certificates;
    if (!certificate) return false;
    return platform.reminderOnce(`licensed.transferCheck:${eventId}`, () =>
      platform.notify({
        key: `licensed.transferCheck:${eventId}`,
        userIds: [...recipients],
        message: 'licensedTransferCheck',
        // Names, certification titles and a link only: no certificate numbers or personal data.
        params: {
          name: judgement.employeeName,
          certificates: judgement.certificates.map((c) => c.title).join('、'),
          content: content.slice(0, 400),
        },
        path: `/talent/certifications/${encodeURIComponent(certificate.certificationId)}`,
      }),
    );
  }

  async function transferCheckWork(run: AutomationRunContext, eventId: string) {
    const judgement = await transfer.judgeEvent(eventId);
    if (!judgement) return { status: 'skipped' as const };
    run.summarize(
      `${judgement.employeeName} · ${judgement.certificates.map((c) => c.title).join('、')}`,
    );
    let content = composeTransferNotice(judgement);
    try {
      const { data, sessionId } = await deps.ai.structured({
        employee: 'certificationSteward',
        userId: run.owner.userId,
        title: '调岗资质检查',
        prompt: [
          '员工调岗后仍持有新岗位不再要求、但带来操作权限的证书。请写一段不超过 150 字的提醒给 HR 和新部门负责人：只陈述事实（仍持有哪张证书、仍能使用哪些操作、新岗位是否要求），建议由 HR 决定保留或吊销，不替 HR 决定。只写姓名、证书名称和操作名称，不写证书编号或个人信息。只使用给出的数据：',
          JSON.stringify({
            name: judgement.employeeName,
            from: judgement.fromPosition?.title ?? null,
            to: judgement.toPosition?.title ?? null,
            certificates: judgement.certificates.map((c) => ({
              title: c.title,
              operations: c.operations,
              requiredByNewPosition: false,
            })),
          }),
        ].join('\n'),
        schema: z.object({ notice: z.string().min(1).max(400) }),
        timeZone: platform.timeZone,
      });
      run.usedConversation(sessionId);
      content = data.notice;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    const recipients = await transferRecipients(judgement, run.owner.userId);
    const sent = await sendTransferNotice(
      eventId,
      recipients,
      content,
      judgement,
    );
    run.reference({
      jobEventId: eventId,
      certificateIds: judgement.certificates.map((c) => c.certificateId),
    });
    return {
      output: { jobEventId: eventId, sent, recipients: recipients.length },
    };
  }

  const service = {
    settings,
    transfer,
    exports,
    certificationGrants,
    operationsOf,
    /** Whether the industry pack is on. */
    async enabled(): Promise<boolean> {
      return (await pack()).enabled;
    },

    /** Called at boot: the certification-only protection and the assignment history baseline. */
    async start(): Promise<void> {
      await settings.syncProtection();
      await settings.recordGrantChanges();
    },

    /** An assignment change reached a subject: a certification subject's is recorded. */
    async onGrantsChanged(subject: { type: string; id: string }) {
      if (subject.type !== CERTIFICATION_SUBJECT_TYPE || subject.id === '*')
        return;
      await settings.recordGrantChanges();
    },

    /** 我的证书: what each certificate the caller holds lets them do (only the holder sees this). */
    async myGrants(
      ctx: ActorContext,
      locale?: string,
    ): Promise<{
      enabled: boolean;
      employeeId: string | null;
      items: MyCertificateGrant[];
    }> {
      const current = await pack();
      const employee = await platform.employeeOfUser(ctx.userId);
      if (!current.enabled || !employee || employee.status === 'leave')
        return {
          enabled: current.enabled,
          employeeId: employee?.id ?? null,
          items: [],
        };
      const rows = await database
        .query()
        .selectFrom('employeeCertificates')
        .innerJoin(
          'certifications',
          'certifications.id',
          'employeeCertificates.certificationId',
        )
        .select([
          'employeeCertificates.id as id',
          'employeeCertificates.certificationId as certificationId',
          'employeeCertificates.status as status',
          'employeeCertificates.expiresAt as expiresAt',
          'certifications.title as title',
        ])
        .where('employeeCertificates.employeeId', '=', employee.id)
        .where('employeeCertificates.status', 'in', ['valid', 'expiring'])
        .where('certifications.active', '=', true)
        .execute();
      const items: MyCertificateGrant[] = [];
      for (const row of rows) {
        const grants = await certificationGrants(
          str(row.certificationId),
          locale,
        );
        if (!grants.length) continue;
        const pageLinks = new Map<
          string,
          { id: string; title: string; path: string }
        >();
        for (const page of grants.flatMap((g) => g.pages))
          if (page.path)
            pageLinks.set(page.id, {
              id: page.id,
              title: page.title,
              path: page.path,
            });
        items.push({
          certificateId: str(row.id),
          certificationId: str(row.certificationId),
          title: str(row.title),
          status: str(row.status),
          expiresAt: dateOnly(row.expiresAt),
          expiring: str(row.status) === 'expiring',
          pages: [...new Set(grants.flatMap((g) => g.pages.map((p) => p.id)))],
          pageLinks: [...pageLinks.values()],
          permissionSets: grants.map((g) => g.title),
        });
      }
      return { enabled: true, employeeId: employee.id, items };
    },

    // ---------- 班次 · 要求的认证 ----------
    async shiftRequirements(ctx: ActorContext) {
      const policies = await authorizeAction(
        ctx.authz,
        SHIFT_RESOURCE,
        'manageRequiredCertifications',
      );
      const shifts = (await database
        .repository('shifts')
        .withPolicy(policyOf(policies, 'shifts'))
        .findMany({
          select: (s) =>
            s.fields('id', 'code', 'title', 'requiredCertificationIds'),
          sort: (s) => s.field('code').asc(),
        })) as Record<string, unknown>[];
      const certifications = await database
        .query()
        .selectFrom('certifications')
        .select(['id', 'title', 'kind'])
        .where('active', '=', true)
        .orderBy('code', 'asc')
        .execute();
      const current = await pack();
      return {
        checking: current.enabled && current.scheduleCheckEnabled,
        shifts: shifts.map((row) => ({
          id: str(row.id),
          code: str(row.code),
          title: str(row.title),
          requiredCertificationIds: json<string[]>(
            row.requiredCertificationIds,
            [],
          ),
        })),
        certifications: certifications.map((row) => ({
          id: str(row.id),
          title: str(row.title),
          kind: str(row.kind ?? 'internal'),
        })),
      };
    },

    async setShiftRequirements(
      ctx: ActorContext,
      shiftId: string,
      input: unknown,
    ) {
      const policies = await authorizeAction(
        ctx.authz,
        SHIFT_RESOURCE,
        'manageRequiredCertifications',
      );
      const parsed = shiftRequirementInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const ids = parsed.data.certificationIds;
      if (ids.length) {
        const found = await database
          .query()
          .selectFrom('certifications')
          .select(['id'])
          .where('active', '=', true)
          .where('id', 'in', ids)
          .execute();
        if (found.length !== ids.length)
          throw new HrError('CERTIFICATION_NOT_FOUND', 400);
      }
      const repo = database
        .repository('shifts')
        .withPolicy(policyOf(policies, 'shifts'));
      const row = await repo.findOne({
        filter: { id: shiftId },
        select: (s) => s.fields('id', 'title', 'requiredCertificationIds'),
      });
      if (!row) throw new HrError('NOT_FOUND', 404);
      const before = json<string[]>(row.requiredCertificationIds, []);
      await repo.updateOne({
        filter: { id: shiftId },
        values: {
          requiredCertificationIds: ids.length ? ids : null,
          updatedAt: new Date(),
        },
      });
      deps.audit({
        event: 'licensedOperation.shiftRequirementChanged',
        userId: ctx.userId,
        shiftId,
        from: before,
        to: ids,
      });
      return { id: shiftId, requiredCertificationIds: ids };
    },

    /**
     * After the daily re-check (V2-05 每天 09:00, after the certificate
     * lifecycle): each published cell newly blocked by certificationMissing
     * tells its scheduler (the department head, walking up) once, and asks
     * the HR assistant for certified cover once per conflict. The schedule
     * itself is never changed.
     */
    async afterDailyRevalidate(from: string, to: string) {
      const current = await pack();
      if (!current.enabled || !current.scheduleCheckEnabled)
        return { qualificationConflicts: 0, notified: 0, suggested: 0 };
      const rows = await database
        .query()
        .selectFrom('shiftSchedules')
        .innerJoin('employees', 'employees.id', 'shiftSchedules.employeeId')
        .select([
          'shiftSchedules.id as id',
          'shiftSchedules.date as date',
          'shiftSchedules.checkResult as checkResult',
          'employees.name as name',
          'employees.departmentId as departmentId',
        ])
        .where('shiftSchedules.status', '=', 'published')
        .where('shiftSchedules.date', '>=', from)
        .where('shiftSchedules.date', '<=', to)
        .execute();
      let conflicts = 0;
      let notified = 0;
      let suggested = 0;
      for (const row of rows) {
        const checks = json<
          {
            rule?: string;
            certificationId?: string;
            params?: Record<string, string>;
          }[]
        >(row.checkResult, []).filter((c) => c.rule === 'certificationMissing');
        if (!checks.length) continue;
        conflicts += 1;
        const key = checks
          .map((c) => c.certificationId ?? '')
          .sort()
          .join(',');
        const date = dateOnly(row.date)!;
        const head = await platform.organization.resolveHead(
          str(row.departmentId),
        );
        if (head) {
          const sent = await platform.reminderOnce(
            `qualificationConflict:${str(row.id)}:${key}`,
            () =>
              platform.notify({
                key: `qualificationConflict:${str(row.id)}:${key}`,
                userIds: [head.userId],
                message: 'scheduleQualificationConflict',
                params: {
                  name: str(row.name),
                  date,
                  certifications: checks
                    .map((c) => c.params?.certification ?? '')
                    .filter(Boolean)
                    .join('、'),
                  expiresAt:
                    checks.map((c) => c.params?.expiresAt).find(Boolean) ?? '—',
                },
                path: `/talent/schedules?department=${str(row.departmentId)}&from=${date}`,
              }),
          );
          if (sent) notified += 1;
        }
        const outcome = await deps
          .qualificationCover()(
            str(row.id),
            `qualification:${str(row.id)}:${key}`,
          )
          .catch(() => undefined);
        if (outcome?.status === 'succeeded') suggested += 1;
      }
      return { qualificationConflicts: conflicts, notified, suggested };
    },

    /** Registered on the job-event processor: runs the transfer check once the event is stamped processed. */
    async onJobEvent(
      event: { id: string; eventType: string },
      background: (label: string, run: () => Promise<unknown>) => void,
    ): Promise<void> {
      if (event.eventType !== 'transfer' && event.eventType !== 'promote')
        return;
      if (!(await transfer.active())) return;
      background(TRANSFER_CHECK_TASK, async () => {
        for (let i = 0; i < 50; i += 1) {
          const row = await database
            .query()
            .selectFrom('jobEvents')
            .select(['processedAt'])
            .where('id', '=', event.id)
            .executeTakeFirst();
          if (!row) return undefined;
          if (row.processedAt) return service.runTransferCheck(event.id);
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return undefined;
      });
    },

    /** 调岗资质检查 for one processed event; a repeated event is a duplicate run. */
    async runTransferCheck(eventId: string): Promise<RunOutcome | undefined> {
      if (!(await transfer.active())) return undefined;
      if (!(await transfer.judgeEvent(eventId))) return undefined;
      return deps
        .automation()
        .run(
          TRANSFER_CHECK_TASK,
          'event',
          {
            triggerRef: { jobEventId: eventId },
            dedupeKey: `jobEvent:${eventId}`,
          },
          (run) => transferCheckWork(run, eventId),
        );
    },

    // ---------- 认证管家 tools ----------
    /** listCertificatesNotRequired: the event's judgement, for people in the caller's steward scope. */
    async certificatesNotRequired(ctx: ActorContext, eventId: string) {
      const policies = await authorizeAction(ctx.authz, STEWARD, 'use');
      const judgement = await transfer.judgeEvent(eventId);
      if (!judgement) return null;
      const visible = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findOne({ filter: { id: judgement.employeeId } });
      if (!visible) throw new HrError('NOT_FOUND', 404);
      return {
        jobEventId: eventId,
        employeeName: judgement.employeeName,
        fromPosition: judgement.fromPosition?.title ?? null,
        toPosition: judgement.toPosition?.title ?? null,
        certificates: judgement.certificates.map((c) => ({
          certificateId: c.certificateId,
          certification: c.title,
          expiresAt: c.expiresAt,
          permissionSets: c.permissionSets.map((s) => s.title),
          operations: c.operations,
          requiredByNewPosition: false,
          link: `/talent/certifications/${encodeURIComponent(c.certificationId)}`,
        })),
      };
    },

    /** sendTransferCheckNotice: only to the task owner and the new department's head, once per event. */
    async sendTransferCheckNotice(
      ctx: ActorContext,
      input: {
        jobEventId: string;
        recipientUserIds: string[];
        content: string;
      },
    ) {
      await authorizeAction(ctx.authz, STEWARD, 'use');
      const judgement = await transfer.judgeEvent(input.jobEventId);
      if (!judgement) throw new HrError('NOTHING_TO_SEND', 409);
      const owner = await database
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId'])
        .where('id', '=', TRANSFER_CHECK_TASK)
        .executeTakeFirst();
      const allowed = await transferRecipients(
        judgement,
        owner?.ownerUserId ? str(owner.ownerUserId) : null,
      );
      const recipients = input.recipientUserIds.filter((id) =>
        allowed.includes(id),
      );
      if (!recipients.length) throw new HrError('RECIPIENT_NOT_ALLOWED', 403);
      const sent = await sendTransferNotice(
        input.jobEventId,
        recipients,
        input.content,
        judgement,
      );
      return { sent, recipients: recipients.length };
    },

    /** 每周持证简报: people in the caller's steward scope who lost permissions through a certificate this week. */
    async lostThisWeek(ctx: ActorContext, today: string): Promise<string[]> {
      if (!(await pack()).enabled) return [];
      const policies = await tryAuthorizeAction(ctx.authz, STEWARD, 'use');
      if (!policies) return [];
      const people = new Map(
        (
          (await database
            .repository('employees')
            .withPolicy(policyOf(policies, 'employees'))
            .findMany({})) as Record<string, unknown>[]
        ).map((row) => [str(row.id), str(row.name)]),
      );
      const since = addDays(today, -7);
      const rows = await database
        .query()
        .selectFrom('employeeCertificates')
        .select(['employeeId', 'certificationId', 'updatedAt'])
        .where('status', 'in', ['expired', 'revoked'])
        .execute();
      const names = new Set<string>();
      for (const row of rows) {
        const when = new Intl.DateTimeFormat('en-CA', {
          timeZone: platform.timeZone,
        }).format(new Date(row.updatedAt as string | Date));
        if (!when || when < since || when > today) continue;
        const name = people.get(str(row.employeeId));
        if (!name) continue;
        if ((await certificationGrants(str(row.certificationId))).length)
          names.add(name);
      }
      return [...names];
    },

    /**
     * 验收数据 (development and demo only): what the step's walkthrough needs
     * and earlier steps' walkthroughs must not see yet — 李敏 and 刘洋 hold a
     * valid CNC 岗位上岗证 (6 and 8 months left), and 机加工早班/中班/夜班
     * require it. Created once under fixed ids; an existing valid certificate
     * or requirement is left alone. hr.admin only.
     */
    async prepareDemo(ctx: ActorContext) {
      await authorizeAction(ctx.authz, LICENSED_SETTINGS, 'manage');
      if (
        process.env.NODE_ENV === 'production' ||
        process.env.HR_DEMO_SEED === 'false' ||
        process.env.HR_LICENSED_DEMO === 'false'
      )
        throw new HrError('NOT_FOUND', 404);
      const today = platform.currentDate();
      const months = (n: number) => {
        const d = new Date(`${today}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() + n);
        return d.toISOString().slice(0, 10);
      };
      const created: string[] = [];
      for (const [employeeId, left, no] of [
        ['emp-limin', 6, 90201],
        ['emp-liuyang', 8, 90202],
      ] as const) {
        const id = `certificate-${employeeId.slice(4)}-cnc`;
        const employee = await platform.employee(employeeId);
        if (!employee || employee.status === 'leave') continue;
        const exists = await database
          .query()
          .selectFrom('employeeCertificates')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('certificationId', '=', 'cert-cnc')
          .where('status', 'in', ['valid', 'expiring'])
          .executeTakeFirst();
        if (exists) continue;
        if (
          await database
            .query()
            .selectFrom('employeeCertificates')
            .select(['id'])
            .where('id', '=', id)
            .executeTakeFirst()
        )
          continue;
        const stamp = new Date();
        await database
          .query()
          .insertInto('employeeCertificates')
          .values({
            id,
            employeeId,
            certificationId: 'cert-cnc',
            certificateNo: `CNC-OP-${months(left - 12).slice(0, 4)}-${no}`,
            issuedAt: months(left - 12),
            expiresAt: months(left),
            status: 'valid',
            source: 'internal',
            revokedReason: null,
            evidence: { preparedBy: ctx.userId },
            supersededById: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        created.push(employee.name);
        if (employee.userId)
          await authz.permissionSets.notifyAssignmentsChanged({
            type: 'user',
            id: employee.userId,
          });
      }
      // 机加工早班、中班、夜班 require the CNC 岗位上岗证 (a requirement an administrator already set is kept).
      const shifts: string[] = [];
      for (const shiftId of [
        'shift-mc-early',
        'shift-mc-middle',
        'shift-mc-night',
      ]) {
        const row = await database
          .query()
          .selectFrom('shifts')
          .select(['id', 'requiredCertificationIds'])
          .where('id', '=', shiftId)
          .executeTakeFirst();
        if (!row || json<string[]>(row.requiredCertificationIds, []).length)
          continue;
        await database
          .query()
          .updateTable('shifts')
          .set({
            requiredCertificationIds: ['cert-cnc'],
            updatedAt: new Date(),
          })
          .where('id', '=', shiftId)
          .execute();
        shifts.push(shiftId);
      }
      deps.audit({
        event: 'licensedOperation.demoPrepared',
        userId: ctx.userId,
        certificates: created,
        shifts,
      });
      return { created, shifts };
    },

    /** 行业内容包 (设置 / 持证上岗). */
    industryPacks: () => deps.industryPacks(),
  };
  return service;
}

export type LicensedServices = ReturnType<typeof createLicensedServices>;
