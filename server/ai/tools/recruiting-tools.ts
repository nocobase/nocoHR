import { defineTools, type AIEmployeeOptions } from '@nocobase/ai-employee';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import { z } from 'zod';

import { scopeForUser } from '../../providers/hr/authorize.js';
import { validateDraft } from '../../providers/hr/recruiting/postings.js';
import { REQUIREMENT_TYPES } from '../../providers/hr/recruiting/common.js';
import { CHECK_IN_TOPICS } from '../../providers/hr/recruiting/config.js';
import { HrError, str } from '../../providers/hr/shared.js';
import { recruitingServicesToken } from '../../providers/hr/tokens.js';

/**
 * V2-07 招聘助理 (recruitingAssistant) and 人事助理 (用工测算、新员工回访)
 * tools. Each runs as the signed-in user with that user's own authorization
 * and relations: a recruiter works on the requisitions assigned to them, a
 * hiring manager and an interviewer only on the candidates they are related
 * to. What reaches the model for screening carries no name, contact data,
 * photo or protected characteristic. Candidate-facing messages are drafts;
 * nothing is sent to a candidate by a tool.
 */
const I18N = { namespace: 'hr' };

const failure = (error: unknown) => {
  if (error instanceof HrError)
    return {
      status: 'error' as const,
      content: { code: error.code, details: error.details ?? null },
    };
  throw error;
};

async function actorOf(ctx: {
  actor: { id: string | number };
  deps: { authz: Parameters<typeof scopeForUser>[0] };
}) {
  const userId = String(ctx.actor.id);
  return { userId, authz: await scopeForUser(ctx.deps.authz, userId) };
}

const deps = { recruiting: recruitingServicesToken, authz: authorizationToken };
const id = z.string().min(1).max(64);

const tool = <S extends z.ZodType>(input: {
  name: string;
  title: string;
  about: string;
  description: string;
  schema: S;
  invoke: (
    services: import('../../providers/hr/recruiting/index.js').RecruitingServices,
    actor: Awaited<ReturnType<typeof actorOf>>,
    args: z.infer<S>,
  ) => Promise<unknown>;
}) =>
  defineTools({
    scope: 'SPECIFIED',
    execution: 'backend',
    defaultPermission: 'ALLOW',
    i18n: I18N,
    introduction: { title: input.title, about: input.about },
    definition: {
      name: input.name,
      description: input.description,
      schema: input.schema,
    },
    dependencies: deps,
    invoke: async (ctx, args: z.infer<S>) => {
      try {
        return {
          status: 'success',
          content: await input.invoke(
            ctx.deps.recruiting,
            await actorOf(ctx),
            args,
          ),
        };
      } catch (error) {
        return failure(error);
      }
    },
  });

// ---------- 招聘助理 ----------

export const getRequisitionContext = tool({
  name: 'getRequisitionContext',
  title: 'Read a requisition',
  about: 'The position, job description and checklist of a requisition.',
  description:
    "Return a requisition the user may see: the position's title, job family, grade and job description (responsibilities), the department's requirements checklist (each with type, text and mustHave), headcount, target date and status.",
  schema: z.object({ requisitionId: id }),
  invoke: async (s, actor, args) => {
    const r = await s.requisitions.detail(actor, args.requisitionId);
    return {
      id: r.id,
      position: r.positionTitle,
      jobFamily: r.jobFamily,
      grade: r.grade,
      responsibilities: r.responsibilities,
      department: r.departmentTitle,
      headcount: r.headcount,
      targetDate: r.targetDate,
      status: r.status,
      checklist: r.requirementsChecklist,
    };
  },
});

export const saveJobPostingDraft = tool({
  name: 'saveJobPostingDraft',
  title: 'Save a posting draft',
  about: 'A draft posting (source=ai) for a requisition the user recruits for.',
  description:
    "Create a draft posting (source=ai, reviewStatus=draft) for a requisition assigned to the user as recruiter. Every item of the department's checklist must be included unchanged with origin=checklist; items drawn from the job description use origin=responsibilities. An internal licence obtained after joining is not a requirement. The recruiter confirms before publishing.",
  schema: z.object({
    requisitionId: id,
    title: z.string().min(1).max(200),
    description: z.string().min(1).max(20_000),
    requirements: z
      .array(
        z.object({
          type: z.enum(REQUIREMENT_TYPES),
          text: z.string().min(1).max(300),
          mustHave: z.boolean(),
          origin: z.enum(['responsibilities', 'checklist', 'manual']),
        }),
      )
      .min(1)
      .max(40),
  }),
  invoke: async (s, actor, args) => {
    const requisition = await s.requisitions.get(args.requisitionId);
    if (requisition.recruiterUserId !== actor.userId)
      throw new HrError('REQUISITION_NOT_FOUND', 404);
    const requirements = args.requirements.map((r, i) => ({
      key: `${r.origin === 'checklist' ? 'c' : 'r'}${i + 1}`,
      ...r,
    }));
    validateDraft(requisition, requirements, []);
    const postingId = await s.postings.insertDraft({
      requisition,
      source: 'ai',
      title: args.title,
      description: args.description,
      location: await s.context.departmentTitle(requisition.departmentId),
      requirements,
      knockoutQuestions: [],
    });
    return { postingId, reviewStatus: 'draft' };
  },
});

export const parseResume = tool({
  name: 'parseResume',
  title: 'Parse a resume',
  about: "A candidate's resume text, without protected characteristics.",
  description:
    "Parse the resume of a candidate of the user's requisitions into education, experience, skills and certificates. Only text is read (no images); lines about gender, age, birth date, marriage, ethnicity, origin, religion or politics are removed before reading. An image-only resume is left for the recruiter to fill in.",
  schema: z.object({ applicationId: id }),
  invoke: async (s, actor, args) => {
    const application = await s.candidates.applicationRow(args.applicationId);
    if (!(await s.candidates.access(actor, application)).recruiter)
      throw new HrError('APPLICATION_NOT_FOUND', 404);
    const result = await s.assistant.parseResume(
      null,
      actor.userId,
      application.candidateId,
    );
    return { status: result.status };
  },
});

export const getApplicationForScreening = tool({
  name: 'getApplicationForScreening',
  title: 'Read an application for screening',
  about: 'Requirements and the parsed profile, never identity or contact data.',
  description:
    "Return what screening may use for one application: the posting's requirements (key, type, text, mustHave), the candidate's parsed profile (education, experience, skills, certificates), the knockout answers, and administrator-added fields marked for screening. Never the name, contact data, photo or any protected characteristic.",
  schema: z.object({ applicationId: id }),
  invoke: async (s, actor, args) => {
    const application = await s.candidates.applicationRow(args.applicationId);
    const a = await s.candidates.access(actor, application);
    if (!a.recruiter && !a.manager && !a.interviewer)
      throw new HrError('APPLICATION_NOT_FOUND', 404);
    return s.assistant.screeningInput(args.applicationId);
  },
});

export const saveScreeningSuggestion = tool({
  name: 'saveScreeningSuggestion',
  title: 'Save a screening suggestion',
  about: 'A match level with reasons per requirement; never a decision.',
  description:
    "Write the screening suggestion of an application of the user's requisitions: matchLevel (high / medium / low), the requirement keys met, missing and to verify, and a reason per key. Keys must be the posting's. Does not change the stage or the recruiter's decision; no rejection advice.",
  schema: z.object({
    applicationId: id,
    suggestion: z.object({
      matchLevel: z.enum(['high', 'medium', 'low']),
      met: z.array(z.string().max(40)).max(40),
      missing: z.array(z.string().max(40)).max(40),
      toVerify: z.array(z.string().max(40)).max(40),
      reasons: z
        .array(z.object({ key: z.string().max(40), text: z.string().max(300) }))
        .max(40),
    }),
  }),
  invoke: async (s, actor, args) => {
    const application = await s.candidates.applicationRow(args.applicationId);
    const a = await s.candidates.access(actor, application);
    if (!a.recruiter) throw new HrError('APPLICATION_NOT_FOUND', 404);
    const suggestion = s.assistant.validateSuggestion(
      args.suggestion,
      a.posting.requirements,
    );
    await s.assistant.writeSuggestion(args.applicationId, suggestion);
    return { applicationId: args.applicationId, matchLevel: suggestion.matchLevel };
  },
});

export const findPoolCandidates = tool({
  name: 'findPoolCandidates',
  title: 'Search the talent pool',
  about: 'Past candidates with valid consent for a requisition.',
  description:
    'For a requisition the user recruits for, list past candidates whose consent is still valid and who are not anonymized, matched against the requirements, with the facts behind each match. No contact data. Never contacts anyone.',
  schema: z.object({ requisitionId: id }),
  invoke: async (s, actor, args) => {
    const requisition = await s.requisitions.get(args.requisitionId);
    if (requisition.recruiterUserId !== actor.userId)
      throw new HrError('REQUISITION_NOT_FOUND', 404);
    const settings = await s.context.settings();
    return s.assistant.findPool(requisition, settings.assistant.poolLimit);
  },
});

export const saveInterviewPlan = tool({
  name: 'saveInterviewPlan',
  title: 'Save interview questions',
  about: 'One behavioural question per requirement.',
  description:
    'Write the question plan of an interview the user schedules or conducts: each question names a requirement key of the posting, says what to listen for and has at most three follow-ups. Certificate requirements get a verification question; the certificate itself is checked in person.',
  schema: z.object({
    interviewId: id,
    questionPlan: z
      .array(
        z.object({
          requirementKey: z.string().max(40),
          question: z.string().min(1).max(500),
          lookFor: z.string().min(1).max(500),
          followUps: z.array(z.string().min(1).max(300)).max(3),
        }),
      )
      .min(1)
      .max(20),
  }),
  invoke: async (s, actor, args) => {
    await s.interviews.savePlan(actor, args.interviewId, args.questionPlan);
    return { interviewId: args.interviewId, saved: true };
  },
});

export const saveInterviewSummary = tool({
  name: 'saveInterviewSummary',
  title: 'Save an interview summary',
  about: "The scorecards' distribution, divergences and what to verify.",
  description:
    "Write the summary of an interview of the user's requisitions: per requirement the score distribution, where interviewers disagree, what still needs verifying. Only what interviewers wrote; no hiring recommendation.",
  schema: z.object({
    interviewId: id,
    summary: z.object({
      text: z.string().min(1).max(4000),
      divergences: z.array(z.string().max(300)).max(20),
      toVerify: z.array(z.string().max(300)).max(20),
    }),
  }),
  invoke: async (s, actor, args) => {
    const interview = await s.interviews.get(args.interviewId);
    const application = await s.candidates.applicationRow(interview.applicationId);
    if (!(await s.candidates.access(actor, application)).recruiter)
      throw new HrError('INTERVIEW_NOT_FOUND', 404);
    if (/(建议录用|建议淘汰|录用建议)/u.test(args.summary.text))
      throw new HrError('SCREENING_VERDICT_NOT_ALLOWED', 400);
    await s.interviews.saveSummaryTrusted(args.interviewId, args.summary);
    return { interviewId: args.interviewId, saved: true };
  },
});

export const draftCandidateMessage = tool({
  name: 'draftCandidateMessage',
  title: 'Draft a candidate message',
  about: 'A draft the recruiter confirms before it is sent.',
  description:
    'Save a draft message to a candidate of the user\'s requisitions (invitation, rejection, offer, aiInterviewInvitation). It is only a draft: the recruiter reviews and sends it from the candidate page. A rejection never compares the candidate with others.',
  schema: z.object({
    applicationId: id,
    type: z.enum(['invitation', 'rejection', 'offer', 'aiInterviewInvitation']),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).max(8000),
  }),
  invoke: async (s, actor, args) => {
    const application = await s.candidates.applicationRow(args.applicationId);
    if (!(await s.candidates.access(actor, application)).recruiter)
      throw new HrError('APPLICATION_NOT_FOUND', 404);
    const message = await s.candidates.addDraftMessage(args.applicationId, {
      type: args.type,
      subject: args.subject,
      body: args.body,
      draftedBy: 'ai',
    });
    return { messageId: message.id, status: 'draft' };
  },
});

export const sendRecruitingDigest = tool({
  name: 'sendRecruitingDigest',
  title: 'Send the recruiting digest',
  about: 'Scheduled work only.',
  description:
    "Used only by the scheduled 18:00 work, which sends each recruiter the day's applications and screening levels as an in-app message without contact data. In a conversation it does nothing and says so.",
  schema: z.object({}),
  invoke: async () => {
    throw new HrError('TASK_ONLY', 400);
  },
});

export const draftAiInterviewPlan = tool({
  name: 'draftAiInterviewPlan',
  title: 'Draft AI interview questions',
  about: 'A draft plan for the optional AI initial interview.',
  description:
    'Draft the AI initial interview of a posting the user manages: 6–8 questions, each for one requirement, what to listen for, at most two follow-ups. It stays a draft until the recruiter confirms it.',
  schema: z.object({ postingId: id }),
  invoke: async (s, actor, args) => {
    const posting = await s.aiInterview.draftPlan(actor, args.postingId);
    return { postingId: posting.id, plan: posting.aiInterviewPlan };
  },
});

export const conductAiInterviewTurn = tool({
  name: 'conductAiInterviewTurn',
  title: 'AI interview turn',
  about: "Only inside the candidate's own AI interview session.",
  description:
    "Appends one turn of an AI initial interview. It works only inside the candidate's own session on the AI interview page; in any other conversation it is refused.",
  schema: z.object({ interviewId: id, text: z.string().max(2000) }),
  invoke: async () => {
    throw new HrError('AI_INTERVIEW_SESSION_ONLY', 400);
  },
});

export const saveAiInterviewReport = tool({
  name: 'saveAiInterviewReport',
  title: 'Save an AI interview report',
  about: "Only when the candidate's AI interview ends.",
  description:
    "Writes the AI initial interview's report when the candidate's session ends (on the AI interview page). Every point quotes the candidate's own words; no overall verdict. In any other conversation it is refused.",
  schema: z.object({ interviewId: id }),
  invoke: async () => {
    throw new HrError('AI_INTERVIEW_SESSION_ONLY', 400);
  },
});

// ---------- 人事助理（第七步部分）----------

export const getWorkforcePlan = tool({
  name: 'getWorkforcePlan',
  title: 'Read a workforce plan',
  about: 'The calculation, options and parameters; no salary.',
  description:
    'Return a workforce plan the user may see: the month, department and position, the server calculation (people on duty, output per shift, shifts, capacity, gap and the parameters used) and the options (overtime, transfer, hire) with feasibility, risks and cost notes. No salary data.',
  schema: z.object({ planId: id }),
  invoke: async (s, actor, args) => {
    const plan = await s.workforce.detail(actor, args.planId);
    return {
      id: plan.id,
      month: plan.month,
      department: plan.departmentTitle,
      position: plan.positionTitle,
      plannedOutput: plan.plannedOutput,
      currentOutput: plan.currentOutput,
      calculation: plan.calculation,
      options: plan.options,
      status: plan.status,
    };
  },
});

export const saveWorkforcePlanNotes = tool({
  name: 'saveWorkforcePlanNotes',
  title: 'Save workforce plan notes',
  about: 'Explanations only; never the numbers or the options.',
  description:
    "Write the HR assistant's explanation of a workforce plan and one note per option. The numbers, options and status are the server's and do not change.",
  schema: z.object({
    planId: id,
    aiSummary: z.string().min(1).max(4000),
    optionNotes: z
      .object({
        overtime: z.string().max(1000).nullish(),
        transfer: z.string().max(1000).nullish(),
        hire: z.string().max(1000).nullish(),
      })
      .partial(),
  }),
  invoke: async (s, actor, args) =>
    s.workforce.saveNotes(actor, args.planId, {
      aiSummary: args.aiSummary,
      optionNotes: args.optionNotes,
    }),
});

export const sendNewHireCheckIn = tool({
  name: 'sendNewHireCheckIn',
  title: 'Send a new-hire check-in',
  about: 'Scheduled work only.',
  description:
    'Used only by the daily 09:00 work, which asks new employees on day 3, 7 and 30 in a Feishu private chat. In a conversation it does nothing and says so.',
  schema: z.object({ employeeId: id, day: z.number().int() }),
  invoke: async () => {
    throw new HrError('TASK_ONLY', 400);
  },
});

export const saveCheckInIssues = tool({
  name: 'saveCheckInIssues',
  title: 'Save check-in issues',
  about: "The employee's reply by topic, and the issues to follow up.",
  description:
    "In the employee's own check-in conversation: save the reply by topic (commute, mentoring, schedule, workload, expectations, environment, other) and the issues to follow up; each issue becomes a to-do for the owner configured for its topic. Submits no request on the employee's behalf. declined=true when the employee does not want to answer.",
  schema: z.object({
    checkInId: id,
    answers: z
      .array(
        z.object({
          topic: z.enum(CHECK_IN_TOPICS),
          text: z.string().min(1).max(500),
        }),
      )
      .max(20),
    issues: z
      .array(
        z.object({
          topic: z.enum(CHECK_IN_TOPICS),
          summary: z.string().min(1).max(300),
        }),
      )
      .max(10),
    declined: z.boolean().optional(),
  }),
  invoke: async (s, actor, args) =>
    s.checkIns.saveIssues(actor, args.checkInId, {
      answers: args.answers,
      issues: args.issues,
      ...(args.declined === undefined ? {} : { declined: args.declined }),
    }),
});

export const RECRUITING_TOOLS: ReturnType<typeof tool>[] = [
  getRequisitionContext,
  saveJobPostingDraft,
  parseResume,
  getApplicationForScreening,
  saveScreeningSuggestion,
  findPoolCandidates,
  saveInterviewPlan,
  saveInterviewSummary,
  draftCandidateMessage,
  sendRecruitingDigest,
  draftAiInterviewPlan,
  conductAiInterviewTurn,
  saveAiInterviewReport,
  getWorkforcePlan,
  saveWorkforcePlanNotes,
  sendNewHireCheckIn,
  saveCheckInIssues,
];

/** 人事助理（第七步）: the workforce and check-in prompt points and tools, added to the employee in hr-assistant/. */
const HR_ASSISTANT_PROMPT = `

用工测算与新员工回访（第七步）：
1. 用工测算只解释 getWorkforcePlan 返回的服务端数字，不自行估算；先说缺口有多大、原因是什么（计划产量增加多少），再逐个方案说清能补多少、什么时候能补上、有什么风险；超过法定加班上限的方案明确写“不可行”，不建议变通。说明用 saveWorkforcePlanNotes 保存，只写说明，不改数字和方案。
2. 是否招聘、借调谁，由用人部门负责人决定；不评价具体员工。
3. 回访语气像 HR 同事的关心，问题简短，一次只问一件事；员工提到问题时，先按制度说明能怎么办（用 searchKnowledge，附出处），再用 saveCheckInIssues 保存并告诉他已经转给谁跟进。
4. 回访内容不告诉部门负责人以外的人；员工表示不想回答时结束回访（declined=true）。不代员工提交任何申请。`;

export function withRecruitingTools(employee: AIEmployeeOptions): AIEmployeeOptions {
  const names = new Set((employee.tools ?? []).map((t) => t.name));
  const extra = [
    { name: 'getWorkforcePlan', autoCall: true },
    { name: 'saveWorkforcePlanNotes', autoCall: true },
    { name: 'sendNewHireCheckIn', autoCall: false },
    { name: 'saveCheckInIssues', autoCall: true },
    { name: 'searchKnowledge', autoCall: true },
  ].filter((t) => !names.has(t.name));
  return {
    ...employee,
    systemPrompt: `${str(employee.systemPrompt ?? '')}${HR_ASSISTANT_PROMPT}`,
    tools: [...(employee.tools ?? []), ...extra],
  };
}
