/**
 * V3-11 AI 员工的主动工作 (总纲 · AI 员工约定): the talent analyst's five
 * jobs, the learning coach filling a training recommendation, and the content
 * writer's version revision and question-quality check.
 *
 * Rules decide everything that matters — which clusters and candidates
 * qualify, who is the audience, which content is affected, who retrains; the
 * AI only words reasons, summaries, reports and suggestions, as structured
 * output validated here. Without a model each job falls back to a template or
 * rule result and the run is marked `fallback`. Every job runs as its owner
 * (hr01 by default); the monthly report runs once as each department head.
 * Run records keep ids and categories, never a quality issue's description.
 */
import { z } from 'zod';

import { AIUnavailableError } from '../ai-runner.js';
import { scopeForUser } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import {
  fragments,
  replacedQuantities,
  replaceQuantity,
  type SectionChange,
} from '../document-changes.js';
import { contentHash, draftHash } from '../draft-snapshots.js';
import { json } from '../platform.js';
import type { RevisionTarget } from '../revision-service.js';
import { HrError, str } from '../shared.js';
import type { AuditService } from './audit.js';
import {
  daysBefore,
  iso,
  isActive,
  type ProfileDeps,
  type ProfileReads,
} from './context.js';
import type { DecisionService, InferenceCandidate } from './decisions.js';
import type { ProfileInsights } from './insights.js';
import type { SignalService } from './signals.js';

export const ANALYST = 'talentAnalyst';
/** 回访 topics (recruiting/config.ts CHECK_IN_TOPICS) as the report names them. */
const TOPIC_LABEL: Record<string, string> = {
  housing: '住宿',
  shuttle: '班车',
  mentoring: '带教',
  schedule: '排班',
  workload: '工作量',
};
export const REPORT_MAX = 300;

type Work = (run: AutomationRunContext) => Promise<{
  status?: 'succeeded' | 'skipped';
  output?: Record<string, unknown>;
}>;

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Replaces what a change replaced: its numbers, and a sentence that changed as a whole. */
export function applyChanges(
  text: string,
  changes: readonly SectionChange[],
  versions: { from: string | null; to: string | null } = {
    from: null,
    to: null,
  },
): string {
  let out = text;
  for (const change of changes) {
    for (const { from, to } of replacedQuantities(change))
      out = replaceQuantity(out, from, to);
    const before = fragments(change.before);
    const after = fragments(change.after);
    before.forEach((fragment, i) => {
      const next = after[i];
      if (!next || next === fragment) return;
      // Only sentences without a replaced number: those are handled above, with their emphasis kept.
      if (
        replacedQuantities({ ...change, before: fragment, after: next }).length
      )
        return;
      out = out.split(fragment).join(next);
    });
  }
  if (versions.from && versions.to)
    out = out.split(versions.from).join(versions.to);
  return out;
}

export function createAnalystWork(input: {
  deps: ProfileDeps;
  reads: ProfileReads;
  signals: SignalService;
  decisions: DecisionService;
  insights: ProfileInsights;
  audit: AuditService;
}) {
  const { deps, reads, signals, decisions, insights } = input;
  const { platform } = deps;
  const { database, notify, organization } = platform;

  async function structured<T>(
    run: AutomationRunContext,
    employee: string,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
    userId = run.owner.userId,
  ): Promise<T> {
    const { data, sessionId } = await deps.ai.structured({
      employee,
      userId,
      title,
      prompt,
      schema,
      timeZone: platform.timeZone,
    });
    run.usedConversation(sessionId);
    return data;
  }

  /** The AI's result, or the rule-based one when no model is available. */
  async function attempt<T>(
    run: AutomationRunContext,
    compose: () => Promise<T | undefined>,
    fallback: () => T | Promise<T>,
  ): Promise<T> {
    try {
      const value = await compose();
      if (value !== undefined) return value;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
    }
    run.markFallback();
    return fallback();
  }

  // ---------- 专项培训检查 ----------

  function recommendationReasonTemplate(
    cluster: Awaited<ReturnType<DecisionService['clusters']>>[number],
    windowDays: number,
  ): string {
    const categories = [
      ...new Set(cluster.signals.map((s) => s.category).filter(Boolean)),
    ];
    const refs = [
      ...new Set(
        cluster.signals.map((s) => s.correctiveActionRef).filter(Boolean),
      ),
    ];
    const shifts = cluster.signals.filter((s) => s.shift).map((s) => s.shift);
    return [
      `${cluster.departmentTitle}近 ${windowDays} 天内发生 ${cluster.signals.length} 起与“${cluster.competencyTitle}”相关的质量问题（${cluster.signals.map((s) => s.externalId).join('、')}）${categories.length ? `，均为“${categories.join('、')}”类` : ''}。`,
      refs.length ? `相关 8D 报告：${refs.join('、')}。` : '',
      shifts.length
        ? `其中 ${shifts.length} 起发生在${[...new Set(shifts)].join('、')}。`
        : '',
      '建议主管考虑为车间要求该能力项的员工安排一次专项培训；是否安排由主管决定。',
    ]
      .filter(Boolean)
      .join('');
  }

  const trainingCheck =
    (signalIds: readonly string[] = []): Work =>
    async (run) => {
      const params = {
        clusterWindowDays: num(run.params.clusterWindowDays, 90),
        clusterMinCount: num(run.params.clusterMinCount, 2),
      };
      const clusters = await decisions.clusters(params);
      run.summarize(
        `触发记录 ${signalIds.length} 条；${clusters.length} 个部门 × 能力项组合达到 ${params.clusterWindowDays} 天 ≥ ${params.clusterMinCount} 起`,
      );
      run.reference({
        signalIds,
        clusters: clusters.map((c) => ({
          departmentId: c.departmentId,
          competencyId: c.competencyId,
          signalIds: c.signals.map((s) => s.id),
        })),
      });
      if (!clusters.length)
        return { status: 'skipped', output: { created: 0 } };
      const created: string[] = [];
      for (const cluster of clusters) {
        const reason = await attempt(
          run,
          async () =>
            (
              await structured(
                run,
                ANALYST,
                '专项培训检查',
                `为下列质量问题聚集起草一条专项培训建议的原因（120 字以内）。只写事实：数量、类别、8D 编号；措辞用“建议主管考虑”；不评价个人，不写问题描述原文。\n${JSON.stringify(
                  {
                    department: cluster.departmentTitle,
                    competency: cluster.competencyTitle,
                    windowDays: params.clusterWindowDays,
                    signals: cluster.signals.map((s) => ({
                      externalId: s.externalId,
                      category: s.category,
                      severity: s.severity,
                      occurredAt: s.occurredAt.slice(0, 10),
                      correctiveActionRef: s.correctiveActionRef,
                      shift: s.shift,
                    })),
                  },
                )}`,
                z.object({ reason: z.string().min(10).max(600) }),
              )
            ).reason,
          () => recommendationReasonTemplate(cluster, params.clusterWindowDays),
        );
        try {
          const id = await decisions.createRecommendation({
            departmentId: cluster.departmentId,
            competencyId: cluster.competencyId,
            reason,
            signalIds: cluster.signals.map((s) => s.id),
            params,
            fallbackReviewer: run.owner.userId,
          });
          created.push(id);
          await run.recordItems('trainingRecommendation', [{ id, hash: null }]);
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
        }
      }
      for (const id of created)
        deps.background('learningCoach.recommendationItems', () =>
          tasks.onRecommendationCreated(id),
        );
      return {
        output: { created: created.length, recommendationIds: created },
      };
    };

  // ---------- 学习教练：配训练内容 ----------

  const recommendationItems =
    (recommendationId: string): Work =>
    async (run) => {
      const row = await database
        .query()
        .selectFrom('trainingRecommendations')
        .selectAll()
        .where('id', '=', recommendationId)
        .executeTakeFirst();
      if (!row || row.status !== 'drafting') return { status: 'skipped' };
      const evidence = json<{ summary?: string }[]>(row.evidence, []);
      const competency = (await reads.competencies()).get(
        str(row.competencyId),
      );
      const keywords = [
        ...new Set(
          evidence
            .flatMap((e) => (e.summary ?? '').split(' · '))
            .filter((k) => k && !['minor', 'major', 'critical'].includes(k)),
        ),
      ];
      const offered = await decisions.contentFor(
        str(row.competencyId),
        keywords,
      );
      const maxItems = Math.min(num(run.params.maxItems, 4), 4);
      run.summarize(
        `建议 ${recommendationId}：能力项 ${competency?.title ?? ''}；可选课程 ${offered.courses.length}、陪练 ${offered.practices.length}、考试 ${offered.exams.length}`,
      );
      const picks = await attempt(
        run,
        async () => {
          if (
            !offered.courses.length &&
            !offered.practices.length &&
            !offered.exams.length
          )
            return [];
          const data = await structured(
            run,
            'learningCoach',
            '专项培训配训练内容',
            `为一条专项培训建议选择 2–${maxItems} 项培训内容：优先与问题类别（${keywords.join('、') || '无'}）相关的课程和陪练场景，最后一项是考试。只能从下列候选中选择，按 id 引用。\n${JSON.stringify(
              {
                competency: competency?.title,
                courses: offered.courses.map(({ id, title }) => ({
                  id,
                  title,
                })),
                practices: offered.practices.map(({ id, title }) => ({
                  id,
                  title,
                })),
                exams: offered.exams.map(({ id, title }) => ({ id, title })),
              },
            )}`,
            z.object({
              items: z
                .array(
                  z.object({
                    type: z.enum(['course', 'practice', 'exam']),
                    id: z.string(),
                  }),
                )
                .max(4),
            }),
          );
          return data.items;
        },
        () => {
          const out: { type: string; id: string }[] = [];
          const course = offered.courses[0];
          if (course) out.push(course);
          const practice = offered.practices[0];
          if (practice) out.push(practice);
          if (
            out.length < maxItems - 1 &&
            offered.courses[1] &&
            offered.courses[1].score > 0
          )
            out.push(offered.courses[1]);
          const exam = offered.exams[0];
          if (exam) out.push(exam);
          return out.slice(0, maxItems);
        },
      );
      const result = await decisions.fillItems({
        recommendationId,
        items: picks,
        dueWorkingDays: num(run.params.dueWorkingDays, 10),
        note: null,
      });
      const view = await decisions.recommendationView(
        (await database
          .query()
          .selectFrom('trainingRecommendations')
          .selectAll()
          .where('id', '=', recommendationId)
          .executeTakeFirst())!,
      );
      await notify({
        key: `recommendation:${recommendationId}:pending`,
        userIds: [view.reviewerUserId],
        message: 'trainingRecommendationPending',
        params: {
          department: view.departmentTitle,
          competency: view.competencyTitle,
          count: String(view.audience.length),
        },
        path: `/talent/decisions?tab=recommendations&id=${recommendationId}`,
      });
      if (result.needsContent)
        await notify({
          key: `recommendation:${recommendationId}:needsContent`,
          userIds: [run.owner.userId],
          message: 'trainingRecommendationNeedsContent',
          params: {
            department: view.departmentTitle,
            competency: view.competencyTitle,
          },
          path: `/talent/decisions?tab=recommendations&id=${recommendationId}`,
        });
      return {
        output: {
          items: result.items.length,
          needsContent: result.needsContent,
        },
      };
    };

  // ---------- 能力等级建议 ----------

  function rationaleTemplate(
    candidate: InferenceCandidate,
    windowDays: number,
  ): string {
    if (candidate.direction === 'down')
      return [
        `近 ${windowDays} 天内有 ${candidate.evidence.length} 起与“${candidate.competencyTitle}”相关的 major 及以上质量问题（${candidate.evidence.map((e) => e.summary.split(' ')[0]).join('、')}）`,
        candidate.categories.length
          ? `，共同点是均为“${candidate.categories.join('、')}”类问题`
          : '',
        `。建议主管关注，并考虑将等级由 ${candidate.currentLevel} 级调整为 ${candidate.suggestedLevel} 级。`,
        `也可能存在非个人原因（如设备、排班${candidate.shifts.length ? `、${candidate.shifts.join('、')}——其中有问题发生在${candidate.shifts.join('、')}` : '、夜班'}），请主管结合现场情况判断。`,
      ].join('');
    return [
      `“${candidate.competencyTitle}”当前 ${candidate.currentLevel} 级，低于${candidate.requiredLevel !== null ? `要求的 ${candidate.requiredLevel} 级` : '要求'}。`,
      `依据：${candidate.evidence.map((e) => e.summary).join('；')}。`,
      `建议主管考虑将等级由 ${candidate.currentLevel} 级调整为 ${candidate.suggestedLevel} 级；是否调整由主管决定，建议本身不改变岗位。`,
    ].join('');
  }

  const levelSuggestions: Work = async (run) => {
    const rules = {
      windowDays: num(run.params.windowDays, 180),
      downgradeMinIssues: num(run.params.downgradeMinIssues, 2),
      upgradeExamPercent: num(run.params.upgradeExamPercent, 90),
      upgradeMinDelivered: num(run.params.upgradeMinDelivered, 2),
    };
    const candidates = await decisions.inferenceCandidates(rules);
    run.summarize(
      `候选 ${candidates.length} 条（规则：${JSON.stringify(rules)}）`,
    );
    run.reference(
      candidates.map((c) => ({
        employeeId: c.employeeId,
        competencyId: c.competencyId,
        evidence: c.evidence.map((e) => ({ type: e.type, id: e.id })),
      })),
    );
    if (!candidates.length)
      return { status: 'skipped', output: { created: 0 } };
    const created: {
      id: string;
      reviewer: string;
      name: string;
      competency: string;
      from: number;
      to: number;
    }[] = [];
    for (const candidate of candidates) {
      const rationale = await attempt(
        run,
        async () =>
          await structured(
            run,
            ANALYST,
            '能力等级建议',
            `核对证据后为下列能力等级建议写理由（150 字以内）。措辞用“建议主管关注/考虑”；一起问题不足以说明能力问题；建议降级时说明问题的共同点，并提示可能的非个人原因（如设备、排班、夜班）；不评价性格与态度；只引用给出的证据。证据不足时 skip 为 true。\n${JSON.stringify(candidate)}`,
            z.object({
              skip: z.boolean().default(false),
              rationale: z.string().max(800).default(''),
            }),
          ),
        () => ({
          skip: false,
          rationale: rationaleTemplate(candidate, rules.windowDays),
        }),
      );
      if (rationale.skip || !rationale.rationale.trim()) continue;
      try {
        const id = await decisions.createSuggestion({
          employeeId: candidate.employeeId,
          competencyId: candidate.competencyId,
          suggestedLevel: candidate.suggestedLevel,
          rationale: rationale.rationale,
          evidence: candidate.evidence,
          fallbackReviewer: run.owner.userId,
        });
        const row = await database
          .query()
          .selectFrom('competencySuggestions')
          .select(['reviewerUserId'])
          .where('id', '=', id)
          .executeTakeFirst();
        created.push({
          id,
          reviewer: str(row?.reviewerUserId),
          name: candidate.employeeName,
          competency: candidate.competencyTitle,
          from: candidate.currentLevel,
          to: candidate.suggestedLevel,
        });
        await run.recordItems('competencySuggestion', [{ id, hash: null }]);
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
      }
    }
    for (const reviewer of new Set(created.map((c) => c.reviewer))) {
      const own = created.filter((c) => c.reviewer === reviewer);
      await notify({
        key: `competencySuggestions:${run.runId}:${reviewer}`,
        userIds: [reviewer],
        message: 'competencySuggestionDrafted',
        params: {
          count: String(own.length),
          list: own
            .slice(0, 3)
            .map((c) => `${c.name}“${c.competency}”${c.from}→${c.to}`)
            .join('、'),
        },
        path: '/talent/decisions?tab=suggestions',
      });
    }
    return {
      output: {
        created: created.length,
        suggestions: created.map((c) => c.id),
      },
    };
  };

  // ---------- 月度团队报告 ----------

  /** New hires' 30-day attrition by shift, as group numbers only. */
  async function retention(
    employeeIds: readonly string[],
    months: number,
    windowDays: number,
  ) {
    const people = await reads.people(employeeIds);
    const today = platform.currentDate();
    const since = new Date(`${today}T00:00:00Z`);
    since.setUTCMonth(since.getUTCMonth() - months);
    const cohort = people.filter(
      (p) => p.hireDate && new Date(`${p.hireDate}T00:00:00Z`) >= since,
    );
    if (!cohort.length) return null;
    const ids = cohort.map((p) => p.id);
    const offboards = await database
      .query()
      .selectFrom('jobEvents')
      .select(['employeeId', 'effectiveDate'])
      .where('employeeId', 'in', ids)
      .where('eventType', '=', 'offboard')
      .execute();
    const schedules = await database
      .query()
      .selectFrom('shiftSchedules')
      .innerJoin('shifts', 'shifts.id', 'shiftSchedules.shiftId')
      .select([
        'shiftSchedules.employeeId as employeeId',
        'shiftSchedules.date as date',
        'shifts.isNight as isNight',
      ])
      .where('shiftSchedules.employeeId', 'in', ids)
      .execute();
    const groups = new Map<string, { hired: number; left: number }>();
    for (const person of cohort) {
      const own = schedules.filter(
        (s) =>
          str(s.employeeId) === person.id &&
          str(s.date).slice(0, 10) <=
            addDaysLocal(person.hireDate!, windowDays),
      );
      const night = own.filter(
        (s) => s.isNight === true || s.isNight === 1,
      ).length;
      const label = !own.length
        ? '未排班'
        : night * 2 >= own.length
          ? '夜班'
          : '白班';
      const left = offboards.some((o) => {
        if (str(o.employeeId) !== person.id) return false;
        const date = str(o.effectiveDate).slice(0, 10);
        return (
          date >= person.hireDate! &&
          date <= addDaysLocal(person.hireDate!, windowDays)
        );
      });
      const group = groups.get(label) ?? { hired: 0, left: 0 };
      group.hired += 1;
      if (left) group.left += 1;
      groups.set(label, group);
    }
    // V2-07 新员工回访: how many check-ins of the cohort raised each topic (topics only, never the reply).
    const checkIns = await database
      .query()
      .selectFrom('newHireCheckIns')
      .select(['answers', 'issues'])
      .where('employeeId', 'in', ids)
      .execute();
    const topicCounts = new Map<string, number>();
    for (const checkIn of checkIns) {
      const topics = new Set(
        [
          ...json<{ topic?: string }[]>(checkIn.answers, []),
          ...json<{ topic?: string }[]>(checkIn.issues, []),
        ]
          .map((a) => a.topic)
          .filter((t): t is string => Boolean(t) && t !== 'other'),
      );
      for (const topic of topics)
        topicCounts.set(topic, (topicCounts.get(topic) ?? 0) + 1);
    }
    return {
      hired: cohort.length,
      groups: [...groups].map(([shift, g]) => ({
        shift,
        hired: g.hired,
        left: g.left,
        rate: Math.round((g.left / g.hired) * 100),
      })),
      topics: [...topicCounts]
        .map(([topic, count]) => ({
          topic: TOPIC_LABEL[topic] ?? topic,
          count,
        }))
        .sort((a, b) => b.count - a.count),
    };
  }

  function addDaysLocal(date: string, days: number): string {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  async function reportFacts(
    ctx: { authz: AutomationRunContext['owner']['authz']; userId: string },
    params: {
      newHireMonths: number;
      retentionDays: number;
      retentionMinHires: number;
    },
  ) {
    const dashboard = await insights.dashboard(ctx, {});
    const count = (state: string) =>
      dashboard.certMatrix.rows.reduce(
        (n, r) => n + r.cells.filter((c) => c.state === state).length,
        0,
      );
    const gaps = dashboard.heatmap.rows.filter((r) =>
      r.cells.some((c) => (c.gap ?? 0) > 0),
    ).length;
    const month = dashboard.trend.months.at(-1)!;
    const last = dashboard.trend.months.at(-2)!;
    const total = (m: string) =>
      dashboard.trend.series.reduce(
        (n, s) => n + (s.counts[dashboard.trend.months.indexOf(m)] ?? 0),
        0,
      );
    const suggestions = await database
      .query()
      .selectFrom('competencySuggestions')
      .select([
        'employeeId',
        'competencyId',
        'currentLevel',
        'suggestedLevel',
        'status',
        'decidedLevel',
        'reviewedAt',
      ])
      .where('reviewerUserId', '=', ctx.userId)
      .execute();
    const thisMonth = platform.currentDate().slice(0, 7);
    // Waiting for a decision, or decided this month.
    const inMonth = (value: unknown) =>
      (iso(value) ?? '').startsWith(thisMonth);
    const recommendations = await database
      .query()
      .selectFrom('trainingRecommendations')
      .select(['departmentId', 'competencyId', 'status', 'completedAt'])
      .where('reviewerUserId', '=', ctx.userId)
      .where('status', 'in', ['draft', 'approved', 'completed'])
      .execute();
    const competencies = await reads.competencies();
    const people = new Map(
      (await reads.people(suggestions.map((s) => str(s.employeeId)))).map(
        (p) => [p.id, p.name],
      ),
    );
    const visible = await database
      .query()
      .selectFrom('employees')
      .select(['id', 'departmentId'])
      .execute();
    const managed = new Set(await organization.managedDepartments(ctx.userId));
    const scope = managed.size
      ? visible
          .filter((v) => managed.has(str(v.departmentId)))
          .map((v) => str(v.id))
      : visible.map((v) => str(v.id));
    const cohort = await retention(
      scope,
      params.newHireMonths,
      params.retentionDays,
    );
    // Too few hires make a rate meaningless: below the administrator's minimum the section is left out.
    const retentionFacts =
      cohort && cohort.hired >= params.retentionMinHires ? cohort : null;
    const decided: Record<string, string> = {
      accepted: '已采纳',
      rejected: '已驳回',
      expired: '已过期',
    };
    const pendingSuggestions = [];
    for (const s of suggestions) {
      if (
        s.status !== 'draft' &&
        !(decided[str(s.status)] && inMonth(s.reviewedAt))
      )
        continue;
      pendingSuggestions.push(
        `${people.get(str(s.employeeId)) ?? ''}“${competencies.get(str(s.competencyId))?.title ?? ''}”${Number(s.currentLevel)}→${Number(s.suggestedLevel)}${s.status === 'draft' ? '（待处理）' : `（${decided[str(s.status)]}${s.decidedLevel != null ? `，定为 ${Number(s.decidedLevel)} 级` : ''}）`}`,
      );
    }
    const pendingRecommendations = [];
    for (const r of recommendations) {
      if (r.status === 'completed' && !inMonth(r.completedAt)) continue;
      pendingRecommendations.push(
        `${await deps.departmentTitle(str(r.departmentId))}“${competencies.get(str(r.competencyId))?.title ?? ''}”专项培训（${r.status === 'draft' ? '待确认' : r.status === 'approved' ? '进行中' : '本月已完成'}）`,
      );
    }
    return {
      people: dashboard.people,
      certificates: {
        expiring: count('expiring'),
        expired: count('expired'),
        missing: count('missing'),
      },
      peopleWithGaps: gaps,
      problems: { thisMonth: total(month), lastMonth: total(last) },
      pendingSuggestions,
      pendingRecommendations,
      retention: retentionFacts,
    };
  }

  function reportTemplate(
    facts: Awaited<ReturnType<typeof reportFacts>>,
    scopeLabel: string,
  ): string {
    const parts: string[] = [`${scopeLabel}月度团队能力报告：`];
    const c = facts.certificates;
    if (c.expiring || c.expired || c.missing)
      parts.push(
        `持证风险：即将到期 ${c.expiring} 张、已过期 ${c.expired} 张、缺失 ${c.missing} 张。`,
      );
    if (facts.peopleWithGaps)
      parts.push(`${facts.peopleWithGaps} 人仍有岗位能力差距。`);
    if (facts.problems.thisMonth || facts.problems.lastMonth)
      parts.push(
        `问题记录本月 ${facts.problems.thisMonth} 条，上月 ${facts.problems.lastMonth} 条。`,
      );
    if (facts.pendingRecommendations.length)
      parts.push(
        `专项培训建议：${facts.pendingRecommendations.slice(0, 2).join('、')}。`,
      );
    if (facts.pendingSuggestions.length)
      parts.push(
        `能力等级建议：${facts.pendingSuggestions.slice(0, 3).join('、')}。`,
      );
    const r = facts.retention;
    if (r && r.groups.length)
      parts.push(
        `近 6 个月入职 ${r.hired} 人，新人 30 天流失率：${r.groups
          .filter((g) => g.shift !== '未排班' || r.groups.length === 1)
          .sort((a, b) => b.rate - a.rate)
          .map((g) => `${g.shift} ${g.rate}%`)
          .join(
            '，',
          )}${r.topics.length ? `；回访中“${r.topics[0].topic}”被提到 ${r.topics[0].count} 次` : ''}。`,
      );
    let text = parts.join('');
    if (text.length > REPORT_MAX) text = `${text.slice(0, REPORT_MAX - 1)}…`;
    return text;
  }

  function needsAttention(
    facts: Awaited<ReturnType<typeof reportFacts>>,
  ): boolean {
    const c = facts.certificates;
    return Boolean(
      c.expiring ||
      c.expired ||
      c.missing ||
      facts.pendingSuggestions.length ||
      facts.pendingRecommendations.length ||
      facts.problems.thisMonth ||
      facts.retention?.groups.some((g) => g.left > 0),
    );
  }

  const monthlyReport: Work = async (run) => {
    const month = platform.currentDate().slice(0, 7);
    const params = {
      newHireMonths: num(run.params.newHireMonths, 6),
      retentionDays: num(run.params.retentionDays, 30),
      retentionMinHires: num(run.params.retentionMinHires, 10),
    };
    const heads = new Set<string>();
    for (const department of await organization.listTree())
      if (department.active && department.managerId)
        heads.add(department.managerId);
    const reports: { userId: string; sent: boolean; text: string | null }[] =
      [];
    for (const head of heads) {
      const ctx = {
        authz: await scopeForUser(platform.authz, head),
        userId: head,
      };
      let facts;
      try {
        facts = await reportFacts(ctx, params);
      } catch (error) {
        if (error instanceof HrError && error.status === 403) continue;
        throw error;
      }
      if (!needsAttention(facts)) {
        reports.push({ userId: head, sent: false, text: null });
        continue;
      }
      const managed = await organization.headedBy(head);
      const scopeLabel = (
        await Promise.all(managed.map((id) => deps.departmentTitle(id)))
      ).join('、');
      const text = await attempt(
        run,
        async () => {
          const data = await structured(
            run,
            ANALYST,
            '月度团队报告',
            `以部门负责人的视角写一份不超过 ${REPORT_MAX} 字的月度团队能力报告：持证风险、能力差距、问题记录趋势、待处理的建议；有新人流失数据时写群体数字（按班次对比），不点名个人，不写质量问题描述原文。数字直接用下列数据，不估算。\n${JSON.stringify({ scope: scopeLabel, ...facts })}`,
            z.object({ report: z.string().min(10).max(REPORT_MAX) }),
            head,
          );
          return data.report;
        },
        () => reportTemplate(facts, scopeLabel),
      );
      const sent = await platform.reminderOnce(
        `talentReport:${month}:${head}`,
        () =>
          notify({
            key: `talentReport:${month}:${head}`,
            userIds: [head],
            message: 'talentMonthlyReport',
            params: { month, text },
            path: '/talent/team-dashboard',
          }),
      );
      reports.push({ userId: head, sent, text });
    }
    // The owner (hr01) receives the company-wide summary.
    const ownerFacts = await reportFacts(run.owner, params);
    const companyText = await attempt(
      run,
      async () =>
        (
          await structured(
            run,
            ANALYST,
            '月度团队报告 · 全公司',
            `写一份不超过 ${REPORT_MAX} 字的全公司月度能力报告，要求同部门报告，不点名个人。\n${JSON.stringify(ownerFacts)}`,
            z.object({ report: z.string().min(10).max(REPORT_MAX) }),
          )
        ).report,
      () => reportTemplate(ownerFacts, '全公司'),
    );
    const companySent = needsAttention(ownerFacts)
      ? await platform.reminderOnce(
          `talentReport:${month}:company:${run.owner.userId}`,
          () =>
            notify({
              key: `talentReport:${month}:company:${run.owner.userId}`,
              userIds: [run.owner.userId],
              message: 'talentMonthlyReportCompany',
              params: { month, text: companyText },
              path: '/talent/team-dashboard',
            }),
        )
      : false;
    run.summarize(
      `负责人 ${heads.size} 位；发送 ${reports.filter((r) => r.sent).length} 份`,
    );
    return {
      output: {
        month,
        reports,
        company: { sent: companySent, text: companyText },
      },
    };
  };

  // ---------- 画像摘要 ----------

  /** One employee's summary: the analyst's wording checked against the facts, or the template. */
  async function summarize(
    run: AutomationRunContext | null,
    employeeId: string,
    userId: string,
  ) {
    const employee = (await reads.people([employeeId]))[0];
    if (!employee) throw new HrError('EMPLOYEE_NOT_FOUND', 404);
    const facts = await insights.facts(employee);
    const compose = async () => {
      const { data, sessionId } = await deps.ai.structured({
        employee: ANALYST,
        userId,
        title: '画像摘要',
        prompt: `为员工写画像摘要，总共不超过 150 字：先讲持证和岗位匹配，再讲近期变化；只写数量和类别，不写业务数据的描述原文；每句话都要引用下列事实的 id（evidenceIds）。\n${JSON.stringify({ name: employee.name, facts: facts.map((f) => ({ id: f.id, type: f.type, label: f.label })) })}`,
        schema: z.object({
          sentences: z
            .array(
              z.object({
                text: z.string().min(2).max(150),
                evidenceIds: z.array(z.string()).min(1),
              }),
            )
            .min(1)
            .max(5),
        }),
        timeZone: platform.timeZone,
      });
      run?.usedConversation(sessionId);
      return insights.saveSummary(employee.id, data.sentences, facts);
    };
    try {
      return { sentences: await compose(), fallback: false };
    } catch (error) {
      if (!(error instanceof AIUnavailableError) && !(error instanceof HrError))
        throw error;
      run?.markFallback();
      return {
        sentences: await insights.generateTemplate(employee.id),
        fallback: true,
      };
    }
  }

  const summaryRefresh: Work = async (run) => {
    const ids = await insights.employeesWithNewData(
      num(run.params.lookbackDays, 7),
    );
    run.summarize(
      `过去 ${num(run.params.lookbackDays, 7)} 天有新数据的在职员工 ${ids.length} 人`,
    );
    run.reference({ employeeIds: ids });
    if (!ids.length) return { status: 'skipped', output: { refreshed: 0 } };
    for (const id of ids) await summarize(run, id, run.owner.userId);
    return { output: { refreshed: ids.length, employeeIds: ids } };
  };

  // ---------- 匹配规则起草 ----------

  function bigrams(text: string): Set<string> {
    const clean = text.replace(/\s/gu, '');
    const out = new Set<string>();
    for (let i = 0; i < clean.length - 1; i += 1)
      out.add(clean.slice(i, i + 2));
    return out;
  }

  const ruleDrafting: Work = async (run) => {
    const categories = await signals.unmatchedCategories();
    run.summarize(`没有匹配规则的分类 ${categories.length} 个`);
    if (!categories.length)
      return { status: 'skipped', output: { drafted: 0 } };
    const competencies = [...(await reads.competencies()).values()].filter(
      (c) => c.active && c.confirmed,
    );
    const drafted: { id: string; category: string; competency: string }[] = [];
    for (const group of categories) {
      const pick = await attempt(
        run,
        async () => {
          const data = await structured(
            run,
            ANALYST,
            '匹配规则起草',
            `来源系统的分类“${group.category}”（${group.sourceSystem}）应对应哪个能力项？按分类与能力项的描述判断；没有合适的返回空字符串。\n${JSON.stringify({ titles: group.titles, competencies: competencies.map((c) => ({ id: c.id, title: c.title, description: c.description.slice(0, 120) })) })}`,
            z.object({
              competencyId: z.string(),
              note: z.string().max(300).default(''),
            }),
          );
          return competencies.some((c) => c.id === data.competencyId)
            ? data
            : { competencyId: '', note: '' };
        },
        () => {
          const target = bigrams(`${group.category} ${group.titles.join(' ')}`);
          let best: { id: string; score: number; title: string } | null = null;
          for (const c of competencies) {
            const grams = bigrams(`${c.title}${c.description}`);
            let shared = 0;
            for (const g of target) if (grams.has(g)) shared += 1;
            if (shared && (!best || shared > best.score))
              best = { id: c.id, score: shared, title: c.title };
          }
          return {
            competencyId: best?.id ?? '',
            note: best
              ? `按分类“${group.category}”与能力项“${best.title}”的描述相近起草（规则匹配），请确认。`
              : '',
          };
        },
      );
      if (!pick.competencyId) continue;
      const id = await signals.draftRule({
        sourceSystem: group.sourceSystem,
        category: group.category,
        competencyId: pick.competencyId,
        note: pick.note || null,
        userId: run.owner.userId,
      });
      if (!id) continue;
      await run.recordItems('signalRule', [{ id, hash: null }]);
      drafted.push({
        id,
        category: group.category,
        competency:
          competencies.find((c) => c.id === pick.competencyId)?.title ?? '',
      });
    }
    if (drafted.length)
      await notify({
        key: `signalRules:${run.runId}`,
        userIds: [run.owner.userId],
        message: 'signalRuleDrafted',
        params: {
          count: String(drafted.length),
          list: drafted
            .map((d) => `“${d.category}”→${d.competency}`)
            .join('、'),
        },
        path: '/talent/signals?tab=unmatched',
      });
    return {
      output: { drafted: drafted.length, rules: drafted.map((d) => d.id) },
    };
  };

  // ---------- 内容编写员：升版修订 ----------

  function changeNoteTemplate(changes: readonly SectionChange[]): string {
    return changes
      .map((c) => {
        const quantities = replacedQuantities(c).map(
          (q) => `${q.from.text} → ${q.to.text}`,
        );
        if (c.changeType === 'added') return `${c.sectionTitle}：新增。`;
        if (c.changeType === 'removed') return `${c.sectionTitle}：删除。`;
        return `${c.sectionTitle}：${quantities.length ? quantities.join('，') : `由“${fragments(c.before)[0] ?? ''}”改为“${fragments(c.after)[0] ?? ''}”`}。`;
      })
      .join('\n');
  }

  function briefTemplate(
    changes: readonly SectionChange[],
    version: string | null,
  ) {
    const lessons = changes.map((c) => {
      const quantities = replacedQuantities(c).map(
        (q) => `${q.from.text}改为${q.to.text}`,
      );
      return {
        title: `${c.sectionTitle}${quantities.length ? `：${quantities.join('，')}` : c.changeType === 'added' ? '（新增）' : c.changeType === 'removed' ? '（删除）' : ''}`,
        sectionTitle: c.sectionTitle,
        content: [
          '## 原来怎么做',
          c.before ?? '（新增条款，原来没有要求）',
          '',
          '## 现在怎么做',
          c.after ?? '（本条已删除）',
          '',
          '## 为什么要注意',
          quantities.length
            ? `${quantities.join('，')}。按老习惯操作会违反${version ?? '新版'}的要求。`
            : `这一条的做法变了，按${version ?? '新版'}执行，不再按原来的做法。`,
        ].join('\n'),
      };
    });
    const questions = changes
      .slice(0, 3)
      .map(
        (c, i) =>
          `${i + 1}. 按${version ?? '新版'}，“${c.sectionTitle}”现在怎么要求？\n   参考答案：${fragments(c.after)[0] ?? '见原文'}`,
      );
    while (questions.length < 3 && changes.length)
      questions.push(
        `${questions.length + 1}. ${changes[0].sectionTitle}与原来相比有什么不同？\n   参考答案：${changeNoteTemplate([changes[0]])}`,
      );
    lessons.push({
      title: '自测',
      sectionTitle: '',
      content: `## 自测题（3 道，不进题库）\n\n${questions.join('\n\n')}`,
    });
    return lessons;
  }

  /** Rule proposals for affected content: numbers replaced, a changed sentence rewritten, answers moved with them. */
  function ruleProposals(
    affected: Awaited<
      ReturnType<ReturnType<ProfileDeps['revisions']>['findAffected']>
    >,
    changes: readonly SectionChange[],
    versions: { from: string | null; to: string | null },
  ) {
    const items: {
      targetType: RevisionTarget;
      targetId: string;
      sectionTitle: string;
      proposed: Record<string, unknown>;
      explanation: string;
    }[] = [];
    const touching = (sections: string[]) =>
      changes.filter((c) => sections.includes(c.sectionTitle));
    const cite = (list: SectionChange[]) =>
      `依据${versions.to ?? '新版本'}原文：${list.map((c) => `${c.sectionTitle}“${fragments(c.after)[0] ?? '（已删除）'}”`).join('；')}`;
    for (const lesson of affected.lessons) {
      const list = touching(lesson.sections);
      const content = applyChanges(lesson.content, list, versions);
      const excerpt = lesson.sourceExcerpt
        ? applyChanges(lesson.sourceExcerpt, list, versions)
        : null;
      if (content === lesson.content && excerpt === lesson.sourceExcerpt)
        continue;
      items.push({
        targetType: 'lesson',
        targetId: lesson.id,
        sectionTitle: list.map((c) => c.sectionTitle).join('、'),
        proposed: {
          content,
          ...(excerpt !== lesson.sourceExcerpt
            ? { sourceExcerpt: excerpt }
            : {}),
        },
        explanation: `只改与变更相关的句子。${cite(list)}`,
      });
    }
    for (const question of affected.questions) {
      const list = touching(question.sections);
      const proposed: Record<string, unknown> = {};
      const pairs = list.flatMap((c) => replacedQuantities(c));
      const options = Array.isArray(question.options)
        ? (question.options as { key: string; text: string }[])
        : [];
      if (options.length && typeof question.answer === 'string') {
        // The correct option quoted the old number: the option with the new number becomes the answer.
        const correct = options.find((o) => o.key === question.answer);
        const flat = (text: string) => text.replace(/\s/gu, '');
        for (const pair of pairs)
          if (correct && flat(correct.text).includes(flat(pair.from.text))) {
            const next = options.find(
              (o) => flat(o.text) === flat(pair.to.text),
            );
            if (next) proposed.answer = next.key;
          }
      }
      if (typeof question.answer === 'boolean') {
        // A judge statement about a value between the old and the new threshold changes truth.
        for (const pair of pairs)
          for (const match of question.stem.matchAll(
            new RegExp(`(\\d+(?:\\.\\d+)?)\\s*${pair.from.unit}`, 'gu'),
          )) {
            const value = Number(match[1]);
            const low = Math.min(
              Number(pair.from.value),
              Number(pair.to.value),
            );
            const high = Math.max(
              Number(pair.from.value),
              Number(pair.to.value),
            );
            if (value > low && value < high) proposed.answer = !question.answer;
          }
      }
      for (const key of [
        'explanation',
        'sourceExcerpt',
        'gradingNotes',
      ] as const) {
        const value = question[key];
        if (!value) continue;
        const next = applyChanges(value, list, versions);
        if (next !== value) proposed[key] = next;
      }
      if (!options.length) {
        const stem = applyChanges(question.stem, list, versions);
        if (stem !== question.stem && proposed.answer === undefined)
          proposed.stem = stem;
      }
      const explanation = `${proposed.answer !== undefined ? `答案随变更调整为 ${JSON.stringify(proposed.answer)}；` : ''}${cite(list)}`;
      items.push({
        targetType: 'question',
        targetId: question.id,
        sectionTitle: list.map((c) => c.sectionTitle).join('、'),
        // Nothing can be changed in small steps: suggest deactivating instead.
        proposed: Object.keys(proposed).length
          ? proposed
          : { action: 'deactivate' },
        explanation: Object.keys(proposed).length
          ? explanation
          : `题目与变更冲突且无法小改，建议停用。${cite(list)}`,
      });
    }
    for (const scenario of affected.scenarios) {
      const list = touching(scenario.sections);
      const rubric = (
        Array.isArray(scenario.rubric) ? scenario.rubric : []
      ) as Record<string, unknown>[];
      const next = rubric.map((item) => {
        const out: Record<string, unknown> = { ...item };
        for (const key of Object.keys(item))
          if (typeof item[key] === 'string')
            out[key] = applyChanges(item[key], list, versions);
        return out;
      });
      const situation = applyChanges(scenario.situation, list, versions);
      const openingLine = applyChanges(scenario.openingLine, list, versions);
      const proposed: Record<string, unknown> = {};
      if (contentHash(next) !== contentHash(rubric)) proposed.rubric = next;
      if (situation !== scenario.situation) proposed.situation = situation;
      if (openingLine !== scenario.openingLine)
        proposed.openingLine = openingLine;
      if (!Object.keys(proposed).length) continue;
      items.push({
        targetType: 'practiceScenario',
        targetId: scenario.id,
        sectionTitle: list.map((c) => c.sectionTitle).join('、'),
        proposed,
        explanation: `评分要点随变更调整。${cite(list)}`,
      });
    }
    return items;
  }

  const versionRevision =
    (documentId: string): Work =>
    async (run) => {
      const revisions = deps.revisions();
      const { document, previous, changes } =
        await revisions.documentChanges(documentId);
      if (!previous || !changes.length)
        return { status: 'skipped', output: { reason: 'noChanges' } };
      const versions = { from: previous.version, to: document.version };
      run.summarize(
        `${document.title} ${document.version ?? ''}：变更 ${changes.length} 处（${changes.map((c) => c.sectionTitle).join('、')}）`,
      );
      // 1. The change note, unless an instructor already wrote one.
      const current = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['changeNote'])
        .where('id', '=', documentId)
        .executeTakeFirst();
      if (!current?.changeNote) {
        const note = await attempt(
          run,
          async () =>
            (
              await structured(
                run,
                'contentWriter',
                '升版修订 · 变更说明',
                `用 200 字以内说明这次升版改了什么，只写 changeSummary 中列出的变更。\n${JSON.stringify(changes)}`,
                z.object({ changeNote: z.string().min(5).max(1000) }),
              )
            ).changeNote,
          () => changeNoteTemplate(changes),
        );
        await database
          .query()
          .updateTable('kbDocuments')
          .set({ changeNote: note, updatedAt: new Date() })
          .where('id', '=', documentId)
          .execute();
      }
      // 2. The change brief, once per version.
      let briefId: string | null = null;
      const existing = await database
        .query()
        .selectFrom('courses')
        .select(['id'])
        .where('briefForDocumentId', '=', documentId)
        .executeTakeFirst();
      if (existing) briefId = str(existing.id);
      else {
        const lessons = await attempt(
          run,
          async () => {
            const data = await structured(
              run,
              'contentWriter',
              '升版修订 · 变更要点课程',
              `为下列变更起草“变更要点”课程：每节讲一处变更（原来怎么做、现在怎么做、为什么要注意），3–5 分钟；最后一节是 3 道自测题的草稿（写在课程内容里）。sectionTitle 填对应变更的小节标题，自测节填空字符串。\n${JSON.stringify(changes)}`,
              z.object({
                lessons: z
                  .array(
                    z.object({
                      title: z.string().min(1).max(200),
                      content: z.string().min(10),
                      sectionTitle: z.string(),
                    }),
                  )
                  .min(2)
                  .max(12),
              }),
            );
            return data.lessons;
          },
          () => briefTemplate(changes, document.version),
        );
        try {
          briefId = (
            await revisions.createChangeBrief({
              documentId,
              title: `《${document.title}》${document.version ?? ''} 变更要点`,
              lessons,
            })
          ).courseId;
          await run.recordItems('course', [
            { id: briefId, hash: await draftHash(database, 'course', briefId) },
          ]);
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
        }
      }
      // 3. Suggestions for the affected lessons, questions and scenarios.
      const affected = await revisions.findAffected(documentId);
      const proposals = await attempt(
        run,
        async () => {
          const count =
            affected.lessons.length +
            affected.questions.length +
            affected.scenarios.length;
          if (!count) return [];
          const data = await structured(
            run,
            'contentWriter',
            '升版修订 · 修订建议',
            `对下列受影响的内容逐条给出最小改动的修订建议：只改与变更相关的句子、选项或答案；无法小改的题目建议停用（proposed 为 {"action":"deactivate"}）；explanation 引用新版原文。不处理 changeSummary 以外的内容。\n${JSON.stringify({ changes, affected })}`,
            z.object({
              items: z.array(
                z.object({
                  targetType: z.enum([
                    'lesson',
                    'question',
                    'practiceScenario',
                  ]),
                  targetId: z.string(),
                  sectionTitle: z.string(),
                  proposed: z.record(z.string(), z.unknown()),
                  explanation: z.string().min(5),
                }),
              ),
            }),
          );
          return data.items;
        },
        () => ruleProposals(affected, changes, versions),
      );
      const { created, skipped } = await revisions.createRevisions({
        documentId,
        reason: 'documentChanged',
        items: proposals,
      });
      await run.recordItems(
        'contentRevision',
        created.map((id) => ({ id, hash: null })),
      );
      const estimate = await revisions.estimateAffected(documentId);
      // 4. Tell the document owner and the owners of the affected content.
      const owners = new Set<string>([document.ownerUserId]);
      for (const list of [
        affected.lessons,
        affected.questions,
        affected.scenarios,
      ])
        for (const item of list) owners.add(item.ownerUserId);
      if (created.length || briefId)
        await notify({
          key: `revision:${documentId}:${run.trigger === 'manual' ? run.runId : 'auto'}`,
          userIds: [...owners],
          message: 'revisionReady',
          params: {
            title: document.title,
            version: document.version ?? '',
            count: String(created.length),
            people: String(estimate.total),
          },
          path: `/talent/revisions?documentId=${documentId}`,
        });
      return {
        output: {
          briefId,
          revisions: created.length,
          skipped,
          affectedEstimate: estimate.total,
        },
      };
    };

  // ---------- 内容编写员：题目质量月检 ----------

  const questionQuality: Work = async (run) => {
    const revisions = deps.revisions();
    const list = await revisions.lowQualityQuestions({
      minAttempts: num(run.params.minAttempts, 20),
      lowRate: num(run.params.lowPercent, 30) / 100,
      highRate: num(run.params.highPercent, 98) / 100,
      minDiscrimination: num(run.params.minDiscrimination, 0.1),
    });
    run.summarize(`异常题目 ${list.length} 道`);
    run.reference(
      list.map((q) => ({
        id: q.id,
        attempts: q.attempts,
        correctRate: q.correctRate,
      })),
    );
    if (!list.length) return { status: 'skipped', output: { created: 0 } };
    const items = await attempt(
      run,
      async () => {
        const data = await structured(
          run,
          'contentWriter',
          '题目质量月检',
          `为下列作答异常的题目各写一条改写建议：正确率过低的先检查答案是否有误、题干是否有歧义；过高的提高干扰项质量；不改考查的知识点。proposed 只含要改的字段（stem、options、answer、explanation）。explanation 写明作答统计。\n${JSON.stringify(list)}`,
          z.object({
            items: z.array(
              z.object({
                questionId: z.string(),
                proposed: z.record(z.string(), z.unknown()),
                explanation: z.string().min(5),
              }),
            ),
          }),
        );
        return data.items.filter((i) =>
          list.some((q) => q.id === i.questionId),
        );
      },
      () =>
        list.map((q) => {
          const rate = Math.round(q.correctRate * 100);
          const top = Object.entries(q.distribution).sort(
            (a, b) => b[1] - a[1],
          )[0];
          const advice =
            q.correctRate < 0.3
              ? `正确率 ${rate}%（${q.attempts} 次作答），最多人选择 ${top?.[0] ?? ''}（${top?.[1] ?? 0} 次）：请先核对答案是否有误、题干是否有歧义。`
              : q.correctRate > 0.98
                ? `正确率 ${rate}%（${q.attempts} 次作答）：干扰项过弱，建议提高干扰项质量。`
                : `区分度 ${q.discrimination}（${q.attempts} 次作答）：高分组与低分组正确率接近，建议改写题干或干扰项。`;
          return {
            questionId: q.id,
            proposed: {
              explanation: `${q.explanation ?? ''}${q.explanation ? '\n' : ''}【待讲师改写】${advice}`,
            },
            explanation: `规则起草（无模型）：${advice}`,
          };
        }),
    );
    const { created } = await revisions.createRevisions({
      documentId: null,
      reason: 'lowQuality',
      items: items.map((i) => ({
        targetType: 'question' as const,
        targetId: i.questionId,
        proposed: i.proposed,
        explanation: `${i.explanation}\n作答分布：${JSON.stringify(list.find((q) => q.id === i.questionId)?.distribution ?? {})}`,
      })),
    });
    await run.recordItems(
      'contentRevision',
      created.map((id) => ({ id, hash: null })),
    );
    const owners = new Map<string, number>();
    for (const id of created) {
      const row = await database
        .query()
        .selectFrom('contentRevisions')
        .select(['ownerUserId'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (row)
        owners.set(
          str(row.ownerUserId),
          (owners.get(str(row.ownerUserId)) ?? 0) + 1,
        );
    }
    const month = platform.currentDate().slice(0, 7);
    for (const [owner, count] of owners)
      await notify({
        key: `questionQuality:${month}:${owner}:${created.join(',').slice(0, 64)}`,
        userIds: [owner],
        message: 'questionQualityFound',
        params: { count: String(count) },
        path: '/talent/revisions?tab=quality',
      });
    return { output: { created: created.length } };
  };

  const tasks = {
    /** Scheduled work, for the automation tasks' `scheduled` map. */
    scheduled: {
      'talentAnalyst.levelSuggestions': levelSuggestions,
      'talentAnalyst.monthlyReport': monthlyReport,
      'talentAnalyst.summaryRefresh': summaryRefresh,
      'talentAnalyst.ruleDrafting': ruleDrafting,
      'contentWriter.questionQuality': questionQuality,
      'talentAnalyst.trainingCheck': trainingCheck(),
    } as Record<string, Work>,

    /** Matched quality issues were written or updated: the training check. */
    onQualitySignals(signalIds: readonly string[]) {
      return deps
        .automation()
        .run(
          'talentAnalyst.trainingCheck',
          'event',
          { triggerRef: { signalIds: [...signalIds].slice(0, 50) } },
          trainingCheck(signalIds),
        );
    },

    onRecommendationCreated(recommendationId: string) {
      return deps.automation().run(
        'learningCoach.recommendationItems',
        'event',
        {
          triggerRef: { recommendationId },
          dedupeKey: `recommendation:${recommendationId}`,
        },
        recommendationItems(recommendationId),
      );
    },

    /** A new version became ready: once per version automatically; by hand again on request. */
    onVersionReady(documentId: string, trigger: 'event' | 'manual' = 'event') {
      return deps.automation().run(
        'contentWriter.versionRevision',
        trigger,
        {
          triggerRef: { documentId },
          dedupeKey: trigger === 'event' ? `document:${documentId}` : undefined,
        },
        versionRevision(documentId),
      );
    },

    /** Event tasks retried from the run record. */
    retry(task: string, ref: Record<string, unknown>): Work | undefined {
      const id = (name: string): string => {
        const value = ref[name];
        return typeof value === 'string' ? value : '';
      };
      if (
        task === 'learningCoach.recommendationItems' &&
        id('recommendationId')
      )
        return recommendationItems(id('recommendationId'));
      if (task === 'contentWriter.versionRevision' && id('documentId'))
        return versionRevision(id('documentId'));
      if (task === 'talentAnalyst.trainingCheck') return trainingCheck();
      return undefined;
    },

    /** 重新生成 by a head or HR: as the caller, with the analyst's wording when available. */
    async regenerateSummary(userId: string, employeeId: string) {
      const run = {
        usedConversation: () => undefined,
        markFallback: () => undefined,
      } as unknown as AutomationRunContext;
      return summarize(run, employeeId, userId);
    },
  };
  void iso;
  void daysBefore;
  void isActive;
  return tasks;
}

export type AnalystWork = ReturnType<typeof createAnalystWork>;
