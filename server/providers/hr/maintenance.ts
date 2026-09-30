/**
 * The HR schedules' work in one place, so the scheduler targets and the
 * "run maintenance now" endpoint do the same thing.
 */
import { loggingToken } from '@nocobase/app-server/logging';
import type { ServiceContainer } from '@nocobase/service-provider';

import { runAttendanceTask } from './attendance-tasks.js';
import { scopeForUser } from './authorize.js';

import {
  automationTasksToken,
  certificationServiceToken,
  examServiceToken,
  hrCoreServiceToken,
  insightServiceToken,
  jobEventProcessorToken,
  orgSyncServiceToken,
  knowledgeServiceToken,
  personnelSettingsToken,
  learningServiceToken,
  planServiceToken,
  platformToken,
  practiceServiceToken,
  sessionServiceToken,
  checklistServiceToken,
  // V4-14
  licensedServicesToken,
} from './tokens.js';

/**
 * Daily at 09:00: personnel actions, probation and contract reminders,
 * overdue and due-soon learning, and the certificate lifecycle (recertification,
 * expiring, expired).
 */
export async function runDailyMaintenance(
  container: ServiceContainer,
  options: { asOf?: string } = {},
): Promise<Record<string, number>> {
  const core = await container.resolve(hrCoreServiceToken).runDaily(options);
  // Events whose handler failed when they were written get another try.
  const jobEvents = await container.resolve(jobEventProcessorToken).process();
  // V1-02 变动影响清单: checklists past their due date with items left remind their owner.
  const checklistReminders = await container
    .resolve(checklistServiceToken)
    .remindOverdue(
      (await container.resolve(personnelSettingsToken).read('checklists')).value
        .reminderIntervalDays,
    );
  const certificates = await container
    .resolve(certificationServiceToken)
    .runDaily(options.asOf);
  const learning = await container.resolve(learningServiceToken).runDaily();
  // V1-04: documents whose review date is near or past remind their owners (overdue: HR too).
  const reviews = await container
    .resolve(knowledgeServiceToken)
    .runReviewReminders();
  // Learning plans nobody decided on within 学习规则's expiry days (default 14) expire before the coach looks for new gaps.
  const expiredPlans = await container.resolve(planServiceToken).expireStale();
  // Also run minutely; repeated here so a manual daily run settles finished sessions first.
  const sessions = await container
    .resolve(sessionServiceToken)
    .runMaintenance();
  // V2-05 每天 09:00: the next 14 days' published cells are checked again (cover suggestions for leave conflicts).
  const attendance = await runAttendanceTask(container, 'daily', options);
  // After the lifecycle rules: renewal escalation, learning plans, progress nudges, practice recommendations.
  const automations = await container
    .resolve(automationTasksToken)
    .runAfterDaily();
  const succeeded = (key: string) =>
    automations[key]?.status === 'succeeded' ? 1 : 0;
  return {
    ...core,
    jobEvents,
    checklistReminders,
    reviewReminders: reviews.upcoming + reviews.overdue,
    ...certificates,
    ...learning,
    expiredPlans,
    scheduleConflicts: Number(attendance.notified ?? 0),
    absences: sessions.absent,
    recertEscalation: succeeded('certificationSteward.recertEscalation'),
    learningPlans: succeeded('learningCoach.gapPlans'),
    // V3-09
    learningTargetPlans: succeeded('learningCoach.developmentTargetPlans'),
    progressNudges: succeeded('learningCoach.progressNudge'),
    practiceRecommendations: succeeded('practiceCoach.preExamRecommend'),
  };
}

/**
 * Whether the scheduled daily run should do the day's work now: the local
 * time has reached 人事设置's daily time and today's run has not happened.
 * Claims the day atomically, so overlapping checks run it once.
 */
export async function dailyRunDue(
  container: ServiceContainer,
  timeZone: string,
  at: Date = new Date(),
): Promise<boolean> {
  const { dailyTime } = (
    await container.resolve(personnelSettingsToken).read('reminders')
  ).value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  if (`${get('hour')}:${get('minute')}` < dailyTime) return false;
  const database = container.resolve(platformToken).database;
  const key = `hr-daily-run:${date}`;
  try {
    const stamp = new Date();
    await database
      .query()
      .insertInto('hrReminderLog')
      .values({
        id: `${key}`,
        reminderKey: key,
        sentAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
    return true;
  } catch {
    // The unique reminder key is already taken: today's run happened.
    return false;
  }
}

/**
 * V1-03 定时全量: once a day at 组织同步's fullSyncTime, when a directory is
 * available. Claimed like the daily run, so overlapping checks sync once.
 */
export async function runScheduledOrgSync(
  container: ServiceContainer,
  timeZone: string,
  at: Date = new Date(),
): Promise<boolean> {
  const sync = container.resolve(orgSyncServiceToken);
  const { fullSyncTime } = (await sync.readSettings()).value;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  if (`${get('hour')}:${get('minute')}` < fullSyncTime) return false;
  const key = `org-sync-full:${get('year')}-${get('month')}-${get('day')}`;
  try {
    const stamp = new Date();
    await container
      .resolve(platformToken)
      .database.query()
      .insertInto('hrReminderLog')
      .values({
        id: key,
        reminderKey: key,
        sentAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      })
      .execute();
  } catch {
    return false;
  }
  await sync.run({ mode: 'full', triggeredBy: null });
  return true;
}

/** Every minute: documents still waiting for text extraction, and exam attempts past their deadline. */
export async function runMinuteMaintenance(
  container: ServiceContainer,
): Promise<Record<string, number>> {
  const parsedDocuments = await container
    .resolve(knowledgeServiceToken)
    .parsePending(60_000);
  const submittedAttempts = await container
    .resolve(examServiceToken)
    .autoSubmitExpired();
  // Sessions finished two hours ago record absences; tomorrow's sessions are reminded from 18:00.
  const sessions = await container
    .resolve(sessionServiceToken)
    .runMaintenance();
  const abandonedPractices = await container
    .resolve(practiceServiceToken)
    .abandonIdle();
  // V1-03: incremental syncs' new pending items, explained together once they waited the merge interval.
  await container
    .resolve(automationTasksToken)
    .explainIncrementalSync()
    .catch(() => undefined);
  return {
    parsedDocuments,
    submittedAttempts,
    completedSessions: sessions.completed,
    absences: sessions.absent,
    sessionReminders: sessions.reminded,
    abandonedPractices,
  };
}

/**
 * Weekly, Monday 09:00: the certification steward writes each department
 * head a brief of at most 200 characters about their teams — new
 * certificates this week, certificates expiring within 30 days, expired ones,
 * and people missing a required certification — and sends it as an in-app
 * message. Heads with nothing to report receive nothing. The steward runs as
 * the head, so it sees only the head's teams. Without a configured model the
 * brief is composed from the same facts.
 */
export async function runWeeklyBriefs(
  container: ServiceContainer,
  timeZone: string,
): Promise<{ sent: number; heads: number; fallback: boolean }> {
  const platform = container.resolve(platformToken);
  const insights = container.resolve(insightServiceToken);
  const heads = await platform.database
    .query()
    .selectFrom('departments')
    .select(['managerId'])
    .where('active', '=', true)
    .where('managerId', 'is not', null)
    .execute();
  // One brief per head per ISO week, whichever day the task runs.
  const week = isoWeek(platform.currentDate());
  let sent = 0;
  let fallback = false;
  const headIds = [...new Set(heads.map((h) => String(h.managerId)))];
  for (const userId of headIds) {
    const ctx = { authz: await scopeForUser(platform.authz, userId), userId };
    const found = await insights.weeklyFacts(ctx).catch(() => undefined);
    if (!found) continue;
    // V4-14: people who lost permissions through a certificate this week (industry pack on).
    const facts: WeeklyFacts = {
      ...found,
      lostPermissions: await container
        .resolve(licensedServicesToken)
        .lostThisWeek(ctx, platform.currentDate())
        .catch(() => []),
    };
    if (
      !facts.newThisWeek.length &&
      !facts.expiringSoon.length &&
      !facts.expired.length &&
      !facts.missing.length &&
      !facts.lostPermissions?.length
    )
      continue;
    const written = await aiBrief(container, userId, facts, timeZone);
    if (!written) fallback = true;
    const brief = written ?? composeBrief(facts);
    await platform.notify({
      key: `weeklyBrief:${userId}:${week}`,
      userIds: [userId],
      message: 'weeklyBrief',
      params: { brief },
      path: '/talent/training-reports',
    });
    sent += 1;
  }
  return { sent, heads: headIds.length, fallback };
}

/** The ISO week of a date-only string, such as `2026-W40`. */
function isoWeek(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

type WeeklyFacts = {
  newThisWeek: string[];
  expiringSoon: string[];
  expired: string[];
  missing: string[];
  /** V4-14 */
  lostPermissions?: string[];
};

function composeBrief(facts: WeeklyFacts): string {
  const part = (label: string, items: string[]) =>
    items.length
      ? `${label}${items.length} 人：${items.slice(0, 3).join('、')}${items.length > 3 ? ' 等' : ''}`
      : '';
  const text = [
    part('本周新增持证 ', facts.newThisWeek),
    part('30 天内到期 ', facts.expiringSoon),
    part('已过期 ', facts.expired),
    part('缺必备认证 ', facts.missing),
    // V4-14
    part('本周因证书变化失去权限 ', facts.lostPermissions ?? []),
  ]
    .filter(Boolean)
    .join('；');
  return text.length > 200 ? `${text.slice(0, 199)}…` : text;
}

async function aiBrief(
  container: ServiceContainer,
  userId: string,
  facts: WeeklyFacts,
  timeZone: string,
): Promise<string | undefined> {
  try {
    const { aiConversationsManagerToken, agentServiceFactoryToken } =
      await import('@nocobase/app-plugin-ai-employee/server');
    if (
      !container.has(aiConversationsManagerToken) ||
      !container.has(agentServiceFactoryToken)
    )
      return undefined;
    const { z } = await import('zod');
    const skillSettings = {
      toolsVersion: 1,
      tools: ['listCertificates', 'teamCertificationSummary'],
      skillsVersion: 1,
      skills: [] as string[],
    };
    const conversation = await container
      .resolve(aiConversationsManagerToken)
      .create({
        userId,
        aiEmployee: { username: 'certificationSteward' },
        title: '每周持证简报',
        options: { skillSettings },
      });
    const agent = await container
      .resolve(agentServiceFactoryToken)
      .createAIEmployee({
        username: 'certificationSteward',
        state: { sessionId: conversation.sessionId, timezone: timeZone },
        actor: { id: userId, roles: [], isRoot: false, locale: 'zh-CN' },
        runtime: { logger: container.resolve(loggingToken).getLogger('hr') },
        skillSettings: skillSettings,
      });
    const result = await agent.invoke({
      userMessages: [
        {
          role: 'user',
          // `{ type, content }`: see the note in ai-runner.ts.
          content: {
            type: 'text',
            content: `请根据以下本周持证数据，为我写一份不超过 200 字的持证简报，只使用给出的数据，按到期日排序列名单，不要估算：\n${JSON.stringify(facts)}`,
          },
        },
      ],
      responseFormat: z.object({ brief: z.string() }),
      signal: AbortSignal.timeout(60_000),
    });
    const brief = (
      result.structuredResponse as { brief?: string } | undefined
    )?.brief?.trim();
    return brief ? brief.slice(0, 200) : undefined;
  } catch {
    return undefined;
  }
}
