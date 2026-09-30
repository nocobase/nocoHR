/**
 * V4-13 人才盘点与其他: the services of the step, built once by the provider
 * (server/providers/hr/index.ts, V4-13 block) and resolved through
 * `talentReviewServicesToken`. Event work starts in the background after the
 * request that caused it has answered; every run goes through the automation
 * framework (switch, owner, run record) and is deduplicated there.
 */
import { z } from 'zod';

import { authorizeAction } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import type { ActorContext } from '../framework-service.js';
import type { JobEvent } from '../job-events.js';
import { HrError, str } from '../shared.js';
import { createAgentService } from './agents.js';
import { createTalentAnalyst, TALENT_REVIEW_AUTOMATIONS } from './analyst.js';
import {
  readTalentReviewSettings,
  SETTINGS_ID,
  talentReviewSettingsSchema,
  type TalentReviewSettings,
} from './config.js';
import { createTalentReviewContext, type TalentReviewDeps } from './context.js';
import { createEvaluationService } from './evaluations.js';
import { placementEvidence } from './evidence.js';
import { createInstructorService } from './instructors.js';
import { createKnowledgeDistiller } from './knowledge.js';
import { createModelVersionService } from './model-versions.js';
import { createPracticalService } from './practicals.js';
import { createReviewService } from './reviews.js';
import { createSuccessionService } from './succession.js';
import { createTranslationService, type ContentType } from './translations.js';

export { TALENT_REVIEW_AUTOMATIONS };

type Work = (run: AutomationRunContext) => Promise<{
  status?: 'succeeded' | 'skipped';
  output?: Record<string, unknown>;
}>;

/** Which settings each part of the settings page may write, and the action it needs. */
const SECTIONS: Record<
  string,
  { resource: string; action: string; keys: (keyof TalentReviewSettings)[] }
> = {
  review: {
    resource: 'talent.talentReview',
    action: 'manage',
    keys: [
      'ratingBands',
      'potentialQuestions',
      'potentialHighFrom',
      'potentialMediumFrom',
      'boxActions',
      'successorCount',
      'riskCooldownDays',
      'quarterMonths',
      'practicalPassRule',
      'knowledgeMergeThreshold',
      'glossary',
    ],
  },
  evaluation: {
    resource: 'talent.trainingEvaluation',
    action: 'configure',
    keys: [
      'l1Questions',
      'l3Questions',
      'l1DueDays',
      'l3AfterDays',
      'l3DueDays',
      'evaluationReminderDays',
    ],
  },
  agent: {
    resource: 'talent.agentClient',
    action: 'manage',
    keys: ['agentRateLimitPerMinute', 'agentTokenMaxDays'],
  },
};

export function createTalentReviewServices(deps: TalentReviewDeps) {
  const ctx = createTalentReviewContext(deps);
  const A = TALENT_REVIEW_AUTOMATIONS;
  const run = (
    key: string,
    dedupeKey: string | undefined,
    triggerRef: Record<string, unknown>,
    work: Work,
    trigger: 'event' | 'manual' = 'event',
  ) => deps.automation().run(key, trigger, { dedupeKey, triggerRef }, work);
  const later = (key: string, dedupeKey: string, ref: Record<string, unknown>, work: Work) =>
    deps.background(key, () => run(key, dedupeKey, ref, work));

  const holder: { analyst?: ReturnType<typeof createTalentAnalyst> } = {};
  const analyst = () => {
    if (!holder.analyst) throw new Error('talent analyst not ready');
    return holder.analyst;
  };

  const reviews = createReviewService(ctx, {
    onPreparing: (reviewId) =>
      later(A.prePlacement, reviewId, { reviewId }, (r) => analyst().prePlacement(r, reviewId)),
    onPotentialAssessed: (placementId) =>
      deps.background('talentReview.refreshSuggestion', () =>
        analyst().refreshSuggestedBox(placementId),
      ),
    onPlacementConfirmed: (placementId) =>
      later(A.talentReviewPlans, placementId, { placementId }, (r) =>
        analyst().talentReviewPlan(r, placementId),
      ),
  });
  const succession = createSuccessionService(ctx, {
    onPlanCreated: (planId) =>
      later(A.successorRecommend, `plan:${planId}`, { planId }, (r) =>
        analyst().successorRecommend(r, planId),
      ),
    onRisk: (planId, reason, ref) =>
      later(A.successionRisk, ref, { planId, reason }, (r) =>
        analyst().successionRisk(r, planId, reason),
      ),
  });
  const versions = createModelVersionService(ctx, {
    onDraftSaved: (versionId) =>
      deps.background(A.versionChangeNote, async () => {
        const row = await versions.versionRow(versionId);
        const current = await versions.currentOf(row.positionId);
        const hash = versions.contentHash(row, current?.snapshot ?? []);
        return run(A.versionChangeNote, `${versionId}:${hash}`, { versionId }, (r) =>
          analyst().versionChangeNote(r, versionId),
        );
      }),
  });
  holder.analyst = createTalentAnalyst({ ctx, ai: deps.ai, reviews, succession, versions });
  const practicals = createPracticalService(ctx, {
    ai: deps.ai,
    // 实操记录签字完成: 发证与复审续发 (the certification service asks practicalGate).
    onCompleted: (employeeId) =>
      deps.background('talentReview.practicalCertification', () =>
        deps.certifications().evaluate(employeeId),
      ),
  });
  const instructors = createInstructorService(ctx);
  const evaluations = createEvaluationService(ctx);
  const knowledge = createKnowledgeDistiller(ctx, { ai: deps.ai });
  const translations = createTranslationService(ctx, {
    ai: deps.ai,
    onRequested: async (type, id, hash) => {
      // The instructor waits for the draft; the run is recorded, and done directly when switched off or unowned.
      const outcome = await run(A.translationDraft, `${type}:${id}:${hash}`, { type, id }, (r) =>
        translations.draft(r, type, id),
      );
      if (outcome.status === 'disabled' || (outcome.status === 'skipped' && !('output' in outcome && outcome.output)))
        await translations.draft(null, type, id);
    },
  });
  const agents = createAgentService(ctx);

  /** 培训效果季报 (talentAnalyst.trainingEffectReport). */
  async function trainingEffectReport(r: AutomationRunContext) {
    const settings = await ctx.settings();
    const today = ctx.today();
    const month = Number(today.slice(5, 7));
    if (r.trigger === 'schedule' && !settings.quarterMonths.includes(month))
      return { status: 'skipped' as const, output: { reason: 'notQuarterStart' } };
    const from = new Date(`${today}T00:00:00Z`);
    from.setUTCMonth(from.getUTCMonth() - 3);
    const rows = (await ctx.database
      .query()
      .selectFrom('trainingEvaluations')
      .selectAll()
      .where('completedAt', '>=', from)
      .execute());
    const summary = await evaluations.aggregate(rows);
    const rated = summary.courses.filter((c) => c.l1Average !== null);
    r.summarize(`培训效果季报：${summary.courses.length} 门课程，${summary.instructors.length} 位讲师`);
    if (!rated.length && !summary.courses.length)
      return { status: 'skipped' as const, output: { reason: 'noEvaluations' } };
    const lowest = [...rated].sort((a, b) => a.l1Average! - b.l1Average!)[0];
    const lowPass = summary.courses.filter((c) => c.examPassRate !== null && c.examPassRate < 70);
    const lowChange = summary.courses.filter((c) => c.l3Average !== null && c.l3Average < 3);
    const answer = await analyst().structured(
      r,
      'talentAnalyst',
      '培训效果季报',
      `根据培训评估汇总写一份季报（不超过 400 字）：指出满意度最低的课程和讲师、考试通过率低或行为改变少的课程，并给出可能原因（内容、讲解、练习、与工作的关联）。只给建议，不评价个人品质。
汇总（JSON）：${JSON.stringify(summary).slice(0, 12_000)}`,
      analyst().reportSchema,
    );
    const content =
      answer?.content ??
      [
        lowest
          ? `满意度最低的课程：《${lowest.title}》，平均 ${lowest.l1Average} 分（${lowest.l1Responses} 份）；可能原因：内容与岗位工作的关联不够或讲解节奏偏快，建议复核课程内容并收集学员意见。`
          : '本季度没有已提交的课后满意度评估。',
        lowPass.length
          ? `考试通过率偏低：${lowPass.map((c) => `《${c.title}》${c.examPassRate}%`).join('、')}；可能原因：练习不足或题目与课程重点不一致。`
          : '',
        lowChange.length
          ? `行为改变评价偏低：${lowChange.map((c) => `《${c.title}》`).join('、')}；建议增加实操练习与课后跟进。`
          : '',
      ]
        .filter(Boolean)
        .join('\n');
    const instructorUsers = summary.instructors
      .map((i) => i.userId)
      .filter((u): u is string => Boolean(u));
    const quarter = `${today.slice(0, 4)}Q${Math.floor((month - 1) / 3) + 1}`;
    const recipients = [...new Set([r.owner.userId, ...instructorUsers])];
    const sent = await ctx.platform.reminderOnce(`trainingReport:${quarter}`, () =>
      ctx.platform.notify({
        key: `trainingReport:${quarter}`,
        userIds: recipients,
        message: 'trainingEffectReport',
        params: { quarter, summary: content.slice(0, 400) },
        path: '/talent/training-evaluations?tab=summary',
      }),
    );
    r.reference({ quarter, courses: summary.courses.length });
    return sent
      ? { output: { quarter, recipients: recipients.length } }
      : { status: 'skipped' as const, output: { quarter, reason: 'alreadySent' } };
  }

  const scheduled: Record<string, Work> = {
    [A.successorRecommend]: (r) => analyst().quarterly(r, 'recommend'),
    [A.successionRisk]: (r) => analyst().quarterly(r, 'risk'),
    [A.trainingEffectReport]: trainingEffectReport,
    [A.knowledgeDistill]: (r) => knowledge.distill(r),
  };

  async function writeSettings(actor: ActorContext, section: string, input: unknown) {
    const spec = SECTIONS[section];
    if (!spec) throw new HrError('INVALID_INPUT', 400);
    await authorizeAction(actor.authz, spec.resource, spec.action);
    const current = await readTalentReviewSettings(ctx.database);
    const patch = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    if (Object.keys(patch).some((k) => !spec.keys.includes(k as keyof TalentReviewSettings)))
      throw new HrError('INVALID_INPUT', 400);
    const parsed = talentReviewSettingsSchema.safeParse({ ...current.value, ...patch });
    if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
    const now = new Date();
    const exists = await ctx.database
      .query()
      .selectFrom('personnelSettings')
      .select(['id'])
      .where('id', '=', SETTINGS_ID)
      .executeTakeFirst();
    if (exists)
      await ctx.database
        .query()
        .updateTable('personnelSettings')
        .set({ value: parsed.data, revision: current.revision + 1, updatedBy: actor.userId, updatedAt: now })
        .where('id', '=', SETTINGS_ID)
        .execute();
    else
      await ctx.database
        .query()
        .insertInto('personnelSettings')
        .values({ id: SETTINGS_ID, value: parsed.data, revision: 1, updatedBy: actor.userId, createdAt: now, updatedAt: now })
        .execute();
    return readTalentReviewSettings(ctx.database);
  }

  return {
    context: ctx,
    reviews,
    succession,
    versions,
    practicals,
    instructors,
    evaluations,
    knowledge,
    translations,
    agents,
    get analyst() {
      return analyst();
    },
    evidence: (placementId: string) => placementEvidence(ctx, placementId),
    scheduled,

    async readSettings(actor: ActorContext) {
      const allowed = await Promise.all(
        Object.values(SECTIONS).map((s) => ctx.can(actor, s.resource, s.action)),
      );
      if (!allowed.some(Boolean)) throw new HrError('FORBIDDEN', 403);
      return readTalentReviewSettings(ctx.database);
    },
    writeSettings,

    /** Retrying a failed event run with its trigger object. */
    retry(task: string, triggerRef: Record<string, unknown>): Work | undefined {
      const ref = (name: string) => {
        const value = triggerRef[name];
        if (typeof value !== 'string' || !value)
          throw new HrError('AUTOMATION_RETRY_UNSUPPORTED', 400);
        return value;
      };
      switch (task) {
        case A.prePlacement:
          return (r) => analyst().prePlacement(r, ref('reviewId'));
        case A.talentReviewPlans:
          return (r) => analyst().talentReviewPlan(r, ref('placementId'));
        case A.successorRecommend:
          return triggerRef.planId
            ? (r) => analyst().successorRecommend(r, ref('planId'))
            : undefined;
        case A.successionRisk:
          return triggerRef.planId
            ? (r) => analyst().successionRisk(r, ref('planId'), ref('reason'))
            : undefined;
        case A.versionChangeNote:
          return (r) => analyst().versionChangeNote(r, ref('versionId'));
        case A.structureObservation:
          return (r) => practicals.structure(r, ref('recordId'));
        case A.draftPracticalChecklist:
          return (r) =>
            practicals.draftChecklist(r, {
              documentId: ref('documentId'),
              competencyIds: Array.isArray(triggerRef.competencyIds)
                ? (triggerRef.competencyIds as string[])
                : [],
              ownerUserId: ref('ownerUserId'),
            });
        case A.translationDraft:
          return (r) => translations.draft(r, ref('type') as ContentType, ref('id'));
        default:
          return undefined;
      }
    },

    /** 让考官整理: the assessor's click; unchanged notes are answered as they are. */
    async structureRecord(actor: ActorContext, recordId: string) {
      const { unchanged, notesHash } = await practicals.prepareStructure(actor, recordId);
      if (!unchanged) {
        const outcome = await run(
          A.structureObservation,
          `${recordId}:${notesHash}`,
          { recordId },
          (r) => practicals.structure(r, recordId),
        );
        if (outcome.status === 'disabled' || outcome.status === 'failed' || (outcome.status === 'skipped' && !('output' in outcome && outcome.output)))
          await practicals.structure(null, recordId);
      }
      return { ...(await practicals.getRecord(actor, recordId)), restructured: !unchanged };
    },

    /** 考官起草考核表 from a work instruction (instructor or hr.admin). */
    async draftChecklist(actor: ActorContext, input: unknown) {
      await authorizeAction(actor.authz, 'talent.practical', 'manageTemplates');
      const parsed = z
        .object({
          documentId: z.string().min(1).max(64),
          competencyIds: z.array(z.string().min(1).max(64)).max(20).default([]),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const body = { ...parsed.data, ownerUserId: actor.userId };
      const outcome = await run(
        A.draftPracticalChecklist,
        undefined,
        body,
        (r) => practicals.draftChecklist(r, body),
        'manual',
      );
      const output =
        'output' in outcome && outcome.output
          ? outcome.output
          : (await practicals.draftChecklist(null, body)).output;
      return practicals.templateRow(str(output.assessmentId));
    },

    /** 手动触发 (hr.admin): the quarterly and weekly work, as the automation's owner. */
    async runNow(actor: ActorContext, task: string) {
      await deps.automation().assertCanRun(actor, task);
      const work = scheduled[task];
      if (!work) throw new HrError('AUTOMATION_EVENT_ONLY', 400);
      return deps.automation().run(task, 'manual', {}, work);
    },

    /** 每天 09:00 (scheduler target `app.hr-talent-review`): evaluation tasks, version reconciliation. */
    async runDaily() {
      return {
        evaluations: await evaluations.runDaily(),
        versions: await versions.ensureAll(),
      };
    },

    /** Hourly: translations whose original changed become outdated and are drafted again. */
    async runHourly() {
      const redraft = await translations.scanOutdated();
      for (const item of redraft)
        await run(A.translationDraft, `${item.type}:${item.id}:${item.hash}`, { type: item.type, id: item.id }, (r) =>
          translations.draft(r, item.type, item.id),
        );
      return { redrafted: redraft.length };
    },

    /** 课程任务完成、线下签到 → l1 (from the provider's course-completed handler). */
    onCourseCompleted: (employeeId: string, courseId: string) =>
      evaluations.onLearningCompleted(employeeId, courseId),

    /** The offboard job event (V1-02 处理器): 继任风险. */
    onJobEvent: (event: JobEvent) => succession.onJobEvent(event),
  };
}

export type TalentReviewServices = ReturnType<typeof createTalentReviewServices>;
