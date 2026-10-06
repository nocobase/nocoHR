/**
 * V4-12 绩效助理 `performanceAssistant` — the proactive work, each through the
 * automation framework (switch, owner, run record; default owner hr01):
 *
 * | Key | Trigger | Does |
 * |---|---|---|
 * | performanceAssistant.evidenceSummary | the cycle enters selfReview | a summary of at most 150 characters per participant (attendance, learning and certificates, quality issues by number, competency changes) → `evidenceSummary` |
 * | performanceAssistant.goalDrafts | daily 09:00, from `goalDraftDaysBefore` (3) days before the goal-setting deadline | 2–4 measurable goal drafts aligned to the department goals for each participant with an account and no goal yet; the employee is reminded once |
 * | performanceAssistant.reviewDrafts | the cycle enters managerReview | as each manager, a comment draft per subordinate (facts with their sources, per-item notes, no overall rating) → `aiDraft`; one summary notice per manager |
 * | performanceAssistant.deviationCheck | a manager review is submitted | `listRatingAnomalies` for that review; hints to the reviewer once per submission; never blocks |
 * | performanceAssistant.calibrationPack | the cycle enters calibration | distribution against the guide per scheme and department, and the anomaly list → the calibration page; the HR owner is told |
 * | learningCoach.reviewResultPlans | a C or D result is published | a learning plan (trigger = reviewResult) for the manager to confirm; the HR owner is told |
 *
 * Without a model every job has a rule-based fallback and the run is marked
 * so. The assistant never scores, rates or calibrates: no job writes `items`,
 * `overallRating` or `finalRating`. Run records keep ids, counts and hint
 * types only — never comment text.
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import { authorizeAction, scopeForUser } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import { addDays, HrError, str } from '../shared.js';
import {
  hintText,
  type AnomalyService,
  type RatingAnomaly,
} from './anomalies.js';
import type { PerformanceContext, ReviewRow } from './context.js';
import { templateSummary, type EvidenceSnapshot } from './evidence.js';
import { draftGoalsSchema, type GoalService } from './goals.js';
import type { ResultService } from './results.js';
import type { ReviewService } from './reviews.js';

export const PERFORMANCE_AUTOMATIONS = {
  evidenceSummary: 'performanceAssistant.evidenceSummary',
  goalDrafts: 'performanceAssistant.goalDrafts',
  reviewDrafts: 'performanceAssistant.reviewDrafts',
  deviationCheck: 'performanceAssistant.deviationCheck',
  calibrationPack: 'performanceAssistant.calibrationPack',
  reviewResultPlans: 'learningCoach.reviewResultPlans',
} as const;

const ASSISTANT = 'talent.performanceAssistant';

const draftSchema = z.object({
  comment: z.string().min(1).max(2000),
  goals: z
    .array(z.object({ goalId: z.string(), comment: z.string().max(500) }))
    .max(20)
    .default([]),
  competencies: z
    .array(z.object({ competencyId: z.string(), comment: z.string().max(500) }))
    .max(40)
    .default([]),
  qualitySafety: z.string().max(500).default(''),
});
const summarySchema = z.object({ summary: z.string().min(1).max(300) });
const goalDraftsSchema = z.object({
  goals: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        measure: z.string().min(1).max(2000),
        weight: z.number().int().min(0).max(100),
        alignedGoalId: z.string().nullable().default(null),
      }),
    )
    .min(2)
    .max(4),
});
const hintsSchema = z.object({
  hints: z
    .array(z.object({ type: z.string(), text: z.string().min(1).max(300) }))
    .max(10),
});
const packSchema = z.object({ content: z.string().min(1).max(4000) });

export function createPerformanceAssistant(deps: {
  ctx: PerformanceContext;
  ai: AIRunner;
  goals: GoalService;
  reviews: ReviewService;
  results: ResultService;
  anomalies: AnomalyService;
}) {
  const { ctx, ai, goals, reviews, anomalies } = deps;
  const { database, platform } = ctx;

  async function structured<T>(
    run: AutomationRunContext,
    userId: string,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
    employee = 'performanceAssistant',
  ): Promise<T | null> {
    try {
      const { data, sessionId } = await ai.structured({
        employee,
        userId,
        title,
        prompt,
        schema,
        timeZone: platform.timeZone,
      });
      run.usedConversation(sessionId);
      return data;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
      return null;
    }
  }

  /** The facts a draft may use: numbers and record numbers, each with its source. */
  function facts(snapshot: EvidenceSnapshot | null) {
    if (!snapshot) return [];
    const list: {
      text: string;
      source: string;
      ref?: { type: string; id: string; label: string };
    }[] = [];
    const a = snapshot.attendance;
    if (a.months.length)
      list.push({
        text: `考勤：迟到 ${a.lateCount} 次、早退 ${a.earlyCount} 次、缺卡 ${a.missingCount} 次${a.absentDays ? `、旷工 ${a.absentDays} 天` : ''}`,
        source: `已锁定考勤汇总（${a.months[0]}–${a.months[a.months.length - 1]}）`,
      });
    const l = snapshot.learning;
    if (l.dueSoFar)
      list.push({
        text: `必修学习 ${l.completedOnTime}/${l.dueSoFar} 按期完成${l.remedialCompleted ? `，完成 ${l.remedialCompleted} 项复审补学` : ''}`,
        source: '学习任务',
      });
    for (const c of snapshot.certificates)
      list.push({
        text: `${c.title}${c.expiredDays ? `考核期内过期 ${c.expiredDays} 天` : '考核期内保持有效'}`,
        source: '员工证书',
      });
    const counted = snapshot.quality.issues.filter((i) => i.counted);
    if (counted.length)
      list.push({
        text: `考核期内 ${counted.length} 起质量问题（${counted.map((i) => `${i.externalId}${i.severity ? ` ${i.severity}` : ''}`).join('、')}）`,
        source: '业务系统',
      });
    for (const issue of counted)
      list.push({
        text: issue.externalId,
        source: '业务系统',
        ref: { type: 'signal', id: issue.id, label: issue.externalId },
      });
    if (snapshot.exams.certificationExams.length)
      list.push({
        text: `上岗与复审考试 ${snapshot.exams.certificationExams.map((e) => `${e.title} ${e.score ?? '—'} 分`).join('、')}`,
        source: '考试记录',
      });
    for (const change of snapshot.competencies)
      list.push({
        text: `${change.title} L${change.from ?? '-'}→L${change.to}`,
        source: '能力评定',
      });
    if (snapshot.training.completedRecommendations.length)
      list.push({
        text: `完成专项培训 ${snapshot.training.completedRecommendations.length} 项`,
        source: '专项培训',
      });
    return list;
  }

  // ---- 过程数据摘要 ----
  async function evidenceSummary(run: AutomationRunContext, cycleId: string) {
    await authorizeAction(run.owner.authz, ASSISTANT, 'use');
    const cycle = await ctx.cycle(cycleId);
    const results = (await ctx.resultsOf(cycleId)).filter(
      (r) => r.status !== 'closed' && r.evidenceSnapshot,
    );
    let written = 0;
    for (const result of results) {
      const snapshot = result.evidenceSnapshot!;
      const fallback = templateSummary(snapshot);
      const data = await structured(
        run,
        run.owner.userId,
        `过程数据摘要 ${cycle.title}`,
        [
          '根据下面的过程数据，为考核写一段不超过 150 字的过程数据摘要：考勤、学习与持证、质量问题（只写编号、严重程度和数量）、能力变化。',
          '只写数据中的事实，不评价性格、态度，不给等级。',
          `数据（JSON）：${JSON.stringify(facts(snapshot).filter((f) => !f.ref))}`,
        ].join('\n'),
        summarySchema,
      );
      const summary =
        data && data.summary.trim().length <= 150
          ? data.summary.trim()
          : fallback;
      await database
        .query()
        .updateTable('reviewResults')
        .set({ evidenceSummary: summary, updatedAt: new Date() })
        .where('id', '=', result.id)
        .execute();
      written += 1;
    }
    run.summarize(`${cycle.title} 过程数据摘要：${written} 人`);
    run.reference({ cycleId, resultIds: results.map((r) => r.id) });
    return { output: { cycleId, written } };
  }

  // ---- 目标草稿 ----
  function templateGoals(
    departmentGoals: readonly { id: string; title: string; measure: string }[],
  ) {
    const drafts: {
      title: string;
      measure: string;
      weight: number;
      alignedGoalId: string | null;
    }[] = [];
    const [first, second] = departmentGoals;
    if (first)
      drafts.push({
        title: '本岗位核心工作按时、按质完成',
        measure: `本人负责的工作在考核期内 critical、major 问题 0 起；支撑部门目标“${first.title}”`,
        weight: 40,
        alignedGoalId: first.id,
      });
    drafts.push({
      title: '关键流程与工作规范执行到位',
      measure: '关键流程的记录完整率 100%，因未按规范执行引起的问题 0 起',
      weight: first ? 30 : 50,
      alignedGoalId: first?.id ?? null,
    });
    if (second)
      drafts.push({
        title: '带教新人或分享经验',
        measure: `协助带教的新人按期通过岗位考核，或完成至少 1 次经验分享；支撑部门目标“${second.title}”`,
        weight: 15,
        alignedGoalId: second.id,
      });
    drafts.push({
      title: '按期完成必修学习并保持岗位必备证书有效',
      measure: '必修学习按期完成率不低于 95%，岗位必备证书在考核期内保持有效',
      weight: 0,
      alignedGoalId: null,
    });
    const assigned = drafts.slice(0, -1).reduce((sum, d) => sum + d.weight, 0);
    drafts[drafts.length - 1].weight = 100 - assigned;
    return drafts.slice(0, 4);
  }

  async function goalDrafts(
    run: AutomationRunContext,
    options: { cycleId?: string } = {},
  ) {
    await authorizeAction(run.owner.authz, ASSISTANT, 'use');
    const settings = await ctx.settings();
    const today = ctx.today();
    const cycles = (
      await database
        .query()
        .selectFrom('reviewCycles')
        .select(['id'])
        .where('status', '=', 'goalSetting')
        .execute()
    ).map((r) => str(r.id));
    let drafted = 0;
    let reminded = 0;
    const employeeIds: string[] = [];
    for (const cycleId of cycles) {
      if (options.cycleId && options.cycleId !== cycleId) continue;
      const cycle = await ctx.cycle(cycleId);
      const deadline = cycle.stageDeadlines.goalSetting;
      if (
        !deadline ||
        today < addDays(deadline, -settings.goalDraftDaysBefore) ||
        today > deadline
      )
        continue;
      const all = await ctx.goalsOf(cycleId);
      const employees = await ctx.employees();
      const positions = new Map(
        (
          await database
            .query()
            .selectFrom('positions')
            .select(['id', 'title', 'responsibilities'])
            .execute()
        ).map((p) => [
          str(p.id),
          {
            title: str(p.title),
            responsibilities: p.responsibilities ? str(p.responsibilities) : '',
          },
        ]),
      );
      for (const result of (await ctx.resultsOf(cycleId)).filter(
        (r) => r.status !== 'closed',
      )) {
        const employee = employees.get(result.employeeId);
        if (!employee?.userId) continue;
        const own = all.filter(
          (g) => g.employeeId === employee.id && g.status !== 'cancelled',
        );
        if (!own.length) {
          const departmentGoals = await goals.departmentGoalsFor(
            cycleId,
            employee.departmentId,
          );
          const position = employee.positionId
            ? positions.get(employee.positionId)
            : undefined;
          const data = await structured(
            run,
            run.owner.userId,
            `目标草稿 ${cycle.title}`,
            [
              `为员工起草 2–4 条本考核周期（${cycle.periodStart} 至 ${cycle.periodEnd}）的个人目标，写成可衡量的形式（有数量、比例或期限），权重合计 100，由员工修改后提交。`,
              '依据部门目标和岗位职责；能对齐部门目标的，在 alignedGoalId 中填部门目标的 id。不写对个人的评价。',
              `岗位：${position?.title ?? ''}；职责：${position?.responsibilities ?? ''}`,
              `部门目标（JSON）：${JSON.stringify(departmentGoals.map((g) => ({ id: g.id, title: g.title, measure: g.measure })))}`,
            ].join('\n'),
            goalDraftsSchema,
          );
          let list = data?.goals ?? templateGoals(departmentGoals);
          if (list.reduce((sum, g) => sum + g.weight, 0) !== 100)
            list = templateGoals(departmentGoals);
          try {
            const created = await goals.createAiDrafts(
              cycleId,
              employee.id,
              draftGoalsSchema.parse(list),
            );
            await run.recordItems(
              'goal',
              created.map((g) => ({ id: g.id, hash: null })),
            );
            drafted += created.length;
            employeeIds.push(employee.id);
          } catch (error) {
            if (!(error instanceof HrError)) throw error;
            continue;
          }
        }
        // One reminder per person and cycle, drafted or not, while they have nothing submitted.
        const submitted = (await ctx.goalsOf(cycleId)).some(
          (g) =>
            g.employeeId === employee.id &&
            (g.status === 'submitted' || g.status === 'approved'),
        );
        if (submitted) continue;
        const key = `perf:goalDraft:${cycleId}:${employee.id}`;
        const sent = await platform.reminderOnce(key, () =>
          platform.notify({
            key,
            userIds: [employee.userId!],
            message: 'performanceGoalDrafts',
            params: { cycle: cycle.title, deadline },
            path: '/talent/my-review?tab=goals',
          }),
        );
        if (sent) reminded += 1;
      }
    }
    run.summarize(`目标草稿：起草 ${drafted} 条，提醒 ${reminded} 人`);
    run.reference({ employeeIds });
    return {
      status:
        drafted || reminded ? ('succeeded' as const) : ('skipped' as const),
      output: { drafted, reminded },
    };
  }

  // ---- 评语初稿 (as each manager) ----
  async function reviewDrafts(run: AutomationRunContext, cycleId: string) {
    const cycle = await ctx.cycle(cycleId);
    const tasks = (await ctx.reviewsOf(cycleId)).filter(
      (r) =>
        r.role === 'manager' &&
        r.status !== 'cancelled' &&
        r.status !== 'submitted' &&
        !r.aiDraft,
    );
    const byManager = new Map<string, ReviewRow[]>();
    for (const task of tasks)
      byManager.set(task.reviewerUserId, [
        ...(byManager.get(task.reviewerUserId) ?? []),
        task,
      ]);
    let written = 0;
    for (const [userId, list] of byManager) {
      const actor = {
        userId,
        authz: await scopeForUser(platform.authz, userId),
      };
      let mine = 0;
      for (const task of list) {
        let context: Awaited<ReturnType<ReviewService['context']>>;
        try {
          context = await reviews.context(actor, task.id);
        } catch (error) {
          if (error instanceof HrError) continue;
          throw error;
        }
        const snapshot = context.evidence?.snapshot ?? null;
        const known = facts(snapshot);
        const data = await structured(
          run,
          userId,
          `评语初稿 ${cycle.title}`,
          [
            `为上级起草 ${context.employee.name} 的考核评语初稿。`,
            '只写有数据支撑的事实，每条事实后用括号标注来源；不写对性格、态度、家庭的评价；不给总评等级，只给各项的参考意见。',
            '描述问题要具体、可改进，例如“考核期内两起 major 级问题（编号 2026-0301、2026-0457）”，而不是“工作不认真”。',
            '下面 JSON 的字段名（如 current、required、progress）只是给你看的，不要写进评语。能力项的 current 为 null 表示当前没有评定记录，写“当前没有评定记录”；能力等级写成 L1、L2 这样，没有评定的写“未评定”，不要写“L-”。',
            `目标（JSON）：${JSON.stringify(context.goals.map((g) => ({ goalId: g.id, title: g.title, measure: g.measure, progress: g.progress })))}`,
            `能力项（JSON）：${JSON.stringify(context.requirements.map((r) => ({ competencyId: r.competencyId, title: r.title, required: r.requiredLevel, current: r.currentLevel })))}`,
            `过程数据（JSON）：${JSON.stringify(known.filter((f) => !f.ref))}`,
            `质量与安全参考分：${snapshot?.qualitySafety.score ?? '—'}`,
          ].join('\n'),
          draftSchema,
        );
        const goalNotes = context.goals.map((g) => ({
          goalId: g.id,
          comment:
            data?.goals.find((x) => x.goalId === g.id)?.comment ??
            `进度 ${g.progress}%；衡量标准：${g.measure}（目标记录）`,
        }));
        const competencyNotes = context.requirements.map((r) => ({
          competencyId: r.competencyId,
          comment:
            data?.competencies.find((x) => x.competencyId === r.competencyId)
              ?.comment ??
            `当前等级 L${r.currentLevel ?? '-'}，岗位要求 L${r.requiredLevel}（能力评定）`,
        }));
        const quality = snapshot?.qualitySafety ?? null;
        const qualityComment =
          data?.qualitySafety ||
          (quality
            ? `参考分 ${quality.score}${quality.deductions.length ? `：${quality.deductions.map((d) => `${d.rule} ×${d.count}（${d.points}）`).join('，')}` : '：考核期内无扣分项'}（业务系统、学习与证书记录）`
            : '');
        const comment =
          data?.comment ??
          [
            ...known
              .filter((f) => !f.ref)
              .map((f) => `${f.text}（${f.source}）`),
            ...context.goals.map(
              (g) => `目标“${g.title}”进度 ${g.progress}%（目标记录）`,
            ),
          ].join('；') + '。';
        const refs = known.filter((f) => f.ref).map((f) => f.ref!);
        for (const month of snapshot?.attendance.summaryIds ?? [])
          refs.push({
            type: 'attendanceSummary',
            id: month,
            label: '考勤汇总',
          });
        for (const g of context.goals)
          refs.push({ type: 'goal', id: g.id, label: g.title });
        await database
          .query()
          .updateTable('reviews')
          .set({
            aiDraft: {
              comment,
              itemSuggestions: {
                goals: goalNotes,
                competencies: competencyNotes,
                qualitySafety: quality
                  ? { score: quality.score, comment: qualityComment }
                  : null,
              },
              evidenceRefs: refs,
              generatedAt: new Date().toISOString(),
              source: data ? 'ai' : 'rule',
            },
            updatedAt: new Date(),
          })
          .where('id', '=', task.id)
          .execute();
        mine += 1;
      }
      written += mine;
      if (mine)
        await platform.notify({
          key: `perf:${cycleId}:drafts:${userId}`,
          userIds: [userId],
          message: 'performanceDraftsReady',
          params: { cycle: cycle.title, count: String(mine) },
          path: `/talent/team-reviews?cycle=${encodeURIComponent(cycleId)}`,
        });
    }
    run.summarize(`${cycle.title} 评语初稿：${written} 份`);
    run.reference({ cycleId, reviewIds: tasks.map((t) => t.id) });
    return { output: { cycleId, written } };
  }

  /** saveReviewDraft: the draft only — never items, rating or status. */
  async function saveDraft(
    reviewId: string,
    draft: {
      comment: string;
      itemSuggestions?: unknown;
      evidenceRefs?: unknown;
    },
  ) {
    await database
      .query()
      .updateTable('reviews')
      .set({
        aiDraft: {
          comment: draft.comment,
          itemSuggestions: draft.itemSuggestions ?? {
            goals: [],
            competencies: [],
            qualitySafety: null,
          },
          evidenceRefs: draft.evidenceRefs ?? [],
          generatedAt: new Date().toISOString(),
          source: 'ai',
        },
        updatedAt: new Date(),
      })
      .where('id', '=', reviewId)
      .execute();
  }

  /** sendReviewHints: once per review and submission; answers false when already sent. */
  async function sendHints(
    review: ReviewRow,
    hints: { type: string; text: string }[],
  ): Promise<boolean> {
    if (!hints.length) return false;
    if (review.hints && review.hints.submission === review.submissionCount)
      return false;
    const cycle = await ctx.cycle(review.cycleId);
    await database
      .query()
      .updateTable('reviews')
      .set({
        hints: {
          submission: review.submissionCount,
          items: hints,
          at: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where('id', '=', review.id)
      .execute();
    await platform.notify({
      key: `perf:hints:${review.id}:${review.submissionCount}`,
      userIds: [review.reviewerUserId],
      message: 'performanceReviewHints',
      params: { cycle: cycle.title, count: String(hints.length) },
      path: `/talent/team-reviews/${encodeURIComponent(review.id)}`,
    });
    return true;
  }

  // ---- 偏差检查 ----
  async function deviationCheck(
    run: AutomationRunContext,
    reviewId: string,
    submission: number,
  ) {
    const review = await ctx.review(reviewId);
    if (review.submissionCount !== submission || review.status !== 'submitted')
      return { status: 'skipped' as const, output: { reason: 'stale' } };
    const found = (
      await anomalies(review.cycleId, { resultIds: new Set([review.resultId]) })
    )[0];
    const list: RatingAnomaly[] = found?.anomalies ?? [];
    run.summarize(`偏差检查：评价 ${reviewId} 第 ${submission} 次提交`);
    run.reference({ reviewId, hintTypes: list.map((a) => a.type) });
    if (!list.length)
      return { status: 'skipped' as const, output: { reviewId, hints: 0 } };
    const rule = list.map((a) => ({ type: a.type, text: hintText(a) }));
    const data = await structured(
      run,
      review.reviewerUserId,
      '评分偏差提示',
      [
        '把下面的评分偏差逐条改写成给评价人的简短提示（每条不超过 80 字）：只指出不一致和证据不足之处，不建议具体等级，不评价员工。',
        `偏差（JSON）：${JSON.stringify(list)}`,
        'hints 中每条的 type 必须与偏差的 type 一致。',
      ].join('\n'),
      hintsSchema,
    );
    const hints = rule.map((r) => {
      const worded = data?.hints.find((h) => h.type === r.type)?.text?.trim();
      // A worded hint that names a grade to give is dropped for the rule's text.
      return worded && !/(建议|应|改为|评为)\s*[SABCD]\b/u.test(worded)
        ? { type: r.type, text: worded }
        : r;
    });
    const sent = await sendHints(review, hints);
    return {
      output: {
        reviewId,
        hints: hints.length,
        sent,
        types: hints.map((h) => h.type),
      },
    };
  }

  // ---- 校准材料 ----
  async function calibrationPack(run: AutomationRunContext, cycleId: string) {
    await authorizeAction(run.owner.authz, 'talent.calibration', 'view');
    const cycle = await ctx.cycle(cycleId);
    const results = (await ctx.resultsOf(cycleId)).filter(
      (r) => r.status !== 'closed',
    );
    const schemes = await ctx.schemes();
    const titles = await ctx.departmentTitles();
    const lines: string[] = [];
    for (const scheme of schemes) {
      const own = results.filter((r) => r.schemeId === scheme.id);
      if (!own.length) continue;
      const d = deps.results.distribution(own, scheme);
      lines.push(
        `【${scheme.title}】${d.total} 人已评：${d.counts.map((c) => `${c.code} ${c.count} 人（${c.percent}%）`).join('，')}`,
      );
      for (const g of d.guide)
        lines.push(
          `  指引 ${g.key}${g.max !== null ? ` ≤${g.max}%` : ''}${g.min !== null ? ` ≥${g.min}%` : ''}：实际 ${g.actual}%${g.outside ? '，超出指引' : ''}`,
        );
      for (const departmentId of [
        ...new Set(own.map((r) => r.departmentId ?? '')),
      ]) {
        const part = deps.results.distribution(
          own.filter((r) => (r.departmentId ?? '') === departmentId),
          scheme,
        );
        lines.push(
          `  ${titles.get(departmentId) ?? departmentId}：${
            part.counts
              .filter((c) => c.count)
              .map((c) => `${c.code} ${c.count}`)
              .join('、') || '尚无等级'
          }`,
        );
      }
    }
    const list = await anomalies(cycleId);
    if (list.length) {
      lines.push('【异常名单】');
      for (const entry of list)
        lines.push(
          `  ${entry.name}：${entry.anomalies.map((a) => hintText(a)).join(' ')}`,
        );
    } else lines.push('【异常名单】无');
    const fallback = lines.join('\n');
    const data = await structured(
      run,
      run.owner.userId,
      `校准材料 ${cycle.title}`,
      [
        '把下面的校准数据整理成给 HR 的校准材料：先写各方案、各部门的分布与指引对比，再列异常名单及原因。只使用给出的数据，不建议任何人的等级。',
        fallback,
      ].join('\n'),
      packSchema,
    );
    const content = data?.content ?? fallback;
    await database
      .query()
      .updateTable('reviewCycles')
      .set({
        calibrationPack: {
          content,
          generatedAt: new Date().toISOString(),
          source: data ? 'ai' : 'rule',
          runId: run.runId,
        },
        updatedAt: new Date(),
      })
      .where('id', '=', cycleId)
      .execute();
    await platform.notify({
      key: `perf:${cycleId}:calibrationPack`,
      userIds: [cycle.ownerUserId],
      message: 'performanceCalibrationPack',
      params: { cycle: cycle.title, anomalies: String(list.length) },
      path: `/talent/calibration?cycle=${encodeURIComponent(cycleId)}`,
    });
    run.summarize(`${cycle.title} 校准材料：${list.length} 人有异常`);
    run.reference({
      cycleId,
      resultIds: list.map((a) => a.resultId),
      types: list.flatMap((a) => a.anomalies.map((x) => x.type)),
    });
    return { output: { cycleId, anomalies: list.length } };
  }

  // ---- 低绩效学习计划 (学习教练) ----
  async function reviewResultPlan(run: AutomationRunContext, resultId: string) {
    await authorizeAction(run.owner.authz, 'talent.learningCoach', 'use');
    const result = await ctx.result(resultId);
    const rating = result.finalRating;
    if (rating !== 'C' && rating !== 'D')
      return { status: 'skipped' as const, output: { reason: 'notLow' } };
    const cycle = await ctx.cycle(result.cycleId);
    const employee = await platform.employee(result.employeeId);
    if (!employee || employee.status === 'leave')
      return { status: 'skipped' as const, output: { reason: 'noEmployee' } };
    const existing = await database
      .query()
      .selectFrom('learningPlans')
      .select(['id', 'triggerRef'])
      .where('employeeId', '=', employee.id)
      .execute();
    if (
      existing.some((p) => {
        const ref =
          typeof p.triggerRef === 'string'
            ? p.triggerRef
            : JSON.stringify(p.triggerRef ?? '');
        return ref.includes(resultId);
      })
    )
      return { status: 'skipped' as const, output: { reason: 'exists' } };
    // The competencies below the requirement in the manager's review, else the position's gaps.
    const manager = (await ctx.reviewsOf(result.cycleId)).find(
      (r) =>
        r.resultId === resultId &&
        r.role === 'manager' &&
        r.status === 'submitted',
    );
    const requirements = await reviews.requirementsFor(
      employee.id,
      employee.positionId,
    );
    const assessed = new Map(
      (manager?.items.competencies ?? []).map((c) => [c.competencyId, c.level]),
    );
    let weak = requirements.filter((r) => {
      const level = assessed.get(r.competencyId) ?? r.currentLevel ?? 0;
      return typeof level === 'number' && level < r.requiredLevel;
    });
    if (!weak.length) weak = requirements;
    const content = (
      await ctx
        .plans()
        .searchContent({ competencyIds: weak.map((w) => w.competencyId) })
    )
      .sort(
        (a, b) => (a.type === 'course' ? 0 : 1) - (b.type === 'course' ? 0 : 1),
      )
      .slice(0, 3);
    const recipients = [...new Set([cycle.ownerUserId])];
    await platform.notify({
      key: `perf:lowResult:${resultId}`,
      userIds: recipients,
      message: 'performanceLowResult',
      params: { cycle: cycle.title, name: employee.name },
      path: `/talent/learning-plans`,
    });
    run.summarize(`${cycle.title} 考核结果跟进：${employee.name}`);
    run.reference({ resultId, employeeId: employee.id });
    if (!content.length)
      return { output: { resultId, plan: null, reason: 'noContent' } };
    const titleOf = new Map(weak.map((w) => [w.competencyId, w.title]));
    const summary = `${employee.name}在${cycle.title}中需要提升${weak.map((w) => w.title).join('、')}。建议学习${content.map((c) => `《${c.title}》`).join('、')}，由上级确认后指派。`;
    const due = addDays(ctx.today(), 30);
    try {
      const plan = await ctx.plans().createDraft(
        run.owner,
        {
          employeeId: employee.id,
          trigger: 'reviewResult',
          triggerRef: { resultId, cycleId: cycle.id },
          summary,
          mergeIntoDraft: true,
          items: content.map((item) => {
            const competencyId =
              weak.find((w) => item.competencyIds.includes(w.competencyId))
                ?.competencyId ?? null;
            return {
              type: item.type,
              refId: item.id,
              competencyId,
              reason: `提升${titleOf.get(competencyId ?? '') ?? '岗位能力'}`,
              dueDate: due,
            };
          }),
        },
        {
          source: 'ai',
          fallbackReviewerUserId: result.managerUserId,
          automated: true,
        },
      );
      await run.recordItems('learningPlan', [{ id: plan.id, hash: null }]);
      return { output: { resultId, plan: plan.id } };
    } catch (error) {
      if (error instanceof HrError)
        return { output: { resultId, plan: null, reason: error.code } };
      throw error;
    }
  }

  return {
    evidenceSummary,
    goalDrafts,
    reviewDrafts,
    deviationCheck,
    calibrationPack,
    reviewResultPlan,
    saveDraft,
    sendHints,
    facts,
  };
}

export type PerformanceAssistant = ReturnType<
  typeof createPerformanceAssistant
>;
