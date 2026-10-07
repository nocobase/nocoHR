/**
 * What each AI employee does without being asked (V1, "总纲 · AI 员工约定").
 * Every task runs through the automation service, so it respects the task's
 * switch, runs as the task's owner, is recorded, and a repeated trigger is a
 * no-op. The deterministic part — which positions, documents, gaps or
 * renewals qualify — is decided here by rules; the AI writes the content
 * (drafts, topics, suggestions, messages) as structured output, and this code
 * validates it and writes drafts only.
 *
 * When no model is available, tasks that only word a message fall back to a
 * rule-based text (the run is marked `fallback`); tasks whose product is AI
 * content (drafting a position model, a course, questions) fail and are
 * recorded as failed, to be retried on the next trigger. Drafting a position
 * model is the one partial exception: confirmed competencies its job
 * description names are still proposed, each with the clause that names
 * them, and nothing new is invented.
 */
import type { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from './ai-runner.js';
import { guardedWording } from './ai-text-guard.js';
import {
  clauseListing,
  describeSourceClauses,
  matchClauses,
  positionClauses,
  resolveSourceClauses,
  sourceClauseOf,
  type SourceClause,
} from './jd-clauses.js';
import { authorizeAction, scopeForUser } from './authorize.js';
import type {
  AutomationRunContext,
  AutomationService,
  RunOutcome,
} from './automation.js';
import {
  computeCompetencyIssues,
  computePositionIssues,
} from './competency-issues.js';
import { createTrainingAutomation } from './training-automation.js';
// V3-09
import {
  probationLearning,
  probationLearningText,
  type ProbationLearning,
} from './learning-summary.js';
import { createExamAutomation } from './exam-automation.js';
import type { ActorContext } from './framework-service.js';
import { createHrAssistantAutomation } from './hr-assistant-automation.js';
import { createHrAssistantChanges } from './hr-assistant-changes.js';
import { createHrAssistantPrep } from './hr-assistant-prep.js';
import { createHrAssistantSync } from './hr-assistant-sync.js';
import { createHrAssistantAttendance } from './hr-assistant-attendance.js';
import { createConflictCheck } from './knowledge-conflicts.js';
import type { OrganizationService } from './organization-service.js';
import { draftHash } from './draft-snapshots.js';
import { runWeeklyBriefs } from './maintenance.js';
import type { Platform } from './platform.js';
import { json } from './platform.js';
import { addDays, HrError, newId, str } from './shared.js';
import { driveManagerToken } from '@nocobase/app-server/drive';
import {
  certificationServiceToken,
  checklistServiceToken,
  complianceServiceToken,
  examServiceToken,
  hrCoreServiceToken,
  imChannelToken,
  knowledgeServiceToken,
  learningServiceToken,
  orgSyncServiceToken,
  personnelSettingsToken,
  positionAliasServiceToken,
  scheduleServiceToken,
  talentServiceToken,
  // V3-11
  profileServicesToken,
} from './tokens.js';
// V2-07
import { recruitingServicesToken } from './tokens.js';
// V4-12
import { performanceServicesToken } from './tokens.js';
// V4-13
import { talentReviewServicesToken } from './tokens.js';

export interface AutomationTasks {
  /** A scheduled or manually started task; `periodKey` dedupes scheduled runs. */
  runScheduled(
    key: string,
    trigger: 'schedule' | 'manual',
    periodKey?: string,
  ): Promise<RunOutcome>;
  /** Called hourly: runs every scheduled task due now. */
  runDue(now: Date): Promise<Record<string, string>>;
  /** Called after the daily lifecycle rules: every `afterDaily` task, once per day. */
  runAfterDaily(): Promise<Record<string, RunOutcome>>;
  onDocumentReady(documentId: string): Promise<RunOutcome>;
  /** The content writer tops up questions and the practice coach drafts a scenario. */
  onCoursePublished(courseId: string): Promise<Record<string, RunOutcome>>;
  onRecertificationExhausted(attemptId: string): Promise<RunOutcome>;
  // V3-10
  /** An attempt with short answers awaits grading: the examiner suggests scores, then the instructor is told. */
  onAttemptAwaitingGrading(attemptId: string): Promise<RunOutcome>;
  /** An ordinary attempt failed: the learning coach drafts a remedial plan and tells the candidate. */
  onExamFailed(attemptId: string): Promise<RunOutcome>;
  /** A 任职资格认证 certificate was issued: the certification steward prepares the appointment material. */
  onCertificateQualified(certificateId: string): Promise<RunOutcome>;
  /** After an employee import commits: the HR assistant's health check, once per batch. */
  onEmployeesImported(batchId: string): Promise<RunOutcome>;
  /** V1-03: after a full sync, explain its new pending items at once; incremental ones wait for the merge window. */
  onOrgSyncFinished(run: {
    id: string;
    mode: 'full' | 'incremental';
  }): Promise<RunOutcome | undefined>;
  /** V2-05: a published cell an approved leave blocks gets cover suggestions, once per set of candidates. */
  onLeaveConflict(scheduleId: string): Promise<RunOutcome>;
  /** V4-14: a published cell newly blocked by certificationMissing; certified cover, once per conflict (dedupeKey). */
  onQualificationConflict(
    scheduleId: string,
    dedupeKey: string,
  ): Promise<RunOutcome>;
  /** V2-05: after the month's summaries are generated, the month-end check for HR, once per month. */
  onAttendanceMonthGenerated(
    month: string,
    trigger: 'schedule' | 'manual',
  ): Promise<RunOutcome>;
  /** V1-04: a document or version became ready; check it for conflicts once per version. */
  onDocumentReadyForConflicts(documentId: string): Promise<RunOutcome>;
  /** Called every minute: explains incremental syncs' items once the oldest waited the merge interval. */
  explainIncrementalSync(): Promise<RunOutcome | undefined>;
  /** V1-02: a change checklist was created or its items changed; the notes are rewritten once per version. */
  onChecklistChanged(checklistId: string): Promise<RunOutcome>;
  /** V1-02: a contract was saved or an onboarding took effect; that employee's compliance is checked now. */
  onComplianceTrigger(employeeId: string): Promise<RunOutcome>;
  /** After an HR administrator attaches an ID card, diploma or contract scan: recognition, once per attachment. */
  onAttachmentUploaded(input: {
    attachmentId: string;
    uploaderUserId: string;
  }): Promise<RunOutcome>;
  /** An HR administrator re-runs the health check of one batch; a new run and report. */
  rerunImportCheck(ctx: ActorContext, batchId: string): Promise<RunOutcome>;
  /** Re-runs a failed run of an event-driven task with the same trigger object. */
  retryRun(ctx: ActorContext, runId: string): Promise<RunOutcome>;
  /** V3-09: after an onboarding, transfer or promotion was processed, the coach's plan for what its path does not cover. */
  onJobEventProcessed(eventId: string): Promise<RunOutcome>;
  /** V3-09: after an assessment was recorded, the coach checks that employee's development targets. */
  onAssessmentRecorded(employeeId: string): Promise<RunOutcome>;
}

export interface AutomationTasksDeps {
  readonly container: ServiceContainer;
  readonly automation: AutomationService;
  readonly ai: AIRunner;
  readonly platform: Platform;
  readonly organization: () => OrganizationService;
  /** The application's default language. */
  readonly locale: () => string;
}

const FRAMEWORK_ADVISOR = 'talent.frameworkAdvisor';
const KNOWLEDGE_ASSISTANT = 'talent.knowledgeAssistant';
const CONTENT_WRITER = 'talent.contentWriter';
const STEWARD = 'talent.certificationSteward';
/** At most this many positions are drafted in one run, to bound its duration. */
const POSITIONS_PER_RUN = 3;
const DOCUMENT_TEXT_LIMIT = 24_000;
const REMEDIAL_DUE_DAYS = 14;
const WEAK_RATE = 0.7;

function list(items: readonly string[], limit = 5): string {
  return `${items.slice(0, limit).join('、')}${items.length > limit ? ' 等' : ''}`;
}

export function createAutomationTasks(
  deps: AutomationTasksDeps,
): AutomationTasks {
  const { container, automation, ai, platform } = deps;
  const { database } = platform;
  const talent = () => container.resolve(talentServiceToken);
  const knowledge = () => container.resolve(knowledgeServiceToken);
  const learning = () => container.resolve(learningServiceToken);
  const exams = () => container.resolve(examServiceToken);
  const certifications = () => container.resolve(certificationServiceToken);

  async function structured<T>(
    run: AutomationRunContext,
    employee: string,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
  ): Promise<T> {
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
  }

  /**
   * The AI's wording, or the rule-based text when no model is available. A reply that describes the
   * instructions instead of following them (describesFormat) is asked for once more, then replaced by the
   * rule-based text, so it never reaches a person.
   */
  async function worded(
    run: AutomationRunContext,
    compose: () => Promise<string>,
    fallback: () => string,
  ): Promise<string> {
    return guardedWording(compose, fallback, {
      unavailable: (error) => error instanceof AIUnavailableError,
      onFallback: () => run.markFallback(),
    });
  }

  // ---------- 体系顾问 ----------

  async function draftNewPositions(run: AutomationRunContext) {
    await authorizeAction(run.owner.authz, FRAMEWORK_ADVISOR, 'use');
    const query = database.query();
    const withRequirements = new Set(
      (
        await query
          .selectFrom('positionRequirements')
          .select(['positionId'])
          .execute()
      ).map((r) => str(r.positionId)),
    );
    const candidates = (
      await query
        .selectFrom('positions')
        .select([
          'id',
          'title',
          'grade',
          'responsibilities',
          'jdText',
          'jdStatus',
          'jobFamilyId',
        ])
        .where('active', '=', true)
        .where('aiDraftedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .execute()
    ).filter(
      (p) =>
        // V3-08: a position with only an uploaded 岗位说明书 qualifies too.
        ((p.responsibilities != null && str(p.responsibilities).trim() !== '') ||
          (p.jdStatus === 'ready' &&
            p.jdText != null &&
            str(p.jdText).trim() !== '')) &&
        !withRequirements.has(str(p.id)),
    );
    if (!candidates.length)
      return { status: 'skipped' as const, output: { positions: [] } };
    const batch = candidates.slice(0, POSITIONS_PER_RUN);
    run.summarize(
      `待起草岗位 ${candidates.length} 个，本次处理：${list(batch.map((p) => str(p.title)))}`,
    );
    const existing = (
      await query
        .selectFrom('competencies')
        .select([
          'id',
          'code',
          'title',
          'category',
          'description',
          'maxLevel',
          'reviewStatus',
        ])
        .where('active', '=', true)
        .execute()
    ).map((c) => ({
      id: str(c.id),
      code: str(c.code),
      title: str(c.title),
      category: str(c.category),
      description: c.description == null ? '' : str(c.description),
      maxLevel: Number(c.maxLevel),
      confirmed: c.reviewStatus === 'confirmed',
    }));
    const schema = z.object({
      items: z
        .array(
          z.object({
            existingCompetencyId: z
              .string()
              .nullable()
              .describe(
                'The id of an existing competency to reuse, or null to create one.',
              ),
            code: z.string().max(64).nullable(),
            title: z.string().max(200).nullable(),
            category: z.enum(['skill', 'quality', 'qualification']).nullable(),
            description: z.string().max(1000).nullable(),
            maxLevel: z.number().int().min(1).max(5).nullable(),
            levels: z
              .array(
                z.object({
                  level: z.number().int().min(1).max(5),
                  title: z.string().max(50),
                  behaviors: z.string().max(500),
                }),
              )
              .nullable(),
            requiredLevel: z.number().int().min(1).max(5),
            mandatory: z.boolean(),
            // V3-08 每项注明出自说明书哪一条: the numbered clauses this item comes from.
            sourceClauses: z
              .array(
                z.object({
                  clause: z
                    .string()
                    .max(20)
                    .describe('The clause number as listed, such as J3 or D2.'),
                  quote: z
                    .string()
                    .max(200)
                    .nullable()
                    .describe('A short quote copied from that clause.'),
                }),
              )
              .max(3)
              .nullable(),
          }),
        )
        .min(1)
        .max(12),
    });
    type DraftItem = Omit<
      z.infer<typeof schema>['items'][number],
      'sourceClauses'
    > & { sourceClauses: SourceClause[] };
    const drafted: {
      id: string;
      title: string;
      competencies: number;
      requirements: number;
      sourceClauses: { competencyId: string; sourceClauses: SourceClause[] }[];
    }[] = [];
    let unavailable: AIUnavailableError | null = null;
    for (const position of batch) {
      // V3-08: the job description is the primary source when both exist; both are numbered clause by clause.
      const clauses = positionClauses({
        jdText:
          position.jdStatus === 'ready' && position.jdText
            ? str(position.jdText).slice(0, DOCUMENT_TEXT_LIMIT)
            : null,
        responsibilities: position.responsibilities
          ? str(position.responsibilities)
          : null,
      });
      const jdClauses = clauses.filter((c) => c.source === 'jd');
      const dutyClauses = clauses.filter((c) => c.source === 'duties');
      let items: DraftItem[];
      try {
        const result = await structured(
          run,
          'frameworkAdvisor',
          `新岗位自动起草：${str(position.title)}`,
          [
            `请为岗位「${str(position.title)}」（职级 ${position.grade == null ? '未设' : str(position.grade)}）起草能力模型。`,
            ...(jdClauses.length
              ? [
                  `岗位说明书（主要依据，已逐条编号）：\n${clauseListing(jdClauses)}`,
                ]
              : []),
            ...(dutyClauses.length
              ? [`职责说明（已逐条编号）：\n${clauseListing(dutyClauses)}`]
              : []),
            '要求：',
            '1. 6–12 项，覆盖专业技能（skill）与通用素质（quality）；法规或内部要求的持证事项列为资质类（qualification，maxLevel 为 1）。',
            '2. 优先复用下面已有的能力项：复用时 existingCompetencyId 填其 id，其余新建字段填 null；新建时 existingCompetencyId 为 null，并填写 code（小写英文加连字符）、title、category、description、maxLevel 和逐级 levels。',
            '3. 等级描述写成可观察的行为，逐级递进，不用“较好”“优秀”这类形容词。',
            '4. requiredLevel 不超过该能力项的最高等级。',
            '5. 每项在 sourceClauses 中注明出自上面哪一条：clause 填条目编号（如 J3、D2，只能用上面列出的编号），quote 摘录该条原文中的一小段；一项可对应 1–3 条。description 里不必再写依据，系统会按编号附上。',
            `已有能力项：${JSON.stringify(existing.map(({ confirmed: _, ...c }) => c))}`,
          ].join('\n'),
          schema,
        );
        items = result.items.map((item) => ({
          ...item,
          sourceClauses: resolveSourceClauses(item.sourceClauses, clauses),
        }));
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        // Without a model, only confirmed competencies the text names are proposed, each with the clause that names it;
        // nothing new is invented, and a position no clause matches waits for the model (the run fails).
        items = existing
          .filter((c) => c.confirmed)
          .map((c) => ({
            competency: c,
            matched: matchClauses(c.title, clauses),
          }))
          .filter((m) => m.matched.length > 0)
          .slice(0, 12)
          .map(({ competency, matched }) => ({
            existingCompetencyId: competency.id,
            code: null,
            title: null,
            category: null,
            description: null,
            maxLevel: null,
            levels: null,
            requiredLevel: Math.max(1, Math.ceil(competency.maxLevel / 2)),
            mandatory: competency.category === 'qualification',
            sourceClauses: matched.slice(0, 3).map(sourceClauseOf),
          }));
        if (!items.length) {
          // This position waits for the model; the others in the batch may still match.
          unavailable = error;
          continue;
        }
        run.markFallback();
      }
      const byId = new Map(existing.map((c) => [c.id, c]));
      let competencyCount = 0;
      let requirementCount = 0;
      const sourceClauses: {
        competencyId: string;
        sourceClauses: SourceClause[];
      }[] = [];
      for (const item of items) {
        let competencyId: string | undefined;
        let maxLevel = 5;
        const reused = item.existingCompetencyId
          ? byId.get(item.existingCompetencyId)
          : undefined;
        if (reused) {
          competencyId = reused.id;
          maxLevel = reused.maxLevel;
        } else if (
          item.code &&
          item.title &&
          item.category &&
          item.levels?.length
        ) {
          const sameCode = existing.find((c) => c.code === item.code);
          if (sameCode) {
            competencyId = sameCode.id;
            maxLevel = sameCode.maxLevel;
          } else {
            try {
              const created = await talent().saveCompetency(
                run.owner,
                null,
                {
                  code: item.code,
                  title: item.title,
                  category: item.category,
                  // V3-08: a new competency names the clause it was drafted from.
                  description: item.sourceClauses.length
                    ? [
                        item.description?.trim(),
                        describeSourceClauses(item.sourceClauses),
                      ]
                        .filter(Boolean)
                        .join('\n')
                        .slice(0, 2000)
                    : (item.description ?? undefined),
                  maxLevel:
                    item.category === 'qualification'
                      ? 1
                      : (item.maxLevel ?? item.levels.length),
                  levels:
                    item.category === 'qualification'
                      ? item.levels.slice(0, 1).map((l) => ({ ...l, level: 1 }))
                      : item.levels,
                },
                { source: 'ai', draft: true },
              );
              competencyId = created.id;
              maxLevel = created.maxLevel;
              existing.push({
                id: created.id,
                code: created.code,
                title: created.title,
                category: created.category,
                description: created.description ?? '',
                maxLevel: created.maxLevel,
                confirmed: false,
              });
              byId.set(created.id, existing[existing.length - 1]);
              await run.recordItems('competency', [
                {
                  id: created.id,
                  hash: await draftHash(database, 'competency', created.id),
                },
              ]);
              competencyCount += 1;
            } catch (error) {
              if (!(error instanceof HrError)) throw error;
            }
          }
        }
        if (!competencyId) continue;
        try {
          const requirement = await talent().saveRequirement(
            run.owner,
            str(position.id),
            {
              competencyId,
              requiredLevel: Math.min(item.requiredLevel, maxLevel),
              mandatory: item.mandatory,
            },
            { source: 'ai', draft: true, sourceClauses: item.sourceClauses },
          );
          await run.recordItems('positionRequirement', [
            {
              id: requirement.id,
              hash: await draftHash(
                database,
                'positionRequirement',
                requirement.id,
              ),
            },
          ]);
          requirementCount += 1;
          sourceClauses.push({
            competencyId,
            sourceClauses: item.sourceClauses,
          });
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
        }
      }
      await database
        .query()
        .updateTable('positions')
        .set({ aiDraftedAt: new Date(), updatedAt: new Date() })
        .where('id', '=', str(position.id))
        .execute();
      drafted.push({
        id: str(position.id),
        title: str(position.title),
        competencies: competencyCount,
        requirements: requirementCount,
        sourceClauses,
      });
      await platform.notify({
        key: `automation:positionDrafted:${str(position.id)}`,
        userIds: [run.owner.userId],
        message: 'automationPositionDrafted',
        params: {
          position: str(position.title),
          requirements: String(requirementCount),
          competencies: String(competencyCount),
          cited: String(
            sourceClauses.filter((r) => r.sourceClauses.length > 0).length,
          ),
        },
        path: `/talent/framework?position=${encodeURIComponent(str(position.id))}`,
      });
    }
    // Without a model and with nothing the rules could match, the run fails, to be retried on the next trigger.
    if (unavailable && !drafted.length) throw unavailable;
    return {
      output: {
        positions: drafted,
        remaining: candidates.length - batch.length,
      },
    };
  }

  async function dictionaryReview(run: AutomationRunContext) {
    await authorizeAction(run.owner.authz, FRAMEWORK_ADVISOR, 'use');
    const issues = await computeCompetencyIssues(database);
    // V3-08: the position framework is checked in the same run.
    const positionIssues = await computePositionIssues(database, {
      synonyms: String(run.params.synonyms ?? ''),
    });
    if (
      !issues.similarPairs.length &&
      !issues.idle.length &&
      !issues.vagueLevels.length &&
      !positionIssues.vacant.length &&
      !positionIssues.noGrade.length &&
      !positionIssues.similarPairs.length
    )
      return { status: 'skipped' as const, output: { issues, positionIssues } };
    run.summarize(
      `相似 ${issues.similarPairs.length} 对，闲置 ${issues.idle.length} 项，描述不可观察的等级 ${issues.vagueLevels.length} 条；半年无人在岗的岗位 ${positionIssues.vacant.length} 个，缺职级 ${positionIssues.noGrade.length} 个，名称相近 ${positionIssues.similarPairs.length} 对`,
    );
    run.reference({ ...issues, positionIssues });
    type Suggestion = {
      kind: 'merge' | 'deactivate' | 'rewrite' | 'position';
      competencies: string[];
      suggestion: string;
      reason: string;
    };
    const positionSuggestions = (): Suggestion[] => [
      ...positionIssues.vacant.map((p) => ({
        kind: 'position' as const,
        competencies: [p.title],
        suggestion: `确认岗位「${p.title}」是否仍需保留，或考虑停用`,
        reason: '半年内没有在岗员工',
      })),
      ...positionIssues.noGrade.map((p) => ({
        kind: 'position' as const,
        competencies: [p.title],
        suggestion: `为岗位「${p.title}」补充职级`,
        reason: '职级为空',
      })),
      ...positionIssues.similarPairs.map((p) => ({
        kind: 'position' as const,
        competencies: [p.a.title, p.b.title],
        suggestion: `核对岗位「${p.a.title}」与「${p.b.title}」是否重复`,
        reason: '名称规范化后相近',
      })),
    ];
    const ruleBased = (): Suggestion[] => [
      ...issues.similarPairs.map((p) => ({
        kind: 'merge' as const,
        competencies: [p.a.title, p.b.title],
        suggestion: `考虑合并「${p.a.title}」与「${p.b.title}」`,
        reason: `名称与定义相似度 ${Math.round(p.similarity * 100)}%`,
      })),
      ...issues.idle.map((c) => ({
        kind: 'deactivate' as const,
        competencies: [c.title],
        suggestion: `考虑停用「${c.title}」`,
        reason: '90 天内未被任何岗位、文档、课程、题目或评定引用',
      })),
      ...issues.vagueLevels.map((l) => ({
        kind: 'rewrite' as const,
        competencies: [l.title],
        suggestion: `改写「${l.title}」L${l.level} 的行为描述`,
        reason: `使用了不可观察的词：${l.words.join('、')}`,
      })),
      ...positionSuggestions(),
    ];
    let suggestions: Suggestion[];
    try {
      suggestions = (
        await structured(
          run,
          'frameworkAdvisor',
          '能力词典月检',
          [
            '请根据以下能力词典检查结果，整理成整改建议：建议合并的相似项（merge）、建议停用的闲置项（deactivate）、建议改写的等级描述（rewrite）。',
            '每条写明涉及的能力项名称、具体建议和理由；只给建议，不要假设已经修改。',
            JSON.stringify(issues),
            '岗位体系的问题（半年无人在岗的启用岗位、缺职级的岗位、名称相近的岗位）另列为 position 类建议，competencies 填岗位名称：',
            JSON.stringify(positionIssues),
          ].join('\n'),
          z.object({
            suggestions: z
              .array(
                z.object({
                  kind: z.enum(['merge', 'deactivate', 'rewrite', 'position']),
                  competencies: z.array(z.string()).min(1),
                  suggestion: z.string().max(500),
                  reason: z.string().max(500),
                }),
              )
              .min(1)
              .max(40),
          }),
        )
      ).suggestions;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
      suggestions = ruleBased();
    }
    const count = (kind: Suggestion['kind']) =>
      suggestions.filter((s) => s.kind === kind).length;
    await platform.notify({
      key: `automation:dictionaryReview:${run.runId}`,
      userIds: [run.owner.userId],
      message: 'automationDictionaryReview',
      params: {
        merge: String(count('merge')),
        deactivate: String(count('deactivate')),
        rewrite: String(count('rewrite')),
        positions: String(count('position')),
      },
      path: `/settings/ai-automations?run=${encodeURIComponent(run.runId)}`,
    });
    return { output: { suggestions } };
  }

  // ---------- 知识助手 ----------

  async function gapWeeklyReport(run: AutomationRunContext) {
    await authorizeAction(run.owner.authz, KNOWLEDGE_ASSISTANT, 'use');
    await authorizeAction(run.owner.authz, 'talent.knowledgeGap', 'view');
    const gaps = (
      await database
        .query()
        .selectFrom('knowledgeGaps')
        .select(['id', 'question'])
        .where('status', '=', 'open')
        .where('reportedAt', 'is', null)
        .orderBy('createdAt', 'asc')
        .execute()
    ).map((g) => ({ id: str(g.id), question: str(g.question) }));
    if (!gaps.length)
      return { status: 'skipped' as const, output: { topics: [] } };
    run.summarize(`未汇报的缺口 ${gaps.length} 条`);
    const known = new Set(gaps.map((g) => g.id));
    let grouped: { topic: string; gapIds: string[] }[];
    try {
      grouped = (
        await structured(
          run,
          'knowledgeAssistant',
          '知识缺口周报',
          [
            '以下是员工提出、知识库没能回答的问题。请把意思相同的问题归并成主题，每个主题起一个简短的名称（如“工作时间着装规定”），列出属于它的问题 id；每个问题只能属于一个主题。',
            JSON.stringify(gaps),
          ].join('\n'),
          z.object({
            topics: z
              .array(
                z.object({
                  topic: z.string().min(1).max(100),
                  gapIds: z.array(z.string()).min(1),
                }),
              )
              .min(1),
          }),
        )
      ).topics;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
      const byText = new Map<string, string[]>();
      for (const gap of gaps) {
        const key = gap.question.replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
        byText.set(key, [...(byText.get(key) ?? []), gap.id]);
      }
      grouped = [...byText.values()].map((ids) => ({
        topic: gaps.find((g) => g.id === ids[0])!.question.slice(0, 100),
        gapIds: ids,
      }));
    }
    // Every question lands in exactly one topic; anything the model left out becomes its own topic.
    const assigned = new Set<string>();
    const topics = grouped
      .map((t) => ({
        topic: t.topic,
        gapIds: t.gapIds.filter(
          (id) => known.has(id) && !assigned.has(id) && assigned.add(id),
        ),
      }))
      .filter((t) => t.gapIds.length);
    for (const gap of gaps)
      if (!assigned.has(gap.id))
        topics.push({ topic: gap.question.slice(0, 100), gapIds: [gap.id] });
    const report: {
      topic: string;
      count: number;
      documentId: string | null;
      documentTitle: string | null;
      ownerUserId: string | null;
    }[] = [];
    for (const topic of topics) {
      const [best] = await knowledge().search(run.owner, topic.topic, 1);
      const owner = best
        ? await database
            .query()
            .selectFrom('kbDocuments')
            .select(['ownerUserId'])
            .where('id', '=', best.documentId)
            .executeTakeFirst()
        : undefined;
      report.push({
        topic: topic.topic,
        count: topic.gapIds.length,
        documentId: best?.documentId ?? null,
        documentTitle: best?.documentTitle ?? null,
        ownerUserId: owner ? str(owner.ownerUserId) : null,
      });
    }
    const now = new Date();
    for (const topic of topics)
      await database
        .query()
        .updateTable('knowledgeGaps')
        .set({ topic: topic.topic, reportedAt: now, updatedAt: now })
        .where('id', 'in', topic.gapIds)
        .execute();
    const describe = (rows: typeof report) =>
      rows
        .map(
          (r) =>
            `${r.topic}（${r.count} 次）${r.documentTitle ? `→ 建议补充到《${r.documentTitle}》` : ''}`,
        )
        .join('；');
    await platform.notify({
      key: `automation:gapReport:${run.runId}:${run.owner.userId}`,
      userIds: [run.owner.userId],
      message: 'automationGapReport',
      params: {
        topics: String(report.length),
        questions: String(gaps.length),
        list: describe(report),
      },
      path: '/talent/knowledge?tab=gaps',
    });
    const owners = new Set(
      report
        .map((r) => r.ownerUserId)
        .filter((id): id is string => Boolean(id) && id !== run.owner.userId),
    );
    for (const ownerId of owners) {
      const own = report.filter((r) => r.ownerUserId === ownerId);
      await platform.notify({
        key: `automation:gapReport:${run.runId}:${ownerId}`,
        userIds: [ownerId],
        message: 'automationGapReport',
        params: {
          topics: String(own.length),
          questions: String(own.reduce((sum, r) => sum + r.count, 0)),
          list: describe(own),
        },
        path: '/talent/knowledge?tab=gaps',
      });
    }
    return { output: { topics: report } };
  }

  // ---------- 内容编写员 ----------

  async function draftCourseFromDocument(
    run: AutomationRunContext,
    documentId: string,
  ) {
    await authorizeAction(run.owner.authz, CONTENT_WRITER, 'use');
    const row = await database
      .query()
      .selectFrom('kbDocuments')
      .select([
        'id',
        'title',
        'ownerUserId',
        'autoDraftCourse',
        'active',
        'parseStatus',
      ])
      .where('id', '=', documentId)
      .executeTakeFirst();
    if (
      !row ||
      str(row.parseStatus) !== 'ready' ||
      !(row.active === true || row.active === 1)
    )
      return {
        status: 'skipped' as const,
        output: { reason: 'documentNotReady' },
      };
    if (!(row.autoDraftCourse === true || row.autoDraftCourse === 1))
      return { status: 'skipped' as const, output: { reason: 'autoDraftOff' } };
    const courses = await database
      .query()
      .selectFrom('courses')
      .select(['id'])
      .where('sourceDocumentId', '=', documentId)
      .execute();
    if (courses.length)
      return {
        status: 'skipped' as const,
        output: {
          reason: 'documentHasCourse',
          courseIds: courses.map((c) => str(c.id)),
        },
      };
    const document = await knowledge().readDocument(run.owner, documentId);
    run.summarize(
      `文档《${document.title}》，${document.sections.length} 个小节`,
    );
    const text = document.sections
      .map((s) => `## ${s.title}\n${s.text}`)
      .join('\n\n')
      .slice(0, DOCUMENT_TEXT_LIMIT);
    const result = await structured(
      run,
      'contentWriter',
      `解析后生成课程草稿：${document.title}`,
      [
        `请把文档《${document.title}》改写成一门课程草稿。`,
        '要求：拆成 3–8 个章节，每节 5–10 分钟，正文用 Markdown，每节以“本节要点”收尾；只改写和组织原文内容，不增加原文没有的制度、数字或步骤；每节 sourceExcerpt 摘录它依据的原文句子。',
        `文档全文：\n${text}`,
      ].join('\n'),
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(1000),
        lessons: z
          .array(
            z.object({
              title: z.string().min(1).max(200),
              content: z.string().min(1).max(20_000),
              sourceExcerpt: z.string().min(1).max(2000),
              estimatedMinutes: z.number().int().min(1).max(60),
            }),
          )
          .min(1)
          .max(8),
      }),
    );
    const competencyIds = (
      await database
        .query()
        .selectFrom('kbDocumentCompetencies')
        .select(['competencyId'])
        .where('documentId', '=', documentId)
        .execute()
    ).map((r) => str(r.competencyId));
    const course = await learning().createCourseDraft(
      run.owner,
      {
        documentId,
        title: result.title,
        description: result.description,
        competencyIds,
        lessons: result.lessons,
      },
      { ownerUserId: str(row.ownerUserId) },
    );
    await run.recordItems('course', [
      { id: course.id, hash: await draftHash(database, 'course', course.id) },
    ]);
    await platform.notify({
      key: `automation:courseDrafted:${course.id}`,
      userIds: [str(row.ownerUserId)],
      message: 'automationCourseDrafted',
      params: { course: course.title, document: document.title },
      path: `/talent/courses/${encodeURIComponent(course.id)}`,
    });
    return { output: { courseId: course.id, lessons: course.lessonCount } };
  }

  async function fillCourseQuestions(
    run: AutomationRunContext,
    courseId: string,
  ) {
    await authorizeAction(run.owner.authz, CONTENT_WRITER, 'use');
    await authorizeAction(run.owner.authz, 'talent.question', 'manage');
    const course = await database
      .query()
      .selectFrom('courses')
      .select([
        'id',
        'title',
        'ownerUserId',
        'sourceDocumentId',
        'published',
        'active',
      ])
      .where('id', '=', courseId)
      .executeTakeFirst();
    if (!course || !(course.published === true || course.published === 1))
      return {
        status: 'skipped' as const,
        output: { reason: 'courseNotPublished' },
      };
    const target = Math.max(
      1,
      Math.round(Number(run.params.targetCount ?? 10)),
    );
    const documentId = course.sourceDocumentId
      ? str(course.sourceDocumentId)
      : null;
    let builder = database
      .query()
      .selectFrom('questions')
      .select(['id', 'stem'])
      .where('active', '=', true);
    builder = documentId
      ? builder.where((eb) =>
          eb.or([
            eb('sourceCourseId', '=', courseId),
            eb('sourceDocumentId', '=', documentId),
          ]),
        )
      : builder.where('sourceCourseId', '=', courseId);
    const existing = await builder.execute();
    if (existing.length >= target)
      return {
        status: 'skipped' as const,
        output: { reason: 'enoughQuestions', count: existing.length },
      };
    const need = target - existing.length;
    const single = Math.round(need * 0.5);
    const multiple = Math.round(need * 0.2);
    const judge = Math.max(0, need - single - multiple);
    const lessons = await database
      .query()
      .selectFrom('lessons')
      .select(['title', 'content', 'sourceExcerpt'])
      .where('courseId', '=', courseId)
      .orderBy('sortOrder', 'asc')
      .execute();
    run.summarize(
      `课程《${str(course.title)}》已有 ${existing.length} 道题，补足到 ${target} 道`,
    );
    const result = await structured(
      run,
      'contentWriter',
      `课程发布后补齐题目：${str(course.title)}`,
      [
        `请根据课程《${str(course.title)}》的内容出 ${need} 道题：单选 ${single}、多选 ${multiple}、判断 ${judge}。`,
        '要求：每题只考课程原文明确写出的内容，sourceExcerpt 摘录依据的原文；干扰项似是而非但不能与原文冲突；不出“以上都对 / 都不对”；判断题正反大致均衡；不要与已有题目重复。',
        '单选、多选：options 为 [{key: "A", text}…]，correctKeys 为正确选项；判断题：options 为空数组，judgeAnswer 为 true 或 false。',
        `课程章节：${JSON.stringify(lessons.map((l) => ({ title: str(l.title), content: l.content == null ? '' : str(l.content).slice(0, 4000), sourceExcerpt: l.sourceExcerpt == null ? '' : str(l.sourceExcerpt) })))}`,
        `已有题目：${JSON.stringify(existing.map((q) => str(q.stem)))}`,
      ].join('\n'),
      z.object({
        questions: z
          .array(
            z.object({
              type: z.enum(['single', 'multiple', 'judge']),
              stem: z.string().min(1).max(1000),
              options: z
                .array(
                  z.object({
                    key: z.string().max(2),
                    text: z.string().min(1).max(500),
                  }),
                )
                .max(8),
              correctKeys: z.array(z.string().max(2)),
              judgeAnswer: z.boolean().nullable(),
              explanation: z.string().max(1000).nullable(),
              difficulty: z.enum(['easy', 'medium', 'hard']),
              sourceExcerpt: z.string().min(1).max(2000),
            }),
          )
          .min(1)
          .max(need + 2),
      }),
    );
    const competencyIds = (
      await database
        .query()
        .selectFrom('courseCompetencies')
        .select(['competencyId'])
        .where('courseId', '=', courseId)
        .execute()
    ).map((r) => str(r.competencyId));
    const created: string[] = [];
    // One at a time: a question the model got wrong is skipped instead of rejecting the batch.
    for (const q of result.questions.slice(0, need)) {
      const answer =
        q.type === 'judge'
          ? q.judgeAnswer
          : q.type === 'single'
            ? q.correctKeys[0]
            : q.correctKeys;
      try {
        const { ids } = await exams().createQuestionDrafts(
          run.owner,
          {
            sourceCourseId: courseId,
            sourceDocumentId: documentId,
            questions: [
              {
                type: q.type,
                stem: q.stem,
                options: q.type === 'judge' ? [] : q.options,
                answer,
                explanation: q.explanation,
                difficulty: q.difficulty,
                sourceExcerpt: q.sourceExcerpt,
                competencyIds,
              },
            ],
          },
          { ownerUserId: str(course.ownerUserId) },
        );
        created.push(...ids);
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
      }
    }
    for (const id of created)
      await run.recordItems('question', [
        { id, hash: await draftHash(database, 'question', id) },
      ]);
    if (created.length)
      await platform.notify({
        key: `automation:questionsDrafted:${run.runId}`,
        userIds: [str(course.ownerUserId)],
        message: 'automationQuestionsDrafted',
        params: { course: str(course.title), count: String(created.length) },
        path: `/talent/questions?sourceCourseId=${encodeURIComponent(courseId)}&review=mine`,
      });
    return {
      output: { created: created.length, before: existing.length, target },
    };
  }

  // ---------- 认证管家 ----------

  async function weeklyBrief(run: AutomationRunContext) {
    await authorizeAction(run.owner.authz, STEWARD, 'use');
    const report = await runWeeklyBriefs(container, platform.timeZone);
    if (report.fallback) run.markFallback();
    run.summarize(`部门负责人 ${report.heads} 位`);
    return {
      status: report.sent ? ('succeeded' as const) : ('skipped' as const),
      output: { ...report },
    };
  }

  async function recertEscalation(run: AutomationRunContext) {
    await authorizeAction(run.owner.authz, STEWARD, 'use');
    const today = platform.currentDate();
    const rows = await database
      .query()
      .selectFrom('assignments')
      .innerJoin(
        'employeeCertificates',
        'employeeCertificates.id',
        'assignments.certificateId',
      )
      .innerJoin(
        'certifications',
        'certifications.id',
        'employeeCertificates.certificationId',
      )
      .select([
        'assignments.id as assignmentId',
        'assignments.employeeId as employeeId',
        'employeeCertificates.expiresAt as expiresAt',
        'certifications.id as certificationId',
        'certifications.title as certificationTitle',
        'certifications.escalateDays as escalateDays',
      ])
      .where('assignments.source', '=', 'recertification')
      .where('assignments.status', '=', 'notStarted')
      .where('assignments.escalatedAt', 'is', null)
      .execute();
    const stalled = [];
    for (const row of rows) {
      const days = Number(row.escalateDays ?? 7);
      const expiresAt =
        row.expiresAt == null
          ? null
          : str(
              row.expiresAt instanceof Date
                ? row.expiresAt.toISOString()
                : row.expiresAt,
            ).slice(0, 10);
      if (!days || !expiresAt || expiresAt > addDays(today, days)) continue;
      const employee = await platform.employee(str(row.employeeId));
      if (!employee || employee.status === 'leave') continue;
      const head = (await platform.headOf(employee)) ?? run.owner.userId;
      const left = Math.round(
        (Date.parse(`${expiresAt}T00:00:00Z`) -
          Date.parse(`${today}T00:00:00Z`)) /
          86_400_000,
      );
      stalled.push({
        assignmentId: str(row.assignmentId),
        employee: employee.name,
        certification: str(row.certificationTitle),
        expiresAt,
        daysLeft: left,
        sets: await certifications().grantedSetTitles(str(row.certificationId)),
        head,
      });
    }
    if (!stalled.length)
      return { status: 'skipped' as const, output: { escalated: 0 } };
    run.summarize(`复审未开始且临近到期 ${stalled.length} 人`);
    const byHead = new Map<string, typeof stalled>();
    for (const item of stalled)
      byHead.set(item.head, [...(byHead.get(item.head) ?? []), item]);
    for (const [head, items] of byHead) {
      const facts = items.map((i) => ({
        name: i.employee,
        certification: i.certification,
        expiresAt: i.expiresAt,
        daysLeft: i.daysLeft,
        loses: i.sets,
      }));
      const text = await worded(
        run,
        async () =>
          (
            await structured(
              run,
              'certificationSteward',
              '复审升级提醒',
              `以下员工的证书即将到期，复审还没有开始。请写一段给其部门负责人的升级提醒（不超过 200 字）：说明谁的证书几天后到期、复审尚未开始、到期后不再计入有效持证（岗位要求的资质将显示为缺失）${items.some((i) => i.sets.length) ? '，以及到期后会失去的权限（loses）' : ''}，并建议主管跟进。只使用给出的数据：${JSON.stringify(facts)}`,
              z.object({ message: z.string().min(1).max(400) }),
            )
          ).message,
        () =>
          items
            .map(
              (i) =>
                `${i.employee}的《${i.certification}》将于 ${i.expiresAt}（${i.daysLeft} 天后）到期，复审尚未开始，到期后不再计入有效持证${i.sets.length ? `，并将失去：${i.sets.join('、')}` : ''}`,
            )
            .join('；') + '。请跟进。',
      );
      await platform.notify({
        key: `automation:recertEscalation:${items
          .map((i) => i.assignmentId)
          .sort()
          .join(',')}`,
        userIds: [head],
        message: 'automationRecertEscalation',
        params: { text: text.slice(0, 400) },
        path: '/talent/assignments',
      });
      const now = new Date();
      await database
        .query()
        .updateTable('assignments')
        .set({ escalatedAt: now, updatedAt: now })
        .where(
          'id',
          'in',
          items.map((i) => i.assignmentId),
        )
        .execute();
    }
    return { output: { escalated: stalled.length, heads: byHead.size } };
  }

  async function remedialLearning(
    run: AutomationRunContext,
    attemptId: string,
  ) {
    await authorizeAction(run.owner.authz, STEWARD, 'use');
    const attempt = await database
      .query()
      .selectFrom('examAttempts')
      .select([
        'id',
        'employeeId',
        'examId',
        'assignmentId',
        'paperSnapshot',
        'itemResults',
      ])
      .where('id', '=', attemptId)
      .executeTakeFirst();
    if (!attempt?.assignmentId) return { status: 'skipped' as const };
    const assignment = await database
      .query()
      .selectFrom('assignments')
      .select(['certificateId'])
      .where('id', '=', str(attempt.assignmentId))
      .executeTakeFirst();
    const certificate = assignment?.certificateId
      ? await database
          .query()
          .selectFrom('employeeCertificates')
          .select(['certificationId'])
          .where('id', '=', str(assignment.certificateId))
          .executeTakeFirst()
      : undefined;
    if (!certificate) return { status: 'skipped' as const };
    const certificationId = str(certificate.certificationId);
    const certification = await database
      .query()
      .selectFrom('certifications')
      .select(['title'])
      .where('id', '=', certificationId)
      .executeTakeFirst();
    const employee = await platform.employee(str(attempt.employeeId));
    if (!employee) return { status: 'skipped' as const };
    // Weak competencies: those the attempt scored below 70% on.
    const items = json<
      { questionId: string; score: number; competencyIds?: string[] }[]
    >(attempt.paperSnapshot, []);
    const results = json<Record<string, { score: number | null }>>(
      attempt.itemResults,
      {},
    );
    const totals = new Map<string, { earned: number; possible: number }>();
    for (const item of items)
      for (const competencyId of item.competencyIds ?? []) {
        const entry = totals.get(competencyId) ?? { earned: 0, possible: 0 };
        entry.possible += Number(item.score);
        entry.earned += Number(results[item.questionId]?.score ?? 0);
        totals.set(competencyId, entry);
      }
    const weak = [...totals.entries()]
      .filter(([, t]) => t.possible && t.earned / t.possible < WEAK_RATE)
      .map(([id]) => id);
    const weakTitles = weak.length
      ? (
          await database
            .query()
            .selectFrom('competencies')
            .select(['title'])
            .where('id', 'in', weak)
            .execute()
        ).map((c) => str(c.title))
      : [];
    const required = (
      await database
        .query()
        .selectFrom('certificationCourses')
        .innerJoin('courses', 'courses.id', 'certificationCourses.courseId')
        .select(['courses.id as id', 'courses.title as title'])
        .where('certificationCourses.certificationId', '=', certificationId)
        .where('courses.published', '=', true)
        .where('courses.active', '=', true)
        .execute()
    ).map((c) => ({ id: str(c.id), title: str(c.title) }));
    const byCompetency = await learning().coursesForCompetencies(weak);
    const candidates = new Map<string, string>();
    for (const course of [...required, ...Object.values(byCompetency).flat()])
      candidates.set(course.id, course.title);
    const assigned: { courseId: string; title: string }[] = [];
    const today = platform.currentDate();
    for (const [courseId, title] of candidates) {
      const open = await database
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('employeeId', '=', employee.id)
        .where('courseId', '=', courseId)
        .where('status', 'in', ['notStarted', 'inProgress', 'overdue'])
        .executeTakeFirst();
      if (open) continue;
      const now = new Date();
      await database
        .query()
        .insertInto('assignments')
        .values({
          id: newId(),
          employeeId: employee.id,
          courseId,
          examId: null,
          certificateId: str(assignment!.certificateId),
          assignedByUserId: run.owner.userId,
          dueDate: addDays(today, REMEDIAL_DUE_DAYS),
          status: 'notStarted',
          progress: 0,
          source: 'remedial',
          completedAt: null,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      assigned.push({ courseId, title });
    }
    run.summarize(
      `《${certification ? str(certification.title) : ''}》复审次数用尽：${employee.name}`,
    );
    const exam = await database
      .query()
      .selectFrom('exams')
      .select(['ownerUserId', 'title'])
      .where('id', '=', str(attempt.examId))
      .executeTakeFirst();
    const head = await platform.headOf(employee);
    const params = {
      name: employee.name,
      certification: certification ? str(certification.title) : '',
      courses: assigned.length
        ? assigned.map((a) => `《${a.title}》`).join('、')
        : '—',
      weak: weakTitles.length ? weakTitles.join('、') : '—',
    };
    if (employee.userId)
      await platform.notify({
        key: `automation:remedial:${attemptId}:employee`,
        userIds: [employee.userId],
        message: 'automationRemedialAssigned',
        params,
        path: '/talent/learning',
      });
    const others = [head, exam ? str(exam.ownerUserId) : null].filter(
      (id): id is string => Boolean(id) && id !== employee.userId,
    );
    if (others.length)
      await platform.notify({
        key: `automation:remedial:${attemptId}:others`,
        userIds: others,
        message: 'automationRemedialAssignedManager',
        params,
        path: '/talent/assignments',
      });
    return { output: { assigned, weakCompetencies: weakTitles } };
  }

  const hrAssistant = createHrAssistantAutomation({
    platform,
    organization: deps.organization,
    structured,
    locale: deps.locale,
  });

  const hrPrep = createHrAssistantPrep({
    platform,
    core: () => container.resolve(hrCoreServiceToken),
    settings: () => container.resolve(personnelSettingsToken),
    drive: () => container.resolve(driveManagerToken),
    structured,
    worded,
    locale: deps.locale,
    compliance: () => container.resolve(complianceServiceToken),
    // V3-09: 转正准备 includes the learning during probation, read as each recipient.
    learning: async (ctx, employeeId) =>
      (await probationLearning(platform, ctx, employeeId)) as
        | Record<string, unknown>
        | undefined,
    learningText: (learning) =>
      probationLearningText(learning as unknown as ProbationLearning),
  });

  const hrChanges = createHrAssistantChanges({
    platform,
    checklists: () => container.resolve(checklistServiceToken),
    compliance: () => container.resolve(complianceServiceToken),
    structured,
    worded,
  });

  const hrSync = createHrAssistantSync({
    platform,
    sync: () => container.resolve(orgSyncServiceToken),
    aliases: () => container.resolve(positionAliasServiceToken),
    structured,
  });

  const hrAttendance = createHrAssistantAttendance({
    platform,
    schedules: () => container.resolve(scheduleServiceToken),
    structured,
    // V2-05 (realigned): 考勤异常追问 in the bot chat.
    channel: () => container.resolve(imChannelToken),
  });

  const conflictCheck = createConflictCheck({
    platform,
    knowledge,
    structured,
    hrRecipients: () =>
      container.resolve(hrCoreServiceToken).hrAdministrators(),
  });

  const training = createTrainingAutomation({
    container,
    platform,
    structured,
    worded,
  });

  // V3-10
  const examWork = createExamAutomation({
    container,
    platform,
    structured,
    worded,
  });

  const scheduled: Record<
    string,
    (run: AutomationRunContext) => Promise<{
      status?: 'succeeded' | 'skipped';
      output?: Record<string, unknown>;
    }>
  > = {
    'frameworkAdvisor.draftNewPositions': draftNewPositions,
    'frameworkAdvisor.dictionaryReview': dictionaryReview,
    'knowledgeAssistant.gapWeeklyReport': gapWeeklyReport,
    'certificationSteward.weeklyBrief': weeklyBrief,
    'certificationSteward.recertEscalation': recertEscalation,
    'hrAssistant.probationPrep': hrPrep.probationPrep,
    'hrAssistant.renewalPrep': hrPrep.renewalPrep,
    'hrAssistant.compliance': (run) => hrChanges.complianceCheck(run),
    'hrAssistant.attendanceAnomaly': hrAttendance.anomalyReminder,
    'learningCoach.gapPlans': training.gapPlans,
    'learningCoach.progressNudge': training.progressNudge,
    'practiceCoach.preExamRecommend': training.preExamRecommend,
    // V3-09
    'learningCoach.developmentTargetPlans': (run) =>
      training.developmentTargetPlans(run),
    // V3-11: the talent analyst's scheduled work and the question-quality check (profile/analyst.ts).
    ...Object.fromEntries(
      [
        'talentAnalyst.levelSuggestions',
        'talentAnalyst.monthlyReport',
        'talentAnalyst.summaryRefresh',
        'talentAnalyst.ruleDrafting',
        'contentWriter.questionQuality',
        'talentAnalyst.trainingCheck',
      ].map((key) => [
        key,
        (run: AutomationRunContext) =>
          container.resolve(profileServicesToken).analyst.scheduled[key](run),
      ]),
    ),
    // V3-11 end
    // V2-07: 待入职跟进 and 新员工回访 (09:00), 招聘助理的每日汇总 (18:00) — recruiting/tasks.ts.
    'hrAssistant.preboarding': (run: AutomationRunContext) =>
      container
        .resolve(recruitingServicesToken)
        .tasks.preboardingWork(run, platform.currentDate()),
    'hrAssistant.newHireCheckIn': (run: AutomationRunContext) =>
      container
        .resolve(recruitingServicesToken)
        .tasks.checkInWork(run, platform.currentDate()),
    'recruitingAssistant.dailyDigest': (run: AutomationRunContext) =>
      container.resolve(recruitingServicesToken).assistant.dailyDigest(run),
    // V2-07 end
    // V4-12: 绩效助理的目标草稿 (09:00; performance/assistant.ts).
    'performanceAssistant.goalDrafts': (run: AutomationRunContext) =>
      container
        .resolve(performanceServicesToken)
        .scheduled['performanceAssistant.goalDrafts'](run),
    // V4-12 end
    // V4-13: 季度继任检查、培训效果季报 (monthly, first month of a quarter) and 知识沉淀 (Mondays 09:00) — talent-review/.
    ...Object.fromEntries(
      [
        'talentAnalyst.successorRecommend',
        'talentAnalyst.successionRisk',
        'talentAnalyst.trainingEffectReport',
        'knowledgeAssistant.knowledgeDistill',
      ].map((key) => [
        key,
        (run: AutomationRunContext) =>
          container.resolve(talentReviewServicesToken).scheduled[key](run),
      ]),
    ),
    // V4-13 end
  };
  /** Run in this order after the daily rules; the same day never runs one twice. */
  const afterDaily = [
    'hrAssistant.probationPrep',
    'hrAssistant.attendanceAnomaly',
    // Before the renewal preparation, so a second fixed-term contract's prompt exists when it is prepared.
    'hrAssistant.compliance',
    'hrAssistant.renewalPrep',
    'certificationSteward.recertEscalation',
    'learningCoach.gapPlans',
    // V3-09: the daily re-check of development targets, before the nudges like the gap plans.
    'learningCoach.developmentTargetPlans',
    'learningCoach.progressNudge',
    'practiceCoach.preExamRecommend',
  ];

  const tasks: AutomationTasks = {
    async runScheduled(key, trigger, periodKey) {
      const work = scheduled[key];
      if (!work) throw new HrError('AUTOMATION_EVENT_ONLY', 400);
      return automation.run(
        key,
        trigger,
        {
          dedupeKey: trigger === 'schedule' ? periodKey : undefined,
          triggerRef: periodKey ? { period: periodKey } : undefined,
        },
        work,
      );
    },

    async runDue(now) {
      const report: Record<string, string> = {};
      for (const { key, periodKey } of await automation.due(now)) {
        const outcome = await tasks.runScheduled(key, 'schedule', periodKey);
        report[key] = outcome.status;
      }
      return report;
    },

    async runAfterDaily() {
      const report: Record<string, RunOutcome> = {};
      for (const key of afterDaily)
        report[key] = await automation.run(
          key,
          'schedule',
          { dedupeKey: `daily:${platform.currentDate()}` },
          scheduled[key],
        );
      return report;
    },

    onDocumentReady(documentId) {
      return automation.run(
        'contentWriter.draftCourseFromDocument',
        'event',
        { triggerRef: { documentId } },
        (run) => draftCourseFromDocument(run, documentId),
      );
    },

    async onCoursePublished(courseId) {
      return {
        'contentWriter.fillCourseQuestions': await automation.run(
          'contentWriter.fillCourseQuestions',
          'event',
          { triggerRef: { courseId } },
          (run) => fillCourseQuestions(run, courseId),
        ),
        'practiceCoach.draftScenarioOnPublish': await automation.run(
          'practiceCoach.draftScenarioOnPublish',
          'event',
          { triggerRef: { courseId } },
          (run) => training.draftScenarioOnPublish(run, courseId),
        ),
      };
    },

    onEmployeesImported(batchId) {
      return automation.run(
        'hrAssistant.importCheck',
        'event',
        { triggerRef: { batchId }, dedupeKey: `batch:${batchId}` },
        (run) => hrAssistant.importCheck(run, batchId),
      );
    },

    async onLeaveConflict(scheduleId) {
      // The dedupe key holds the candidates: a changed set is suggested again.
      const owner = await database
        .query()
        .selectFrom('aiAutomationSettings')
        .select(['ownerUserId'])
        .where('id', '=', 'hrAssistant.replacementSuggest')
        .executeTakeFirst();
      let key = `schedule:${scheduleId}`;
      let found:
        Awaited<ReturnType<typeof hrAttendance.candidatesFor>> | undefined;
      if (owner?.ownerUserId) {
        const ctx = {
          authz: await scopeForUser(platform.authz, str(owner.ownerUserId)),
          userId: str(owner.ownerUserId),
        };
        found = await container
          .resolve(scheduleServiceToken)
          .candidates(ctx, scheduleId)
          .catch(() => undefined);
        const cell = await database
          .query()
          .selectFrom('shiftSchedules')
          .select(['checkResult'])
          .where('id', '=', scheduleId)
          .executeTakeFirst();
        const leaves = json<{ rule?: string; leaveRequestId?: string }[]>(
          cell?.checkResult,
          [],
        )
          .filter((c) => c.rule === 'leaveConflict')
          .map((c) => c.leaveRequestId ?? '')
          .sort();
        key = `schedule:${scheduleId}:${leaves.join(',')}:${(found?.candidates ?? []).map((c) => c.employeeId).join(',')}`;
      }
      return automation.run(
        'hrAssistant.replacementSuggest',
        'event',
        { triggerRef: { scheduleId }, dedupeKey: key },
        (run) => hrAttendance.replacementSuggest(run, scheduleId, found),
      );
    },

    // V4-14 排班资质冲突的顶班推荐: the same HR assistant work, with candidates holding the shift's certifications.
    onQualificationConflict(scheduleId, dedupeKey) {
      return automation.run(
        'hrAssistant.replacementSuggest',
        'event',
        { triggerRef: { scheduleId, reason: 'certificationMissing' }, dedupeKey },
        (run) => hrAttendance.replacementSuggest(run, scheduleId),
      );
    },

    onAttendanceMonthGenerated(month, trigger) {
      return automation.run(
        'hrAssistant.monthEndCheck',
        trigger === 'manual' ? 'manual' : 'event',
        { triggerRef: { month }, dedupeKey: `month:${month}` },
        (run) => hrAttendance.monthEndCheck(run, month),
      );
    },

    onDocumentReadyForConflicts(documentId) {
      return automation.run(
        'knowledgeAssistant.conflictCheck',
        'event',
        { triggerRef: { documentId }, dedupeKey: `document:${documentId}` },
        (run) => conflictCheck(run, documentId),
      );
    },

    async onOrgSyncFinished(syncRun) {
      if (syncRun.mode !== 'full') return undefined;
      const row = await database
        .query()
        .selectFrom('orgSyncRuns')
        .select(['triggeredBy'])
        .where('id', '=', syncRun.id)
        .executeTakeFirst();
      const starter = row?.triggeredBy ? [str(row.triggeredBy)] : [];
      return automation.run(
        'hrAssistant.syncExplain',
        'event',
        {
          triggerRef: { syncRunId: syncRun.id },
          dedupeKey: `sync:${syncRun.id}`,
        },
        (run) => hrSync.syncExplain(run, starter),
      );
    },

    async explainIncrementalSync() {
      const merge = Number(
        (await automation.paramsOf('hrAssistant.syncExplain')).mergeMinutes ??
          60,
      );
      const { issues } = await container
        .resolve(orgSyncServiceToken)
        .currentIssues();
      const waiting = issues
        .filter((i) => i.status === 'open' && !i.aiExplainedAt && i.firstSeenAt)
        .map((i) => Date.parse(i.firstSeenAt!));
      if (!waiting.length || Date.now() - Math.min(...waiting) < merge * 60_000)
        return undefined;
      return automation.run(
        'hrAssistant.syncExplain',
        'event',
        {
          triggerRef: { merged: true },
          dedupeKey: `sync-merge:${Math.floor(Date.now() / (merge * 60_000))}`,
        },
        (run) => hrSync.syncExplain(run),
      );
    },

    onChecklistChanged(checklistId) {
      return automation.run(
        'hrAssistant.checklistNotes',
        'event',
        {
          triggerRef: { checklistId },
          // Each version of the items gets its notes once; the task skips when they are current.
          dedupeKey: `checklist:${checklistId}:${Date.now()}`,
        },
        (run) => hrChanges.checklistNotes(run, checklistId),
      );
    },

    onComplianceTrigger(employeeId) {
      return automation.run(
        'hrAssistant.compliance',
        'event',
        { triggerRef: { employeeId }, dedupeKey: `compliance:${employeeId}:${Date.now()}` },
        (run) => hrChanges.complianceCheck(run, employeeId),
      );
    },

    onAttachmentUploaded(input) {
      return automation.run(
        'hrAssistant.extractAttachment',
        'event',
        {
          triggerRef: {
            attachmentId: input.attachmentId,
            uploaderUserId: input.uploaderUserId,
          },
          dedupeKey: `attachment:${input.attachmentId}`,
        },
        (run) => hrPrep.extractAttachment(run, input),
      );
    },

    async rerunImportCheck(ctx, batchId) {
      await authorizeAction(ctx.authz, 'talent.hrAssistant', 'configure');
      return automation.run(
        'hrAssistant.importCheck',
        'manual',
        { triggerRef: { batchId } },
        (run) => hrAssistant.importCheck(run, batchId),
      );
    },

    async retryRun(ctx, runId) {
      const { task, triggerRef } = await automation.retryTarget(ctx, runId);
      const ref = (name: string): string => {
        const value = triggerRef[name];
        if (typeof value !== 'string' || !value)
          throw new HrError('AUTOMATION_RETRY_UNSUPPORTED', 400);
        return value;
      };
      const events: Record<
        string,
        () => (run: AutomationRunContext) => Promise<{
          status?: 'succeeded' | 'skipped';
          output?: Record<string, unknown>;
        }>
      > = {
        'hrAssistant.importCheck': () => {
          const batchId = ref('batchId');
          return (run) => hrAssistant.importCheck(run, batchId);
        },
        'hrAssistant.syncExplain': () => (run) => hrSync.syncExplain(run),
        'knowledgeAssistant.conflictCheck': () => {
          const documentId = ref('documentId');
          return (run) => conflictCheck(run, documentId);
        },
        'hrAssistant.extractAttachment': () => {
          const input = {
            attachmentId: ref('attachmentId'),
            uploaderUserId: ref('uploaderUserId'),
          };
          return (run) => hrPrep.extractAttachment(run, input);
        },
        'contentWriter.draftCourseFromDocument': () => {
          const documentId = ref('documentId');
          return (run) => draftCourseFromDocument(run, documentId);
        },
        'contentWriter.fillCourseQuestions': () => {
          const courseId = ref('courseId');
          return (run) => fillCourseQuestions(run, courseId);
        },
        'practiceCoach.draftScenarioOnPublish': () => {
          const courseId = ref('courseId');
          return (run) => training.draftScenarioOnPublish(run, courseId);
        },
        // V3-09
        'learningCoach.jobEventPlans': () => {
          const eventId = ref('jobEventId');
          return (run) => training.jobEventPlan(run, eventId);
        },
        'certificationSteward.remedialLearning': () => {
          const attemptId = ref('attemptId');
          return (run) => remedialLearning(run, attemptId);
        },
        // V3-10
        'examiner.gradingSuggestion': () => {
          const attemptId = ref('attemptId');
          return (run) => examWork.gradingSuggestion(run, attemptId);
        },
        'learningCoach.examFailedPlan': () => {
          const attemptId = ref('attemptId');
          return (run) => examWork.examFailedPlan(run, attemptId);
        },
        'certificationSteward.qualificationPrep': () => {
          const certificateId = ref('certificateId');
          return (run) => examWork.qualificationPrep(run, certificateId);
        },
      };
      const work =
        scheduled[task] ??
        events[task]?.() ??
        // V3-11: the coach's recommendation content and the writer's version revision.
        container.resolve(profileServicesToken).analyst.retry(task, triggerRef) ??
        // V4-12: the performance assistant's event work.
        container.resolve(performanceServicesToken).retry(task, triggerRef) ??
        // V4-13: the talent-review step's event work.
        container.resolve(talentReviewServicesToken).retry(task, triggerRef);
      if (!work) throw new HrError('AUTOMATION_RETRY_UNSUPPORTED', 400);
      return automation.run(task, 'retry', { triggerRef }, work);
    },

    // V3-09: idempotent through the plan's triggerRef, so a retried event starts a run that skips.
    onJobEventProcessed(eventId) {
      return automation.run(
        'learningCoach.jobEventPlans',
        'event',
        { triggerRef: { jobEventId: eventId } },
        (run) => training.jobEventPlan(run, eventId),
      );
    },

    onAssessmentRecorded(employeeId) {
      return automation.run(
        'learningCoach.developmentTargetPlans',
        'event',
        { triggerRef: { employeeId } },
        (run) => training.developmentTargetPlans(run, employeeId),
      );
    },

    onRecertificationExhausted(attemptId) {
      return automation.run(
        'certificationSteward.remedialLearning',
        'event',
        { triggerRef: { attemptId }, dedupeKey: `attempt:${attemptId}` },
        (run) => remedialLearning(run, attemptId),
      );
    },

    // V3-10
    async onAttemptAwaitingGrading(attemptId) {
      // One suggestion per attempt: a repeated trigger is a duplicate.
      const outcome = await automation.run(
        'examiner.gradingSuggestion',
        'event',
        { triggerRef: { attemptId }, dedupeKey: `examiner:${attemptId}` },
        (run) => examWork.gradingSuggestion(run, attemptId),
      );
      if (outcome.status === 'duplicate') return outcome;
      // Whatever the examiner did, the instructor is told once; the notice says whether suggestions exist.
      const row = await database
        .query()
        .selectFrom('examAttempts')
        .innerJoin('exams', 'exams.id', 'examAttempts.examId')
        .select([
          'exams.id as examId',
          'exams.title as title',
          'exams.ownerUserId as ownerUserId',
          'examAttempts.employeeId as employeeId',
        ])
        .where('examAttempts.id', '=', attemptId)
        .executeTakeFirst();
      if (row) {
        const suggested =
          outcome.status === 'succeeded' &&
          Number(
            (outcome.output as { suggested?: number } | undefined)?.suggested ??
              0,
          ) > 0;
        await platform.notify({
          key: `attempt:${attemptId}:grading`,
          userIds: [str(row.ownerUserId)],
          message: suggested ? 'examGradingNeededAi' : 'examGradingNeeded',
          params: {
            title: str(row.title),
            name: (await platform.employee(str(row.employeeId)))?.name ?? '',
          },
          path: `/talent/exams/${str(row.examId)}?tab=grading`,
        });
      }
      return outcome;
    },

    onExamFailed(attemptId) {
      return automation.run(
        'learningCoach.examFailedPlan',
        'event',
        { triggerRef: { attemptId }, dedupeKey: `examFailed:${attemptId}` },
        (run) => examWork.examFailedPlan(run, attemptId),
      );
    },

    onCertificateQualified(certificateId) {
      return automation.run(
        'certificationSteward.qualificationPrep',
        'event',
        {
          triggerRef: { certificateId },
          dedupeKey: `qualification:${certificateId}`,
        },
        (run) => examWork.qualificationPrep(run, certificateId),
      );
    },
  };
  return tasks;
}
