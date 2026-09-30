/**
 * 招聘需求 (V2-07). A department raises a requisition for a position (or a
 * workforce plan produces a draft); its checklist is the department's own
 * conditions. Submitting builds the approval chain from 招聘设置:
 *
 * 1. the department's head, walking up past departments without one (a
 *    level whose approver raised the requisition passes by itself);
 * 2. any levels 招聘设置 adds for the department or an ancestor;
 * 3. any HR administrator, who names the recruiter when approving.
 *
 * The last approval opens the requisition; the recruiting assistant then
 * drafts the posting and searches the talent pool once (see assistant.ts).
 * A rejection sends the requisition back to draft with the decision kept in
 * its approval record.
 *
 * Visibility: hr.admin every requisition; a recruiter those assigned to
 * them; a head those of the departments they manage; anyone the
 * requisition names (requester, hiring manager, current approver).
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import {
  day,
  iso,
  json,
  num,
  REQUIREMENT_TYPES,
  type ApprovalStep,
  type ChecklistItem,
} from './common.js';
import type { RecruitingContext } from './context.js';
import { COMPOSITE } from './resources.js';

const checklistSchema = z
  .array(
    z
      .object({
        type: z.enum(REQUIREMENT_TYPES),
        text: z.string().trim().min(1).max(200),
        mustHave: z.boolean(),
      })
      .strict(),
  )
  .max(30);

const inputSchema = z
  .object({
    departmentId: z.string().min(1).max(64),
    positionId: z.string().min(1).max(64),
    headcount: z.number().int().min(1).max(10_000),
    reason: z.enum(['newHeadcount', 'replacement']),
    replacingEmployeeId: z.string().min(1).max(64).nullish(),
    targetDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    requirementsChecklist: checklistSchema.default([]),
    hiringManagerUserId: z.string().min(1).max(64).nullish(),
    note: z.string().trim().max(2000).nullish(),
  })
  .strict();

const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    comment: z.string().trim().max(1000).nullish(),
    recruiterUserId: z.string().min(1).max(64).nullish(),
  })
  .strict();

export function presentRequisition(row: Record<string, unknown>) {
  return {
    id: str(row.id),
    departmentId: str(row.departmentId),
    positionId: str(row.positionId),
    headcount: num(row.headcount),
    reason: str(row.reason),
    workforcePlanId: row.workforcePlanId ? str(row.workforcePlanId) : null,
    replacingEmployeeId: row.replacingEmployeeId
      ? str(row.replacingEmployeeId)
      : null,
    targetDate: day(row.targetDate),
    requirementsChecklist: json<ChecklistItem[]>(
      row.requirementsChecklist,
      [],
    ),
    note: row.note ? str(row.note) : null,
    requesterUserId: str(row.requesterUserId),
    hiringManagerUserId: str(row.hiringManagerUserId),
    recruiterUserId: row.recruiterUserId ? str(row.recruiterUserId) : null,
    status: str(row.status),
    approvals: json<ApprovalStep[]>(row.approvals, []),
    hiredCount: num(row.hiredCount),
    poolSuggestion: json<Record<string, unknown> | null>(
      row.poolSuggestion,
      null,
    ),
    openedAt: iso(row.openedAt),
    createdAt: iso(row.createdAt),
  };
}
export type RequisitionView = ReturnType<typeof presentRequisition>;

export function createRequisitionService(
  ctx: RecruitingContext,
  hooks: {
    /** The requisition opened: the recruiting assistant drafts the posting and searches the pool (background, once). */
    onOpened: (requisitionId: string) => void;
  },
) {
  const { database, platform } = ctx;

  async function row(id: string) {
    const found = await database
      .query()
      .selectFrom('jobRequisitions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!found) throw new HrError('REQUISITION_NOT_FOUND', 404);
    return presentRequisition(found);
  }

  async function visible(actor: ActorContext, r: RequisitionView) {
    if (await ctx.isHrAdmin(actor)) return true;
    if (
      r.recruiterUserId === actor.userId ||
      r.requesterUserId === actor.userId ||
      r.hiringManagerUserId === actor.userId
    )
      return true;
    const pending = r.approvals.find((s) => s.status === 'pending');
    if (pending?.approverUserIds.includes(actor.userId)) return true;
    const managed = await platform.organization.managedDepartments(
      actor.userId,
    );
    return managed.includes(r.departmentId);
  }

  async function decorate(actor: ActorContext, r: RequisitionView) {
    const position = await ctx.position(r.positionId);
    const pending = r.approvals.find((s) => s.status === 'pending');
    const hrAdmin = await ctx.isHrAdmin(actor);
    const names = async (ids: readonly string[]) =>
      Promise.all(ids.map(async (id) => (await platform.userName(id)) ?? id));
    return {
      ...r,
      departmentTitle: await ctx.departmentTitle(r.departmentId),
      positionTitle: position?.title ?? r.positionId,
      responsibilities: position?.responsibilities ?? null,
      jobFamily: position?.jobFamily ?? null,
      grade: position?.grade ?? null,
      requesterName: await platform.userName(r.requesterUserId),
      hiringManagerName: await platform.userName(r.hiringManagerUserId),
      recruiterName: await platform.userName(r.recruiterUserId),
      approvals: await Promise.all(
        r.approvals.map(async (s) => ({
          ...s,
          approverNames: await names(s.approverUserIds),
          decidedByName: await platform.userName(s.decidedBy),
        })),
      ),
      can: {
        edit:
          r.status === 'draft' &&
          (hrAdmin || r.requesterUserId === actor.userId ||
            (await platform.organization.managedDepartments(actor.userId)).includes(
              r.departmentId,
            )),
        approve:
          r.status === 'pending' &&
          Boolean(pending) &&
          (pending!.kind === 'hrAdmin'
            ? hrAdmin
            : pending!.approverUserIds.includes(actor.userId)),
        assignRecruiter:
          ['approved', 'open'].includes(r.status) &&
          (await ctx.can(actor, COMPOSITE.requisition, 'assignRecruiter')),
        pickRecruiter: pending?.kind === 'hrAdmin' && hrAdmin,
      },
    };
  }

  async function checkScope(actor: ActorContext, departmentId: string) {
    if (await ctx.isHrAdmin(actor)) return;
    const managed = await platform.organization.managedDepartments(
      actor.userId,
    );
    if (!managed.includes(departmentId))
      throw new HrError('REQUISITION_NOT_ELIGIBLE', 403);
  }

  async function buildChain(
    r: RequisitionView,
    requester: string,
  ): Promise<ApprovalStep[]> {
    const settings = await ctx.settings();
    const steps: ApprovalStep[] = [];
    const head = await ctx.headOfDepartment(r.departmentId);
    const base = {
      decidedBy: null,
      decidedAt: null,
      comment: null,
    };
    if (head)
      steps.push({
        level: 1,
        kind: 'departmentHead',
        name: null,
        approverUserIds: [head],
        status: head === requester ? 'auto' : 'waiting',
        ...base,
        ...(head === requester
          ? { decidedBy: requester, decidedAt: new Date().toISOString() }
          : {}),
      });
    const chain = (await platform.organization.activeChain(r.departmentId)) ?? [
      r.departmentId,
    ];
    for (const extra of settings.approvals.requisitionExtra)
      if (chain.includes(extra.departmentId))
        steps.push({
          level: steps.length + 1,
          kind: 'extra',
          name: extra.name,
          approverUserIds: [extra.approverUserId],
          status: extra.approverUserId === requester ? 'auto' : 'waiting',
          ...base,
        });
    steps.push({
      level: steps.length + 1,
      kind: 'hrAdmin',
      name: null,
      approverUserIds: await ctx.hrAdministrators(),
      permissionSet: 'hr.admin',
      status: 'waiting',
      ...base,
    });
    const first = steps.find((s) => s.status === 'waiting');
    if (first) first.status = 'pending';
    return steps;
  }

  async function notifyPending(r: RequisitionView, steps: ApprovalStep[]) {
    const pending = steps.find((s) => s.status === 'pending');
    if (!pending) return;
    const position = (await ctx.position(r.positionId))?.title ?? '';
    await platform.notify({
      key: `requisition:${r.id}:level:${pending.level}`,
      userIds: pending.approverUserIds.filter((u) => u !== r.requesterUserId),
      message: 'recruitingRequisitionPending',
      params: {
        department: await ctx.departmentTitle(r.departmentId),
        position,
        count: String(r.headcount),
      },
      path: `/talent/requisitions/${r.id}`,
    });
  }

  async function parse(input: unknown) {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      throw new HrError('INVALID_INPUT', 400, {
        fields: parsed.error.issues.map((i) => i.path.join('.')),
      });
    const data = parsed.data;
    const position = await ctx.position(data.positionId);
    if (!position) throw new HrError('EMPLOYEE_POSITION_NOT_FOUND', 404);
    if (!(await platform.organization.getDepartment(data.departmentId)))
      throw new HrError('EMPLOYEE_DEPARTMENT_NOT_FOUND', 404);
    return data;
  }

  const service = {
    get: row,
    visible,

    async list(actor: ActorContext, query: Record<string, string | undefined>) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'view');
      let q = database.query().selectFrom('jobRequisitions').selectAll();
      if (query.status) q = q.where('status', '=', query.status);
      const rows = await q.orderBy('createdAt', 'desc').execute();
      const items = [];
      for (const r of rows) {
        const view = presentRequisition(r);
        if (await visible(actor, view)) items.push(await decorate(actor, view));
      }
      return {
        items,
        can: { create: await ctx.can(actor, COMPOSITE.requisition, 'create') },
      };
    },

    async detail(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'view');
      const r = await row(id);
      if (!(await visible(actor, r)))
        throw new HrError('REQUISITION_NOT_FOUND', 404);
      const postings = await database
        .query()
        .selectFrom('jobPostings')
        .select(['id', 'title', 'status', 'reviewStatus'])
        .where('requisitionId', '=', id)
        .execute();
      return {
        ...(await decorate(actor, r)),
        postings: postings.map((p) => ({
          id: str(p.id),
          title: str(p.title),
          status: str(p.status),
          reviewStatus: str(p.reviewStatus),
        })),
      };
    },

    /** The position's job description, for the form; hints to fill it in when it is empty. */
    async positionContext(actor: ActorContext, positionId: string) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'view');
      const position = await ctx.position(positionId);
      if (!position) throw new HrError('EMPLOYEE_POSITION_NOT_FOUND', 404);
      const last = await database
        .query()
        .selectFrom('jobRequisitions')
        .select(['requirementsChecklist'])
        .where('positionId', '=', positionId)
        .orderBy('createdAt', 'desc')
        .execute();
      const checklist =
        last
          .map((l) => json<ChecklistItem[]>(l.requirementsChecklist, []))
          .find((c) => c.length) ?? [];
      return { ...position, lastChecklist: checklist };
    },

    async create(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'create');
      const data = await parse(input);
      await checkScope(actor, data.departmentId);
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('jobRequisitions')
        .values({
          id,
          departmentId: data.departmentId,
          positionId: data.positionId,
          headcount: data.headcount,
          reason: data.reason,
          workforcePlanId: null,
          replacingEmployeeId: data.replacingEmployeeId ?? null,
          targetDate: data.targetDate,
          requirementsChecklist: data.requirementsChecklist,
          note: data.note ?? null,
          requesterUserId: actor.userId,
          hiringManagerUserId:
            data.hiringManagerUserId ??
            (await ctx.headOfDepartment(data.departmentId)) ??
            actor.userId,
          recruiterUserId: null,
          status: 'draft',
          approvals: [],
          hiredCount: 0,
          poolSuggestion: null,
          openedAt: null,
          filledAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return service.detail(actor, id);
    },

    async update(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'create');
      const current = await row(id);
      if (!(await visible(actor, current)))
        throw new HrError('REQUISITION_NOT_FOUND', 404);
      if (current.status !== 'draft')
        throw new HrError('REQUISITION_NOT_DRAFT', 409);
      const data = await parse(input);
      await checkScope(actor, data.departmentId);
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({
          departmentId: data.departmentId,
          positionId: data.positionId,
          headcount: data.headcount,
          reason: data.reason,
          replacingEmployeeId: data.replacingEmployeeId ?? null,
          targetDate: data.targetDate,
          requirementsChecklist: data.requirementsChecklist,
          note: data.note ?? null,
          hiringManagerUserId:
            data.hiringManagerUserId ?? current.hiringManagerUserId,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async submit(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'create');
      const current = await row(id);
      if (!(await visible(actor, current)))
        throw new HrError('REQUISITION_NOT_FOUND', 404);
      await checkScope(actor, current.departmentId);
      if (current.status !== 'draft')
        throw new HrError('REQUISITION_NOT_DRAFT', 409);
      const position = await ctx.position(current.positionId);
      const confirm =
        input && typeof input === 'object'
          ? (input as { confirmMissingResponsibilities?: unknown })
              .confirmMissingResponsibilities === true
          : false;
      // 岗位职责说明为空时提示补充: the submission stops once, the requester may still go on.
      if (!position?.responsibilities && !confirm)
        throw new HrError('REQUISITION_RESPONSIBILITIES_MISSING', 409);
      const steps = await buildChain(current, actor.userId);
      const allPassed = !steps.some((s) => s.status === 'pending');
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({
          status: allPassed ? 'open' : 'pending',
          approvals: steps,
          // The requester submitted it, whoever drafted it (a workforce plan's draft).
          requesterUserId: actor.userId,
          updatedAt: new Date(),
          ...(allPassed ? { openedAt: new Date() } : {}),
        })
        .where('id', '=', id)
        .execute();
      const next = await row(id);
      if (allPassed) hooks.onOpened(id);
      else await notifyPending(next, steps);
      return service.detail(actor, id);
    },

    async decide(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'approve');
      const parsed = decisionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const current = await row(id);
      if (current.status !== 'pending')
        throw new HrError('REQUISITION_NOT_PENDING', 409);
      const steps = current.approvals.map((s) => ({ ...s }));
      const pending = steps.find((s) => s.status === 'pending');
      if (!pending) throw new HrError('REQUISITION_NOT_PENDING', 409);
      const hrAdmin = await ctx.isHrAdmin(actor);
      const allowed =
        pending.kind === 'hrAdmin'
          ? hrAdmin
          : pending.approverUserIds.includes(actor.userId);
      if (!allowed) throw new HrError('REQUISITION_NOT_APPROVER', 403);
      const now = new Date();
      pending.decidedBy = actor.userId;
      pending.decidedAt = now.toISOString();
      pending.comment = parsed.data.comment ?? null;
      let recruiterUserId = current.recruiterUserId;
      if (parsed.data.decision === 'reject') {
        if (!parsed.data.comment)
          throw new HrError('REQUISITION_COMMENT_REQUIRED', 400);
        pending.status = 'rejected';
        await database
          .query()
          .updateTable('jobRequisitions')
          .set({ status: 'draft', approvals: steps, updatedAt: now })
          .where('id', '=', id)
          .where('status', '=', 'pending')
          .execute();
        await platform.notify({
          key: `requisition:${id}:rejected:${pending.level}:${now.getTime()}`,
          userIds: [current.requesterUserId],
          message: 'recruitingRequisitionRejected',
          params: {
            position: (await ctx.position(current.positionId))?.title ?? '',
            comment: parsed.data.comment,
          },
          path: `/talent/requisitions/${id}`,
        });
        return service.detail(actor, id);
      }
      if (pending.kind === 'hrAdmin') {
        // 第二级 hr.admin 同时指定招聘负责人.
        recruiterUserId = parsed.data.recruiterUserId ?? recruiterUserId;
        if (!recruiterUserId)
          throw new HrError('REQUISITION_RECRUITER_REQUIRED', 400);
        if (!(await ctx.holdersOf('hr.recruiter')).includes(recruiterUserId))
          throw new HrError('REQUISITION_RECRUITER_INVALID', 400);
      }
      pending.status = 'approved';
      const next = steps.find((s) => s.status === 'waiting');
      if (next) next.status = 'pending';
      const opened = !next;
      const updated = await database
        .query()
        .updateTable('jobRequisitions')
        .set({
          status: opened ? 'open' : 'pending',
          approvals: steps,
          recruiterUserId,
          updatedAt: now,
          ...(opened ? { openedAt: now } : {}),
        })
        .where('id', '=', id)
        .where('status', '=', 'pending')
        .execute();
      if (!(updated.updatedCount ?? 1))
        throw new HrError('REQUISITION_NOT_PENDING', 409);
      const fresh = await row(id);
      if (opened) {
        await platform.notify({
          key: `requisition:${id}:opened`,
          userIds: [fresh.requesterUserId, fresh.hiringManagerUserId],
          message: 'recruitingRequisitionOpened',
          params: {
            position: (await ctx.position(fresh.positionId))?.title ?? '',
            recruiter: (await platform.userName(recruiterUserId)) ?? '',
          },
          path: `/talent/requisitions/${id}`,
        });
        hooks.onOpened(id);
      } else await notifyPending(fresh, steps);
      return service.detail(actor, id);
    },

    async assignRecruiter(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(
        actor.authz,
        COMPOSITE.requisition,
        'assignRecruiter',
      );
      const userId =
        input && typeof input === 'object'
          ? (input as { recruiterUserId?: unknown }).recruiterUserId
          : undefined;
      if (typeof userId !== 'string' || !userId)
        throw new HrError('REQUISITION_RECRUITER_REQUIRED', 400);
      if (!(await ctx.holdersOf('hr.recruiter')).includes(userId))
        throw new HrError('REQUISITION_RECRUITER_INVALID', 400);
      const current = await row(id);
      if (!['approved', 'open'].includes(current.status))
        throw new HrError('REQUISITION_NOT_OPEN', 409);
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({ recruiterUserId: userId, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    async cancel(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, COMPOSITE.requisition, 'create');
      const current = await row(id);
      if (!(await visible(actor, current)))
        throw new HrError('REQUISITION_NOT_FOUND', 404);
      await checkScope(actor, current.departmentId);
      if (['filled', 'cancelled'].includes(current.status))
        throw new HrError('REQUISITION_CLOSED', 409);
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /**
     * A workforce plan's hiring decision: the department's draft for the
     * position without a plan is linked (and its headcount set), otherwise a
     * new draft copies the position's last checklist. Trusted: the plan's
     * decision was authorized.
     */
    async draftFromPlan(input: {
      plan: {
        id: string;
        departmentId: string;
        positionId: string;
        month: string;
        calculation: { gapHeadcount: number } | null;
      };
      actor: ActorContext;
      targetDate: string;
    }): Promise<string> {
      const { plan, actor } = input;
      const headcount = Math.max(1, plan.calculation?.gapHeadcount ?? 1);
      const now = new Date();
      const linked = await database
        .query()
        .selectFrom('jobRequisitions')
        .select(['id'])
        .where('workforcePlanId', '=', plan.id)
        .executeTakeFirst();
      if (linked) return str(linked.id);
      const existing = await database
        .query()
        .selectFrom('jobRequisitions')
        .select(['id'])
        .where('departmentId', '=', plan.departmentId)
        .where('positionId', '=', plan.positionId)
        .where('status', '=', 'draft')
        .where('workforcePlanId', 'is', null)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      let id: string;
      if (existing) {
        id = str(existing.id);
        await database
          .query()
          .updateTable('jobRequisitions')
          .set({ workforcePlanId: plan.id, headcount, updatedAt: now })
          .where('id', '=', id)
          .execute();
      } else {
        id = newId();
        const last = await database
          .query()
          .selectFrom('jobRequisitions')
          .select(['requirementsChecklist'])
          .where('positionId', '=', plan.positionId)
          .orderBy('createdAt', 'desc')
          .execute();
        await database
          .query()
          .insertInto('jobRequisitions')
          .values({
            id,
            departmentId: plan.departmentId,
            positionId: plan.positionId,
            headcount,
            reason: 'newHeadcount',
            workforcePlanId: plan.id,
            replacingEmployeeId: null,
            targetDate: input.targetDate,
            requirementsChecklist:
              last
                .map((l) => json<ChecklistItem[]>(l.requirementsChecklist, []))
                .find((c) => c.length) ?? [],
            note: null,
            requesterUserId: actor.userId,
            hiringManagerUserId:
              (await ctx.headOfDepartment(plan.departmentId)) ?? actor.userId,
            recruiterUserId: null,
            status: 'draft',
            approvals: [],
            hiredCount: 0,
            poolSuggestion: null,
            openedAt: null,
            filledAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .execute();
      }
      await platform.notify({
        key: `workforceRequisition:${plan.id}`,
        userIds: [actor.userId],
        message: 'recruitingRequisitionDrafted',
        params: {
          position: (await ctx.position(plan.positionId))?.title ?? '',
          count: String(headcount),
          month: plan.month,
        },
        path: `/talent/requisitions/${id}`,
      });
      return id;
    },

    /** An onboarding from this requisition took effect (once per job event). */
    async countHire(requisitionId: string) {
      const current = await row(requisitionId);
      const hiredCount = current.hiredCount + 1;
      const filled = hiredCount >= current.headcount;
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({
          hiredCount,
          ...(filled && current.status === 'open'
            ? { status: 'filled', filledAt: new Date() }
            : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', requisitionId)
        .execute();
    },
  };
  return service;
}

export type RequisitionService = ReturnType<typeof createRequisitionService>;
