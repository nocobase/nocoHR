/**
 * The AI employees' recruiting work (总纲 AI 员工约定), each through the
 * automation service (switch, owner, run record, dedupe):
 *
 * 招聘助理 recruitingAssistant — runs as the requisition's recruiter; a
 * requisition without one is skipped:
 * - postingDraft (需求批准): the posting draft from the job description and the
 *   checklist (kept as written), with knockout questions for a bulk hire;
 *   once per requisition.
 * - poolReuse (需求批准): up to N past candidates with valid consent, and why.
 * - screening (新投递): parses the resume (sanitized text only) and suggests a
 *   match level against the posting's requirements; once per application.
 * - interviewQuestions (面试前 24 小时, hourly scan): one question per
 *   requirement; once per interview.
 * - interviewSummary (评分全部提交): distribution, divergences, what to verify —
 *   never a hiring advice.
 * - dailyDigest (每天 18:00): each recruiter's new applications and levels.
 *
 * 人事助理 hrAssistant — runs as the task owner (default hr01):
 * - workforceExplain (业务量计划到达且有缺口): explains the server's numbers once
 *   per calculation and tells the department's head.
 * - newHireCheckIn and preboarding (每天 09:00), see checkins.ts / preboarding.ts.
 *
 * Every piece of AI output is structured and validated; without a model the
 * rule path writes the same shape and the run is marked fallback. Run
 * records keep ids, levels and topics — never resume text or contact data.
 */
import { z } from 'zod';

import { AIUnavailableError } from '../ai-runner.js';
import type { AutomationRunContext } from '../automation.js';
import { scopeForUser } from '../authorize.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, str } from '../shared.js';
import type { CandidateService } from './candidates.js';
import {
  json,
  REQUIREMENT_TYPES,
  type KnockoutQuestion,
  type Requirement,
  type ScreeningSuggestion,
  yesNoValue,
} from './common.js';
import { workforceUnit } from './config.js';
import type { RecruitingContext } from './context.js';
import type { InterviewService, Scorecard } from './interviews.js';
import type { PostingService } from './postings.js';
import { validateDraft } from './postings.js';
import type { RequisitionService, RequisitionView } from './requisitions.js';
import {
  cleanProfile,
  extractResumeText,
  ruleParse,
  ruleScreen,
  sanitizeResumeText,
  type ParsedProfile,
} from './resume-text.js';
import type { WorkforcePlanView, WorkforceService } from './workforce.js';

/**
 * The words a talent-pool candidate's parsed resume is searched for: the
 * requisition's checklist and the position title only. It used to append
 * fixed machining words (数控, CNC, 加工中心, 机床), which matched factory
 * resumes to every requisition of every customer.
 */
export function poolSearchWords(
  checklist: readonly { text: string }[],
  positionTitle: string | null,
): string[] {
  const filler =
    /^(?:\d+\s*)?(?:年|个月)?(?:及?以上)?(?:的)?|(?:相关)?(?:工作)?(?:经验|经历|能力)$/gu;
  const words = [...checklist.map((c) => c.text), positionTitle ?? '']
    .flatMap((text) => text.split(/[或及与和、，,；;。（）()/\s]+/u))
    .map((w) => w.replace(filler, '').trim())
    .filter((w) => w.length >= 2);
  return [...new Set(words)];
}

export const TASKS = {
  postingDraft: 'recruitingAssistant.postingDraft',
  poolReuse: 'recruitingAssistant.poolReuse',
  screening: 'recruitingAssistant.screening',
  interviewQuestions: 'recruitingAssistant.interviewQuestions',
  interviewSummary: 'recruitingAssistant.interviewSummary',
  dailyDigest: 'recruitingAssistant.dailyDigest',
  workforceExplain: 'hrAssistant.workforceExplain',
} as const;

/** 职责说明中入职后才取得的内部上岗资格: not a hiring condition. */
const INTERNAL_LICENSE =
  /(须|需|应)?持有?[^，。,；;]{0,20}(上岗证|上岗资格|岗位资格证)[^，。,；;]*/u;

const draftSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(6000),
  requirements: z
    .array(
      z.object({
        type: z.enum(REQUIREMENT_TYPES),
        text: z.string().min(1).max(300),
        mustHave: z.boolean(),
        origin: z.enum(['responsibilities', 'checklist', 'manual']),
      }),
    )
    .max(30),
  knockoutQuestions: z
    .array(
      z.object({
        question: z.string().min(1).max(200),
        answerType: z.enum(['yesNo', 'choice', 'shortText']),
        options: z.array(z.string().min(1).max(60)).max(8).nullish(),
        requirementIndex: z.number().int().min(0).max(60),
        expected: z.string().max(60).nullish(),
      }),
    )
    .max(5),
});

const profileSchema = z.object({
  education: z
    .array(
      z.object({
        level: z.string().max(20),
        school: z.string().max(60).nullish(),
        major: z.string().max(60).nullish(),
      }),
    )
    .max(5),
  experiences: z
    .array(
      z.object({
        summary: z.string().max(200),
        years: z.number().min(0).max(60).nullish(),
        keywords: z.array(z.string().max(30)).max(10),
      }),
    )
    .max(10),
  skills: z.array(z.string().max(40)).max(30),
  certificates: z.array(z.string().max(60)).max(10),
  confidence: z.object({
    education: z.number().min(0).max(1),
    experiences: z.number().min(0).max(1),
    skills: z.number().min(0).max(1),
    certificates: z.number().min(0).max(1),
  }),
});

const suggestionSchema = z.object({
  matchLevel: z.enum(['high', 'medium', 'low']),
  met: z.array(z.string().max(40)).max(40),
  missing: z.array(z.string().max(40)).max(40),
  toVerify: z.array(z.string().max(40)).max(40),
  reasons: z
    .array(z.object({ key: z.string().max(40), text: z.string().max(300) }))
    .max(40),
});

const planSchema = z.object({
  questions: z
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
});

const notesSchema = z.object({
  summary: z.string().min(1).max(2000),
  overtime: z.string().max(600),
  transfer: z.string().max(600),
  hire: z.string().max(600),
});

const poolSchema = z.object({
  reasons: z
    .array(z.object({ id: z.string().max(64), reason: z.string().max(300) }))
    .max(50),
});

/** Advice words a screening or summary may not contain (招聘助理不建议淘汰、不给录用建议). */
const VERDICT = /(建议淘汰|淘汰|不予录用|建议录用|录用建议|建议不录用)/u;

/**
 * The rule text of a workforce plan when the HR assistant's words are not
 * available: every quantity in 招聘设置's unit (`unit`), the housing note only
 * when the loan option carries the housing risk.
 */
export function workforceRuleNotes(
  plan: Pick<
    WorkforcePlanView,
    'month' | 'departmentTitle' | 'positionTitle' | 'calculation' | 'options'
  >,
  unit: string,
) {
  const c = plan.calculation!;
  const n = (value: number) => value.toLocaleString('zh-CN');
  const overtime = plan.options.find((o) => o.type === 'overtime');
  const transfer = plan.options.find((o) => o.type === 'transfer');
  const hire = plan.options.find((o) => o.type === 'hire');
  const increase =
    c.currentOutput !== null
      ? `，比本月的 ${n(c.currentOutput)} ${unit}增加 ${n(c.plannedOutput - c.currentOutput)} ${unit}`
      : '';
  const od = (overtime?.detail ?? {}) as {
    hoursPerPerson?: number | null;
    limitHours?: number;
  };
  const td = (transfer?.detail ?? {}) as {
    maxHeadcount?: number;
    covers?: boolean;
  };
  const hd = (hire?.detail ?? {}) as {
    recruitingCycleDays?: number;
    onboardingDays?: number;
    readyInWeeks?: number;
  };
  const housing = transfer?.risks.includes('housing')
    ? '；借调人员的住宿需要提前安排'
    : '';
  return {
    summary: `${plan.month} ${plan.departmentTitle}${plan.positionTitle}计划业务量 ${n(c.plannedOutput)} ${unit}${increase}。现有在岗 ${c.headcount} 人，按人均每班 ${c.outputPerShift} ${unit}、每月 ${c.shiftsPerMonth} 个班，可承接 ${n(c.capacity)} ${unit}，缺口 ${c.gapHeadcount} 人。是否招聘、借调谁，由用人部门负责人决定。`,
    overtime: overtime
      ? `现有人员每人每月约加班 ${od.hoursPerPerson ?? '—'} 小时，${overtime.feasible ? `未超过 ${od.limitHours} 小时上限` : `超过每月 ${od.limitHours} 小时的上限，不可行`}。`
      : '',
    transfer: transfer
      ? td.maxHeadcount
        ? `最多可借调 ${td.maxHeadcount} 人，${td.covers ? '可以覆盖缺口' : '不能覆盖缺口'}${housing}。`
        : '招聘设置中没有可借调的部门。'
      : '',
    hire: hire
      ? `招聘约 ${hd.recruitingCycleDays} 天，加上岗 ${hd.onboardingDays} 天，约 ${hd.readyInWeeks} 周后能独立上岗；此前的缺口需要加班或借调过渡。`
      : '',
  };
}

/**
 * The LLM's instruction on the units of the numbers it explains: quantities
 * in 招聘设置's unit, never a factory's 件 unless that is the unit.
 */
export function workforceUnitsPrompt(unit: string): string {
  return `数字的单位：业务量的单位是“${unit}”。outputPerShift 是每人每班的业务量（${unit}/班），hoursPerShift 是每班小时数，shiftsPerMonth 是每人每月班数，capacity、plannedOutput、currentOutput 和 gapOutput 的单位是${unit}，headcount 和 gapHeadcount 是人；列算式时按这些单位写，不要写成“${unit}/小时”，也不要换成别的单位。`;
}

export function createRecruitingAssistant(
  ctx: RecruitingContext,
  deps: {
    requisitions: RequisitionService;
    postings: PostingService;
    candidates: CandidateService;
    interviews: InterviewService;
    workforce: WorkforceService;
  },
) {
  const { database, platform } = ctx;
  const automation = () => ctx.automation();

  async function structured<T>(
    run: AutomationRunContext,
    actorUserId: string,
    employee: string,
    title: string,
    prompt: string,
    schema: z.ZodType<T>,
    options: { linkConversation: boolean } = { linkConversation: true },
  ): Promise<T> {
    const { data, sessionId } = await ctx.ai.structured({
      employee,
      userId: actorUserId,
      title,
      prompt,
      schema,
      timeZone: platform.timeZone,
    });
    // Candidate conversations are not linked from the run record (no resume text there).
    if (options.linkConversation) run.usedConversation(sessionId);
    return data;
  }

  /** The requisition's recruiter, with their own authorization; undefined when none is assigned. */
  async function recruiterOf(
    requisition: RequisitionView,
  ): Promise<ActorContext | undefined> {
    if (!requisition.recruiterUserId) return undefined;
    return {
      userId: requisition.recruiterUserId,
      authz: await scopeForUser(platform.authz, requisition.recruiterUserId),
    };
  }

  // ---------- 职位描述起草 ----------

  function ruleDraft(
    requisition: RequisitionView,
    position: { title: string; responsibilities: string | null },
    bulk: boolean,
  ) {
    const responsibilities = position.responsibilities ?? '';
    const license = INTERNAL_LICENSE.exec(responsibilities)?.[0] ?? null;
    const duties = responsibilities
      .replace(INTERNAL_LICENSE, '')
      .replace(/^负责/u, '')
      .split(/[、，,；;。]|和/u)
      .map((d) => d.replace(/^(负责|和|及|以及)/u, '').trim())
      .filter((d) => d.length >= 2 && d.length <= 20);
    const checklist: Requirement[] = requisition.requirementsChecklist.map(
      (item, i) => ({
        key: `c${i + 1}`,
        type: item.type,
        text: item.text,
        mustHave: item.mustHave,
        origin: 'checklist',
      }),
    );
    const covered = (duty: string) =>
      checklist.some((c) => c.text.includes(duty.slice(0, 2)));
    const derived: Requirement[] = duties
      .filter((d) => !covered(d))
      .slice(0, 6)
      .map((duty, i) => ({
        key: `r${i + 1}`,
        type: 'skill',
        text: `能够完成${duty}`,
        mustHave: false,
        origin: 'responsibilities',
      }));
    const requirements = [...checklist, ...derived];
    const description = [
      `【岗位职责】${
        responsibilities
          .replace(INTERNAL_LICENSE, '')
          .replace(/[，,]\s*$/u, '')
          .trim() || position.title
      }`,
      `【任职要求】${requirements.map((r) => `${r.text}${r.mustHave ? '（必备）' : ''}`).join('；')}`,
      ...(license
        ? [
            `【入职培训】入职后参加上岗培训与考核，取得${/[一-龥A-Z]*上岗证/u.exec(license)?.[0] ?? '上岗资格'}后独立上岗（不是招聘条件）。`,
          ]
        : []),
    ].join('\n');
    const questions: KnockoutQuestion[] = [];
    if (bulk)
      for (const r of checklist.filter((c) => c.mustHave)) {
        if (questions.length >= 5) break;
        questions.push({
          key: `q${questions.length + 1}`,
          question: /三班倒|倒班|夜班/u.test(r.text)
            ? '能否接受三班倒（含夜班）？'
            : r.type === 'education'
              ? `是否具备${r.text.replace(/及以上.*$/u, '及以上')}学历？`
              : `${r.text.replace(/^(会|能|能够|具备)/u, '是否会')}？`,
          answerType: 'yesNo',
          options: undefined,
          requirementKey: r.key,
          expected: 'yes',
        });
      }
    return {
      title: position.title,
      description,
      requirements,
      knockoutQuestions: questions,
    };
  }

  async function postingDraft(
    run: AutomationRunContext,
    requisitionId: string,
  ) {
    const requisition = await deps.requisitions.get(requisitionId);
    const actor = await recruiterOf(requisition);
    if (!actor)
      return { status: 'skipped' as const, output: { reason: 'NO_RECRUITER' } };
    const exists = await database
      .query()
      .selectFrom('jobPostings')
      .select(['id'])
      .where('requisitionId', '=', requisitionId)
      .executeTakeFirst();
    if (exists)
      return { status: 'skipped' as const, output: { reason: 'EXISTS' } };
    const position = (await ctx.position(requisition.positionId)) ?? {
      title: '',
      responsibilities: null,
      jobFamily: null,
      grade: null,
    };
    const settings = await ctx.settings();
    const bulk = requisition.headcount >= settings.assistant.bulkHeadcount;
    run.summarize(
      `requisition ${requisitionId}, headcount ${requisition.headcount}`,
    );
    let draft = ruleDraft(requisition, position, bulk);
    try {
      const answer = await structured(
        run,
        actor.userId,
        'recruitingAssistant',
        `职位描述起草 · ${position.title}`,
        [
          '为下面的招聘需求起草职位描述与任职要求，按要求的结构化格式输出。',
          `岗位：${position.title}（序列：${position.jobFamily ?? '—'}，职级：${position.grade ?? '—'}）`,
          `职责说明：${position.responsibilities ?? '（空）'}`,
          'title 只写对外的职位名称（如“客户服务专员”“设备操作工”，可加工作地点），不写序列、职级等内部信息。',
          `用人部门条件清单（原样保留，origin=checklist）：`,
          ...requisition.requirementsChecklist.map(
            (c, i) =>
              `${i + 1}. [${c.type}] ${c.text}${c.mustHave ? '（必备）' : ''}`,
          ),
          '从职责说明中只提炼岗位真正需要的学历、经验、证书和技能，origin=responsibilities；入职后才取得的内部上岗资格（如“须取得本岗位上岗资格”）不列为要求，写进职位描述的“入职培训”说明。',
          bulk
            ? '这是一线岗位批量招聘：再起草 3–5 道门槛问题，每题对应一条必备要求（requirementIndex 为要求在列表中的序号，从 0 开始），只作提示，不自动淘汰。'
            : '不需要门槛问题，knockoutQuestions 为空数组。',
        ].join('\n'),
        draftSchema,
      );
      // The checklist is re-inserted exactly as the department wrote it; the model adds only derived items.
      const derived = answer.requirements
        .filter(
          (r) => r.origin !== 'checklist' && !INTERNAL_LICENSE.test(r.text),
        )
        .slice(0, 10)
        .map((r, i) => ({
          key: `r${i + 1}`,
          type: r.type,
          text: r.text,
          mustHave: r.mustHave,
          origin:
            r.origin === 'manual'
              ? ('manual' as const)
              : ('responsibilities' as const),
        }));
      const checklist = draft.requirements.filter(
        (r) => r.origin === 'checklist',
      );
      const requirements = [...checklist, ...derived];
      const questions: KnockoutQuestion[] = [];
      for (const q of answer.knockoutQuestions) {
        // The model counts over its own list; map a checklist item back by its position among checklist items.
        const target = answer.requirements[q.requirementIndex];
        const mapped = target
          ? requirements.find((r) => r.text === target.text && r.mustHave)
          : undefined;
        if (!mapped || questions.length >= 5) continue;
        questions.push({
          key: `q${questions.length + 1}`,
          question: q.question,
          answerType: q.answerType,
          options: q.options ?? undefined,
          requirementKey: mapped.key,
          // Stored as the contract's 'yes' / 'no', whatever wording the model used (是 / 能).
          expected:
            q.answerType === 'yesNo'
              ? (yesNoValue(q.expected) ?? 'yes')
              : (q.expected ?? null),
        });
      }
      const candidate = {
        // Internal grading (生产序列, S1) never reaches the public title.
        title: /序列|职级|\bS\d+\b/u.test(answer.title)
          ? draft.title
          : answer.title,
        description: answer.description,
        requirements,
        knockoutQuestions:
          bulk && questions.length >= 3 ? questions : draft.knockoutQuestions,
      };
      validateDraft(
        requisition,
        candidate.requirements,
        candidate.knockoutQuestions,
      );
      draft = candidate;
    } catch (error) {
      if (!(error instanceof AIUnavailableError) && !(error instanceof HrError))
        throw error;
      run.markFallback();
    }
    const id = await deps.postings.insertDraft({
      requisition,
      source: 'ai',
      title: draft.title,
      description: draft.description,
      location: await ctx.departmentTitle(requisition.departmentId),
      requirements: draft.requirements,
      knockoutQuestions: draft.knockoutQuestions,
    });
    await run.recordItems('jobPosting', [{ id, hash: null }]);
    await platform.notify({
      key: `postingDraft:${requisitionId}`,
      userIds: [actor.userId],
      message: 'recruitingPostingDrafted',
      params: { position: position.title },
      path: `/talent/postings/${id}`,
    });
    return {
      output: {
        postingId: id,
        requirements: draft.requirements.length,
        questions: draft.knockoutQuestions.length,
      },
    };
  }

  // ---------- 简历库复用 ----------

  async function findPool(requisition: RequisitionView, limit: number) {
    const today = platform.currentDate();
    const rows = await database
      .query()
      .selectFrom('candidates')
      .select(['id', 'name', 'parsedProfile', 'lastActivityAt'])
      .where('anonymizedAt', 'is', null)
      .where('retentionUntil', '>=', today)
      .execute();
    const applied = await database
      .query()
      .selectFrom('applications')
      .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
      .innerJoin(
        'jobRequisitions',
        'jobRequisitions.id',
        'jobPostings.requisitionId',
      )
      .select([
        'applications.candidateId as candidateId',
        'jobRequisitions.id as requisitionId',
        'jobRequisitions.positionId as positionId',
        'applications.stage as stage',
      ])
      .execute();
    const position = await ctx.position(requisition.positionId);
    const words = poolSearchWords(
      requisition.requirementsChecklist,
      position?.title ?? null,
    );
    const scored = [];
    for (const r of rows) {
      const mine = applied.filter((a) => str(a.candidateId) === str(r.id));
      if (mine.some((a) => str(a.requisitionId) === requisition.id)) continue;
      if (mine.some((a) => str(a.stage) === 'hired')) continue;
      const samePosition = mine.some(
        (a) => str(a.positionId) === requisition.positionId,
      );
      const profile = json<ParsedProfile | null>(r.parsedProfile, null);
      const text = JSON.stringify(profile ?? {});
      const hits = [...new Set(words.filter((w) => text.includes(w)))];
      const score = (samePosition ? 3 : 0) + hits.length;
      if (score > 0)
        scored.push({
          id: str(r.id),
          name: str(r.name),
          samePosition,
          hits,
          score,
        });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async function poolReuse(run: AutomationRunContext, requisitionId: string) {
    const requisition = await deps.requisitions.get(requisitionId);
    const actor = await recruiterOf(requisition);
    if (!actor)
      return { status: 'skipped' as const, output: { reason: 'NO_RECRUITER' } };
    const settings = await ctx.settings();
    const found = await findPool(requisition, settings.assistant.poolLimit);
    run.summarize(
      `requisition ${requisitionId}: ${found.length} pool candidates`,
    );
    const ruleReason = (f: (typeof found)[number]) =>
      [
        f.samePosition ? '曾应聘同一岗位' : null,
        f.hits.length ? `简历涉及：${f.hits.slice(0, 4).join('、')}` : null,
        '授权仍在有效期内',
      ]
        .filter(Boolean)
        .join('；');
    let reasons = new Map(found.map((f) => [f.id, ruleReason(f)]));
    if (found.length)
      try {
        const answer = await structured(
          run,
          actor.userId,
          'recruitingAssistant',
          '简历库复用',
          [
            '为下列简历库中的候选人各写一句推荐理由（只根据给出的事实，不提学校名气、户籍、年龄、性别）：',
            ...found.map(
              (f) =>
                `- id=${f.id}：${f.samePosition ? '曾应聘同一岗位；' : ''}简历涉及 ${f.hits.join('、') || '无'}`,
            ),
          ].join('\n'),
          poolSchema,
        );
        for (const r of answer.reasons)
          if (reasons.has(r.id) && r.reason && !VERDICT.test(r.reason))
            reasons.set(r.id, r.reason);
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
        reasons = new Map(found.map((f) => [f.id, ruleReason(f)]));
      }
    const suggestion = {
      at: new Date().toISOString(),
      candidates: found.map((f) => ({
        candidateId: f.id,
        name: f.name,
        reason: reasons.get(f.id) ?? '',
      })),
    };
    await database
      .query()
      .updateTable('jobRequisitions')
      .set({ poolSuggestion: suggestion, updatedAt: new Date() })
      .where('id', '=', requisitionId)
      .execute();
    if (found.length)
      await platform.notify({
        key: `poolReuse:${requisitionId}`,
        userIds: [actor.userId],
        message: 'recruitingPoolSuggested',
        params: {
          count: String(found.length),
          position: (await ctx.position(requisition.positionId))?.title ?? '',
        },
        path: `/talent/requisitions/${requisitionId}`,
      });
    return { output: { candidates: found.map((f) => f.id) } };
  }

  // ---------- 简历解析与初筛 ----------

  /** parseResume: sanitized text only; image-only resumes are left for the recruiter. */
  async function parseResume(
    run: AutomationRunContext | null,
    actorUserId: string,
    candidateId: string,
  ): Promise<{ status: string; sentText: string | null }> {
    const candidate = await deps.candidates.candidateRow(candidateId);
    if (!candidate.resumeFileId) return { status: 'none', sentText: null };
    const file = await ctx.readFile(candidate.resumeFileId);
    if (!file) return { status: 'none', sentText: null };
    const text = await extractResumeText(
      file.bytes,
      file.filename,
      file.mimeType,
    );
    if (!text) {
      await database
        .query()
        .updateTable('candidates')
        .set({ parseStatus: 'manual', updatedAt: new Date() })
        .where('id', '=', candidateId)
        .execute();
      return { status: 'manual', sentText: null };
    }
    const sanitized = sanitizeResumeText(text);
    let profile: ParsedProfile;
    let confidence: Record<string, number>;
    try {
      const { data, sessionId } = await ctx.ai.structured({
        employee: 'recruitingAssistant',
        userId: actorUserId,
        title: '简历解析',
        prompt: [
          '从下面的简历文本中提取教育、工作经历、技能和证书，按结构化格式输出；不要输出性别、年龄、出生日期、婚育、民族、籍贯、宗教、政治面貌、照片等信息。education.level 取 middleSchool/highSchool/vocational/associate/bachelor/master/doctor/unknown 之一；experiences.years 为该段经历的年数。',
          '简历文本：',
          sanitized,
        ].join('\n'),
        schema: profileSchema,
        timeZone: platform.timeZone,
      });
      void sessionId;
      profile = cleanProfile(data);
      confidence = data.confidence;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run?.markFallback();
      const parsed = ruleParse(sanitized);
      profile = parsed.profile;
      confidence = parsed.confidence;
    }
    await database
      .query()
      .updateTable('candidates')
      .set({
        parsedProfile: profile,
        parseConfidence: confidence,
        parseStatus: 'parsed',
        updatedAt: new Date(),
      })
      .where('id', '=', candidateId)
      .execute();
    return { status: 'parsed', sentText: sanitized };
  }

  /** getApplicationForScreening: requirements, the parsed profile, knockout answers, screening-readable fields — nothing identifying. */
  async function screeningInput(applicationId: string) {
    const application = await deps.candidates.applicationRow(applicationId);
    const posting = await deps.postings.get(application.postingId);
    const candidate = await deps.candidates.candidateRow(
      application.candidateId,
    );
    const definitions = await deps.candidates.customFieldDefinitions();
    return {
      applicationId,
      requirements: posting.requirements.map((r) => ({
        key: r.key,
        type: r.type,
        text: r.text,
        mustHave: r.mustHave,
      })),
      parsedProfile: candidate.parsedProfile
        ? cleanProfile(candidate.parsedProfile)
        : null,
      knockoutAnswers: application.knockoutAnswers.map((k) => ({
        requirementKey:
          posting.knockoutQuestions.find((q) => q.key === k.key)
            ?.requirementKey ?? null,
        question:
          posting.knockoutQuestions.find((q) => q.key === k.key)?.question ??
          '',
        answer: k.answer,
        meetsExpected: k.meetsExpected,
      })),
      screeningFields: deps.candidates.customValues(
        definitions,
        candidate.customFields,
        {
          sensitive: false,
          aiOnly: true,
        },
      ),
    };
  }

  /** saveScreeningSuggestion's checks: keys belong to the posting; no verdict words. */
  function validateSuggestion(
    suggestion: z.infer<typeof suggestionSchema>,
    requirements: readonly Requirement[],
  ): ScreeningSuggestion {
    const keys = new Set(requirements.map((r) => r.key));
    const all = [
      ...suggestion.met,
      ...suggestion.missing,
      ...suggestion.toVerify,
      ...suggestion.reasons.map((r) => r.key),
    ];
    if (all.some((k) => !keys.has(k)))
      throw new HrError('SCREENING_KEY_UNKNOWN', 400);
    if (suggestion.reasons.some((r) => VERDICT.test(r.text)))
      throw new HrError('SCREENING_VERDICT_NOT_ALLOWED', 400);
    return { ...suggestion, by: 'ai' };
  }

  async function writeSuggestion(
    applicationId: string,
    suggestion: ScreeningSuggestion,
  ) {
    const now = new Date();
    await database
      .query()
      .updateTable('applications')
      .set({ screeningSuggestion: suggestion, screenedAt: now, updatedAt: now })
      .where('id', '=', applicationId)
      .execute();
  }

  async function screening(run: AutomationRunContext, applicationId: string) {
    const application = await deps.candidates.applicationRow(applicationId);
    const posting = await deps.postings.get(application.postingId);
    const requisition = await deps.requisitions.get(posting.requisitionId);
    const actor = await recruiterOf(requisition);
    if (!actor)
      return { status: 'skipped' as const, output: { reason: 'NO_RECRUITER' } };
    if (application.screenedAt)
      return { status: 'skipped' as const, output: { reason: 'SCREENED' } };
    const candidate = await deps.candidates.candidateRow(
      application.candidateId,
    );
    if (candidate.parseStatus !== 'parsed' || candidate.resumeFileId)
      await parseResume(run, actor.userId, candidate.id);
    const input = await screeningInput(applicationId);
    let suggestion: ScreeningSuggestion;
    const rule = () =>
      ruleScreen(
        posting.requirements,
        input.parsedProfile ?? {
          education: [],
          experiences: [],
          skills: [],
          certificates: [],
        },
        input.knockoutAnswers
          .filter((k) => k.requirementKey)
          .map((k) => ({
            requirementKey: k.requirementKey!,
            meetsExpected: k.meetsExpected,
            answer: k.answer,
          })),
      );
    if (!input.parsedProfile && !input.knockoutAnswers.length)
      suggestion = rule();
    else
      try {
        const answer = await structured(
          run,
          actor.userId,
          'recruitingAssistant',
          '简历初筛',
          [
            '只对照职位的任职要求，逐条判断候选人满足（met）、不满足（missing）还是需要面试核实（toVerify），每条写理由（reasons 的 key 用任职要求的 key）。',
            '匹配度只给 high / medium / low；不写“建议淘汰”或录用建议；不根据学校名气、户籍、年龄、性别等与岗位无关的因素判断；持有与要求无关的证书不算满足。',
            JSON.stringify(input),
          ].join('\n'),
          suggestionSchema,
          { linkConversation: false },
        );
        suggestion = validateSuggestion(answer, posting.requirements);
      } catch (error) {
        if (
          !(error instanceof AIUnavailableError) &&
          !(error instanceof HrError)
        )
          throw error;
        run.markFallback();
        suggestion = rule();
      }
    await writeSuggestion(applicationId, suggestion);
    await run.recordItems('screeningSuggestion', [
      { id: applicationId, hash: suggestion.matchLevel },
    ]);
    // 运行记录中不保存简历内容和联系方式: the application id and the level only.
    run.summarize(`application ${applicationId}`);
    return { output: { applicationId, matchLevel: suggestion.matchLevel } };
  }

  // ---------- 面试题 ----------

  function rulePlan(requirements: readonly Requirement[]) {
    return requirements.slice(0, 12).map((r) => ({
      requirementKey: r.key,
      question:
        r.type === 'certificate'
          ? `请说说你的${r.text.replace(/^(持有|具备)/u, '')}是什么时候、在哪里取得的？现场请出示原件。`
          : r.type === 'education'
            ? `请简单介绍你的学习经历，与“${r.text}”相关的课程或实训有哪些？`
            : `请讲一次你${r.text.replace(/^(会|能|能够|具备|有)/u, '')}的经历：当时的情况、你具体做了什么、结果怎样？`,
      lookFor:
        r.type === 'certificate'
          ? '证书名称、发证机构与有效期，以原件查验为准（问答不替代查验）'
          : `是否有具体、可核实的事例，能说明“${r.text}”`,
      followUps:
        r.type === 'certificate'
          ? ['证书现在是否在有效期内？']
          : ['遇到的最大困难是什么，怎么解决的？'],
    }));
  }

  async function interviewQuestions(
    run: AutomationRunContext,
    interviewId: string,
  ) {
    const interview = await deps.interviews.get(interviewId);
    if (interview.questionPlan)
      return { status: 'skipped' as const, output: { reason: 'EXISTS' } };
    const application = await deps.candidates.applicationRow(
      interview.applicationId,
    );
    const posting = await deps.postings.get(application.postingId);
    const requisition = await deps.requisitions.get(posting.requisitionId);
    const actor = await recruiterOf(requisition);
    if (!actor)
      return { status: 'skipped' as const, output: { reason: 'NO_RECRUITER' } };
    const input = await screeningInput(application.id);
    let plan = rulePlan(posting.requirements);
    try {
      const answer = await structured(
        run,
        actor.userId,
        'recruitingAssistant',
        '面试题',
        [
          '按任职要求和候选人经历设计行为面试题（“请讲一次你……的经历”），每题对应一条任职要求（requirementKey），写明要听什么（lookFor），最多 2–3 个追问；证书类要求设计核实问题，不替代证书查验。',
          JSON.stringify({
            requirements: input.requirements,
            profile: input.parsedProfile,
          }),
        ].join('\n'),
        planSchema,
        { linkConversation: false },
      );
      const keys = new Set(posting.requirements.map((r) => r.key));
      const questions = answer.questions.filter((q) =>
        keys.has(q.requirementKey),
      );
      if (questions.length) plan = questions;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    await deps.interviews.savePlanTrusted(
      interviewId,
      plan,
      posting.requirements,
    );
    await platform.notify({
      key: `interviewQuestions:${interviewId}`,
      userIds: interview.interviewerUserIds,
      message: 'recruitingInterviewQuestions',
      params: { time: new Date(interview.scheduledAt).toISOString() },
      path: `/talent/interviews/${interviewId}`,
    });
    run.summarize(`interview ${interviewId}`);
    return { output: { interviewId, questions: plan.length } };
  }

  // ---------- 面试汇总 ----------

  function ruleSummary(
    requirements: readonly Requirement[],
    cards: readonly Scorecard[],
    names: Map<string, string>,
  ) {
    const byRequirement = requirements.map((r) => {
      const scores = cards
        .map((c) => ({
          userId: c.userId,
          score:
            c.requirementScores.find((s) => s.requirementKey === r.key)
              ?.score ?? null,
          evidence:
            c.requirementScores.find((s) => s.requirementKey === r.key)
              ?.evidence ?? null,
        }))
        .filter((s) => s.score !== null) as {
        userId: string;
        score: number;
        evidence: string | null;
      }[];
      const values = scores.map((s) => s.score);
      return {
        requirementKey: r.key,
        text: r.text,
        scores: scores.map((s) => ({
          name: names.get(s.userId) ?? s.userId,
          score: s.score,
        })),
        average: values.length
          ? Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 10,
            ) / 10
          : null,
        spread: values.length ? Math.max(...values) - Math.min(...values) : 0,
      };
    });
    const divergences = byRequirement
      .filter((r) => r.spread >= 2)
      .map(
        (r) =>
          `“${r.text}”：${r.scores.map((s) => `${s.name} ${s.score} 分`).join('，')}`,
      );
    const recommendations = new Set(
      cards.map((c) =>
        c.recommendation === 'strongYes' || c.recommendation === 'yes'
          ? 'yes'
          : 'no',
      ),
    );
    if (recommendations.size > 1)
      divergences.push(
        `面试官的推荐不一致：${cards.map((c) => `${names.get(c.userId) ?? c.userId}（${c.recommendation}）`).join('，')}`,
      );
    const toVerify = [
      ...byRequirement
        .filter((r) => r.scores.length < cards.length)
        .map((r) => `“${r.text}”有面试官未评分`),
      ...byRequirement
        .filter((r) => r.average !== null && r.average <= 2.5)
        .map((r) => `“${r.text}”评分偏低，建议进一步核实`),
      ...requirements
        .filter((r) => r.type === 'certificate')
        .map((r) => `“${r.text}”需查验证书原件`),
    ];
    return { byRequirement, divergences, toVerify };
  }

  async function interviewSummary(
    run: AutomationRunContext,
    interviewId: string,
  ) {
    const interview = await deps.interviews.get(interviewId);
    if (interview.summaryAt)
      return { status: 'skipped' as const, output: { reason: 'EXISTS' } };
    const application = await deps.candidates.applicationRow(
      interview.applicationId,
    );
    const posting = await deps.postings.get(application.postingId);
    const requisition = await deps.requisitions.get(posting.requisitionId);
    const actor = await recruiterOf(requisition);
    if (!actor)
      return { status: 'skipped' as const, output: { reason: 'NO_RECRUITER' } };
    const names = new Map<string, string>();
    for (const u of interview.interviewerUserIds)
      names.set(u, (await platform.userName(u)) ?? u);
    const summary: Record<string, unknown> = ruleSummary(
      posting.requirements,
      interview.scorecards,
      names,
    );
    try {
      const answer = await structured(
        run,
        actor.userId,
        'recruitingAssistant',
        '面试汇总',
        [
          '把下面各面试官已写的评分与记录整理成一段汇总：按任职要求说明评分分布，指出分歧点和待核实事项。只整理面试官写了的内容，不给录用建议。',
          JSON.stringify({
            requirements: posting.requirements.map((r) => ({
              key: r.key,
              text: r.text,
            })),
            rule: summary,
            notes: interview.scorecards.map((c) => ({
              name: names.get(c.userId),
              notes: c.notes ?? '',
            })),
          }),
        ].join('\n'),
        z.object({ text: z.string().min(1).max(2000) }),
        { linkConversation: false },
      );
      if (!VERDICT.test(answer.text)) summary.text = answer.text;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    await deps.interviews.saveSummaryTrusted(interviewId, summary);
    await platform.notify({
      key: `interviewSummary:${interviewId}`,
      userIds: [
        requisition.hiringManagerUserId,
        requisition.recruiterUserId!,
      ].filter(Boolean),
      message: 'recruitingInterviewSummary',
      params: { position: posting.title },
      path: `/talent/interviews/${interviewId}`,
    });
    run.summarize(`interview ${interviewId}`);
    return {
      output: {
        interviewId,
        divergences: (summary.divergences as unknown[]).length,
      },
    };
  }

  // ---------- 每天 18:00 汇总 ----------

  async function dailyDigest(run: AutomationRunContext, asOf?: string) {
    const date = asOf ?? platform.currentDate();
    const from = new Date(`${date}T00:00:00+08:00`);
    const to = new Date(`${date}T23:59:59+08:00`);
    const rows = await database
      .query()
      .selectFrom('applications')
      .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
      .innerJoin(
        'jobRequisitions',
        'jobRequisitions.id',
        'jobPostings.requisitionId',
      )
      .select([
        'applications.id as id',
        'applications.screeningSuggestion as screeningSuggestion',
        'applications.knockoutAnswers as knockoutAnswers',
        'jobRequisitions.recruiterUserId as recruiterUserId',
        'applications.createdAt as createdAt',
      ])
      .execute()
      // Datetimes are compared as instants here: SQLite keeps them as text, so a SQL comparison with a Date is unreliable.
      .then((all) =>
        all.filter((r) => {
          const at = new Date(str(r.createdAt)).getTime();
          return at >= from.getTime() && at <= to.getTime();
        }),
      );
    const byRecruiter = new Map<
      string,
      {
        total: number;
        high: number;
        medium: number;
        low: number;
        pending: number;
        knockout: number;
      }
    >();
    for (const r of rows) {
      if (!r.recruiterUserId) continue;
      const key = str(r.recruiterUserId);
      const stats = byRecruiter.get(key) ?? {
        total: 0,
        high: 0,
        medium: 0,
        low: 0,
        pending: 0,
        knockout: 0,
      };
      stats.total += 1;
      const level = json<ScreeningSuggestion | null>(
        r.screeningSuggestion,
        null,
      )?.matchLevel;
      if (level) stats[level] += 1;
      else stats.pending += 1;
      if (
        json<{ meetsExpected: boolean | null }[]>(r.knockoutAnswers, []).some(
          (k) => k.meetsExpected === false,
        )
      )
        stats.knockout += 1;
      byRecruiter.set(key, stats);
    }
    for (const [userId, stats] of byRecruiter)
      await platform.notify({
        key: `recruitingDigest:${date}:${userId}`,
        userIds: [userId],
        message: 'recruitingDigest',
        params: {
          date,
          total: String(stats.total),
          high: String(stats.high),
          medium: String(stats.medium),
          low: String(stats.low),
          pending: String(stats.pending),
          knockout: String(stats.knockout),
        },
        path: '/talent/candidates',
      });
    run.summarize(`${date}: ${byRecruiter.size} recruiters`);
    return {
      output: { date, recruiters: byRecruiter.size, applications: rows.length },
    };
  }

  // ---------- 用工测算（人事助理）----------

  async function workforceExplain(run: AutomationRunContext, planId: string) {
    const plan = await deps.workforce.trustedGet(planId);
    if (!plan.calculation || plan.calculation.gapHeadcount <= 0)
      return { status: 'skipped' as const, output: { reason: 'NO_GAP' } };
    if (plan.aiSummaryCurrent)
      return { status: 'skipped' as const, output: { reason: 'CURRENT' } };
    const unit = workforceUnit((await ctx.settings()).workforce);
    let notes = workforceRuleNotes(plan, unit);
    try {
      const answer = await structured(
        run,
        run.owner.userId,
        'hrAssistant',
        `用工测算 · ${plan.departmentTitle}`,
        [
          workforceUnitsPrompt(unit),
          '只解释下面服务端算出的数字，不自行估算。先说缺口有多大、原因（计划业务量增加多少），再逐个方案说清能补多少、什么时候能补上、有什么风险；超过法定加班上限的方案明确写“不可行”，不建议变通；是否招聘、借调谁由用人部门负责人决定，不评价具体员工。',
          JSON.stringify({
            plan: {
              month: plan.month,
              department: plan.departmentTitle,
              position: plan.positionTitle,
            },
            calculation: plan.calculation,
            options: plan.options.map((o) => ({
              type: o.type,
              feasible: o.feasible,
              detail: o.detail,
              risks: o.risks,
            })),
          }),
        ].join('\n'),
        notesSchema,
      );
      // The words must carry the server's gap; otherwise the rule text is used.
      if (answer.summary.includes(String(plan.calculation.gapHeadcount)))
        notes = answer;
      else run.markFallback();
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run.markFallback();
    }
    await deps.workforce.saveNotes(run.owner, planId, {
      aiSummary: notes.summary,
      optionNotes: {
        overtime: notes.overtime,
        transfer: notes.transfer,
        hire: notes.hire,
      },
    });
    const head = await ctx.headOfDepartment(plan.departmentId);
    if (head)
      await platform.notify({
        key: `workforceGap:${planId}:${plan.calculationHash.slice(0, 16)}`,
        userIds: [head],
        message: 'recruitingWorkforceGap',
        params: {
          department: plan.departmentTitle,
          position: plan.positionTitle,
          month: plan.month,
          count: String(plan.calculation.gapHeadcount),
        },
        path: `/talent/workforce-plans/${planId}`,
      });
    run.summarize(`plan ${planId}`);
    return { output: { planId, gap: plan.calculation.gapHeadcount } };
  }

  return {
    screeningInput,
    validateSuggestion,
    writeSuggestion,
    parseResume,
    findPool,
    ruleDraft,

    onRequisitionOpened(requisitionId: string) {
      return Promise.all([
        automation().run(
          TASKS.postingDraft,
          'event',
          {
            triggerRef: { requisitionId },
            dedupeKey: `requisition:${requisitionId}`,
          },
          (run) => postingDraft(run, requisitionId),
        ),
        automation().run(
          TASKS.poolReuse,
          'event',
          {
            triggerRef: { requisitionId },
            dedupeKey: `requisition:${requisitionId}`,
          },
          (run) => poolReuse(run, requisitionId),
        ),
      ]);
    },
    onNewApplication(applicationId: string) {
      return automation().run(
        TASKS.screening,
        'event',
        {
          triggerRef: { applicationId },
          dedupeKey: `application:${applicationId}`,
        },
        (run) => screening(run, applicationId),
      );
    },
    onInterviewDue(interviewId: string) {
      return automation().run(
        TASKS.interviewQuestions,
        'event',
        { triggerRef: { interviewId }, dedupeKey: `interview:${interviewId}` },
        (run) => interviewQuestions(run, interviewId),
      );
    },
    onAllScored(interviewId: string) {
      return automation().run(
        TASKS.interviewSummary,
        'event',
        { triggerRef: { interviewId }, dedupeKey: `interview:${interviewId}` },
        (run) => interviewSummary(run, interviewId),
      );
    },
    onPlanCalculated(planId: string, hash: string) {
      return automation().run(
        TASKS.workforceExplain,
        'event',
        { triggerRef: { planId }, dedupeKey: `plan:${planId}:${hash}` },
        (run) => workforceExplain(run, planId),
      );
    },
    dailyDigest,
  };
}

export type RecruitingAssistant = ReturnType<typeof createRecruitingAssistant>;
