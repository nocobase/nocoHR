/**
 * The proactive work of the V2 step 5 AI employees:
 *
 * - learning coach: drafts a learning plan for each employee whose required
 *   competency has a gap nothing covers yet, for the department head to
 *   approve; nudges people whose course is falling behind, and tells their
 *   head when it keeps falling behind;
 * - practice coach: drafts a practice scenario when a published course has a
 *   competency no scenario covers; recommends a practice before an exam.
 *
 * As in V1, rules decide who qualifies and the AI writes the content. Plans
 * and nudges fall back to rule-based wording without a model (the run is
 * marked `fallback`); a scenario is AI content and fails without one.
 */
import type { ServiceContainer } from '@nocobase/service-provider';
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import { authorizeAction, policyOf } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import { draftHash } from './draft-snapshots.js';
import type { LearningContent, PlanItemType } from './plan-service.js';
import { bool, json, type Platform } from './platform.js';
import { addDays, daysBetween, newId, str } from './shared.js';
import { planServiceToken, practiceServiceToken } from './tokens.js';

const LEARNING_COACH = 'talent.learningCoach';
const PRACTICE_COACH = 'talent.practiceCoach';
const OPEN = ['notStarted', 'inProgress', 'overdue'] as const;
/** At most this many plans are drafted in one run. */
const PLANS_PER_RUN = 20;
/** A competency planned for within this many days (in any status) is not planned again. */
const PLAN_COOLDOWN_DAYS = 30;
const NUDGE_INTERVAL_DAYS = 3;
const ESCALATE_AFTER_NUDGES = 2;
const ESCALATE_WITHIN_DAYS = 3;
const PRACTICE_COOLDOWN_DAYS = 14;
const DOCUMENT_TEXT_LIMIT = 16_000;
/** Within this many days of starting a position, an onboarding path is the first suggestion. */
const NEW_TO_POSITION_DAYS = 90;

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

export interface TrainingAutomationDeps {
  readonly container: ServiceContainer;
  readonly platform: Platform;
  readonly structured: Structured;
  readonly worded: Worded;
}

function list(items: readonly string[], limit = 5): string {
  return `${items.slice(0, limit).join('、')}${items.length > limit ? ' 等' : ''}`;
}
function localDate(value: unknown, timeZone: string): string {
  const date = value instanceof Date ? value : new Date(str(value));
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
function dateOnly(value: unknown): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}

export function createTrainingAutomation(deps: TrainingAutomationDeps) {
  const { container, platform, structured, worded } = deps;
  const { database } = platform;
  const plans = () => container.resolve(planServiceToken);
  const practice = () => container.resolve(practiceServiceToken);

  /** The competencies each open assignment of an employee already works on. */
  async function coveredCompetencies(
    employeeId: string,
    index: Map<string, LearningContent>,
  ): Promise<Set<string>> {
    const rows = await database
      .query()
      .selectFrom('assignments')
      .select(['courseId', 'examId', 'practiceScenarioId', 'learningPathId'])
      .where('employeeId', '=', employeeId)
      .where('status', 'in', [...OPEN, 'locked'])
      .execute();
    const covered = new Set<string>();
    for (const row of rows) {
      const key = row.courseId
        ? `course:${str(row.courseId)}`
        : row.examId
          ? `exam:${str(row.examId)}`
          : row.practiceScenarioId
            ? `practice:${str(row.practiceScenarioId)}`
            : row.learningPathId
              ? `learningPath:${str(row.learningPathId)}`
              : '';
      for (const c of index.get(key)?.competencyIds ?? []) covered.add(c);
    }
    return covered;
  }

  // ---------- 学习教练：差距学习计划 ----------

  async function gapPlans(run: AutomationRunContext): TaskResult {
    const policies = await authorizeAction(
      run.owner.authz,
      LEARNING_COACH,
      'use',
    );
    const query = database.query();
    const people = (await database
      .repository('employees')
      .withPolicy(policyOf(policies, 'employees'))
      .findMany({ filter: (f) => f.string('status').ne('leave') })) as Record<
      string,
      unknown
    >[];
    const contents = await plans().searchContent({});
    const index = new Map(contents.map((c) => [`${c.type}:${c.id}`, c]));
    const today = platform.currentDate();
    // What each path contains, as `type:id` keys the plan items use.
    const pathContents = new Map<string, string[]>();
    for (const step of await query
      .selectFrom('learningPathSteps')
      .select([
        'pathId',
        'stepType',
        'courseId',
        'examId',
        'practiceScenarioId',
      ])
      .execute()) {
      const key =
        step.stepType === 'course'
          ? `course:${str(step.courseId)}`
          : step.stepType === 'exam'
            ? `exam:${str(step.examId)}`
            : `practice:${str(step.practiceScenarioId)}`;
      pathContents.set(str(step.pathId), [
        ...(pathContents.get(str(step.pathId)) ?? []),
        key,
      ]);
    }
    const cooldown = new Date(
      Date.now() - PLAN_COOLDOWN_DAYS * 24 * 60 * 60_000,
    );
    const drafted: {
      employee: string;
      planId: string;
      competencies: string[];
    }[] = [];
    const notes: string[] = [];
    for (const person of people) {
      if (drafted.length >= PLANS_PER_RUN) break;
      const employeeId = str(person.id);
      if (!person.positionId) continue;
      const pendingDraft = await query
        .selectFrom('learningPlans')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (pendingDraft) continue;
      const requirements = await query
        .selectFrom('positionRequirements')
        .innerJoin(
          'competencies',
          'competencies.id',
          'positionRequirements.competencyId',
        )
        .select([
          'positionRequirements.competencyId as competencyId',
          'positionRequirements.requiredLevel as requiredLevel',
          'competencies.title as title',
          'competencies.category as category',
        ])
        .where('positionRequirements.positionId', '=', str(person.positionId))
        .where('positionRequirements.reviewStatus', '=', 'confirmed')
        .where('positionRequirements.mandatory', '=', true)
        .execute();
      if (!requirements.length) continue;
      const assessments = await query
        .selectFrom('employeeCompetencies')
        .select(['competencyId', 'level', 'assessedAt'])
        .where('employeeId', '=', employeeId)
        .orderBy('assessedAt', 'desc')
        .execute();
      const latest = new Map<string, number>();
      for (const a of assessments)
        if (!latest.has(str(a.competencyId)))
          latest.set(str(a.competencyId), Number(a.level));
      const covered = await coveredCompetencies(employeeId, index);
      const recent = new Set<string>();
      for (const plan of await query
        .selectFrom('learningPlans')
        .select(['triggerRef', 'createdAt'])
        .where('employeeId', '=', employeeId)
        .where('createdAt', '>=', cooldown)
        .execute())
        for (const c of json<{ competencyIds?: string[] }>(plan.triggerRef, {})
          .competencyIds ?? [])
          recent.add(c);
      const gaps = requirements
        .map((r) => ({
          competencyId: str(r.competencyId),
          title: str(r.title),
          category: str(r.category),
          required: Number(r.requiredLevel),
          current: latest.get(str(r.competencyId)) ?? 0,
        }))
        .filter(
          (g) =>
            g.required > g.current &&
            !covered.has(g.competencyId) &&
            !recent.has(g.competencyId),
        );
      if (!gaps.length) continue;
      const qualification = new Set(
        gaps
          .filter((g) => g.category === 'qualification')
          .map((g) => g.competencyId),
      );
      // A qualification gap is closed by what its certification requires, not by a practice or a path.
      const candidates = contents.filter(
        (c) =>
          c.competencyIds.some((id) =>
            gaps.some((g) => g.competencyId === id),
          ) &&
          !(
            c.competencyIds.every(
              (id) =>
                qualification.has(id) ||
                !gaps.some((g) => g.competencyId === id),
            ) &&
            (c.type === 'practice' || c.type === 'learningPath')
          ),
      );
      if (!candidates.length) {
        notes.push(
          `${str(person.name)}：没有可指派的内容覆盖 ${list(gaps.map((g) => g.title))}`,
        );
        continue;
      }
      // Dates the coach's employee grant does not carry; read directly, they are not sensitive.
      const dates = await query
        .selectFrom('employees')
        .select(['positionSince', 'hireDate'])
        .where('id', '=', employeeId)
        .executeTakeFirst();
      const started = dates?.positionSince ?? dates?.hireDate;
      const since =
        started instanceof Date
          ? started.toISOString().slice(0, 10)
          : str(started ?? '').slice(0, 10);
      const newToPosition =
        /^\d{4}-\d{2}-\d{2}$/u.test(since) &&
        daysBetween(since, today) <= NEW_TO_POSITION_DAYS;
      type Draft = {
        summary: string;
        items: {
          type: PlanItemType;
          refId: string;
          competencyId: string;
          reason: string;
          dueInDays: number;
        }[];
      };
      const ruleBased = (): Draft => {
        const items: Draft['items'] = [];
        for (const gap of gaps) {
          // A path suits someone new to the position; others get the course that closes the gap.
          const order: PlanItemType[] = qualification.has(gap.competencyId)
            ? ['course', 'exam']
            : newToPosition
              ? ['learningPath', 'course', 'practice']
              : ['course', 'learningPath', 'practice'];
          for (const type of order) {
            const pick = candidates.find(
              (c) =>
                c.type === type &&
                c.competencyIds.includes(gap.competencyId) &&
                !items.some((i) => i.type === c.type && i.refId === c.id),
            );
            if (pick) {
              items.push({
                type,
                refId: pick.id,
                competencyId: gap.competencyId,
                reason: `岗位要求「${gap.title}」${gap.required} 级，当前 ${gap.current} 级`,
                dueInDays: 14,
              });
              break;
            }
          }
          // A practice as a supplement, never for a qualification gap.
          const practice = qualification.has(gap.competencyId)
            ? undefined
            : candidates.find(
                (c) =>
                  c.type === 'practice' &&
                  c.competencyIds.includes(gap.competencyId) &&
                  !items.some((i) => i.type === c.type && i.refId === c.id),
              );
          if (practice)
            items.push({
              type: 'practice',
              refId: practice.id,
              competencyId: gap.competencyId,
              reason: `学完后用陪练检验「${gap.title}」的掌握情况`,
              dueInDays: 21,
            });
          if (items.length >= 5) break;
        }
        items.splice(5);
        return {
          summary: `${str(person.name)}的${list(gaps.map((g) => `「${g.title}」`))}未达到岗位要求，建议按以下内容补齐。`,
          items,
        };
      };
      let draft: Draft;
      try {
        draft = await structured(
          run,
          'learningCoach',
          `学习计划：${str(person.name)}`,
          [
            `请为员工 ${str(person.name)} 起草一份学习计划，交其主管确认。`,
            '只根据下面的能力差距和可选内容给建议，不要猜测员工能力；每项写明对应能力项和理由；优先已发布的学习路径和课程，陪练作为补充；最多 5 项，总时长尽量不超过 8 小时。',
            '资质类差距（category = qualification）只推荐对应认证要求的课程和考试，不建议绕过或替代认证要求。',
            '选了学习路径，就不要再单独列出路径里已包含的课程、考试或陪练（见 contains）。上岗路径适合新入职或刚到岗的员工；在岗已久的员工优先推荐针对差距的单项课程。',
            'summary 和 reason 写给主管看：用能力项名称和内容标题，不要出现 id、英文代码或字段名。',
            newToPosition
              ? `员工到现岗位不满 ${NEW_TO_POSITION_DAYS} 天，属于新到岗，上岗路径合适。`
              : `员工在现岗位已超过 ${NEW_TO_POSITION_DAYS} 天，不是新到岗：不要推荐上岗路径，推荐针对差距的单项课程，陪练作为补充。`,
            `能力差距：${JSON.stringify(gaps)}`,
            `可选内容（只能从中选择，refId 用其 id）：${JSON.stringify(
              candidates.map((c) => ({
                type: c.type,
                id: c.id,
                title: c.title,
                minutes: c.estimatedMinutes,
                competencyIds: c.competencyIds,
                ...(c.type === 'learningPath'
                  ? { contains: pathContents.get(c.id) ?? [] }
                  : {}),
              })),
            )}`,
          ].join('\n'),
          z.object({
            summary: z.string().min(1),
            items: z
              .array(
                z.object({
                  type: z.enum(['course', 'learningPath', 'exam', 'practice']),
                  refId: z.string(),
                  competencyId: z.string(),
                  reason: z.string().min(1),
                  dueInDays: z.number(),
                }),
              )
              .min(1),
          }),
        );
        // Out-of-range values are brought into range here rather than failing the whole draft.
        draft.items = draft.items
          .filter((item) =>
            candidates.some((c) => c.type === item.type && c.id === item.refId),
          )
          .slice(0, 5)
          .map((item) => ({
            ...item,
            reason: item.reason.slice(0, 300),
            dueInDays: Math.min(
              60,
              Math.max(3, Math.round(item.dueInDays) || 14),
            ),
          }));
        draft.summary = draft.summary.slice(0, 1000);
        if (!draft.items.length) draft = ruleBased();
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
        draft = ruleBased();
      }
      // Content a chosen path already contains is not listed again.
      const inPaths = new Set(
        draft.items
          .filter((i) => i.type === 'learningPath')
          .flatMap((i) => pathContents.get(i.refId) ?? []),
      );
      draft.items = draft.items.filter(
        (i) =>
          i.type === 'learningPath' || !inPaths.has(`${i.type}:${i.refId}`),
      );
      if (!draft.items.length) continue;
      const plan = await plans().createDraft(
        run.owner,
        {
          employeeId,
          trigger: 'gap',
          triggerRef: {
            competencyIds: gaps.map((g) => g.competencyId),
            gaps: gaps.map((g) => ({
              competencyId: g.competencyId,
              required: g.required,
              current: g.current,
            })),
          },
          summary: draft.summary,
          items: draft.items.map((item) => ({
            type: item.type,
            refId: item.refId,
            competencyId: item.competencyId,
            reason: item.reason,
            dueDate: addDays(today, item.dueInDays),
          })),
        },
        { source: 'ai', fallbackReviewerUserId: run.owner.userId },
      );
      await run.recordItems('learningPlan', [
        {
          id: plan.id,
          hash: (await draftHash(database, 'learningPlan', plan.id)) ?? '',
        },
      ]);
      drafted.push({
        employee: str(person.name),
        planId: plan.id,
        competencies: gaps.map((g) => g.title),
      });
    }
    run.summarize(
      `起草学习计划 ${drafted.length} 份${notes.length ? `；${notes.join('；')}` : ''}`,
    );
    return drafted.length
      ? { output: { plans: drafted, notes } }
      : { status: 'skipped', output: { plans: [], notes } };
  }

  // ---------- 学习教练：进度提醒 ----------

  async function progressNudge(run: AutomationRunContext): TaskResult {
    const policies = await authorizeAction(
      run.owner.authz,
      LEARNING_COACH,
      'use',
    );
    const lagThreshold = Number(run.params.lagThreshold ?? 30) / 100;
    const minElapsed = Number(run.params.minElapsedPercent ?? 50) / 100;
    const query = database.query();
    const today = platform.currentDate();
    const visible = new Set(
      (
        (await database
          .repository('employees')
          .withPolicy(policyOf(policies, 'employees'))
          .findMany({})) as Record<string, unknown>[]
      ).map((e) => str(e.id)),
    );
    // Courses only: an exam or a practice has no partial progress to fall behind on.
    const rows = await query
      .selectFrom('assignments')
      .selectAll()
      .where('courseId', 'is not', null)
      .where('status', 'in', [...OPEN])
      .where('optional', '=', false)
      .where('dueDate', 'is not', null)
      .execute();
    const lagging = rows.filter((row) => {
      if (!visible.has(str(row.employeeId))) return false;
      const assigned = localDate(row.createdAt, platform.timeZone);
      const total = Math.max(daysBetween(assigned, dateOnly(row.dueDate)), 1);
      const elapsed = daysBetween(assigned, today) / total;
      return (
        elapsed >= minElapsed &&
        elapsed - (Number(row.progress) || 0) / 100 >= lagThreshold
      );
    });
    const nudged: string[] = [];
    for (const row of lagging) {
      const last = row.lastRemindedAt
        ? localDate(row.lastRemindedAt, platform.timeZone)
        : null;
      if (last && daysBetween(last, today) < NUDGE_INTERVAL_DAYS) continue;
      const employee = await platform.employee(str(row.employeeId));
      if (!employee?.userId) continue;
      const courseId = str(row.courseId);
      const course = await query
        .selectFrom('courses')
        .select(['title'])
        .where('id', '=', courseId)
        .executeTakeFirst();
      const lessons = await query
        .selectFrom('lessons')
        .select(['id', 'title', 'estimatedMinutes'])
        .where('courseId', '=', courseId)
        .orderBy('sortOrder', 'asc')
        .execute();
      const done = new Set(
        (
          await query
            .selectFrom('learningRecords')
            .select(['lessonId', 'completedAt'])
            .where('employeeId', '=', employee.id)
            .where('courseId', '=', courseId)
            .execute()
        )
          .filter((r) => r.completedAt)
          .map((r) => str(r.lessonId)),
      );
      const remaining = lessons.filter((l) => !done.has(str(l.id)));
      const minutes = remaining.reduce(
        (sum, l) => sum + (Number(l.estimatedMinutes) || 0),
        0,
      );
      const facts = {
        name: employee.name,
        course: str(course?.title ?? ''),
        remainingLessons: remaining.map((l) => str(l.title)),
        minutes,
        dueDate: dateOnly(row.dueDate),
      };
      const message = await worded(
        run,
        async () =>
          (
            await structured(
              run,
              'learningCoach',
              `学习提醒：${employee.name}`,
              `请给员工写一条学习提醒（不超过 120 字）：说清还差哪几节、大约多少分钟、截止日是哪天；语气友好，不施压。\n${JSON.stringify(facts)}`,
              z.object({ message: z.string().min(1).max(300) }),
            )
          ).message,
        () =>
          `《${facts.course}》还差 ${remaining.length} 节（${list(facts.remainingLessons, 3)}），大约 ${minutes} 分钟，截止 ${facts.dueDate}。抽空学完吧。`,
      );
      await platform.notify({
        key: `learningNudge:${str(row.id)}:${today}`,
        userIds: [employee.userId],
        message: 'learningNudge',
        params: { message, title: facts.course },
        path: `/talent/learning/${courseId}`,
      });
      await query
        .updateTable('assignments')
        .set({
          lastRemindedAt: new Date(),
          reminderCount: (Number(row.reminderCount) || 0) + 1,
          updatedAt: new Date(),
        })
        .where('id', '=', str(row.id))
        .execute();
      row.reminderCount = (Number(row.reminderCount) || 0) + 1;
      nudged.push(`${employee.name}《${facts.course}》`);
    }
    // Still behind after two nudges and close to the due date: the head hears once, one message per head.
    const byHead = new Map<string, { names: string[]; ids: string[] }>();
    for (const row of lagging) {
      if (row.escalatedAt) continue;
      if ((Number(row.reminderCount) || 0) < ESCALATE_AFTER_NUDGES) continue;
      if (daysBetween(today, dateOnly(row.dueDate)) > ESCALATE_WITHIN_DAYS)
        continue;
      const employee = await platform.employee(str(row.employeeId));
      if (!employee) continue;
      const head = await platform.headOf(employee);
      if (!head) continue;
      const course = await query
        .selectFrom('courses')
        .select(['title'])
        .where('id', '=', str(row.courseId))
        .executeTakeFirst();
      const entry = byHead.get(head) ?? { names: [], ids: [] };
      entry.names.push(
        `${employee.name}《${str(course?.title ?? '')}》进度 ${Number(row.progress) || 0}%，截止 ${dateOnly(row.dueDate)}`,
      );
      entry.ids.push(str(row.id));
      byHead.set(head, entry);
    }
    for (const [head, entry] of byHead) {
      await platform.notify({
        key: `learningLag:${head}:${today}`,
        userIds: [head],
        message: 'learningLagManager',
        params: {
          count: String(entry.ids.length),
          names: entry.names.join('；'),
        },
        path: '/talent/assignments',
      });
      await query
        .updateTable('assignments')
        .set({ escalatedAt: new Date(), updatedAt: new Date() })
        .where('id', 'in', entry.ids)
        .execute();
    }
    const escalated = [...byHead.values()].reduce(
      (sum, e) => sum + e.ids.length,
      0,
    );
    run.summarize(
      `落后任务 ${lagging.length} 条，提醒 ${nudged.length} 条，告知主管 ${escalated} 条`,
    );
    return nudged.length || escalated
      ? {
          output: {
            lagging: lagging.length,
            nudged,
            escalated,
            heads: byHead.size,
          },
        }
      : {
          status: 'skipped',
          output: { lagging: lagging.length, nudged: [], escalated: 0 },
        };
  }

  // ---------- 陪练教练：课程发布后起草场景 ----------

  async function draftScenarioOnPublish(
    run: AutomationRunContext,
    courseId: string,
  ): TaskResult {
    await authorizeAction(run.owner.authz, PRACTICE_COACH, 'use');
    const query = database.query();
    const course = await query
      .selectFrom('courses')
      .select(['id', 'title', 'sourceDocumentId', 'ownerUserId', 'published'])
      .where('id', '=', courseId)
      .executeTakeFirst();
    if (!course || !bool(course.published))
      return { status: 'skipped', output: { reason: 'courseNotPublished' } };
    if (!course.sourceDocumentId)
      return { status: 'skipped', output: { reason: 'noSourceDocument' } };
    const competencies = await query
      .selectFrom('courseCompetencies')
      .innerJoin(
        'competencies',
        'competencies.id',
        'courseCompetencies.competencyId',
      )
      .select(['competencies.id as id', 'competencies.title as title'])
      .where('courseCompetencies.courseId', '=', courseId)
      .execute();
    const covered = new Set(
      (
        await query
          .selectFrom('practiceScenarioCompetencies')
          .innerJoin(
            'practiceScenarios',
            'practiceScenarios.id',
            'practiceScenarioCompetencies.scenarioId',
          )
          .select(['practiceScenarioCompetencies.competencyId as competencyId'])
          .where('practiceScenarios.active', '=', true)
          .where('practiceScenarios.reviewStatus', 'in', ['draft', 'confirmed'])
          .execute()
      ).map((r) => str(r.competencyId)),
    );
    const uncovered = competencies.filter((c) => !covered.has(str(c.id)));
    if (!uncovered.length)
      return { status: 'skipped', output: { reason: 'covered' } };
    const document = await query
      .selectFrom('kbDocuments')
      .select(['id', 'title', 'contentText'])
      .where('id', '=', str(course.sourceDocumentId))
      .executeTakeFirst();
    if (!document)
      return { status: 'skipped', output: { reason: 'noSourceDocument' } };
    run.summarize(
      `课程《${str(course.title)}》发布；未覆盖的能力项：${list(uncovered.map((c) => str(c.title)))}`,
    );
    run.reference({
      courseId,
      documentId: str(document.id),
      competencies: uncovered.map((c) => str(c.id)),
    });
    const draft = await structured(
      run,
      'practiceCoach',
      `起草陪练场景：${str(course.title)}`,
      [
        `课程《${str(course.title)}》刚发布。请根据依据文档起草 1 个陪练场景，考察这些能力项：${JSON.stringify(uncovered.map((c) => ({ id: str(c.id), title: str(c.title) })))}。`,
        '评分要点来自文档中明确的要求（如时限、通知对象、记录方式），每条填 sourceExcerpt（逐字摘自文档的原文）和 competencyId；权重是整数，合计 100。',
        'persona 写 AI 扮演的角色与语气（如机加工车间班组长，说话直接，会追问细节；或整车厂审核员，礼貌但会追问依据）；situation 写给员工看的情境；openingLine 是 AI 的第一句话。',
        `依据文档《${str(document.title)}》：\n${str(document.contentText ?? '').slice(0, DOCUMENT_TEXT_LIMIT)}`,
      ].join('\n'),
      z.object({
        title: z.string().min(1).max(200),
        persona: z.string().min(1).max(1000),
        situation: z.string().min(1).max(1500),
        openingLine: z.string().min(1).max(500),
        rubric: z
          .array(
            z.object({
              point: z.string().min(1).max(300),
              weight: z.number().int().min(1).max(100),
              competencyId: z.string(),
              sourceExcerpt: z.string().min(1).max(1000),
            }),
          )
          .min(2)
          .max(6),
      }),
    );
    // Rescale weights that do not total 100 rather than failing the whole draft.
    const total = draft.rubric.reduce((sum, r) => sum + r.weight, 0);
    let rubric = draft.rubric.map((r) => ({
      ...r,
      weight: Math.max(1, Math.round((r.weight * 100) / total)),
    }));
    const drift = 100 - rubric.reduce((sum, r) => sum + r.weight, 0);
    rubric = rubric.map((r, i) =>
      i === 0 ? { ...r, weight: r.weight + drift } : r,
    );
    const known = new Set(competencies.map((c) => str(c.id)));
    const scenario = await practice().createScenarioDraft(
      run.owner,
      {
        ...draft,
        rubric: rubric.map((r) => ({
          ...r,
          competencyId: known.has(r.competencyId) ? r.competencyId : null,
        })),
        sourceDocumentId: str(document.id),
      },
      { ownerUserId: str(course.ownerUserId) },
    );
    await run.recordItems('practiceScenario', [
      {
        id: scenario.id,
        hash:
          (await draftHash(database, 'practiceScenario', scenario.id)) ?? '',
      },
    ]);
    await platform.notify({
      key: `automation:scenarioDrafted:${scenario.id}`,
      userIds: [str(course.ownerUserId)],
      message: 'automationScenarioDrafted',
      params: { course: str(course.title), title: scenario.title },
      path: `/talent/practice-scenarios?review=mine`,
    });
    return {
      output: {
        scenarioId: scenario.id,
        competencies: uncovered.map((c) => str(c.title)),
      },
    };
  }

  // ---------- 陪练教练：考前陪练推荐 ----------

  async function preExamRecommend(run: AutomationRunContext): TaskResult {
    await authorizeAction(run.owner.authz, PRACTICE_COACH, 'use');
    const query = database.query();
    const contents = await plans().searchContent({});
    const examCompetencies = new Map(
      contents
        .filter((c) => c.type === 'exam')
        .map((c) => [c.id, c.competencyIds]),
    );
    const exams = await query
      .selectFrom('assignments')
      .select(['id', 'employeeId', 'examId', 'dueDate'])
      .where('examId', 'is not', null)
      .where('status', 'in', [...OPEN])
      .where('optional', '=', false)
      .orderBy('dueDate', 'asc')
      .execute();
    const since = new Date(
      Date.now() - PRACTICE_COOLDOWN_DAYS * 24 * 60 * 60_000,
    );
    const recommended: string[] = [];
    const done = new Set<string>();
    for (const exam of exams) {
      const employeeId = str(exam.employeeId);
      // At most one recommendation per person per run.
      if (done.has(employeeId)) continue;
      const scenarios = await practice().scenariosForCompetencies(
        examCompetencies.get(str(exam.examId)) ?? [],
      );
      for (const scenario of scenarios) {
        const practiced = await query
          .selectFrom('practiceSessions')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('scenarioId', '=', scenario.id)
          .where('createdAt', '>=', since)
          .executeTakeFirst();
        if (practiced) continue;
        const open = await query
          .selectFrom('assignments')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('practiceScenarioId', '=', scenario.id)
          .where('status', 'in', [...OPEN, 'locked'])
          .executeTakeFirst();
        if (open) continue;
        const employee = await platform.employee(employeeId);
        if (!employee || employee.status === 'leave') break;
        const examRow = await query
          .selectFrom('exams')
          .select(['title'])
          .where('id', '=', str(exam.examId))
          .executeTakeFirst();
        const stamp = new Date();
        const id = newId();
        await query
          .insertInto('assignments')
          .values({
            id,
            employeeId,
            courseId: null,
            examId: null,
            certificateId: null,
            learningPathId: null,
            parentAssignmentId: null,
            pathStepId: null,
            practiceScenarioId: scenario.id,
            learningPlanId: null,
            optional: true,
            reminderCount: 0,
            assignedByUserId: null,
            dueDate: exam.dueDate
              ? dateOnly(exam.dueDate)
              : addDays(platform.currentDate(), 7),
            status: 'notStarted',
            progress: 0,
            source: 'coach',
            completedAt: null,
            cancelledAt: null,
            lastRemindedAt: null,
            escalatedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        if (employee.userId)
          await platform.notify({
            key: `practiceRecommended:${id}`,
            userIds: [employee.userId],
            message: 'practiceRecommended',
            params: { title: scenario.title, exam: str(examRow?.title ?? '') },
            path: '/talent/my-learning',
          });
        recommended.push(`${employee.name}：${scenario.title}`);
        done.add(employeeId);
        break;
      }
    }
    run.summarize(
      `有未完成考试任务的员工 ${new Set(exams.map((e) => str(e.employeeId))).size} 人，推荐陪练 ${recommended.length} 条`,
    );
    return recommended.length
      ? { output: { recommended } }
      : { status: 'skipped', output: { recommended: [] } };
  }

  return { gapPlans, progressNudge, draftScenarioOnPublish, preExamRecommend };
}
