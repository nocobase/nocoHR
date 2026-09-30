/**
 * V3-11 待我决定: the talent analyst's two kinds of suggestion, and the
 * rules that decide what they may say.
 *
 * - 专项培训建议: a department and competency with at least
 *   `clusterMinCount` matched quality issues of active employees within
 *   `clusterWindowDays`, and no unfinished recommendation, is a cluster. The
 *   audience is the department's active employees whose position requires the
 *   competency. The learning coach fills 2–4 items; the head approves
 *   (removing people, never adding content), which assigns the items with
 *   source=recommendation. When every assignment is complete the
 *   recommendation completes, a proof PDF is written and, when configured,
 *   the 8D reports are told.
 * - 能力等级建议: candidates by the administrator's rules (see
 *   `inferenceCandidates`); a suggestion needs at least two pieces of evidence
 *   and moves one level. The head decides the level; accepting writes an
 *   assessment in the head's name, never the analyst's.
 *
 * Reviewers are the head of the employee's (or the department's) department,
 * walking up; without one, the automation's owner (hr01 by default).
 */
import { createHmac } from 'node:crypto';

import { authorizeAction, policyOf } from '../authorize.js';
import { addWorkingDays } from '../document-changes.js';
import type { ActorContext } from '../framework-service.js';
import { json } from '../platform.js';
import {
  addDays,
  HrError,
  isRecord,
  newId,
  requireString,
  str,
} from '../shared.js';
import {
  dateOnly,
  daysBefore,
  iso,
  isActive,
  nullable,
  onOrAfter,
  type LevelRow,
  type PersonRow,
  type ProfileDeps,
  type ProfileReads,
} from './context.js';
import { renderPdf, type PdfBlock } from './pdf.js';

const SUGGESTION = 'talent.competencySuggestion';
const RECOMMENDATION = 'talent.trainingRecommendation';
const OPEN_ASSIGNMENT = ['notStarted', 'inProgress', 'overdue', 'locked'];
/** Recommendations that block a new one for the same department and competency. */
export const UNFINISHED_RECOMMENDATION = ['drafting', 'draft', 'approved'];
export const MAX_ITEMS = 4;

export interface EvidenceItem {
  readonly type: 'signal' | 'examAttempt' | 'practiceSession';
  readonly id: string;
  readonly summary: string;
}

export interface Cluster {
  readonly departmentId: string;
  readonly departmentTitle: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly signals: readonly {
    id: string;
    externalId: string;
    title: string;
    category: string | null;
    severity: string | null;
    occurredAt: string;
    employeeId: string;
    correctiveActionRef: string | null;
    shift: string | null;
  }[];
}

export interface InferenceCandidate {
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly currentLevel: number;
  readonly suggestedLevel: number;
  readonly direction: 'up' | 'down';
  readonly requiredLevel: number | null;
  readonly evidence: readonly EvidenceItem[];
  /** For the wording: common categories and possible non-personal causes. */
  readonly categories: readonly string[];
  readonly shifts: readonly string[];
}

export interface LearningItem {
  readonly type: 'course' | 'practice' | 'exam';
  readonly id: string;
  readonly title: string;
}

export interface InferenceRules {
  readonly windowDays: number;
  readonly downgradeMinIssues: number;
  readonly upgradeExamPercent: number;
  readonly upgradeMinDelivered: number;
}

export function createDecisionService(deps: ProfileDeps, reads: ProfileReads) {
  const { platform } = deps;
  const { database, organization, notify } = platform;

  async function competencyTitle(id: string): Promise<string> {
    return (await reads.competencies()).get(id)?.title ?? id;
  }

  /** The value of an administrator-added field named like 班次 on a signal, for "possible non-personal causes". */
  async function shiftOf(row: Record<string, unknown>): Promise<string | null> {
    const values = json<Record<string, unknown>>(row.customFields, {});
    const defs = await deps
      .customFields()
      .list('businessSignals' as never)
      .catch(() => []);
    for (const def of defs)
      if (
        /班次|shift/iu.test(`${def.label['zh-CN']} ${def.label['en-US'] ?? ''}`)
      ) {
        const value = values[def.key];
        if (value !== undefined && value !== null && value !== '')
          return (
            def.options.find((o) => o.value === value)?.label ?? str(value)
          );
      }
    return null;
  }

  async function reviewerForDepartment(
    departmentId: string,
    fallback: string,
  ): Promise<string> {
    return (await organization.resolveHead(departmentId))?.userId ?? fallback;
  }

  async function reviewerForEmployee(
    employee: PersonRow,
    fallback: string,
  ): Promise<string> {
    return (
      (await platform.headOf({
        departmentId: employee.departmentId,
        userId: employee.userId,
      })) ?? fallback
    );
  }

  async function recommendationRow(
    ctx: ActorContext,
    action: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, RECOMMENDATION, action);
    const row = (await database
      .repository('trainingRecommendations')
      .withPolicy(policyOf(policies, 'trainingRecommendations'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('RECOMMENDATION_NOT_FOUND', 404);
    return row;
  }

  async function suggestionRow(
    ctx: ActorContext,
    action: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, SUGGESTION, action);
    const row = (await database
      .repository('competencySuggestions')
      .withPolicy(policyOf(policies, 'competencySuggestions'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('SUGGESTION_NOT_FOUND', 404);
    return row;
  }

  async function recommendationView(row: Record<string, unknown>) {
    const audience = json<{ employeeId: string; reason: string }[]>(
      row.audience,
      [],
    );
    const people = new Map(
      (await reads.people(audience.map((a) => a.employeeId))).map((p) => [
        p.id,
        p,
      ]),
    );
    const assignments = await database
      .query()
      .selectFrom('assignments')
      .select(['employeeId', 'status', 'completedAt'])
      .where('trainingRecommendationId', '=', str(row.id))
      .execute();
    const departmentId = str(row.departmentId);
    return {
      id: str(row.id),
      departmentId,
      departmentTitle: await deps.departmentTitle(departmentId),
      competencyId: str(row.competencyId),
      competencyTitle: await competencyTitle(str(row.competencyId)),
      reason: str(row.reason),
      evidence: json<
        {
          signalId: string;
          externalId: string;
          summary: string;
          occurredAt?: string;
        }[]
      >(row.evidence, []),
      audience: audience.map((a) => ({
        ...a,
        name: people.get(a.employeeId)?.name ?? a.employeeId,
        employeeNo: people.get(a.employeeId)?.employeeNo ?? '',
        assignments: assignments.filter(
          (x) => str(x.employeeId) === a.employeeId,
        ).length,
        completed: assignments.filter(
          (x) => str(x.employeeId) === a.employeeId && x.status === 'completed',
        ).length,
      })),
      items: json<LearningItem[]>(row.items, []),
      dueDate: dateOnly(row.dueDate),
      correctiveActionRefs: json<string[]>(row.correctiveActionRefs, []),
      reviewerUserId: str(row.reviewerUserId),
      reviewerName: await platform.userName(str(row.reviewerUserId)),
      status: str(row.status),
      reviewedByName: await platform.userName(nullable(row.reviewedBy)),
      reviewedAt: iso(row.reviewedAt),
      reviewNote: nullable(row.reviewNote),
      completedAt: iso(row.completedAt),
      hasProof: Boolean(row.certificateFileId),
      writebackStatus: nullable(row.writebackStatus),
      writebackError: nullable(row.writebackError),
      writebackAt: iso(row.writebackAt),
      createdAt: iso(row.createdAt) ?? '',
    };
  }

  async function suggestionView(row: Record<string, unknown>) {
    const employee = (await reads.people([str(row.employeeId)]))[0];
    return {
      id: str(row.id),
      employeeId: str(row.employeeId),
      employeeName: employee?.name ?? str(row.employeeId),
      employeeNo: employee?.employeeNo ?? '',
      departmentTitle: row.departmentId
        ? await deps.departmentTitle(str(row.departmentId))
        : '',
      competencyId: str(row.competencyId),
      competencyTitle: await competencyTitle(str(row.competencyId)),
      currentLevel: Number(row.currentLevel),
      suggestedLevel: Number(row.suggestedLevel),
      rationale: str(row.rationale),
      evidence: json<EvidenceItem[]>(row.evidence, []),
      reviewerUserId: str(row.reviewerUserId),
      reviewerName: await platform.userName(str(row.reviewerUserId)),
      status: str(row.status),
      decidedLevel:
        row.decidedLevel === null || row.decidedLevel === undefined
          ? null
          : Number(row.decidedLevel),
      reviewedByName: await platform.userName(nullable(row.reviewedBy)),
      reviewedAt: iso(row.reviewedAt),
      reviewNote: nullable(row.reviewNote),
      assessmentId: nullable(row.assessmentId),
      createdAt: iso(row.createdAt) ?? '',
    };
  }

  /** Learning content for a competency, most relevant to the categories first; exams last. */
  async function contentFor(
    competencyId: string,
    keywords: readonly string[],
  ): Promise<{
    courses: (LearningItem & { score: number })[];
    practices: (LearningItem & { score: number })[];
    exams: (LearningItem & { score: number })[];
  }> {
    const query = database.query();
    const relevance = (text: string) =>
      keywords.filter((k) => k && text.includes(k)).length;
    const courseRows = await query
      .selectFrom('courseCompetencies')
      .innerJoin('courses', 'courses.id', 'courseCompetencies.courseId')
      .select([
        'courses.id as id',
        'courses.title as title',
        'courses.description as description',
        'courses.deliveryMode as deliveryMode',
        'courses.kind as kind',
      ])
      .where('courseCompetencies.competencyId', '=', competencyId)
      .where('courses.published', '=', true)
      .where('courses.active', '=', true)
      .where('courses.reviewStatus', '=', 'confirmed')
      .execute();
    const courses = [];
    for (const row of courseRows) {
      // Online standard courses only: an offline one needs a session, a change brief its own audience.
      if (row.deliveryMode === 'offline' || row.kind === 'changeBrief')
        continue;
      const lessons = await query
        .selectFrom('lessons')
        .select(['title', 'content'])
        .where('courseId', '=', str(row.id))
        .execute();
      courses.push({
        type: 'course' as const,
        id: str(row.id),
        title: str(row.title),
        score: relevance(
          `${str(row.title)} ${str(row.description ?? '')} ${lessons.map((l) => `${str(l.title)} ${str(l.content ?? '')}`).join(' ')}`,
        ),
      });
    }
    const practiceRows = await query
      .selectFrom('practiceScenarioCompetencies')
      .innerJoin(
        'practiceScenarios',
        'practiceScenarios.id',
        'practiceScenarioCompetencies.scenarioId',
      )
      .select([
        'practiceScenarios.id as id',
        'practiceScenarios.title as title',
        'practiceScenarios.situation as situation',
      ])
      .where('practiceScenarioCompetencies.competencyId', '=', competencyId)
      .where('practiceScenarios.active', '=', true)
      .where('practiceScenarios.reviewStatus', '=', 'confirmed')
      .execute();
    const practices = practiceRows.map((row) => ({
      type: 'practice' as const,
      id: str(row.id),
      title: str(row.title),
      score: relevance(`${str(row.title)} ${str(row.situation)}`),
    }));
    // How many of an exam's questions assess the competency: the exam most about it comes first.
    const tagged = await query
      .selectFrom('examQuestions')
      .innerJoin(
        'questionCompetencies',
        'questionCompetencies.questionId',
        'examQuestions.questionId',
      )
      .select(['examQuestions.examId as examId'])
      .where('questionCompetencies.competencyId', '=', competencyId)
      .execute();
    const weight = new Map<string, number>();
    for (const row of tagged)
      weight.set(str(row.examId), (weight.get(str(row.examId)) ?? 0) + 1);
    for (const exam of await query
      .selectFrom('exams')
      .select(['id', 'randomRules'])
      .execute())
      for (const rule of json<
        { competencyId?: string | null; count?: number }[]
      >(exam.randomRules, []))
        if (rule?.competencyId === competencyId)
          weight.set(
            str(exam.id),
            (weight.get(str(exam.id)) ?? 0) + (Number(rule.count) || 1),
          );
    // A certification's exam (上岗考试) proves the competency best.
    const certifying = new Set(
      (
        await query
          .selectFrom('certificationExams')
          .select(['examId'])
          .execute()
      ).map((r) => str(r.examId)),
    );
    const examCompetencies = await reads.examCompetencies();
    const examRows = await query
      .selectFrom('exams')
      .select(['id', 'title', 'description'])
      .where('published', '=', true)
      .where('active', '=', true)
      .execute();
    const exams = examRows
      .filter((row) => examCompetencies.get(str(row.id))?.has(competencyId))
      .map((row) => ({
        type: 'exam' as const,
        id: str(row.id),
        title: str(row.title),
        score:
          relevance(`${str(row.title)} ${str(row.description ?? '')}`) * 100 +
          (certifying.has(str(row.id)) ? 50 : 0) +
          (weight.get(str(row.id)) ?? 0),
      }));
    const order = <T extends { score: number; title: string }>(list: T[]) =>
      list.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    return {
      courses: order(courses),
      practices: order(practices),
      exams: order(exams),
    };
  }

  /** The 8D write-back: the report numbers and the proof link, signed with the configured secret. */
  async function writeBack(id: string): Promise<string> {
    const row = await database
      .query()
      .selectFrom('trainingRecommendations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('RECOMMENDATION_NOT_FOUND', 404);
    const config = deps.config();
    const refs = json<string[]>(row.correctiveActionRefs, []);
    const stamp = new Date();
    if (!config.writebackUrl) {
      await database
        .query()
        .updateTable('trainingRecommendations')
        .set({
          writebackStatus: 'notConfigured',
          writebackError: null,
          writebackAt: null,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      return 'notConfigured';
    }
    const body = JSON.stringify({
      recommendationId: id,
      correctiveActionRefs: refs,
      completedAt: iso(row.completedAt),
      proofUrl: `${config.publicOrigin}${config.basePath.replace(/\/$/u, '')}/api/talent/training-recommendations/${id}/proof`,
    });
    let status = 'succeeded';
    let error: string | null = null;
    try {
      const response = await fetch(config.writebackUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(config.writebackSecret
            ? {
                'x-nocohr-signature': createHmac(
                  'sha256',
                  config.writebackSecret,
                )
                  .update(body)
                  .digest('hex'),
              }
            : {}),
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        status = 'failed';
        error = `HTTP ${response.status}`;
      }
    } catch (failure) {
      status = 'failed';
      error =
        failure instanceof Error ? failure.message.slice(0, 500) : 'failed';
    }
    await database
      .query()
      .updateTable('trainingRecommendations')
      .set({
        writebackStatus: status,
        writebackError: error,
        writebackAt: new Date(),
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .execute();
    if (status === 'failed')
      await notify({
        key: `recommendation:${id}:writebackFailed:${Date.now()}`,
        userIds: await fallbackRecipients(),
        message: 'recommendationWritebackFailed',
        params: { refs: refs.join('、') },
        path: '/talent/signals',
      });
    return status;
  }

  async function fallbackRecipients(): Promise<string[]> {
    const owner = await database
      .query()
      .selectFrom('aiAutomationSettings')
      .select(['ownerUserId'])
      .where('id', '=', 'talentAnalyst.trainingCheck')
      .executeTakeFirst();
    return owner?.ownerUserId ? [str(owner.ownerUserId)] : [];
  }

  /** The proof: participants, content, completion time, course and document versions. */
  async function proofPdf(id: string): Promise<Uint8Array> {
    const row = await database
      .query()
      .selectFrom('trainingRecommendations')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('RECOMMENDATION_NOT_FOUND', 404);
    const view = await recommendationView(row);
    const assignments = await database
      .query()
      .selectFrom('assignments')
      .select([
        'employeeId',
        'courseId',
        'examId',
        'practiceScenarioId',
        'status',
        'completedAt',
        'courseVersion',
        'courseSourceDocumentId',
      ])
      .where('trainingRecommendationId', '=', id)
      .execute();
    const documents = new Map(
      (
        await database
          .query()
          .selectFrom('kbDocuments')
          .select(['id', 'title', 'docNo', 'version'])
          .execute()
      ).map((d) => [
        str(d.id),
        `${str(d.docNo ?? d.title)} ${str(d.version ?? '')}`.trim(),
      ]),
    );
    const titleOf = (a: Record<string, unknown>) =>
      view.items.find(
        (i) => i.id === (a.courseId ?? a.examId ?? a.practiceScenarioId),
      )?.title ?? str(a.courseId ?? a.examId ?? a.practiceScenarioId ?? '');
    const rows: string[][] = [
      ['参加人', '工号', '内容', '完成时间', '课程版本', '来源文档'],
    ];
    for (const person of view.audience)
      for (const a of assignments.filter(
        (x) => str(x.employeeId) === person.employeeId,
      ))
        rows.push([
          person.name,
          person.employeeNo,
          titleOf(a),
          (iso(a.completedAt) ?? '').replace('T', ' ').slice(0, 16),
          a.courseId ? `V${Number(a.courseVersion ?? 1)}` : '—',
          a.courseSourceDocumentId
            ? (documents.get(str(a.courseSourceDocumentId)) ?? '')
            : '—',
        ]);
    const blocks: PdfBlock[] = [
      { kind: 'title', text: '专项培训证明' },
      {
        kind: 'muted',
        text: `生成时间：${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`,
      },
      { kind: 'heading', text: '培训概况' },
      { kind: 'text', text: `部门：${view.departmentTitle}` },
      { kind: 'text', text: `能力项：${view.competencyTitle}` },
      {
        kind: 'text',
        text: `相关 8D 报告：${view.correctiveActionRefs.join('、') || '无'}`,
      },
      { kind: 'text', text: `培训原因：${view.reason}` },
      {
        kind: 'text',
        text: `培训内容：${view.items.map((i) => i.title).join('、')}`,
      },
      {
        kind: 'text',
        text: `确认人：${view.reviewedByName ?? ''} · 确认时间：${(view.reviewedAt ?? '').slice(0, 10)}`,
      },
      {
        kind: 'text',
        text: `全部完成时间：${(view.completedAt ?? '').replace('T', ' ').slice(0, 16)}`,
      },
      { kind: 'heading', text: '参加人与完成情况' },
      { kind: 'table', rows },
    ];
    return renderPdf(blocks, {
      title: '专项培训证明',
      footer: 'NocoHR 专项培训证明',
    });
  }

  const service = {
    recommendationView,
    suggestionView,
    contentFor,
    proofPdf,

    // ---------- 专项培训建议 ----------

    /** Departments and competencies with repeated quality issues and no unfinished recommendation. */
    async clusters(params: {
      clusterWindowDays: number;
      clusterMinCount: number;
    }): Promise<Cluster[]> {
      const since = daysBefore(params.clusterWindowDays);
      const rows = await database
        .query()
        .selectFrom('businessSignals')
        .innerJoin('employees', 'employees.id', 'businessSignals.employeeId')
        .select([
          'businessSignals.id as id',
          'businessSignals.externalId as externalId',
          'businessSignals.title as title',
          'businessSignals.category as category',
          'businessSignals.severity as severity',
          'businessSignals.occurredAt as occurredAt',
          'businessSignals.employeeId as employeeId',
          'businessSignals.departmentId as departmentId',
          'businessSignals.competencyId as competencyId',
          'businessSignals.correctiveActionRef as correctiveActionRef',
          'businessSignals.customFields as customFields',
          'employees.status as status',
        ])
        .where('businessSignals.matchStatus', '=', 'matched')
        .where('businessSignals.signalType', '=', 'qualityIssue')
        .execute();
      const groups = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        if (!onOrAfter(row.occurredAt, since)) continue;
        // An employee who has left keeps their records, but they no longer count.
        if (row.status === 'leave' || !row.departmentId || !row.competencyId)
          continue;
        const key = `${str(row.departmentId)}|${str(row.competencyId)}`;
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      const clusters: Cluster[] = [];
      for (const [key, list] of groups) {
        if (list.length < params.clusterMinCount) continue;
        const [departmentId, competencyId] = key.split('|');
        const open = await database
          .query()
          .selectFrom('trainingRecommendations')
          .select(['id'])
          .where('departmentId', '=', departmentId)
          .where('competencyId', '=', competencyId)
          .where('status', 'in', UNFINISHED_RECOMMENDATION)
          .executeTakeFirst();
        if (open) continue;
        const signals = [];
        for (const row of list.sort((a, b) =>
          (iso(a.occurredAt) ?? '').localeCompare(iso(b.occurredAt) ?? ''),
        ))
          signals.push({
            id: str(row.id),
            externalId: str(row.externalId),
            title: str(row.title),
            category: nullable(row.category),
            severity: nullable(row.severity),
            occurredAt: iso(row.occurredAt) ?? '',
            employeeId: str(row.employeeId),
            correctiveActionRef: nullable(row.correctiveActionRef),
            shift: await shiftOf(row),
          });
        clusters.push({
          departmentId,
          departmentTitle: await deps.departmentTitle(departmentId),
          competencyId,
          competencyTitle: await competencyTitle(competencyId),
          signals,
        });
      }
      return clusters;
    },

    /** Active employees of the department (and below) whose current position requires the competency. */
    async audienceFor(
      departmentId: string,
      competencyId: string,
    ): Promise<{ employeeId: string; reason: string }[]> {
      const departments = new Set(
        await organization.descendantsOf(departmentId),
      );
      const requirements = await reads.requirements();
      const positions = await reads.positions();
      const title = await competencyTitle(competencyId);
      return (await reads.people())
        .filter((p) => isActive(p) && departments.has(p.departmentId))
        .filter((p) =>
          (requirements.get(p.positionId ?? '') ?? []).some(
            (r) => r.competencyId === competencyId,
          ),
        )
        .sort((a, b) => a.employeeNo.localeCompare(b.employeeNo))
        .map((p) => ({
          employeeId: p.id,
          reason: `当前岗位“${positions.get(p.positionId ?? '') ?? ''}”要求“${title}”`,
        }));
    },

    /** Creates a drafting recommendation for a cluster; refused when the cluster no longer qualifies. */
    async createRecommendation(input: {
      departmentId: string;
      competencyId: string;
      reason: string;
      signalIds: readonly string[];
      params: { clusterWindowDays: number; clusterMinCount: number };
      fallbackReviewer: string;
    }): Promise<string> {
      const cluster = (await service.clusters(input.params)).find(
        (c) =>
          c.departmentId === input.departmentId &&
          c.competencyId === input.competencyId,
      );
      if (!cluster) throw new HrError('RECOMMENDATION_NO_CLUSTER', 409);
      const signals = cluster.signals.filter(
        (s) => !input.signalIds.length || input.signalIds.includes(s.id),
      );
      if (signals.length < input.params.clusterMinCount)
        throw new HrError('RECOMMENDATION_EVIDENCE_INSUFFICIENT', 400);
      const audience = await service.audienceFor(
        input.departmentId,
        input.competencyId,
      );
      if (!audience.length)
        throw new HrError('RECOMMENDATION_NO_AUDIENCE', 409);
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('trainingRecommendations')
        .values({
          id,
          departmentId: input.departmentId,
          competencyId: input.competencyId,
          reason: input.reason.slice(0, 4000),
          evidence: signals.map((s) => ({
            signalId: s.id,
            externalId: s.externalId,
            occurredAt: s.occurredAt,
            summary: [s.category, s.severity, s.shift]
              .filter(Boolean)
              .join(' · '),
          })),
          audience,
          items: null,
          dueDate: null,
          correctiveActionRefs: [
            ...new Set(
              signals
                .map((s) => s.correctiveActionRef)
                .filter((r): r is string => Boolean(r)),
            ),
          ],
          reviewerUserId: await reviewerForDepartment(
            input.departmentId,
            input.fallbackReviewer,
          ),
          status: 'drafting',
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          completedAt: null,
          certificateFileId: null,
          writebackStatus: null,
          writebackError: null,
          writebackAt: null,
          source: 'ai',
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return id;
    },

    /** The learning coach's content; once only, from what `contentFor` offers. */
    async fillItems(input: {
      recommendationId: string;
      items: readonly { type: string; id: string }[];
      dueWorkingDays: number;
      note: string | null;
    }): Promise<{ items: LearningItem[]; needsContent: boolean }> {
      const row = await database
        .query()
        .selectFrom('trainingRecommendations')
        .selectAll()
        .where('id', '=', input.recommendationId)
        .executeTakeFirst();
      if (!row) throw new HrError('RECOMMENDATION_NOT_FOUND', 404);
      if (row.status !== 'drafting')
        throw new HrError('RECOMMENDATION_ALREADY_FILLED', 409);
      const offered = await contentFor(str(row.competencyId), []);
      const all = [...offered.courses, ...offered.practices, ...offered.exams];
      const items: LearningItem[] = [];
      for (const pick of input.items.slice(0, MAX_ITEMS)) {
        const found = all.find((o) => o.id === pick.id && o.type === pick.type);
        if (found && !items.some((i) => i.id === found.id))
          items.push({ type: found.type, id: found.id, title: found.title });
      }
      // An exam, when present, comes last.
      items.sort(
        (a, b) => Number(a.type === 'exam') - Number(b.type === 'exam'),
      );
      const needsContent = items.length < 2;
      const reason =
        needsContent && !str(row.reason).includes('需要讲师补充内容')
          ? `${str(row.reason)}\n需要讲师补充内容：学习教练没有找到足够的“${await competencyTitle(str(row.competencyId))}”课程、陪练或考试。${input.note ? ` ${input.note}` : ''}`
          : str(row.reason);
      await database
        .query()
        .updateTable('trainingRecommendations')
        .set({
          items,
          dueDate: addWorkingDays(platform.currentDate(), input.dueWorkingDays),
          reason,
          status: 'draft',
          updatedAt: new Date(),
        })
        .where('id', '=', input.recommendationId)
        .where('status', '=', 'drafting')
        .execute();
      return { items, needsContent };
    },

    async listRecommendations(ctx: ActorContext, filters: { status?: string }) {
      const policies = await authorizeAction(ctx.authz, RECOMMENDATION, 'view');
      const rows = (await database
        .repository('trainingRecommendations')
        .withPolicy(policyOf(policies, 'trainingRecommendations'))
        .findMany({ sort: (s) => [s.field('createdAt').desc()] })) as Record<
        string,
        unknown
      >[];
      const wanted =
        filters.status === 'open'
          ? ['draft']
          : filters.status
            ? [filters.status]
            : null;
      const views = [];
      for (const row of rows)
        if (!wanted || wanted.includes(str(row.status)))
          views.push(await recommendationView(row));
      return {
        items: views,
        can: {
          approve: await platform.can(ctx, RECOMMENDATION, 'approve'),
          reject: await platform.can(ctx, RECOMMENDATION, 'reject'),
          retryWriteback: await platform.can(
            ctx,
            RECOMMENDATION,
            'retryWriteback',
          ),
        },
      };
    },

    /** Approves with people removed (never added); assigns every item to each remaining person. */
    async approve(ctx: ActorContext, id: string, input: unknown) {
      const row = await recommendationRow(ctx, 'approve', id);
      if (row.status !== 'draft')
        throw new HrError('RECOMMENDATION_NOT_OPEN', 409);
      const removed = new Set(
        isRecord(input) && Array.isArray(input.removeEmployeeIds)
          ? input.removeEmployeeIds.map((v) => str(v))
          : [],
      );
      const audience = json<{ employeeId: string; reason: string }[]>(
        row.audience,
        [],
      ).filter((a) => !removed.has(a.employeeId));
      if (!audience.length)
        throw new HrError('RECOMMENDATION_NO_AUDIENCE', 400);
      const items = json<LearningItem[]>(row.items, []);
      if (!items.length) throw new HrError('RECOMMENDATION_NO_ITEMS', 409);
      const note = requireString(
        isRecord(input) ? input.note : undefined,
        'INVALID_INPUT',
        { optional: true, max: 1000 },
      );
      const due =
        dateOnly(row.dueDate) ?? addWorkingDays(platform.currentDate(), 10);
      const stamp = new Date();
      await database
        .query()
        .updateTable('trainingRecommendations')
        .set({
          audience,
          status: 'approved',
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          reviewNote: note,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .execute();
      for (const person of audience) {
        let created = 0;
        for (const item of items) {
          const column =
            item.type === 'course'
              ? 'courseId'
              : item.type === 'exam'
                ? 'examId'
                : 'practiceScenarioId';
          const open = await database
            .query()
            .selectFrom('assignments')
            .select(['id', 'trainingRecommendationId'])
            .where('employeeId', '=', person.employeeId)
            .where(column, '=', item.id)
            .where('status', 'in', OPEN_ASSIGNMENT)
            // A certificate's renewal task stays its own; the recommendation gets its own task.
            .where('certificateId', 'is', null)
            .executeTakeFirst();
          if (open) {
            // An unfinished task for the same content counts toward this recommendation.
            if (!open.trainingRecommendationId)
              await database
                .query()
                .updateTable('assignments')
                .set({ trainingRecommendationId: id, updatedAt: stamp })
                .where('id', '=', str(open.id))
                .execute();
            continue;
          }
          await database
            .query()
            .insertInto('assignments')
            .values({
              id: newId(),
              employeeId: person.employeeId,
              courseId: item.type === 'course' ? item.id : null,
              examId: item.type === 'exam' ? item.id : null,
              certificateId: null,
              learningPathId: null,
              parentAssignmentId: null,
              pathStepId: null,
              practiceScenarioId: item.type === 'practice' ? item.id : null,
              learningPlanId: null,
              jobEventId: null,
              optional: false,
              reminderCount: 0,
              assignedByUserId: ctx.userId,
              dueDate: due,
              status: 'notStarted',
              progress: 0,
              source: 'recommendation',
              trainingRecommendationId: id,
              courseVersion: null,
              courseSourceDocumentId: null,
              completedAt: null,
              cancelledAt: null,
              lastRemindedAt: null,
              escalatedAt: null,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
          created += 1;
        }
        const employee = (await reads.people([person.employeeId]))[0];
        if (employee?.userId && created)
          await notify({
            key: `recommendation:${id}:assigned:${person.employeeId}`,
            userIds: [employee.userId],
            message: 'recommendationAssigned',
            params: {
              competency: await competencyTitle(str(row.competencyId)),
              date: due,
            },
            path: '/talent/learning',
          });
      }
      await reads.recordOutcome(
        'trainingRecommendation',
        id,
        removed.size ? 'modified' : 'adopted',
        ctx.userId,
      );
      // Everything may already be complete (tasks that existed before).
      await service.checkCompletion([id]);
      return recommendationView(
        (await database
          .query()
          .selectFrom('trainingRecommendations')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst())!,
      );
    },

    async rejectRecommendation(ctx: ActorContext, id: string, input: unknown) {
      const row = await recommendationRow(ctx, 'reject', id);
      if (row.status !== 'draft' && row.status !== 'drafting')
        throw new HrError('RECOMMENDATION_NOT_OPEN', 409);
      const reason = requireString(
        isRecord(input) ? input.reason : undefined,
        'RECOMMENDATION_REJECT_REASON_REQUIRED',
        { max: 1000 },
      )!;
      const stamp = new Date();
      await database
        .query()
        .updateTable('trainingRecommendations')
        .set({
          status: 'rejected',
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          reviewNote: reason,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      await reads.recordOutcome(
        'trainingRecommendation',
        id,
        'discarded',
        ctx.userId,
      );
      return recommendationView({
        ...row,
        status: 'rejected',
        reviewNote: reason,
        reviewedBy: ctx.userId,
        reviewedAt: stamp,
      });
    },

    async retryWriteback(ctx: ActorContext, id: string) {
      const row = await recommendationRow(ctx, 'retryWriteback', id);
      if (row.status !== 'completed')
        throw new HrError('RECOMMENDATION_NOT_COMPLETED', 409);
      await writeBack(id);
      return recommendationView(
        (await database
          .query()
          .selectFrom('trainingRecommendations')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst())!,
      );
    },

    /** The proof of a completed recommendation, for its readers. */
    async proof(
      ctx: ActorContext,
      id: string,
    ): Promise<{ bytes: Uint8Array; filename: string }> {
      let row: Record<string, unknown> | undefined;
      try {
        row = await recommendationRow(ctx, 'view', id);
      } catch (error) {
        if (!(error instanceof HrError) || error.status !== 403) throw error;
        // Auditors read proofs through the audit export.
        const policies = await authorizeAction(
          ctx.authz,
          'talent.audit',
          'exportRecommendationProof',
        );
        row = await database
          .repository('trainingRecommendations')
          .withPolicy(policyOf(policies, 'trainingRecommendations'))
          .findOne({ filter: { id } });
      }
      if (!row?.certificateFileId)
        throw new HrError('RECOMMENDATION_NO_PROOF', 404);
      const file = await reads.readFile(
        deps.drive(),
        str(row.certificateFileId),
      );
      if (!file) throw new HrError('RECOMMENDATION_NO_PROOF', 404);
      return { bytes: file.bytes, filename: file.filename };
    },

    /** Completes approved recommendations whose every assignment is done; the proof and the write-back follow. */
    async checkCompletion(ids?: readonly string[]): Promise<string[]> {
      let q = database
        .query()
        .selectFrom('trainingRecommendations')
        .selectAll()
        .where('status', '=', 'approved');
      if (ids) {
        if (!ids.length) return [];
        q = q.where('id', 'in', [...ids]);
      }
      const completed: string[] = [];
      for (const row of await q.execute()) {
        const id = str(row.id);
        const assignments = await database
          .query()
          .selectFrom('assignments')
          .select(['status', 'completedAt'])
          .where('trainingRecommendationId', '=', id)
          .where('status', '!=', 'cancelled')
          .execute();
        if (
          !assignments.length ||
          assignments.some((a) => a.status !== 'completed')
        )
          continue;
        const completedAt = assignments
          .map((a) => iso(a.completedAt) ?? '')
          .sort()
          .at(-1);
        const stamp = new Date();
        const updated = await database
          .query()
          .updateTable('trainingRecommendations')
          .set({
            status: 'completed',
            completedAt: completedAt ? new Date(completedAt) : stamp,
            updatedAt: stamp,
          })
          .where('id', '=', id)
          .where('status', '=', 'approved')
          .execute();
        // Another trigger completed it first.
        if (
          !Number(
            (updated as { numUpdatedRows?: bigint | number }).numUpdatedRows ??
              1,
          )
        )
          continue;
        const fileId = await reads.storeFile(deps.drive(), {
          folder: 'training-proofs',
          name: `training-proof-${id.slice(0, 8)}.pdf`,
          bytes: await proofPdf(id),
          mimeType: 'application/pdf',
        });
        await database
          .query()
          .updateTable('trainingRecommendations')
          .set({ certificateFileId: fileId, updatedAt: new Date() })
          .where('id', '=', id)
          .execute();
        await writeBack(id);
        const view = await recommendationView(
          (await database
            .query()
            .selectFrom('trainingRecommendations')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst())!,
        );
        await notify({
          key: `recommendation:${id}:completed`,
          userIds: [
            ...new Set([
              str(row.reviewerUserId),
              ...(row.reviewedBy ? [str(row.reviewedBy)] : []),
              ...(await fallbackRecipients()),
            ]),
          ],
          message: 'recommendationCompleted',
          params: {
            department: view.departmentTitle,
            competency: view.competencyTitle,
          },
          path: `/talent/decisions?tab=recommendations&id=${id}`,
        });
        completed.push(id);
      }
      return completed;
    },

    /** Recommendations of the assignments an employee just completed. */
    async checkCompletionFor(employeeId: string): Promise<string[]> {
      const rows = await database
        .query()
        .selectFrom('assignments')
        .select(['trainingRecommendationId'])
        .where('employeeId', '=', employeeId)
        .where('trainingRecommendationId', 'is not', null)
        .execute();
      return service.checkCompletion([
        ...new Set(rows.map((r) => str(r.trainingRecommendationId))),
      ]);
    },

    /** Failed write-backs, for the notice on 业务数据. */
    async failedWritebacks(ctx: ActorContext) {
      const { items } = await service.listRecommendations(ctx, {
        status: 'completed',
      });
      return items.filter((i) => i.writebackStatus === 'failed');
    },

    // ---------- 能力等级建议 ----------

    /**
     * Candidates by the administrator's rules, skipping people with a draft
     * for the competency:
     *
     * - down: at least `downgradeMinIssues` major-or-worse quality issues for
     *   the competency within `windowDays`;
     * - up, when the current level is below the position's requirement or an
     *   active or achieved development target's: no related quality issue in
     *   the window with a related exam at `upgradeExamPercent` or better and
     *   the related practice passed (when the competency has scenarios); or
     *   at least `upgradeMinDelivered` project tasks delivered on time.
     */
    async inferenceCandidates(
      rules: InferenceRules,
    ): Promise<InferenceCandidate[]> {
      const query = database.query();
      const since = daysBefore(rules.windowDays);
      const people = (await reads.people()).filter(isActive);
      const byId = new Map(people.map((p) => [p.id, p]));
      const levels = await reads.levels(people.map((p) => p.id));
      const requirements = await reads.requirements();
      const competencies = await reads.competencies();
      const signals = (
        await query
          .selectFrom('businessSignals')
          .select([
            'id',
            'externalId',
            'title',
            'category',
            'severity',
            'signalType',
            'occurredAt',
            'employeeId',
            'competencyId',
            'customFields',
          ])
          .where('matchStatus', '=', 'matched')
          .execute()
      ).filter((s) => onOrAfter(s.occurredAt, since));
      const drafts = await query
        .selectFrom('competencySuggestions')
        .select(['employeeId', 'competencyId'])
        .where('status', '=', 'draft')
        .execute();
      const hasDraft = (employeeId: string, competencyId: string) =>
        drafts.some(
          (d) =>
            str(d.employeeId) === employeeId &&
            str(d.competencyId) === competencyId,
        );
      const targets = await query
        .selectFrom('developmentTargets')
        .select(['employeeId', 'targetPositionId', 'status'])
        .where('status', 'in', ['active', 'achieved'])
        .execute();
      const examCompetencies = await reads.examCompetencies();
      const attempts = await query
        .selectFrom('examAttempts')
        .innerJoin('exams', 'exams.id', 'examAttempts.examId')
        .select([
          'examAttempts.id as id',
          'examAttempts.examId as examId',
          'examAttempts.employeeId as employeeId',
          'examAttempts.score as score',
          'examAttempts.paperSnapshot as paperSnapshot',
          'examAttempts.submittedAt as submittedAt',
          'examAttempts.status as status',
          'exams.title as title',
        ])
        .where('examAttempts.status', 'in', ['passed', 'failed'])
        .where('examAttempts.voidReason', 'is', null)
        .execute();
      const scenarioCompetencies = await query
        .selectFrom('practiceScenarioCompetencies')
        .innerJoin(
          'practiceScenarios',
          'practiceScenarios.id',
          'practiceScenarioCompetencies.scenarioId',
        )
        .select([
          'practiceScenarioCompetencies.scenarioId as scenarioId',
          'practiceScenarioCompetencies.competencyId as competencyId',
          'practiceScenarios.passScore as passScore',
          'practiceScenarios.title as title',
          'practiceScenarios.active as active',
        ])
        .execute();
      const sessions = await query
        .selectFrom('practiceSessions')
        .select([
          'id',
          'scenarioId',
          'employeeId',
          'score',
          'status',
          'completedAt',
          'rehearsal',
        ])
        .where('status', '=', 'completed')
        .execute();
      const shiftOfRow = async (row: Record<string, unknown>) => shiftOf(row);
      const candidates: InferenceCandidate[] = [];

      for (const person of people) {
        const own = signals.filter((s) => str(s.employeeId) === person.id);
        const current = levels.get(person.id) ?? new Map<string, LevelRow>();
        const required = new Map<string, number>();
        for (const r of requirements.get(person.positionId ?? '') ?? [])
          required.set(r.competencyId, r.requiredLevel);
        for (const target of targets.filter(
          (t) => str(t.employeeId) === person.id,
        )) {
          if (str(target.targetPositionId) === person.positionId) continue;
          for (const r of requirements.get(str(target.targetPositionId)) ?? [])
            required.set(
              r.competencyId,
              Math.max(required.get(r.competencyId) ?? 0, r.requiredLevel),
            );
        }
        const competencyIds = new Set([
          ...current.keys(),
          ...required.keys(),
          ...own.map((s) => str(s.competencyId)),
        ]);
        for (const competencyId of competencyIds) {
          const competency = competencies.get(competencyId);
          if (!competency?.active || hasDraft(person.id, competencyId))
            continue;
          const level = current.get(competencyId)?.level ?? 0;
          const related = own.filter(
            (s) => str(s.competencyId) === competencyId,
          );
          const serious = related.filter(
            (s) =>
              s.signalType === 'qualityIssue' &&
              (s.severity === 'major' || s.severity === 'critical'),
          );
          if (serious.length >= rules.downgradeMinIssues && level > 0) {
            const shifts: string[] = [];
            for (const s of serious) {
              const shift = await shiftOfRow(s);
              if (shift) shifts.push(shift);
            }
            candidates.push({
              employeeId: person.id,
              employeeName: person.name,
              departmentId: person.departmentId,
              competencyId,
              competencyTitle: competency.title,
              currentLevel: level,
              suggestedLevel: level - 1,
              direction: 'down',
              requiredLevel: required.get(competencyId) ?? null,
              evidence: serious
                .sort((a, b) =>
                  (iso(a.occurredAt) ?? '').localeCompare(
                    iso(b.occurredAt) ?? '',
                  ),
                )
                .map((s) => ({
                  type: 'signal' as const,
                  id: str(s.id),
                  summary:
                    `${str(s.externalId)} ${str(s.category ?? '')} ${str(s.severity ?? '')} ${dateOnly(s.occurredAt)}`.trim(),
                })),
              categories: [
                ...new Set(
                  serious.map((s) => str(s.category ?? '')).filter(Boolean),
                ),
              ],
              shifts: [...new Set(shifts)],
            });
            continue;
          }
          const requiredLevel = required.get(competencyId);
          if (requiredLevel === undefined || level >= requiredLevel) continue;
          if (level >= competency.maxLevel) continue;
          const examEvidence: EvidenceItem[] = attempts
            .filter(
              (a) =>
                str(a.employeeId) === person.id &&
                a.status === 'passed' &&
                (examCompetencies.get(str(a.examId))?.has(competencyId) ??
                  false) &&
                (reads.attemptPercent(a) ?? 0) >= rules.upgradeExamPercent &&
                new Date(iso(a.submittedAt) ?? 0) >= since,
            )
            .map((a) => ({
              type: 'examAttempt' as const,
              id: str(a.id),
              summary: `${str(a.title)} ${reads.attemptPercent(a)} 分`,
            }))
            .slice(-1);
          const delivered = related.filter(
            (s) => s.signalType === 'taskDelivered',
          );
          const issues = related.filter((s) => s.signalType === 'qualityIssue');
          const scenarios = scenarioCompetencies.filter(
            (sc) =>
              str(sc.competencyId) === competencyId &&
              (sc.active === true || sc.active === 1),
          );
          const practiceEvidence: EvidenceItem[] = sessions
            .filter(
              (s) =>
                str(s.employeeId) === person.id &&
                !(s.rehearsal === true || s.rehearsal === 1) &&
                scenarios.some(
                  (sc) =>
                    str(sc.scenarioId) === str(s.scenarioId) &&
                    Number(s.score ?? 0) >= Number(sc.passScore ?? 70),
                ),
            )
            .map((s) => ({
              type: 'practiceSession' as const,
              id: str(s.id),
              summary: `${str(scenarios.find((sc) => str(sc.scenarioId) === str(s.scenarioId))?.title ?? '')} ${Number(s.score)} 分`,
            }))
            .slice(-1);
          const practiceOk = !scenarios.length || practiceEvidence.length > 0;
          let evidence: EvidenceItem[] = [];
          if (delivered.length >= rules.upgradeMinDelivered)
            evidence = [
              ...delivered.map((s) => ({
                type: 'signal' as const,
                id: str(s.id),
                summary: `${str(s.externalId)} ${str(s.title)} 按期交付 ${dateOnly(s.occurredAt)}`,
              })),
              ...examEvidence,
            ];
          else if (!issues.length && examEvidence.length && practiceOk)
            evidence = [...examEvidence, ...practiceEvidence];
          if (evidence.length < 2) continue;
          candidates.push({
            employeeId: person.id,
            employeeName: person.name,
            departmentId: person.departmentId,
            competencyId,
            competencyTitle: competency.title,
            currentLevel: level,
            suggestedLevel: level + 1,
            direction: 'up',
            requiredLevel,
            evidence,
            categories: [
              ...new Set(
                delivered.map((s) => str(s.category ?? '')).filter(Boolean),
              ),
            ],
            shifts: [],
          });
        }
      }
      void byId;
      return candidates;
    },

    /** A draft suggestion; refused with fewer than two pieces of evidence or a move of more than one level. */
    async createSuggestion(input: {
      employeeId: string;
      competencyId: string;
      suggestedLevel: number;
      rationale: string;
      evidence: readonly EvidenceItem[];
      fallbackReviewer: string;
    }): Promise<string> {
      if (input.evidence.length < 2)
        throw new HrError('SUGGESTION_EVIDENCE_INSUFFICIENT', 400);
      const employee = (await reads.people([input.employeeId]))[0];
      if (!employee || !isActive(employee))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const competency = (await reads.competencies()).get(input.competencyId);
      if (!competency?.active) throw new HrError('COMPETENCY_NOT_FOUND', 404);
      const current =
        (await reads.levels([employee.id])).get(employee.id)?.get(competency.id)
          ?.level ?? 0;
      if (
        !Number.isInteger(input.suggestedLevel) ||
        Math.abs(input.suggestedLevel - current) !== 1 ||
        input.suggestedLevel < 0 ||
        input.suggestedLevel > competency.maxLevel
      )
        throw new HrError('SUGGESTION_LEVEL_INVALID', 400);
      const draft = await database
        .query()
        .selectFrom('competencySuggestions')
        .select(['id'])
        .where('employeeId', '=', employee.id)
        .where('competencyId', '=', competency.id)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (draft) throw new HrError('SUGGESTION_EXISTS', 409);
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('competencySuggestions')
        .values({
          id,
          employeeId: employee.id,
          competencyId: competency.id,
          departmentId: employee.departmentId,
          currentLevel: current,
          suggestedLevel: input.suggestedLevel,
          rationale: input.rationale.slice(0, 4000),
          evidence: input.evidence.map((e) => ({
            type: e.type,
            id: e.id,
            summary: e.summary.slice(0, 300),
          })),
          reviewerUserId: await reviewerForEmployee(
            employee,
            input.fallbackReviewer,
          ),
          status: 'draft',
          decidedLevel: null,
          reviewedBy: null,
          reviewedAt: null,
          reviewNote: null,
          assessmentId: null,
          source: 'ai',
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return id;
    },

    async listSuggestions(ctx: ActorContext, filters: { status?: string }) {
      const policies = await authorizeAction(ctx.authz, SUGGESTION, 'view');
      const rows = (await database
        .repository('competencySuggestions')
        .withPolicy(policyOf(policies, 'competencySuggestions'))
        .findMany({ sort: (s) => [s.field('createdAt').desc()] })) as Record<
        string,
        unknown
      >[];
      const wanted =
        filters.status === 'open'
          ? ['draft']
          : filters.status
            ? [filters.status]
            : null;
      const views = [];
      for (const row of rows)
        if (!wanted || wanted.includes(str(row.status)))
          views.push(await suggestionView(row));
      return {
        items: views,
        can: {
          accept: await platform.can(ctx, SUGGESTION, 'accept'),
          reject: await platform.can(ctx, SUGGESTION, 'reject'),
        },
      };
    },

    /** The head decides the level (the suggestion or another) and an assessment is written in their name. */
    async acceptSuggestion(ctx: ActorContext, id: string, input: unknown) {
      const row = await suggestionRow(ctx, 'accept', id);
      if (row.status !== 'draft') throw new HrError('SUGGESTION_NOT_OPEN', 409);
      const level =
        isRecord(input) && input.level !== undefined && input.level !== null
          ? Number(input.level)
          : Number(row.suggestedLevel);
      if (!Number.isInteger(level))
        throw new HrError('ASSESSMENT_LEVEL_INVALID', 400);
      const note = requireString(
        isRecord(input) ? input.note : undefined,
        'INVALID_INPUT',
        { optional: true, max: 1000 },
      );
      const evidence = json<EvidenceItem[]>(row.evidence, []);
      const text = [
        `采纳人才分析师的能力等级建议（${Number(row.currentLevel)} → ${Number(row.suggestedLevel)}），评定为 ${level} 级。`,
        `依据：${evidence.map((e) => e.summary).join('；')}`,
        note ? `说明：${note}` : '',
      ]
        .filter(Boolean)
        .join('\n');
      const assessment = (await deps
        .competency()
        .assess(ctx, str(row.employeeId), {
          competencyId: str(row.competencyId),
          level,
          evidence: text.slice(0, 4000),
        })) as { id: string };
      const stamp = new Date();
      await database
        .query()
        .updateTable('employeeCompetencies')
        .set({ suggestionId: id, updatedAt: stamp })
        .where('id', '=', assessment.id)
        .execute();
      await database
        .query()
        .updateTable('competencySuggestions')
        .set({
          status: 'accepted',
          decidedLevel: level,
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          reviewNote: note,
          assessmentId: assessment.id,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      await reads.recordOutcome(
        'competencySuggestion',
        id,
        level === Number(row.suggestedLevel) ? 'adopted' : 'modified',
        ctx.userId,
      );
      return suggestionView({
        ...row,
        status: 'accepted',
        decidedLevel: level,
        reviewedBy: ctx.userId,
        reviewedAt: stamp,
        reviewNote: note,
        assessmentId: assessment.id,
      });
    },

    async rejectSuggestion(ctx: ActorContext, id: string, input: unknown) {
      const row = await suggestionRow(ctx, 'reject', id);
      if (row.status !== 'draft') throw new HrError('SUGGESTION_NOT_OPEN', 409);
      const reason = requireString(
        isRecord(input) ? input.reason : undefined,
        'SUGGESTION_REJECT_REASON_REQUIRED',
        { max: 1000 },
      )!;
      const stamp = new Date();
      await database
        .query()
        .updateTable('competencySuggestions')
        .set({
          status: 'rejected',
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          reviewNote: reason,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      await reads.recordOutcome(
        'competencySuggestion',
        id,
        'discarded',
        ctx.userId,
      );
      return suggestionView({
        ...row,
        status: 'rejected',
        reviewedBy: ctx.userId,
        reviewedAt: stamp,
        reviewNote: reason,
      });
    },

    /** 09:00: drafts nobody decided in time expire. */
    async expire(input: {
      suggestionDays: number;
      recommendationDays: number;
    }): Promise<{ suggestions: number; recommendations: number }> {
      const today = platform.currentDate();
      const cutoff = (days: number) =>
        new Date(`${addDays(today, -days)}T00:00:00Z`);
      const stamp = new Date();
      const expire = async (
        table: string,
        statuses: string[],
        days: number,
      ) => {
        const rows = await database
          .query()
          .selectFrom(table)
          .select(['id', 'createdAt'])
          .where('status', 'in', statuses)
          .execute();
        const ids = rows
          .filter((r) => !onOrAfter(r.createdAt, cutoff(days)))
          .map((r) => str(r.id));
        if (ids.length)
          await database
            .query()
            .updateTable(table)
            .set({ status: 'expired', updatedAt: stamp })
            .where('id', 'in', ids)
            .execute();
        return ids.length;
      };
      const suggestions = await expire(
        'competencySuggestions',
        ['draft'],
        input.suggestionDays,
      );
      const recommendations = await expire(
        'trainingRecommendations',
        ['draft', 'drafting'],
        input.recommendationDays,
      );
      const count = (value: number) => value;
      return {
        suggestions: count(suggestions),
        recommendations: count(recommendations),
      };
    },

    /** Badge counts for 待我决定: what waits for this person's decision. */
    async counts(ctx: ActorContext) {
      const count = async (
        resource: string,
        collection: string,
        status: string,
      ): Promise<number | null> => {
        try {
          const policies = await authorizeAction(ctx.authz, resource, 'view');
          const rows = (await database
            .repository(collection)
            .withPolicy(policyOf(policies, collection))
            .findMany({ filter: { status } })) as Record<string, unknown>[];
          return rows.length;
        } catch (error) {
          if (error instanceof HrError && error.status === 403) return null;
          throw error;
        }
      };
      return {
        suggestions: await count(SUGGESTION, 'competencySuggestions', 'draft'),
        recommendations: await count(
          RECOMMENDATION,
          'trainingRecommendations',
          'draft',
        ),
        learningPlans: await count(
          'talent.learningPlan',
          'learningPlans',
          'draft',
        ),
      };
    },
  };
  return service;
}

export type DecisionService = ReturnType<typeof createDecisionService>;
