/**
 * AI employees' proactive work ("总纲 · AI 员工约定"): the catalogue of
 * automations, their administrator-adjustable settings (switch, owner, run
 * time, parameters), the run record every execution leaves, and the adoption
 * of the drafts a run produced.
 *
 * An automation runs as its owner: the work receives the owner's
 * authorization context and may read and write only what the owner may. A run
 * is recorded before the work starts and closed with its outcome, so a crash
 * leaves a `running` row to look at rather than nothing. `dedupeKey` makes a
 * repeated trigger — the same document parsed twice, the scheduler firing
 * twice in one hour — a no-op.
 */
import type { DatabaseManager } from '@nocobase/db';

import { authorizeAction, scopeForUser } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import type { Platform } from './platform.js';
import { json } from './platform.js';
import { HrError, isRecord, newId, str } from './shared.js';

export type AutomationKind =
  'daily' | 'weekly' | 'monthly' | 'afterDaily' | 'event';
/** `retry` re-runs a failed run with the same trigger object. */
export type AutomationTrigger = 'schedule' | 'event' | 'manual' | 'retry';
/** Numbers (thresholds, limits) or text (such as synonym groups). */
export type AutomationParam = number | string;

export interface AutomationDefinition {
  readonly key: string;
  /** The AI employee username. */
  readonly employee: string;
  /** The composite whose `configure` action governs this automation. */
  readonly composite: string;
  readonly kind: AutomationKind;
  readonly defaults: {
    readonly hour?: number;
    readonly weekday?: number;
    readonly monthDay?: number;
    readonly params?: Readonly<Record<string, AutomationParam>>;
  };
}

/** Every automation, in the order the settings page lists them. */
export const AUTOMATIONS: readonly AutomationDefinition[] = [
  // V1 step 1: the HR assistant checks every Excel import once it commits.
  {
    key: 'hrAssistant.importCheck',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {
      params: {
        perTypeLimit: 20,
        editDistance: 1,
        // Groups separated by ";", alternatives within a group by "/".
        synonyms: 'CNC/数控; 操作工/操作员; 班组长/组长',
      },
    },
  },
  // V1 step 2: attachment recognition on upload; probation and renewal preparation after the daily rules.
  {
    key: 'hrAssistant.extractAttachment',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  // V1-03: explain a sync's pending items and draft job-title mappings.
  {
    key: 'hrAssistant.syncExplain',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {
      params: {
        // Incremental syncs' new items are explained together once they are this old.
        mergeMinutes: 60,
        synonyms: 'CNC/数控机床/数控; 操作工/操作员; 班组长/组长',
      },
    },
  },
  {
    key: 'hrAssistant.probationPrep',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'afterDaily',
    defaults: {},
  },
  {
    key: 'hrAssistant.renewalPrep',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'afterDaily',
    defaults: {},
  },
  // V1-02: notes on change checklists; labour-contract compliance after the daily rules (and on contract saves).
  {
    key: 'hrAssistant.checklistNotes',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'hrAssistant.compliance',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'afterDaily',
    defaults: {},
  },
  {
    key: 'frameworkAdvisor.draftNewPositions',
    employee: 'frameworkAdvisor',
    composite: 'talent.frameworkAdvisor',
    kind: 'daily',
    defaults: { hour: 9 },
  },
  {
    key: 'frameworkAdvisor.dictionaryReview',
    employee: 'frameworkAdvisor',
    composite: 'talent.frameworkAdvisor',
    kind: 'monthly',
    defaults: { hour: 9, monthDay: 1 },
  },
  {
    key: 'contentWriter.draftCourseFromDocument',
    employee: 'contentWriter',
    composite: 'talent.contentWriter',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'contentWriter.fillCourseQuestions',
    employee: 'contentWriter',
    composite: 'talent.contentWriter',
    kind: 'event',
    defaults: { params: { targetCount: 10 } },
  },
  // V2-05: cover for leave conflicts, attendance reminders (after the daily rules), the month-end check.
  {
    key: 'hrAssistant.replacementSuggest',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'hrAssistant.attendanceAnomaly',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'afterDaily',
    // V2-05 (realigned): 考勤异常追问; no reply after replyDays → the employee and the head are reminded.
    defaults: { params: { replyDays: 2 } },
  },
  {
    key: 'hrAssistant.monthEndCheck',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  // V1-04: a new document or version is checked against the others once it is ready.
  {
    key: 'knowledgeAssistant.conflictCheck',
    employee: 'knowledgeAssistant',
    composite: 'talent.knowledgeAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'knowledgeAssistant.gapWeeklyReport',
    employee: 'knowledgeAssistant',
    composite: 'talent.knowledgeAssistant',
    kind: 'weekly',
    defaults: { hour: 9, weekday: 1 },
  },
  {
    key: 'certificationSteward.weeklyBrief',
    employee: 'certificationSteward',
    composite: 'talent.certificationSteward',
    kind: 'weekly',
    defaults: { hour: 9, weekday: 1 },
  },
  {
    key: 'certificationSteward.recertEscalation',
    employee: 'certificationSteward',
    composite: 'talent.certificationSteward',
    kind: 'afterDaily',
    defaults: {},
  },
  {
    key: 'certificationSteward.remedialLearning',
    employee: 'certificationSteward',
    composite: 'talent.certificationSteward',
    kind: 'event',
    defaults: {},
  },
  // V3-10: 任职准备材料 when a 任职资格认证 is obtained; 考官 suggested scores; 学习教练 考后补学计划.
  {
    key: 'certificationSteward.qualificationPrep',
    employee: 'certificationSteward',
    composite: 'talent.certificationSteward',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'examiner.gradingSuggestion',
    employee: 'examiner',
    composite: 'talent.examiner',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'learningCoach.examFailedPlan',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'event',
    defaults: {},
  },
  // V2 step 5. The two learning-coach jobs and the exam recommendation run after the daily rules, at 09:00.
  {
    key: 'learningCoach.gapPlans',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'afterDaily',
    defaults: {},
  },
  {
    key: 'learningCoach.progressNudge',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'afterDaily',
    defaults: { params: { lagThreshold: 30, minElapsedPercent: 50 } },
  },
  // V3-09: a plan after an onboarding, transfer or promotion is processed; a plan for a development target's gaps.
  {
    key: 'learningCoach.jobEventPlans',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'learningCoach.developmentTargetPlans',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'afterDaily',
    defaults: {},
  },
  {
    key: 'practiceCoach.draftScenarioOnPublish',
    employee: 'practiceCoach',
    composite: 'talent.practiceCoach',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'practiceCoach.preExamRecommend',
    employee: 'practiceCoach',
    composite: 'talent.practiceCoach',
    kind: 'afterDaily',
    defaults: {},
  },
  // V2-06: 算薪异常检查 after each calculation, and 账单上传后处理. Salary data: owned by an hr.payroll holder
  // (default payroll01) and configured through talent.payrollSettings, which hr.admin does not hold.
  {
    key: 'hrAssistant.payrollCheck',
    employee: 'hrAssistant',
    composite: 'talent.payrollSettings',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'vendorReconciler.billReview',
    employee: 'vendorReconciler',
    composite: 'talent.payrollSettings',
    kind: 'event',
    defaults: {},
  },
  // V2-07 (recruiting/assistant.ts): 人事助理的用工测算、待入职跟进、新员工回访与材料识别 (owner hr01); 招聘助理的
  // 职位起草、简历库复用、初筛、面试题、面试汇总与 18:00 汇总 (owner recruit01; each runs as the requisition's recruiter).
  {
    key: 'hrAssistant.workforceExplain',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'hrAssistant.preboarding',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'daily',
    defaults: { hour: 9 },
  },
  {
    key: 'hrAssistant.preboardingExtract',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'hrAssistant.newHireCheckIn',
    employee: 'hrAssistant',
    composite: 'talent.hrAssistant',
    kind: 'daily',
    defaults: { hour: 9 },
  },
  {
    key: 'recruitingAssistant.postingDraft',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'recruitingAssistant.poolReuse',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'recruitingAssistant.screening',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'recruitingAssistant.interviewQuestions',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'recruitingAssistant.interviewSummary',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'recruitingAssistant.dailyDigest',
    employee: 'recruitingAssistant',
    composite: 'talent.recruitingAssistant',
    kind: 'daily',
    defaults: { hour: 18 },
  },
  // V2-07 end
  // V3-11 (profile/analyst.ts): the talent analyst's five jobs, the coach's recommendation content, the writer's
  // version revision and question-quality check. Thresholds are the administrator's; drafts expire at 09:00.
  {
    key: 'talentAnalyst.trainingCheck',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'event',
    defaults: {
      params: {
        clusterWindowDays: 90,
        clusterMinCount: 2,
        recommendationExpiryDays: 14,
      },
    },
  },
  {
    key: 'learningCoach.recommendationItems',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'event',
    defaults: { params: { dueWorkingDays: 10, maxItems: 4 } },
  },
  {
    key: 'talentAnalyst.levelSuggestions',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'weekly',
    defaults: {
      hour: 9,
      weekday: 1,
      params: {
        windowDays: 180,
        downgradeMinIssues: 2,
        upgradeExamPercent: 90,
        upgradeMinDelivered: 2,
        suggestionExpiryDays: 30,
      },
    },
  },
  {
    key: 'talentAnalyst.monthlyReport',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'monthly',
    defaults: {
      hour: 9,
      monthDay: 1,
      params: { newHireMonths: 6, retentionDays: 30, retentionMinHires: 10 },
    },
  },
  {
    key: 'talentAnalyst.summaryRefresh',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'weekly',
    defaults: { hour: 22, weekday: 7, params: { lookbackDays: 7 } },
  },
  {
    key: 'talentAnalyst.ruleDrafting',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'daily',
    defaults: { hour: 9 },
  },
  {
    key: 'contentWriter.versionRevision',
    employee: 'contentWriter',
    composite: 'talent.contentWriter',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'contentWriter.questionQuality',
    employee: 'contentWriter',
    composite: 'talent.contentWriter',
    kind: 'monthly',
    defaults: {
      hour: 9,
      monthDay: 1,
      params: {
        minAttempts: 20,
        lowPercent: 30,
        highPercent: 98,
        minDiscrimination: 0.1,
      },
    },
  },
  // V3-11 end
  // V4-12 (performance/assistant.ts): 绩效助理的过程数据摘要、目标草稿、评语初稿、偏差检查与校准材料; 学习教练的低绩效学习计划.
  {
    key: 'performanceAssistant.evidenceSummary',
    employee: 'performanceAssistant',
    composite: 'talent.performanceAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'performanceAssistant.goalDrafts',
    employee: 'performanceAssistant',
    composite: 'talent.performanceAssistant',
    kind: 'daily',
    defaults: { hour: 9 },
  },
  {
    key: 'performanceAssistant.reviewDrafts',
    employee: 'performanceAssistant',
    composite: 'talent.performanceAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'performanceAssistant.deviationCheck',
    employee: 'performanceAssistant',
    composite: 'talent.performanceAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'performanceAssistant.calibrationPack',
    employee: 'performanceAssistant',
    composite: 'talent.performanceAssistant',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'learningCoach.reviewResultPlans',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'event',
    defaults: {},
  },
  // V4-12 end
  // V4-13 (talent-review/): 人才分析师的盘点预放置、继任候选推荐、继任风险提醒与培训效果季报（季度任务按每月 1 日检查季度首月）;
  // 体系顾问的版本变更说明; 考官的实操辅助记录与考核表起草; 知识助手的知识沉淀; 内容编写员的译文起草; 学习教练的盘点发展计划.
  {
    key: 'talentAnalyst.prePlacement',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'talentAnalyst.successorRecommend',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'monthly',
    defaults: { hour: 9, monthDay: 1 },
  },
  {
    key: 'talentAnalyst.successionRisk',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'monthly',
    defaults: { hour: 9, monthDay: 1 },
  },
  {
    key: 'talentAnalyst.trainingEffectReport',
    employee: 'talentAnalyst',
    composite: 'talent.talentAnalyst',
    kind: 'monthly',
    defaults: { hour: 9, monthDay: 1 },
  },
  {
    key: 'frameworkAdvisor.versionChangeNote',
    employee: 'frameworkAdvisor',
    composite: 'talent.frameworkAdvisor',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'examiner.structureObservation',
    employee: 'examiner',
    composite: 'talent.examiner',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'examiner.draftPracticalChecklist',
    employee: 'examiner',
    composite: 'talent.examiner',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'knowledgeAssistant.knowledgeDistill',
    employee: 'knowledgeAssistant',
    composite: 'talent.knowledgeAssistant',
    kind: 'weekly',
    defaults: { hour: 9, weekday: 1 },
  },
  {
    key: 'contentWriter.translationDraft',
    employee: 'contentWriter',
    composite: 'talent.contentWriter',
    kind: 'event',
    defaults: {},
  },
  {
    key: 'learningCoach.talentReviewPlans',
    employee: 'learningCoach',
    composite: 'talent.learningCoach',
    kind: 'event',
    defaults: {},
  },
  // V4-13 end
  // V4-14 (licensed/): 认证管家的调岗资质检查（transfer / promote 事件处理完成且判定有结果时）.
  {
    key: 'certificationSteward.transferCheck',
    employee: 'certificationSteward',
    composite: 'talent.certificationSteward',
    kind: 'event',
    defaults: {},
  },
  // V4-14 end
];

export interface AutomationSetting {
  readonly key: string;
  readonly employee: string;
  readonly kind: AutomationKind;
  readonly enabled: boolean;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly hour: number | null;
  readonly weekday: number | null;
  readonly monthDay: number | null;
  readonly params: Record<string, AutomationParam>;
  readonly lastRun: {
    readonly id: string;
    readonly status: string;
    readonly startedAt: string;
  } | null;
  readonly adoption: AdoptionStats;
}

export interface AdoptionStats {
  readonly total: number;
  readonly adopted: number;
  readonly modified: number;
  readonly discarded: number;
  readonly pending: number;
  /** (adopted + modified) ÷ decided, or null before anything was decided. */
  readonly rate: number | null;
}

export interface AutomationRunView {
  readonly id: string;
  readonly task: string;
  readonly employee: string;
  readonly trigger: AutomationTrigger;
  readonly triggerRef: unknown;
  readonly ownerUserId: string | null;
  readonly ownerName: string | null;
  readonly status: 'running' | 'succeeded' | 'skipped' | 'failed';
  readonly inputSummary: string | null;
  readonly output: unknown;
  readonly references: unknown;
  readonly fallback: boolean;
  readonly conversationSessionId: string | null;
  readonly error: string | null;
  readonly startedAt: string;
  readonly finishedAt: string | null;
  readonly items: readonly {
    entityType: string;
    entityId: string;
    outcome: string;
    outcomeByName: string | null;
    outcomeAt: string | null;
  }[];
}

/** What the work of one run sees. */
export interface AutomationRunContext {
  readonly runId: string;
  readonly trigger: AutomationTrigger;
  /** The owner's authorization context: the run reads and writes only what the owner may. */
  readonly owner: ActorContext;
  readonly params: Readonly<Record<string, AutomationParam>>;
  summarize(text: string): void;
  reference(references: unknown): void;
  usedConversation(sessionId: string | undefined): void;
  /** The AI was unavailable and the rule-based fallback produced the output. */
  markFallback(): void;
  /** Records drafts this run produced, with a hash of the content as written, for the adoption rate. */
  recordItems(
    entityType: string,
    items: readonly { id: string; hash: string | null }[],
  ): Promise<void>;
}

export interface AutomationWorkResult {
  /** `skipped` when there was nothing to do; the default is `succeeded`. */
  readonly status?: 'succeeded' | 'skipped';
  readonly output?: Record<string, unknown>;
}

export interface RunOptions {
  readonly triggerRef?: Record<string, unknown>;
  readonly dedupeKey?: string;
}

export type RunOutcome =
  | { readonly status: 'disabled'; readonly runId?: string }
  | { readonly status: 'duplicate'; readonly runId?: string }
  | {
      readonly status: 'succeeded' | 'skipped' | 'failed';
      readonly runId: string;
      readonly output?: Record<string, unknown>;
    };

export interface AutomationService {
  definition(key: string): AutomationDefinition;
  list(ctx: ActorContext): Promise<AutomationSetting[]>;
  update(
    ctx: ActorContext,
    key: string,
    input: unknown,
  ): Promise<AutomationSetting>;
  listRuns(
    ctx: ActorContext,
    filters: { task?: string; limit?: number },
  ): Promise<AutomationRunView[]>;
  getRun(ctx: ActorContext, id: string): Promise<AutomationRunView>;
  /** Authorizes a person starting a scheduled automation by hand. */
  assertCanRun(ctx: ActorContext, key: string): Promise<void>;
  /** Authorizes retrying a failed run; answers its task and trigger object. */
  retryTarget(
    ctx: ActorContext,
    runId: string,
  ): Promise<{ task: string; triggerRef: Record<string, unknown> }>;
  run(
    key: string,
    trigger: AutomationTrigger,
    options: RunOptions,
    work: (run: AutomationRunContext) => Promise<AutomationWorkResult>,
  ): Promise<RunOutcome>;
  /** An automation's current parameters, for work that reads them outside a run. */
  paramsOf(key: string): Promise<Record<string, AutomationParam>>;
  /** Scheduled automations due in the hour containing `now`, with the period key that dedupes them. */
  due(now: Date): Promise<{ key: string; periodKey: string }[]>;
}

export interface AutomationServiceDeps {
  readonly platform: Platform;
}

const HOUR_FORMAT = { hour: 'numeric', hourCycle: 'h23' } as const;

/** The local calendar fields of `now` in the application time zone. */
function localParts(
  now: Date,
  timeZone: string,
): {
  date: string;
  hour: number;
  weekday: number;
  monthDay: number;
  month: string;
} {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, ...HOUR_FORMAT }).format(now),
  );
  const weekdayName = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(now);
  const weekday =
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekdayName) + 1;
  return {
    date,
    hour,
    weekday,
    monthDay: Number(date.slice(8, 10)),
    month: date.slice(0, 7),
  };
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : str(value);
}

export function createAutomationService(
  deps: AutomationServiceDeps,
): AutomationService {
  const { platform } = deps;
  const database: DatabaseManager = platform.database;
  const byKey = new Map(AUTOMATIONS.map((a) => [a.key, a]));

  function definition(key: string): AutomationDefinition {
    const found = byKey.get(key);
    if (!found) throw new HrError('AUTOMATION_NOT_FOUND', 404);
    return found;
  }

  async function storedRow(
    key: string,
  ): Promise<Record<string, unknown> | undefined> {
    return await database
      .query()
      .selectFrom('aiAutomationSettings')
      .selectAll()
      .where('id', '=', key)
      .executeTakeFirst();
  }

  async function resolved(key: string): Promise<{
    definition: AutomationDefinition;
    enabled: boolean;
    ownerUserId: string | null;
    hour: number | null;
    weekday: number | null;
    monthDay: number | null;
    params: Record<string, AutomationParam>;
  }> {
    const def = definition(key);
    const row = await storedRow(key);
    const number = (value: unknown, fallback: number | undefined) =>
      value === null || value === undefined
        ? (fallback ?? null)
        : Number(value);
    const stored = json<Record<string, unknown>>(row?.params, {});
    const params: Record<string, AutomationParam> = {
      ...(def.defaults.params ?? {}),
    };
    for (const [name, value] of Object.entries(stored)) {
      const fallback = def.defaults.params?.[name];
      if (typeof fallback === 'string' && typeof value === 'string')
        params[name] = value;
      else if (typeof value === 'number' && Number.isFinite(value))
        params[name] = value;
    }
    return {
      definition: def,
      enabled: row ? row.enabled === true || row.enabled === 1 : true,
      ownerUserId: row?.ownerUserId ? str(row.ownerUserId) : null,
      hour: number(row?.hour, def.defaults.hour),
      weekday: number(row?.weekday, def.defaults.weekday),
      monthDay: number(row?.monthDay, def.defaults.monthDay),
      params,
    };
  }

  async function adoptionFor(tasks: readonly string[]) {
    const stats = new Map<string, AdoptionStats>();
    if (!tasks.length) return stats;
    const rows = await database
      .query()
      .selectFrom('aiTaskRunItems')
      .innerJoin('aiTaskRuns', 'aiTaskRuns.id', 'aiTaskRunItems.runId')
      .select(['aiTaskRuns.task as task', 'aiTaskRunItems.outcome as outcome'])
      .where('aiTaskRuns.task', 'in', [...tasks])
      .execute();
    for (const task of tasks) {
      const own = rows.filter((r) => str(r.task) === task);
      const count = (outcome: string) =>
        own.filter((r) => str(r.outcome) === outcome).length;
      const adopted = count('adopted');
      const modified = count('modified');
      const discarded = count('discarded');
      const decided = adopted + modified + discarded;
      stats.set(task, {
        total: own.length,
        adopted,
        modified,
        discarded,
        pending: count('pending'),
        rate: decided
          ? Math.round(((adopted + modified) / decided) * 1000) / 10
          : null,
      });
    }
    return stats;
  }

  async function configurable(ctx: ActorContext): Promise<Set<string>> {
    const allowed = new Set<string>();
    for (const composite of new Set(AUTOMATIONS.map((a) => a.composite)))
      if (await platform.can(ctx, composite, 'configure'))
        allowed.add(composite);
    return allowed;
  }

  async function toSetting(
    key: string,
    adoption: Map<string, AdoptionStats>,
  ): Promise<AutomationSetting> {
    const current = await resolved(key);
    const last = await database
      .query()
      .selectFrom('aiTaskRuns')
      .select(['id', 'status', 'startedAt'])
      .where('task', '=', key)
      .orderBy('startedAt', 'desc')
      .executeTakeFirst();
    return {
      key,
      employee: current.definition.employee,
      kind: current.definition.kind,
      enabled: current.enabled,
      ownerUserId: current.ownerUserId,
      ownerName: await platform.userName(current.ownerUserId),
      hour: current.hour,
      weekday: current.weekday,
      monthDay: current.monthDay,
      params: current.params,
      lastRun: last
        ? {
            id: str(last.id),
            status: str(last.status),
            startedAt: iso(last.startedAt)!,
          }
        : null,
      adoption: adoption.get(key) ?? {
        total: 0,
        adopted: 0,
        modified: 0,
        discarded: 0,
        pending: 0,
        rate: null,
      },
    };
  }

  async function toRunView(
    row: Record<string, unknown>,
  ): Promise<AutomationRunView> {
    const items = await database
      .query()
      .selectFrom('aiTaskRunItems')
      .selectAll()
      .where('runId', '=', str(row.id))
      .execute();
    return {
      id: str(row.id),
      task: str(row.task),
      employee: str(row.employee),
      trigger: str(row.trigger) as AutomationTrigger,
      triggerRef: json(row.triggerRef, null),
      ownerUserId: row.ownerUserId ? str(row.ownerUserId) : null,
      ownerName: await platform.userName(
        row.ownerUserId ? str(row.ownerUserId) : null,
      ),
      status: str(row.status) as AutomationRunView['status'],
      inputSummary: row.inputSummary ? str(row.inputSummary) : null,
      output: json(row.output, null),
      references: json(row.references, null),
      fallback: row.fallback === true || row.fallback === 1,
      conversationSessionId: row.conversationSessionId
        ? str(row.conversationSessionId)
        : null,
      error: row.error ? str(row.error) : null,
      startedAt: iso(row.startedAt)!,
      finishedAt: iso(row.finishedAt),
      items: await Promise.all(
        (items as Record<string, unknown>[]).map(async (item) => ({
          entityType: str(item.entityType),
          entityId: str(item.entityId),
          outcome: str(item.outcome),
          outcomeByName: await platform.userName(
            item.outcomeByUserId ? str(item.outcomeByUserId) : null,
          ),
          outcomeAt: iso(item.outcomeAt),
        })),
      ),
    };
  }

  function parseInt(
    value: unknown,
    min: number,
    max: number,
    code: string,
  ): number | null {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max)
      throw new HrError(code, 400);
    return number;
  }

  const service: AutomationService = {
    definition,

    async paramsOf(key) {
      return (await resolved(key)).params;
    },

    async list(ctx) {
      const allowed = await configurable(ctx);
      if (!allowed.size) throw new HrError('FORBIDDEN', 403);
      const keys = AUTOMATIONS.filter((a) => allowed.has(a.composite)).map(
        (a) => a.key,
      );
      const adoption = await adoptionFor(keys);
      return Promise.all(keys.map((key) => toSetting(key, adoption)));
    },

    async update(ctx, key, input) {
      const def = definition(key);
      await authorizeAction(ctx.authz, def.composite, 'configure');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const current = await resolved(key);
      const next = {
        enabled:
          typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
        ownerUserId:
          'ownerUserId' in input
            ? input.ownerUserId
              ? str(input.ownerUserId)
              : null
            : current.ownerUserId,
        hour:
          'hour' in input
            ? parseInt(input.hour, 0, 23, 'AUTOMATION_TIME_INVALID')
            : current.hour,
        weekday:
          'weekday' in input
            ? parseInt(input.weekday, 1, 7, 'AUTOMATION_TIME_INVALID')
            : current.weekday,
        monthDay:
          'monthDay' in input
            ? parseInt(input.monthDay, 1, 28, 'AUTOMATION_TIME_INVALID')
            : current.monthDay,
        params: { ...current.params },
      };
      if (isRecord(input.params))
        for (const [name, value] of Object.entries(input.params)) {
          if (!(name in (def.defaults.params ?? {}))) continue;
          if (typeof def.defaults.params?.[name] === 'string') {
            if (typeof value !== 'string' || value.length > 2000)
              throw new HrError('AUTOMATION_PARAM_INVALID', 400);
            next.params[name] = value.trim();
            continue;
          }
          const number = Number(value);
          if (!Number.isFinite(number) || number < 0)
            throw new HrError('AUTOMATION_PARAM_INVALID', 400);
          // Percentages (the learning coach's lag threshold and elapsed share) stay within 0–100.
          if (
            (name === 'lagThreshold' || name.endsWith('Percent')) &&
            number > 100
          )
            throw new HrError('AUTOMATION_PARAM_INVALID', 400);
          next.params[name] = number;
        }
      if (next.ownerUserId) {
        const owner = await platform.employeeOfUser(next.ownerUserId);
        if (!owner || owner.status === 'leave')
          throw new HrError('AUTOMATION_OWNER_INVALID', 400);
      }
      const now = new Date();
      const values = {
        enabled: next.enabled,
        ownerUserId: next.ownerUserId,
        hour: next.hour,
        weekday: next.weekday,
        monthDay: next.monthDay,
        params: JSON.stringify(next.params),
        updatedByUserId: ctx.userId,
        updatedAt: now,
      };
      if (await storedRow(key))
        await database
          .query()
          .updateTable('aiAutomationSettings')
          .set(values)
          .where('id', '=', key)
          .execute();
      else
        await database
          .query()
          .insertInto('aiAutomationSettings')
          .values({ id: key, ...values, createdAt: now })
          .execute();
      return toSetting(key, await adoptionFor([key]));
    },

    async listRuns(ctx, filters) {
      const allowed = await configurable(ctx);
      const tasks = AUTOMATIONS.filter((a) => allowed.has(a.composite))
        .map((a) => a.key)
        .filter((key) => !filters.task || key === filters.task);
      if (!tasks.length) throw new HrError('FORBIDDEN', 403);
      const rows = await database
        .query()
        .selectFrom('aiTaskRuns')
        .selectAll()
        .where('task', 'in', tasks)
        .orderBy('startedAt', 'desc')
        .limit(Math.min(Math.max(filters.limit ?? 50, 1), 200))
        .execute();
      return Promise.all(rows.map(toRunView));
    },

    async getRun(ctx, id) {
      const row = await database
        .query()
        .selectFrom('aiTaskRuns')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('AUTOMATION_RUN_NOT_FOUND', 404);
      const def = byKey.get(str(row.task));
      if (!def || !(await platform.can(ctx, def.composite, 'configure')))
        throw new HrError('AUTOMATION_RUN_NOT_FOUND', 404);
      return toRunView(row);
    },

    async assertCanRun(ctx, key) {
      const def = definition(key);
      await authorizeAction(ctx.authz, def.composite, 'configure');
      if (def.kind === 'event') throw new HrError('AUTOMATION_EVENT_ONLY', 400);
    },

    async retryTarget(ctx, runId) {
      const row = await database
        .query()
        .selectFrom('aiTaskRuns')
        .select(['task', 'status', 'triggerRef'])
        .where('id', '=', runId)
        .executeTakeFirst();
      if (!row) throw new HrError('AUTOMATION_RUN_NOT_FOUND', 404);
      const def = definition(str(row.task));
      await authorizeAction(ctx.authz, def.composite, 'configure');
      if (row.status !== 'failed')
        throw new HrError('AUTOMATION_RUN_NOT_FAILED', 409);
      const ref = json<Record<string, unknown>>(row.triggerRef, {});
      return { task: def.key, triggerRef: isRecord(ref) ? ref : {} };
    },

    async run(key, trigger, options, work) {
      const current = await resolved(key);
      const startedAt = new Date();
      const runId = newId();
      const base = {
        id: runId,
        task: key,
        employee: current.definition.employee,
        trigger,
        triggerRef: options.triggerRef
          ? JSON.stringify(options.triggerRef)
          : null,
        dedupeKey: options.dedupeKey ?? null,
        ownerUserId: current.ownerUserId,
        inputSummary: null,
        output: null,
        references: null,
        fallback: false,
        conversationSessionId: null,
        error: null,
        startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      // A switched-off task or a repeated trigger still leaves a skipped run, so the record shows why nothing happened.
      const skip = async (reason: 'DISABLED' | 'DUPLICATE') => {
        await database
          .query()
          .insertInto('aiTaskRuns')
          .values({
            ...base,
            dedupeKey: null,
            status: 'skipped',
            error: reason,
            finishedAt: startedAt,
          })
          .execute()
          .catch(() => undefined);
      };
      if (!current.enabled) {
        if (trigger !== 'schedule') await skip('DISABLED');
        return { status: 'disabled', runId };
      }
      if (options.dedupeKey) {
        const existing = await database
          .query()
          .selectFrom('aiTaskRuns')
          .select(['id'])
          .where('task', '=', key)
          .where('dedupeKey', '=', options.dedupeKey)
          .executeTakeFirst();
        if (existing) {
          await skip('DUPLICATE');
          return { status: 'duplicate', runId };
        }
      }
      if (!current.ownerUserId) {
        await database
          .query()
          .insertInto('aiTaskRuns')
          .values({
            ...base,
            status: 'skipped',
            error: 'NO_OWNER',
            finishedAt: startedAt,
          })
          .execute()
          .catch(() => undefined);
        return { status: 'skipped', runId };
      }
      try {
        await database
          .query()
          .insertInto('aiTaskRuns')
          .values({ ...base, status: 'running', finishedAt: null })
          .execute();
      } catch {
        // Another trigger with the same dedupe key won the race.
        await skip('DUPLICATE');
        return { status: 'duplicate', runId };
      }
      const record = {
        inputSummary: null as string | null,
        references: null as unknown,
        sessionId: null as string | null,
        fallback: false,
      };
      const ownerUserId = current.ownerUserId;
      const context: AutomationRunContext = {
        runId,
        trigger,
        owner: {
          authz: await scopeForUser(platform.authz, ownerUserId),
          userId: ownerUserId,
        },
        params: current.params,
        summarize: (text) => {
          record.inputSummary = text.slice(0, 4000);
        },
        reference: (references) => {
          record.references = references;
        },
        usedConversation: (sessionId) => {
          if (sessionId) record.sessionId = sessionId;
        },
        markFallback: () => {
          record.fallback = true;
        },
        recordItems: async (entityType, items) => {
          const now = new Date();
          for (const item of items)
            await database
              .query()
              .insertInto('aiTaskRunItems')
              .values({
                id: newId(),
                runId,
                entityType,
                entityId: item.id,
                snapshotHash: item.hash,
                outcome: 'pending',
                outcomeByUserId: null,
                outcomeAt: null,
                createdAt: now,
                updatedAt: now,
              })
              .execute()
              .catch(() => undefined);
        },
      };
      const close = async (values: Record<string, unknown>) => {
        const finishedAt = new Date();
        await database
          .query()
          .updateTable('aiTaskRuns')
          .set({
            inputSummary: record.inputSummary,
            references:
              record.references === null
                ? null
                : JSON.stringify(record.references),
            conversationSessionId: record.sessionId,
            fallback: record.fallback,
            finishedAt,
            updatedAt: finishedAt,
            ...values,
          })
          .where('id', '=', runId)
          .execute();
      };
      try {
        const result = await work(context);
        const status = result.status ?? 'succeeded';
        await close({
          status,
          output: result.output ? JSON.stringify(result.output) : null,
        });
        return { status, runId, output: result.output };
      } catch (error) {
        const message =
          error instanceof HrError
            ? error.code
            : error instanceof Error
              ? error.message
              : String(error);
        await close({ status: 'failed', error: message.slice(0, 4000) });
        return { status: 'failed', runId };
      }
    },

    async due(now) {
      const parts = localParts(now, platform.timeZone);
      const result: { key: string; periodKey: string }[] = [];
      for (const def of AUTOMATIONS) {
        if (
          def.kind !== 'daily' &&
          def.kind !== 'weekly' &&
          def.kind !== 'monthly'
        )
          continue;
        const current = await resolved(def.key);
        if (!current.enabled || current.hour !== parts.hour) continue;
        if (def.kind === 'weekly' && current.weekday !== parts.weekday)
          continue;
        if (def.kind === 'monthly' && current.monthDay !== parts.monthDay)
          continue;
        result.push({
          key: def.key,
          periodKey:
            def.kind === 'monthly'
              ? `schedule:${parts.month}`
              : `schedule:${parts.date}`,
        });
      }
      return result;
    },
  };
  return service;
}
