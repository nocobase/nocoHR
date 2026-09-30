/**
 * V4-12 考核周期: creation with the participant preview, the stage flow and
 * what each stage start does, the progress board, reminders and the
 * statistics tab.
 *
 * - 参与名单: employees of the scope's departments (sub-departments included)
 *   who are on the books, except: fewer than `minTenureDays` since joining
 *   (default 90), on probation (`excludeProbation`, default on), no manager
 *   reviewer (the head of their department, walking up past departments
 *   without one and past themselves; HR may name one in `managerOverrides`),
 *   no matching scheme, dispatched workers. Each exclusion lists its reasons.
 *   The scheme is matched by position (then job family and grade); HR may
 *   change it in `schemeOverrides`.
 * - Stages run in order draft → goalSetting → selfReview → peerReview →
 *   managerReview → calibration; a stage no participant's scheme enables is
 *   skipped. Publishing is its own action (results.ts). HR advances by hand;
 *   with `autoAdvance`, the 09:00 task advances a stage whose deadline has
 *   passed.
 * - Stage starts: goalSetting creates the results and tells participants;
 *   selfReview builds the evidence snapshots, creates self tasks for people
 *   with an account ("无账号，跳过自评" otherwise) and starts the evidence
 *   summaries; peerReview creates tasks for the confirmed peers; managerReview
 *   refreshes the snapshots, creates manager and skip-level tasks (a missing
 *   skip-level reviewer skips that step, recorded on the result) and starts
 *   the comment drafts; calibration starts the calibration pack.
 */
import { z } from 'zod';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { daysBetween, HrError, isDateOnly, newId, str } from '../shared.js';
import {
  DEADLINE_STAGES,
  type CycleStatus,
  type SchemeView,
} from './common.js';
import {
  toCycle,
  toResult,
  toReview,
  type CycleView,
  type EmployeeRow,
  type PerformanceContext,
  type ResultRow,
} from './context.js';
import { buildSnapshot } from './evidence.js';
import type { SchemeService } from './schemes.js';

const CYCLE = 'talent.reviewCycle';
const STAGE_ORDER = [
  'draft',
  'goalSetting',
  'selfReview',
  'peerReview',
  'managerReview',
  'calibration',
] as const;

const dateSchema = z.string().refine(isDateOnly);
const scopeInput = z
  .object({
    departmentIds: z.array(z.string().min(1).max(64)).min(1).max(50),
    minTenureDays: z.number().int().min(0).max(3650).optional(),
    excludeProbation: z.boolean().optional(),
    schemeOverrides: z.record(z.string(), z.string().min(1).max(64)).optional(),
    managerOverrides: z
      .record(z.string(), z.string().min(1).max(64))
      .optional(),
    peerPresets: z
      .record(z.string(), z.array(z.string().min(1).max(64)).max(5))
      .optional(),
  })
  .strict();
const cycleInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    periodStart: dateSchema,
    periodEnd: dateSchema,
    scope: scopeInput,
    stageDeadlines: z
      .partialRecord(z.enum(DEADLINE_STAGES), dateSchema)
      .default({}),
    autoAdvance: z.boolean().default(false),
    ownerUserId: z.string().min(1).max(64).optional(),
  })
  .strict();
const cycleUpdate = cycleInput.partial().strict();

export interface Participant {
  employee: EmployeeRow;
  scheme: SchemeView | null;
  managerUserId: string | null;
  reasons: string[];
}

export function createCycleService(
  ctx: PerformanceContext,
  schemes: SchemeService,
  hooks: {
    onSelfReview: (cycleId: string) => void;
    onManagerReview: (cycleId: string) => void;
    onCalibration: (cycleId: string) => void;
  },
) {
  const { database, platform } = ctx;

  async function positions() {
    const rows = await database
      .query()
      .selectFrom('positions')
      .select(['id', 'title', 'jobFamilyId', 'grade'])
      .execute();
    return new Map(
      rows.map((row) => [
        str(row.id),
        {
          id: str(row.id),
          title: str(row.title),
          jobFamilyId: row.jobFamilyId ? str(row.jobFamilyId) : null,
          grade: row.grade ? str(row.grade) : null,
        },
      ]),
    );
  }

  /** The participant list and the exclusions of a scope, as of today. */
  async function participants(
    scope: CycleView['scope'],
  ): Promise<Participant[]> {
    const today = ctx.today();
    const departments = new Set<string>();
    for (const id of scope.departmentIds)
      for (const d of await platform.organization.descendantsOf(id))
        departments.add(d);
    const allSchemes = await ctx.schemes();
    const byId = new Map(allSchemes.map((s) => [s.id, s]));
    const positionMap = await positions();
    const types = new Map(
      (
        await database
          .query()
          .selectFrom('employees')
          .select(['id', 'employmentType'])
          .execute()
      ).map((r) => [str(r.id), str(r.employmentType ?? 'fullTime')]),
    );
    const list: Participant[] = [];
    for (const employee of (await ctx.employees()).values()) {
      if (!departments.has(employee.departmentId)) continue;
      if (employee.status === 'leave') continue;
      const reasons: string[] = [];
      if (types.get(employee.id) === 'dispatched') reasons.push('dispatched');
      if (
        employee.hireDate &&
        daysBetween(employee.hireDate, today) < scope.minTenureDays
      )
        reasons.push('tenure');
      if (scope.excludeProbation && employee.status === 'probation')
        reasons.push('probation');
      const managerUserId =
        scope.managerOverrides[employee.id] ??
        (await platform.headOf(employee)) ??
        null;
      if (!managerUserId) reasons.push('noManager');
      const override = scope.schemeOverrides[employee.id];
      const scheme = override
        ? (byId.get(override) ?? null)
        : schemes.matchScheme(
            allSchemes,
            employee.positionId
              ? (positionMap.get(employee.positionId) ?? null)
              : null,
          );
      if (!scheme) reasons.push('noScheme');
      list.push({ employee, scheme, managerUserId, reasons });
    }
    return list.sort((a, b) =>
      a.employee.employeeNo.localeCompare(b.employee.employeeNo),
    );
  }

  async function presentParticipants(list: readonly Participant[]) {
    const titles = await ctx.departmentTitles();
    const positionMap = await positions();
    const rows = [];
    for (const p of list)
      rows.push({
        employeeId: p.employee.id,
        employeeNo: p.employee.employeeNo,
        name: p.employee.name,
        departmentTitle: titles.get(p.employee.departmentId) ?? '',
        positionTitle: p.employee.positionId
          ? (positionMap.get(p.employee.positionId)?.title ?? '')
          : '',
        schemeId: p.scheme?.id ?? null,
        schemeTitle: p.scheme?.title ?? null,
        managerUserId: p.managerUserId,
        managerName: await ctx.userName(p.managerUserId),
        noAccount: !p.employee.userId,
        reasons: p.reasons,
      });
    return {
      participants: rows.filter((r) => !r.reasons.length),
      excluded: rows.filter((r) => r.reasons.length),
    };
  }

  function scopeOf(
    input: z.infer<typeof scopeInput>,
    defaults: { minTenureDays: number; excludeProbation: boolean },
  ): CycleView['scope'] {
    return {
      departmentIds: input.departmentIds,
      minTenureDays: input.minTenureDays ?? defaults.minTenureDays,
      excludeProbation: input.excludeProbation ?? defaults.excludeProbation,
      schemeOverrides: input.schemeOverrides ?? {},
      managerOverrides: input.managerOverrides ?? {},
      peerPresets: input.peerPresets ?? {},
    };
  }

  /** Stages in use: a stage no participant's scheme enables is skipped. */
  async function stagesInUse(cycle: CycleView): Promise<Set<string>> {
    const results = await ctx.resultsOf(cycle.id);
    const list = results.length
      ? (await ctx.schemes()).filter((s) =>
          results.some((r) => r.schemeId === s.id),
        )
      : (await participants(cycle.scope))
          .filter((p) => !p.reasons.length)
          .map((p) => p.scheme!)
          .filter(Boolean);
    const used = new Set<string>(['managerReview']);
    for (const scheme of list) {
      if (scheme.stages.goalSetting) used.add('goalSetting');
      if (scheme.stages.selfReview) used.add('selfReview');
      if (scheme.stages.peerReview.enabled) used.add('peerReview');
      if (scheme.stages.calibration) used.add('calibration');
    }
    return used;
  }

  async function nextStage(cycle: CycleView): Promise<CycleStatus | null> {
    const index = STAGE_ORDER.indexOf(cycle.status as never);
    if (index < 0) return null;
    const used = await stagesInUse(cycle);
    for (const stage of STAGE_ORDER.slice(index + 1))
      if (used.has(stage)) return stage;
    return null;
  }

  /** Tasks of a stage not yet done: open reviews of the role, or employees without submitted goals. */
  async function incomplete(
    cycle: CycleView,
  ): Promise<
    { userId: string | null; employeeId: string; kind: string; id: string }[]
  > {
    const results = (await ctx.resultsOf(cycle.id)).filter(
      (r) => r.status !== 'closed',
    );
    if (cycle.status === 'goalSetting') {
      const goals = await ctx.goalsOf(cycle.id);
      const employees = await ctx.employees();
      return results
        .filter(
          (r) =>
            !goals.some(
              (g) =>
                g.employeeId === r.employeeId &&
                (g.status === 'submitted' || g.status === 'approved'),
            ),
        )
        .map((r) => ({
          userId: employees.get(r.employeeId)?.userId ?? null,
          employeeId: r.employeeId,
          kind: 'goal',
          id: r.id,
        }));
    }
    const role =
      cycle.status === 'selfReview'
        ? ['self']
        : cycle.status === 'peerReview'
          ? ['peer']
          : cycle.status === 'managerReview'
            ? ['manager', 'skipLevel']
            : [];
    return (await ctx.reviewsOf(cycle.id))
      .filter(
        (r) =>
          role.includes(r.role) &&
          r.status !== 'submitted' &&
          r.status !== 'cancelled',
      )
      .map((r) => ({
        userId: r.reviewerUserId,
        employeeId: r.employeeId,
        kind: r.role,
        id: r.id,
      }));
  }

  async function createReview(
    connection: { query: ReturnType<typeof database.query> },
    result: ResultRow,
    role: 'self' | 'peer' | 'manager' | 'skipLevel',
    reviewerUserId: string,
  ): Promise<boolean> {
    const exists = await connection.query
      .selectFrom('reviews')
      .select(['id'])
      .where('resultId', '=', result.id)
      .where('role', '=', role)
      .where('reviewerUserId', '=', reviewerUserId)
      .executeTakeFirst();
    if (exists) return false;
    const now = new Date();
    await connection.query
      .insertInto('reviews')
      .values({
        id: newId(),
        cycleId: result.cycleId,
        resultId: result.id,
        employeeId: result.employeeId,
        reviewerUserId,
        role,
        items: null,
        overallRating: null,
        overallReason: null,
        comment: null,
        status: 'notStarted',
        aiDraft: null,
        aiDraftAdoption: null,
        activeSeconds: 0,
        submissionCount: 0,
        submittedAt: null,
        hints: null,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    return true;
  }

  /** Builds (or refreshes) the evidence snapshot of every open result; outside any transaction. */
  async function snapshotAll(cycle: CycleView): Promise<number> {
    const results = (await ctx.resultsOf(cycle.id)).filter(
      (r) => r.status !== 'closed',
    );
    const schemesById = new Map((await ctx.schemes()).map((s) => [s.id, s]));
    const employees = await ctx.employees();
    const today = ctx.today();
    let count = 0;
    for (const result of results) {
      const scheme = schemesById.get(result.schemeId);
      if (!scheme) continue;
      const snapshot = await buildSnapshot(database, {
        employeeId: result.employeeId,
        positionId:
          employees.get(result.employeeId)?.positionId ?? result.positionId,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        today,
        rules: scheme.qualitySafetyRules,
      });
      await database
        .query()
        .updateTable('reviewResults')
        .set({ evidenceSnapshot: snapshot, updatedAt: new Date() })
        .where('id', '=', result.id)
        .execute();
      count += 1;
    }
    return count;
  }

  async function notifyMany(
    items: { userId: string; key: string; params: Record<string, string> }[],
    message: string,
    path: string,
  ) {
    for (const item of items)
      await platform.notify({
        key: item.key,
        userIds: [item.userId],
        message,
        params: item.params,
        path,
      });
  }

  /** What starting a stage does (see the module comment). Writes first, then notifications. */
  async function enterStage(
    cycle: CycleView,
    stage: CycleStatus,
    by: string,
    auto: boolean,
  ): Promise<Record<string, number>> {
    const report: Record<string, number> = {};
    const employees = await ctx.employees();
    const schemesById = new Map((await ctx.schemes()).map((s) => [s.id, s]));
    const now = new Date();

    // Results exist from the first stage on.
    let results = await ctx.resultsOf(cycle.id);
    if (!results.length) {
      const list = await participants(cycle.scope);
      const included = list.filter((p) => !p.reasons.length);
      const rows: Record<string, unknown>[] = [];
      for (const p of included) {
        const managerEmployee = await platform.employeeOfUser(p.managerUserId!);
        let skipLevelUserId: string | null = null;
        if (p.scheme!.stages.skipLevelReview && managerEmployee) {
          skipLevelUserId = (await platform.headOf(managerEmployee)) ?? null;
          if (
            skipLevelUserId === p.managerUserId ||
            skipLevelUserId === p.employee.userId
          )
            skipLevelUserId = null;
        }
        rows.push({
          id: newId(),
          cycleId: cycle.id,
          employeeId: p.employee.id,
          schemeId: p.scheme!.id,
          departmentId: p.employee.departmentId,
          positionId: p.employee.positionId,
          managerUserId: p.managerUserId!,
          skipLevelUserId,
          skipLevelSkipped:
            p.scheme!.stages.skipLevelReview && !skipLevelUserId,
          noAccount: !p.employee.userId,
          peerUserIds: p.scheme!.stages.peerReview.enabled
            ? (cycle.scope.peerPresets[p.employee.id] ?? [])
            : [],
          peerStatus:
            p.scheme!.stages.peerReview.enabled &&
            cycle.scope.peerPresets[p.employee.id]?.length
              ? 'nominated'
              : 'none',
          evidenceSnapshot: null,
          evidenceSummary: null,
          computedScore: null,
          managerRating: null,
          calibratedRating: null,
          finalRating: null,
          adjustments: [],
          status: 'inProgress',
          closedReason: null,
          appeal: null,
          publishedAt: null,
          acknowledgedAt: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      const exclusions = list
        .filter((p) => p.reasons.length)
        .map((p) => ({
          employeeId: p.employee.id,
          name: p.employee.name,
          reasons: p.reasons,
        }));
      await database.transaction(async (connection) => {
        for (const row of rows)
          await connection.query
            .insertInto('reviewResults')
            .values(row)
            .execute();
        await connection.query
          .updateTable('reviewCycles')
          .set({ exclusions, updatedAt: now })
          .where('id', '=', cycle.id)
          .execute();
      });
      report.results = rows.length;
      results = await ctx.resultsOf(cycle.id);
    }
    const open = results.filter((r) => r.status !== 'closed');
    const deadline = cycle.stageDeadlines[stage] ?? '';

    if (stage === 'goalSetting') {
      await notifyMany(
        open
          .map((r) => employees.get(r.employeeId))
          .filter((e): e is EmployeeRow => Boolean(e?.userId))
          .map((e) => ({
            userId: e.userId!,
            key: `perf:${cycle.id}:goalSetting:${e.id}`,
            params: { cycle: cycle.title, deadline },
          })),
        'performanceGoalSetting',
        '/talent/my-review',
      );
    }

    if (stage === 'selfReview') {
      report.snapshots = await snapshotAll(cycle);
      let created = 0;
      const reviewers: { userId: string; employeeId: string }[] = [];
      await database.transaction(async (connection) => {
        for (const result of open) {
          const scheme = schemesById.get(result.schemeId);
          const employee = employees.get(result.employeeId);
          if (!scheme?.stages.selfReview || !employee?.userId) continue;
          if (await createReview(connection, result, 'self', employee.userId)) {
            created += 1;
            reviewers.push({
              userId: employee.userId,
              employeeId: employee.id,
            });
          }
        }
      });
      report.selfReviews = created;
      await notifyMany(
        reviewers.map((r) => ({
          userId: r.userId,
          key: `perf:${cycle.id}:selfReview:${r.employeeId}`,
          params: { cycle: cycle.title, deadline },
        })),
        'performanceSelfReview',
        '/talent/my-review?tab=self',
      );
      hooks.onSelfReview(cycle.id);
    }

    if (stage === 'peerReview') {
      let created = 0;
      const tasks: { userId: string; resultId: string }[] = [];
      await database.transaction(async (connection) => {
        for (const result of open) {
          const scheme = schemesById.get(result.schemeId);
          if (!scheme?.stages.peerReview.enabled) continue;
          if (result.peerStatus !== 'confirmed') continue;
          for (const userId of result.peerUserIds)
            if (await createReview(connection, result, 'peer', userId)) {
              created += 1;
              tasks.push({ userId, resultId: result.id });
            }
        }
      });
      report.peerReviews = created;
      // A peer is told of the task, not whose review it is in the notice title.
      await notifyMany(
        tasks.map((t) => ({
          userId: t.userId,
          key: `perf:${cycle.id}:peerReview:${t.resultId}:${t.userId}`,
          params: { cycle: cycle.title, deadline },
        })),
        'performancePeerReview',
        '/talent/my-review?tab=peer',
      );
    }

    if (stage === 'managerReview') {
      report.snapshots = await snapshotAll(cycle);
      let created = 0;
      await database.transaction(async (connection) => {
        for (const result of open) {
          if (
            await createReview(
              connection,
              result,
              'manager',
              result.managerUserId,
            )
          )
            created += 1;
          const scheme = schemesById.get(result.schemeId);
          if (scheme?.stages.skipLevelReview && result.skipLevelUserId)
            if (
              await createReview(
                connection,
                result,
                'skipLevel',
                result.skipLevelUserId,
              )
            )
              created += 1;
        }
      });
      report.managerReviews = created;
      hooks.onManagerReview(cycle.id);
    }

    if (stage === 'calibration') {
      await platform.notify({
        key: `perf:${cycle.id}:calibration`,
        userIds: [cycle.ownerUserId],
        message: 'performanceCalibrationStarted',
        params: { cycle: cycle.title },
        path: `/talent/calibration?cycle=${encodeURIComponent(cycle.id)}`,
      });
      hooks.onCalibration(cycle.id);
    }

    await database
      .query()
      .updateTable('reviewCycles')
      .set({
        status: stage,
        stageLog: [
          ...cycle.stageLog,
          { from: cycle.status, to: stage, at: now.toISOString(), by, auto },
        ],
        updatedAt: new Date(),
      })
      .where('id', '=', cycle.id)
      .where('status', '=', cycle.status)
      .execute();
    return report;
  }

  const service = {
    participants,
    snapshotAll,
    incomplete,
    nextStage,
    enterStage,

    async settings(actor: ActorContext) {
      await authorizeAction(actor.authz, CYCLE, 'view');
      return ctx.settings();
    },

    async preview(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, CYCLE, 'manage');
      const parsed = scopeInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const settings = await ctx.settings();
      return presentParticipants(
        await participants(scopeOf(parsed.data, settings)),
      );
    },

    async list(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, CYCLE, 'view');
      const rows = (await database
        .repository('reviewCycles')
        .withPolicy(policyOf(policies, 'reviewCycles'))
        .findMany({})) as Record<string, unknown>[];
      const cycles = rows
        .map(toCycle)
        .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
      const out = [];
      for (const cycle of cycles) {
        const results = await ctx.resultsOf(cycle.id);
        out.push({
          ...cycle,
          ownerName: await ctx.userName(cycle.ownerUserId),
          participants: results.filter((r) => r.status !== 'closed').length,
        });
      }
      return {
        cycles: out,
        can: {
          manage: Boolean(
            await tryAuthorizeAction(actor.authz, CYCLE, 'manage'),
          ),
        },
      };
    },

    async create(actor: ActorContext, input: unknown) {
      const policies = await authorizeAction(actor.authz, CYCLE, 'manage');
      const parsed = cycleInput.safeParse(input);
      if (!parsed.success)
        throw new HrError('INVALID_INPUT', 400, {
          fields: parsed.error.issues.map((i) => i.path.join('.')),
        });
      const data = parsed.data;
      if (data.periodEnd < data.periodStart)
        throw new HrError('REVIEW_CYCLE_PERIOD_INVALID', 400);
      const settings = await ctx.settings();
      const id = newId();
      const now = new Date();
      await database
        .repository('reviewCycles')
        .withPolicy(policyOf(policies, 'reviewCycles'))
        .createOne({
          values: {
            id,
            title: data.title,
            periodStart: data.periodStart,
            periodEnd: data.periodEnd,
            scope: scopeOf(data.scope, settings),
            stageDeadlines: data.stageDeadlines,
            autoAdvance: data.autoAdvance,
            status: 'draft',
            ownerUserId: data.ownerUserId ?? actor.userId,
            exclusions: null,
            stageLog: [],
            calibrationPack: null,
            publishedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      return service.detail(actor, id);
    },

    /** Title, deadlines and auto-advance at any time; scope and period only in draft. */
    async update(actor: ActorContext, id: string, input: unknown) {
      await authorizeAction(actor.authz, CYCLE, 'manage');
      const cycle = await ctx.cycle(id);
      const parsed = cycleUpdate.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const data = parsed.data;
      if (
        cycle.status !== 'draft' &&
        (data.scope || data.periodStart || data.periodEnd)
      )
        throw new HrError('REVIEW_CYCLE_STARTED', 409);
      const settings = await ctx.settings();
      const values: Record<string, unknown> = { updatedAt: new Date() };
      if (data.title) values.title = data.title;
      if (data.periodStart) values.periodStart = data.periodStart;
      if (data.periodEnd) values.periodEnd = data.periodEnd;
      if (data.scope)
        values.scope = scopeOf(data.scope, {
          minTenureDays:
            data.scope.minTenureDays ??
            cycle.scope.minTenureDays ??
            settings.minTenureDays,
          excludeProbation:
            data.scope.excludeProbation ?? cycle.scope.excludeProbation,
        });
      if (data.stageDeadlines)
        values.stageDeadlines = {
          ...cycle.stageDeadlines,
          ...data.stageDeadlines,
        };
      if (data.autoAdvance !== undefined) values.autoAdvance = data.autoAdvance;
      if (data.ownerUserId) values.ownerUserId = data.ownerUserId;
      await database
        .query()
        .updateTable('reviewCycles')
        .set(values)
        .where('id', '=', id)
        .execute();
      return service.detail(actor, id);
    },

    /** 进度看板: each stage's completion, the overdue list, the next stage. */
    async detail(actor: ActorContext, id: string) {
      const policies = await authorizeAction(actor.authz, CYCLE, 'view');
      const row = (await database
        .repository('reviewCycles')
        .withPolicy(policyOf(policies, 'reviewCycles'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('REVIEW_CYCLE_NOT_FOUND', 404);
      const cycle = toCycle(row);
      const results = await ctx.resultsOf(id);
      const reviews = await ctx.reviewsOf(id);
      const goals = await ctx.goalsOf(id);
      const employees = await ctx.employees();
      const titles = await ctx.departmentTitles();
      const schemesById = new Map((await ctx.schemes()).map((s) => [s.id, s]));
      const today = ctx.today();
      const active = results.filter((r) => r.status !== 'closed');
      const rate = (done: number, total: number) =>
        total ? Math.round((done / total) * 100) : null;
      const stages = {
        goalSetting: {
          total: active.length,
          done: active.filter((r) =>
            goals.some(
              (g) =>
                g.employeeId === r.employeeId &&
                (g.status === 'submitted' || g.status === 'approved'),
            ),
          ).length,
        },
        ...Object.fromEntries(
          (['self', 'peer', 'manager', 'skipLevel'] as const).map((role) => {
            const list = reviews.filter(
              (r) => r.role === role && r.status !== 'cancelled',
            );
            return [
              `${role}Review`,
              {
                total: list.length,
                done: list.filter((r) => r.status === 'submitted').length,
              },
            ];
          }),
        ),
      } as Record<string, { total: number; done: number }>;
      const open = await incomplete(cycle);
      const deadline = cycle.stageDeadlines[cycle.status];
      const overdue =
        deadline && deadline < today
          ? await Promise.all(
              open.map(async (item) => ({
                ...item,
                employeeName: employees.get(item.employeeId)?.name ?? '',
                reviewerName:
                  item.kind === 'peer' ? '' : await ctx.userName(item.userId),
              })),
            )
          : [];
      const next = await nextStage(cycle);
      const people = [];
      for (const r of results) {
        const employee = employees.get(r.employeeId);
        people.push({
          resultId: r.id,
          employeeId: r.employeeId,
          employeeNo: employee?.employeeNo ?? '',
          name: employee?.name ?? '',
          departmentTitle: titles.get(r.departmentId ?? '') ?? '',
          schemeId: r.schemeId,
          schemeTitle: schemesById.get(r.schemeId)?.title ?? '',
          managerName: await ctx.userName(r.managerUserId),
          skipLevelName: r.skipLevelUserId
            ? await ctx.userName(r.skipLevelUserId)
            : null,
          skipLevelSkipped: r.skipLevelSkipped,
          noAccount: r.noAccount,
          status: r.status,
          closedReason: r.closedReason,
        });
      }
      return {
        cycle: { ...cycle, ownerName: await ctx.userName(cycle.ownerUserId) },
        stages: Object.fromEntries(
          Object.entries(stages).map(([key, value]) => [
            key,
            { ...value, rate: rate(value.done, value.total) },
          ]),
        ),
        pending: open.length,
        overdue,
        next,
        participants: people,
        exclusions: cycle.exclusions,
        can: {
          manage: Boolean(
            await tryAuthorizeAction(actor.authz, CYCLE, 'manage'),
          ),
          advance:
            Boolean(await tryAuthorizeAction(actor.authz, CYCLE, 'advance')) &&
            next !== null,
          remind:
            Boolean(await tryAuthorizeAction(actor.authz, CYCLE, 'remind')) &&
            open.length > 0,
        },
      };
    },

    /** 推进阶段: tells how many have not finished; advances with `confirm: true`. */
    async advance(
      actor: ActorContext,
      id: string,
      input: unknown,
      options: { auto?: boolean } = {},
    ) {
      await authorizeAction(actor.authz, CYCLE, 'advance');
      const cycle = await ctx.cycle(id);
      const next = await nextStage(cycle);
      if (!next) throw new HrError('REVIEW_CYCLE_NO_NEXT_STAGE', 409);
      const pending = (await incomplete(cycle)).length;
      const confirm =
        input &&
        typeof input === 'object' &&
        (input as { confirm?: unknown }).confirm === true;
      if (!confirm) return { advanced: false, next, pending };
      if (next !== 'goalSetting' && cycle.status === 'draft') {
        // Nothing before: the first stage used starts the results.
      }
      const report = await enterStage(
        cycle,
        next,
        actor.userId,
        Boolean(options.auto),
      );
      return { advanced: true, next, pending, report };
    },

    /** 一键催办: tasks of the current stage; each person at most once per cooldown. */
    async remind(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, CYCLE, 'remind');
      const cycle = await ctx.cycle(id);
      const settings = await ctx.settings();
      const since = new Date(
        Date.now() - settings.urgeCooldownHours * 3_600_000,
      );
      const open = await incomplete(cycle);
      const users = [
        ...new Set(
          open.map((o) => o.userId).filter((u): u is string => Boolean(u)),
        ),
      ];
      const sent: string[] = [];
      const skipped: string[] = [];
      for (const userId of users) {
        const prefix = `perf:urge:${cycle.id}:${userId}:`;
        const recent = await database
          .query()
          .selectFrom('hrReminderLog')
          .select(['id'])
          .where('reminderKey', 'like', `${prefix}%`)
          .where('sentAt', '>', since)
          .executeTakeFirst();
        if (recent) {
          skipped.push(userId);
          continue;
        }
        const key = `${prefix}${Date.now()}`;
        const count = open.filter((o) => o.userId === userId).length;
        await platform.reminderOnce(key, () =>
          platform.notify({
            key,
            userIds: [userId],
            message: 'performanceUrge',
            params: {
              cycle: cycle.title,
              count: String(count),
              deadline: cycle.stageDeadlines[cycle.status] ?? '',
            },
            path:
              cycle.status === 'managerReview'
                ? '/talent/team-reviews'
                : '/talent/my-review',
          }),
        );
        sent.push(userId);
      }
      return { sent: sent.length, skipped: skipped.length };
    },

    /** 统计: AI draft adoption and the average active editing time of manager reviews. */
    async stats(
      actor: ActorContext,
      id: string,
      query: { departmentId?: string },
    ) {
      const policies = await authorizeAction(actor.authz, CYCLE, 'view');
      await ctx.cycle(id);
      const scope = query.departmentId
        ? new Set(await platform.organization.descendantsOf(query.departmentId))
        : null;
      const results = new Map(
        (await ctx.resultsOf(id)).map((r) => [r.id, r] as const),
      );
      const rows = (
        (await database
          .repository('reviews')
          .withPolicy(policyOf(policies, 'reviews'))
          .findMany({ filter: { cycleId: id } })) as Record<string, unknown>[]
      )
        .map(toReview)
        .filter(
          (r) =>
            (r.role === 'manager' || r.role === 'skipLevel') &&
            (!scope || scope.has(results.get(r.resultId)?.departmentId ?? '')),
        );
      const employees = await ctx.employees();
      const submitted = rows.filter((r) => r.status === 'submitted');
      const count = (value: string) =>
        submitted.filter((r) => r.aiDraftAdoption === value).length;
      const withDraft = submitted.filter((r) => r.aiDraftAdoption).length;
      const ratio = (n: number) =>
        withDraft ? Math.round((n / withDraft) * 100) : null;
      const reviews = [];
      for (const r of rows)
        reviews.push({
          reviewId: r.id,
          role: r.role,
          employeeName: employees.get(r.employeeId)?.name ?? '',
          reviewerName: await ctx.userName(r.reviewerUserId),
          status: r.status,
          aiDraftAdoption: r.aiDraftAdoption,
          activeSeconds: r.activeSeconds,
          submittedAt: r.submittedAt,
        });
      return {
        submitted: submitted.length,
        adoption: {
          adoptedAsIs: ratio(count('adoptedAsIs')),
          edited: ratio(count('edited')),
          discarded: ratio(count('discarded')),
          counts: {
            adoptedAsIs: count('adoptedAsIs'),
            edited: count('edited'),
            discarded: count('discarded'),
          },
        },
        averageActiveSeconds: submitted.length
          ? Math.round(
              submitted.reduce((sum, r) => sum + r.activeSeconds, 0) /
                submitted.length,
            )
          : null,
        reviews,
      };
    },

    /** Updates the scheme of a result (HR may change the matched scheme). */
    async setScheme(actor: ActorContext, resultId: string, input: unknown) {
      await authorizeAction(actor.authz, CYCLE, 'manage');
      const result = await ctx.result(resultId);
      const schemeId =
        input && typeof input === 'object'
          ? (input as { schemeId?: unknown }).schemeId
          : undefined;
      if (typeof schemeId !== 'string') throw new HrError('INVALID_INPUT', 400);
      await ctx.scheme(schemeId);
      const cycle = await ctx.cycle(result.cycleId);
      if (!['goalSetting', 'draft', 'selfReview'].includes(cycle.status))
        throw new HrError('REVIEW_CYCLE_STARTED', 409);
      await database
        .query()
        .updateTable('reviewResults')
        .set({ schemeId, updatedAt: new Date() })
        .where('id', '=', resultId)
        .execute();
      return toResult(
        (await database
          .query()
          .selectFrom('reviewResults')
          .selectAll()
          .where('id', '=', resultId)
          .executeTakeFirst()) as Record<string, unknown>,
      );
    },
  };
  return service;
}

export type CycleService = ReturnType<typeof createCycleService>;
