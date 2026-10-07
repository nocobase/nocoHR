/**
 * 录用 (V2-07). The recruiter drafts an offer on an applicable salary
 * structure (V2-06); a base outside the structure's pay range needs a
 * reason. Approval: the hiring manager confirms the person and the start date
 * without seeing the salary, then a hr.payrollApprover holder reviews the
 * salary. The approved offer gets its letter; the recruiter previews and
 * sends the email; the candidate answers through a personal link, which
 * after acceptance serves 待入职跟进 until the onboarding takes effect.
 *
 * Salary is returned only with `talent.offer` `viewSalary` and only to the
 * requisition's recruiter or a payroll holder — hr.admin and hiring managers
 * never receive it, from any endpoint.
 *
 * Acceptance moves the application to hired and prepares the onboarding
 * action's pre-filled content for hr.admin (工号由 HR 填写); submitting it
 * goes through core HR's createAction, so the configured onboarding chain
 * applies (see onboarding.ts for what happens when it takes effect).
 */
import { z } from 'zod';

import { toStructure } from '../payroll/structures.js';
import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { addDays, HrError, newId, str } from '../shared.js';
import type { CandidateService } from './candidates.js';
import {
  day,
  fill,
  iso,
  json,
  localDate,
  localDateTime,
  newToken,
  num,
  sha256,
  type ApprovalStep,
} from './common.js';
import type { RecruitingContext } from './context.js';
import type { RequisitionService } from './requisitions.js';
import { COMPOSITE } from './resources.js';
import type { Templates } from './templates.js';

/** How long after the start date an accepted offer's link still opens when the onboarding never took effect. */
const OFFER_LINK_DAYS_AFTER_START = 30;

const salarySchema = z
  .object({
    baseSalary: z.number().finite().min(0).max(10_000_000),
    allowances: z
      .array(
        z
          .object({
            code: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,39}$/u),
            amount: z.number().finite().min(0).max(10_000_000),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    salaryStructureId: z.string().min(1).max(64),
  })
  .strict();

const offerSchema = z
  .object({
    applicationId: z.string().min(1).max(64),
    salaryOffer: salarySchema,
    outOfRangeReason: z.string().trim().max(2000).nullish(),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    probationMonths: z.number().int().min(0).max(6),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).nullish(),
  })
  .strict();

const onboardSchema = z
  .object({
    employeeNo: z.string().trim().min(1).max(64),
    name: z.string().trim().min(1).max(200).optional(),
    mobile: z.string().trim().max(32).nullish(),
    email: z.string().trim().max(320).nullish(),
    effectiveDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .optional(),
    employmentType: z.string().max(16).optional(),
    createAccount: z.boolean().optional(),
    careerStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullish(),
  })
  .strict();

/**
 * 参加工作日期 estimated from the resume: the start date less the years its
 * experiences add up to (周迪: two years on CNC lathes). HR sees and may
 * correct it on the onboarding form; null without any years.
 */
export function estimateCareerStart(
  experiences: readonly { years: number | null }[] | undefined,
  startDate: string | null,
): string | null {
  if (!startDate || !/^\d{4}-\d{2}-\d{2}$/u.test(startDate)) return null;
  const years = (experiences ?? []).reduce(
    (sum, e) =>
      sum + (typeof e.years === 'number' && e.years > 0 ? e.years : 0),
    0,
  );
  if (!years) return null;
  const months = Math.round(years * 12);
  const date = new Date(`${startDate}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 10);
}

export interface Preboarding {
  remindersSent: { day: number; sentAt: string; delivery?: string }[];
  arrivalConfirmedAt: string | null;
  uploads: {
    kind: 'idCard' | 'bankCard' | 'diploma';
    fileId: string;
    uploadedAt: string;
  }[];
  /** 人事助理识别结果, waiting for HR (sensitive: only hr.admin reads it, on the onboarding draft). */
  suggestions: {
    id: string;
    fileId: string;
    kind: string;
    fields: Record<
      string,
      { value: string; confidence: number; snippet: string }
    >;
    status: 'pending' | 'failed';
    reason?: string | null;
  }[];
  suggestionIds: string[];
  escalatedAt: string | null;
  templateConfirmedAt: string | null;
  templateConfirmedBy: string | null;
  /** The pre-filled onboarding action, prepared on acceptance. */
  onboardDraft: Record<string, unknown> | null;
  onboardedAt: string | null;
  onboardedEventId: string | null;
}

export function emptyPreboarding(): Preboarding {
  return {
    remindersSent: [],
    arrivalConfirmedAt: null,
    uploads: [],
    suggestions: [],
    suggestionIds: [],
    escalatedAt: null,
    templateConfirmedAt: null,
    templateConfirmedBy: null,
    onboardDraft: null,
    onboardedAt: null,
    onboardedEventId: null,
  };
}

export function presentOffer(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    applicationId: str(row.applicationId),
    positionId: str(row.positionId),
    departmentId: str(row.departmentId),
    salaryOffer: json<z.infer<typeof salarySchema> | null>(
      row.salaryOffer,
      null,
    ),
    outOfRangeReason: row.outOfRangeReason ? str(row.outOfRangeReason) : null,
    startDate: day(row.startDate)!,
    probationMonths: num(row.probationMonths),
    status: str(row.status),
    approvals: json<ApprovalStep[]>(row.approvals, []),
    offerLetterFileId: row.offerLetterFileId
      ? str(row.offerLetterFileId)
      : null,
    sentAt: iso(row.sentAt),
    respondBy: iso(row.respondBy),
    respondedAt: iso(row.respondedAt),
    responseChannel: row.responseChannel ? str(row.responseChannel) : null,
    declineReason: row.declineReason ? str(row.declineReason) : null,
    tokenHash: row.tokenHash ? str(row.tokenHash) : null,
    onboardActionId: row.onboardActionId ? str(row.onboardActionId) : null,
    preboarding: {
      ...emptyPreboarding(),
      ...json<Partial<Preboarding>>(row.preboarding, {}),
    },
    createdBy: str(row.createdBy),
    createdAt: iso(row.createdAt),
  };
}
export type OfferView = ReturnType<typeof presentOffer>;

export function createOfferService(
  ctx: RecruitingContext,
  deps: {
    candidates: CandidateService;
    requisitions: RequisitionService;
    templates: Templates;
  },
) {
  const { database, platform } = ctx;
  const { candidates, requisitions } = deps;

  async function row(id: string): Promise<OfferView> {
    const found = await database
      .query()
      .selectFrom('offers')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('OFFER_NOT_FOUND', 404);
    return presentOffer(found);
  }

  async function context(offer: { applicationId: string }) {
    const application = await candidates.applicationRow(offer.applicationId);
    const posting = await database
      .query()
      .selectFrom('jobPostings')
      .select(['requisitionId', 'title'])
      .where('id', '=', application.postingId)
      .executeTakeFirst();
    const requisition = await requisitions.get(str(posting?.requisitionId));
    const candidate = await candidates.candidateRow(application.candidateId);
    return {
      application,
      requisition,
      candidate,
      postingTitle: str(posting?.title),
    };
  }

  /** Who the actor is for this offer and whether they may read its salary. */
  async function access(actor: ActorContext, offer: OfferView) {
    const c = await context(offer);
    const recruiter =
      c.requisition.recruiterUserId === actor.userId &&
      (await ctx.can(actor, COMPOSITE.offer, 'manage'));
    const payrollApprover = (
      await ctx.holdersOf('hr.payrollApprover')
    ).includes(actor.userId);
    const payroll = (await ctx.holdersOf('hr.payroll')).includes(actor.userId);
    const approver = offer.approvals.some((s) =>
      s.approverUserIds.includes(actor.userId),
    );
    const hiringManager = c.requisition.hiringManagerUserId === actor.userId;
    const onboarding =
      ['accepted'].includes(offer.status) &&
      (await ctx.can(actor, COMPOSITE.offer, 'onboard'));
    const salary =
      (recruiter || payrollApprover || payroll) &&
      (await ctx.can(actor, COMPOSITE.offer, 'viewSalary'));
    return {
      ...c,
      recruiter,
      payrollApprover,
      approver,
      hiringManager,
      onboarding,
      salary,
      read:
        recruiter ||
        approver ||
        hiringManager ||
        onboarding ||
        (salary && payroll),
    };
  }

  async function rangeCheck(
    positionId: string,
    salary: z.infer<typeof salarySchema>,
  ) {
    const structureRow = await database
      .query()
      .selectFrom('salaryStructures')
      .selectAll()
      .where('id', '=', salary.salaryStructureId)
      .executeTakeFirst();
    if (!structureRow) throw new HrError('SALARY_STRUCTURE_NOT_FOUND', 404);
    const structure = toStructure(structureRow);
    const position = await ctx.position(positionId);
    const range =
      structure.payRanges.find((r) => r.positionId === positionId) ??
      structure.payRanges.find((r) => r.grade && r.grade === position?.grade);
    return {
      structure: { id: structure.id, title: structure.title },
      range: range ? { min: range.min, max: range.max } : null,
      outOfRange: range
        ? salary.baseSalary < range.min || salary.baseSalary > range.max
        : false,
    };
  }

  async function present(actor: ActorContext, offer: OfferView) {
    const a = await access(actor, offer);
    const range =
      a.salary && offer.salaryOffer
        ? await rangeCheck(offer.positionId, offer.salaryOffer).catch(
            () => null,
          )
        : null;
    const pending = offer.approvals.find((s) => s.status === 'pending');
    const hrAdmin = await ctx.isHrAdmin(actor);
    return {
      id: offer.id,
      applicationId: offer.applicationId,
      positionId: offer.positionId,
      positionTitle: (await ctx.position(offer.positionId))?.title ?? '',
      departmentId: offer.departmentId,
      departmentTitle: await ctx.departmentTitle(offer.departmentId),
      candidateName: a.candidate.name,
      postingTitle: a.postingTitle,
      startDate: offer.startDate,
      probationMonths: offer.probationMonths,
      status: offer.status,
      approvals: await Promise.all(
        offer.approvals.map(async (s) => ({
          ...s,
          approverNames: await Promise.all(
            s.approverUserIds.map(
              async (u) => (await platform.userName(u)) ?? u,
            ),
          ),
        })),
      ),
      sentAt: offer.sentAt,
      respondBy: offer.respondBy,
      respondedAt: offer.respondedAt,
      responseChannel: offer.responseChannel,
      declineReason: offer.declineReason,
      hasLetter: Boolean(offer.offerLetterFileId),
      onboardActionId: offer.onboardActionId,
      // 薪资只对招聘专员（本需求）、薪酬审批与薪酬专员可见.
      salaryOffer: a.salary ? offer.salaryOffer : null,
      outOfRangeReason: a.salary ? offer.outOfRangeReason : null,
      payRange: range,
      preboarding: {
        remindersSent: offer.preboarding.remindersSent,
        arrivalConfirmedAt: offer.preboarding.arrivalConfirmedAt,
        uploads: offer.preboarding.uploads.map((u) => ({
          kind: u.kind,
          uploadedAt: u.uploadedAt,
        })),
        escalatedAt: offer.preboarding.escalatedAt,
        templateConfirmedAt: offer.preboarding.templateConfirmedAt,
        onboardedAt: offer.preboarding.onboardedAt,
      },
      can: {
        manage: a.recruiter && offer.status === 'draft',
        submit: a.recruiter && offer.status === 'draft',
        approve:
          offer.status === 'pendingApproval' &&
          Boolean(pending?.approverUserIds.includes(actor.userId)),
        send: a.recruiter && offer.status === 'approved',
        record: a.recruiter && offer.status === 'sent',
        withdraw:
          a.recruiter &&
          ['draft', 'pendingApproval', 'approved', 'sent'].includes(
            offer.status,
          ),
        onboard:
          offer.status === 'accepted' &&
          !offer.onboardActionId &&
          hrAdmin &&
          (await ctx.can(actor, COMPOSITE.offer, 'onboard')),
        salary: a.salary,
      },
    };
  }

  async function chainFor(requisitionId: string): Promise<ApprovalStep[]> {
    const requisition = await requisitions.get(requisitionId);
    const base = { decidedBy: null, decidedAt: null, comment: null };
    return [
      {
        level: 1,
        kind: 'hiringManager',
        name: null,
        approverUserIds: [requisition.hiringManagerUserId],
        status: 'pending',
        ...base,
      },
      {
        level: 2,
        kind: 'payrollApprover',
        name: null,
        approverUserIds: await ctx.holdersOf('hr.payrollApprover'),
        permissionSet: 'hr.payrollApprover',
        status: 'waiting',
        ...base,
      },
    ];
  }

  async function notifyPending(offer: OfferView) {
    const pending = offer.approvals.find((s) => s.status === 'pending');
    if (!pending) return;
    await platform.notify({
      key: `offer:${offer.id}:level:${pending.level}`,
      userIds: pending.approverUserIds,
      message: 'recruitingOfferPending',
      params: {
        position: (await ctx.position(offer.positionId))?.title ?? '',
      },
      path: `/talent/offers/${offer.id}`,
    });
  }

  /** 录用通知书: an HTML letter in the file store (设置 / 招聘设置 · 邮件模板 words the email). */
  async function writeLetter(offer: OfferView) {
    const c = await context(offer);
    const position = (await ctx.position(offer.positionId))?.title ?? '';
    const department = await ctx.departmentTitle(offer.departmentId);
    const t = await ctx.translate();
    const escape = (s: string) =>
      s.replace(
        /[&<>"']/gu,
        (ch) =>
          ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
          })[ch]!,
      );
    const salary = offer.salaryOffer;
    const lines = [
      t('recruiting.letter.greeting', { name: c.candidate.name }),
      t('recruiting.letter.body', {
        company: ctx.companyName(),
        department,
        position,
      }),
      t('recruiting.letter.startDate', { date: offer.startDate }),
      t('recruiting.letter.probation', {
        months: String(offer.probationMonths),
      }),
      ...(salary
        ? [
            t('recruiting.letter.salary', {
              amount: salary.baseSalary.toLocaleString('zh-CN'),
            }),
          ]
        : []),
      t('recruiting.letter.closing'),
    ];
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(
      t('recruiting.letter.title'),
    )}</title></head><body style="font-family:sans-serif;max-width:640px;margin:2rem auto;line-height:1.7">${`<h1>${escape(t('recruiting.letter.title'))}</h1>`}${lines
      .map((l) => `<p>${escape(l)}</p>`)
      .join(
        '',
      )}<p style="text-align:right">${escape(ctx.companyName())}</p></body></html>`;
    const fileId = await ctx.storeFile({
      name: `offer-${offer.id}.html`,
      bytes: new TextEncoder().encode(html),
      mimeType: 'text/html',
      folder: 'offers',
    });
    await database
      .query()
      .updateTable('offers')
      .set({ offerLetterFileId: fileId, updatedAt: new Date() })
      .where('id', '=', offer.id)
      .execute();
    return fileId;
  }

  async function emailPreview(offer: OfferView, link: string) {
    const c = await context(offer);
    const template = await deps.templates.get('offer');
    const values = {
      name: c.candidate.name,
      position: (await ctx.position(offer.positionId))?.title ?? '',
      department: await ctx.departmentTitle(offer.departmentId),
      startDate: offer.startDate,
      respondBy: '',
      link,
      company: ctx.companyName(),
    };
    return { values, template };
  }

  /** hr.admin holds only `onboard`: it lists and opens accepted offers (without salary) to create the onboarding action. */
  async function viewOrOnboard(actor: ActorContext) {
    if (
      !(await ctx.can(actor, COMPOSITE.offer, 'view')) &&
      !(await ctx.can(actor, COMPOSITE.offer, 'onboard'))
    )
      throw new HrError('FORBIDDEN', 403);
  }

  const service = {
    get: row,
    context,
    rangeCheck,

    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await viewOrOnboard(actor);
      let q = database.query().selectFrom('offers').selectAll();
      if (query.status) q = q.where('status', '=', query.status);
      const rows = await q.orderBy('createdAt', 'desc').execute();
      const items = [];
      for (const r of rows) {
        const offer = presentOffer(r);
        const a = await access(actor, offer);
        if (a.read) items.push(await present(actor, offer));
      }
      return {
        items,
        can: { manage: await ctx.can(actor, COMPOSITE.offer, 'manage') },
      };
    },

    async detail(actor: ActorContext, id: string) {
      await viewOrOnboard(actor);
      const offer = await row(id);
      if (!(await access(actor, offer)).read)
        throw new HrError('OFFER_NOT_FOUND', 404);
      return present(actor, offer);
    },

    /** The applicable structures and the pay range, for the offer form (salary readers only). */
    async structures(actor: ActorContext, applicationId: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'viewSalary');
      const application = await candidates.applicationRow(applicationId);
      const a = await candidates.access(actor, application);
      if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
      const rows = await database
        .query()
        .selectFrom('salaryStructures')
        .selectAll()
        .where('active', '=', true)
        .execute();
      const chain =
        (await platform.organization.activeChain(a.requisition.departmentId)) ??
        [];
      return rows
        .map((r) => toStructure(r as Record<string, unknown>))
        .map((s) => ({
          id: s.id,
          title: s.title,
          applies: s.appliesTo.departmentIds.some((d) => chain.includes(d)),
          range:
            s.payRanges.find(
              (r) => r.positionId === a.requisition.positionId,
            ) ?? null,
          allowances: s.items
            .filter((i) => i.kind === 'earning' && i.calc === 'fixed')
            .map((i) => ({ code: i.code, title: i.title })),
        }));
    },

    async create(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'manage');
      const parsed = offerSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const data = parsed.data;
      const application = await candidates.applicationRow(data.applicationId);
      const a = await candidates.access(actor, application);
      if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
      if (!['screening', 'interview', 'offer'].includes(application.stage))
        throw new HrError('APPLICATION_STAGE_INVALID', 409);
      const open = await database
        .query()
        .selectFrom('offers')
        .select(['id'])
        .where('applicationId', '=', application.id)
        .where('status', 'in', [
          'draft',
          'pendingApproval',
          'approved',
          'sent',
          'accepted',
        ])
        .executeTakeFirst();
      if (open) throw new HrError('OFFER_ALREADY_OPEN', 409);
      const range = await rangeCheck(
        a.requisition.positionId,
        data.salaryOffer,
      );
      if (range.outOfRange && !data.outOfRangeReason)
        throw new HrError('OFFER_OUT_OF_RANGE_REASON_REQUIRED', 400, {
          min: range.range?.min,
          max: range.range?.max,
        });
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('offers')
        .values({
          id,
          applicationId: application.id,
          positionId: a.requisition.positionId,
          departmentId: a.requisition.departmentId,
          salaryOffer: data.salaryOffer,
          outOfRangeReason: data.outOfRangeReason ?? null,
          startDate: data.startDate,
          probationMonths: data.probationMonths,
          status: 'draft',
          approvals: [],
          offerLetterFileId: null,
          sentAt: null,
          respondBy: null,
          respondedAt: null,
          responseChannel: null,
          declineReason: null,
          tokenHash: null,
          linkToken: null,
          onboardActionId: null,
          preboarding: emptyPreboarding(),
          createdBy: actor.userId,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      if (application.stage !== 'offer')
        await candidates.stamp(
          application.id,
          application.stage,
          'offer',
          actor.userId,
        );
      return service.detail(actor, id);
    },

    async update(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'manage');
      const offer = await row(id);
      const a = await access(actor, offer);
      if (!a.recruiter) throw new HrError('OFFER_NOT_FOUND', 404);
      if (offer.status !== 'draft') throw new HrError('OFFER_NOT_DRAFT', 409);
      const parsed = offerSchema.omit({ applicationId: true }).safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const range = await rangeCheck(offer.positionId, parsed.data.salaryOffer);
      if (range.outOfRange && !parsed.data.outOfRangeReason)
        throw new HrError('OFFER_OUT_OF_RANGE_REASON_REQUIRED', 400, {
          min: range.range?.min,
          max: range.range?.max,
        });
      await database
        .query()
        .updateTable('offers')
        .set({
          salaryOffer: parsed.data.salaryOffer,
          outOfRangeReason: parsed.data.outOfRangeReason ?? null,
          startDate: parsed.data.startDate,
          probationMonths: parsed.data.probationMonths,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async submit(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'manage');
      const offer = await row(id);
      const a = await access(actor, offer);
      if (!a.recruiter) throw new HrError('OFFER_NOT_FOUND', 404);
      if (offer.status !== 'draft') throw new HrError('OFFER_NOT_DRAFT', 409);
      if (offer.salaryOffer) {
        const range = await rangeCheck(offer.positionId, offer.salaryOffer);
        if (range.outOfRange && !offer.outOfRangeReason)
          throw new HrError('OFFER_OUT_OF_RANGE_REASON_REQUIRED', 400);
      }
      const steps = await chainFor(a.requisition.id);
      if (!steps[1].approverUserIds.length)
        throw new HrError('OFFER_NO_PAYROLL_APPROVER', 409);
      await database
        .query()
        .updateTable('offers')
        .set({
          status: 'pendingApproval',
          approvals: steps,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      await notifyPending(await row(id));
      return service.detail(actor, id);
    },

    /** 用人经理确认人选与入职日期（看不到薪资）→ 薪酬审批审核薪资. */
    async decide(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'approve');
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const offer = await row(id);
      if (offer.status !== 'pendingApproval')
        throw new HrError('OFFER_NOT_PENDING', 409);
      const steps = offer.approvals.map((s) => ({ ...s }));
      const pending = steps.find((s) => s.status === 'pending');
      if (!pending?.approverUserIds.includes(actor.userId))
        throw new HrError('OFFER_NOT_APPROVER', 403);
      if (pending.kind === 'payrollApprover' && offer.salaryOffer) {
        const range = await rangeCheck(offer.positionId, offer.salaryOffer);
        if (range.outOfRange && !offer.outOfRangeReason)
          throw new HrError('OFFER_OUT_OF_RANGE_REASON_REQUIRED', 400);
      }
      const now = new Date();
      pending.decidedBy = actor.userId;
      pending.decidedAt = now.toISOString();
      pending.comment = parsed.data.comment ?? null;
      const recruiter = (await context(offer)).requisition.recruiterUserId;
      if (parsed.data.decision === 'reject') {
        if (!parsed.data.comment)
          throw new HrError('OFFER_COMMENT_REQUIRED', 400);
        pending.status = 'rejected';
        await database
          .query()
          .updateTable('offers')
          .set({ status: 'draft', approvals: steps, updatedAt: now })
          .where('id', '=', id)
          .execute();
        if (recruiter)
          await platform.notify({
            key: `offer:${id}:rejected:${pending.level}:${now.getTime()}`,
            userIds: [recruiter],
            message: 'recruitingOfferRejected',
            params: { comment: parsed.data.comment },
            path: `/talent/offers/${id}`,
          });
        return service.detail(actor, id);
      }
      pending.status = 'approved';
      const next = steps.find((s) => s.status === 'waiting');
      if (next) next.status = 'pending';
      await database
        .query()
        .updateTable('offers')
        .set({
          status: next ? 'pendingApproval' : 'approved',
          approvals: steps,
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      const fresh = await row(id);
      if (next) await notifyPending(fresh);
      else {
        // 审核通过后生成录用通知书.
        await writeLetter(fresh);
        if (recruiter)
          await platform.notify({
            key: `offer:${id}:approved`,
            userIds: [recruiter],
            message: 'recruitingOfferApproved',
            params: {},
            path: `/talent/offers/${id}`,
          });
      }
      return service.detail(actor, id);
    },

    /** 发送前预览邮件内容 (the link shows as a placeholder; it is made at sending). */
    async preview(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'send');
      const offer = await row(id);
      const a = await access(actor, offer);
      if (!a.recruiter) throw new HrError('OFFER_NOT_FOUND', 404);
      const settings = await ctx.settings();
      const respondBy = addDays(
        platform.currentDate(),
        settings.reminders.offerRespondDays,
      );
      const { values, template } = await emailPreview(
        offer,
        '（发送时生成的专属链接）',
      );
      const preboarding = await deps.templates.get('preboarding');
      return {
        to: a.candidate.email,
        subject: fill(template.subject, { ...values, respondBy }),
        body: fill(template.body, { ...values, respondBy }),
        respondBy,
        preboardingTemplate: preboarding,
      };
    },

    /** 须招聘负责人点击发送: emails the offer with the candidate's personal link. */
    async send(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'send');
      const offer = await row(id);
      const a = await access(actor, offer);
      if (!a.recruiter) throw new HrError('OFFER_NOT_FOUND', 404);
      if (offer.status !== 'approved')
        throw new HrError('OFFER_NOT_APPROVED', 409);
      if (!a.candidate.email) throw new HrError('CANDIDATE_EMAIL_MISSING', 409);
      const confirmTemplate =
        input && typeof input === 'object'
          ? (input as { confirmPreboardingTemplate?: unknown })
              .confirmPreboardingTemplate === true
          : false;
      const settings = await ctx.settings();
      const { token, hash } = newToken();
      const now = new Date();
      const respondBy = new Date(
        `${addDays(platform.currentDate(), settings.reminders.offerRespondDays)}T23:59:59+08:00`,
      );
      const link = ctx.publicUrl(`/offer/${token}`);
      const { values, template } = await emailPreview(offer, link);
      const text = {
        ...values,
        respondBy: localDate(respondBy, platform.timeZone),
      };
      const delivery = await ctx.sendEmail({
        key: `offer:${id}:${hash.slice(0, 12)}`,
        applicationId: offer.applicationId,
        to: a.candidate.email,
        subject: fill(template.subject, text),
        body: fill(template.body, text),
      });
      await database
        .query()
        .updateTable('offers')
        .set({
          status: 'sent',
          sentAt: now,
          respondBy,
          tokenHash: hash,
          linkToken: token,
          preboarding: {
            ...offer.preboarding,
            ...(confirmTemplate
              ? {
                  templateConfirmedAt: now.toISOString(),
                  templateConfirmedBy: actor.userId,
                }
              : {}),
          },
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      await candidates.addDraftMessage(offer.applicationId, {
        type: 'offer',
        subject: fill(template.subject, { ...text, link: '（专属链接）' }),
        body: fill(template.body, { ...text, link: '（专属链接）' }),
        draftedBy: 'rule',
      });
      // The record of what was sent: mark it sent at once (the draft only keeps the wording).
      const application = await candidates.applicationRow(offer.applicationId);
      await database
        .query()
        .updateTable('applications')
        .set({
          messages: application.messages.map((m) =>
            m.type === 'offer' && m.status === 'draft'
              ? {
                  ...m,
                  status: 'sent',
                  sentAt: now.toISOString(),
                  sentBy: actor.userId,
                  delivery,
                }
              : m,
          ),
          updatedAt: now,
        })
        .where('id', '=', offer.applicationId)
        .execute();
      ctx.audit({
        event: 'recruiting.offerSent',
        offerId: id,
        by: actor.userId,
        delivery,
      });
      return { ...(await service.detail(actor, id)), delivery };
    },

    /** 招聘负责人代为登记 the candidate's answer. */
    async record(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'manage');
      const offer = await row(id);
      if (!(await access(actor, offer)).recruiter)
        throw new HrError('OFFER_NOT_FOUND', 404);
      const parsed = z
        .object({
          accept: z.boolean(),
          reason: z.string().trim().max(500).nullish(),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await service.respondTrusted(
        offer,
        parsed.data.accept,
        'recorded',
        parsed.data.reason ?? null,
        actor.userId,
      );
      return service.detail(actor, id);
    },

    async withdraw(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'manage');
      const offer = await row(id);
      if (!(await access(actor, offer)).recruiter)
        throw new HrError('OFFER_NOT_FOUND', 404);
      if (
        !['draft', 'pendingApproval', 'approved', 'sent'].includes(offer.status)
      )
        throw new HrError('OFFER_CLOSED', 409);
      await database
        .query()
        .updateTable('offers')
        .set({
          status: 'withdrawn',
          tokenHash: null,
          linkToken: null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /** The candidate's link: accept or decline before respondBy (public route, token only). */
    async respondTrusted(
      offer: OfferView,
      accept: boolean,
      channel: 'link' | 'recorded',
      reason: string | null,
      by: string,
    ) {
      if (offer.status !== 'sent') throw new HrError('OFFER_NOT_SENT', 409);
      const now = new Date();
      if (
        channel === 'link' &&
        offer.respondBy &&
        new Date(offer.respondBy) < now
      )
        throw new HrError('OFFER_LINK_EXPIRED', 409);
      const c = await context(offer);
      const draft = accept
        ? {
            name: c.candidate.name,
            mobile: c.candidate.phone,
            email: c.candidate.email,
            toDepartmentId: offer.departmentId,
            toPositionId: offer.positionId,
            effectiveDate: offer.startDate,
            probationMonths: offer.probationMonths,
            employmentType: 'fullTime',
            createAccount: Boolean(c.candidate.email),
            careerStartDate: estimateCareerStart(
              c.candidate.parsedProfile?.experiences,
              offer.startDate,
            ),
          }
        : null;
      const updated = await database
        .query()
        .updateTable('offers')
        .set({
          status: accept ? 'accepted' : 'declined',
          respondedAt: now,
          responseChannel: channel,
          declineReason: accept ? null : reason,
          preboarding: { ...offer.preboarding, onboardDraft: draft },
          ...(accept ? {} : { tokenHash: null, linkToken: null }),
          updatedAt: now,
        })
        .where('id', '=', offer.id)
        .where('status', '=', 'sent')
        .execute();
      if (!(updated.updatedCount ?? 1))
        throw new HrError('OFFER_NOT_SENT', 409);
      if (accept) {
        await candidates.stamp(
          offer.applicationId,
          c.application.stage,
          'hired',
          by,
        );
        // 通知 hr.admin 提交入职单 (工号由 HR 填写).
        await platform.notify({
          key: `offer:${offer.id}:onboardDraft`,
          userIds: await ctx.hrAdministrators(),
          message: 'recruitingOnboardDraft',
          params: {
            position: (await ctx.position(offer.positionId))?.title ?? '',
            date: offer.startDate,
          },
          path: `/talent/offers/${offer.id}/onboard`,
        });
      }
      if (c.requisition.recruiterUserId)
        await platform.notify({
          key: `offer:${offer.id}:${accept ? 'accepted' : 'declined'}`,
          userIds: [c.requisition.recruiterUserId],
          message: accept
            ? 'recruitingOfferAccepted'
            : 'recruitingOfferDeclined',
          params: { name: c.candidate.name },
          path: `/talent/offers/${offer.id}`,
        });
    },

    /** 入职单草稿: the pre-filled content and the recognized fields, for hr.admin. */
    async onboardDraft(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'onboard');
      if (!(await ctx.isHrAdmin(actor)))
        throw new HrError('OFFER_NOT_FOUND', 404);
      const offer = await row(id);
      if (!['accepted'].includes(offer.status))
        throw new HrError('OFFER_NOT_ACCEPTED', 409);
      const draft = offer.preboarding.onboardDraft ?? {};
      return {
        offerId: offer.id,
        onboardActionId: offer.onboardActionId,
        draft,
        departmentTitle: await ctx.departmentTitle(offer.departmentId),
        positionTitle: (await ctx.position(offer.positionId))?.title ?? '',
        arrivalConfirmedAt: offer.preboarding.arrivalConfirmedAt,
        uploads: offer.preboarding.uploads.map((u) => ({
          kind: u.kind,
          uploadedAt: u.uploadedAt,
        })),
        // 待 HR 确认的档案信息 from the uploaded documents.
        suggestions: offer.preboarding.suggestions,
      };
    },

    /** hr.admin fills 工号 and submits: core HR's onboarding action with the configured chain. */
    async submitOnboard(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'onboard');
      if (!(await ctx.isHrAdmin(actor)))
        throw new HrError('OFFER_NOT_FOUND', 404);
      const parsed = onboardSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const offer = await row(id);
      if (offer.status !== 'accepted')
        throw new HrError('OFFER_NOT_ACCEPTED', 409);
      if (offer.onboardActionId)
        throw new HrError('OFFER_ALREADY_ONBOARDED', 409);
      const draft = offer.preboarding.onboardDraft ?? {};
      const action = await ctx.core().createAction(actor, {
        actionType: 'onboard',
        name: parsed.data.name ?? draft.name,
        employeeNo: parsed.data.employeeNo,
        mobile: parsed.data.mobile ?? draft.mobile ?? null,
        email: parsed.data.email ?? draft.email ?? null,
        toDepartmentId: draft.toDepartmentId,
        toPositionId: draft.toPositionId,
        effectiveDate: parsed.data.effectiveDate ?? draft.effectiveDate,
        probationMonths: draft.probationMonths,
        employmentType:
          parsed.data.employmentType ?? draft.employmentType ?? 'fullTime',
        careerStartDate:
          parsed.data.careerStartDate === undefined
            ? (draft.careerStartDate ?? null)
            : parsed.data.careerStartDate,
        createAccount:
          parsed.data.createAccount ?? draft.createAccount === true,
        reason: '由 Offer 生成',
        // 来自已接受的 Offer: the offer, and only the names of the fields read
        // from the uploads — their values reach HR as a change request after
        // onboarding (onboarding.ts), never through the action.
        offerId: offer.id,
        recognizedFields: [
          ...new Set(
            offer.preboarding.suggestions
              .filter((s) => s.status === 'pending')
              .flatMap((s) => Object.keys(s.fields)),
          ),
        ].slice(0, 20),
      });
      await database
        .query()
        .updateTable('offers')
        .set({ onboardActionId: action.id, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: new Date(), updatedAt: new Date() })
        .where('refId', '=', `offer:${id}:onboardDraft`)
        .where('status', '=', 'open')
        .execute()
        .catch(() => undefined);
      return { actionId: action.id, status: action.status };
    },

    async letter(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.offer, 'viewSalary');
      const offer = await row(id);
      const a = await access(actor, offer);
      if (!a.salary || !offer.offerLetterFileId)
        throw new HrError('OFFER_NOT_FOUND', 404);
      const file = await ctx.readFile(offer.offerLetterFileId);
      if (!file) throw new HrError('OFFER_NOT_FOUND', 404);
      return file;
    },

    /** The offer a link token belongs to, while the link is valid. */
    async byToken(token: string): Promise<OfferView> {
      if (!/^[\w-]{20,64}$/u.test(token))
        throw new HrError('OFFER_LINK_INVALID', 404);
      const found = await database
        .query()
        .selectFrom('offers')
        .selectAll()
        .where('tokenHash', '=', sha256(token))
        .executeTakeFirst();
      if (!found) throw new HrError('OFFER_LINK_INVALID', 404);
      const offer = presentOffer(found);
      // 入职生效后失效; a declined, withdrawn or expired offer answers nothing. An accepted offer's link serves
      // 待入职跟进 until OFFER_LINK_DAYS_AFTER_START days after the start date, should the onboarding never take
      // effect (readiness review 2026-10-07); a sent one closes at respondBy (respondTrusted, the daily expiry).
      if (
        offer.preboarding.onboardedAt ||
        ['withdrawn', 'declined', 'expired'].includes(offer.status) ||
        (offer.status === 'accepted' &&
          offer.startDate &&
          addDays(offer.startDate, OFFER_LINK_DAYS_AFTER_START) <
            platform.currentDate())
      )
        throw new HrError('OFFER_LINK_INVALID', 404);
      return offer;
    },

    /** 每天 09:00: a sent offer past its deadline expires. */
    async expire(now: Date) {
      const rows = await database
        .query()
        .selectFrom('offers')
        .select(['id', 'respondBy'])
        .where('status', '=', 'sent')
        .execute()
        // Compared as instants (SQLite keeps datetimes as text).
        .then((all) =>
          all.filter(
            (r) =>
              r.respondBy &&
              new Date(str(r.respondBy)).getTime() < now.getTime(),
          ),
        );
      for (const r of rows)
        await database
          .query()
          .updateTable('offers')
          .set({
            status: 'expired',
            tokenHash: null,
            linkToken: null,
            updatedAt: new Date(),
          })
          .where('id', '=', str(r.id))
          .where('status', '=', 'sent')
          .execute();
      return rows.length;
    },

    localDateTime: (value: string) => localDateTime(value, platform.timeZone),

    /** The candidate's current link token (trusted: for the reminder emails only). */
    async linkToken(id: string): Promise<string | null> {
      const found = await database
        .query()
        .selectFrom('offers')
        .select(['linkToken'])
        .where('id', '=', id)
        .executeTakeFirst();
      return found?.linkToken ? str(found.linkToken) : null;
    },
  };
  return service;
}

export type OfferService = ReturnType<typeof createOfferService>;
