/**
 * Keeping content in step with document versions (V2 step 6).
 *
 * When a new version of a document is extracted, the content that quoted the
 * changed sections — lessons of courses written from the old version,
 * questions and practice scenarios citing it — gets revision suggestions, and
 * a change-brief course explains what changed. Rules decide what is affected
 * and who retrains; the content writer only words the suggestions and the
 * brief. Nothing changes until an instructor accepts: a question or scenario
 * at once, a course's lessons together when the instructor applies them and
 * republishes. A suggestion whose target was edited after it was written is
 * stale and cannot be accepted as it stands.
 */
import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import {
  addWorkingDays,
  touchesChange,
  type SectionChange,
} from './document-changes.js';
import { contentHash } from './draft-snapshots.js';
import type { ActorContext } from './framework-service.js';
import { bool, json, type Platform } from './platform.js';
import { HrError, isRecord, newId, requireString, str } from './shared.js';

const REVISION = 'talent.revision';
const OPEN_ASSIGNMENT = [
  'notStarted',
  'inProgress',
  'overdue',
  'locked',
] as const;
export const DEFAULT_REVISION_DUE_DAYS = 5;

export type RevisionTarget = 'lesson' | 'question' | 'practiceScenario';

/** What each target type's suggestion may change. */
const EDITABLE: Record<RevisionTarget, readonly string[]> = {
  lesson: ['title', 'content', 'sourceExcerpt'],
  question: [
    'stem',
    'options',
    'answer',
    'explanation',
    'sourceExcerpt',
    'gradingNotes',
  ],
  practiceScenario: ['title', 'persona', 'situation', 'openingLine', 'rubric'],
};

export interface RevisionView {
  readonly id: string;
  readonly documentId: string | null;
  readonly reason: string;
  readonly targetType: RevisionTarget;
  readonly targetId: string;
  readonly targetTitle: string;
  readonly courseId: string | null;
  readonly courseTitle: string | null;
  readonly sectionTitle: string | null;
  readonly current: Record<string, unknown>;
  readonly proposed: Record<string, unknown>;
  readonly accepted: Record<string, unknown> | null;
  readonly explanation: string;
  readonly status: string;
  /** The target changed since the suggestion was written. */
  readonly stale: boolean;
  readonly reviewedByName: string | null;
  readonly rejectReason: string | null;
  readonly createdAt: string;
  readonly can: { accept: boolean; reject: boolean };
}

export interface RevisionGroup {
  readonly document: {
    id: string;
    title: string;
    version: string | null;
    previousVersionId: string | null;
  } | null;
  readonly brief: { id: string; title: string; status: string } | null;
  readonly affectedEstimate: number | null;
  readonly revisions: readonly RevisionView[];
  /** Courses whose lesson suggestions are all decided and can be applied. */
  readonly courses: readonly {
    id: string;
    title: string;
    open: number;
    accepted: number;
    canApply: boolean;
  }[];
}

export interface AffectedContent {
  readonly lessons: readonly {
    id: string;
    courseId: string;
    courseTitle: string;
    title: string;
    content: string;
    sourceExcerpt: string | null;
    ownerUserId: string;
    sections: string[];
  }[];
  readonly questions: readonly {
    id: string;
    stem: string;
    options: unknown;
    answer: unknown;
    explanation: string | null;
    sourceExcerpt: string | null;
    gradingNotes: string | null;
    ownerUserId: string;
    sections: string[];
  }[];
  readonly scenarios: readonly {
    id: string;
    title: string;
    situation: string;
    openingLine: string;
    rubric: unknown;
    ownerUserId: string;
    sections: string[];
  }[];
}

export interface RevisionService {
  listRevisions(
    ctx: ActorContext,
    filters: { documentId?: string; status?: string },
  ): Promise<RevisionGroup[]>;
  accept(ctx: ActorContext, id: string, input: unknown): Promise<RevisionView>;
  reject(ctx: ActorContext, id: string, input: unknown): Promise<RevisionView>;
  /** Writes a course's accepted lesson changes, bumps its version, points it at the new document and republishes it. */
  applyCourse(
    ctx: ActorContext,
    courseId: string,
  ): Promise<{ courseId: string; version: number }>;
  /** The changes of a new version and the content that quotes what changed (rules only). */
  documentChanges(documentId: string): Promise<{
    document: {
      id: string;
      title: string;
      version: string | null;
      ownerUserId: string;
    };
    previous: { id: string; title: string; version: string | null } | null;
    changes: SectionChange[];
  }>;
  findAffected(documentId: string): Promise<AffectedContent>;
  /** Suggestions for targets without an open one; answers how many were created. */
  createRevisions(input: {
    documentId: string | null;
    reason: 'documentChanged' | 'lowQuality';
    items: readonly {
      targetType: RevisionTarget;
      targetId: string;
      sectionTitle?: string | null;
      proposed: Record<string, unknown>;
      explanation: string;
    }[];
  }): Promise<{ created: string[]; skipped: number }>;
  /** A draft change-brief course for a new version; refused when one exists. */
  createChangeBrief(input: {
    documentId: string;
    title: string;
    lessons: readonly {
      title: string;
      content: string;
      sectionTitle?: string | null;
    }[];
  }): Promise<{ courseId: string }>;
  /** The people a change brief goes to: those who finished a course from the old version, or hold a certificate requiring one. */
  affectedEmployees(documentId: string): Promise<string[]>;
  /** Assigns a just-published change brief to the affected people. */
  onBriefPublished(courseId: string): Promise<{ assigned: number }>;
  /** Confirmed questions answered at least `minAttempts` times with an abnormal correct rate or poor discrimination. */
  lowQualityQuestions(minAttempts?: number): Promise<
    {
      id: string;
      stem: string;
      type: string;
      options: unknown;
      answer: unknown;
      explanation: string | null;
      ownerUserId: string;
      attempts: number;
      correctRate: number;
      discrimination: number | null;
      distribution: Record<string, number>;
    }[]
  >;
}

export interface RevisionServiceDeps {
  readonly platform: Platform;
}

function iso(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(str(value)).toISOString();
}
const nullable = (value: unknown): string | null =>
  value === null || value === undefined ? null : str(value);

export function createRevisionService(
  deps: RevisionServiceDeps,
): RevisionService {
  const { platform } = deps;
  const { database, notify } = platform;

  async function snapshot(
    type: RevisionTarget,
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    const query = database.query();
    if (type === 'lesson') {
      const row = await query
        .selectFrom('lessons')
        .select(['title', 'content', 'sourceExcerpt'])
        .where('id', '=', id)
        .executeTakeFirst();
      return row
        ? {
            title: str(row.title),
            content: str(row.content ?? ''),
            sourceExcerpt: nullable(row.sourceExcerpt),
          }
        : undefined;
    }
    if (type === 'question') {
      const row = await query
        .selectFrom('questions')
        .select([
          'stem',
          'options',
          'answer',
          'explanation',
          'sourceExcerpt',
          'gradingNotes',
          'active',
        ])
        .where('id', '=', id)
        .executeTakeFirst();
      return row
        ? {
            stem: str(row.stem),
            options: json(row.options, []),
            answer: json(row.answer, null),
            explanation: nullable(row.explanation),
            sourceExcerpt: nullable(row.sourceExcerpt),
            gradingNotes: nullable(row.gradingNotes),
            active: bool(row.active),
          }
        : undefined;
    }
    const row = await query
      .selectFrom('practiceScenarios')
      .select([
        'title',
        'persona',
        'situation',
        'openingLine',
        'rubric',
        'active',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    return row
      ? {
          title: str(row.title),
          persona: str(row.persona),
          situation: str(row.situation),
          openingLine: str(row.openingLine),
          rubric: json(row.rubric, []),
          active: bool(row.active),
        }
      : undefined;
  }

  async function targetInfo(
    type: RevisionTarget,
    id: string,
  ): Promise<
    | {
        title: string;
        courseId: string | null;
        courseTitle: string | null;
        ownerUserId: string;
      }
    | undefined
  > {
    const query = database.query();
    if (type === 'lesson') {
      const row = await query
        .selectFrom('lessons')
        .innerJoin('courses', 'courses.id', 'lessons.courseId')
        .select([
          'lessons.title as title',
          'lessons.sortOrder as sortOrder',
          'courses.id as courseId',
          'courses.title as courseTitle',
          'courses.ownerUserId as ownerUserId',
        ])
        .where('lessons.id', '=', id)
        .executeTakeFirst();
      return row
        ? {
            title: `${str(row.courseTitle)} · 第 ${Number(row.sortOrder) + 1} 节 ${str(row.title)}`,
            courseId: str(row.courseId),
            courseTitle: str(row.courseTitle),
            ownerUserId: str(row.ownerUserId),
          }
        : undefined;
    }
    const table = type === 'question' ? 'questions' : 'practiceScenarios';
    const row = await query
      .selectFrom(table)
      .select([type === 'question' ? 'stem' : 'title', 'ownerUserId'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row
      ? {
          title: str(type === 'question' ? row.stem : row.title),
          courseId: null,
          courseTitle: null,
          ownerUserId: str(row.ownerUserId),
        }
      : undefined;
  }

  async function toView(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<RevisionView> {
    const type = str(row.targetType) as RevisionTarget;
    const current = json<Record<string, unknown>>(row.currentSnapshot, {});
    const live = await snapshot(type, str(row.targetId));
    const stale =
      row.status === 'stale' ||
      (row.status === 'open' &&
        (!live || contentHash(live) !== contentHash(current)));
    const info = await targetInfo(type, str(row.targetId));
    const open = row.status === 'open' && !stale;
    return {
      id: str(row.id),
      documentId: nullable(row.documentId),
      reason: str(row.reason),
      targetType: type,
      targetId: str(row.targetId),
      targetTitle: info?.title ?? str(row.targetId),
      courseId: nullable(row.courseId),
      courseTitle: info?.courseTitle ?? null,
      sectionTitle: nullable(row.sectionTitle),
      current,
      proposed: json<Record<string, unknown>>(row.proposed, {}),
      accepted: row.accepted
        ? json<Record<string, unknown>>(row.accepted, {})
        : null,
      explanation: str(row.explanation),
      status: stale && row.status === 'open' ? 'stale' : str(row.status),
      stale,
      reviewedByName: await platform.userName(nullable(row.reviewedBy)),
      rejectReason: nullable(row.rejectReason),
      createdAt: iso(row.createdAt),
      can: {
        accept: open && (await platform.can(ctx, REVISION, 'accept')),
        reject: open && (await platform.can(ctx, REVISION, 'reject')),
      },
    };
  }

  async function scopedRevision(
    ctx: ActorContext,
    action: string,
    id: string,
  ): Promise<Record<string, unknown>> {
    const policies = await authorizeAction(ctx.authz, REVISION, action);
    const row = (await database
      .repository('contentRevisions')
      .withPolicy(policyOf(policies, 'contentRevisions'))
      .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
    if (!row) throw new HrError('REVISION_NOT_FOUND', 404);
    return row;
  }

  /** Checks the proposal only touches the fields a target type allows. */
  function cleanProposal(
    type: RevisionTarget,
    proposed: unknown,
  ): Record<string, unknown> {
    if (!isRecord(proposed))
      throw new HrError('REVISION_PROPOSAL_INVALID', 400);
    if (proposed.action === 'deactivate') {
      if (type === 'lesson')
        throw new HrError('REVISION_PROPOSAL_INVALID', 400);
      return { action: 'deactivate' };
    }
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(proposed))
      if (EDITABLE[type].includes(key)) clean[key] = value;
    if (!Object.keys(clean).length)
      throw new HrError('REVISION_PROPOSAL_INVALID', 400);
    return clean;
  }

  /** Writes an accepted question or scenario change at once (a lesson waits for its course). */
  async function writeTarget(
    type: RevisionTarget,
    id: string,
    change: Record<string, unknown>,
    documentId: string | null,
  ): Promise<void> {
    const stamp = new Date();
    const query = database.query();
    if (type === 'question') {
      if (change.action === 'deactivate') {
        await query
          .updateTable('questions')
          .set({ active: false, updatedAt: stamp })
          .where('id', '=', id)
          .execute();
        return;
      }
      const values: Record<string, unknown> = { updatedAt: stamp };
      for (const key of [
        'stem',
        'explanation',
        'sourceExcerpt',
        'gradingNotes',
      ] as const)
        if (change[key] !== undefined)
          values[key] = change[key] === null ? null : str(change[key]);
      if (change.options !== undefined)
        values.options = JSON.stringify(change.options);
      if (change.answer !== undefined)
        values.answer = JSON.stringify(change.answer);
      // The question stays confirmed: the instructor accepted this exact change.
      if (documentId) values.sourceDocumentId = documentId;
      await query
        .updateTable('questions')
        .set(values)
        .where('id', '=', id)
        .execute();
      return;
    }
    if (type === 'practiceScenario') {
      if (change.action === 'deactivate') {
        await query
          .updateTable('practiceScenarios')
          .set({ active: false, updatedAt: stamp })
          .where('id', '=', id)
          .execute();
        return;
      }
      const values: Record<string, unknown> = { updatedAt: stamp };
      for (const key of [
        'title',
        'persona',
        'situation',
        'openingLine',
      ] as const)
        if (change[key] !== undefined) values[key] = str(change[key]);
      if (change.rubric !== undefined)
        values.rubric = JSON.stringify(change.rubric);
      if (documentId) values.sourceDocumentId = documentId;
      await query
        .updateTable('practiceScenarios')
        .set(values)
        .where('id', '=', id)
        .execute();
    }
  }

  const service: RevisionService = {
    async listRevisions(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, REVISION, 'view');
      let rows = (await database
        .repository('contentRevisions')
        .withPolicy(policyOf(policies, 'contentRevisions'))
        .findMany({ sort: (s) => [s.field('createdAt').asc()] })) as Record<
        string,
        unknown
      >[];
      if (filters.documentId)
        rows = rows.filter((r) => r.documentId === filters.documentId);
      if (filters.status)
        rows = rows.filter((r) => r.status === filters.status);
      const byDocument = new Map<string, Record<string, unknown>[]>();
      for (const row of rows) {
        const key = row.documentId ? str(row.documentId) : '';
        byDocument.set(key, [...(byDocument.get(key) ?? []), row]);
      }
      const canApply = await platform.can(ctx, REVISION, 'apply');
      const groups: RevisionGroup[] = [];
      for (const [documentId, list] of byDocument) {
        const views: RevisionView[] = [];
        for (const row of list) views.push(await toView(ctx, row));
        const document = documentId
          ? await database
              .query()
              .selectFrom('kbDocuments')
              .select(['id', 'title', 'version', 'previousVersionId'])
              .where('id', '=', documentId)
              .executeTakeFirst()
          : undefined;
        const brief = documentId
          ? await database
              .query()
              .selectFrom('courses')
              .select(['id', 'title', 'published', 'reviewStatus'])
              .where('briefForDocumentId', '=', documentId)
              .executeTakeFirst()
          : undefined;
        const courseIds = [
          ...new Set(views.filter((v) => v.courseId).map((v) => v.courseId!)),
        ];
        const courses = courseIds.map((courseId) => {
          const lessons = views.filter((v) => v.courseId === courseId);
          const open = lessons.filter(
            (v) => v.status === 'open' || v.status === 'stale',
          ).length;
          const accepted = lessons.filter(
            (v) => v.status === 'accepted',
          ).length;
          return {
            id: courseId,
            title: lessons[0]?.courseTitle ?? courseId,
            open,
            accepted,
            canApply: canApply && open === 0 && accepted > 0,
          };
        });
        groups.push({
          document: document
            ? {
                id: str(document.id),
                title: str(document.title),
                version: nullable(document.version),
                previousVersionId: nullable(document.previousVersionId),
              }
            : null,
          brief: brief
            ? {
                id: str(brief.id),
                title: str(brief.title),
                status: bool(brief.published)
                  ? 'published'
                  : str(brief.reviewStatus),
              }
            : null,
          affectedEstimate: documentId
            ? (await service.affectedEmployees(documentId)).length
            : null,
          revisions: views,
          courses,
        });
      }
      return groups;
    },

    async accept(ctx, id, input) {
      const row = await scopedRevision(ctx, 'accept', id);
      if (row.status !== 'open') throw new HrError('REVISION_NOT_OPEN', 409);
      const type = str(row.targetType) as RevisionTarget;
      const live = await snapshot(type, str(row.targetId));
      // Edited by someone after the suggestion was written: the suggestion no longer describes the target.
      if (
        !live ||
        contentHash(live) !== contentHash(json(row.currentSnapshot, {}))
      ) {
        await database
          .query()
          .updateTable('contentRevisions')
          .set({ status: 'stale', updatedAt: new Date() })
          .where('id', '=', id)
          .execute();
        throw new HrError('REVISION_STALE', 409);
      }
      const modified =
        isRecord(input) && isRecord(input.modified)
          ? cleanProposal(type, input.modified)
          : null;
      const change =
        modified ?? json<Record<string, unknown>>(row.proposed, {});
      const stamp = new Date();
      const lesson = type === 'lesson';
      if (!lesson)
        await writeTarget(
          type,
          str(row.targetId),
          change,
          nullable(row.documentId),
        );
      await database
        .query()
        .updateTable('contentRevisions')
        .set({
          status: lesson ? 'accepted' : 'applied',
          accepted: JSON.stringify(change),
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      return toView(ctx, await scopedRevision(ctx, 'view', id));
    },

    async reject(ctx, id, input) {
      const row = await scopedRevision(ctx, 'reject', id);
      if (row.status !== 'open' && row.status !== 'stale')
        throw new HrError('REVISION_NOT_OPEN', 409);
      const reason = requireString(
        isRecord(input) ? input.reason : undefined,
        'REVISION_REJECT_REASON_REQUIRED',
        {
          max: 1000,
        },
      )!;
      const stamp = new Date();
      await database
        .query()
        .updateTable('contentRevisions')
        .set({
          status: 'rejected',
          rejectReason: reason,
          reviewedBy: ctx.userId,
          reviewedAt: stamp,
          updatedAt: stamp,
        })
        .where('id', '=', id)
        .execute();
      return toView(ctx, await scopedRevision(ctx, 'view', id));
    },

    async applyCourse(ctx, courseId) {
      const policies = await authorizeAction(ctx.authz, REVISION, 'apply');
      const rows = (await database
        .repository('contentRevisions')
        .withPolicy(policyOf(policies, 'contentRevisions'))
        .findMany({ filter: { courseId } })) as Record<string, unknown>[];
      const pending = rows.filter(
        (r) => r.status === 'open' || r.status === 'stale',
      );
      if (pending.length)
        throw new HrError('REVISION_COURSE_OPEN', 409, {
          open: pending.length,
        });
      const accepted = rows.filter((r) => r.status === 'accepted');
      if (!accepted.length) throw new HrError('REVISION_NOTHING_TO_APPLY', 409);
      const course = await database
        .query()
        .selectFrom('courses')
        .select(['id', 'version'])
        .where('id', '=', courseId)
        .executeTakeFirst();
      if (!course) throw new HrError('COURSE_NOT_FOUND', 404);
      const documentId =
        accepted.map((r) => nullable(r.documentId)).find(Boolean) ?? null;
      const version = (Number(course.version) || 1) + 1;
      // One transaction: the lessons, the version, the source document and publication change together.
      await database.transaction(async (connection) => {
        const stamp = new Date();
        for (const row of accepted) {
          const change = json<Record<string, unknown>>(
            row.accepted ?? row.proposed,
            {},
          );
          const values: Record<string, unknown> = { updatedAt: stamp };
          for (const key of ['title', 'content', 'sourceExcerpt'] as const)
            if (change[key] !== undefined)
              values[key] = change[key] === null ? null : str(change[key]);
          await connection.query
            .updateTable('lessons')
            .set(values)
            .where('id', '=', str(row.targetId))
            .execute();
          await connection.query
            .updateTable('contentRevisions')
            .set({ status: 'applied', updatedAt: stamp })
            .where('id', '=', str(row.id))
            .execute();
        }
        await connection.query
          .updateTable('courses')
          .set({
            version,
            ...(documentId ? { sourceDocumentId: documentId } : {}),
            reviewStatus: 'confirmed',
            published: true,
            publishedAt: stamp,
            updatedAt: stamp,
          })
          .where('id', '=', courseId)
          .execute();
      });
      // Assignments in progress stay, and completed learning records are untouched.
      return { courseId, version };
    },

    async documentChanges(documentId) {
      const row = await database
        .query()
        .selectFrom('kbDocuments')
        .select([
          'id',
          'title',
          'version',
          'ownerUserId',
          'previousVersionId',
          'changeSummary',
        ])
        .where('id', '=', documentId)
        .executeTakeFirst();
      if (!row) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const previous = row.previousVersionId
        ? await database
            .query()
            .selectFrom('kbDocuments')
            .select(['id', 'title', 'version'])
            .where('id', '=', str(row.previousVersionId))
            .executeTakeFirst()
        : undefined;
      return {
        document: {
          id: str(row.id),
          title: str(row.title),
          version: nullable(row.version),
          ownerUserId: str(row.ownerUserId),
        },
        previous: previous
          ? {
              id: str(previous.id),
              title: str(previous.title),
              version: nullable(previous.version),
            }
          : null,
        changes: json<SectionChange[]>(row.changeSummary, []),
      };
    },

    async findAffected(documentId) {
      const { previous, changes } = await service.documentChanges(documentId);
      const touching = changes.filter((c) => c.changeType !== 'added');
      if (!previous || !touching.length)
        return { lessons: [], questions: [], scenarios: [] };
      const query = database.query();
      const sectionsOf = (text: string) =>
        touching
          .filter((change) => touchesChange(text, change))
          .map((c) => c.sectionTitle);
      const lessons = (
        await query
          .selectFrom('lessons')
          .innerJoin('courses', 'courses.id', 'lessons.courseId')
          .select([
            'lessons.id as id',
            'lessons.title as title',
            'lessons.content as content',
            'lessons.sourceExcerpt as sourceExcerpt',
            'courses.id as courseId',
            'courses.title as courseTitle',
            'courses.ownerUserId as ownerUserId',
          ])
          .where('courses.sourceDocumentId', '=', previous.id)
          .where('courses.active', '=', true)
          .where('courses.kind', '=', 'standard')
          .execute()
      )
        .map((l) => ({
          id: str(l.id),
          courseId: str(l.courseId),
          courseTitle: str(l.courseTitle),
          title: str(l.title),
          content: str(l.content ?? ''),
          sourceExcerpt: nullable(l.sourceExcerpt),
          ownerUserId: str(l.ownerUserId),
          sections: sectionsOf(
            `${str(l.content ?? '')}\n${str(l.sourceExcerpt ?? '')}`,
          ),
        }))
        .filter((l) => l.sections.length);
      const questions = (
        await query
          .selectFrom('questions')
          .select([
            'id',
            'stem',
            'options',
            'answer',
            'explanation',
            'sourceExcerpt',
            'gradingNotes',
            'ownerUserId',
          ])
          .where('sourceDocumentId', '=', previous.id)
          .where('reviewStatus', '=', 'confirmed')
          .where('active', '=', true)
          .execute()
      )
        .map((q) => ({
          id: str(q.id),
          stem: str(q.stem),
          options: json(q.options, []),
          answer: json(q.answer, null),
          explanation: nullable(q.explanation),
          sourceExcerpt: nullable(q.sourceExcerpt),
          gradingNotes: nullable(q.gradingNotes),
          ownerUserId: str(q.ownerUserId),
          sections: sectionsOf(
            `${str(q.sourceExcerpt ?? '')}\n${str(q.explanation ?? '')}`,
          ),
        }))
        .filter((q) => q.sections.length);
      const scenarios = (
        await query
          .selectFrom('practiceScenarios')
          .select([
            'id',
            'title',
            'situation',
            'openingLine',
            'rubric',
            'ownerUserId',
          ])
          .where('sourceDocumentId', '=', previous.id)
          .where('reviewStatus', '=', 'confirmed')
          .where('active', '=', true)
          .execute()
      )
        .map((sc) => {
          const rubric = json<{ sourceExcerpt?: string | null }[]>(
            sc.rubric,
            [],
          );
          return {
            id: str(sc.id),
            title: str(sc.title),
            situation: str(sc.situation),
            openingLine: str(sc.openingLine),
            rubric,
            ownerUserId: str(sc.ownerUserId),
            sections: sectionsOf(
              rubric.map((r) => r.sourceExcerpt ?? '').join('\n'),
            ),
          };
        })
        .filter((sc) => sc.sections.length);
      return { lessons, questions, scenarios };
    },

    async createRevisions(input) {
      const created: string[] = [];
      let skipped = 0;
      for (const item of input.items) {
        const open = await database
          .query()
          .selectFrom('contentRevisions')
          .select(['id'])
          .where('targetType', '=', item.targetType)
          .where('targetId', '=', item.targetId)
          .where('status', '=', 'open')
          .executeTakeFirst();
        const current = await snapshot(item.targetType, item.targetId);
        const info = await targetInfo(item.targetType, item.targetId);
        if (open || !current || !info) {
          skipped += 1;
          continue;
        }
        const id = newId();
        const stamp = new Date();
        await database
          .query()
          .insertInto('contentRevisions')
          .values({
            id,
            documentId: input.documentId,
            reason: input.reason,
            targetType: item.targetType,
            targetId: item.targetId,
            courseId: info.courseId,
            ownerUserId: info.ownerUserId,
            sectionTitle: item.sectionTitle ?? null,
            currentSnapshot: JSON.stringify(current),
            proposed: JSON.stringify(
              cleanProposal(item.targetType, item.proposed),
            ),
            accepted: null,
            explanation: item.explanation.slice(0, 4000),
            status: 'open',
            reviewedBy: null,
            reviewedAt: null,
            rejectReason: null,
            source: 'ai',
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        created.push(id);
      }
      return { created, skipped };
    },

    async createChangeBrief(input) {
      const { document, changes } = await service.documentChanges(
        input.documentId,
      );
      const existing = await database
        .query()
        .selectFrom('courses')
        .select(['id'])
        .where('briefForDocumentId', '=', input.documentId)
        .executeTakeFirst();
      if (existing)
        throw new HrError('COURSE_BRIEF_EXISTS', 409, {
          courseId: str(existing.id),
        });
      if (!changes.length) throw new HrError('DOCUMENT_NO_CHANGES', 409);
      if (!input.lessons.length)
        throw new HrError('COURSE_LESSONS_INVALID', 400);
      const titles = new Set(changes.map((c) => c.sectionTitle));
      const competencies = await database
        .query()
        .selectFrom('kbDocumentCompetencies')
        .select(['competencyId'])
        .where('documentId', '=', input.documentId)
        .execute();
      const courseId = newId();
      const stamp = new Date();
      await database.transaction(async (connection) => {
        await connection.query
          .insertInto('courses')
          .values({
            id: courseId,
            title: input.title.slice(0, 200),
            description: `${document.title}${document.version ? ` ${document.version}` : ''} 的变更要点`,
            sourceDocumentId: input.documentId,
            ownerUserId: document.ownerUserId,
            source: 'ai',
            reviewStatus: 'draft',
            published: false,
            publishedAt: null,
            active: true,
            deliveryMode: 'online',
            kind: 'changeBrief',
            version: 1,
            briefForDocumentId: input.documentId,
            revisionDueDays: DEFAULT_REVISION_DUE_DAYS,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        for (const row of competencies)
          await connection.query
            .insertInto('courseCompetencies')
            .values({
              id: newId(),
              courseId,
              competencyId: str(row.competencyId),
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
        let order = 0;
        for (const lesson of input.lessons) {
          const section =
            lesson.sectionTitle && titles.has(lesson.sectionTitle)
              ? lesson.sectionTitle
              : null;
          const change = section
            ? changes.find((c) => c.sectionTitle === section)
            : undefined;
          await connection.query
            .insertInto('lessons')
            .values({
              id: newId(),
              courseId,
              sortOrder: order,
              title: lesson.title.slice(0, 200),
              content: lesson.content.slice(0, 50_000),
              sourceExcerpt: change?.after ?? change?.before ?? null,
              estimatedMinutes: 4,
              contentType: 'markdown',
              videoFileId: null,
              videoSeconds: null,
              minWatchPercent: null,
              createdAt: stamp,
              updatedAt: stamp,
            })
            .execute();
          order += 1;
        }
      });
      return { courseId };
    },

    async affectedEmployees(documentId) {
      const { previous } = await service.documentChanges(documentId);
      if (!previous) return [];
      const query = database.query();
      const oldCourses = (
        await query
          .selectFrom('courses')
          .select(['id'])
          .where('sourceDocumentId', '=', previous.id)
          .execute()
      ).map((r) => str(r.id));
      // Courses already moved to the new version by an applied revision still count as "from the old version".
      const moved = (
        await query
          .selectFrom('contentRevisions')
          .select(['courseId'])
          .where('documentId', '=', documentId)
          .where('status', '=', 'applied')
          .where('courseId', 'is not', null)
          .execute()
      ).map((r) => str(r.courseId));
      const courseIds = [...new Set([...oldCourses, ...moved])];
      const people = new Set<string>();
      if (courseIds.length) {
        for (const row of await query
          .selectFrom('assignments')
          .select(['employeeId'])
          .where('courseId', 'in', courseIds)
          .where('status', '=', 'completed')
          .execute())
          people.add(str(row.employeeId));
        // Finished every lesson without an assignment.
        for (const courseId of courseIds) {
          const lessons = await query
            .selectFrom('lessons')
            .select(['id'])
            .where('courseId', '=', courseId)
            .execute();
          if (!lessons.length) continue;
          const records = await query
            .selectFrom('learningRecords')
            .select(['employeeId', 'lessonId', 'completedAt'])
            .where('courseId', '=', courseId)
            .execute();
          const done = new Map<string, Set<string>>();
          for (const r of records)
            if (r.completedAt)
              done.set(
                str(r.employeeId),
                (done.get(str(r.employeeId)) ?? new Set()).add(str(r.lessonId)),
              );
          for (const [employeeId, set] of done)
            if (lessons.every((l) => set.has(str(l.id))))
              people.add(employeeId);
        }
        // Holding a valid certificate whose certification requires one of those courses.
        for (const row of await query
          .selectFrom('employeeCertificates')
          .innerJoin(
            'certificationCourses',
            'certificationCourses.certificationId',
            'employeeCertificates.certificationId',
          )
          .select(['employeeCertificates.employeeId as employeeId'])
          .where('certificationCourses.courseId', 'in', courseIds)
          .where('employeeCertificates.status', 'in', ['valid', 'expiring'])
          .execute())
          people.add(str(row.employeeId));
      }
      if (!people.size) return [];
      const active = await query
        .selectFrom('employees')
        .select(['id'])
        .where('id', 'in', [...people])
        .where('status', '!=', 'leave')
        .execute();
      return active.map((r) => str(r.id)).sort();
    },

    async onBriefPublished(courseId) {
      const course = await database
        .query()
        .selectFrom('courses')
        .select([
          'id',
          'title',
          'kind',
          'briefForDocumentId',
          'revisionDueDays',
          'published',
        ])
        .where('id', '=', courseId)
        .executeTakeFirst();
      if (
        !course ||
        course.kind !== 'changeBrief' ||
        !course.briefForDocumentId ||
        !bool(course.published)
      )
        return { assigned: 0 };
      const people = await service.affectedEmployees(
        str(course.briefForDocumentId),
      );
      const due = addWorkingDays(
        platform.currentDate(),
        Number(course.revisionDueDays ?? DEFAULT_REVISION_DUE_DAYS) ||
          DEFAULT_REVISION_DUE_DAYS,
      );
      let assigned = 0;
      for (const employeeId of people) {
        const open = await database
          .query()
          .selectFrom('assignments')
          .select(['id'])
          .where('employeeId', '=', employeeId)
          .where('courseId', '=', courseId)
          .where('status', 'in', [...OPEN_ASSIGNMENT, 'completed'])
          .executeTakeFirst();
        if (open) continue;
        const stamp = new Date();
        const id = newId();
        await database
          .query()
          .insertInto('assignments')
          .values({
            id,
            employeeId,
            courseId,
            examId: null,
            certificateId: null,
            learningPathId: null,
            parentAssignmentId: null,
            pathStepId: null,
            practiceScenarioId: null,
            learningPlanId: null,
            optional: false,
            reminderCount: 0,
            assignedByUserId: null,
            dueDate: due,
            status: 'notStarted',
            progress: 0,
            source: 'revision',
            completedAt: null,
            cancelledAt: null,
            lastRemindedAt: null,
            escalatedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        assigned += 1;
        const employee = await platform.employee(employeeId);
        if (employee?.userId)
          await notify({
            key: `assignment:${id}:assigned`,
            userIds: [employee.userId],
            message: 'revisionAssigned',
            params: { title: str(course.title), date: due },
            path: `/talent/learning/${courseId}`,
          });
      }
      return { assigned };
    },

    async lowQualityQuestions(minAttempts = 20) {
      const attempts = await database
        .query()
        .selectFrom('examAttempts')
        .select(['id', 'score', 'answers', 'itemResults', 'paperSnapshot'])
        .where('status', 'in', ['passed', 'failed'])
        .execute();
      type Stat = {
        right: number;
        total: number;
        scores: { score: number; correct: boolean }[];
        distribution: Record<string, number>;
      };
      const stats = new Map<string, Stat>();
      for (const attempt of attempts) {
        const results = json<Record<string, { correct: boolean | null }>>(
          attempt.itemResults,
          {},
        );
        const answers = json<Record<string, unknown>>(attempt.answers, {});
        const score = Number(attempt.score) || 0;
        for (const [questionId, result] of Object.entries(results)) {
          if (result?.correct === null || result?.correct === undefined)
            continue;
          const entry = stats.get(questionId) ?? {
            right: 0,
            total: 0,
            scores: [],
            distribution: {},
          };
          entry.total += 1;
          if (result.correct) entry.right += 1;
          entry.scores.push({ score, correct: result.correct });
          const key = JSON.stringify(answers[questionId] ?? null);
          entry.distribution[key] = (entry.distribution[key] ?? 0) + 1;
          stats.set(questionId, entry);
        }
      }
      const flagged = [...stats.entries()].filter(
        ([, s]) => s.total >= minAttempts,
      );
      if (!flagged.length) return [];
      const rows = await database
        .query()
        .selectFrom('questions')
        .select([
          'id',
          'stem',
          'type',
          'options',
          'answer',
          'explanation',
          'ownerUserId',
          'reviewStatus',
          'active',
        ])
        .where(
          'id',
          'in',
          flagged.map(([id]) => id),
        )
        .execute();
      const result = [];
      for (const [id, s] of flagged) {
        const row = rows.find((r) => str(r.id) === id);
        if (!row || row.reviewStatus !== 'confirmed' || !bool(row.active))
          continue;
        const correctRate = s.right / s.total;
        // Discrimination: correct rate in the top 27% of attempt scores minus the bottom 27%.
        const sorted = [...s.scores].sort((a, b) => b.score - a.score);
        const n = Math.max(1, Math.round(sorted.length * 0.27));
        const rate = (list: typeof sorted) =>
          list.filter((x) => x.correct).length / list.length;
        const discrimination =
          sorted.length >= 4
            ? rate(sorted.slice(0, n)) - rate(sorted.slice(-n))
            : null;
        if (
          correctRate < 0.3 ||
          correctRate > 0.98 ||
          (discrimination !== null && discrimination < 0.1)
        )
          result.push({
            id,
            stem: str(row.stem),
            type: str(row.type),
            options: json(row.options, []),
            answer: json(row.answer, null),
            explanation: nullable(row.explanation),
            ownerUserId: str(row.ownerUserId),
            attempts: s.total,
            correctRate: Math.round(correctRate * 1000) / 1000,
            discrimination:
              discrimination === null
                ? null
                : Math.round(discrimination * 1000) / 1000,
            distribution: s.distribution,
          });
      }
      return result;
    },
  };
  void tryAuthorizeAction;
  return service;
}
