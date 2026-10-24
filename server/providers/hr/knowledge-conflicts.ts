/**
 * 文档冲突检查 (V1-04, 知识助手): when a new document or a new version is
 * ready, compare its sections — all of them for a new document, only the
 * added and modified ones for a version — with the other current, active,
 * ready documents. Only the same matter with a different number, time limit,
 * person or step counts; different wording with the same meaning does not.
 *
 * Candidates come from a deterministic comparison (`numericConflicts`); a
 * model, when configured, judges them and writes the description, otherwise
 * the rule's candidates stand. Conflicts are recorded once per pair of
 * sections and the owners of both documents are told — a document title only
 * to someone who may read that document, else HR alone. The assistant never
 * edits a document or decides which one is right. One check per version.
 */
import { z } from 'zod';

import { AIUnavailableError } from './ai-runner.js';
import { assertUnrestrictedNativeAIEntry } from '../native-ai/access.js';
import { authorizeAction, policyOf, scopeForUser } from './authorize.js';
import type { AutomationRunContext } from './automation.js';
import { numericConflicts, type SectionChange } from './document-changes.js';
import { splitSections } from './document-text.js';
import type { KnowledgeService } from './knowledge-service.js';
import type { Platform } from './platform.js';
import { json } from './platform.js';
import { str } from './shared.js';

type Structured = <T>(
  run: AutomationRunContext,
  employee: string,
  title: string,
  prompt: string,
  schema: z.ZodType<T>,
) => Promise<T>;

export function createConflictCheck(deps: {
  readonly platform: Platform;
  readonly knowledge: () => KnowledgeService;
  readonly structured: Structured;
  readonly questionScope: () => Promise<{
    docNos: readonly string[];
    categories: readonly string[];
  }>;
  readonly hrRecipients: () => Promise<string[]>;
}) {
  const { platform, structured } = deps;
  const { database } = platform;

  return async function conflictCheck(
    run: AutomationRunContext,
    documentId: string,
  ) {
    // Never replace a scoped entry with an unrestricted task owner.
    assertUnrestrictedNativeAIEntry(run.owner.authz);
    const eligibilityFields = [
      'id',
      'docNo',
      'category',
      'active',
      'parseStatus',
      'supersededById',
      'reviewStatus',
      'translationOfId',
      'updatedAt',
    ] as const;
    async function selectCurrent() {
      const scope = await deps.questionScope();
      const owner = {
        userId: run.owner.userId,
        authz: await scopeForUser(platform.authz, run.owner.userId),
      };
      const use = await authorizeAction(
        owner.authz,
        'talent.knowledgeAssistant',
        'use',
      );
      const view = await authorizeAction(
        owner.authz,
        'talent.kbDocument',
        'view',
      );
      const repo = database
        .repository('kbDocuments')
        .withPolicy(policyOf(use, 'kbDocuments'))
        .narrow(policyOf(view, 'kbDocuments'));
      // Apply both existing row/field policies before fetching even metadata; no
      // full text enters memory until the current question-source rules also pass.
      const eligible = (row: Record<string, unknown>) =>
        (row.reviewStatus ?? 'confirmed') !== 'draft' &&
        !row.translationOfId &&
        (!scope.docNos.length || scope.docNos.includes(str(row.docNo ?? ''))) &&
        (!scope.categories.length ||
          scope.categories.includes(str(row.category)));
      const base = { active: true, parseStatus: 'ready', supersededById: null };
      const doc = await repo.findOne({
        filter: { ...base, id: documentId },
        select: (select) => select.fields(...eligibilityFields),
      });
      if (!doc || !eligible(doc)) return undefined;
      const others = (
        await repo.findMany({
          filter: base,
          select: (select) => select.fields(...eligibilityFields),
        })
      ).filter(
        (row) =>
          str(row.id) !== documentId &&
          eligible(row) &&
          (!doc.docNo || str(row.docNo ?? '') !== str(doc.docNo)),
      );
      return { owner, repo, doc, others };
    }
    async function readCurrent() {
      const selected = await selectCurrent();
      if (!selected) return undefined;
      const rows = await selected.repo.findMany({
        filter: (f) =>
          f.or(
            [documentId, ...selected.others.map((row) => str(row.id))].map(
              (id) => f.string('id').eq(id),
            ),
          ),
      });
      const doc = rows.find((row) => row.id === documentId);
      if (!doc) return undefined;
      return {
        owner: selected.owner,
        doc,
        others: rows.filter((row) => row.id !== documentId),
      };
    }
    let input = await readCurrent();
    if (!input)
      return { status: 'skipped' as const, output: { reason: 'notCurrent' } };
    let { doc, others } = input;
    let sections = splitSections(doc.contentText as string | null);
    let changed = doc.previousVersionId
      ? new Set(
          json<SectionChange[]>(doc.changeSummary, [])
            .filter(
              (c) => c.changeType === 'added' || c.changeType === 'modified',
            )
            .map((c) => c.sectionTitle),
        )
      : null;
    let targets = changed
      ? sections.filter((s) => changed?.has(s.title))
      : sections;
    if (!targets.length)
      return {
        status: 'skipped' as const,
        output: { reason: 'noChangedSections' },
      };
    type Candidate = {
      sectionTitle: string;
      otherDocumentId: string;
      otherSectionTitle: string;
      excerpt: string;
      otherExcerpt: string;
      description: string;
    };
    function compare() {
      const candidates: Candidate[] = [];
      for (const section of targets)
        for (const other of others)
          for (const otherSection of splitSections(
            other.contentText as string | null,
          )) {
            const hits = numericConflicts(section.text, otherSection.text);
            if (!hits.length) continue;
            const hit = hits[0];
            candidates.push({
              sectionTitle: section.title,
              otherDocumentId: str(other.id),
              otherSectionTitle: otherSection.title,
              excerpt: hit.sentence,
              otherExcerpt: hit.otherSentence,
              description: `《${str(doc.title)}》${section.title}：“${hit.sentence}”；《${str(other.title)}》${otherSection.title}：“${hit.otherSentence}”`,
            });
          }
      return candidates;
    }
    let candidates = compare();
    if (candidates.length) {
      // Refresh current subjects, policies, source eligibility and text immediately
      // before generation. Notification-time filtering cannot protect model input.
      input = await readCurrent();
      if (!input)
        return { status: 'skipped' as const, output: { reason: 'notCurrent' } };
      ({ doc, others } = input);
      sections = splitSections(doc.contentText as string | null);
      changed = doc.previousVersionId
        ? new Set(
            json<SectionChange[]>(doc.changeSummary, [])
              .filter(
                (s) => s.changeType === 'added' || s.changeType === 'modified',
              )
              .map((s) => s.sectionTitle),
          )
        : null;
      targets = changed
        ? sections.filter((s) => changed?.has(s.title))
        : sections;
      candidates = compare();
    }
    if (candidates.length) {
      try {
        const verdict = await structured(
          { ...run, owner: input.owner },
          'knowledgeAssistant',
          '文档冲突检查',
          `下面是两份文档中疑似说法不一致的句子对。只有双方对同一事项给出不同的数值、时限、责任人或步骤时才算冲突，措辞不同但意思一致的不算。对每一对返回 index、isConflict 和 description（双方原文并列，不判断哪份正确，不超过 200 字）。\n${JSON.stringify(
            candidates.map((c, index) => ({
              index,
              a: c.excerpt,
              b: c.otherExcerpt,
            })),
          )}`,
          z.object({
            pairs: z.array(
              z.object({
                index: z.number().int(),
                isConflict: z.boolean(),
                description: z.string().max(400),
              }),
            ),
          }),
        );
        const judged = new Map(verdict.pairs.map((p) => [p.index, p]));
        candidates = candidates
          .map((c, index) => ({ c, v: judged.get(index) }))
          .filter(({ v }) => !v || v.isConflict)
          .map(({ c, v }) =>
            v?.description ? { ...c, description: v.description } : c,
          );
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run.markFallback();
      }
    }
    // Slow model calls do not preserve a revoked write/input entitlement. Recheck
    // without rereading full text and discard changed versions or hidden sources.
    if (candidates.length) {
      const current = await selectCurrent();
      if (!current || str(current.doc.updatedAt) !== str(doc.updatedAt))
        return { status: 'skipped' as const, output: { reason: 'notCurrent' } };
      candidates = candidates.filter((candidate) => {
        const before = others.find(
          (row) => str(row.id) === candidate.otherDocumentId,
        );
        const after = current.others.find(
          (row) => str(row.id) === candidate.otherDocumentId,
        );
        return (
          before && after && str(before.updatedAt) === str(after.updatedAt)
        );
      });
    }
    let created = 0;
    const byOther = new Map<string, number>();
    for (const c of candidates) {
      const result = await deps.knowledge().recordConflict({
        documentId,
        sectionTitle: c.sectionTitle,
        otherDocumentId: c.otherDocumentId,
        otherSectionTitle: c.otherSectionTitle,
        description: c.description,
        excerpt: c.excerpt,
        otherExcerpt: c.otherExcerpt,
        source: 'ai',
      });
      if (!result.created) continue;
      created += 1;
      byOther.set(c.otherDocumentId, (byOther.get(c.otherDocumentId) ?? 0) + 1);
    }
    run.reference({ documentId, sections: targets.map((s) => s.title) });
    if (!created) {
      run.summarize(`检查 ${targets.length} 个小节，没有发现冲突`);
      return { status: 'skipped' as const, output: { conflicts: 0 } };
    }
    run.summarize(`检查 ${targets.length} 个小节，记录冲突 ${created} 处`);
    const hr = await deps.hrRecipients();
    for (const [otherId, count] of byOther) {
      const other = others.find((o) => str(o.id) === otherId)!;
      const owners = new Set([str(doc.ownerUserId), str(other.ownerUserId)]);
      // A title reaches only readers of both documents; others are covered by HR's copy.
      const recipients = new Set<string>(hr);
      for (const owner of owners) {
        const ctx = {
          userId: owner,
          authz: await scopeForUser(platform.authz, owner),
        };
        const visible = await deps.knowledge().visibleDocumentIds(ctx);
        if (visible.has(documentId) && visible.has(otherId))
          recipients.add(owner);
      }
      await platform.notify({
        key: `automation:conflict:${documentId}:${otherId}`,
        userIds: [...recipients],
        message: 'documentConflictFound',
        params: {
          title: str(doc.title),
          other: str(other.title),
          count: String(count),
        },
        path: '/talent/knowledge?tab=conflicts',
      });
    }
    return { output: { conflicts: created } };
  };
}
