/**
 * Courses, assignments and a learner's study.
 *
 * A course is written as a draft (by hand or by the content writer), confirmed,
 * then published. A published course cannot change: it is unpublished first,
 * and any edit returns it to draft for another confirmation. Assignments point
 * at one published course or, from step 3, one published exam. Progress is the
 * share of the course's lessons the learner has completed; the assignment
 * completes when every lesson is done.
 */
import type { DatabaseConnection, RepositoryRecord } from '@nocobase/db';

import {
  authorizeAction,
  policyOf,
  tryAuthorizeAction,
  type CollectionPolicies,
} from './authorize.js';
import { recordDraftOutcome } from './draft-snapshots.js';
import type { ActorContext } from './framework-service.js';
import type { KnowledgeService } from './knowledge-service.js';
import { bool, json, type EmployeeSummary, type Platform } from './platform.js';
import {
  addDays,
  HrError,
  isRecord,
  newId,
  optionalDate,
  requireString,
  str,
} from './shared.js';

const COURSE = 'talent.course';
const ASSIGNMENT = 'talent.assignment';
const LEARNING = 'talent.learning';
const HISTORY = 'talent.learningHistory';
const WRITER = 'talent.contentWriter';

export const OPEN_ASSIGNMENT_STATUSES = [
  'notStarted',
  'inProgress',
  'overdue',
] as const;
const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_LESSON_SECONDS = 4 * 60 * 60;
const DEFAULT_MIN_WATCH_PERCENT = 90;
/** A reported interval may cover at most the time since the previous report × this, plus an allowance. */
const VIDEO_SPEED_LIMIT = 1.5;
const VIDEO_REPORT_SLACK_SECONDS = 2;
/** The first report of a sitting has no previous one to measure from; it may cover this much. */
const VIDEO_FIRST_REPORT_SECONDS = 15;
/** A gap longer than this since the last report starts a new sitting. */
const VIDEO_SITTING_GAP_MS = 5 * 60 * 1000;

export interface LessonView {
  readonly id: string;
  readonly sortOrder: number;
  readonly title: string;
  readonly content: string;
  readonly sourceExcerpt: string | null;
  readonly estimatedMinutes: number | null;
  readonly contentType: 'markdown' | 'video';
  readonly videoFileId: string | null;
  readonly videoSeconds: number | null;
  /** The share of a video that must be watched before the lesson can be completed. */
  readonly minWatchPercent: number;
}

export interface CourseSummary {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly sourceDocumentId: string | null;
  readonly sourceDocumentTitle: string | null;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly source: string;
  readonly reviewStatus: string;
  readonly published: boolean;
  readonly active: boolean;
  readonly deliveryMode: 'online' | 'offline';
  /** draft | confirmed | published | inactive */
  readonly status: string;
  readonly competencies: readonly { id: string; title: string }[];
  readonly lessonCount: number;
  readonly estimatedMinutes: number;
  readonly learnerCount: number;
}

export interface CourseDetail extends CourseSummary {
  readonly lessons: readonly LessonView[];
  readonly can: {
    manage: boolean;
    confirm: boolean;
    publish: boolean;
    discard: boolean;
  };
}

export interface AssignmentView {
  readonly id: string;
  readonly employeeId: string;
  readonly employeeName: string;
  readonly departmentId: string;
  readonly courseId: string | null;
  readonly examId: string | null;
  readonly learningPathId: string | null;
  readonly practiceScenarioId: string | null;
  readonly parentAssignmentId: string | null;
  readonly pathStepId: string | null;
  readonly learningPlanId: string | null;
  readonly targetTitle: string;
  readonly kind: 'course' | 'exam' | 'path' | 'practice';
  /** online | offline, for a course. */
  readonly deliveryMode: 'online' | 'offline' | null;
  readonly status: string;
  readonly progress: number;
  readonly dueDate: string | null;
  readonly source: string;
  /** A recommendation: never overdue and left out of completion rates. */
  readonly optional: boolean;
  readonly assignedByName: string | null;
  readonly completedAt: string | null;
  readonly lastRemindedAt: string | null;
  readonly reminderCount: number;
  readonly createdAt: string | null;
}

export interface AssignmentPreview {
  readonly included: readonly {
    employeeId: string;
    name: string;
    departmentId: string;
  }[];
  readonly excluded: readonly {
    employeeId: string;
    name: string;
    reason: 'left' | 'outOfScope' | 'hasOpenAssignment';
  }[];
}

export interface LearnerCourse {
  readonly course: {
    id: string;
    title: string;
    description: string | null;
    deliveryMode: 'online' | 'offline';
  };
  readonly lessons: readonly (LessonView & {
    completed: boolean;
    /** For a video lesson: distinct seconds watched and the furthest position reached. */
    watchedSeconds: number;
    maxPositionSeconds: number;
  })[];
  readonly assignment: {
    id: string;
    status: string;
    progress: number;
    dueDate: string | null;
  } | null;
}

export interface LearningSummary {
  readonly completedCourses: readonly {
    courseId: string;
    title: string;
    completedAt: string;
  }[];
  readonly totalMinutes: number;
}

export interface LearningDailyReport {
  overdueAssignments: number;
  dueSoonReminders: number;
}

export interface LearningService {
  listCourses(
    ctx: ActorContext,
    /** `review: 'mine'` lists the drafts waiting for the caller's review ("待我审核"). */
    filters: { q?: string; status?: string; review?: string },
  ): Promise<{ items: CourseSummary[]; canCreate: boolean }>;
  getCourse(ctx: ActorContext, id: string): Promise<CourseDetail | undefined>;
  saveCourse(
    ctx: ActorContext,
    id: string | null,
    input: unknown,
  ): Promise<CourseDetail>;
  /** Called by the content writer: an AI draft with lessons that each cite the source document. */
  createCourseDraft(
    ctx: ActorContext,
    input: unknown,
    /** An automation writes the draft for the document's owner rather than for itself. */
    options?: { ownerUserId?: string },
  ): Promise<{
    id: string;
    title: string;
    lessonCount: number;
    created: boolean;
  }>;
  confirmCourse(ctx: ActorContext, id: string): Promise<CourseDetail>;
  /** Deletes a draft that was never published; courses that were published are disabled instead. */
  discardCourse(ctx: ActorContext, id: string): Promise<void>;
  publishCourse(
    ctx: ActorContext,
    id: string,
    published: boolean,
  ): Promise<CourseDetail>;
  setCourseActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<CourseDetail>;
  /** Published courses and exams an assigner may pick. */
  assignableTargets(ctx: ActorContext): Promise<{
    courses: { id: string; title: string }[];
    exams: { id: string; title: string }[];
  }>;
  previewAssignments(
    ctx: ActorContext,
    input: unknown,
  ): Promise<AssignmentPreview>;
  createAssignments(
    ctx: ActorContext,
    input: unknown,
  ): Promise<{ created: number; preview: AssignmentPreview }>;
  listAssignments(
    ctx: ActorContext,
    filters: {
      courseId?: string;
      examId?: string;
      departmentId?: string;
      status?: string;
    },
  ): Promise<{
    items: AssignmentView[];
    summary: { total: number; completionRate: number; overdue: number };
    can: {
      create: boolean;
      remind: boolean;
      cancel: boolean;
      updateDue: boolean;
    };
  }>;
  remind(
    ctx: ActorContext,
    ids: readonly string[],
  ): Promise<{
    reminded: number;
    skipped: readonly { id: string; reason: string }[];
  }>;
  cancelAssignment(ctx: ActorContext, id: string): Promise<AssignmentView>;
  updateDueDate(
    ctx: ActorContext,
    id: string,
    dueDate: unknown,
  ): Promise<AssignmentView>;
  myAssignments(ctx: ActorContext): Promise<AssignmentView[]>;
  openCourse(ctx: ActorContext, courseId: string): Promise<LearnerCourse>;
  completeLesson(ctx: ActorContext, input: unknown): Promise<LearnerCourse>;
  /** Records a watched interval of a video lesson; the server bounds it by the time since the last report. */
  reportVideoProgress(
    ctx: ActorContext,
    input: unknown,
  ): Promise<{
    watchedSeconds: number;
    maxPositionSeconds: number;
    canComplete: boolean;
  }>;
  /** The video file of a lesson the caller may study or manage. */
  lessonVideo(
    ctx: ActorContext,
    lessonId: string,
  ): Promise<{ disk: string; key: string; mimeType: string; size: number }>;
  learningSummary(
    ctx: ActorContext,
    employeeId: string,
  ): Promise<LearningSummary>;
  /** Published courses tagged with each competency, for the gap table. */
  coursesForCompetencies(
    competencyIds: readonly string[],
  ): Promise<Record<string, { id: string; title: string }[]>>;
  /** Courses a learner may open that match a query or competencies, for the knowledge assistant. */
  recommendCourses(
    ctx: ActorContext,
    input: { query?: string; competencyIds?: readonly string[] },
  ): Promise<
    {
      id: string;
      title: string;
      description: string | null;
      path: string;
      href: string;
    }[]
  >;
  cancelOpenAssignments(
    connection: DatabaseConnection,
    employeeId: string,
  ): Promise<void>;
  /** Marks an employee's open exam assignment completed; step 3 calls it when the candidate passes. */
  completeExamAssignments(
    connection: DatabaseConnection,
    employeeId: string,
    examId: string,
  ): Promise<string[]>;
  runDaily(): Promise<LearningDailyReport>;
}

export interface LearningServiceDeps {
  readonly platform: Platform;
  readonly knowledge: KnowledgeService;
  /** Step 3 checks certification requirements when a course completes. */
  readonly onCourseCompleted?: () =>
    ((employeeId: string, courseId: string) => Promise<void>) | undefined;
  /** Called after a course is published; the content writer tops up its questions. */
  readonly onCoursePublished?: () => ((courseId: string) => void) | undefined;
  /** The public base path, such as `/main`, for links the assistant writes. */
  readonly basePath: () => string;
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}
function ids(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 64)
  )
    throw new HrError('INVALID_INPUT', 400);
  return [...new Set(value as string[])];
}

export function createLearningService(
  deps: LearningServiceDeps,
): LearningService {
  const { platform, knowledge } = deps;
  const { database, organization, notify } = platform;

  // ---------- Courses ----------

  async function courseRows(
    policies: CollectionPolicies,
    q?: string,
  ): Promise<Record<string, unknown>[]> {
    return await database
      .repository('courses')
      .withPolicy(policyOf(policies, 'courses'))
      .findMany({
        filter: (f) =>
          f.and(
            q ? [f.string('title').includes(q, { mode: 'insensitive' })] : [],
          ),
        sort: (s) => [s.field('updatedAt').desc()],
      });
  }

  async function toCourseSummaries(
    rows: readonly Record<string, unknown>[],
  ): Promise<CourseSummary[]> {
    if (!rows.length) return [];
    const courseIds = rows.map((row) => String(row.id));
    const query = database.query();
    const lessons = await query
      .selectFrom('lessons')
      .select(['courseId', 'estimatedMinutes'])
      .where('courseId', 'in', courseIds)
      .execute();
    const tags = await query
      .selectFrom('courseCompetencies')
      .select(['courseId', 'competencyId'])
      .where('courseId', 'in', courseIds)
      .execute();
    const competencyIds = [...new Set(tags.map((t) => String(t.competencyId)))];
    const competencyTitles = competencyIds.length
      ? new Map(
          (
            await query
              .selectFrom('competencies')
              .select(['id', 'title'])
              .where('id', 'in', competencyIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const learners = await query
      .selectFrom('assignments')
      .select(['courseId'])
      .where('courseId', 'in', courseIds)
      .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES])
      .execute();
    const documentIds = [
      ...new Set(
        rows
          .map((row) => row.sourceDocumentId)
          .filter(Boolean)
          .map(String),
      ),
    ];
    const documentTitles = documentIds.length
      ? new Map(
          (
            await query
              .selectFrom('kbDocuments')
              .select(['id', 'title'])
              .where('id', 'in', documentIds)
              .execute()
          ).map((r) => [String(r.id), String(r.title)]),
        )
      : new Map<string, string>();
    const result: CourseSummary[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const own = lessons.filter((l) => String(l.courseId) === id);
      const published = bool(row.published);
      const active = bool(row.active);
      result.push({
        id,
        title: String(row.title),
        description: row.description == null ? null : str(row.description),
        sourceDocumentId:
          row.sourceDocumentId == null ? null : str(row.sourceDocumentId),
        sourceDocumentTitle:
          row.sourceDocumentId == null
            ? null
            : (documentTitles.get(str(row.sourceDocumentId)) ?? null),
        ownerUserId: String(row.ownerUserId),
        ownerName: await platform.userName(String(row.ownerUserId)),
        source: String(row.source),
        reviewStatus: String(row.reviewStatus),
        published,
        active,
        deliveryMode: row.deliveryMode === 'offline' ? 'offline' : 'online',
        status: !active
          ? 'inactive'
          : published
            ? 'published'
            : String(row.reviewStatus),
        competencies: tags
          .filter((t) => String(t.courseId) === id)
          .map((t) => ({
            id: String(t.competencyId),
            title:
              competencyTitles.get(String(t.competencyId)) ??
              String(t.competencyId),
          })),
        lessonCount: own.length,
        estimatedMinutes: own.reduce(
          (sum, l) => sum + (Number(l.estimatedMinutes) || 0),
          0,
        ),
        learnerCount: learners.filter((l) => String(l.courseId) === id).length,
      });
    }
    return result;
  }

  async function lessonsOf(
    courseId: string,
    connection?: DatabaseConnection,
  ): Promise<LessonView[]> {
    const rows = await (connection ? connection.query : database.query())
      .selectFrom('lessons')
      .select([
        'id',
        'sortOrder',
        'title',
        'content',
        'sourceExcerpt',
        'estimatedMinutes',
        'contentType',
        'videoFileId',
        'videoSeconds',
        'minWatchPercent',
      ])
      .where('courseId', '=', courseId)
      .orderBy('sortOrder', 'asc')
      .execute();
    return rows.map((row) => ({
      id: String(row.id),
      sortOrder: Number(row.sortOrder),
      title: String(row.title),
      content: str(row.content ?? ''),
      sourceExcerpt: row.sourceExcerpt == null ? null : str(row.sourceExcerpt),
      estimatedMinutes:
        row.estimatedMinutes == null ? null : Number(row.estimatedMinutes),
      contentType: row.contentType === 'video' ? 'video' : 'markdown',
      videoFileId: row.videoFileId == null ? null : str(row.videoFileId),
      videoSeconds: row.videoSeconds == null ? null : Number(row.videoSeconds),
      minWatchPercent:
        row.minWatchPercent == null
          ? DEFAULT_MIN_WATCH_PERCENT
          : Number(row.minWatchPercent),
    }));
  }

  async function courseDetail(
    ctx: ActorContext,
    id: string,
  ): Promise<CourseDetail | undefined> {
    const policies = await authorizeAction(ctx.authz, COURSE, 'view');
    const row = (await database
      .repository('courses')
      .withPolicy(policyOf(policies, 'courses'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    const [summary] = await toCourseSummaries([row]);
    const manage = await tryAuthorizeAction(ctx.authz, COURSE, 'manage');
    const canManage = manage
      ? Boolean(
          await database
            .repository('courses')
            .withPolicy(policyOf(manage, 'courses'))
            .findOne({ filter: { id } }),
        )
      : false;
    return {
      ...summary,
      lessons: await lessonsOf(id),
      can: {
        manage: canManage,
        confirm: await platform.can(ctx, COURSE, 'confirm'),
        publish: await platform.can(ctx, COURSE, 'publish'),
        discard: await platform.can(ctx, COURSE, 'discard'),
      },
    };
  }

  interface LessonInput {
    id: string | null;
    title: string;
    content: string;
    sourceExcerpt: string | null;
    estimatedMinutes: number | null;
    contentType: 'markdown' | 'video';
    videoFileId: string | null;
    videoSeconds: number | null;
    minWatchPercent: number | null;
  }

  function parseLessons(
    value: unknown,
    requireExcerpt: boolean,
  ): LessonInput[] {
    if (!Array.isArray(value)) throw new HrError('COURSE_LESSONS_INVALID', 400);
    if (value.length > 30) throw new HrError('COURSE_LESSONS_INVALID', 400);
    return value.map((item) => {
      if (!isRecord(item)) throw new HrError('COURSE_LESSONS_INVALID', 400);
      const minutes =
        item.estimatedMinutes === undefined ||
        item.estimatedMinutes === null ||
        item.estimatedMinutes === ''
          ? null
          : Number(item.estimatedMinutes);
      if (
        minutes !== null &&
        (!Number.isInteger(minutes) || minutes < 0 || minutes > 600)
      )
        throw new HrError('COURSE_LESSONS_INVALID', 400);
      const contentType = item.contentType === 'video' ? 'video' : 'markdown';
      const excerpt = requireString(
        item.sourceExcerpt,
        'LESSON_SOURCE_REQUIRED',
        { optional: !requireExcerpt || contentType === 'video', max: 8000 },
      );
      const optionalInt = (value: unknown, min: number, max: number) => {
        if (value === undefined || value === null || value === '') return null;
        const n = Number(value);
        if (!Number.isInteger(n) || n < min || n > max)
          throw new HrError('COURSE_LESSONS_INVALID', 400);
        return n;
      };
      const videoFileId =
        contentType === 'video'
          ? requireString(item.videoFileId, 'LESSON_VIDEO_REQUIRED', {
              max: 64,
            })!
          : null;
      const videoSeconds =
        contentType === 'video'
          ? optionalInt(item.videoSeconds, 1, 6 * 3600)
          : null;
      if (contentType === 'video' && videoSeconds === null)
        throw new HrError('LESSON_VIDEO_SECONDS_REQUIRED', 400);
      return {
        id: requireString(item.id, 'COURSE_LESSONS_INVALID', {
          optional: true,
          max: 64,
        }),
        title: requireString(item.title, 'LESSON_TITLE_REQUIRED', {
          max: 200,
        })!,
        // A video lesson's text is the note under the video and may be empty.
        content:
          contentType === 'video'
            ? (requireString(item.content, 'LESSON_CONTENT_REQUIRED', {
                optional: true,
                max: 50_000,
              }) ?? '')
            : requireString(item.content, 'LESSON_CONTENT_REQUIRED', {
                max: 50_000,
              })!,
        sourceExcerpt: excerpt,
        estimatedMinutes:
          minutes ??
          (videoSeconds === null
            ? null
            : Math.max(1, Math.round(videoSeconds / 60))),
        contentType,
        videoFileId,
        videoSeconds,
        minWatchPercent:
          contentType === 'video'
            ? (optionalInt(item.minWatchPercent, 10, 100) ??
              DEFAULT_MIN_WATCH_PERCENT)
            : null,
      };
    });
  }

  async function assertCompetencies(
    competencyIds: readonly string[],
  ): Promise<void> {
    if (!competencyIds.length) return;
    const rows = await database
      .query()
      .selectFrom('competencies')
      .select(['id'])
      .where('id', 'in', [...competencyIds])
      .execute();
    if (rows.length !== competencyIds.length)
      throw new HrError('COMPETENCY_NOT_FOUND', 404);
  }

  async function writeCourseContent(
    connection: DatabaseConnection,
    policies: CollectionPolicies,
    courseId: string,
    competencyIds: readonly string[] | undefined,
    lessons: readonly LessonInput[] | undefined,
  ): Promise<void> {
    const stamp = new Date();
    if (competencyIds) {
      const repo = connection
        .repository('courseCompetencies')
        .withPolicy(policyOf(policies, 'courseCompetencies'));
      const existing = (await repo.findMany({
        filter: { courseId },
      })) as Record<string, unknown>[];
      const keep = new Set(competencyIds);
      for (const row of existing)
        if (!keep.has(String(row.competencyId)))
          await repo.deleteOne({ filter: { id: String(row.id) } });
      const present = new Set(existing.map((row) => String(row.competencyId)));
      for (const competencyId of competencyIds)
        if (!present.has(competencyId))
          await repo.createOne({
            values: {
              id: newId(),
              courseId,
              competencyId,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
    }
    if (lessons) {
      const repo = connection
        .repository('lessons')
        .withPolicy(policyOf(policies, 'lessons'));
      const existing = (await repo.findMany({
        filter: { courseId },
      })) as Record<string, unknown>[];
      const existingIds = new Set(existing.map((row) => String(row.id)));
      const kept = new Set(
        lessons
          .map((l) => l.id)
          .filter((id): id is string => Boolean(id && existingIds.has(id))),
      );
      for (const row of existing)
        if (!kept.has(String(row.id)))
          await repo.deleteOne({ filter: { id: String(row.id) } });
      let order = 0;
      for (const lesson of lessons) {
        const values = {
          sortOrder: order++,
          title: lesson.title,
          content: lesson.content,
          sourceExcerpt: lesson.sourceExcerpt,
          estimatedMinutes: lesson.estimatedMinutes,
          contentType: lesson.contentType,
          videoFileId: lesson.videoFileId,
          videoSeconds: lesson.videoSeconds,
          minWatchPercent: lesson.minWatchPercent,
          updatedAt: stamp,
        };
        if (lesson.id && kept.has(lesson.id))
          await repo.updateOne({ filter: { id: lesson.id }, values });
        else
          await repo.createOne({
            values: { id: newId(), courseId, ...values, createdAt: stamp },
          });
      }
    }
  }

  async function loadCourse(
    id: string,
    connection?: DatabaseConnection,
  ): Promise<Record<string, unknown> | undefined> {
    return await (connection ? connection.query : database.query())
      .selectFrom('courses')
      .select([
        'id',
        'title',
        'description',
        'sourceDocumentId',
        'ownerUserId',
        'source',
        'reviewStatus',
        'published',
        'active',
        'deliveryMode',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  // ---------- Assignments ----------

  interface AssignmentInput {
    courseId: string | null;
    examId: string | null;
    employeeIds: string[];
    departmentIds: string[];
    positionIds: string[];
    dueDate: string;
  }

  function parseAssignmentInput(input: unknown): AssignmentInput {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const courseId = requireString(input.courseId, 'INVALID_INPUT', {
      optional: true,
      max: 64,
    });
    const examId = requireString(input.examId, 'INVALID_INPUT', {
      optional: true,
      max: 64,
    });
    if (Boolean(courseId) === Boolean(examId))
      throw new HrError('ASSIGNMENT_TARGET_REQUIRED', 400);
    const dueDate = optionalDate(input.dueDate, 'ASSIGNMENT_DUE_INVALID');
    if (!dueDate) throw new HrError('ASSIGNMENT_DUE_REQUIRED', 400);
    if (dueDate < platform.currentDate())
      throw new HrError('ASSIGNMENT_DUE_INVALID', 400);
    const result = {
      courseId,
      examId,
      employeeIds: ids(input.employeeIds),
      departmentIds: ids(input.departmentIds),
      positionIds: ids(input.positionIds),
      dueDate,
    };
    if (
      !result.employeeIds.length &&
      !result.departmentIds.length &&
      !result.positionIds.length
    )
      throw new HrError('ASSIGNMENT_AUDIENCE_REQUIRED', 400);
    return result;
  }

  async function assertTarget(
    input: Pick<AssignmentInput, 'courseId' | 'examId'>,
  ): Promise<string> {
    if (input.courseId) {
      const course = await loadCourse(input.courseId);
      if (!course || !bool(course.published) || !bool(course.active))
        throw new HrError('COURSE_NOT_PUBLISHED', 409);
      return String(course.title);
    }
    const exam = await database
      .query()
      .selectFrom('exams')
      .select(['id', 'title', 'published', 'active'])
      .where('id', '=', input.examId!)
      .executeTakeFirst();
    if (!exam || !bool(exam.published) || !bool(exam.active))
      throw new HrError('EXAM_NOT_PUBLISHED', 409);
    return String(exam.title);
  }

  async function buildPreview(
    ctx: ActorContext,
    input: AssignmentInput,
  ): Promise<AssignmentPreview & { policies: CollectionPolicies }> {
    const policies = await authorizeAction(ctx.authz, ASSIGNMENT, 'create');
    await assertTarget(input);
    const query = database.query();
    const candidates = new Map<string, EmployeeSummary>();
    const add = (rows: readonly Record<string, unknown>[]) => {
      for (const row of rows)
        candidates.set(String(row.id), {
          id: String(row.id),
          name: String(row.name),
          userId: row.userId == null ? null : str(row.userId),
          departmentId: String(row.departmentId),
          positionId: String(row.positionId),
          status: String(row.status),
        });
    };
    const columns = [
      'id',
      'name',
      'userId',
      'departmentId',
      'positionId',
      'status',
    ] as const;
    if (input.employeeIds.length)
      add(
        await query
          .selectFrom('employees')
          .select([...columns])
          .where('id', 'in', input.employeeIds)
          .execute(),
      );
    if (input.departmentIds.length) {
      const departments = new Set<string>();
      for (const id of input.departmentIds)
        for (const d of await organization.descendantsOf(id))
          departments.add(d);
      if (departments.size)
        add(
          await query
            .selectFrom('employees')
            .select([...columns])
            .where('departmentId', 'in', [...departments])
            .execute(),
        );
    }
    if (input.positionIds.length)
      add(
        await query
          .selectFrom('employees')
          .select([...columns])
          .where('positionId', 'in', input.positionIds)
          .execute(),
      );
    const candidateIds = [...candidates.keys()];
    const inScope = new Set<string>();
    if (candidateIds.length) {
      const visible = await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({
          filter: (f) => f.or(candidateIds.map((id) => f.string('id').eq(id))),
        });
      for (const row of visible)
        inScope.add(String((row as Record<string, unknown>).id));
    }
    const open = candidateIds.length
      ? await query
          .selectFrom('assignments')
          .select(['employeeId'])
          .where('employeeId', 'in', candidateIds)
          .where(
            input.courseId ? 'courseId' : 'examId',
            '=',
            (input.courseId ?? input.examId)!,
          )
          .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES, 'locked'])
          .execute()
      : [];
    const hasOpen = new Set(open.map((row) => String(row.employeeId)));
    const included: AssignmentPreview['included'][number][] = [];
    const excluded: AssignmentPreview['excluded'][number][] = [];
    for (const employee of [...candidates.values()].sort((a, b) =>
      a.name.localeCompare(b.name, 'zh-CN'),
    )) {
      if (employee.status === 'leave')
        excluded.push({
          employeeId: employee.id,
          name: employee.name,
          reason: 'left',
        });
      else if (!inScope.has(employee.id))
        excluded.push({
          employeeId: employee.id,
          name: employee.name,
          reason: 'outOfScope',
        });
      else if (hasOpen.has(employee.id))
        excluded.push({
          employeeId: employee.id,
          name: employee.name,
          reason: 'hasOpenAssignment',
        });
      else
        included.push({
          employeeId: employee.id,
          name: employee.name,
          departmentId: employee.departmentId,
        });
    }
    return { included, excluded, policies };
  }

  async function titleOfTarget(row: {
    courseId: string | null;
    examId: string | null;
    learningPathId?: string | null;
    practiceScenarioId?: string | null;
  }): Promise<string> {
    const query = database.query();
    const pick = async (table: string, id: string) =>
      str(
        (
          await query
            .selectFrom(table)
            .select(['title'])
            .where('id', '=', id)
            .executeTakeFirst()
        )?.title ?? '',
      );
    if (row.courseId) return pick('courses', row.courseId);
    if (row.examId) return pick('exams', row.examId);
    if (row.learningPathId) return pick('learningPaths', row.learningPathId);
    if (row.practiceScenarioId)
      return pick('practiceScenarios', row.practiceScenarioId);
    return '';
  }

  const nullable = (value: unknown): string | null =>
    value === null || value === undefined ? null : str(value);

  async function toAssignmentViews(
    rows: readonly Record<string, unknown>[],
  ): Promise<AssignmentView[]> {
    if (!rows.length) return [];
    const employeeIds = [...new Set(rows.map((row) => String(row.employeeId)))];
    const employees = new Map(
      (
        await database
          .query()
          .selectFrom('employees')
          .select(['id', 'name', 'departmentId'])
          .where('id', 'in', employeeIds)
          .execute()
      ).map((r) => [
        String(r.id),
        { name: String(r.name), departmentId: String(r.departmentId) },
      ]),
    );
    const courseIds = [
      ...new Set(rows.map((row) => nullable(row.courseId)).filter(Boolean)),
    ] as string[];
    const modes = new Map(
      courseIds.length
        ? (
            await database
              .query()
              .selectFrom('courses')
              .select(['id', 'deliveryMode'])
              .where('id', 'in', courseIds)
              .execute()
          ).map((r) => [
            String(r.id),
            r.deliveryMode === 'offline' ? 'offline' : 'online',
          ])
        : [],
    );
    const titles = new Map<string, string>();
    const result: AssignmentView[] = [];
    for (const row of rows) {
      const target = {
        courseId: nullable(row.courseId),
        examId: nullable(row.examId),
        learningPathId: nullable(row.learningPathId),
        practiceScenarioId: nullable(row.practiceScenarioId),
      };
      const key = Object.values(target).join('|');
      if (!titles.has(key)) titles.set(key, await titleOfTarget(target));
      const employee = employees.get(String(row.employeeId));
      result.push({
        id: String(row.id),
        employeeId: String(row.employeeId),
        employeeName: employee?.name ?? '',
        departmentId: employee?.departmentId ?? '',
        ...target,
        parentAssignmentId: nullable(row.parentAssignmentId),
        pathStepId: nullable(row.pathStepId),
        learningPlanId: nullable(row.learningPlanId),
        targetTitle: titles.get(key) ?? '',
        kind: target.examId
          ? 'exam'
          : target.learningPathId
            ? 'path'
            : target.practiceScenarioId
              ? 'practice'
              : 'course',
        deliveryMode: target.courseId
          ? ((modes.get(target.courseId) as 'online' | 'offline' | undefined) ??
            'online')
          : null,
        status: String(row.status),
        progress: Number(row.progress) || 0,
        dueDate: dateOnly(row.dueDate),
        source: String(row.source),
        optional: bool(row.optional),
        assignedByName: await platform.userName(nullable(row.assignedByUserId)),
        completedAt: iso(row.completedAt),
        lastRemindedAt: iso(row.lastRemindedAt),
        reminderCount: Number(row.reminderCount) || 0,
        createdAt: iso(row.createdAt),
      });
    }
    return result;
  }

  async function loadAssignment(
    policies: CollectionPolicies,
    id: string,
  ): Promise<Record<string, unknown>> {
    const row = (await database
      .repository('assignments')
      .withPolicy(policyOf(policies, 'assignments'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('ASSIGNMENT_NOT_FOUND', 404);
    return row;
  }

  // ---------- Learner ----------

  async function ownEmployee(ctx: ActorContext): Promise<EmployeeSummary> {
    const employee = await platform.employeeOfUser(ctx.userId);
    if (!employee) throw new HrError('EMPLOYEE_NOT_LINKED', 404);
    return employee;
  }

  /** Lessons completed after `since` (a recertification counts only lessons done after it started). */
  async function completedLessonIds(
    employeeId: string,
    courseId: string,
    connection?: DatabaseConnection,
    since = 0,
  ): Promise<Set<string>> {
    const rows = await (connection ? connection.query : database.query())
      .selectFrom('learningRecords')
      .select(['lessonId', 'completedAt'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .execute();
    return new Set(
      rows
        .filter(
          (row) =>
            row.completedAt &&
            new Date(
              str(
                row.completedAt instanceof Date
                  ? row.completedAt.toISOString()
                  : row.completedAt,
              ),
            ).getTime() > since,
        )
        .map((row) => String(row.lessonId)),
    );
  }

  /** The moment an open recertification assignment for the course started, or 0. */
  async function recertificationSince(
    employeeId: string,
    courseId: string,
    connection?: DatabaseConnection,
  ): Promise<number> {
    const row = await (connection ? connection.query : database.query())
      .selectFrom('assignments')
      .select(['createdAt'])
      .where('employeeId', '=', employeeId)
      .where('courseId', '=', courseId)
      .where('source', '=', 'recertification')
      .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES])
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    return row
      ? new Date(
          String(
            row.createdAt instanceof Date
              ? row.createdAt.toISOString()
              : row.createdAt,
          ),
        ).getTime()
      : 0;
  }

  /** Whether a learner may open a course: it is published and active, and assigned to them or its source document is visible to them. */
  async function canOpen(
    ctx: ActorContext,
    employee: EmployeeSummary,
    course: Record<string, unknown>,
  ): Promise<boolean> {
    if (!bool(course.published) || !bool(course.active)) return false;
    const assigned = await database
      .query()
      .selectFrom('assignments')
      .select(['id'])
      .where('employeeId', '=', employee.id)
      .where('courseId', '=', String(course.id))
      .where('status', '!=', 'cancelled')
      .executeTakeFirst();
    if (assigned) return true;
    if (!course.sourceDocumentId) return true;
    return (await knowledge.visibleDocumentIds(ctx)).has(
      str(course.sourceDocumentId),
    );
  }

  async function learnerCourse(
    ctx: ActorContext,
    employee: EmployeeSummary,
    courseId: string,
  ): Promise<LearnerCourse> {
    const course = await loadCourse(courseId);
    if (!course || !(await canOpen(ctx, employee, course)))
      throw new HrError('COURSE_NOT_AVAILABLE', 404);
    const done = await completedLessonIds(
      employee.id,
      courseId,
      undefined,
      await recertificationSince(employee.id, courseId),
    );
    const assignment = await database
      .query()
      .selectFrom('assignments')
      .select(['id', 'status', 'progress', 'dueDate'])
      .where('employeeId', '=', employee.id)
      .where('courseId', '=', courseId)
      .where('status', '!=', 'cancelled')
      .orderBy('createdAt', 'desc')
      .executeTakeFirst();
    const watched = new Map(
      (
        await database
          .query()
          .selectFrom('learningRecords')
          .select(['lessonId', 'watchedSeconds', 'maxPositionSeconds'])
          .where('employeeId', '=', employee.id)
          .where('courseId', '=', courseId)
          .execute()
      ).map((r) => [
        String(r.lessonId),
        {
          watchedSeconds: Number(r.watchedSeconds) || 0,
          maxPositionSeconds: Number(r.maxPositionSeconds) || 0,
        },
      ]),
    );
    return {
      course: {
        id: courseId,
        title: String(course.title),
        description:
          course.description == null ? null : str(course.description),
        deliveryMode: course.deliveryMode === 'offline' ? 'offline' : 'online',
      },
      lessons: (await lessonsOf(courseId)).map((lesson) => ({
        ...lesson,
        completed: done.has(lesson.id),
        watchedSeconds: watched.get(lesson.id)?.watchedSeconds ?? 0,
        maxPositionSeconds: watched.get(lesson.id)?.maxPositionSeconds ?? 0,
      })),
      assignment: assignment
        ? {
            id: String(assignment.id),
            status: String(assignment.status),
            progress: Number(assignment.progress) || 0,
            dueDate: dateOnly(assignment.dueDate),
          }
        : null,
    };
  }

  function videoWatchedEnough(lesson: LessonView, watched: number): boolean {
    if (!lesson.videoSeconds) return true;
    return (watched / lesson.videoSeconds) * 100 >= lesson.minWatchPercent;
  }

  /** Merges [start, end] into sorted, disjoint intervals. */
  function mergeRanges(
    ranges: readonly (readonly [number, number])[],
  ): [number, number][] {
    const sorted = ranges
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const range of sorted) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push([range[0], range[1]]);
    }
    return merged;
  }

  const service: LearningService = {
    async listCourses(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'view');
      const q = filters.q?.trim();
      const rows = await courseRows(policies, q);
      let items = await toCourseSummaries(rows);
      if (filters.status)
        items = items.filter((c) => c.status === filters.status);
      if (filters.review === 'mine')
        items = items.filter(
          (c) => c.reviewStatus === 'draft' && c.ownerUserId === ctx.userId,
        );
      return { items, canCreate: await platform.can(ctx, COURSE, 'manage') };
    },

    getCourse: courseDetail,

    async saveCourse(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const title =
        input.title === undefined && id
          ? undefined
          : requireString(input.title, 'COURSE_TITLE_REQUIRED', { max: 200 })!;
      const description =
        input.description === undefined
          ? undefined
          : requireString(input.description, 'INVALID_INPUT', {
              optional: true,
              max: 4000,
            });
      const sourceDocumentId =
        input.sourceDocumentId === undefined
          ? undefined
          : requireString(input.sourceDocumentId, 'INVALID_INPUT', {
              optional: true,
              max: 64,
            });
      const competencyIds =
        input.competencyIds === undefined
          ? undefined
          : ids(input.competencyIds);
      const deliveryMode =
        input.deliveryMode === undefined
          ? undefined
          : input.deliveryMode === 'offline'
            ? 'offline'
            : input.deliveryMode === 'online'
              ? 'online'
              : (() => {
                  throw new HrError('INVALID_INPUT', 400);
                })();
      const existing = id ? await loadCourse(id) : undefined;
      const lessons =
        input.lessons === undefined
          ? undefined
          : parseLessons(input.lessons, existing?.source === 'ai');
      if (competencyIds) await assertCompetencies(competencyIds);
      if (
        sourceDocumentId &&
        !(await database
          .query()
          .selectFrom('kbDocuments')
          .select(['id'])
          .where('id', '=', sourceDocumentId)
          .executeTakeFirst())
      )
        throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const courseId = id ?? newId();
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('courses')
          .withPolicy(policyOf(policies, 'courses'));
        const stamp = new Date();
        if (id) {
          const current = (await repo.findOne({ filter: { id } })) as
            Record<string, unknown> | undefined;
          if (!current) throw new HrError('COURSE_NOT_FOUND', 404);
          if (bool(current.published))
            throw new HrError('COURSE_PUBLISHED_LOCKED', 409);
          const values: RepositoryRecord = {
            reviewStatus: 'draft',
            updatedAt: stamp,
          };
          if (title !== undefined) values.title = title;
          if (description !== undefined) values.description = description;
          if (sourceDocumentId !== undefined)
            values.sourceDocumentId = sourceDocumentId;
          if (deliveryMode !== undefined) values.deliveryMode = deliveryMode;
          await repo.updateOne({ filter: { id, published: false }, values });
        } else {
          await repo.createOne({
            values: {
              id: courseId,
              title,
              description: description ?? null,
              sourceDocumentId: sourceDocumentId ?? null,
              ownerUserId: ctx.userId,
              source: 'manual',
              reviewStatus: 'draft',
              published: false,
              publishedAt: null,
              active: true,
              deliveryMode: deliveryMode ?? 'online',
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        await writeCourseContent(
          connection,
          policies,
          courseId,
          competencyIds,
          lessons,
        );
      });
      return (await courseDetail(ctx, courseId))!;
    },

    async createCourseDraft(ctx, input, options = {}) {
      const ownerUserId = options.ownerUserId ?? ctx.userId;
      await authorizeAction(ctx.authz, WRITER, 'use');
      const policies = await authorizeAction(ctx.authz, COURSE, 'manage');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const documentId = requireString(input.documentId, 'DOCUMENT_NOT_FOUND', {
        max: 64,
      })!;
      // Reading the document through the caller's authorization proves it may be used.
      await knowledge.readDocument(ctx, documentId);
      const title = requireString(input.title, 'COURSE_TITLE_REQUIRED', {
        max: 200,
      })!;
      const description = requireString(input.description, 'INVALID_INPUT', {
        optional: true,
        max: 4000,
      });
      const competencyIds = ids(input.competencyIds);
      const lessons = parseLessons(input.lessons, true);
      if (lessons.length < 1) throw new HrError('COURSE_LESSONS_INVALID', 400);
      await assertCompetencies(competencyIds);
      // A retried call returns the draft it already wrote instead of creating a second one.
      const existing = await database
        .query()
        .selectFrom('courses')
        .select(['id'])
        .where('sourceDocumentId', '=', documentId)
        .where('title', '=', title)
        .where('ownerUserId', '=', ownerUserId)
        .where('source', '=', 'ai')
        .where('reviewStatus', '=', 'draft')
        .executeTakeFirst();
      if (existing) {
        const count = await database
          .query()
          .selectFrom('lessons')
          .select(['id'])
          .where('courseId', '=', String(existing.id))
          .execute();
        return {
          id: String(existing.id),
          title,
          lessonCount: count.length,
          created: false,
        };
      }
      const id = newId();
      await database.transaction(async (connection) => {
        const stamp = new Date();
        await connection
          .repository('courses')
          .withPolicy(policyOf(policies, 'courses'))
          .createOne({
            values: {
              id,
              title,
              description,
              sourceDocumentId: documentId,
              ownerUserId,
              source: 'ai',
              reviewStatus: 'draft',
              published: false,
              publishedAt: null,
              active: true,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        await writeCourseContent(
          connection,
          policies,
          id,
          competencyIds,
          lessons,
        );
      });
      return { id, title, lessonCount: lessons.length, created: true };
    },

    async confirmCourse(ctx, id) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'confirm');
      const view = await authorizeAction(ctx.authz, COURSE, 'view');
      const visible = await database
        .repository('courses')
        .withPolicy(policyOf(view, 'courses'))
        .findOne({ filter: { id } });
      if (!visible) throw new HrError('COURSE_NOT_FOUND', 404);
      const lessons = await lessonsOf(id);
      if (!lessons.length) throw new HrError('COURSE_HAS_NO_LESSONS', 409);
      await database
        .repository('courses')
        .withPolicy(policyOf(policies, 'courses'))
        .updateOne({
          filter: { id },
          values: { reviewStatus: 'confirmed', updatedAt: new Date() },
        });
      await recordDraftOutcome(database, 'course', id, 'confirmed', ctx.userId);
      return (await courseDetail(ctx, id))!;
    },

    async discardCourse(ctx, id) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'discard');
      const row = (await database
        .repository('courses')
        .withPolicy(policyOf(policies, 'courses'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('COURSE_NOT_FOUND', 404);
      if (
        row.reviewStatus !== 'draft' ||
        bool(row.published) ||
        row.publishedAt
      )
        throw new HrError('COURSE_NOT_DRAFT', 409);
      const used = await database
        .query()
        .selectFrom('assignments')
        .select(['id'])
        .where('courseId', '=', id)
        .executeTakeFirst();
      if (used) throw new HrError('COURSE_IN_USE', 409);
      await recordDraftOutcome(database, 'course', id, 'discarded', ctx.userId);
      await database.transaction(async (connection) => {
        for (const table of ['lessons', 'courseCompetencies'] as const)
          await connection
            .repository(table)
            .withPolicy(policyOf(policies, table))
            .deleteMany({ filter: { courseId: id } });
        await connection
          .repository('courses')
          .withPolicy(policyOf(policies, 'courses'))
          .deleteOne({ filter: { id } });
      });
    },

    async publishCourse(ctx, id, published) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'publish');
      const view = await authorizeAction(ctx.authz, COURSE, 'view');
      const row = (await database
        .repository('courses')
        .withPolicy(policyOf(view, 'courses'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('COURSE_NOT_FOUND', 404);
      if (published) {
        if (row.reviewStatus !== 'confirmed')
          throw new HrError('COURSE_NOT_CONFIRMED', 409);
        if (!bool(row.active)) throw new HrError('COURSE_INACTIVE', 409);
        // An offline course is completed by attending a session; its lessons are only handouts.
        if (row.deliveryMode !== 'offline' && !(await lessonsOf(id)).length)
          throw new HrError('COURSE_HAS_NO_LESSONS', 409);
      }
      await database
        .repository('courses')
        .withPolicy(policyOf(policies, 'courses'))
        .updateOne({
          filter: { id },
          values: {
            published,
            publishedAt: published ? new Date() : null,
            updatedAt: new Date(),
          },
        });
      if (published) deps.onCoursePublished?.()?.(id);
      return (await courseDetail(ctx, id))!;
    },

    async setCourseActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, COURSE, 'publish');
      const view = await authorizeAction(ctx.authz, COURSE, 'view');
      if (
        !(await database
          .repository('courses')
          .withPolicy(policyOf(view, 'courses'))
          .findOne({ filter: { id } }))
      )
        throw new HrError('COURSE_NOT_FOUND', 404);
      await database
        .repository('courses')
        .withPolicy(policyOf(policies, 'courses'))
        .updateOne({
          filter: { id },
          values: active
            ? { active, updatedAt: new Date() }
            : { active, published: false, updatedAt: new Date() },
        });
      return (await courseDetail(ctx, id))!;
    },

    async assignableTargets(ctx) {
      await authorizeAction(ctx.authz, ASSIGNMENT, 'create');
      const query = database.query();
      const courses = await query
        .selectFrom('courses')
        .select(['id', 'title', 'published', 'active'])
        .execute();
      const exams = await query
        .selectFrom('exams')
        .select(['id', 'title', 'published', 'active'])
        .execute();
      return {
        courses: courses
          .filter((c) => bool(c.published) && bool(c.active))
          .map((c) => ({ id: String(c.id), title: String(c.title) })),
        exams: exams
          .filter((e) => bool(e.published) && bool(e.active))
          .map((e) => ({ id: String(e.id), title: String(e.title) })),
      };
    },

    async previewAssignments(ctx, input) {
      const { included, excluded } = await buildPreview(
        ctx,
        parseAssignmentInput(input),
      );
      return { included, excluded };
    },

    async createAssignments(ctx, input) {
      const parsed = parseAssignmentInput(input);
      const { included, excluded, policies } = await buildPreview(ctx, parsed);
      const title = await assertTarget(parsed);
      const stamp = new Date();
      const createdIds: { id: string; employeeId: string }[] = [];
      await database.transaction(async (connection) => {
        const repo = connection
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'));
        for (const person of included) {
          const id = newId();
          await repo.createOne({
            values: {
              id,
              employeeId: person.employeeId,
              courseId: parsed.courseId,
              examId: parsed.examId,
              certificateId: null,
              assignedByUserId: ctx.userId,
              dueDate: parsed.dueDate,
              status: 'notStarted',
              progress: 0,
              source: 'manual',
              completedAt: null,
              cancelledAt: null,
              lastRemindedAt: null,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
          createdIds.push({ id, employeeId: person.employeeId });
        }
      });
      for (const { id, employeeId } of createdIds) {
        const employee = await platform.employee(employeeId);
        if (!employee?.userId) continue;
        await notify({
          key: `assignment:${id}:assigned`,
          userIds: [employee.userId],
          message: 'assignmentCreated',
          params: { title, date: parsed.dueDate },
          path: parsed.courseId
            ? `/talent/learning/${parsed.courseId}`
            : '/talent/my-exams',
        });
      }
      return { created: createdIds.length, preview: { included, excluded } };
    },

    async listAssignments(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, ASSIGNMENT, 'view');
      let departmentIds: string[] | undefined;
      if (filters.departmentId)
        departmentIds = [
          ...(await organization.descendantsOf(filters.departmentId)),
        ];
      const rows = (await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(filters.courseId
                ? [f.string('courseId').eq(filters.courseId)]
                : []),
              ...(filters.examId
                ? [f.string('examId').eq(filters.examId)]
                : []),
              ...(filters.status
                ? [f.string('status').eq(filters.status)]
                : []),
            ]),
          sort: (s) => [s.field('createdAt').desc()],
        })) as Record<string, unknown>[];
      let items = await toAssignmentViews(rows);
      if (departmentIds) {
        const set = new Set(departmentIds);
        items = items.filter((item) => set.has(item.departmentId));
      }
      const counted = items.filter((item) => item.status !== 'cancelled');
      const completed = counted.filter(
        (item) => item.status === 'completed',
      ).length;
      return {
        items,
        summary: {
          total: counted.length,
          completionRate: counted.length
            ? Math.round((completed / counted.length) * 1000) / 10
            : 0,
          overdue: counted.filter((item) => item.status === 'overdue').length,
        },
        can: {
          create: await platform.can(ctx, ASSIGNMENT, 'create'),
          remind: await platform.can(ctx, ASSIGNMENT, 'remind'),
          cancel: await platform.can(ctx, ASSIGNMENT, 'cancel'),
          updateDue: await platform.can(ctx, ASSIGNMENT, 'updateDue'),
        },
      };
    },

    async remind(ctx, assignmentIds) {
      const policies = await authorizeAction(ctx.authz, ASSIGNMENT, 'remind');
      if (!assignmentIds.length) throw new HrError('INVALID_INPUT', 400);
      const skipped: { id: string; reason: string }[] = [];
      let reminded = 0;
      for (const id of [...new Set(assignmentIds)].slice(0, 200)) {
        const row = (await database
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'))
          .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
        if (!row) {
          skipped.push({ id, reason: 'notFound' });
          continue;
        }
        if (
          !(OPEN_ASSIGNMENT_STATUSES as readonly string[]).includes(
            String(row.status),
          )
        ) {
          skipped.push({ id, reason: 'closed' });
          continue;
        }
        const last = row.lastRemindedAt
          ? new Date(
              str(
                row.lastRemindedAt instanceof Date
                  ? row.lastRemindedAt.toISOString()
                  : row.lastRemindedAt,
              ),
            ).getTime()
          : 0;
        if (Date.now() - last < REMIND_INTERVAL_MS) {
          skipped.push({ id, reason: 'recentlyReminded' });
          continue;
        }
        const stamp = new Date();
        await database
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'))
          .updateOne({
            filter: { id },
            values: { lastRemindedAt: stamp, updatedAt: stamp },
          });
        const employee = await platform.employee(String(row.employeeId));
        if (employee?.userId) {
          const title = await titleOfTarget({
            courseId: nullable(row.courseId),
            examId: nullable(row.examId),
            learningPathId: nullable(row.learningPathId),
            practiceScenarioId: nullable(row.practiceScenarioId),
          });
          await notify({
            key: `assignment:${id}:remind:${stamp.getTime()}`,
            userIds: [employee.userId],
            message: 'assignmentReminder',
            params: { title, date: dateOnly(row.dueDate) ?? '' },
            path: row.courseId
              ? `/talent/learning/${str(row.courseId)}`
              : '/talent/my-exams',
          });
        }
        reminded += 1;
      }
      if (
        assignmentIds.length === 1 &&
        skipped.length === 1 &&
        skipped[0].reason === 'recentlyReminded'
      )
        throw new HrError('ASSIGNMENT_RECENTLY_REMINDED', 409);
      return { reminded, skipped };
    },

    async cancelAssignment(ctx, id) {
      const policies = await authorizeAction(ctx.authz, ASSIGNMENT, 'cancel');
      const row = await loadAssignment(policies, id);
      if (
        !(OPEN_ASSIGNMENT_STATUSES as readonly string[]).includes(
          String(row.status),
        )
      )
        throw new HrError('ASSIGNMENT_CLOSED', 409);
      const stamp = new Date();
      await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .updateOne({
          filter: { id },
          values: { status: 'cancelled', cancelledAt: stamp, updatedAt: stamp },
        });
      // Cancelling a path cancels its unfinished steps with it.
      if (row.learningPathId)
        await database
          .query()
          .updateTable('assignments')
          .set({ status: 'cancelled', cancelledAt: stamp, updatedAt: stamp })
          .where('parentAssignmentId', '=', id)
          .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES, 'locked'])
          .execute();
      const [view] = await toAssignmentViews([
        await loadAssignment(policies, id),
      ]);
      return view;
    },

    async updateDueDate(ctx, id, dueDateInput) {
      const policies = await authorizeAction(
        ctx.authz,
        ASSIGNMENT,
        'updateDue',
      );
      const dueDate = optionalDate(dueDateInput, 'ASSIGNMENT_DUE_INVALID');
      if (!dueDate) throw new HrError('ASSIGNMENT_DUE_REQUIRED', 400);
      const row = await loadAssignment(policies, id);
      if (
        !(OPEN_ASSIGNMENT_STATUSES as readonly string[]).includes(
          String(row.status),
        )
      )
        throw new HrError('ASSIGNMENT_CLOSED', 409);
      let status = String(row.status);
      if (status === 'overdue' && dueDate >= platform.currentDate())
        status = Number(row.progress) > 0 ? 'inProgress' : 'notStarted';
      if (status !== 'overdue' && dueDate < platform.currentDate())
        status = 'overdue';
      await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .updateOne({
          filter: { id },
          values: { dueDate, status, updatedAt: new Date() },
        });
      const [view] = await toAssignmentViews([
        await loadAssignment(policies, id),
      ]);
      return view;
    },

    async myAssignments(ctx) {
      const policies = await authorizeAction(ctx.authz, LEARNING, 'study');
      await ownEmployee(ctx);
      const rows = (await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .findMany({
          filter: (f) => f.string('status').ne('cancelled'),
          sort: (s) => [s.field('dueDate').asc()],
        })) as Record<string, unknown>[];
      return toAssignmentViews(rows);
    },

    async openCourse(ctx, courseId) {
      await authorizeAction(ctx.authz, LEARNING, 'study');
      return learnerCourse(ctx, await ownEmployee(ctx), courseId);
    },

    async completeLesson(ctx, input) {
      const policies = await authorizeAction(ctx.authz, LEARNING, 'study');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const courseId = requireString(input.courseId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const lessonId = requireString(input.lessonId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const assignmentId = requireString(input.assignmentId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      });
      const seconds = Math.min(
        Math.max(Math.round(Number(input.durationSeconds) || 0), 0),
        MAX_LESSON_SECONDS,
      );
      const employee = await ownEmployee(ctx);
      if (assignmentId) {
        // Progress is only ever reported for one's own assignment.
        const own = await database
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'))
          .findOne({ filter: { id: assignmentId } });
        if (
          !own ||
          String((own as Record<string, unknown>).employeeId) !== employee.id
        )
          throw new HrError('FORBIDDEN', 403);
      }
      const course = await loadCourse(courseId);
      if (!course || !(await canOpen(ctx, employee, course)))
        throw new HrError('COURSE_NOT_AVAILABLE', 404);
      const lessons = await lessonsOf(courseId);
      const lesson = lessons.find((l) => l.id === lessonId);
      if (!lesson) throw new HrError('LESSON_NOT_FOUND', 404);
      if (lesson.contentType === 'video') {
        const record = await database
          .query()
          .selectFrom('learningRecords')
          .select(['watchedSeconds'])
          .where('employeeId', '=', employee.id)
          .where('lessonId', '=', lessonId)
          .executeTakeFirst();
        if (!videoWatchedEnough(lesson, Number(record?.watchedSeconds) || 0))
          throw new HrError('VIDEO_NOT_WATCHED', 409);
      }
      // An offline course completes when its session is attended; reading the handouts does not.
      const offline = course.deliveryMode === 'offline';
      let completedCourse = false;
      await database.transaction(async (connection) => {
        const records = connection
          .repository('learningRecords')
          .withPolicy(policyOf(policies, 'learningRecords'));
        const stamp = new Date();
        const since = await recertificationSince(
          employee.id,
          courseId,
          connection,
        );
        const existing = (await records.findOne({
          filter: { employeeId: employee.id, lessonId },
        })) as Record<string, unknown> | undefined;
        if (existing) {
          const previous = existing.completedAt
            ? new Date(
                str(
                  existing.completedAt instanceof Date
                    ? existing.completedAt.toISOString()
                    : existing.completedAt,
                ),
              ).getTime()
            : 0;
          await records.updateOne({
            filter: { id: String(existing.id) },
            values: {
              completedAt:
                previous > since
                  ? (existing.completedAt as Date | string)
                  : stamp,
              durationSeconds: Math.min(
                Number(existing.durationSeconds) + seconds,
                MAX_LESSON_SECONDS * 4,
              ),
              updatedAt: stamp,
            },
          });
        } else {
          await records.createOne({
            values: {
              id: newId(),
              employeeId: employee.id,
              courseId,
              lessonId,
              startedAt: new Date(stamp.getTime() - seconds * 1000),
              completedAt: stamp,
              durationSeconds: seconds,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        }
        const done = await completedLessonIds(
          employee.id,
          courseId,
          connection,
          since,
        );
        const progress = lessons.length
          ? Math.round(
              (lessons.filter((l) => done.has(l.id)).length / lessons.length) *
                100,
            )
          : 0;
        if (offline) return;
        const assignments = connection
          .repository('assignments')
          .withPolicy(policyOf(policies, 'assignments'));
        const open = (await assignments.findMany({
          filter: (f) =>
            f.and([
              f.string('courseId').eq(courseId),
              f.or(
                OPEN_ASSIGNMENT_STATUSES.map((status) =>
                  f.string('status').eq(status),
                ),
              ),
            ]),
        })) as Record<string, unknown>[];
        for (const assignment of open) {
          const complete = progress >= 100;
          const status = complete
            ? 'completed'
            : assignment.status === 'overdue'
              ? 'overdue'
              : 'inProgress';
          await assignments.updateOne({
            filter: { id: String(assignment.id) },
            values: {
              progress,
              status,
              completedAt: complete ? stamp : null,
              updatedAt: stamp,
            },
          });
        }
        completedCourse = progress >= 100;
      });
      if (completedCourse)
        await deps.onCourseCompleted?.()?.(employee.id, courseId);
      return learnerCourse(ctx, employee, courseId);
    },

    async reportVideoProgress(ctx, input) {
      const policies = await authorizeAction(ctx.authz, LEARNING, 'study');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const courseId = requireString(input.courseId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const lessonId = requireString(input.lessonId, 'INVALID_INPUT', {
        max: 64,
      })!;
      const from = Number(input.from);
      const to = Number(input.to);
      if (
        !Number.isFinite(from) ||
        !Number.isFinite(to) ||
        from < 0 ||
        to < from
      )
        throw new HrError('INVALID_INPUT', 400);
      const employee = await ownEmployee(ctx);
      const course = await loadCourse(courseId);
      if (!course || !(await canOpen(ctx, employee, course)))
        throw new HrError('COURSE_NOT_AVAILABLE', 404);
      const lesson = (await lessonsOf(courseId)).find((l) => l.id === lessonId);
      if (!lesson || lesson.contentType !== 'video' || !lesson.videoSeconds)
        throw new HrError('LESSON_NOT_FOUND', 404);
      const duration = lesson.videoSeconds;
      const records = database
        .repository('learningRecords')
        .withPolicy(policyOf(policies, 'learningRecords'));
      const existing = (await records.findOne({
        filter: { employeeId: employee.id, lessonId },
      })) as Record<string, unknown> | undefined;
      const now = new Date();
      const last = existing?.lastReportedAt
        ? new Date(
            existing.lastReportedAt instanceof Date
              ? existing.lastReportedAt.toISOString()
              : str(existing.lastReportedAt),
          ).getTime()
        : 0;
      // The server, not the player, decides how much of an interval counts: at most the time since the last
      // report at 1.5× speed plus an allowance. A forged long interval is cut to what could have been watched.
      const elapsed = now.getTime() - last;
      const allowance =
        !last || elapsed > VIDEO_SITTING_GAP_MS
          ? VIDEO_FIRST_REPORT_SECONDS
          : (elapsed / 1000) * VIDEO_SPEED_LIMIT + VIDEO_REPORT_SLACK_SECONDS;
      const start = Math.min(Math.max(from, 0), duration);
      const end = Math.min(to, duration, start + allowance);
      const ranges = mergeRanges([
        ...json<[number, number][]>(existing?.watchedRanges, []),
        ...(end > start ? [[start, end] as [number, number]] : []),
      ]);
      const watchedSeconds = Math.round(
        ranges.reduce((sum, [a, b]) => sum + (b - a), 0),
      );
      const maxPositionSeconds = Math.round(
        Math.max(Number(existing?.maxPositionSeconds) || 0, end),
      );
      const values = {
        watchedRanges: JSON.stringify(ranges),
        watchedSeconds,
        maxPositionSeconds,
        lastReportedAt: now,
        updatedAt: now,
      };
      if (existing)
        await records.updateOne({
          filter: { id: String(existing.id) },
          values,
        });
      else
        await records.createOne({
          values: {
            id: newId(),
            employeeId: employee.id,
            courseId,
            lessonId,
            startedAt: now,
            completedAt: null,
            durationSeconds: 0,
            createdAt: now,
            ...values,
          },
        });
      return {
        watchedSeconds,
        maxPositionSeconds,
        canComplete: videoWatchedEnough(lesson, watchedSeconds),
      };
    },

    async lessonVideo(ctx, lessonId) {
      const lesson = await database
        .query()
        .selectFrom('lessons')
        .select(['courseId', 'contentType', 'videoFileId'])
        .where('id', '=', lessonId)
        .executeTakeFirst();
      if (!lesson || lesson.contentType !== 'video' || !lesson.videoFileId)
        throw new HrError('LESSON_NOT_FOUND', 404);
      const courseId = str(lesson.courseId);
      // Instructors preview the courses they may view; learners the courses they may open.
      const viewer = await tryAuthorizeAction(ctx.authz, COURSE, 'view');
      let allowed = Boolean(
        viewer &&
        (await database
          .repository('courses')
          .withPolicy(policyOf(viewer, 'courses'))
          .findOne({ filter: { id: courseId } })),
      );
      if (
        !allowed &&
        (await tryAuthorizeAction(ctx.authz, LEARNING, 'study'))
      ) {
        const employee = await platform.employeeOfUser(ctx.userId);
        const course = await loadCourse(courseId);
        allowed = Boolean(
          employee && course && (await canOpen(ctx, employee, course)),
        );
      }
      if (!allowed) throw new HrError('LESSON_NOT_FOUND', 404);
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key', 'mimeType', 'size'])
        .where('id', '=', str(lesson.videoFileId))
        .executeTakeFirst();
      if (!file) throw new HrError('LESSON_NOT_FOUND', 404);
      return {
        disk: str(file.disk),
        key: str(file.key),
        mimeType: str(file.mimeType) || 'video/mp4',
        size: Number(file.size) || 0,
      };
    },

    async learningSummary(ctx, employeeId) {
      const policies = await authorizeAction(ctx.authz, HISTORY, 'view');
      const assignments = (await database
        .repository('assignments')
        .withPolicy(policyOf(policies, 'assignments'))
        .findMany({ filter: { employeeId, status: 'completed' } })) as Record<
        string,
        unknown
      >[];
      const records = (await database
        .repository('learningRecords')
        .withPolicy(policyOf(policies, 'learningRecords'))
        .findMany({ filter: { employeeId } })) as Record<string, unknown>[];
      const completed = new Map<string, string>();
      for (const row of assignments)
        if (row.courseId && row.completedAt)
          completed.set(str(row.courseId), iso(row.completedAt)!);
      // A course finished without an assignment counts once every lesson is done.
      const byCourse = new Map<string, Record<string, unknown>[]>();
      for (const row of records)
        byCourse.set(String(row.courseId), [
          ...(byCourse.get(String(row.courseId)) ?? []),
          row,
        ]);
      for (const [courseId, rows] of byCourse) {
        if (completed.has(courseId)) continue;
        const lessons = await lessonsOf(courseId);
        const done = new Set(
          rows.filter((r) => r.completedAt).map((r) => String(r.lessonId)),
        );
        if (lessons.length && lessons.every((l) => done.has(l.id))) {
          const last = rows
            .map((r) => iso(r.completedAt)!)
            .sort()
            .at(-1)!;
          completed.set(courseId, last);
        }
      }
      const titles = completed.size
        ? new Map(
            (
              await database
                .query()
                .selectFrom('courses')
                .select(['id', 'title'])
                .where('id', 'in', [...completed.keys()])
                .execute()
            ).map((r) => [String(r.id), String(r.title)]),
          )
        : new Map<string, string>();
      return {
        completedCourses: [...completed.entries()]
          .map(([courseId, completedAt]) => ({
            courseId,
            title: titles.get(courseId) ?? courseId,
            completedAt,
          }))
          .sort((a, b) => b.completedAt.localeCompare(a.completedAt)),
        totalMinutes: Math.round(
          records.reduce(
            (sum, r) => sum + (Number(r.durationSeconds) || 0),
            0,
          ) / 60,
        ),
      };
    },

    async coursesForCompetencies(competencyIds) {
      if (!competencyIds.length) return {};
      const query = database.query();
      const tags = await query
        .selectFrom('courseCompetencies')
        .select(['courseId', 'competencyId'])
        .where('competencyId', 'in', [...competencyIds])
        .execute();
      if (!tags.length) return {};
      const courses = await query
        .selectFrom('courses')
        .select(['id', 'title', 'published', 'active'])
        .where('id', 'in', [...new Set(tags.map((t) => String(t.courseId)))])
        .execute();
      const live = new Map(
        courses
          .filter((c) => bool(c.published) && bool(c.active))
          .map((c) => [String(c.id), String(c.title)]),
      );
      const result: Record<string, { id: string; title: string }[]> = {};
      for (const tag of tags) {
        const title = live.get(String(tag.courseId));
        if (!title) continue;
        (result[String(tag.competencyId)] ??= []).push({
          id: String(tag.courseId),
          title,
        });
      }
      return result;
    },

    async recommendCourses(ctx, input) {
      await authorizeAction(ctx.authz, 'talent.knowledgeAssistant', 'use');
      const employee = await platform.employeeOfUser(ctx.userId);
      const query = database.query();
      const courses = (
        await query
          .selectFrom('courses')
          .select([
            'id',
            'title',
            'description',
            'sourceDocumentId',
            'published',
            'active',
          ])
          .execute()
      ).filter((c) => bool(c.published) && bool(c.active)) as Record<
        string,
        unknown
      >[];
      const tags = courses.length
        ? await query
            .selectFrom('courseCompetencies')
            .select(['courseId', 'competencyId'])
            .where(
              'courseId',
              'in',
              courses.map((c) => String(c.id)),
            )
            .execute()
        : [];
      const wanted = new Set(input.competencyIds ?? []);
      const words = (input.query ?? '')
        .toLowerCase()
        .split(/[\s,，。？?]+/u)
        .filter((w) => w.length >= 2);
      const scored: { course: Record<string, unknown>; score: number }[] = [];
      for (const course of courses) {
        if (employee && !(await canOpen(ctx, employee, course))) continue;
        let score = 0;
        if (
          tags.some(
            (t) =>
              String(t.courseId) === String(course.id) &&
              wanted.has(String(t.competencyId)),
          )
        )
          score += 3;
        const haystack =
          `${String(course.title)} ${str(course.description ?? '')}`.toLowerCase();
        for (const word of words) {
          if (haystack.includes(word)) score += 2;
          else
            for (let i = 0; i + 1 < word.length; i += 1)
              if (haystack.includes(word.slice(i, i + 2))) score += 0.5;
        }
        if (score > 0 || (!words.length && !wanted.size))
          scored.push({ course, score });
      }
      return scored
        .sort((a, b) => b.score - a.score)
        .slice(0, 3)
        .map(({ course }) => ({
          id: String(course.id),
          title: String(course.title),
          description:
            course.description == null ? null : str(course.description),
          path: `/talent/learning/${String(course.id)}`,
          href: `${deps.basePath().replace(/\/+$/u, '')}/talent/learning/${String(course.id)}`,
        }));
    },

    async cancelOpenAssignments(connection, employeeId) {
      const stamp = new Date();
      await connection.query
        .updateTable('assignments')
        .set({ status: 'cancelled', cancelledAt: stamp, updatedAt: stamp })
        .where('employeeId', '=', employeeId)
        .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES, 'locked'])
        .execute();
    },

    async completeExamAssignments(connection, employeeId, examId) {
      const rows = await connection.query
        .selectFrom('assignments')
        .select(['id'])
        .where('employeeId', '=', employeeId)
        .where('examId', '=', examId)
        .where('status', 'in', [...OPEN_ASSIGNMENT_STATUSES])
        .execute();
      if (!rows.length) return [];
      const stamp = new Date();
      await connection.query
        .updateTable('assignments')
        .set({
          status: 'completed',
          progress: 100,
          completedAt: stamp,
          updatedAt: stamp,
        })
        .where(
          'id',
          'in',
          rows.map((r) => String(r.id)),
        )
        .execute();
      return rows.map((r) => String(r.id));
    },

    async runDaily() {
      const report: LearningDailyReport = {
        overdueAssignments: 0,
        dueSoonReminders: 0,
      };
      const today = platform.currentDate();
      const query = database.query();
      const overdue = await query
        .selectFrom('assignments')
        .select([
          'id',
          'employeeId',
          'courseId',
          'examId',
          'learningPathId',
          'practiceScenarioId',
          'dueDate',
        ])
        .where('status', 'in', ['notStarted', 'inProgress'])
        .where('optional', '=', false)
        .where('dueDate', '<', today)
        .execute();
      for (const row of overdue) {
        await query
          .updateTable('assignments')
          .set({ status: 'overdue', updatedAt: new Date() })
          .where('id', '=', String(row.id))
          .where('status', 'in', ['notStarted', 'inProgress'])
          .execute();
        report.overdueAssignments += 1;
        const employee = await platform.employee(String(row.employeeId));
        if (!employee) continue;
        const title = await titleOfTarget({
          courseId: nullable(row.courseId),
          examId: nullable(row.examId),
          learningPathId: nullable(row.learningPathId),
          practiceScenarioId: nullable(row.practiceScenarioId),
        });
        const head = await platform.headOf(employee);
        const recipients = [employee.userId, head].filter((id): id is string =>
          Boolean(id),
        );
        if (recipients.length)
          await platform.reminderOnce(
            `assignment:${String(row.id)}:overdue`,
            () =>
              notify({
                key: `assignment:${String(row.id)}:overdue`,
                userIds: recipients,
                message: 'assignmentOverdue',
                params: {
                  name: employee.name,
                  title,
                  date: dateOnly(row.dueDate) ?? '',
                },
                path: '/talent/assignments',
              }),
          );
      }
      const soon = await query
        .selectFrom('assignments')
        .select([
          'id',
          'employeeId',
          'courseId',
          'examId',
          'learningPathId',
          'practiceScenarioId',
          'dueDate',
        ])
        .where('status', 'in', ['notStarted', 'inProgress'])
        .where('optional', '=', false)
        .where('dueDate', '>=', today)
        .where('dueDate', '<=', addDays(today, 3))
        .execute();
      for (const row of soon) {
        const employee = await platform.employee(String(row.employeeId));
        if (!employee?.userId) continue;
        const title = await titleOfTarget({
          courseId: nullable(row.courseId),
          examId: nullable(row.examId),
          learningPathId: nullable(row.learningPathId),
          practiceScenarioId: nullable(row.practiceScenarioId),
        });
        // Once per task per day; the daily job may run again the same day.
        const sent = await platform.reminderOnce(
          `assignment:${String(row.id)}:dueSoon:${today}`,
          () =>
            notify({
              key: `assignment:${String(row.id)}:dueSoon:${today}`,
              userIds: [employee.userId!],
              message: 'assignmentDueSoon',
              params: { title, date: dateOnly(row.dueDate) ?? '' },
              path: row.courseId
                ? `/talent/learning/${str(row.courseId)}`
                : '/talent/my-exams',
            }),
        );
        // Not stamped as `lastRemindedAt`: that field paces people's and the learning coach's reminders, and a
        // generic due-soon notice must not hold back the coach's specific nudge about a lagging task.
        if (sent) report.dueSoonReminders += 1;
      }
      return report;
    },
  };

  return service;
}
