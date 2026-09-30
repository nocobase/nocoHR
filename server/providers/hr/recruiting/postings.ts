/**
 * 职位 (V2-07). A posting belongs to an open requisition. Its requirements
 * are keyed (the key is referenced by screening, rejection reasons,
 * interview questions and scorecards) and say where each came from: the
 * department's checklist (kept as written), the job description, the
 * recruiter, or the V3-08 岗位能力要求. Only a confirmed posting can be
 * published; editing its requirements or knockout questions returns it to
 * draft. Interview slots are checked against the interviewers' interviews
 * and shifts; self-booking needs the recruiter to confirm the reminder
 * template once.
 *
 * Who may do what: the requisition's recruiter manages and publishes;
 * hr.admin reads.
 */
import { yesNoValue } from './common.js';
import { randomBytes } from 'node:crypto';

import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { Calendar } from './calendar.js';
import {
  bool,
  iso,
  json,
  REQUIREMENT_TYPES,
  uniqueKeys,
  type InterviewSlot,
  type KnockoutQuestion,
  type Requirement,
} from './common.js';
import type { RecruitingContext } from './context.js';
import type { RequisitionService, RequisitionView } from './requisitions.js';
import { COMPOSITE } from './resources.js';

export const requirementSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][\w-]{0,39}$/u),
    type: z.enum(REQUIREMENT_TYPES),
    text: z.string().trim().min(1).max(300),
    mustHave: z.boolean(),
    origin: z.enum(['responsibilities', 'checklist', 'manual', 'competency']),
    competencyId: z.string().min(1).max(64).nullish(),
    level: z.number().int().min(1).max(10).nullish(),
  })
  .strict();

export const knockoutSchema = z
  .object({
    key: z.string().regex(/^[a-zA-Z][\w-]{0,39}$/u),
    question: z.string().trim().min(1).max(200),
    answerType: z.enum(['yesNo', 'choice', 'shortText']),
    options: z.array(z.string().trim().min(1).max(60)).max(8).nullish(),
    requirementKey: z.string().min(1).max(40),
    expected: z.string().trim().max(60).nullish(),
  })
  .strict()
  // yes/no expectations are stored as 'yes' / 'no' (an editor may type 是 / 能).
  .transform((q) =>
    q.answerType === 'yesNo'
      ? { ...q, expected: yesNoValue(q.expected) ?? q.expected }
      : q,
  );

const slotSchema = z
  .object({
    start: z.string().datetime({ offset: true }),
    end: z.string().datetime({ offset: true }),
    capacity: z.number().int().min(1).max(200),
    location: z.string().trim().max(200).nullish(),
    interviewerUserIds: z.array(z.string().min(1).max(64)).min(1).max(10),
  })
  .strict();

const draftSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(20_000),
    requirements: z.array(requirementSchema).min(1).max(40),
    location: z.string().trim().min(1).max(200),
    knockoutQuestions: z.array(knockoutSchema).max(5).default([]),
  })
  .strict();

const operationalSchema = z
  .object({
    channels: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(100),
            postedAt: z.string().max(40).nullish(),
            link: z.string().trim().max(500).nullish(),
          })
          .strict(),
      )
      .max(30)
      .optional(),
    interviewSlots: z.array(slotSchema).max(60).optional(),
  })
  .strict();

const bookingSchema = z
  .object({
    enabled: z.boolean(),
    template: z
      .object({
        subject: z.string().trim().min(1).max(200),
        body: z.string().trim().min(1).max(4000),
      })
      .strict()
      .nullish(),
  })
  .strict();

export function presentPosting(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    requisitionId: str(row.requisitionId),
    title: str(row.title),
    description: str(row.description),
    requirements: json<Requirement[]>(row.requirements, []),
    location: str(row.location),
    publicSlug: row.publicSlug ? str(row.publicSlug) : null,
    channels: json<{ name: string; postedAt?: string; link?: string }[]>(
      row.channels,
      [],
    ),
    status: str(row.status),
    source: str(row.source),
    reviewStatus: str(row.reviewStatus),
    knockoutQuestions: json<KnockoutQuestion[]>(row.knockoutQuestions, []),
    interviewSlots: json<InterviewSlot[]>(row.interviewSlots, []),
    selfBookingEnabled: bool(row.selfBookingEnabled),
    bookingTemplate: json<{
      subject: string;
      body: string;
      confirmedBy: string;
      confirmedAt: string;
    } | null>(row.bookingTemplate, null),
    aiInterviewEnabled: bool(row.aiInterviewEnabled),
    aiInterviewPlan: json<Record<string, unknown> | null>(
      row.aiInterviewPlan,
      null,
    ),
    confirmedBy: row.confirmedBy ? str(row.confirmedBy) : null,
    confirmedAt: iso(row.confirmedAt),
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
  };
}
export type PostingView = ReturnType<typeof presentPosting>;

/**
 * Checks a draft's requirements and questions against its requisition: the
 * checklist's items stay as written, keys are unique, each knockout question
 * refers to a must-have requirement.
 */
export function validateDraft(
  requisition: Pick<RequisitionView, 'requirementsChecklist'>,
  requirements: readonly Requirement[],
  questions: readonly KnockoutQuestion[],
) {
  if (!uniqueKeys(requirements))
    throw new HrError('POSTING_REQUIREMENT_KEY_DUPLICATE', 400);
  const texts = requirements
    .filter((r) => r.origin === 'checklist')
    .map((r) => r.text.trim());
  for (const item of requisition.requirementsChecklist)
    if (!texts.includes(item.text.trim()))
      throw new HrError('POSTING_CHECKLIST_CHANGED', 400, { text: item.text });
  for (const r of requirements.filter((x) => x.origin === 'checklist')) {
    const item = requisition.requirementsChecklist.find(
      (i) => i.text.trim() === r.text.trim(),
    );
    if (!item || item.mustHave !== r.mustHave || item.type !== r.type)
      throw new HrError('POSTING_CHECKLIST_CHANGED', 400, { text: r.text });
  }
  if (!uniqueKeys(questions))
    throw new HrError('POSTING_QUESTION_KEY_DUPLICATE', 400);
  for (const q of questions) {
    const target = requirements.find((r) => r.key === q.requirementKey);
    if (!target?.mustHave)
      throw new HrError('POSTING_QUESTION_REQUIREMENT_INVALID', 400, {
        key: q.key,
      });
    if (q.answerType === 'choice' && !(q.options ?? []).length)
      throw new HrError('POSTING_QUESTION_OPTIONS_REQUIRED', 400);
  }
}

export function createPostingService(
  ctx: RecruitingContext,
  deps: { requisitions: RequisitionService; calendar: Calendar },
) {
  const { database, platform } = ctx;
  const { requisitions, calendar } = deps;

  async function row(id: string): Promise<PostingView> {
    const found = await database
      .query()
      .selectFrom('jobPostings')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('POSTING_NOT_FOUND', 404);
    return presentPosting(found);
  }

  /** The requisition's recruiter may manage it; hr.admin and others read. */
  async function access(actor: ActorContext, posting: PostingView) {
    const requisition = await requisitions.get(posting.requisitionId);
    const manage =
      requisition.recruiterUserId === actor.userId &&
      (await ctx.can(actor, COMPOSITE.posting, 'manage'));
    const read =
      manage ||
      (await ctx.isHrAdmin(actor)) ||
      requisition.hiringManagerUserId === actor.userId;
    return { requisition, manage, read };
  }

  async function assertManage(actor: ActorContext, id: string) {
    await authorizeAction(actor.authz, COMPOSITE.posting, 'manage');
    const posting = await row(id);
    const a = await access(actor, posting);
    if (!a.manage) throw new HrError('POSTING_NOT_FOUND', 404);
    return { posting, requisition: a.requisition };
  }

  async function bookedCounts(postingId: string) {
    const rows = await database
      .query()
      .selectFrom('interviews')
      .innerJoin('applications', 'applications.id', 'interviews.applicationId')
      .select(['interviews.slotKey as slotKey'])
      .where('applications.postingId', '=', postingId)
      .where('interviews.status', '=', 'scheduled')
      .where('interviews.slotKey', 'is not', null)
      .execute();
    const counts = new Map<string, number>();
    for (const r of rows)
      counts.set(str(r.slotKey), (counts.get(str(r.slotKey)) ?? 0) + 1);
    return counts;
  }

  async function decorate(actor: ActorContext, posting: PostingView) {
    const a = await access(actor, posting);
    const counts = await bookedCounts(posting.id);
    const applications = await database
      .query()
      .selectFrom('applications')
      .select(['stage'])
      .where('postingId', '=', posting.id)
      .execute();
    return {
      ...posting,
      requisition: {
        id: a.requisition.id,
        departmentId: a.requisition.departmentId,
        departmentTitle: await ctx.departmentTitle(a.requisition.departmentId),
        positionId: a.requisition.positionId,
        positionTitle:
          (await ctx.position(a.requisition.positionId))?.title ?? '',
        headcount: a.requisition.headcount,
        hiredCount: a.requisition.hiredCount,
        recruiterUserId: a.requisition.recruiterUserId,
        checklist: a.requisition.requirementsChecklist,
      },
      interviewSlots: posting.interviewSlots.map((s) => ({
        ...s,
        booked: counts.get(s.start) ?? 0,
      })),
      applicationCount: applications.length,
      confirmedByName: await platform.userName(posting.confirmedBy),
      can: {
        manage: a.manage,
        publish:
          a.manage &&
          posting.reviewStatus === 'confirmed' &&
          posting.status !== 'published',
      },
    };
  }

  async function checkSlots(slots: readonly InterviewSlot[]) {
    for (const slot of slots) {
      if (!(new Date(slot.end).getTime() > new Date(slot.start).getTime()))
        throw new HrError('POSTING_SLOT_INVALID', 400);
      const conflicts = await calendar.conflicts({
        interviewerUserIds: slot.interviewerUserIds,
        start: slot.start,
        end: slot.end,
      });
      if (conflicts.length)
        throw new HrError('POSTING_SLOT_CONFLICT', 409, {
          start: slot.start,
          names: [...new Set(conflicts.map((c) => c.name ?? c.userId))].join(
            '、',
          ),
        });
    }
  }

  const service = {
    get: row,
    access,
    bookedCounts,

    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.posting, 'view');
      let q = database.query().selectFrom('jobPostings').selectAll();
      if (query.status) q = q.where('status', '=', query.status);
      if (query.requisitionId)
        q = q.where('requisitionId', '=', query.requisitionId);
      const rows = await q.orderBy('createdAt', 'desc').execute();
      const items = [];
      for (const r of rows) {
        const posting = presentPosting(r);
        if ((await access(actor, posting)).read)
          items.push(await decorate(actor, posting));
      }
      return {
        items,
        can: { manage: await ctx.can(actor, COMPOSITE.posting, 'manage') },
      };
    },

    async detail(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.posting, 'view');
      const posting = await row(id);
      if (!(await access(actor, posting)).read)
        throw new HrError('POSTING_NOT_FOUND', 404);
      return decorate(actor, posting);
    },

    /** A manual draft: the checklist's items become requirements as written. */
    async create(actor: ActorContext, requisitionId: string) {
      await authorizeAction(actor.authz, COMPOSITE.posting, 'manage');
      const requisition = await requisitions.get(requisitionId);
      if (requisition.recruiterUserId !== actor.userId)
        throw new HrError('REQUISITION_NOT_FOUND', 404);
      if (requisition.status !== 'open')
        throw new HrError('REQUISITION_NOT_OPEN', 409);
      const position = await ctx.position(requisition.positionId);
      const id = await service.insertDraft({
        requisition,
        source: 'manual',
        title: position?.title ?? '',
        description: position?.responsibilities ?? '',
        location: await ctx.departmentTitle(requisition.departmentId),
        requirements: requisition.requirementsChecklist.map((item, i) => ({
          key: `c${i + 1}`,
          type: item.type,
          text: item.text,
          mustHave: item.mustHave,
          origin: 'checklist' as const,
        })),
        knockoutQuestions: [],
      });
      return service.detail(actor, id);
    },

    /** Trusted insert of a draft (manual or the assistant's, which validated it). */
    async insertDraft(input: {
      requisition: RequisitionView;
      source: 'manual' | 'ai';
      title: string;
      description: string;
      location: string;
      requirements: Requirement[];
      knockoutQuestions: KnockoutQuestion[];
    }): Promise<string> {
      validateDraft(
        input.requisition,
        input.requirements,
        input.knockoutQuestions,
      );
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('jobPostings')
        .values({
          id,
          requisitionId: input.requisition.id,
          title: input.title || '—',
          description: input.description || '—',
          requirements: input.requirements,
          location: input.location || '—',
          publicSlug: null,
          channels: [],
          status: 'draft',
          source: input.source,
          reviewStatus: 'draft',
          knockoutQuestions: input.knockoutQuestions,
          interviewSlots: [],
          selfBookingEnabled: false,
          bookingTemplate: null,
          aiInterviewEnabled: false,
          aiInterviewPlan: null,
          confirmedBy: null,
          confirmedAt: null,
          publishedAt: null,
          closedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return id;
    },

    /** Text, requirements and knockout questions: the posting returns to draft and must be confirmed again. */
    async update(actor: ActorContext, id: string, input: unknown) {
      const { posting, requisition } = await assertManage(actor, id);
      if (posting.status === 'closed') throw new HrError('POSTING_CLOSED', 409);
      const parsed = draftSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const data = parsed.data;
      validateDraft(
        requisition,
        data.requirements,
        data.knockoutQuestions as KnockoutQuestion[],
      );
      await database
        .query()
        .updateTable('jobPostings')
        .set({
          title: data.title,
          description: data.description,
          requirements: data.requirements,
          location: data.location,
          knockoutQuestions: data.knockoutQuestions,
          reviewStatus: 'draft',
          confirmedBy: null,
          confirmedAt: null,
          // A published posting goes offline until it is confirmed again.
          status: posting.status === 'published' ? 'draft' : posting.status,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /** Channels and interview slots, without touching the reviewed content. */
    async updateOperational(actor: ActorContext, id: string, input: unknown) {
      const { posting } = await assertManage(actor, id);
      const parsed = operationalSchema.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.channels) values.channels = parsed.data.channels;
      if (parsed.data.interviewSlots) {
        const slots = parsed.data.interviewSlots.map((s) => ({
          start: new Date(s.start).toISOString(),
          end: new Date(s.end).toISOString(),
          capacity: s.capacity,
          location: s.location ?? null,
          interviewerUserIds: s.interviewerUserIds,
        }));
        const counts = await bookedCounts(posting.id);
        // Slots someone already booked stay; only new or changed slots are checked against calendars.
        const fresh = slots.filter(
          (s) =>
            !posting.interviewSlots.some(
              (old) =>
                old.start === s.start &&
                old.end === s.end &&
                JSON.stringify(old.interviewerUserIds) ===
                  JSON.stringify(s.interviewerUserIds),
            ),
        );
        await checkSlots(fresh);
        for (const old of posting.interviewSlots)
          if (
            (counts.get(old.start) ?? 0) > 0 &&
            !slots.some((s) => s.start === old.start)
          )
            throw new HrError('POSTING_SLOT_BOOKED', 409, { start: old.start });
        values.interviewSlots = slots;
      }
      await database
        .query()
        .updateTable('jobPostings')
        .set(values)
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /** 开启自助约面: the recruiter confirms the reminder template once; later emails follow it. */
    async setBooking(actor: ActorContext, id: string, input: unknown) {
      const { posting } = await assertManage(actor, id);
      const parsed = bookingSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      if (
        parsed.data.enabled &&
        !parsed.data.template &&
        !posting.bookingTemplate
      )
        throw new HrError('POSTING_BOOKING_TEMPLATE_REQUIRED', 400);
      const template = parsed.data.template
        ? {
            ...parsed.data.template,
            confirmedBy: actor.userId,
            confirmedAt: new Date().toISOString(),
          }
        : posting.bookingTemplate;
      await database
        .query()
        .updateTable('jobPostings')
        .set({
          selfBookingEnabled: parsed.data.enabled,
          bookingTemplate: template,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async confirm(actor: ActorContext, id: string) {
      const { posting, requisition } = await assertManage(actor, id);
      validateDraft(
        requisition,
        posting.requirements,
        posting.knockoutQuestions,
      );
      const now = new Date();
      await database
        .query()
        .updateTable('jobPostings')
        .set({
          reviewStatus: 'confirmed',
          confirmedBy: actor.userId,
          confirmedAt: now,
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      // The draft the assistant wrote was adopted (or edited first).
      await database
        .query()
        .updateTable('aiTaskRunItems')
        .set({
          outcome: posting.source === 'ai' ? 'adopted' : 'modified',
          outcomeByUserId: actor.userId,
          outcomeAt: now,
          updatedAt: now,
        })
        .where('entityType', '=', 'jobPosting')
        .where('entityId', '=', id)
        .where('outcome', '=', 'pending')
        .execute()
        .catch(() => undefined);
      return service.detail(actor, id);
    },

    async publish(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.posting, 'publish');
      const { posting, requisition } = await assertManage(actor, id);
      if (posting.reviewStatus !== 'confirmed')
        throw new HrError('POSTING_NOT_CONFIRMED', 409);
      if (requisition.status !== 'open')
        throw new HrError('REQUISITION_NOT_OPEN', 409);
      const now = new Date();
      await database
        .query()
        .updateTable('jobPostings')
        .set({
          status: 'published',
          publicSlug:
            posting.publicSlug ??
            `${randomBytes(4).toString('hex')}${Date.now().toString(36).slice(-4)}`,
          ...(posting.publishedAt ? {} : { publishedAt: now }),
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async close(actor: ActorContext, id: string) {
      await assertManage(actor, id);
      const now = new Date();
      await database
        .query()
        .updateTable('jobPostings')
        .set({ status: 'closed', closedAt: now, updatedAt: now })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /**
     * 第八步起：从岗位能力要求一键带入. Adds the position's confirmed
     * requirements (skills and qualities) as `competency` requirements; an
     * internal qualification obtained after joining (上岗证) is not a hiring
     * condition and is left out.
     */
    async importCompetencies(actor: ActorContext, id: string) {
      const { posting, requisition } = await assertManage(actor, id);
      const rows = await database
        .query()
        .selectFrom('positionRequirements')
        .innerJoin(
          'competencies',
          'competencies.id',
          'positionRequirements.competencyId',
        )
        .select([
          'positionRequirements.competencyId as competencyId',
          'positionRequirements.requiredLevel as level',
          'positionRequirements.mandatory as mandatory',
          'competencies.title as title',
          'competencies.category as category',
        ])
        .where('positionRequirements.positionId', '=', requisition.positionId)
        .where('positionRequirements.reviewStatus', '=', 'confirmed')
        .execute();
      const requirements = [...posting.requirements];
      for (const r of rows) {
        if (str(r.category) === 'qualification') continue;
        if (requirements.some((x) => x.competencyId === str(r.competencyId)))
          continue;
        requirements.push({
          key: `k${requirements.length + 1}`,
          type: 'skill',
          text: `${str(r.title)}（${Number(r.level)} 级）`,
          mustHave: bool(r.mandatory),
          origin: 'competency',
          competencyId: str(r.competencyId),
          level: Number(r.level),
        });
      }
      let n = requirements.length;
      while (!uniqueKeys(requirements) && n < 200) {
        const seen = new Set<string>();
        for (const r of requirements) {
          if (seen.has(r.key)) r.key = `k${(n += 1)}`;
          seen.add(r.key);
        }
      }
      return service.update(actor, id, {
        title: posting.title,
        description: posting.description,
        requirements,
        location: posting.location,
        knockoutQuestions: posting.knockoutQuestions,
      });
    },
  };
  return service;
}

export type PostingService = ReturnType<typeof createPostingService>;
