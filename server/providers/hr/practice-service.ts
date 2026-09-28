/**
 * Practice with the practice coach (V2 step 5): scenarios in which the coach
 * plays a team leader or a customer auditor, and the conversations employees have with
 * it before an exam or going on shift.
 *
 * A scenario is drafted (by an instructor or the coach), confirmed by its
 * instructor — by the source document's owner when the document is an SOP —
 * and only then used. A conversation runs in one AI conversation of the
 * practice coach, as the employee. Scoring is checked on the server: every
 * rubric point that earns anything must quote the employee's own words, the
 * total is the sum of the points, and a score at or above the pass mark
 * completes the linked practice task. Practice scores are practice: they never
 * reach competency levels or certificates, and managers see only the score.
 */
import { z } from 'zod';

import {
  AIShapeError,
  AIUnavailableError,
  type AIRunner,
} from './ai-runner.js';
import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import { recordDraftOutcome } from './draft-snapshots.js';
import type { ActorContext } from './framework-service.js';
import { bool, json, type Platform } from './platform.js';
import { HrError, isRecord, newId, requireString, str } from './shared.js';

const SCENARIO = 'talent.practiceScenario';
const PRACTICE = 'talent.practice';
const COACH = 'talent.practiceCoach';
const OPEN_ASSIGNMENT = ['notStarted', 'inProgress', 'overdue'] as const;
const MAX_REPLY_LENGTH = 1000;
const DOCUMENT_EXCERPT_LENGTH = 12_000;
/** A conversation with no new message for this long is abandoned. */
export const PRACTICE_IDLE_MS = 30 * 60_000;

export interface RubricPoint {
  readonly point: string;
  readonly weight: number;
  readonly competencyId: string | null;
  readonly competencyTitle?: string | null;
  readonly sourceExcerpt: string | null;
}

export interface ScenarioView {
  readonly id: string;
  readonly title: string;
  readonly persona: string;
  readonly situation: string;
  readonly openingLine: string;
  readonly rubric: readonly RubricPoint[];
  readonly sourceDocumentId: string;
  readonly sourceDocumentTitle: string | null;
  readonly maxTurns: number;
  readonly passScore: number;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: string;
  readonly reviewStatus: string;
  readonly active: boolean;
  readonly competencies: readonly { id: string; title: string }[];
  readonly usageCount: number;
  readonly averageScore: number | null;
  readonly can: { manage: boolean; confirm: boolean; discard: boolean };
}

export interface RubricResult {
  readonly point: string;
  readonly weight: number;
  readonly score: number;
  readonly quote: string | null;
  readonly suggestion: string;
  readonly clause: string | null;
}

export interface PracticeView {
  readonly id: string;
  readonly scenarioId: string;
  readonly scenarioTitle: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly assignmentId: string | null;
  readonly status: string;
  readonly score: number | null;
  readonly passScore: number;
  readonly passed: boolean | null;
  readonly turnCount: number;
  readonly maxTurns: number;
  readonly rehearsal: boolean;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  /** Absent when the caller may see only the score (a manager). */
  readonly transcript?: readonly {
    role: 'coach' | 'employee';
    text: string;
    at: string;
  }[];
  readonly rubricResults?: readonly RubricResult[];
  readonly feedback?: string | null;
  readonly situation?: string;
  readonly rubric?: readonly RubricPoint[];
  readonly sourceDocumentId?: string;
  readonly sourceDocumentTitle?: string | null;
  readonly fullAccess: boolean;
  /** The coach thinks every point has been covered; the employee may end and be scored. */
  readonly coachSuggestsEnd?: boolean;
}

export interface PracticeService {
  listScenarios(
    ctx: ActorContext,
    filters: { review?: string },
  ): Promise<ScenarioView[]>;
  getScenario(ctx: ActorContext, id: string): Promise<ScenarioView>;
  saveScenario(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<ScenarioView>;
  /** A draft written by the practice coach; each rubric point must quote its source. */
  createScenarioDraft(
    ctx: ActorContext,
    input: unknown,
    options?: { ownerUserId?: string },
  ): Promise<ScenarioView>;
  confirmScenario(ctx: ActorContext, id: string): Promise<ScenarioView>;
  discardScenario(ctx: ActorContext, id: string): Promise<void>;
  setScenarioActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<ScenarioView>;
  start(
    ctx: ActorContext,
    scenarioId: string,
    options: { assignmentId?: string; rehearsal?: boolean },
  ): Promise<PracticeView>;
  get(ctx: ActorContext, id: string): Promise<PracticeView>;
  reply(ctx: ActorContext, id: string, text: string): Promise<PracticeView>;
  finish(ctx: ActorContext, id: string): Promise<PracticeView>;
  /** One's own practice per scenario: best score, last feedback, any conversation still open. */
  mySummary(ctx: ActorContext): Promise<
    Record<
      string,
      {
        best: number | null;
        lastFeedback: string | null;
        lastPracticeId: string | null;
        openPracticeId: string | null;
        count: number;
      }
    >
  >;
  /** An employee's practice history, scores only unless the caller may read conversations. */
  history(ctx: ActorContext, employeeId: string): Promise<PracticeView[]>;
  abandonIdle(now?: Date): Promise<number>;
  /** Confirmed, active scenarios exercising any of the competencies. */
  scenariosForCompetencies(
    competencyIds: readonly string[],
  ): Promise<{ id: string; title: string }[]>;
}

export interface PracticeServiceDeps {
  readonly platform: Platform;
  readonly ai: AIRunner;
  /** A passed practice completes a task: paths move on. */
  readonly onPracticePassed?: () =>
    ((employeeId: string) => Promise<void>) | undefined;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);
/** Text compared for quotes: without whitespace and punctuation, so a quote survives the model's small edits. */
function normalizeForQuote(text: string): string {
  return text.replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

export function createPracticeService(
  deps: PracticeServiceDeps,
): PracticeService {
  const { platform, ai } = deps;
  const { database } = platform;

  // ---------- Scenarios ----------

  async function scenarioRow(id: string): Promise<Record<string, unknown>> {
    const row = await database
      .query()
      .selectFrom('practiceScenarios')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('SCENARIO_NOT_FOUND', 404);
    return row;
  }

  async function competencyTitles(
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    return new Map(
      (
        await database
          .query()
          .selectFrom('competencies')
          .select(['id', 'title'])
          .where('id', 'in', [...ids])
          .execute()
      ).map((r) => [str(r.id), str(r.title)]),
    );
  }

  async function toScenarioView(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<ScenarioView> {
    const id = str(row.id);
    const rubric = json<RubricPoint[]>(row.rubric, []);
    const titles = await competencyTitles(
      rubric.map((r) => r.competencyId).filter((v): v is string => Boolean(v)),
    );
    const document = await database
      .query()
      .selectFrom('kbDocuments')
      .select(['title'])
      .where('id', '=', str(row.sourceDocumentId))
      .executeTakeFirst();
    const sessions = await database
      .query()
      .selectFrom('practiceSessions')
      .select(['score', 'status'])
      .where('scenarioId', '=', id)
      .where('rehearsal', '=', false)
      .execute();
    const scored = sessions.filter(
      (s) => s.status === 'completed' && s.score !== null,
    );
    const manage = await tryAuthorizeAction(ctx.authz, SCENARIO, 'manage');
    const canManage = manage
      ? Boolean(
          await database
            .repository('practiceScenarios')
            .withPolicy(policyOf(manage, 'practiceScenarios'))
            .findOne({ filter: { id } }),
        )
      : false;
    const competencyIds = [
      ...new Set(rubric.map((r) => r.competencyId).filter(Boolean)),
    ] as string[];
    return {
      id,
      title: str(row.title),
      persona: str(row.persona),
      situation: str(row.situation),
      openingLine: str(row.openingLine),
      rubric: rubric.map((r) => ({
        ...r,
        competencyTitle: r.competencyId
          ? (titles.get(r.competencyId) ?? null)
          : null,
      })),
      sourceDocumentId: str(row.sourceDocumentId),
      sourceDocumentTitle: document ? str(document.title) : null,
      maxTurns: Number(row.maxTurns),
      passScore: Number(row.passScore),
      ownerUserId: str(row.ownerUserId),
      ownerName: await platform.userName(str(row.ownerUserId)),
      source: str(row.source),
      reviewStatus: str(row.reviewStatus),
      active: bool(row.active),
      competencies: competencyIds.map((cid) => ({
        id: cid,
        title: titles.get(cid) ?? cid,
      })),
      usageCount: sessions.length,
      averageScore: scored.length
        ? Math.round(
            scored.reduce((sum, s) => sum + Number(s.score), 0) / scored.length,
          )
        : null,
      can: {
        manage: canManage,
        confirm: canManage && (await platform.can(ctx, SCENARIO, 'confirm')),
        discard:
          canManage &&
          str(row.reviewStatus) === 'draft' &&
          sessions.length === 0,
      },
    };
  }

  async function visibleScenario(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, SCENARIO, 'view');
    const row = (await database
      .repository('practiceScenarios')
      .withPolicy(policyOf(policies, 'practiceScenarios'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('SCENARIO_NOT_FOUND', 404);
    return row;
  }

  function parseRubric(value: unknown, requireExcerpt: boolean): RubricPoint[] {
    if (!Array.isArray(value) || !value.length || value.length > 10)
      throw new HrError('SCENARIO_RUBRIC_INVALID', 400);
    const rubric = value.map((item) => {
      if (!isRecord(item)) throw new HrError('SCENARIO_RUBRIC_INVALID', 400);
      const weight = Number(item.weight);
      if (!Number.isInteger(weight) || weight < 1 || weight > 100)
        throw new HrError('SCENARIO_RUBRIC_INVALID', 400);
      return {
        point: requireString(item.point, 'SCENARIO_RUBRIC_INVALID', {
          max: 500,
        })!,
        weight,
        competencyId: requireString(
          item.competencyId,
          'SCENARIO_RUBRIC_INVALID',
          {
            optional: true,
            max: 64,
          },
        ),
        sourceExcerpt: requireString(
          item.sourceExcerpt,
          'SCENARIO_SOURCE_REQUIRED',
          {
            optional: !requireExcerpt,
            max: 4000,
          },
        ),
      };
    });
    if (rubric.reduce((sum, r) => sum + r.weight, 0) !== 100)
      throw new HrError('SCENARIO_RUBRIC_WEIGHT', 400);
    return rubric;
  }

  async function parseScenario(input: unknown, requireExcerpt: boolean) {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const rubric = parseRubric(input.rubric, requireExcerpt);
    const sourceDocumentId = requireString(
      input.sourceDocumentId,
      'SCENARIO_DOCUMENT_REQUIRED',
      {
        max: 64,
      },
    )!;
    if (
      !(await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id'])
        .where('id', '=', sourceDocumentId)
        .executeTakeFirst())
    )
      throw new HrError('DOCUMENT_NOT_FOUND', 404);
    const competencyIds = [
      ...new Set(rubric.map((r) => r.competencyId).filter(Boolean)),
    ] as string[];
    if ((await competencyTitles(competencyIds)).size !== competencyIds.length)
      throw new HrError('COMPETENCY_NOT_FOUND', 404);
    const maxTurns = input.maxTurns === undefined ? 12 : Number(input.maxTurns);
    const passScore =
      input.passScore === undefined ? 70 : Number(input.passScore);
    if (!Number.isInteger(maxTurns) || maxTurns < 2 || maxTurns > 40)
      throw new HrError('INVALID_INPUT', 400);
    if (!Number.isInteger(passScore) || passScore < 1 || passScore > 100)
      throw new HrError('INVALID_INPUT', 400);
    return {
      title: requireString(input.title, 'SCENARIO_TITLE_REQUIRED', {
        max: 200,
      })!,
      persona: requireString(input.persona, 'SCENARIO_PERSONA_REQUIRED', {
        max: 4000,
      })!,
      situation: requireString(input.situation, 'SCENARIO_SITUATION_REQUIRED', {
        max: 4000,
      })!,
      openingLine: requireString(
        input.openingLine,
        'SCENARIO_OPENING_REQUIRED',
        { max: 1000 },
      )!,
      rubric,
      competencyIds,
      sourceDocumentId,
      maxTurns,
      passScore,
    };
  }

  async function writeCompetencies(
    scenarioId: string,
    competencyIds: readonly string[],
  ) {
    const stamp = new Date();
    await database
      .query()
      .deleteFrom('practiceScenarioCompetencies')
      .where('scenarioId', '=', scenarioId)
      .execute();
    for (const competencyId of competencyIds)
      await database
        .query()
        .insertInto('practiceScenarioCompetencies')
        .values({
          id: newId(),
          scenarioId,
          competencyId,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
  }

  // ---------- Conversations ----------

  async function documentText(documentId: string): Promise<string> {
    const doc = await database
      .query()
      .selectFrom('kbDocuments')
      .select(['title', 'contentText'])
      .where('id', '=', documentId)
      .executeTakeFirst();
    if (!doc) return '';
    return `《${str(doc.title)}》\n${str(doc.contentText ?? '').slice(0, DOCUMENT_EXCERPT_LENGTH)}`;
  }

  type Turn = { role: 'coach' | 'employee'; text: string; at: string };

  async function practiceRow(id: string): Promise<Record<string, unknown>> {
    const row = await database
      .query()
      .selectFrom('practiceSessions')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('PRACTICE_NOT_FOUND', 404);
    return row;
  }

  /** The caller's own practice, for acting on it. */
  async function ownPractice(
    ctx: ActorContext,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, PRACTICE, 'start');
    const row = (await database
      .repository('practiceSessions')
      .withPolicy(policyOf(policies, 'practiceSessions'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    const employee = await platform.employeeOfUser(ctx.userId);
    if (!row || !employee || str(row.employeeId) !== employee.id)
      throw new HrError('PRACTICE_NOT_FOUND', 404);
    return row;
  }

  async function toPracticeView(
    row: Record<string, unknown>,
    fullAccess: boolean,
  ): Promise<PracticeView> {
    const scenario = await scenarioRow(str(row.scenarioId));
    const employee = await platform.employee(str(row.employeeId));
    const score =
      row.score === null || row.score === undefined ? null : Number(row.score);
    const base = {
      id: str(row.id),
      scenarioId: str(row.scenarioId),
      scenarioTitle: str(scenario.title),
      employeeId: str(row.employeeId),
      employeeName: employee?.name ?? '',
      assignmentId: nullable(row.assignmentId),
      status: str(row.status),
      score,
      passScore: Number(scenario.passScore),
      passed: score === null ? null : score >= Number(scenario.passScore),
      turnCount: Number(row.turnCount) || 0,
      maxTurns: Number(scenario.maxTurns),
      rehearsal: bool(row.rehearsal),
      startedAt: iso(row.startedAt),
      completedAt: iso(row.completedAt),
      fullAccess,
    };
    if (!fullAccess) return base;
    const document = await database
      .query()
      .selectFrom('kbDocuments')
      .select(['title'])
      .where('id', '=', str(scenario.sourceDocumentId))
      .executeTakeFirst();
    return {
      ...base,
      transcript: json<Turn[]>(row.transcript, []),
      rubricResults:
        json<RubricResult[] | null>(row.rubricResults, null) ?? undefined,
      feedback: nullable(row.feedback),
      situation: str(scenario.situation),
      rubric: json<RubricPoint[]>(scenario.rubric, []),
      sourceDocumentId: str(scenario.sourceDocumentId),
      sourceDocumentTitle: document ? str(document.title) : null,
    };
  }

  function aiError(error: unknown): never {
    // The model answered but not in the format: say so, rather than claiming there is no model.
    if (error instanceof AIShapeError)
      throw new HrError('AI_RESPONSE_INVALID', 409);
    if (error instanceof AIUnavailableError)
      throw new HrError('AI_UNAVAILABLE', 409);
    throw error;
  }

  async function coachReply(
    row: Record<string, unknown>,
    scenario: Record<string, unknown>,
    employeeText: string,
    userId: string,
    turnNo: number,
  ): Promise<{ reply: string; end: boolean; sessionId: string }> {
    const rubric = json<RubricPoint[]>(scenario.rubric, []);
    const first = !row.conversationSessionId;
    const prompt = first
      ? [
          '【陪练设定】你正在进行一次岗位陪练，请始终保持以下角色，不要跳出角色讲课，也不要直接给出正确答案。',
          `角色与语气：${str(scenario.persona)}`,
          `情境（员工也看得到）：${str(scenario.situation)}`,
          `你要考察的要点（不要告诉员工）：${rubric.map((r) => r.point).join('；')}`,
          '事实标准只有下面这份依据文档；不要引入文档之外的规定和数字。员工说错时像真实的班组长或审核员那样追问。',
          await documentText(str(scenario.sourceDocumentId)),
          `你已经说出的开场白：${str(scenario.openingLine)}`,
          `员工的回答（第 ${turnNo}/${Number(scenario.maxTurns)} 轮）：${employeeText}`,
          '请以角色身份说下一句（不超过 150 字）。所有要点都已问到或对话自然结束时，把 end 设为 true。',
        ].join('\n')
      : `员工的回答（第 ${turnNo}/${Number(scenario.maxTurns)} 轮）：${employeeText}\n请继续以角色身份说下一句（不超过 150 字）；所有要点都已问到时把 end 设为 true。`;
    const result = await ai
      .structured({
        employee: 'practiceCoach',
        userId,
        title: `陪练：${str(scenario.title)}`,
        prompt,
        schema: z.object({
          reply: z.string().min(1).max(1000),
          end: z.boolean(),
        }),
        timeZone: platform.timeZone,
        sessionId: first ? undefined : str(row.conversationSessionId),
        unattended: false,
      })
      .catch(aiError);
    return { ...result.data, sessionId: result.sessionId };
  }

  const evaluationSchema = z.object({
    results: z
      .array(
        z.object({
          point: z.string(),
          score: z.number(),
          quote: z.string().nullable(),
          suggestion: z.string().max(500),
          clause: z.string().max(200).nullable(),
        }),
      )
      .min(1)
      .max(10),
    feedback: z.string().max(2000),
  });

  /** Scores a finished conversation; points that earn anything must quote the employee verbatim. */
  async function evaluate(
    row: Record<string, unknown>,
    scenario: Record<string, unknown>,
    userId: string,
  ): Promise<{ score: number; results: RubricResult[]; feedback: string }> {
    const rubric = json<RubricPoint[]>(scenario.rubric, []);
    const transcript = json<Turn[]>(row.transcript, []);
    const said = normalizeForQuote(
      transcript
        .filter((t) => t.role === 'employee')
        .map((t) => t.text)
        .join('\n'),
    );
    const basePrompt = [
      '请为这次陪练评分。逐条对照评分要点：',
      ...rubric.map(
        (r, i) =>
          `${i + 1}. ${r.point}（满分 ${r.weight} 分）${r.sourceExcerpt ? `；依据原文：${r.sourceExcerpt}` : ''}`,
      ),
      '规则：每条要点给 0 到满分之间的整数分；得分大于 0 的要点必须在 quote 中逐字引用员工的原话；员工没有说到的要点记 0 分、quote 为 null，并在 suggestion 中说明。',
      'suggestion 写具体的改进建议；clause 写对应的依据文档条款（如“WI-MC-0231 5.2”）。feedback 先说做得好的地方，再给最多 3 条改进建议。',
      '只以下面的依据文档为事实标准：',
      await documentText(str(scenario.sourceDocumentId)),
      '对话记录：',
      ...transcript.map(
        (t) => `${t.role === 'coach' ? '陪练' : '员工'}：${t.text}`,
      ),
    ].join('\n');
    let correction = '';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { data } = await ai
        .structured({
          employee: 'practiceCoach',
          userId,
          title: `陪练评分：${str(scenario.title)}`,
          prompt: basePrompt + correction,
          schema: evaluationSchema,
          timeZone: platform.timeZone,
        })
        .catch(aiError);
      const problems: string[] = [];
      const results: RubricResult[] = rubric.map((point, index) => {
        const found =
          data.results.find((r) => r.point.trim() === point.point.trim()) ??
          data.results[index];
        const score = Math.max(
          0,
          Math.min(point.weight, Math.round(Number(found?.score) || 0)),
        );
        const quote = found?.quote?.trim() || null;
        if (
          score > 0 &&
          (!quote ||
            !said.includes(normalizeForQuote(quote)) ||
            normalizeForQuote(quote).length < 2)
        )
          problems.push(point.point);
        return {
          point: point.point,
          weight: point.weight,
          score,
          quote: score > 0 ? quote : null,
          suggestion: found?.suggestion ?? '',
          clause: found?.clause ?? null,
        };
      });
      if (!problems.length)
        return {
          score: results.reduce((sum, r) => sum + r.score, 0),
          results,
          feedback: data.feedback,
        };
      correction = `\n\n上一次的评分中，这些要点给了分却没有逐字引用员工原话（或引用不在对话中）：${problems.join('；')}。请重新评分，引用必须是员工说过的原话，找不到原话的要点记 0 分。`;
    }
    throw new HrError('PRACTICE_EVALUATION_INVALID', 409);
  }

  async function completePractice(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<void> {
    const scenario = await scenarioRow(str(row.scenarioId));
    const evaluation = await evaluate(row, scenario, ctx.userId);
    const stamp = new Date();
    await database
      .query()
      .updateTable('practiceSessions')
      .set({
        status: 'completed',
        score: evaluation.score,
        rubricResults: JSON.stringify(evaluation.results),
        feedback: evaluation.feedback,
        completedAt: stamp,
        lastActivityAt: stamp,
        updatedAt: stamp,
      })
      .where('id', '=', str(row.id))
      .where('status', '=', 'inProgress')
      .execute();
    if (bool(row.rehearsal) || evaluation.score < Number(scenario.passScore))
      return;
    const employeeId = str(row.employeeId);
    const target = row.assignmentId
      ? str(row.assignmentId)
      : str(
          (
            await database
              .query()
              .selectFrom('assignments')
              .select(['id'])
              .where('employeeId', '=', employeeId)
              .where('practiceScenarioId', '=', str(row.scenarioId))
              .where('status', 'in', [...OPEN_ASSIGNMENT])
              .executeTakeFirst()
          )?.id ?? '',
        );
    if (target)
      await database
        .query()
        .updateTable('assignments')
        .set({
          status: 'completed',
          progress: 100,
          completedAt: stamp,
          updatedAt: stamp,
        })
        .where('id', '=', target)
        .where('status', 'in', [...OPEN_ASSIGNMENT])
        .execute();
    await deps.onPracticePassed?.()?.(employeeId);
  }

  const service: PracticeService = {
    async listScenarios(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, SCENARIO, 'view');
      let rows = (await database
        .repository('practiceScenarios')
        .withPolicy(policyOf(policies, 'practiceScenarios'))
        .findMany({ sort: (s) => [s.field('updatedAt').desc()] })) as Record<
        string,
        unknown
      >[];
      if (filters.review === 'mine')
        rows = rows.filter(
          (r) =>
            r.reviewStatus === 'draft' && str(r.ownerUserId) === ctx.userId,
        );
      const result: ScenarioView[] = [];
      for (const row of rows) result.push(await toScenarioView(ctx, row));
      return result;
    },

    async getScenario(ctx, id) {
      return toScenarioView(ctx, await visibleScenario(ctx, id));
    },

    async saveScenario(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, SCENARIO, 'manage');
      const existing = id
        ? ((await database
            .repository('practiceScenarios')
            .withPolicy(policyOf(policies, 'practiceScenarios'))
            .findOne({ filter: { id } })) as
            Record<string, unknown> | undefined)
        : undefined;
      if (id && !existing) throw new HrError('SCENARIO_NOT_FOUND', 404);
      const parsed = await parseScenario(input, existing?.source === 'ai');
      const { competencyIds, ...fields } = parsed;
      const stamp = new Date();
      const scenarioId = id ?? newId();
      const repo = database
        .repository('practiceScenarios')
        .withPolicy(policyOf(policies, 'practiceScenarios'));
      // Any edit returns the scenario to draft for another confirmation.
      const values = {
        ...fields,
        rubric: JSON.stringify(fields.rubric),
        reviewStatus: 'draft',
        updatedAt: stamp,
      };
      if (existing)
        await repo.updateOne({ filter: { id: scenarioId }, values });
      else
        await repo.createOne({
          values: {
            id: scenarioId,
            ...values,
            ownerUserId: ctx.userId,
            source: 'manual',
            active: true,
            createdAt: stamp,
          },
        });
      await writeCompetencies(scenarioId, competencyIds);
      return service.getScenario(ctx, scenarioId);
    },

    async createScenarioDraft(ctx, input, options = {}) {
      await authorizeAction(ctx.authz, COACH, 'use');
      const parsed = await parseScenario(input, true);
      const { competencyIds, ...fields } = parsed;
      const stamp = new Date();
      const scenarioId = newId();
      await database
        .query()
        .insertInto('practiceScenarios')
        .values({
          id: scenarioId,
          ...fields,
          rubric: JSON.stringify(fields.rubric),
          ownerUserId: options.ownerUserId ?? ctx.userId,
          source: 'ai',
          reviewStatus: 'draft',
          active: true,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      await writeCompetencies(scenarioId, competencyIds);
      return toScenarioView(ctx, await scenarioRow(scenarioId));
    },

    async confirmScenario(ctx, id) {
      const policies = await authorizeAction(ctx.authz, SCENARIO, 'confirm');
      const row = await visibleScenario(ctx, id);
      const manage = await tryAuthorizeAction(ctx.authz, SCENARIO, 'manage');
      if (
        !manage ||
        !(await database
          .repository('practiceScenarios')
          .withPolicy(policyOf(manage, 'practiceScenarios'))
          .findOne({ filter: { id } }))
      )
        throw new HrError('FORBIDDEN', 403);
      // 总纲 AI 员工约定第 6 条: a scenario on a safety procedure is confirmed by the procedure's owner.
      const document = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['category', 'ownerUserId'])
        .where('id', '=', str(row.sourceDocumentId))
        .executeTakeFirst();
      if (
        document?.category === 'sop' &&
        str(document.ownerUserId) !== ctx.userId
      )
        throw new HrError('SCENARIO_CONFIRM_OWNER_ONLY', 403);
      await database
        .repository('practiceScenarios')
        .withPolicy(policyOf(policies, 'practiceScenarios'))
        .updateOne({
          filter: { id },
          values: { reviewStatus: 'confirmed', updatedAt: new Date() },
        });
      await recordDraftOutcome(
        database,
        'practiceScenario',
        id,
        'confirmed',
        ctx.userId,
      );
      return service.getScenario(ctx, id);
    },

    async discardScenario(ctx, id) {
      const view = await service.getScenario(ctx, id);
      if (!view.can.discard) throw new HrError('SCENARIO_NOT_DISCARDABLE', 409);
      await recordDraftOutcome(
        database,
        'practiceScenario',
        id,
        'discarded',
        ctx.userId,
      );
      await database
        .query()
        .deleteFrom('practiceScenarioCompetencies')
        .where('scenarioId', '=', id)
        .execute();
      await database
        .query()
        .deleteFrom('practiceScenarios')
        .where('id', '=', id)
        .execute();
    },

    async setScenarioActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, SCENARIO, 'manage');
      await visibleScenario(ctx, id);
      await database
        .repository('practiceScenarios')
        .withPolicy(policyOf(policies, 'practiceScenarios'))
        .updateOne({
          filter: { id },
          values: { active, updatedAt: new Date() },
        });
      return service.getScenario(ctx, id);
    },

    async start(ctx, scenarioId, options) {
      const scenario = await scenarioRow(scenarioId);
      const rehearsal = options.rehearsal === true;
      if (rehearsal) {
        // An instructor's trial run of a scenario they manage, draft or not; it counts nowhere.
        const manage = await authorizeAction(ctx.authz, SCENARIO, 'manage');
        if (
          !(await database
            .repository('practiceScenarios')
            .withPolicy(policyOf(manage, 'practiceScenarios'))
            .findOne({ filter: { id: scenarioId } }))
        )
          throw new HrError('SCENARIO_NOT_FOUND', 404);
      } else if (
        scenario.reviewStatus !== 'confirmed' ||
        !bool(scenario.active)
      )
        throw new HrError('SCENARIO_NOT_CONFIRMED', 409);
      const policies = await authorizeAction(ctx.authz, PRACTICE, 'start');
      const employee = await platform.employeeOfUser(ctx.userId);
      if (!employee) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
      let assignmentId: string | null = null;
      if (options.assignmentId) {
        const assignment = await database
          .query()
          .selectFrom('assignments')
          .select(['employeeId', 'practiceScenarioId', 'status'])
          .where('id', '=', options.assignmentId)
          .executeTakeFirst();
        if (
          !assignment ||
          str(assignment.employeeId) !== employee.id ||
          str(assignment.practiceScenarioId) !== scenarioId
        )
          throw new HrError('ASSIGNMENT_NOT_FOUND', 404);
        if (assignment.status === 'locked')
          throw new HrError('ASSIGNMENT_LOCKED', 409);
        assignmentId = options.assignmentId;
      }
      const open = await database
        .query()
        .selectFrom('practiceSessions')
        .selectAll()
        .where('employeeId', '=', employee.id)
        .where('scenarioId', '=', scenarioId)
        .where('status', '=', 'inProgress')
        .where('rehearsal', '=', rehearsal)
        .executeTakeFirst();
      if (open) return toPracticeView(open, true);
      const stamp = new Date();
      const id = newId();
      await database
        .repository('practiceSessions')
        .withPolicy(policyOf(policies, 'practiceSessions'))
        .createOne({
          values: {
            id,
            scenarioId,
            employeeId: employee.id,
            assignmentId,
            transcript: JSON.stringify([
              {
                role: 'coach',
                text: str(scenario.openingLine),
                at: stamp.toISOString(),
              },
            ]),
            turnCount: 0,
            status: 'inProgress',
            score: null,
            rubricResults: null,
            feedback: null,
            rehearsal,
            conversationSessionId: null,
            startedAt: stamp,
            completedAt: null,
            lastActivityAt: stamp,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      if (assignmentId)
        await database
          .query()
          .updateTable('assignments')
          .set({ status: 'inProgress', updatedAt: stamp })
          .where('id', '=', assignmentId)
          .where('status', '=', 'notStarted')
          .execute();
      return toPracticeView(await practiceRow(id), true);
    },

    async get(ctx, id) {
      const row = await practiceRow(id);
      // The whole conversation: oneself, the scenario's instructor, HR administrators.
      const full = await tryAuthorizeAction(ctx.authz, PRACTICE, 'view');
      if (
        full &&
        (await database
          .repository('practiceSessions')
          .withPolicy(policyOf(full, 'practiceSessions'))
          .findOne({ filter: { id } }))
      )
        return toPracticeView(row, true);
      const scores = await tryAuthorizeAction(
        ctx.authz,
        PRACTICE,
        'viewScores',
      );
      if (
        scores &&
        (await database
          .repository('practiceSessions')
          .withPolicy(policyOf(scores, 'practiceSessions'))
          .findOne({ filter: { id } }))
      )
        return toPracticeView(row, false);
      throw new HrError('PRACTICE_NOT_FOUND', 404);
    },

    async reply(ctx, id, text) {
      const row = await ownPractice(ctx, id);
      if (row.status !== 'inProgress')
        throw new HrError('PRACTICE_CLOSED', 409);
      const message = text.trim();
      if (!message || message.length > MAX_REPLY_LENGTH)
        throw new HrError('PRACTICE_REPLY_INVALID', 400);
      const scenario = await scenarioRow(str(row.scenarioId));
      const turnNo = (Number(row.turnCount) || 0) + 1;
      if (turnNo > Number(scenario.maxTurns))
        throw new HrError('PRACTICE_TURNS_EXHAUSTED', 409);
      const transcript = json<Turn[]>(row.transcript, []);
      const now = new Date().toISOString();
      transcript.push({ role: 'employee', text: message, at: now });
      const last = turnNo >= Number(scenario.maxTurns);
      // The last allowed turn gets no reply: the practice ends and is scored.
      let end = last;
      let sessionId = nullable(row.conversationSessionId);
      if (!last) {
        const coach = await coachReply(
          row,
          scenario,
          message,
          ctx.userId,
          turnNo,
        );
        transcript.push({
          role: 'coach',
          text: coach.reply,
          at: new Date().toISOString(),
        });
        end = coach.end;
        sessionId = coach.sessionId;
      }
      const stamp = new Date();
      await database
        .query()
        .updateTable('practiceSessions')
        .set({
          transcript: JSON.stringify(transcript),
          turnCount: turnNo,
          conversationSessionId: sessionId,
          lastActivityAt: stamp,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .where('status', '=', 'inProgress')
        .execute();
      if (last) await completePractice(ctx, await practiceRow(id));
      const view = await toPracticeView(await practiceRow(id), true);
      return end && !last ? { ...view, coachSuggestsEnd: true } : view;
    },

    async finish(ctx, id) {
      const row = await ownPractice(ctx, id);
      if (row.status !== 'inProgress')
        throw new HrError('PRACTICE_CLOSED', 409);
      if (!(Number(row.turnCount) > 0))
        throw new HrError('PRACTICE_EMPTY', 409);
      await completePractice(ctx, row);
      return toPracticeView(await practiceRow(id), true);
    },

    async mySummary(ctx) {
      const policies = await authorizeAction(ctx.authz, PRACTICE, 'start');
      const rows = (await database
        .repository('practiceSessions')
        .withPolicy(policyOf(policies, 'practiceSessions'))
        .findMany({
          filter: { rehearsal: false },
          sort: (s) => [s.field('createdAt').desc()],
        })) as Record<string, unknown>[];
      const result: Awaited<ReturnType<PracticeService['mySummary']>> = {};
      for (const row of rows) {
        const key = str(row.scenarioId);
        const entry = (result[key] ??= {
          best: null,
          lastFeedback: null,
          lastPracticeId: null,
          openPracticeId: null,
          count: 0,
        });
        entry.count += 1;
        if (row.status === 'inProgress' && !entry.openPracticeId)
          entry.openPracticeId = str(row.id);
        if (row.status === 'completed') {
          if (!entry.lastPracticeId) {
            entry.lastPracticeId = str(row.id);
            entry.lastFeedback = nullable(row.feedback);
          }
          const score = Number(row.score);
          if (entry.best === null || score > entry.best) entry.best = score;
        }
      }
      return result;
    },

    async history(ctx, employeeId) {
      const full = await tryAuthorizeAction(ctx.authz, PRACTICE, 'view');
      const scores = await tryAuthorizeAction(
        ctx.authz,
        PRACTICE,
        'viewScores',
      );
      if (!full && !scores) throw new HrError('FORBIDDEN', 403);
      // Each grant has its own scope (a manager's full view covers only their own practices), so both are read.
      const read = async (policies: typeof full) =>
        policies
          ? ((await database
              .repository('practiceSessions')
              .withPolicy(policyOf(policies, 'practiceSessions'))
              .findMany({
                filter: { employeeId, rehearsal: false },
                sort: (s) => [s.field('createdAt').desc()],
              })) as Record<string, unknown>[])
          : [];
      const fullRows = await read(full);
      const fullIds = new Set(fullRows.map((r) => str(r.id)));
      const rows = [
        ...fullRows,
        ...(await read(scores)).filter((r) => !fullIds.has(str(r.id))),
      ];
      const result: PracticeView[] = [];
      for (const row of rows) {
        // A profile lists scores; the conversation opens on the practice page for those who may read it.
        const view = await toPracticeView(row, false);
        result.push({ ...view, fullAccess: fullIds.has(str(row.id)) });
      }
      return result;
    },

    async abandonIdle(now = new Date()) {
      const cutoff = new Date(now.getTime() - PRACTICE_IDLE_MS);
      const stale = await database
        .query()
        .selectFrom('practiceSessions')
        .select(['id'])
        .where('status', '=', 'inProgress')
        .where('lastActivityAt', '<', cutoff)
        .execute();
      for (const row of stale)
        await database
          .query()
          .updateTable('practiceSessions')
          .set({ status: 'abandoned', updatedAt: now })
          .where('id', '=', str(row.id))
          .where('status', '=', 'inProgress')
          .execute();
      return stale.length;
    },

    async scenariosForCompetencies(competencyIds) {
      if (!competencyIds.length) return [];
      const rows = await database
        .query()
        .selectFrom('practiceScenarioCompetencies')
        .innerJoin(
          'practiceScenarios',
          'practiceScenarios.id',
          'practiceScenarioCompetencies.scenarioId',
        )
        .select([
          'practiceScenarios.id as id',
          'practiceScenarios.title as title',
        ])
        .where('practiceScenarioCompetencies.competencyId', 'in', [
          ...competencyIds,
        ])
        .where('practiceScenarios.reviewStatus', '=', 'confirmed')
        .where('practiceScenarios.active', '=', true)
        .execute();
      const seen = new Map<string, string>();
      for (const row of rows) seen.set(str(row.id), str(row.title));
      return [...seen].map(([id, title]) => ({ id, title }));
    },
  };
  return service;
}
