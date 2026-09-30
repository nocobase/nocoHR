/**
 * V4-12 绩效: what every performance service receives from the provider
 * (index.ts, V4-12 block), and the trusted reads they share. Reads here never
 * decide access: each service authorizes its business action first and uses
 * these only for rows the action already covers (or for non-sensitive facts
 * such as cycle titles and deadlines).
 */
import type { AIRunner } from '../ai-runner.js';
import type { AutomationService } from '../automation.js';
import type { CustomFieldService } from '../custom-fields.js';
import type { ActorContext } from '../framework-service.js';
import type { PlanService } from '../plan-service.js';
import type { Platform } from '../platform.js';
import { HrError, str } from '../shared.js';
import { day, iso, json, num, toScheme, type SchemeView } from './common.js';
import { readPerformanceSettings, type PerformanceSettings } from './config.js';

export interface PerformanceDeps {
  readonly platform: Platform;
  readonly ai: AIRunner;
  readonly automation: () => AutomationService;
  readonly plans: () => PlanService;
  readonly customFields: () => CustomFieldService;
  /** Everyone who holds a permission set now. */
  readonly holdersOf: (setKey: string) => Promise<string[]>;
  readonly hrAdministrators: () => Promise<string[]>;
  /** Runs work after the request answers; failures are logged. */
  readonly background: (label: string, run: () => Promise<unknown>) => void;
}

export interface CycleView {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  scope: {
    departmentIds: string[];
    minTenureDays: number;
    excludeProbation: boolean;
    schemeOverrides: Record<string, string>;
    managerOverrides: Record<string, string>;
    /** Peers HR names in advance (employeeId → user ids), nominated when the results are created. */
    peerPresets: Record<string, string[]>;
  };
  stageDeadlines: Record<string, string>;
  autoAdvance: boolean;
  status: string;
  ownerUserId: string;
  exclusions: { employeeId: string; name: string; reasons: string[] }[];
  stageLog: {
    from: string;
    to: string;
    at: string;
    by: string;
    auto: boolean;
  }[];
  calibrationPack: {
    content: string;
    generatedAt: string;
    source: 'ai' | 'rule';
    runId: string | null;
  } | null;
  publishedAt: string | null;
  createdAt: string | null;
}

export function toCycle(row: Record<string, unknown>): CycleView {
  const scope = json<Partial<CycleView['scope']>>(row.scope, {});
  return {
    id: str(row.id),
    title: str(row.title),
    periodStart: day(row.periodStart) ?? '',
    periodEnd: day(row.periodEnd) ?? '',
    scope: {
      departmentIds: scope.departmentIds ?? [],
      minTenureDays: scope.minTenureDays ?? 90,
      excludeProbation: scope.excludeProbation ?? true,
      schemeOverrides: scope.schemeOverrides ?? {},
      managerOverrides: scope.managerOverrides ?? {},
      peerPresets: scope.peerPresets ?? {},
    },
    stageDeadlines: json(row.stageDeadlines, {}),
    autoAdvance: row.autoAdvance === true || row.autoAdvance === 1,
    status: str(row.status),
    ownerUserId: str(row.ownerUserId),
    exclusions: json(row.exclusions, []),
    stageLog: json(row.stageLog, []),
    calibrationPack: json(row.calibrationPack, null),
    publishedAt: iso(row.publishedAt),
    createdAt: iso(row.createdAt),
  };
}

export interface ResultRow {
  id: string;
  cycleId: string;
  employeeId: string;
  schemeId: string;
  departmentId: string | null;
  positionId: string | null;
  managerUserId: string;
  skipLevelUserId: string | null;
  skipLevelSkipped: boolean;
  noAccount: boolean;
  peerUserIds: string[];
  peerStatus: string;
  evidenceSnapshot: import('./evidence.js').EvidenceSnapshot | null;
  evidenceSummary: string | null;
  computedScore: number | null;
  managerRating: string | null;
  calibratedRating: string | null;
  finalRating: string | null;
  adjustments: {
    from: string | null;
    to: string;
    reason: string;
    by: string;
    at: string;
  }[];
  status: string;
  closedReason: string | null;
  appeal: {
    reason: string;
    at: string;
    handledBy?: string | null;
    handledAt?: string | null;
    result?: 'upheld' | 'changed' | null;
    note?: string | null;
  } | null;
  publishedAt: string | null;
  acknowledgedAt: string | null;
}

const bool = (value: unknown) => value === true || value === 1;

export function toResult(row: Record<string, unknown>): ResultRow {
  return {
    id: str(row.id),
    cycleId: str(row.cycleId),
    employeeId: str(row.employeeId),
    schemeId: str(row.schemeId),
    departmentId: row.departmentId ? str(row.departmentId) : null,
    positionId: row.positionId ? str(row.positionId) : null,
    managerUserId: str(row.managerUserId),
    skipLevelUserId: row.skipLevelUserId ? str(row.skipLevelUserId) : null,
    skipLevelSkipped: bool(row.skipLevelSkipped),
    noAccount: bool(row.noAccount),
    peerUserIds: json(row.peerUserIds, []),
    peerStatus: str(row.peerStatus ?? 'none'),
    evidenceSnapshot: json(row.evidenceSnapshot, null),
    evidenceSummary: row.evidenceSummary ? str(row.evidenceSummary) : null,
    computedScore: num(row.computedScore),
    managerRating: row.managerRating ? str(row.managerRating) : null,
    calibratedRating: row.calibratedRating ? str(row.calibratedRating) : null,
    finalRating: row.finalRating ? str(row.finalRating) : null,
    adjustments: json(row.adjustments, []),
    status: str(row.status),
    closedReason: row.closedReason ? str(row.closedReason) : null,
    appeal: json(row.appeal, null),
    publishedAt: iso(row.publishedAt),
    acknowledgedAt: iso(row.acknowledgedAt),
  };
}

export interface ReviewRow {
  id: string;
  cycleId: string;
  resultId: string;
  employeeId: string;
  reviewerUserId: string;
  role: 'self' | 'peer' | 'manager' | 'skipLevel';
  items: import('./common.js').ReviewItems;
  overallRating: string | null;
  overallReason: string | null;
  comment: string | null;
  status: string;
  aiDraft: {
    comment: string;
    itemSuggestions: {
      goals: { goalId: string; comment: string }[];
      competencies: { competencyId: string; comment: string }[];
      qualitySafety: { score: number | null; comment: string } | null;
    };
    evidenceRefs: { type: string; id: string; label: string }[];
    generatedAt: string;
    source: 'ai' | 'rule';
  } | null;
  aiDraftAdoption: string | null;
  activeSeconds: number;
  submissionCount: number;
  submittedAt: string | null;
  hints: {
    submission: number;
    items: { type: string; text: string }[];
    at: string;
  } | null;
}

export function toReview(row: Record<string, unknown>): ReviewRow {
  return {
    id: str(row.id),
    cycleId: str(row.cycleId),
    resultId: str(row.resultId),
    employeeId: str(row.employeeId),
    reviewerUserId: str(row.reviewerUserId),
    role: str(row.role) as ReviewRow['role'],
    items: json(row.items, {}),
    overallRating: row.overallRating ? str(row.overallRating) : null,
    overallReason: row.overallReason ? str(row.overallReason) : null,
    comment: row.comment ? str(row.comment) : null,
    status: str(row.status),
    aiDraft: json(row.aiDraft, null),
    aiDraftAdoption: row.aiDraftAdoption ? str(row.aiDraftAdoption) : null,
    activeSeconds: Number(row.activeSeconds ?? 0) || 0,
    submissionCount: Number(row.submissionCount ?? 0) || 0,
    submittedAt: iso(row.submittedAt),
    hints: json(row.hints, null),
  };
}

export interface GoalRow {
  id: string;
  cycleId: string;
  employeeId: string | null;
  departmentId: string | null;
  title: string;
  measure: string;
  weight: number | null;
  alignedGoalId: string | null;
  progress: number;
  progressNotes: { at: string; progress: number; note: string; by: string }[];
  status: string;
  source: string;
  editedByEmployee: boolean;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  returnNote: string | null;
}

export function toGoal(row: Record<string, unknown>): GoalRow {
  return {
    id: str(row.id),
    cycleId: str(row.cycleId),
    employeeId: row.employeeId ? str(row.employeeId) : null,
    departmentId: row.departmentId ? str(row.departmentId) : null,
    title: str(row.title),
    measure: str(row.measure),
    weight: num(row.weight),
    alignedGoalId: row.alignedGoalId ? str(row.alignedGoalId) : null,
    progress: Number(row.progress ?? 0) || 0,
    progressNotes: json(row.progressNotes, []),
    status: str(row.status),
    source: str(row.source),
    editedByEmployee: bool(row.editedByEmployee),
    submittedAt: iso(row.submittedAt),
    approvedBy: row.approvedBy ? str(row.approvedBy) : null,
    approvedAt: iso(row.approvedAt),
    returnNote: row.returnNote ? str(row.returnNote) : null,
  };
}

export interface EmployeeRow {
  id: string;
  employeeNo: string;
  name: string;
  userId: string | null;
  departmentId: string;
  positionId: string | null;
  status: string;
  hireDate: string | null;
}

export function createPerformanceContext(deps: PerformanceDeps) {
  const { platform } = deps;
  const { database } = platform;

  const context = {
    ...deps,
    database,
    today: () => platform.currentDate(),
    settings: async (): Promise<PerformanceSettings> =>
      (await readPerformanceSettings(database)).value,

    async cycle(id: string): Promise<CycleView> {
      const row = await database
        .query()
        .selectFrom('reviewCycles')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('REVIEW_CYCLE_NOT_FOUND', 404);
      return toCycle(row);
    },

    async schemes(): Promise<SchemeView[]> {
      const rows = await database
        .query()
        .selectFrom('reviewSchemes')
        .selectAll()
        .orderBy('createdAt', 'asc')
        .execute();
      return rows.map((row) => toScheme(row as Record<string, unknown>));
    },

    async scheme(id: string): Promise<SchemeView> {
      const row = await database
        .query()
        .selectFrom('reviewSchemes')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('REVIEW_SCHEME_NOT_FOUND', 404);
      return toScheme(row);
    },

    async result(id: string): Promise<ResultRow> {
      const row = await database
        .query()
        .selectFrom('reviewResults')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('REVIEW_RESULT_NOT_FOUND', 404);
      return toResult(row);
    },

    async resultsOf(cycleId: string): Promise<ResultRow[]> {
      const rows = await database
        .query()
        .selectFrom('reviewResults')
        .selectAll()
        .where('cycleId', '=', cycleId)
        .execute();
      return rows.map((row) => toResult(row as Record<string, unknown>));
    },

    async review(id: string): Promise<ReviewRow> {
      const row = await database
        .query()
        .selectFrom('reviews')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('REVIEW_NOT_FOUND', 404);
      return toReview(row);
    },

    async reviewsOf(cycleId: string): Promise<ReviewRow[]> {
      const rows = await database
        .query()
        .selectFrom('reviews')
        .selectAll()
        .where('cycleId', '=', cycleId)
        .execute();
      return rows.map((row) => toReview(row as Record<string, unknown>));
    },

    async goalsOf(cycleId: string): Promise<GoalRow[]> {
      const rows = await database
        .query()
        .selectFrom('goals')
        .selectAll()
        .where('cycleId', '=', cycleId)
        .orderBy('createdAt', 'asc')
        .execute();
      return rows.map((row) => toGoal(row as Record<string, unknown>));
    },

    async employees(): Promise<Map<string, EmployeeRow>> {
      const rows = await database
        .query()
        .selectFrom('employees')
        .select([
          'id',
          'employeeNo',
          'name',
          'userId',
          'departmentId',
          'positionId',
          'status',
          'hireDate',
        ])
        .execute();
      return new Map(
        rows.map((row) => [
          str(row.id),
          {
            id: str(row.id),
            employeeNo: str(row.employeeNo),
            name: str(row.name),
            userId: row.userId ? str(row.userId) : null,
            departmentId: str(row.departmentId),
            positionId: row.positionId ? str(row.positionId) : null,
            status: str(row.status),
            hireDate: day(row.hireDate),
          },
        ]),
      );
    },

    async departmentTitles(): Promise<Map<string, string>> {
      const tree = await platform.organization.listTree();
      return new Map(
        tree.map((d) => [d.id, platform.organization.titleText(d.title)]),
      );
    },

    async userName(userId: string | null | undefined): Promise<string> {
      return (await platform.userName(userId)) ?? '';
    },

    /** The performance to-dos of a reference close once handled. */
    async closeWorkItems(refPrefix: string): Promise<void> {
      const now = new Date();
      await database
        .query()
        .updateTable('workItems')
        .set({ status: 'done', doneAt: now, updatedAt: now })
        .where('refId', 'like', `${refPrefix}%`)
        .where('status', '=', 'open')
        .execute()
        .catch(() => undefined);
    },

    /** Whether the caller holds an action (feature visibility, not access). */
    can: (ctx: ActorContext, resource: string, action: string) =>
      platform.can(ctx, resource, action),
  };
  return context;
}

export type PerformanceContext = ReturnType<typeof createPerformanceContext>;
