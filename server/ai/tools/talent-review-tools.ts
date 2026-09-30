/**
 * V4-13 tools: the talent analyst's review and succession work and the
 * examiner's practical-assessment work. Every tool runs as the person in the
 * conversation (or the automation's owner) and through the same
 * authorization as the pages. Placement evidence never contains review
 * comments; savePlacementSuggestion never changes a band or a box;
 * saveSuccessorSuggestions never sets a readiness or overwrites a manual
 * candidate; the examiner never decides whether a record passes.
 */
import { defineTools, type AIEmployeeOptions } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { authorizeAction, policyOf, scopeForUser } from '../../providers/hr/authorize.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { talentReviewServicesToken } from '../../providers/hr/tokens.js';

const I18N = { namespace: 'hr' };
const deps = { services: talentReviewServicesToken, authz: authorizationToken };

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

function failure(error: unknown) {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
}

/** The placement, when the caller's talent-review view reaches it. */
async function assertPlacement(
  services: import('../../providers/hr/talent-review/index.js').TalentReviewServices,
  actor: { userId: string; authz: Awaited<ReturnType<typeof scopeForUser>> },
  placementId: string,
) {
  const policies = await authorizeAction(actor.authz, 'talent.talentReview', 'view');
  const visible = await services.context.database
    .repository('talentPlacements')
    .withPolicy(policyOf(policies, 'talentPlacements'))
    .findOne({ filter: { id: placementId } });
  if (!visible) throw new HrError('PLACEMENT_NOT_FOUND', 404);
}

export const getPlacementEvidence = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: {
    title: 'Read placement evidence',
    about: 'Facts for a nine-box placement: rating, potential answers, learning speed, growth, exams, practice.',
  },
  definition: {
    name: 'getPlacementEvidence',
    description:
      "The facts for one talent-review placement: the final review rating (never the review comments), the manager's potential answers, the learning speed (onboarding path days against the position median), competency growth in 12 months, the exams' first-attempt pass rate and practice scores. List facts only; do not judge personality and do not give a potential score.",
    schema: z.object({ placementId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { placementId: string }) => {
    try {
      const actor = await actorOf(ctx);
      await assertPlacement(ctx.deps.services, actor, args.placementId);
      return { status: 'success', content: await ctx.deps.services.evidence(args.placementId) };
    } catch (error) {
      return failure(error);
    }
  },
});

export const savePlacementSuggestion = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: { title: 'Save a pre-placement', about: 'Writes the analyst suggestion of a placement.' },
  definition: {
    name: 'savePlacementSuggestion',
    description:
      'Write the pre-placement suggestion of a placement: potentialEvidence (facts, at most 8 lines) and notes (at most 80 characters). It never changes the performance band, the potential band or the box; people decide those in the review session.',
    schema: z.object({
      placementId: z.string().min(1).max(64),
      potentialEvidence: z.array(z.string().max(300)).max(8),
      notes: z.string().max(500),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: { placementId: string; potentialEvidence: string[]; notes: string },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.talentReview', 'manage');
      await assertPlacement(ctx.deps.services, actor, args.placementId);
      await ctx.deps.services.analyst.saveSuggestion(args.placementId, {
        potentialEvidence: args.potentialEvidence,
        notes: args.notes,
        source: 'ai',
      });
      return { status: 'success', content: { saved: true } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const matchSuccessors = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: { title: 'Match successors', about: 'People in scope against a key position, smallest gap first.' },
  definition: {
    name: 'matchSuccessors',
    description:
      "Computed on the server: the active people of the department (with sub-departments), never the incumbent, against the position's current requirements — the gaps, the latest final rating and the nine-box position — smallest gap first.",
    schema: z.object({ positionId: z.string().min(1).max(64), departmentId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { positionId: string; departmentId: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.succession', 'manage');
      return {
        status: 'success',
        content: (await ctx.deps.services.succession.match(args.positionId, args.departmentId)).slice(0, 20),
      };
    } catch (error) {
      return failure(error);
    }
  },
});

export const saveSuccessorSuggestions = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: { title: 'Save successor suggestions', about: 'Adds AI candidates without readiness.' },
  definition: {
    name: 'saveSuccessorSuggestions',
    description:
      'Add AI candidates (source ai) to a succession plan with their gaps and a short note. Readiness stays empty for people to choose; existing (manual) candidates are never overwritten; the incumbent is never added.',
    schema: z.object({
      successionPlanId: z.string().min(1).max(64),
      candidates: z
        .array(z.object({ employeeId: z.string().min(1).max(64), note: z.string().max(300) }))
        .min(1)
        .max(10),
    }),
  },
  dependencies: deps,
  invoke: async (
    ctx,
    args: { successionPlanId: string; candidates: { employeeId: string; note: string }[] },
  ) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.succession', 'manage');
      const services = ctx.deps.services;
      const plan = await services.succession.planRow(args.successionPlanId);
      const gaps = await services.succession.gapsFor(
        args.candidates.map((c) => c.employeeId),
        plan.positionId,
      );
      const added = await services.succession.saveSuggestions(
        plan.id,
        args.candidates.map((c) => ({
          employeeId: c.employeeId,
          note: c.note,
          gaps: gaps.get(c.employeeId)?.gaps ?? [],
        })),
      );
      return { status: 'success', content: { added } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const sendRiskAlert = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ASK',
  i18n: I18N,
  introduction: { title: 'Send a succession risk alert', about: 'Tells hr01 and the incumbent superior.' },
  definition: {
    name: 'sendRiskAlert',
    description:
      "Send a succession risk alert for a plan to the HR owner and the incumbent's superior (never the incumbent). The same position and reason is sent once in 7 days. Ask the user first.",
    schema: z.object({
      successionPlanId: z.string().min(1).max(64),
      reason: z.enum(['noReadySuccessor', 'incumbentLeft', 'candidateLeft']),
    }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { successionPlanId: string; reason: string }) => {
    try {
      const actor = await actorOf(ctx);
      await authorizeAction(actor.authz, 'talent.succession', 'manage');
      const outcome = await ctx.deps.services.context
        .automation()
        .run(
          'talentAnalyst.successionRisk',
          'manual',
          { triggerRef: { planId: args.successionPlanId, reason: args.reason } },
          (run) => ctx.deps.services.analyst.successionRisk(run, args.successionPlanId, args.reason),
        );
      return { status: 'success', content: { status: outcome.status } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const structureObservation = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: { title: 'Structure practical notes', about: 'Maps the assessor notes to the checklist.' },
  definition: {
    name: 'structureObservation',
    description:
      'Map the observation notes of a practical record to its checklist items and write the suggestions (pass / fail / notRecorded, with the quoted notes). An item without a note is notRecorded, never pass. You never decide whether the record passes. Unchanged notes are not structured again.',
    schema: z.object({ practicalRecordId: z.string().min(1).max(64) }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { practicalRecordId: string }) => {
    try {
      const actor = await actorOf(ctx);
      const record = await ctx.deps.services.structureRecord(actor, args.practicalRecordId);
      return { status: 'success', content: { aiStructured: record.aiStructured } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const draftPracticalChecklist = defineTools({
  scope: 'SPECIFIED',
  execution: 'backend',
  defaultPermission: 'ALLOW',
  i18n: I18N,
  introduction: { title: 'Draft a practical checklist', about: 'Drafts an assessment form from a work instruction.' },
  definition: {
    name: 'draftPracticalChecklist',
    description:
      'Draft a practical assessment form (source ai, draft) from a work instruction document, each item with its source excerpt. The form cannot be used until an instructor confirms it.',
    schema: z.object({
      documentId: z.string().min(1).max(64),
      competencyIds: z.array(z.string().min(1).max(64)).max(20).default([]),
    }),
  },
  dependencies: deps,
  invoke: async (ctx, args: { documentId: string; competencyIds: string[] }) => {
    try {
      const actor = await actorOf(ctx);
      const template = await ctx.deps.services.draftChecklist(actor, args);
      return { status: 'success', content: { assessmentId: template.id, title: template.title, reviewStatus: template.reviewStatus } };
    } catch (error) {
      return failure(error);
    }
  },
});

export const TALENT_REVIEW_TOOLS = [
  getPlacementEvidence,
  savePlacementSuggestion,
  matchSuccessors,
  saveSuccessorSuggestions,
  sendRiskAlert,
  structureObservation,
  draftPracticalChecklist,
];

function extend(
  employee: AIEmployeeOptions,
  prompt: string,
  tools: { name: string; autoCall: boolean }[],
): AIEmployeeOptions {
  const names = new Set((employee.tools ?? []).map((t) => t.name));
  return {
    ...employee,
    systemPrompt: `${str(employee.systemPrompt ?? '')}${prompt}`,
    tools: [...(employee.tools ?? []), ...tools.filter((t) => !names.has(t.name))],
  };
}

/** 人才分析师：盘点与继任 (第十三步). */
export function withTalentReviewAnalystTools(employee: AIEmployeeOptions): AIEmployeeOptions {
  return extend(
    employee,
    `

人才盘点与继任（第十三步）：
1. 盘点预放置：用 getPlacementEvidence 读取事实，用 savePlacementSuggestion 写建议。只列事实（考核等级、学习速度、能力增长、考试首次通过率、陪练表现、主管记录的事例），不评价性格，不给潜力分，不引用考核评语。落位和准备度由人决定。
2. 继任候选推荐：调用 matchSuccessors，挑出差距最小的 3 人（不含现任），用 saveSuccessorSuggestions 写入并说明差距和已有的发展记录；不填准备度。
3. 继任风险提醒：说明风险和可考虑的人选，用 sendRiskAlert 发送（不通知现任本人）。
九宫格与继任属于敏感数据：不在对话中泛泛列出他人的落位。`,
    [
      { name: 'getPlacementEvidence', autoCall: true },
      { name: 'savePlacementSuggestion', autoCall: false },
      { name: 'matchSuccessors', autoCall: true },
      { name: 'saveSuccessorSuggestions', autoCall: false },
      { name: 'sendRiskAlert', autoCall: false },
    ],
  );
}

/** 考官：实操辅助记录与考核表起草 (第十三步). */
export function withPracticalExaminerTools(employee: AIEmployeeOptions): AIEmployeeOptions {
  return extend(
    employee,
    `

实操考核（第十三步）：
1. 考评员点击“让考官整理”时调用 structureObservation：把每条现场记录对应到检查项，给出建议结果并引用原始记录；没有对应记录的检查项标为“未记录”，绝不建议为“通过”。你只整理记录，不判定是否通过，结果以考评员确认和签字为准。
2. 从作业文件起草考核表用 draftPracticalChecklist：每项附引用原文；考核表涉及安全操作，须讲师确认后才能使用。`,
    [
      { name: 'structureObservation', autoCall: true },
      { name: 'draftPracticalChecklist', autoCall: false },
    ],
  );
}
