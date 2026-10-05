/**
 * 工作台 · AI 员工已办完: what the AI employees finished this week for the
 * signed-in user, from the automation run records (`aiTaskRuns`), not from
 * anything kept for display.
 *
 * - Whose: runs of the tasks this user is responsible for (the 负责人 shown in
 *   设置 · AI 员工任务, `ownerUserId`). A task another person owns — the billing
 *   mailbox for payroll01, screening for recruit01 — never shows here.
 * - What: succeeded runs only; skipped and failed ones are not work done.
 * - Shape: grouped by task, with today's and this week's counts (in the
 *   application time zone, the week starting on Monday) and the latest few
 *   runs, each with its own summary line and a link to the record it acted on.
 *
 * - Empty runs are not work done either: a run whose output counts are all
 *   zero (顶班推荐「候选 0 人」, 复审催办 0 人) finished without producing
 *   anything, so it is neither counted nor shown as a group's latest entry.
 *
 * Summary lines are the run's own (`run.summarize`) when they read as a
 * sentence; ones that are only an id get no line and the client words the
 * group from its count.
 */
import type { DatabaseManager } from '@nocobase/db';

import { authorizeAction } from './authorize.js';
import type { ActorContext } from './framework-service.js';
import { addDays, str, today } from './shared.js';
import { zonedInstant } from './leave-duration.js';

export interface AiDoneEntry {
  readonly at: string;
  /** The run's own summary, or null when it is only an id. */
  readonly text: string | null;
  /** The record the run acted on, when there is one. */
  readonly link: string | null;
}

export interface AiDoneGroup {
  readonly task: string;
  readonly employee: string;
  readonly today: number;
  readonly week: number;
  readonly latestAt: string;
  readonly entries: readonly AiDoneEntry[];
}

export interface AiDoneSummary {
  readonly timeZone: string;
  readonly today: number;
  readonly week: number;
  readonly groups: readonly AiDoneGroup[];
}

const ENTRIES_PER_GROUP = 3;
const RUN_LIMIT = 500;

const instant = (value: unknown): number => {
  if (value instanceof Date) return value.getTime();
  const text = str(value);
  // Stored without a zone: the database layer writes UTC.
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/u.test(text) ? text : `${text}Z`);
};

const json = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object')
    return value as Record<string, unknown>;
  if (typeof value !== 'string' || !value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed === 'string') return json(parsed);
    return parsed && typeof parsed === 'object'
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

/**
 * A run's own summary when it reads as a sentence for a person: one that is
 * only a key and an id (`application 1f…`), or that carries an internal id
 * (`继任候选推荐：计划 1b28…`), gets none and the client words the group.
 */
export function aiDoneText(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^[\w.:-]+$/u.test(trimmed)) return null;
  // A UUID, or any run of 12+ hex digits, is an internal id.
  if (/[0-9a-f]{8}-[0-9a-f]{4}-|[0-9a-f]{12,}/iu.test(trimmed)) return null;
  return trimmed;
}

/**
 * A run that produced nothing: its output has counts (numbers or lists) and
 * every one is zero or empty. Outputs without counts — a sorted mail, a
 * drafted reply — always name what they did.
 */
export function aiDoneEmpty(output: Record<string, unknown>): boolean {
  const counts = Object.values(output).filter(
    (value) => typeof value === 'number' || Array.isArray(value),
  );
  return (
    counts.length > 0 &&
    counts.every((value) =>
      Array.isArray(value) ? value.length === 0 : value === 0,
    )
  );
}

const id = (output: Record<string, unknown>, key: string): string | null =>
  typeof output[key] === 'string' && output[key] ? String(output[key]) : null;

/** Where a task's work is looked at when its output names no single record. */
const TASK_PAGES: readonly [prefix: string, path: string][] = [
  ['hrAssistant.compliance', '/talent/compliance'],
  ['hrAssistant.probationPrep', '/talent/workbench'],
  ['hrAssistant.renewalPrep', '/talent/contracts'],
  ['hrAssistant.monthEndCheck', '/talent/attendance'],
  ['hrAssistant.attendanceAnomaly', '/talent/attendance'],
  ['hrAssistant.replacementSuggest', '/talent/schedules'],
  ['hrAssistant.checklistNotes', '/talent/job-events'],
  ['hrAssistant.syncExplain', '/settings/org-sync/issues'],
  ['hrAssistant.importCheck', '/talent/employees'],
  ['hrAssistant.mail', '/talent/mail'],
  ['hrAssistant.workforce', '/talent/workforce-plans'],
  ['hrAssistant.payroll', '/talent/payroll'],
  ['hrAssistant.preboarding', '/talent/offers'],
  ['hrAssistant.newHire', '/talent/workbench'],
  ['recruitingAssistant.mail', '/talent/mail'],
  ['recruitingAssistant', '/talent/candidates'],
  ['vendorReconciler', '/talent/payroll'],
  ['certificationSteward.mail', '/talent/audit'],
  ['certificationSteward', '/talent/certifications'],
  ['talentAnalyst.prePlacement', '/talent/talent-reviews'],
  ['talentAnalyst.success', '/talent/succession'],
  ['talentAnalyst.monthlyReport', '/talent/team-dashboard'],
  ['talentAnalyst.summaryRefresh', '/talent/team-dashboard'],
  ['talentAnalyst.trainingEffectReport', '/talent/training-reports'],
  ['talentAnalyst', '/talent/decisions'],
  ['performanceAssistant.calibration', '/talent/calibration'],
  ['performanceAssistant.deviation', '/talent/calibration'],
  ['performanceAssistant', '/talent/review-cycles'],
  ['learningCoach', '/talent/learning-plans'],
  ['practiceCoach', '/talent/practice-scenarios'],
  ['contentWriter.questionQuality', '/talent/revisions'],
  ['contentWriter', '/talent/courses'],
  ['knowledgeAssistant', '/talent/knowledge'],
  ['frameworkAdvisor', '/talent/framework'],
  ['examiner', '/talent/exams'],
];

/** The page of the record a run acted on, from its output; else the task's page. */
export function aiDoneLink(
  task: string,
  output: Record<string, unknown>,
): string | null {
  const encode = encodeURIComponent;
  const application = id(output, 'applicationId');
  if (application) return `/talent/candidates/${encode(application)}`;
  const interview = id(output, 'interviewId');
  if (interview) return `/talent/interviews/${encode(interview)}`;
  const requisition = id(output, 'requisitionId');
  if (requisition) return `/talent/requisitions/${encode(requisition)}`;
  const bill = id(output, 'billId');
  if (bill) return `/talent/payroll/vendor-bills/${encode(bill)}`;
  const plan = id(output, 'planId');
  if (plan && task.startsWith('hrAssistant.workforce'))
    return `/talent/workforce-plans/${encode(plan)}`;
  if (plan && task.startsWith('talentAnalyst.success'))
    return `/talent/succession/${encode(plan)}`;
  const cycle = id(output, 'cycleId');
  if (cycle && task.startsWith('hrAssistant.payroll'))
    return `/talent/payroll/${encode(cycle)}?tab=anomalies`;
  const review = id(output, 'reviewId');
  if (review && task.startsWith('talentAnalyst.prePlacement'))
    return `/talent/talent-reviews/${encode(review)}`;
  return TASK_PAGES.find(([prefix]) => task.startsWith(prefix))?.[1] ?? null;
}

export function createAiDoneService(deps: {
  readonly database: DatabaseManager;
  readonly timeZone: string;
}) {
  return {
    async summary(ctx: ActorContext): Promise<AiDoneSummary> {
      // The workbench's own permission: whoever may open it sees their AI employees' finished work.
      await authorizeAction(ctx.authz, 'talent.workbench', 'view');
      const date = today(deps.timeZone);
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
      const monday = addDays(date, -((weekday + 6) % 7));
      const dayStart = zonedInstant(date, '00:00', deps.timeZone);
      const weekStart = zonedInstant(monday, '00:00', deps.timeZone);
      const rows = await deps.database
        .query()
        .selectFrom('aiTaskRuns')
        .select(['task', 'employee', 'inputSummary', 'output', 'finishedAt'])
        .where('ownerUserId', '=', ctx.userId)
        .where('status', '=', 'succeeded')
        .where('finishedAt', '>=', new Date(weekStart))
        .orderBy('finishedAt', 'desc')
        .limit(RUN_LIMIT)
        .execute();
      const groups = new Map<
        string,
        {
          task: string;
          employee: string;
          today: number;
          week: number;
          latest: number;
          entries: AiDoneEntry[];
        }
      >();
      let todayCount = 0;
      let week = 0;
      for (const row of rows) {
        const at = instant(row.finishedAt);
        if (!Number.isFinite(at)) continue;
        const output = json(row.output);
        if (aiDoneEmpty(output)) continue;
        const task = str(row.task);
        const group = groups.get(task) ?? {
          task,
          employee: str(row.employee) || task.split('.')[0],
          today: 0,
          week: 0,
          latest: at,
          entries: [],
        };
        group.week += 1;
        week += 1;
        if (at >= dayStart) {
          group.today += 1;
          todayCount += 1;
        }
        group.latest = Math.max(group.latest, at);
        if (group.entries.length < ENTRIES_PER_GROUP)
          group.entries.push({
            at: new Date(at).toISOString(),
            text: aiDoneText(str(row.inputSummary)),
            link: aiDoneLink(task, output),
          });
        groups.set(task, group);
      }
      return {
        timeZone: deps.timeZone,
        today: todayCount,
        week,
        groups: [...groups.values()]
          .sort((a, b) => b.latest - a.latest)
          .map(({ latest, ...g }) => ({
            ...g,
            latestAt: new Date(latest).toISOString(),
          })),
      };
    },
  };
}
