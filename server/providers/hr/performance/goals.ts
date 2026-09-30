/**
 * V4-12 目标. An employee drafts, submits and updates the progress of their
 * own goals; their manager reviewer (or a head of their department) approves
 * or returns them; department goals are set by HR or the department's head
 * and are what personal goals align to.
 *
 * - Submitting needs every live personal goal to carry a weight, summing to
 *   100 (目标权重合计须为 100).
 * - AI drafts (source = ai, status = draft) count as goals of the employee
 *   only once the employee submits them and the manager approves; the
 *   assistant drafts at most four, and never for someone who already has a
 *   goal in the cycle.
 */
import { z } from 'zod';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId } from '../shared.js';
import { toGoal, type GoalRow, type PerformanceContext } from './context.js';

const GOAL = 'talent.goal';
const OPEN_FOR_GOALS = [
  'goalSetting',
  'selfReview',
  'peerReview',
  'managerReview',
];

const goalInput = z
  .object({
    cycleId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(300),
    measure: z.string().trim().min(1).max(2000),
    weight: z.number().int().min(0).max(100).nullish(),
    alignedGoalId: z.string().min(1).max(64).nullish(),
  })
  .strict();
const goalPatch = goalInput.omit({ cycleId: true }).partial().strict();
const departmentGoalInput = z
  .object({
    cycleId: z.string().min(1).max(64),
    departmentId: z.string().min(1).max(64),
    title: z.string().trim().min(1).max(300),
    measure: z.string().trim().min(1).max(2000),
    alignedGoalId: z.string().min(1).max(64).nullish(),
  })
  .strict();
const progressInput = z
  .object({
    progress: z.number().int().min(0).max(100),
    note: z.string().trim().max(1000).default(''),
  })
  .strict();
const decisionInput = z
  .object({
    decision: z.enum(['approve', 'return']),
    note: z.string().trim().max(1000).nullish(),
  })
  .strict();
export const draftGoalsSchema = z
  .array(
    z
      .object({
        title: z.string().trim().min(1).max(300),
        measure: z.string().trim().min(1).max(2000),
        weight: z.number().int().min(0).max(100).nullish(),
        alignedGoalId: z.string().min(1).max(64).nullish(),
      })
      .strict(),
  )
  .min(1)
  .max(4);

export function createGoalService(ctx: PerformanceContext) {
  const { database, platform } = ctx;

  async function ownEmployee(actor: ActorContext) {
    const employee = await platform.employeeOfUser(actor.userId);
    if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    return employee;
  }

  async function goalRow(id: string): Promise<GoalRow> {
    const row = await database
      .query()
      .selectFrom('goals')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('GOAL_NOT_FOUND', 404);
    return toGoal(row);
  }

  /** The department goals an employee's goals may align to: their department and its ancestors. */
  async function departmentGoalsFor(cycleId: string, departmentId: string) {
    const chain = (await platform.organization.activeChain(departmentId)) ?? [
      departmentId,
    ];
    return (await ctx.goalsOf(cycleId)).filter(
      (g) =>
        !g.employeeId &&
        g.departmentId &&
        chain.includes(g.departmentId) &&
        g.status !== 'cancelled',
    );
  }

  async function assertOpen(cycleId: string) {
    const cycle = await ctx.cycle(cycleId);
    if (!OPEN_FOR_GOALS.includes(cycle.status))
      throw new HrError('REVIEW_CYCLE_STAGE_CLOSED', 409);
    return cycle;
  }

  async function assertAligned(
    cycleId: string,
    departmentId: string,
    alignedGoalId: string | null | undefined,
  ) {
    if (!alignedGoalId) return;
    const options = await departmentGoalsFor(cycleId, departmentId);
    if (!options.some((g) => g.id === alignedGoalId))
      throw new HrError('GOAL_ALIGNMENT_INVALID', 400);
  }

  async function participant(cycleId: string, employeeId: string) {
    const result = await database
      .query()
      .selectFrom('reviewResults')
      .select(['id', 'managerUserId', 'status'])
      .where('cycleId', '=', cycleId)
      .where('employeeId', '=', employeeId)
      .executeTakeFirst();
    if (!result || result.status === 'closed')
      throw new HrError('REVIEW_NOT_PARTICIPANT', 404);
    return result;
  }

  const service = {
    departmentGoalsFor,

    /** The goals of the signed-in employee in a cycle, with the department goals they may align to. */
    async mine(actor: ActorContext, cycleId: string) {
      await authorizeAction(actor.authz, GOAL, 'view');
      const employee = await ownEmployee(actor);
      const goals = (await ctx.goalsOf(cycleId)).filter(
        (g) => g.employeeId === employee.id && g.status !== 'cancelled',
      );
      return {
        goals,
        departmentGoals: await departmentGoalsFor(
          cycleId,
          employee.departmentId,
        ),
        totalWeight: goals.reduce((sum, g) => sum + (g.weight ?? 0), 0),
      };
    },

    async create(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, GOAL, 'manage');
      const parsed = goalInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const data = parsed.data;
      const employee = await ownEmployee(actor);
      await assertOpen(data.cycleId);
      await participant(data.cycleId, employee.id);
      await assertAligned(
        data.cycleId,
        employee.departmentId,
        data.alignedGoalId,
      );
      const now = new Date();
      const id = newId();
      await database
        .query()
        .insertInto('goals')
        .values({
          id,
          cycleId: data.cycleId,
          employeeId: employee.id,
          departmentId: null,
          title: data.title,
          measure: data.measure,
          weight: data.weight ?? null,
          alignedGoalId: data.alignedGoalId ?? null,
          progress: 0,
          progressNotes: [],
          status: 'draft',
          source: 'manual',
          editedByEmployee: false,
          createdBy: actor.userId,
          submittedAt: null,
          approvedBy: null,
          approvedAt: null,
          returnNote: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return goalRow(id);
    },

    /** Edits one's own draft (or returned) goal; editing an AI draft marks it as the employee's. */
    async update(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, GOAL, 'manage');
      const parsed = goalPatch.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const goal = await goalRow(id);
      const employee = await ownEmployee(actor);
      if (goal.employeeId !== employee.id)
        throw new HrError('GOAL_NOT_FOUND', 404);
      if (goal.status !== 'draft') throw new HrError('GOAL_NOT_EDITABLE', 409);
      await assertOpen(goal.cycleId);
      await assertAligned(
        goal.cycleId,
        employee.departmentId,
        parsed.data.alignedGoalId,
      );
      const values: Record<string, unknown> = { updatedAt: new Date() };
      for (const key of [
        'title',
        'measure',
        'weight',
        'alignedGoalId',
      ] as const)
        if (parsed.data[key] !== undefined)
          values[key] = parsed.data[key] ?? null;
      if (goal.source === 'ai') values.editedByEmployee = true;
      await database
        .query()
        .updateTable('goals')
        .set(values)
        .where('id', '=', id)
        .execute();
      return goalRow(id);
    },

    async cancel(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, GOAL, 'manage');
      const goal = await goalRow(id);
      const employee = await ownEmployee(actor);
      if (goal.employeeId !== employee.id)
        throw new HrError('GOAL_NOT_FOUND', 404);
      if (goal.status === 'approved')
        throw new HrError('GOAL_NOT_EDITABLE', 409);
      await database
        .query()
        .updateTable('goals')
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return goalRow(id);
    },

    /** 提交: every live goal needs a weight and the weights sum to 100. */
    async submit(actor: ActorContext, cycleId: string) {
      await authorizeAction(actor.authz, GOAL, 'manage');
      const employee = await ownEmployee(actor);
      const cycle = await assertOpen(cycleId);
      const result = await participant(cycleId, employee.id);
      const goals = (await ctx.goalsOf(cycleId)).filter(
        (g) => g.employeeId === employee.id && g.status !== 'cancelled',
      );
      const drafts = goals.filter((g) => g.status === 'draft');
      if (!drafts.length) throw new HrError('GOAL_NOTHING_TO_SUBMIT', 409);
      const total = goals.reduce((sum, g) => sum + (g.weight ?? 0), 0);
      if (goals.some((g) => g.weight === null) || total !== 100)
        throw new HrError('GOAL_WEIGHTS_NOT_100', 400, { total });
      const now = new Date();
      await database
        .query()
        .updateTable('goals')
        .set({ status: 'submitted', submittedAt: now, updatedAt: now })
        .where('cycleId', '=', cycleId)
        .where('employeeId', '=', employee.id)
        .where('status', '=', 'draft')
        .execute();
      await platform.notify({
        key: `perf:${cycleId}:goalsSubmitted:${employee.id}:${now.getTime()}`,
        userIds: [String(result.managerUserId)],
        message: 'performanceGoalsSubmitted',
        params: { cycle: cycle.title, name: employee.name },
        path: `/talent/team-reviews?cycle=${encodeURIComponent(cycleId)}`,
      });
      await ctx.closeWorkItems(`perf:goalDraft:${cycleId}:${employee.id}`);
      return service.mine(actor, cycleId);
    },

    /** 主管确认: the manager reviewer (or a head within scope) approves or returns a submitted goal. */
    async decide(actor: ActorContext, id: string, input: unknown) {
      const policies = await authorizeAction(actor.authz, GOAL, 'approve');
      const parsed = decisionInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const goal = await goalRow(id);
      const visible = await database
        .repository('goals')
        .withPolicy(policyOf(policies, 'goals'))
        .findOne({ filter: { id } });
      if (!visible || !goal.employeeId)
        throw new HrError('GOAL_NOT_FOUND', 404);
      const employee = await platform.employee(goal.employeeId);
      if (employee?.userId === actor.userId)
        throw new HrError('GOAL_SELF_APPROVAL', 403);
      if (goal.status !== 'submitted')
        throw new HrError('GOAL_NOT_SUBMITTED', 409);
      const now = new Date();
      const approve = parsed.data.decision === 'approve';
      await database
        .query()
        .updateTable('goals')
        .set(
          approve
            ? {
                status: 'approved',
                approvedBy: actor.userId,
                approvedAt: now,
                returnNote: null,
                updatedAt: now,
              }
            : {
                status: 'draft',
                returnNote: parsed.data.note ?? null,
                updatedAt: now,
              },
        )
        .where('id', '=', id)
        .execute();
      const cycle = await ctx.cycle(goal.cycleId);
      if (employee?.userId)
        await platform.notify({
          key: `perf:goal:${id}:${approve ? 'approved' : 'returned'}:${now.getTime()}`,
          userIds: [employee.userId],
          message: approve
            ? 'performanceGoalApproved'
            : 'performanceGoalReturned',
          params: { cycle: cycle.title, goal: goal.title },
          path: '/talent/my-review',
        });
      return goalRow(id);
    },

    /** 更新进度: the owner of an approved goal; every update is kept. */
    async progress(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, GOAL, 'manage');
      const parsed = progressInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const goal = await goalRow(id);
      const employee = await ownEmployee(actor);
      if (goal.employeeId !== employee.id)
        throw new HrError('GOAL_NOT_FOUND', 404);
      if (goal.status !== 'approved')
        throw new HrError('GOAL_NOT_APPROVED', 409);
      const cycle = await ctx.cycle(goal.cycleId);
      if (['published', 'closed'].includes(cycle.status))
        throw new HrError('REVIEW_CYCLE_STAGE_CLOSED', 409);
      await database
        .query()
        .updateTable('goals')
        .set({
          progress: parsed.data.progress,
          progressNotes: [
            ...goal.progressNotes,
            {
              at: new Date().toISOString(),
              progress: parsed.data.progress,
              note: parsed.data.note,
              by: actor.userId,
            },
          ],
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return goalRow(id);
    },

    /** The goals of the people the caller manages or reviews in a cycle. */
    async team(actor: ActorContext, cycleId: string) {
      const policies = await authorizeAction(actor.authz, GOAL, 'view');
      const rows = (
        (await database
          .repository('goals')
          .withPolicy(policyOf(policies, 'goals'))
          .findMany({ filter: { cycleId } })) as Record<string, unknown>[]
      ).map(toGoal);
      return rows.filter((g) => g.status !== 'cancelled');
    },

    /** Department goals: HR, or the head of the department (within the caller's goal scope). */
    async createDepartmentGoal(actor: ActorContext, input: unknown) {
      const policies = await authorizeAction(actor.authz, GOAL, 'manage');
      const parsed = departmentGoalInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const data = parsed.data;
      await ctx.cycle(data.cycleId);
      const admin = await tryAuthorizeAction(
        actor.authz,
        'talent.reviewCycle',
        'manage',
      );
      if (!admin) {
        const managed = await platform.organization.managedDepartments(
          actor.userId,
        );
        if (!managed.includes(data.departmentId))
          throw new HrError('FORBIDDEN', 403);
      }
      const now = new Date();
      const id = newId();
      await database
        .repository('goals')
        .withPolicy(policyOf(policies, 'goals'))
        .createOne({
          values: {
            id,
            cycleId: data.cycleId,
            employeeId: null,
            departmentId: data.departmentId,
            title: data.title,
            measure: data.measure,
            weight: null,
            alignedGoalId: data.alignedGoalId ?? null,
            progress: 0,
            progressNotes: [],
            status: 'approved',
            source: 'manual',
            editedByEmployee: false,
            createdBy: actor.userId,
            submittedAt: now,
            approvedBy: actor.userId,
            approvedAt: now,
            returnNote: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      return goalRow(id);
    },

    /**
     * suggestGoalDrafts / 目标草稿: up to four `source = ai` drafts for an
     * employee without any goal in the cycle. The caller has authorized the
     * assistant's use; the employee must be visible to them.
     */
    async createAiDrafts(
      cycleId: string,
      employeeId: string,
      drafts: z.infer<typeof draftGoalsSchema>,
    ): Promise<GoalRow[]> {
      const parsed = draftGoalsSchema.safeParse(drafts);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await participant(cycleId, employeeId);
      const existing = (await ctx.goalsOf(cycleId)).filter(
        (g) => g.employeeId === employeeId && g.status !== 'cancelled',
      );
      if (existing.length) throw new HrError('GOAL_DRAFTS_EXIST', 409);
      const employee = await platform.employee(employeeId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const options = new Set(
        (await departmentGoalsFor(cycleId, employee.departmentId)).map(
          (g) => g.id,
        ),
      );
      const now = new Date();
      const ids: string[] = [];
      await database.transaction(async (connection) => {
        for (const draft of parsed.data) {
          const id = newId();
          ids.push(id);
          await connection.query
            .insertInto('goals')
            .values({
              id,
              cycleId,
              employeeId,
              departmentId: null,
              title: draft.title,
              measure: draft.measure,
              weight: draft.weight ?? null,
              alignedGoalId:
                draft.alignedGoalId && options.has(draft.alignedGoalId)
                  ? draft.alignedGoalId
                  : null,
              progress: 0,
              progressNotes: [],
              status: 'draft',
              source: 'ai',
              editedByEmployee: false,
              createdBy: 'performanceAssistant',
              submittedAt: null,
              approvedBy: null,
              approvedAt: null,
              returnNote: null,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        }
      });
      const all = await ctx.goalsOf(cycleId);
      return all.filter((g) => ids.includes(g.id));
    },
  };
  return service;
}

export type GoalService = ReturnType<typeof createGoalService>;
