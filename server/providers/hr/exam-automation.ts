/**
 * V3-10 proactive work around exams and certificates:
 *
 * - 考官 `examiner.gradingSuggestion`: when an attempt with short answers is
 *   submitted on an exam with AI grading, suggest a score for each short
 *   answer point by point. The suggestion never takes effect by itself: the
 *   attempt stays `grading` and the instructor submits the final score.
 * - 学习教练 `learningCoach.examFailedPlan`: after an ordinary (not renewal)
 *   attempt fails, draft a remedial learning plan through the learning plan
 *   service for the department head to approve, and send the candidate the
 *   loss analysis with self-study links (no approval needed).
 * - 认证管家 `certificationSteward.qualificationPrep`: when someone obtains
 *   a 任职资格认证 for a position that is their active development target,
 *   mark the target achieved and prepare the appointment material for the
 *   department head and HR, with a pre-filled promotion form. Nothing is
 *   started automatically: whether to appoint is a person's decision.
 *
 * As elsewhere, rules decide who qualifies; the AI writes the text. Messages
 * fall back to rule-based wording without a model; a suggested score is AI
 * content and the run fails without one.
 */
import type { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';

import { authorizeAction } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import type { LossByCompetency } from './exam-service.js';
import { json, type Platform } from './platform.js';
import { addDays, HrError, str } from './shared.js';
import { examServiceToken, planServiceToken } from './tokens.js';
import { createWorkItemStore } from './work-item-store.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;
type Worded = (
  run: AutomationRunContext,
  compose: () => Promise<string>,
  fallback: () => string,
) => Promise<string>;
type TaskResult = Promise<{
  status?: 'succeeded' | 'skipped';
  output?: Record<string, unknown>;
}>;

export interface ExamAutomationDeps {
  readonly container: ServiceContainer;
  readonly platform: Platform;
  readonly structured: Structured;
  readonly worded: Worded;
}

const EXAMINER = 'talent.examiner';
const LEARNING_COACH = 'talent.learningCoach';
const STEWARD = 'talent.certificationSteward';
/** The 1–2 competencies that lost the most points get a remedial plan. */
const WEAK_COMPETENCIES = 2;
const PLAN_ITEMS = 3;
const PLAN_DUE_DAYS = 14;

function iso(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}

export function createExamAutomation(deps: ExamAutomationDeps) {
  const { container, platform, structured, worded } = deps;
  const { database } = platform;
  const exams = () => container.resolve(examServiceToken);
  const plans = () => container.resolve(planServiceToken);

  async function titlesOf(
    table: 'competencies' | 'courses' | 'exams' | 'positions',
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    return new Map(
      (
        await database
          .query()
          .selectFrom(table)
          .select(['id', 'title'])
          .where('id', 'in', [...ids])
          .execute()
      ).map((r) => [str(r.id), str(r.title)]),
    );
  }

  // ---------- 考官 ----------

  async function gradingSuggestion(
    run: AutomationRunContext,
    attemptId: string,
  ): TaskResult {
    await authorizeAction(run.owner.authz, EXAMINER, 'use');
    const material = await exams().gradingMaterial(run.owner, attemptId);
    if (material.status !== 'grading')
      return { status: 'skipped', output: { reason: 'notGrading' } };
    const pending = material.items.filter((i) => !i.aiSuggestion);
    if (!pending.length)
      return { status: 'skipped', output: { reason: 'alreadySuggested' } };
    // The run record keeps only the attempt id, never the candidate's answers.
    run.summarize(
      `《${material.examTitle}》答卷 ${attemptId}：${pending.length} 道简答题`,
    );
    let suggested = 0;
    for (const item of pending) {
      const result = await structured(
        run,
        'examiner',
        `简答题建议分：${material.examTitle}`,
        [
          `请为一道简答题给出建议分（满分 ${item.score} 分）。`,
          '规则：逐条对照评分要点给分，每条命中的要点引用考生答案中的原话；没写到的要点不给分；建议分不超过满分，不因语言表达好坏加减分；答案中出现与参考答案或作业文件相反的内容（例如把“15 分钟”写成“30 分钟”），在理由中单独指出。',
          `题干：${item.stem}`,
          `参考答案：${item.referenceAnswer}`,
          `评分要点：${item.gradingPoints ?? '（未提供，按参考答案的要点）'}`,
          `考生答案：${item.response || '（未作答）'}`,
        ].join('\n'),
        z.object({
          score: z.number().min(0).max(item.score),
          matchedPoints: z.array(z.string().max(300)).max(20),
          missingPoints: z.array(z.string().max(300)).max(20),
          rationale: z.string().min(1).max(1500),
        }),
      );
      const saved = await exams().saveGradingSuggestion(run.owner, attemptId, {
        questionId: item.questionId,
        ...result,
      });
      if (saved.saved) suggested += 1;
    }
    return { output: { attemptId, suggested } };
  }

  // ---------- 学习教练 · 考后补学计划 ----------

  async function examFailedPlan(
    run: AutomationRunContext,
    attemptId: string,
  ): TaskResult {
    await authorizeAction(run.owner.authz, LEARNING_COACH, 'use');
    const attempt = await database
      .query()
      .selectFrom('examAttempts')
      .select(['id', 'employeeId', 'examId', 'status', 'lossByCompetency'])
      .where('id', '=', attemptId)
      .executeTakeFirst();
    if (!attempt || attempt.status !== 'failed')
      return { status: 'skipped', output: { reason: 'notFailed' } };
    const employee = await platform.employee(str(attempt.employeeId));
    if (!employee || employee.status === 'leave')
      return { status: 'skipped', output: { reason: 'noEmployee' } };
    const exam = await database
      .query()
      .selectFrom('exams')
      .select(['id', 'title'])
      .where('id', '=', str(attempt.examId))
      .executeTakeFirst();
    const loss = json<LossByCompetency[]>(attempt.lossByCompetency, [])
      .filter((l) => l.lost > 0)
      .sort((a, b) => b.lost - a.lost);
    const weak = loss.slice(0, WEAK_COMPETENCIES);
    const titles = await titlesOf(
      'competencies',
      loss.map((l) => l.competencyId),
    );
    const examTitle = exam ? str(exam.title) : '';
    run.summarize(`${employee.name}《${examTitle}》未通过`);
    // Courses for the weakest competencies first, then practice scenarios; never the failed exam itself.
    const content = weak.length
      ? await plans().searchContent({
          competencyIds: weak.map((w) => w.competencyId),
        })
      : [];
    const order = { course: 0, practice: 1, learningPath: 2, exam: 3 };
    const picked = content
      .filter((c) => !(c.type === 'exam' && c.id === str(attempt.examId)))
      .sort((a, b) => order[a.type] - order[b.type])
      .slice(0, PLAN_ITEMS);
    const weakText = weak
      .map(
        (w) =>
          `${titles.get(w.competencyId) ?? w.competencyId}（失 ${w.lost} / ${w.total} 分）`,
      )
      .join('、');
    // 1) The candidate gets the loss analysis and what to study on their own, at once.
    if (employee.userId)
      await platform.notify({
        key: `automation:examFailed:${attemptId}:candidate`,
        userIds: [employee.userId],
        message: 'examFailedSelfStudy',
        params: {
          title: examTitle,
          weak: weakText || '—',
          content: picked.length
            ? picked.map((c) => `《${c.title}》`).join('、')
            : '—',
        },
        path: `/talent/my-exams/attempts/${encodeURIComponent(attemptId)}`,
      });
    if (!picked.length)
      return { output: { weak: weakText, plan: null, reason: 'noContent' } };
    // 2) A plan draft for the department head (第九步的"待我确认"); the candidate never sees the draft.
    const competencyOf = (item: (typeof picked)[number]) =>
      weak.find((w) => item.competencyIds.includes(w.competencyId))
        ?.competencyId ?? null;
    const summary = await worded(
      run,
      async () =>
        (
          await structured(
            run,
            'learningCoach',
            '考后补学计划',
            `${employee.name}的《${examTitle}》未通过，失分最多的能力项：${weakText}。请用不超过 150 字写一段补学计划说明给部门负责人：为什么推荐这些内容（${picked.map((c) => `《${c.title}》`).join('、')}），预计多久能补上。只使用给出的数据。`,
            z.object({ summary: z.string().min(1).max(400) }),
          )
        ).summary,
      () =>
        `${employee.name}的《${examTitle}》未通过，失分集中在${weakText}。建议先学习${picked.map((c) => `《${c.title}》`).join('、')}，完成后再参加考试。`,
    );
    const dueDate = addDays(platform.currentDate(), PLAN_DUE_DAYS);
    try {
      const plan = await plans().createDraft(
        run.owner,
        {
          employeeId: employee.id,
          trigger: 'examFailed',
          triggerRef: {
            attemptId,
            examId: str(attempt.examId),
            competencyId: weak[0]?.competencyId ?? null,
          },
          summary,
          // Asks the plan service to merge into an existing draft instead of refusing (see the V3-10 report).
          mergeIntoDraft: true,
          items: picked.map((item) => ({
            type: item.type,
            refId: item.id,
            competencyId: competencyOf(item),
            reason: `补齐${titles.get(competencyOf(item) ?? '') ?? '失分能力项'}`,
            dueDate,
          })),
        },
        {
          source: 'ai',
          fallbackReviewerUserId: run.owner.userId,
          automated: true,
        },
      );
      await run.recordItems('learningPlan', [{ id: plan.id, hash: null }]);
      return { output: { weak: weakText, plan: plan.id, merged: false } };
    } catch (error) {
      // An open draft already exists for this person: the plan service does not merge yet.
      if (error instanceof HrError && error.code === 'PLAN_DRAFT_EXISTS')
        return {
          output: { weak: weakText, plan: null, reason: 'draftExists' },
        };
      throw error;
    }
  }

  // ---------- 认证管家 · 任职准备材料 ----------

  async function qualificationPrep(
    run: AutomationRunContext,
    certificateId: string,
  ): TaskResult {
    await authorizeAction(run.owner.authz, STEWARD, 'use');
    const certificate = await database
      .query()
      .selectFrom('employeeCertificates')
      .select([
        'id',
        'employeeId',
        'certificationId',
        'certificateNo',
        'status',
        'issuedAt',
        'expiresAt',
      ])
      .where('id', '=', certificateId)
      .executeTakeFirst();
    if (
      !certificate ||
      !['valid', 'expiring'].includes(str(certificate.status))
    )
      return { status: 'skipped', output: { reason: 'notHolding' } };
    const certification = await database
      .query()
      .selectFrom('certifications')
      .select(['id', 'title', 'qualifiesPositionId'])
      .where('id', '=', str(certificate.certificationId))
      .executeTakeFirst();
    const positionId = certification?.qualifiesPositionId
      ? str(certification.qualifiesPositionId)
      : null;
    if (!certification || !positionId)
      return { status: 'skipped', output: { reason: 'notQualification' } };
    const employee = await platform.employee(str(certificate.employeeId));
    if (!employee || employee.status === 'leave')
      return { status: 'skipped', output: { reason: 'noEmployee' } };
    // Only when the position is the employee's active development target (V3-08).
    const target = await database
      .query()
      .selectFrom('developmentTargets')
      .select(['id', 'createdAt'])
      .where('employeeId', '=', employee.id)
      .where('targetPositionId', '=', positionId)
      .where('status', '=', 'active')
      .executeTakeFirst();
    if (!target)
      return { status: 'skipped', output: { reason: 'noActiveTarget' } };
    const now = new Date();
    await database
      .query()
      .updateTable('developmentTargets')
      .set({ status: 'achieved', achievedAt: now, updatedAt: now })
      .where('id', '=', str(target.id))
      .where('status', '=', 'active')
      .execute();
    const since = new Date(iso(target.createdAt));
    const positionTitle =
      (await titlesOf('positions', [positionId])).get(positionId) ?? '';
    run.summarize(`${employee.name}具备${positionTitle}任职资格`);

    // 对标差距: the target position's confirmed requirements, the level then (when the target was set) and now.
    const requirements = await database
      .query()
      .selectFrom('positionRequirements')
      .select(['competencyId', 'requiredLevel'])
      .where('positionId', '=', positionId)
      .where('reviewStatus', '=', 'confirmed')
      .execute();
    const assessments = await database
      .query()
      .selectFrom('employeeCompetencies')
      .select(['competencyId', 'level', 'assessedAt'])
      .where('employeeId', '=', employee.id)
      .orderBy('assessedAt', 'asc')
      .execute();
    const competencyTitles = await titlesOf(
      'competencies',
      requirements.map((r) => str(r.competencyId)),
    );
    const levelAt = (competencyId: string, at: Date | null) => {
      let level = 0;
      for (const a of assessments)
        if (
          str(a.competencyId) === competencyId &&
          (!at || new Date(iso(a.assessedAt)) <= at)
        )
          level = Number(a.level);
      return level;
    };
    const gapItems = requirements.map((r) => {
      const required = Number(r.requiredLevel);
      const then = levelAt(str(r.competencyId), since);
      const current = levelAt(str(r.competencyId), null);
      return {
        competency:
          competencyTitles.get(str(r.competencyId)) ?? str(r.competencyId),
        required,
        then,
        now: current,
      };
    });
    const gapThen = gapItems.reduce(
      (sum, g) => sum + Math.max(0, g.required - g.then),
      0,
    );
    const gapNow = gapItems.reduce(
      (sum, g) => sum + Math.max(0, g.required - g.now),
      0,
    );
    // What the employee did since the target was set: courses, plans, exams and practice.
    // Dates are compared in code: a stored datetime and a bound Date do not compare reliably on SQLite.
    const after = (value: unknown) =>
      value != null && new Date(iso(value)) >= since;
    const courseRows = await database
      .query()
      .selectFrom('assignments')
      .select(['courseId', 'completedAt'])
      .where('employeeId', '=', employee.id)
      .where('status', '=', 'completed')
      .where('courseId', 'is not', null)
      .execute()
      .then((rows) => rows.filter((r) => after(r.completedAt)));
    const courseTitles = await titlesOf(
      'courses',
      courseRows.map((c) => str(c.courseId)),
    );
    const planRows = await database
      .query()
      .selectFrom('learningPlans')
      .select(['id', 'status', 'createdAt'])
      .where('employeeId', '=', employee.id)
      .where('status', '=', 'approved')
      .execute()
      .then((rows) => rows.filter((r) => after(r.createdAt)));
    const examRows = await database
      .query()
      .selectFrom('examAttempts')
      .select(['examId', 'score', 'status', 'submittedAt'])
      .where('employeeId', '=', employee.id)
      .where('status', 'in', ['passed', 'failed'])
      .execute()
      .then((rows) => rows.filter((r) => after(r.submittedAt)));
    const examTitles = await titlesOf(
      'exams',
      examRows.map((e) => str(e.examId)),
    );
    const practiceRows = await database
      .query()
      .selectFrom('practiceSessions')
      .select(['score', 'completedAt'])
      .where('employeeId', '=', employee.id)
      .where('status', '=', 'completed')
      .execute()
      .then((rows) => rows.filter((r) => after(r.completedAt)));
    const practiceScores = practiceRows
      .map((p) => (p.score == null ? null : Number(p.score)))
      .filter((v): v is number => v !== null);
    const dossier = {
      certificateId,
      employeeId: employee.id,
      employeeName: employee.name,
      positionId,
      positionTitle,
      certification: str(certification.title),
      certificateNo: str(certificate.certificateNo),
      targetId: str(target.id),
      targetSince: since.toISOString(),
      gap: { then: gapThen, now: gapNow, items: gapItems },
      courses: courseRows.map(
        (c) => courseTitles.get(str(c.courseId)) ?? str(c.courseId),
      ),
      plansApproved: planRows.length,
      exams: examRows.map((e) => ({
        title: examTitles.get(str(e.examId)) ?? str(e.examId),
        score: e.score == null ? null : Number(e.score),
        passed: e.status === 'passed',
      })),
      practice: {
        count: practiceScores.length,
        average: practiceScores.length
          ? Math.round(
              (practiceScores.reduce((s, v) => s + v, 0) /
                practiceScores.length) *
                10,
            ) / 10
          : null,
      },
      // Decisions the system never takes: a person decides and HR / payroll processes follow.
      confirm: ['appointment', 'trialPeriod', 'salaryByHr'],
      promotionLink: `/talent/actions/new?type=promote&employeeId=${encodeURIComponent(employee.id)}&toPositionId=${encodeURIComponent(positionId)}`,
    };
    const text = await worded(
      run,
      async () =>
        (
          await structured(
            run,
            'certificationSteward',
            '任职准备材料',
            `请根据以下数据写一段不超过 250 字的任职准备材料，给部门负责人和 HR：说明谁取得了哪个岗位的任职资格证书、对标差距从设定时到现在的变化、完成的课程与学习计划、考试成绩、陪练表现，并列出需要主管确认的事项（是否任职、试任期；薪资是否调整由 HR 与薪酬流程处理）。说明系统不会自动发起任何异动。只使用给出的数据：${JSON.stringify(dossier)}`,
            z.object({ text: z.string().min(1).max(800) }),
          )
        ).text,
      () =>
        [
          `${employee.name}已取得《${str(certification.title)}》（${str(certificate.certificateNo)}），具备${positionTitle}任职资格。`,
          `对标差距：设定目标时 ${gapThen}，现在 ${gapNow}。`,
          dossier.courses.length
            ? `完成课程：${dossier.courses.map((c) => `《${c}》`).join('、')}。`
            : '',
          dossier.exams.length
            ? `考试：${dossier.exams.map((e) => `《${e.title}》${e.score ?? '—'} 分`).join('、')}。`
            : '',
          dossier.practice.count
            ? `陪练 ${dossier.practice.count} 次，平均 ${dossier.practice.average} 分。`
            : '',
          '请确认是否任职及试任期安排；薪资是否调整由 HR 与薪酬流程处理。系统未自动发起任何异动。',
        ]
          .filter(Boolean)
          .join(''),
    );
    const head = await platform.headOf(employee);
    const recipients = [...new Set([head, run.owner.userId])].filter(
      (id): id is string => Boolean(id),
    );
    const link = `/talent/certifications/${encodeURIComponent(str(certification.id))}?dossier=${encodeURIComponent(certificateId)}`;
    await database.transaction(async (connection) => {
      const store = createWorkItemStore(connection);
      for (const recipientUserId of recipients)
        await store.put({
          recipientUserId,
          type: 'qualificationDossier',
          refType: 'employeeCertificate',
          refId: certificateId,
          title: `${employee.name}具备${positionTitle}任职资格`.slice(0, 255),
          summary: text.slice(0, 500),
          link,
          sourceKind: 'ai',
          aiEmployee: 'certificationSteward',
          dueAt: null,
        });
    });
    await platform.notify({
      key: `automation:qualification:${certificateId}`,
      userIds: recipients,
      message: 'qualificationDossierReady',
      params: { name: employee.name, position: positionTitle },
      path: link,
    });
    return { output: { ...dossier, text, recipients } };
  }

  return { gradingSuggestion, examFailedPlan, qualificationPrep };
}
