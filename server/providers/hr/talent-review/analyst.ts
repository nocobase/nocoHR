/**
 * V4-13 AI 员工的主动工作 (13A and the quarterly training report), each
 * through the automation framework (switch, owner, run record; default owner
 * hr01 in the demo):
 *
 * | Key | Trigger | Does |
 * |---|---|---|
 * | talentAnalyst.prePlacement | a review enters preparing | per placement: the performance band, the potential evidence (facts only) and notes → `aiSuggestion`; the HR owner is told. Never band, potential or box. |
 * | talentAnalyst.successorRecommend | a key position is marked; quarterly | `matchSuccessors`, the 3 smallest gaps (never the incumbent), with the gaps and development records → AI candidates without readiness; hr01 and the incumbent's superior are told |
 * | talentAnalyst.successionRisk | the incumbent or a candidate leaves; quarterly (no readyNow / oneToTwoYears) | the risk and people to consider → hr01 and the incumbent's superior (never the incumbent), once per plan and reason in 7 days |
 * | talentAnalyst.trainingEffectReport | quarterly | l1, l2 (exams) and l3 per course and instructor; the lowest with possible causes → hr01 and the instructors concerned, once per quarter |
 * | frameworkAdvisor.versionChangeNote | a draft version is saved | what changed, how many people, suggested courses → the draft's change note, once per draft content |
 * | learningCoach.talentReviewPlans | a placement is confirmed | a learning plan (trigger = talentReview) for the head to confirm |
 *
 * Without a model every job takes its rule-based fallback and the run is
 * marked so. Run records keep placement and plan ids and alert types only —
 * never a band, a rating, a name or an example.
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import type { AutomationRunContext } from '../automation.js';
import { addDays, HrError, str } from '../shared.js';
import { boxOf } from './config.js';
import type { TalentReviewContext } from './context.js';
import { json, num } from './context.js';
import { evidenceLines, placementEvidence } from './evidence.js';
import type { ModelVersionService } from './model-versions.js';
import type { ReviewService } from './reviews.js';
import type { SuccessionService } from './succession.js';

export const TALENT_REVIEW_AUTOMATIONS = {
  prePlacement: 'talentAnalyst.prePlacement',
  successorRecommend: 'talentAnalyst.successorRecommend',
  successionRisk: 'talentAnalyst.successionRisk',
  trainingEffectReport: 'talentAnalyst.trainingEffectReport',
  versionChangeNote: 'frameworkAdvisor.versionChangeNote',
  talentReviewPlans: 'learningCoach.talentReviewPlans',
  structureObservation: 'examiner.structureObservation',
  draftPracticalChecklist: 'examiner.draftPracticalChecklist',
  knowledgeDistill: 'knowledgeAssistant.knowledgeDistill',
  translationDraft: 'contentWriter.translationDraft',
} as const;

const preplacementSchema = z.object({
  placements: z
    .array(
      z.object({
        placementId: z.string(),
        potentialEvidence: z.array(z.string().max(300)).max(8),
        notes: z.string().max(500),
      }),
    )
    .max(500),
});
const noteSchema = z.object({ note: z.string().min(1).max(2000) });
const reportSchema = z.object({ content: z.string().min(1).max(4000) });
const riskSchema = z.object({ content: z.string().min(1).max(1500) });

/** Words that judge a person rather than describe a fact; never kept in a suggestion. */
const CHARACTER_WORDS = /性格|内向|外向|懒|态度差|情商|脾气|人品|自私|固执/u;

export function createTalentAnalyst(deps: {
  ctx: TalentReviewContext;
  ai: AIRunner;
  reviews: ReviewService;
  succession: SuccessionService;
  versions: ModelVersionService;
}) {
  const { ctx, ai, reviews, succession, versions } = deps;
  const { database, platform } = ctx;

  async function structured<T>(
    run: AutomationRunContext,
    employee: string,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T | null> {
    try {
      const { data, sessionId } = await ai.structured({
        employee,
        userId: run.owner.userId,
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

  /** `savePlacementSuggestion`: writes aiSuggestion only (never the bands or the box). */
  async function saveSuggestion(
    placementId: string,
    suggestion: {
      potentialEvidence: string[];
      notes: string;
      source: 'ai' | 'rule';
    },
  ) {
    const row = await reviews.placementRow(placementId);
    const performanceBand = num(row.performanceBand);
    await database
      .query()
      .updateTable('talentPlacements')
      .set({
        aiSuggestion: {
          performanceBand,
          potentialEvidence: suggestion.potentialEvidence
            .filter((line) => !CHARACTER_WORDS.test(line))
            .slice(0, 8),
          suggestedBox: boxOf(performanceBand, num(row.potentialBand)),
          notes: CHARACTER_WORDS.test(suggestion.notes) ? '' : suggestion.notes,
          source: suggestion.source,
          generatedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where('id', '=', placementId)
      .execute();
  }

  async function prePlacement(run: AutomationRunContext, reviewId: string) {
    const review = await reviews.reviewRow(reviewId);
    const rows = await database
      .query()
      .selectFrom('talentPlacements')
      .select(['id'])
      .where('talentReviewId', '=', reviewId)
      .execute();
    const evidence = [];
    for (const row of rows) {
      const e = await placementEvidence(ctx, str(row.id));
      if (e) evidence.push(e);
    }
    run.summarize(`盘点预放置：${evidence.length} 个落位`);
    run.reference({ reviewId, placementIds: evidence.map((e) => e.placementId) });
    if (!evidence.length) return { status: 'skipped' as const, output: { reason: 'noPlacements' } };
    const answer = await structured(
      run,
      'talentAnalyst',
      `盘点预放置 ${review.title}`,
      `为人才盘点的每个落位写预放置建议。只列事实（考核等级、学习速度、能力增长、考试首次通过率、陪练表现、主管记录的事例），不评价性格，不给潜力分，不写考核评语。每人 notes 不超过 80 字。
落位数据（JSON）：
${JSON.stringify(
  evidence.map((e) => ({
    placementId: e.placementId,
    finalRating: e.finalRating,
    learningSpeed: e.learningSpeed,
    competencyGrowth: e.competencyGrowth,
    exams: e.exams,
    practice: e.practice,
    potentialExamples: e.potential.items.map((i) => i.example).filter(Boolean),
  })),
)}`,
      preplacementSchema,
    );
    const byId = new Map(answer?.placements.map((p) => [p.placementId, p]) ?? []);
    for (const e of evidence) {
      const ai = byId.get(e.placementId);
      const lines = evidenceLines(e);
      await saveSuggestion(e.placementId, {
        potentialEvidence: ai?.potentialEvidence.length ? ai.potentialEvidence : lines,
        notes:
          ai?.notes ??
          (e.performanceBand
            ? `绩效维度按考核等级换算为 ${e.performanceBand}；潜力待主管评估后确定。`
            : '没有考核结果，绩效维度须在盘点会上人工填写。'),
        source: ai ? 'ai' : 'rule',
      });
    }
    await platform.notify({
      key: `talentReview:${reviewId}:preplaced`,
      userIds: [review.ownerUserId],
      message: 'talentReviewPreplaced',
      params: { title: review.title, count: String(evidence.length) },
      path: `/talent/talent-reviews/${reviewId}`,
    });
    return { output: { reviewId, placements: evidence.length } };
  }

  /** After a potential assessment the suggested box follows the two bands (no model; the bands are not changed). */
  async function refreshSuggestedBox(placementId: string) {
    const row = await reviews.placementRow(placementId);
    const suggestion = json<Record<string, unknown> | null>(row.aiSuggestion, null);
    if (!suggestion) return;
    const performanceBand = num(suggestion.performanceBand);
    await database
      .query()
      .updateTable('talentPlacements')
      .set({
        aiSuggestion: {
          ...suggestion,
          suggestedBox: boxOf(performanceBand, num(row.potentialBand)),
        },
        updatedAt: new Date(),
      })
      .where('id', '=', placementId)
      .execute();
  }

  async function notifyPlan(
    planId: string,
    message: string,
    key: string,
    params: Record<string, string>,
    owner: string | null,
  ) {
    const plan = await succession.planRow(planId);
    const recipients = await succession.riskRecipients(plan, owner);
    if (!recipients.length) return 0;
    await platform.notify({
      key,
      userIds: recipients,
      message,
      params,
      path: `/talent/succession/${planId}`,
    });
    return recipients.length;
  }

  async function planTitles(planId: string) {
    const plan = await succession.planRow(planId);
    const positions = await ctx.positionTitles();
    const departments = await ctx.departmentTitles();
    return {
      plan,
      position: positions.get(plan.positionId) ?? '',
      department: departments.get(plan.departmentId) ?? '',
    };
  }

  async function successorRecommend(run: AutomationRunContext, planId: string) {
    const { plan, position, department } = await planTitles(planId);
    const settings = await ctx.settings();
    const matches = (await succession.match(plan.positionId, plan.departmentId))
      .filter((m) => m.employeeId !== plan.incumbentEmployeeId)
      .filter((m) => !plan.candidates.some((c) => c.employeeId === m.employeeId))
      .slice(0, settings.successorCount);
    run.summarize(`继任候选推荐：计划 ${planId}，${matches.length} 人`);
    run.reference({ planId, candidates: matches.length });
    if (!matches.length) return { status: 'skipped' as const, output: { planId, reason: 'noMatch' } };
    const answer = await structured(
      run,
      'talentAnalyst',
      `继任候选推荐 ${position}`,
      `为关键岗位“${department}${position}”的继任候选人各写一句说明（差距与已有的发展记录），只列事实，不评价性格，不判断准备度。
候选（JSON）：${JSON.stringify(
        matches.map((m) => ({
          employeeId: m.employeeId,
          gaps: m.gaps.map((g) => `${g.title} ${g.current}/${g.required}`),
          latestRating: m.latestRating,
          developmentRecords: m.developmentRecords,
        })),
      )}`,
      z.object({
        notes: z.array(z.object({ employeeId: z.string(), note: z.string().max(300) })),
      }),
    );
    const notes = new Map(answer?.notes.map((n) => [n.employeeId, n.note]) ?? []);
    const added = await succession.saveSuggestions(
      planId,
      matches.map((m) => ({
        employeeId: m.employeeId,
        gaps: m.gaps,
        note:
          notes.get(m.employeeId) ??
          (m.gaps.length
            ? `与岗位要求的差距：${m.gaps.map((g) => `${g.title}（${g.current}/${g.required}）`).join('、')}${m.developmentRecords.length ? `；已有${m.developmentRecords.join('、')}` : ''}`
            : '已达到岗位当前要求'),
      })),
    );
    if (added)
      await notifyPlan(
        planId,
        'successionRecommended',
        `succession:${planId}:recommended:${run.runId}`,
        { position, department, count: String(added) },
        run.owner.userId,
      );
    return { output: { planId, added } };
  }

  async function successionRisk(
    run: AutomationRunContext,
    planId: string,
    reason: string,
  ) {
    const { plan, position, department } = await planTitles(planId);
    const settings = await ctx.settings();
    // 同一岗位同一原因 7 天内只发一次.
    const since = new Date(Date.now() - settings.riskCooldownDays * 86_400_000);
    const recent = await database
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', 'like', `succession:risk:${planId}:${reason}:%`)
      .where('sentAt', '>=', since)
      .executeTakeFirst();
    run.summarize(`继任风险提醒：计划 ${planId}，${reason}`);
    run.reference({ planId, reason });
    if (recent) return { status: 'skipped' as const, output: { planId, reason, cooldown: true } };
    const matches = (await succession.match(plan.positionId, plan.departmentId)).slice(0, 3);
    const active = plan.candidates.filter((c) => !c.left);
    const answer = await structured(
      run,
      'talentAnalyst',
      `继任风险提醒 ${position}`,
      `用两三句话说明关键岗位“${department}${position}”的继任风险与可考虑的人选。原因：${reason}。不评价性格，不判断准备度，不提及离职原因。
当前候选：${JSON.stringify(active.map((c) => ({ readiness: c.readiness, gaps: c.gaps.length })))}
可考虑的人：${JSON.stringify(matches.map((m) => ({ name: m.name, gaps: m.gaps.length })))}`,
      riskSchema,
    );
    const consider = matches.map((m) => m.name).join('、') || '暂无';
    const summary =
      answer?.content ??
      `${reason === 'noReadySuccessor' ? '没有“随时可接任”或“1–2 年可接任”的候选人' : reason === 'incumbentLeft' ? '现任已离职' : '一名继任候选人已离职'}；可考虑的人选：${consider}。`;
    const key = `succession:risk:${planId}:${reason}:${ctx.today()}:${run.runId}`;
    const sent = await platform.reminderOnce(key, async () => {
      await notifyPlan(
        planId,
        'successionRisk',
        key,
        { position, department, summary: summary.slice(0, 300) },
        run.owner.userId,
      );
    });
    return { output: { planId, reason, sent } };
  }

  /** 每季度首日: refresh the recommendations of every key position and check for plans without ready successors. */
  async function quarterly(
    run: AutomationRunContext,
    part: 'recommend' | 'risk',
  ) {
    const settings = await ctx.settings();
    const month = Number(ctx.today().slice(5, 7));
    if (run.trigger === 'schedule' && !settings.quarterMonths.includes(month))
      return { status: 'skipped' as const, output: { reason: 'notQuarterStart' } };
    const planIds = await succession.planIds();
    let count = 0;
    for (const planId of planIds) {
      if (part === 'recommend') {
        const outcome = await successorRecommend(run, planId);
        count += Number((outcome.output as { added?: number }).added ?? 0);
      } else {
        const plan = await succession.planRow(planId);
        const risk = succession.risk(plan.candidates.filter((c) => !c.left));
        if (!risk) continue;
        const outcome = await successionRisk(run, planId, 'noReadySuccessor');
        if ((outcome.output as { sent?: boolean }).sent) count += 1;
      }
    }
    run.summarize(`季度继任检查（${part}）：${planIds.length} 个关键岗位`);
    return { output: { plans: planIds.length, count } };
  }

  async function versionChangeNote(run: AutomationRunContext, versionId: string) {
    const row = await versions.versionRow(versionId);
    if (row.status !== 'draft') return { status: 'skipped' as const, output: { reason: 'notDraft' } };
    const current = await versions.currentOf(row.positionId);
    const hash = versions.contentHash(row, current?.snapshot ?? []);
    if (row.changeNoteSource === 'manual')
      return { status: 'skipped' as const, output: { reason: 'manualNote' } };
    if (row.changeNoteHash === hash)
      return { status: 'skipped' as const, output: { reason: 'unchanged' } };
    const impact = await versions.impactOf(row.positionId, current?.snapshot ?? [], row.snapshot);
    const positions = await ctx.positionTitles();
    const courses = (
      await ctx.plans().searchContent({
        competencyIds: impact.changed.map((c) => c.competencyId),
      })
    )
      .filter((c) => c.type === 'course')
      .slice(0, 3);
    run.summarize(`版本变更说明：${positions.get(row.positionId) ?? row.positionId} 第 ${row.versionNo} 版`);
    run.reference({ versionId, changed: impact.changed.length });
    const answer = await structured(
      run,
      'frameworkAdvisor',
      `版本变更说明 ${positions.get(row.positionId) ?? ''}`,
      `对比能力模型草稿与当前版本，写一段变更说明：改了什么、影响多少人、建议配套的课程。不超过 200 字。
变更：${JSON.stringify(impact.changed)}
新增差距人数：${impact.newGaps.count}
不再要求：${JSON.stringify(impact.removed)}
可配套的课程：${JSON.stringify(courses.map((c) => c.title))}`,
      noteSchema,
    );
    const changedText = impact.changed
      .map((c) =>
        c.from === null
          ? `新增“${c.competency}”要求 ${c.to} 级`
          : c.to === null
            ? `取消“${c.competency}”要求`
            : `“${c.competency}”要求从 ${c.from} 级调整为 ${c.to} 级`,
      )
      .join('；');
    const note =
      answer?.note ??
      `${changedText || '要求未变'}。发布后新增差距 ${impact.newGaps.count} 人${impact.newGaps.people.length ? `（${[...new Set(impact.newGaps.people.map((p) => p.name))].join('、')}）` : ''}${courses.length ? `，建议配套课程：${courses.map((c) => `《${c.title}》`).join('、')}` : ''}。`;
    await versions.writeNote(versionId, note, answer ? 'ai' : 'rule', hash);
    return { output: { versionId, source: answer ? 'ai' : 'rule' } };
  }

  /** 学习教练：按发展建议起草学习计划 (trigger = talentReview), for the head to confirm. */
  async function talentReviewPlan(run: AutomationRunContext, placementId: string) {
    const row = await reviews.placementRow(placementId);
    if (!row.decidedAt)
      return { status: 'skipped' as const, output: { reason: 'notDecided' } };
    if (row.learningPlanId)
      return { status: 'skipped' as const, output: { reason: 'exists' } };
    const employee = await ctx.employee(str(row.employeeId));
    if (employee.status === 'leave')
      return { status: 'skipped' as const, output: { reason: 'left' } };
    const actions = json<{ type: string; note: string }[]>(row.developmentActions, []);
    const requirements = employee.positionId
      ? await ctx.requirementsOf(employee.positionId)
      : [];
    const levels = (await ctx.currentLevels([employee.id])).get(employee.id) ?? new Map();
    const weak = requirements.filter((r) => (levels.get(r.competencyId) ?? 0) < r.requiredLevel);
    const competencyIds = (weak.length ? weak : requirements).map((r) => r.competencyId);
    const content = (await ctx.plans().searchContent({ competencyIds }))
      .sort((a, b) => (a.type === 'course' ? 0 : 1) - (b.type === 'course' ? 0 : 1))
      .slice(0, 3);
    run.summarize(`盘点发展计划：落位 ${placementId}`);
    run.reference({ placementId });
    if (!content.length)
      return { output: { placementId, plan: null, reason: 'noContent' } };
    const titles = await ctx.competencyTitles();
    const due = addDays(ctx.today(), 60);
    const review = await reviews.reviewRow(str(row.talentReviewId));
    const summary = `${review.title}的发展建议：${actions.map((a) => a.note || a.type).join('；')}。建议学习${content.map((c) => `《${c.title}》`).join('、')}，由上级确认后指派。`;
    const input = {
      employeeId: employee.id,
      trigger: 'talentReview',
      triggerRef: { placementId, talentReviewId: review.id },
      summary: summary.slice(0, 4000),
      items: content.map((item) => {
        const competencyId =
          competencyIds.find((c) => item.competencyIds.includes(c)) ?? null;
        return {
          type: item.type,
          refId: item.id,
          competencyId,
          reason: `发展建议：${titles.get(competencyId ?? '') ?? '岗位能力'}`,
          dueDate: due,
        };
      }),
    };
    let plan: { id: string };
    try {
      plan = await ctx.plans().createDraft(run.owner, input, {
        source: 'ai',
        fallbackReviewerUserId: review.ownerUserId,
        automated: true,
      });
    } catch (error) {
      // An open draft for the person: the placement's items join it (recorded in its triggerRef).
      if (!(error instanceof HrError) || error.code !== 'PLAN_DRAFT_EXISTS') throw error;
      plan = await ctx.plans().createDraft(
        run.owner,
        { ...input, mergeIntoDraft: true },
        { source: 'ai', fallbackReviewerUserId: review.ownerUserId, automated: true },
      );
    }
    await database
      .query()
      .updateTable('talentPlacements')
      .set({ learningPlanId: plan.id, updatedAt: new Date() })
      .where('id', '=', placementId)
      .execute();
    await run.recordItems('learningPlan', [{ id: plan.id, hash: null }]);
    return { output: { placementId, plan: plan.id } };
  }

  return {
    prePlacement,
    refreshSuggestedBox,
    saveSuggestion,
    successorRecommend,
    successionRisk,
    quarterly,
    versionChangeNote,
    talentReviewPlan,
    structured,
    reportSchema,
  };
}

export type TalentAnalyst = ReturnType<typeof createTalentAnalyst>;
