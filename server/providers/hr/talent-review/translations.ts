/**
 * V4-13 内容多语言 (13B): English versions of courses (with their lessons),
 * questions, knowledge documents and practice scenarios.
 *
 * - 生成英文版 (the owner, or hr.admin; `talent.translation.draft`): the
 *   content writer (contentWriter.translationDraft) drafts the translation,
 *   keeping numbers, units, codes and clause numbers unchanged and using the
 *   glossary of the settings; once per original version (a dedupe on the
 *   original's content hash). Without a model the glossary is applied to the
 *   original as the draft, which the reviewer completes.
 * - 待我审核 (`talent.translation.review`, the owner or hr.admin): edit and
 *   confirm. A course's lessons follow the course. Confirming supersedes the
 *   previous confirmed translation.
 * - 原文修改: a translation whose original's content changed is marked
 *   outdated (待更新) and a new draft is started for the new version (the
 *   hourly task, and whenever the list is read). An outdated translation is
 *   no longer shown; the original is.
 * - 员工按个人语言偏好 (the request's language): a confirmed, up-to-date
 *   translation replaces the course's and lessons' texts, and a question's
 *   stem and options in an exam paper; the ids stay the original's, so
 *   progress and grading are the same (同一题的译文与原文算同一题).
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import { authorizeAction, policyOf } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { hashOf, iso, json } from './context.js';

const RESOURCE = 'talent.translation';
export const CONTENT_TYPES = ['course', 'question', 'document', 'scenario'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];
export const TARGET_LOCALE = 'en-US';

const TABLE: Record<ContentType, 'courses' | 'questions' | 'kbDocuments' | 'practiceScenarios'> = {
  course: 'courses',
  question: 'questions',
  document: 'kbDocuments',
  scenario: 'practiceScenarios',
};

type Fields = Record<string, unknown>;

/** The texts of an original that are translated, per type. */
async function textsOf(
  ctx: TalentReviewContext,
  type: ContentType,
  row: Record<string, unknown>,
): Promise<Fields> {
  switch (type) {
    case 'course': {
      const lessons = await ctx.database
        .query()
        .selectFrom('lessons')
        .select(['id', 'title', 'content'])
        .where('courseId', '=', str(row.id))
        .orderBy('sortOrder', 'asc')
        .execute();
      return {
        title: str(row.title),
        description: row.description ? str(row.description) : '',
        lessons: lessons.map((l) => ({
          id: str(l.id),
          title: str(l.title),
          content: str(l.content ?? ''),
        })),
      };
    }
    case 'question':
      return {
        stem: str(row.stem),
        options: json<{ key: string; text: string }[]>(row.options, []),
        explanation: row.explanation ? str(row.explanation) : '',
      };
    case 'document':
      return { title: str(row.title), contentText: str(row.contentText ?? '') };
    case 'scenario':
      return {
        title: str(row.title),
        persona: str(row.persona),
        situation: str(row.situation),
        openingLine: str(row.openingLine),
        rubric: json<{ point: string }[]>(row.rubric, []),
      };
  }
}

/** Codes (WI-MC-0231), clause numbers and quantities that must survive translation. */
function protectedTokens(text: string): string[] {
  return [
    ...new Set([
      ...(text.match(/[A-Z]{1,4}-[A-Z]{1,4}-\d{2,}/gu) ?? []),
      ...(text.match(/\d+(?:\.\d+)?/gu) ?? []),
    ]),
  ];
}

/** 规则兜底：apply the glossary (longest term first); everything else is left for the reviewer. */
export function applyGlossary(
  text: string,
  glossary: readonly { zh: string; en: string }[],
): string {
  let out = text;
  for (const term of [...glossary].sort((a, b) => b.zh.length - a.zh.length))
    out = out.split(term.zh).join(term.en);
  return out;
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        k === 'id' || k === 'key' || k === 'competencyId' ? v : mapStrings(v, fn),
      ]),
    );
  return value;
}

const translatedSchema = z.object({ fields: z.record(z.string(), z.unknown()) });

export function createTranslationService(
  ctx: TalentReviewContext,
  deps: {
    ai: AIRunner;
    onRequested: (type: ContentType, id: string, hash: string) => Promise<unknown>;
  },
) {
  const { database, platform } = ctx;

  async function original(type: ContentType, id: string) {
    const row = await database
      .query()
      .selectFrom(TABLE[type])
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('CONTENT_NOT_FOUND', 404);
    if (row.translationOfId) throw new HrError('TRANSLATION_OF_TRANSLATION', 400);
    return row as Record<string, unknown>;
  }

  async function translationsOf(type: ContentType, originalId: string) {
    return (await database
      .query()
      .selectFrom(TABLE[type])
      .selectAll()
      .where('translationOfId', '=', originalId)
      .where('locale', '=', TARGET_LOCALE)
      .execute());
  }

  /** The caller's action reaches the original (owner scope for instructors, all for hr.admin). */
  async function assertReach(actor: ActorContext, action: 'draft' | 'review', type: ContentType, id: string) {
    const policies = await authorizeAction(actor.authz, RESOURCE, action);
    const visible = await database
      .repository(TABLE[type])
      .withPolicy(policyOf(policies, TABLE[type]))
      .findOne({ filter: { id } });
    if (!visible) throw new HrError('CONTENT_NOT_FOUND', 404);
  }

  async function contentHash(type: ContentType, row: Record<string, unknown>) {
    return hashOf(await textsOf(ctx, type, row));
  }

  /** Translates the texts: the model when configured (codes and numbers checked), else the glossary. */
  async function translate(
    run: AutomationRunContext | null,
    texts: Fields,
    title: string,
    userId: string,
  ) {
    const settings = await ctx.settings();
    const fallback = mapStrings(texts, (s) => applyGlossary(s, settings.glossary)) as Fields;
    try {
      const { data, sessionId } = await deps.ai.structured({
        employee: 'contentWriter',
        userId: run?.owner.userId ?? userId,
        title: `译文起草 ${title}`,
        prompt: `把下列培训内容翻译成英文（en-US），按原结构返回 fields。保留编号、数字、单位和作业文件条款号不变（如 SOP-0231、4.3、10 分钟 → 10 minutes）；id 和 key 不翻译。术语按术语表翻译：${settings.glossary.map((g) => `${g.zh} → ${g.en}`).join('；')}。
内容（JSON）：${JSON.stringify(texts).slice(0, 30_000)}`,
        schema: translatedSchema,
        timeZone: platform.timeZone,
      });
      run?.usedConversation(sessionId);
      const source = JSON.stringify(texts);
      const result = JSON.stringify(data.fields);
      // A translation that lost a code or a number is not trusted.
      if (protectedTokens(source).some((token) => !result.includes(token)))
        throw new AIUnavailableError('protected tokens lost');
      return { fields: { ...fallback, ...data.fields }, source: 'ai' as const };
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run?.markFallback();
      return { fields: fallback, source: 'rule' as const };
    }
  }

  const service = {
    /** 生成英文版 (the owner or hr.admin). */
    async request(actor: ActorContext, type: ContentType, id: string) {
      if (!CONTENT_TYPES.includes(type)) throw new HrError('INVALID_INPUT', 400);
      await assertReach(actor, 'draft', type, id);
      const row = await original(type, id);
      const hash = await contentHash(type, row);
      await deps.onRequested(type, id, hash);
      return service.listFor(type, id);
    },

    /** contentWriter.translationDraft (trusted; the request authorized the caller). */
    async draft(run: AutomationRunContext | null, type: ContentType, id: string) {
      const row = await original(type, id);
      const texts = await textsOf(ctx, type, row);
      const hash = hashOf(texts);
      const existing = await translationsOf(type, id);
      if (existing.some((t) => str(t.sourceHash ?? '') === hash && str(t.translationStatus ?? '') !== 'superseded'))
        return { status: 'skipped' as const, output: { reason: 'sameVersion' } };
      run?.summarize(`译文起草：${type} ${id}`);
      run?.reference({ type, id });
      const { fields, source } = await translate(
        run,
        texts,
        str(row.title ?? row.stem ?? ''),
        str(row.ownerUserId),
      );
      const now = new Date();
      const open = existing.find(
        (t) => str(t.reviewStatus ?? '') === 'draft' && str(t.translationStatus ?? '') !== 'superseded',
      );
      const base = {
        locale: TARGET_LOCALE,
        translationOfId: id,
        translationStatus: 'upToDate',
        sourceHash: hash,
        updatedAt: now,
      };
      let translationId: string;
      if (type === 'course') {
        const values = {
          title: str(fields.title ?? row.title).slice(0, 255),
          description: fields.description ? str(fields.description) : null,
          ...base,
        };
        if (open) {
          translationId = str(open.id);
          await database.query().updateTable('courses').set(values).where('id', '=', translationId).execute();
          await database.query().deleteFrom('lessons').where('courseId', '=', translationId).execute();
        } else {
          translationId = newId();
          const { id: _id, createdAt: _c, ...rest } = row;
          await database
            .query()
            .insertInto('courses')
            .values({
              ...rest,
              ...values,
              id: translationId,
              reviewStatus: 'draft',
              published: false,
              publishedAt: null,
              source: source === 'ai' ? 'ai' : 'manual',
              createdAt: now,
            })
            .execute();
        }
        const lessons = await database
          .query()
          .selectFrom('lessons')
          .selectAll()
          .where('courseId', '=', id)
          .execute();
        const translated = new Map(
          (json<{ id: string; title: string; content: string }[]>(fields.lessons, [])).map((l) => [l.id, l]),
        );
        for (const lesson of lessons) {
          const t = translated.get(str(lesson.id));
          const { id: lessonId, createdAt: _c, ...rest } = lesson as Record<string, unknown>;
          await database
            .query()
            .insertInto('lessons')
            .values({
              ...rest,
              id: newId(),
              courseId: translationId,
              title: str(t?.title ?? lesson.title).slice(0, 255),
              content: t?.content ?? lesson.content,
              locale: TARGET_LOCALE,
              translationOfId: str(lessonId),
              translationStatus: 'upToDate',
              sourceHash: hash,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        }
      } else if (type === 'question') {
        const values = {
          stem: str(fields.stem ?? row.stem),
          options: json(fields.options, json(row.options, [])),
          explanation: fields.explanation ? str(fields.explanation) : null,
          ...base,
        };
        if (open) {
          translationId = str(open.id);
          await database.query().updateTable('questions').set(values).where('id', '=', translationId).execute();
        } else {
          translationId = newId();
          const { id: _id, createdAt: _c, ...rest } = row;
          await database
            .query()
            .insertInto('questions')
            .values({
              ...rest,
              ...values,
              id: translationId,
              answer: json(row.answer, null),
              reviewStatus: 'draft',
              source: source === 'ai' ? 'ai' : 'manual',
              createdAt: now,
            })
            .execute();
        }
      } else if (type === 'scenario') {
        const values = {
          title: str(fields.title ?? row.title).slice(0, 255),
          persona: str(fields.persona ?? row.persona),
          situation: str(fields.situation ?? row.situation),
          openingLine: str(fields.openingLine ?? row.openingLine).slice(0, 1000),
          rubric: json(fields.rubric, json(row.rubric, [])),
          ...base,
        };
        if (open) {
          translationId = str(open.id);
          await database.query().updateTable('practiceScenarios').set(values).where('id', '=', translationId).execute();
        } else {
          translationId = newId();
          const { id: _id, createdAt: _c, ...rest } = row;
          await database
            .query()
            .insertInto('practiceScenarios')
            .values({
              ...rest,
              ...values,
              id: translationId,
              reviewStatus: 'draft',
              source: source === 'ai' ? 'ai' : 'manual',
              createdAt: now,
            })
            .execute();
        }
      } else {
        const contentText = str(fields.contentText ?? row.contentText ?? '');
        const title = str(fields.title ?? row.title).slice(0, 255);
        const fileId = await ctx.storeTextFile(`${title}.en-US.md`, contentText);
        const values = { title, contentText, fileId, ...base };
        if (open) {
          translationId = str(open.id);
          await database.query().updateTable('kbDocuments').set(values).where('id', '=', translationId).execute();
        } else {
          translationId = newId();
          const { id: _id, createdAt: _c, ...rest } = row;
          await database
            .query()
            .insertInto('kbDocuments')
            .values({
              ...rest,
              ...values,
              id: translationId,
              changeSummary: json(row.changeSummary, null),
              aiNotes: { translationOf: id, docNo: row.docNo ?? null },
              // The number and version belong to the original; a translation is found through translationOfId.
              docNo: null,
              previousVersionId: null,
              supersededById: null,
              reviewStatus: 'draft',
              source: 'ai',
              createdAt: now,
            })
            .execute();
        }
      }
      await platform.notify({
        key: `translation:${translationId}:${hash.slice(0, 12)}`,
        userIds: [str(row.ownerUserId)],
        message: 'translationDrafted',
        params: { title: str(row.title ?? row.stem ?? '').slice(0, 60) },
        path: '/talent/translations',
      });
      await run?.recordItems(`translation:${type}`, [{ id: translationId, hash }]);
      return { output: { type, id, translationId, source } };
    },

    /** Marks translations whose original changed as outdated; answers the originals to redraft. */
    async scanOutdated(): Promise<{ type: ContentType; id: string; hash: string }[]> {
      const redraft: { type: ContentType; id: string; hash: string }[] = [];
      for (const type of CONTENT_TYPES) {
        const rows = (await database
          .query()
          .selectFrom(TABLE[type])
          .select(['id', 'translationOfId', 'translationStatus', 'sourceHash', 'reviewStatus'])
          .where('translationOfId', 'is not', null)
          .execute());
        const byOriginal = new Map<string, Record<string, unknown>[]>();
        for (const r of rows)
          byOriginal.set(str(r.translationOfId), [...(byOriginal.get(str(r.translationOfId)) ?? []), r]);
        for (const [originalId, list] of byOriginal) {
          const source = await database
            .query()
            .selectFrom(TABLE[type])
            .selectAll()
            .where('id', '=', originalId)
            .executeTakeFirst();
          if (!source) continue;
          const hash = await contentHash(type, source);
          let stale = false;
          for (const t of list) {
            if (str(t.translationStatus ?? '') !== 'upToDate' || str(t.sourceHash ?? '') === hash) continue;
            stale = true;
            await database
              .query()
              .updateTable(TABLE[type])
              .set({ translationStatus: 'outdated', updatedAt: new Date() })
              .where('id', '=', str(t.id))
              .execute();
            if (type === 'course')
              await database
                .query()
                .updateTable('lessons')
                .set({ translationStatus: 'outdated', updatedAt: new Date() })
                .where('courseId', '=', str(t.id))
                .execute();
          }
          if (stale && !list.some((t) => str(t.sourceHash ?? '') === hash))
            redraft.push({ type, id: originalId, hash });
        }
      }
      return redraft;
    },

    async listFor(type: ContentType, id: string) {
      return (await translationsOf(type, id)).map((t) => ({
        id: str(t.id),
        reviewStatus: str(t.reviewStatus ?? ''),
        translationStatus: str(t.translationStatus ?? ''),
        updatedAt: iso(t.updatedAt),
      }));
    },

    /** 待我审核: translations of the content the caller reaches (drafts and outdated first). */
    async list(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'review');
      const out = [];
      for (const type of CONTENT_TYPES) {
        const originals = (await database
          .repository(TABLE[type])
          .withPolicy(policyOf(policies, TABLE[type]))
          .findMany({})) as Record<string, unknown>[];
        const reach = new Map(originals.map((o) => [str(o.id), o]));
        const rows = (await database
          .query()
          .selectFrom(TABLE[type])
          .selectAll()
          .where('translationOfId', 'is not', null)
          .execute());
        for (const t of rows) {
          const source = reach.get(str(t.translationOfId));
          if (!source || str(t.translationStatus ?? '') === 'superseded') continue;
          out.push({
            type,
            id: str(t.id),
            originalId: str(t.translationOfId),
            originalTitle: str(source.title ?? source.stem ?? '').slice(0, 120),
            title: str(t.title ?? t.stem ?? '').slice(0, 120),
            reviewStatus: str(t.reviewStatus ?? ''),
            translationStatus: str(t.translationStatus ?? ''),
            updatedAt: iso(t.updatedAt),
          });
        }
      }
      const rank = (r: { reviewStatus: string; translationStatus: string }) =>
        r.reviewStatus === 'draft' ? 0 : r.translationStatus === 'outdated' ? 1 : 2;
      return {
        items: out.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')),
      };
    },

    async detail(actor: ActorContext, type: ContentType, translationId: string) {
      const row = await database
        .query()
        .selectFrom(TABLE[type])
        .selectAll()
        .where('id', '=', translationId)
        .executeTakeFirst();
      if (!row?.translationOfId) throw new HrError('TRANSLATION_NOT_FOUND', 404);
      await assertReach(actor, 'review', type, str(row.translationOfId));
      const source = await original(type, str(row.translationOfId));
      const translatedTexts =
        type === 'course'
          ? {
              title: str(row.title),
              description: row.description ? str(row.description) : '',
              lessons: (
                await database
                  .query()
                  .selectFrom('lessons')
                  .select(['id', 'title', 'content', 'translationOfId'])
                  .where('courseId', '=', translationId)
                  .execute()
              ).map((l) => ({
                id: str(l.translationOfId),
                title: str(l.title),
                content: str(l.content ?? ''),
              })),
            }
          : await textsOf(ctx, type, row);
      return {
        type,
        id: translationId,
        reviewStatus: str(row.reviewStatus ?? ''),
        translationStatus: str(row.translationStatus ?? ''),
        original: await textsOf(ctx, type, source),
        translation: translatedTexts,
      };
    },

    async save(actor: ActorContext, type: ContentType, translationId: string, input: unknown) {
      const current = await service.detail(actor, type, translationId);
      if (current.reviewStatus !== 'draft') throw new HrError('TRANSLATION_NOT_DRAFT', 409);
      const fields =
        input && typeof input === 'object' ? ((input as { fields?: unknown }).fields as Fields | undefined) : undefined;
      if (!fields || typeof fields !== 'object') throw new HrError('INVALID_INPUT', 400);
      const now = new Date();
      if (type === 'course') {
        await database
          .query()
          .updateTable('courses')
          .set({
            ...(typeof fields.title === 'string' ? { title: fields.title.slice(0, 255) } : {}),
            ...(typeof fields.description === 'string' ? { description: fields.description } : {}),
            updatedAt: now,
          })
          .where('id', '=', translationId)
          .execute();
        for (const lesson of json<{ id: string; title?: string; content?: string }[]>(fields.lessons, []))
          await database
            .query()
            .updateTable('lessons')
            .set({
              ...(typeof lesson.title === 'string' ? { title: lesson.title.slice(0, 255) } : {}),
              ...(typeof lesson.content === 'string' ? { content: lesson.content } : {}),
              updatedAt: now,
            })
            .where('courseId', '=', translationId)
            .where('translationOfId', '=', lesson.id)
            .execute();
      } else {
        const allowed: Record<ContentType, string[]> = {
          course: [],
          question: ['stem', 'options', 'explanation'],
          document: ['title', 'contentText'],
          scenario: ['title', 'persona', 'situation', 'openingLine', 'rubric'],
        };
        const values: Record<string, unknown> = { updatedAt: now };
        for (const key of allowed[type]) if (key in fields) values[key] = fields[key];
        await database.query().updateTable(TABLE[type]).set(values).where('id', '=', translationId).execute();
      }
      return service.detail(actor, type, translationId);
    },

    /** 确认: the translation is shown to English readers; an earlier confirmed one is superseded. */
    async confirm(actor: ActorContext, type: ContentType, translationId: string) {
      const current = await service.detail(actor, type, translationId);
      if (current.reviewStatus !== 'draft') throw new HrError('TRANSLATION_NOT_DRAFT', 409);
      const row = await database
        .query()
        .selectFrom(TABLE[type])
        .select(['translationOfId'])
        .where('id', '=', translationId)
        .executeTakeFirst();
      const now = new Date();
      for (const other of await translationsOf(type, str(row!.translationOfId)))
        if (str(other.id) !== translationId && str(other.reviewStatus ?? '') === 'confirmed')
          await database
            .query()
            .updateTable(TABLE[type])
            .set({ translationStatus: 'superseded', updatedAt: now })
            .where('id', '=', str(other.id))
            .execute();
      await database
        .query()
        .updateTable(TABLE[type])
        .set({ reviewStatus: 'confirmed', updatedAt: now })
        .where('id', '=', translationId)
        .execute();
      await ctx.closeWorkItems(`translation:${translationId}:`);
      return service.detail(actor, type, translationId);
    },

    /** The confirmed, up-to-date translation of an original (trusted). */
    async current(type: ContentType, originalId: string) {
      return (await translationsOf(type, originalId)).find(
        (t) => str(t.reviewStatus ?? '') === 'confirmed' && str(t.translationStatus ?? '') === 'upToDate',
      );
    },

    /** 员工按语言偏好: a learner's course view with the confirmed English texts (ids unchanged). */
    async localizeCourseView<
      T extends {
        course: { id: string; title: string; description: string | null };
        lessons: readonly { id: string; title: string; content: string }[];
      },
    >(view: T, locale: string): Promise<T & { locale: string }> {
      if (locale !== TARGET_LOCALE) return { ...view, locale: 'zh-CN' };
      const translation = await service.current('course', view.course.id);
      if (!translation) return { ...view, locale: 'zh-CN' };
      const lessons = await database
        .query()
        .selectFrom('lessons')
        .select(['translationOfId', 'title', 'content'])
        .where('courseId', '=', str(translation.id))
        .execute();
      const byOriginal = new Map(lessons.map((l) => [str(l.translationOfId), l]));
      return {
        ...view,
        locale: TARGET_LOCALE,
        course: {
          ...view.course,
          title: str(translation.title),
          description: translation.description ? str(translation.description) : null,
        },
        lessons: view.lessons.map((lesson) => {
          const t = byOriginal.get(lesson.id);
          return t ? { ...lesson, title: str(t.title), content: str(t.content ?? '') } : lesson;
        }),
      };
    },

    /** Exam papers: the confirmed English stem and options of the original questions (grading keeps the original). */
    async questionTexts(
      ids: readonly string[],
      locale: string,
    ): Promise<Map<string, { stem: string; options: { key: string; text: string }[] }>> {
      const map = new Map<string, { stem: string; options: { key: string; text: string }[] }>();
      if (locale !== TARGET_LOCALE || !ids.length) return map;
      const rows = await database
        .query()
        .selectFrom('questions')
        .select(['translationOfId', 'stem', 'options', 'reviewStatus', 'translationStatus'])
        .where('translationOfId', 'in', [...ids])
        .where('locale', '=', TARGET_LOCALE)
        .execute();
      for (const r of rows)
        if (str(r.reviewStatus) === 'confirmed' && str(r.translationStatus ?? '') === 'upToDate')
          map.set(str(r.translationOfId), {
            stem: str(r.stem),
            options: json(r.options, []),
          });
      return map;
    },
  };
  return service;
}

export type TranslationService = ReturnType<typeof createTranslationService>;
