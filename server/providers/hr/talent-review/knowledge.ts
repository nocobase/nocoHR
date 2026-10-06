/**
 * V4-13 知识沉淀 (13B).
 *
 * - 接入: `POST /api/talent/knowledge-candidates:ingest` with the API key of
 *   the integration account `integration_ticket`, whose only permission is
 *   `talent.knowledgeCandidate.ingest`. Only resolved tickets and featured
 *   forum posts are accepted; the same (sourceSystem, externalId) updates the
 *   candidate instead of adding one. (No NocoTicket plugin is installed, so
 *   the push is the integration path; a same-application NocoTicket would
 *   write through the same service from a workflow.)
 * - 每周一 09:00, after the knowledge-gap report (knowledgeAssistant.
 *   knowledgeDistill): the new candidates and the resolved knowledge gaps are
 *   grouped by topic; a topic with at least `knowledgeMergeThreshold` items
 *   gets a FAQ draft (source ai, draft, uncontrolled), each answer with its
 *   source link. Candidates that conflict with a controlled current document
 *   (the V1-04 conflict rule: the same matter with another number) are left
 *   out and listed in the draft's notes. A topic drafted before is updated
 *   only when it has new candidates. A draft never answers questions; its
 *   owner (the owner of the related controlled document, else the run's
 *   owner) confirms it in the knowledge base's 待审核 tab.
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import { authorizeAction, policyOf } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import { similarity } from '../document-changes.js';
import { splitSections } from '../document-text.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { bool, iso, json } from './context.js';

const RESOURCE = 'talent.knowledgeCandidate';

const ingestInput = z
  .object({
    items: z
      .array(
        z
          .object({
            sourceSystem: z.enum(['ticket', 'forum']),
            externalId: z.string().trim().min(1).max(128),
            title: z.string().trim().min(1).max(300),
            content: z.string().trim().min(1).max(20_000),
            link: z.string().trim().max(1000).nullable().optional(),
            resolved: z.boolean().optional(),
            featured: z.boolean().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(500),
  })
  .strict();
const topicSchema = z.object({
  topics: z.array(
    z.object({
      topic: z.string().min(1).max(100),
      candidateIds: z.array(z.string()).min(1),
    }),
  ),
});

export interface CandidateRow {
  id: string;
  sourceSystem: string;
  externalId: string;
  title: string;
  content: string;
  link: string | null;
  topic: string | null;
  status: string;
  draftDocumentId: string | null;
  createdAt: string | null;
}

function toCandidate(row: Record<string, unknown>): CandidateRow {
  return {
    id: str(row.id),
    sourceSystem: str(row.sourceSystem),
    externalId: str(row.externalId),
    title: str(row.title),
    content: str(row.content),
    link: row.link ? str(row.link) : null,
    topic: row.topic ? str(row.topic) : null,
    status: str(row.status),
    draftDocumentId: row.draftDocumentId ? str(row.draftDocumentId) : null,
    createdAt: iso(row.createdAt),
  };
}

const UNITS = '分钟|小时|秒|天|次|元|件|%|mm|℃';
const QUANTITY = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNITS})`, 'gu');

function sentences(text: string): string[] {
  return text
    .split(/[。；;！!？?\n]+/u)
    .map((s) => s.replace(/^[-*#>\s\d.]+/u, '').trim())
    .filter((s) => s.length >= 4);
}

/** 冲突检查 (the V1-04 rule): the same matter, the same unit, another number. */
export function conflictsWith(
  text: string,
  documentText: string,
): { sentence: string; documentSentence: string }[] {
  const found: { sentence: string; documentSentence: string }[] = [];
  for (const sentence of sentences(text)) {
    const own = [...sentence.matchAll(QUANTITY)];
    if (!own.length) continue;
    for (const other of sentences(documentText)) {
      const theirs = [...other.matchAll(QUANTITY)];
      if (!theirs.length) continue;
      if (similarity(sentence, other).shared < 3) continue;
      if (
        own.some((a) => theirs.some((b) => a[2] === b[2] && a[1] !== b[1]))
      ) {
        found.push({ sentence, documentSentence: other });
        break;
      }
    }
  }
  return found;
}

/** 规则兜底：按报警代码或标题归并主题. */
export function topicByRule(candidate: { title: string; content: string }): string {
  const text = `${candidate.title} ${candidate.content}`;
  const code =
    /(?:报警|alarm)\s*([A-Z]{1,3}\d{1,4})/iu.exec(text)?.[1] ??
    /([A-Z]{1,3}\d{1,4})\s*(?:报警|alarm)/iu.exec(text)?.[1];
  if (code) return `报警 ${code.toUpperCase()} 处理`;
  return candidate.title.replace(/[？?。！!]+$/u, '').slice(0, 40);
}

export function createKnowledgeDistiller(
  ctx: TalentReviewContext,
  deps: { ai: AIRunner },
) {
  const { database, platform } = ctx;

  async function candidates(filter?: { status?: string }) {
    let query = database.query().selectFrom('knowledgeCandidates').selectAll();
    if (filter?.status) query = query.where('status', '=', filter.status);
    return (await query.orderBy('createdAt', 'asc').execute()).map(toCandidate);
  }

  /** Resolved knowledge gaps become candidates once (sourceSystem knowledgeGap). */
  async function importResolvedGaps(): Promise<number> {
    const gaps = await database
      .query()
      .selectFrom('knowledgeGaps')
      .select(['id', 'question', 'resolvedDocumentId'])
      .where('status', '=', 'resolved')
      .execute();
    let added = 0;
    for (const gap of gaps) {
      const exists = await database
        .query()
        .selectFrom('knowledgeCandidates')
        .select(['id'])
        .where('sourceSystem', '=', 'knowledgeGap')
        .where('externalId', '=', str(gap.id))
        .executeTakeFirst();
      if (exists) continue;
      const doc = gap.resolvedDocumentId
        ? await database
            .query()
            .selectFrom('kbDocuments')
            .select(['title'])
            .where('id', '=', str(gap.resolvedDocumentId))
            .executeTakeFirst()
        : undefined;
      const now = new Date();
      await database
        .query()
        .insertInto('knowledgeCandidates')
        .values({
          id: newId(),
          sourceSystem: 'knowledgeGap',
          externalId: str(gap.id),
          title: str(gap.question).slice(0, 300),
          content: doc ? `已由《${str(doc.title)}》解答。` : '知识缺口已解决。',
          link: gap.resolvedDocumentId
            ? `/talent/knowledge/${str(gap.resolvedDocumentId)}`
            : null,
          topic: null,
          status: 'new',
          draftDocumentId: null,
          ignoredBy: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      added += 1;
    }
    return added;
  }

  async function controlledDocuments() {
    return (
      await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id', 'title', 'docNo', 'version', 'contentText', 'ownerUserId', 'supersededById', 'controlled', 'reviewStatus', 'translationOfId'])
        .where('active', '=', true)
        .where('parseStatus', '=', 'ready')
        .execute()
    ).filter(
      (d) =>
        !d.supersededById &&
        bool(d.controlled) &&
        str(d.reviewStatus ?? 'confirmed') === 'confirmed' &&
        !d.translationOfId,
    );
  }

  function faqMarkdown(items: readonly CandidateRow[]): string {
    const source = (c: CandidateRow) =>
      `${c.sourceSystem === 'ticket' ? '工单' : c.sourceSystem === 'forum' ? '论坛' : '知识缺口'} ${c.externalId}`;
    return `> 本文档由知识助手根据已解决的工单和论坛精华整理，为非受控文件，仅供参考；以受控作业文件为准。

${items
  .map(
    (c) => `# ${c.title}
${c.content}

来源：${c.link ? `[${source(c)}](${c.link})` : source(c)}`,
  )
  .join('\n\n')}
`;
  }

  const service = {
    /** 接口推送: resolved tickets and featured posts; the same source id updates. */
    async ingest(actor: ActorContext, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'ingest');
      const parsed = ingestInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const repo = database
        .repository('knowledgeCandidates')
        .withPolicy(policyOf(policies, 'knowledgeCandidates'));
      const report = { created: 0, updated: 0, rejected: [] as string[] };
      for (const item of parsed.data.items) {
        const accepted =
          item.sourceSystem === 'ticket' ? item.resolved === true : item.featured === true;
        if (!accepted) {
          report.rejected.push(item.externalId);
          continue;
        }
        const existing = await database
          .query()
          .selectFrom('knowledgeCandidates')
          .select(['id'])
          .where('sourceSystem', '=', item.sourceSystem)
          .where('externalId', '=', item.externalId)
          .executeTakeFirst();
        const now = new Date();
        if (existing) {
          await repo.updateOne({
            filter: { id: str(existing.id) },
            values: {
              title: item.title,
              content: item.content,
              link: item.link ?? null,
              updatedAt: now,
            },
          });
          report.updated += 1;
        } else {
          await repo.createOne({
            values: {
              id: newId(),
              sourceSystem: item.sourceSystem,
              externalId: item.externalId,
              title: item.title,
              content: item.content,
              link: item.link ?? null,
              topic: null,
              status: 'new',
              draftDocumentId: null,
              ignoredBy: null,
              createdAt: now,
              updatedAt: now,
            },
          });
          report.created += 1;
        }
      }
      return report;
    },

    async list(actor: ActorContext, filters: { status?: string }) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'view');
      const rows = (await database
        .repository('knowledgeCandidates')
        .withPolicy(policyOf(policies, 'knowledgeCandidates'))
        .findMany(filters.status ? { filter: { status: filters.status } } : {})) as Record<
        string,
        unknown
      >[];
      return {
        items: rows.map(toCandidate),
        can: { ignore: await ctx.can(actor, RESOURCE, 'ignore') },
      };
    },

    async ignore(actor: ActorContext, id: string) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'ignore');
      const repo = database
        .repository('knowledgeCandidates')
        .withPolicy(policyOf(policies, 'knowledgeCandidates'));
      if (!(await repo.findOne({ filter: { id } })))
        throw new HrError('KNOWLEDGE_CANDIDATE_NOT_FOUND', 404);
      await repo.updateOne({
        filter: { id },
        values: { status: 'ignored', ignoredBy: actor.userId, updatedAt: new Date() },
      });
      return { id, status: 'ignored' };
    },

    /** knowledgeAssistant.knowledgeDistill (weekly, or by hand). */
    async distill(run: AutomationRunContext) {
      await authorizeAction(run.owner.authz, 'talent.knowledgeAssistant', 'use');
      const settings = await ctx.settings();
      await importResolvedGaps();
      const all = (await candidates()).filter((c) => c.status !== 'ignored');
      const fresh = all.filter((c) => c.status === 'new');
      run.summarize(`知识沉淀：${fresh.length} 条新候选`);
      if (!fresh.length) return { status: 'skipped' as const, output: { reason: 'noNewCandidates' } };
      // 归并主题: the model when configured, else the alarm code / title rule.
      let topics = new Map<string, string>();
      try {
        const { data, sessionId } = await deps.ai.structured({
          employee: 'knowledgeAssistant',
          userId: run.owner.userId,
          title: '知识沉淀：归并主题',
          prompt: `把下列已解决的问题按主题归并（同一个问题的不同说法归为一个主题），主题名简短（如“报警 E17 处理”“报销单退回重提”）。已有主题：${JSON.stringify([...new Set(all.map((c) => c.topic).filter(Boolean))])}
问题：${JSON.stringify(all.map((c) => ({ id: c.id, title: c.title, content: c.content.slice(0, 300) })))}`,
          schema: topicSchema,
          timeZone: platform.timeZone,
        });
        run.usedConversation(sessionId);
        for (const t of data.topics) for (const id of t.candidateIds) topics.set(id, t.topic);
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
        topics = new Map();
      }
      for (const c of all) if (!topics.has(c.id)) topics.set(c.id, c.topic ?? topicByRule(c));
      const groups = new Map<string, CandidateRow[]>();
      for (const c of all) groups.set(topics.get(c.id)!, [...(groups.get(topics.get(c.id)!) ?? []), c]);
      for (const c of fresh)
        await database
          .query()
          .updateTable('knowledgeCandidates')
          .set({ topic: topics.get(c.id)!, updatedAt: new Date() })
          .where('id', '=', c.id)
          .execute();
      const documents = await controlledDocuments();
      const drafted: string[] = [];
      for (const [topic, items] of groups) {
        const hasNew = items.some((c) => c.status === 'new');
        if (!hasNew || items.length < settings.knowledgeMergeThreshold) continue;
        // 冲突检查: a candidate contradicting a controlled document is left out and listed.
        const conflicts: {
          candidateId: string;
          externalId: string;
          sentence: string;
          documentId: string;
          document: string;
          documentSentence: string;
        }[] = [];
        let related: (typeof documents)[number] | undefined;
        let bestShared = 0;
        for (const c of items) {
          for (const doc of documents) {
            const text = str(doc.contentText ?? '');
            const found = conflictsWith(`${c.title}。${c.content}`, text);
            const label = `${doc.docNo ? `${str(doc.docNo)} ` : ''}${str(doc.title)}${doc.version ? ` ${str(doc.version)}` : ''}`;
            for (const f of found)
              conflicts.push({
                candidateId: c.id,
                externalId: c.externalId,
                sentence: f.sentence,
                documentId: str(doc.id),
                document: label,
                documentSentence: f.documentSentence,
              });
            const shared = splitSections(text).reduce(
              (m, s) => Math.max(m, similarity(c.content, s.text).shared),
              0,
            );
            if (shared > bestShared) {
              bestShared = shared;
              related = doc;
            }
          }
        }
        const conflicting = new Set(conflicts.map((c) => c.candidateId));
        const kept = items.filter((c) => !conflicting.has(c.id));
        if (!kept.length) continue;
        const owner = related && bestShared >= 3 ? str(related.ownerUserId) : run.owner.userId;
        const content = faqMarkdown(kept);
        const notes = {
          topic,
          candidateIds: kept.map((c) => c.id),
          sources: kept.map((c) => ({
            sourceSystem: c.sourceSystem,
            externalId: c.externalId,
            title: c.title,
            link: c.link,
          })),
          conflicts,
          relatedDocumentId: related && bestShared >= 3 ? str(related.id) : null,
          runId: run.runId,
        };
        // 已起草过的主题: update its draft (a confirmed one gets a new draft).
        const existingDraft = items.find((c) => c.draftDocumentId)?.draftDocumentId;
        const draftRow = existingDraft
          ? await database
              .query()
              .selectFrom('kbDocuments')
              .select(['id', 'reviewStatus', 'active'])
              .where('id', '=', existingDraft)
              .executeTakeFirst()
          : undefined;
        const now = new Date();
        const fileId = await ctx.storeTextFile(`${topic}.md`, content);
        let documentId: string;
        if (draftRow && str(draftRow.reviewStatus) === 'draft' && bool(draftRow.active)) {
          documentId = str(draftRow.id);
          await database
            .query()
            .updateTable('kbDocuments')
            .set({ contentText: content, fileId, aiNotes: notes, updatedAt: now })
            .where('id', '=', documentId)
            .execute();
        } else {
          documentId = newId();
          await database
            .query()
            .insertInto('kbDocuments')
            .values({
              id: documentId,
              title: `常见问题：${topic}`,
              category: 'other',
              fileId,
              contentText: content,
              parseStatus: 'ready',
              parseError: null,
              visibility: 'all',
              ownerUserId: owner,
              reviewDate: null,
              autoDraftCourse: false,
              active: true,
              source: 'ai',
              reviewStatus: 'draft',
              controlled: false,
              aiNotes: notes,
              locale: 'zh-CN',
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        }
        for (const c of items)
          await database
            .query()
            .updateTable('knowledgeCandidates')
            .set({
              status: 'drafted',
              draftDocumentId: conflicting.has(c.id) ? null : documentId,
              updatedAt: now,
            })
            .where('id', '=', c.id)
            .execute();
        await platform.notify({
          key: `knowledgeDraft:${documentId}:${run.runId}`,
          userIds: [owner],
          message: 'knowledgeFaqDrafted',
          params: { title: topic, count: String(kept.length), conflicts: String(conflicts.length) },
          path: '/talent/knowledge?tab=pending',
        });
        await run.recordItems('kbDocument', [{ id: documentId, hash: null }]);
        drafted.push(documentId);
      }
      run.reference({ documentIds: drafted });
      return { output: { drafted: drafted.length, documentIds: drafted } };
    },

    /** 知识库 · 待审核: the AI-drafted FAQ documents with their sources and conflicts. */
    async pending(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, 'talent.kbDocument', 'manage');
      const rows = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findMany({ filter: { source: 'ai', reviewStatus: 'draft', active: true } })) as Record<
        string,
        unknown
      >[];
      return Promise.all(
        rows.map(async (row) => ({
          id: str(row.id),
          title: str(row.title),
          contentText: str(row.contentText ?? ''),
          ownerName: await ctx.userName(str(row.ownerUserId)),
          notes: json<Record<string, unknown>>(row.aiNotes, {}),
          updatedAt: iso(row.updatedAt),
        })),
      );
    },

    async decide(actor: ActorContext, id: string, decision: 'confirm' | 'discard') {
      const policies = await authorizeAction(actor.authz, 'talent.kbDocument', 'manage');
      const row = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || str(row.source ?? '') !== 'ai' || str(row.reviewStatus ?? '') !== 'draft')
        throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const admin = await ctx.can(actor, 'talent.talentReview', 'manage');
      if (str(row.ownerUserId) !== actor.userId && !admin)
        throw new HrError('FORBIDDEN', 403);
      await database
        .query()
        .updateTable('kbDocuments')
        .set(
          decision === 'confirm'
            ? { reviewStatus: 'confirmed', updatedAt: new Date() }
            : { active: false, updatedAt: new Date() },
        )
        .where('id', '=', id)
        .execute();
      await ctx.closeWorkItems(`knowledgeDraft:${id}:`);
      return { id, decision };
    },
  };
  return service;
}

export type KnowledgeDistiller = ReturnType<typeof createKnowledgeDistiller>;
