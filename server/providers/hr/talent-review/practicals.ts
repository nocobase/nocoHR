/**
 * V4-13 实操考核 (13B).
 *
 * - 考核表 (`manageTemplates`, hr.admin and hr.instructor): checklist items,
 *   the critical ones, the pass rule, the work instruction it is based on, a
 *   witness requirement. A form the examiner drafted is `source: ai`, `draft`
 *   and cannot be used until confirmed (总纲 AI 员工约定第 6 条).
 * - 开始考核 (`conduct`, the permission set hr.practicalAssessor): the
 *   assessor is the caller; nobody assesses themselves; a form that needs a
 *   witness needs one named (not the assessor, not the person assessed).
 * - 让考官整理 (examiner.structureObservation): each checklist item gets a
 *   suggestion with the quoted notes; items without a note are 未记录 and are
 *   never suggested as passed. Unchanged notes are not structured again.
 * - 签字: the assessor confirms every item and signs; the server computes
 *   `passed` (every critical item passed, when the rule says so, and the pass
 *   rate at least `minPassRate`). With a witness the record completes when
 *   the witness signs in their own account (`witness`, per record). A signed
 *   record is immutable; only hr.admin voids it, with a reason (`void`).
 * - A completed record starts the certification check (发证与续发), through
 *   `practicalGate`, which the certification service asks before issuing.
 */
import { z } from 'zod';

import { AIUnavailableError, type AIRunner } from '../ai-runner.js';
import { authorizeAction, policyOf } from '../authorize.js';
import type { AutomationRunContext } from '../automation.js';
import { splitSections } from '../document-text.js';
import type { ActorContext } from '../framework-service.js';
import { HrError, newId, str } from '../shared.js';
import type { TalentReviewContext } from './context.js';
import { bool, hashOf, iso, json } from './context.js';

const RESOURCE = 'talent.practical';

export interface ChecklistItem {
  key: string;
  item: string;
  critical: boolean;
  sourceExcerpt: string | null;
}
export interface PassRule {
  allCriticalPass: boolean;
  minPassRate: number;
}
export interface ItemResult {
  key: string;
  passed: boolean;
  note: string;
}
export interface Structured {
  items: {
    key: string;
    suggestion: 'pass' | 'fail' | 'notRecorded';
    quotes: string[];
  }[];
  notesHash: string;
  source: 'ai' | 'rule';
  generatedAt: string;
}

const checklistSchema = z
  .array(
    z
      .object({
        key: z.string().trim().min(1).max(40),
        item: z.string().trim().min(1).max(300),
        critical: z.boolean(),
        sourceExcerpt: z.string().max(1000).nullable().optional(),
      })
      .strict(),
  )
  .min(1)
  .max(50);
const templateInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    competencyIds: z.array(z.string().min(1).max(64)).min(1).max(20),
    checklist: checklistSchema,
    passRule: z
      .object({
        allCriticalPass: z.boolean(),
        minPassRate: z.number().min(0).max(100),
      })
      .strict()
      .optional(),
    sourceDocumentId: z.string().max(64).nullable().optional(),
    requiresWitness: z.boolean().optional(),
    active: z.boolean().optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();
const startInput = z
  .object({
    assessmentId: z.string().min(1).max(64),
    employeeId: z.string().min(1).max(64),
    witnessUserId: z.string().max(64).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    conductedAt: z.string().max(40).optional(),
  })
  .strict();
const recordInput = z
  .object({
    observationNotes: z.string().max(20_000).nullable().optional(),
    location: z.string().max(200).nullable().optional(),
    witnessUserId: z.string().max(64).nullable().optional(),
    results: z
      .array(
        z
          .object({
            key: z.string().min(1).max(40),
            passed: z.boolean(),
            note: z.string().max(1000).default(''),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    attachments: z.array(z.string().min(1).max(64)).max(30).optional(),
  })
  .strict();
const structuredSchema = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      suggestion: z.enum(['pass', 'fail', 'notRecorded']),
      quotes: z.array(z.string().max(500)).max(5),
    }),
  ),
});
const draftChecklistSchema = z.object({
  title: z.string().min(1).max(200),
  checklist: z
    .array(
      z.object({
        item: z.string().min(1).max(300),
        critical: z.boolean(),
        sourceExcerpt: z.string().max(1000),
      }),
    )
    .min(1)
    .max(30),
});

/** 通过规则: the server's only decision on a record. */
export function computePassed(
  checklist: readonly ChecklistItem[],
  results: readonly ItemResult[],
  rule: PassRule,
): boolean {
  if (!checklist.length) return false;
  const byKey = new Map(results.map((r) => [r.key, r]));
  if (checklist.some((c) => !byKey.has(c.key))) return false;
  if (
    rule.allCriticalPass &&
    checklist.some((c) => c.critical && !byKey.get(c.key)!.passed)
  )
    return false;
  const passed = checklist.filter((c) => byKey.get(c.key)!.passed).length;
  return (passed / checklist.length) * 100 >= rule.minPassRate;
}

/** Splits observation notes into sentences (typed or dictated). */
function sentences(notes: string): string[] {
  return notes
    .split(/[\n。；;！!？?]+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEGATIVE = /未|没有|没|漏|忘|不合格|不符合|错误|超差|缺少|不规范|不到位|未按/u;

/** Keywords of a checklist item: its CJK bigrams and Latin words. */
function keywords(text: string): string[] {
  const clean = text.replace(/[\s，,、（）()：:“”"]/gu, '');
  const words = new Set<string>();
  for (const w of clean.match(/[A-Za-z0-9]{2,}/gu) ?? []) words.add(w.toLowerCase());
  const cjk = clean.replace(/[A-Za-z0-9]/gu, '');
  for (let i = 0; i < cjk.length - 1; i += 1) words.add(cjk.slice(i, i + 2));
  return [...words];
}

/** 规则兜底：把现场记录对应到检查项；没有对应记录的项为“未记录”，绝不建议为通过。 */
export function structureByRule(
  checklist: readonly ChecklistItem[],
  notes: string,
): Structured['items'] {
  const lines = sentences(notes);
  return checklist.map((item) => {
    const words = keywords(item.item);
    const quotes = lines.filter((line) => {
      const lower = line.toLowerCase();
      const hits = words.filter((w) => lower.includes(w)).length;
      return hits >= Math.min(2, words.length);
    });
    if (!quotes.length)
      return { key: item.key, suggestion: 'notRecorded' as const, quotes: [] };
    const negative = quotes.some((q) => NEGATIVE.test(q));
    return {
      key: item.key,
      suggestion: negative ? ('fail' as const) : ('pass' as const),
      quotes: quotes.slice(0, 5),
    };
  });
}

export function createPracticalService(
  ctx: TalentReviewContext,
  deps: { ai: AIRunner; onCompleted: (employeeId: string) => void },
) {
  const { database, platform } = ctx;

  function toTemplate(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      title: str(row.title),
      competencyIds: json<string[]>(row.competencyIds, []),
      checklist: json<ChecklistItem[]>(row.checklist, []),
      passRule: json<PassRule>(row.passRule, {
        allCriticalPass: true,
        minPassRate: 80,
      }),
      sourceDocumentId: row.sourceDocumentId ? str(row.sourceDocumentId) : null,
      requiresWitness: bool(row.requiresWitness),
      reviewStatus: str(row.reviewStatus),
      source: str(row.source),
      active: bool(row.active),
      ownerUserId: str(row.ownerUserId),
      confirmedAt: iso(row.confirmedAt),
      customFields: json<Record<string, unknown>>(row.customFields, {}),
      updatedAt: iso(row.updatedAt),
    };
  }
  type Template = ReturnType<typeof toTemplate>;

  function toRecord(row: Record<string, unknown>) {
    return {
      id: str(row.id),
      assessmentId: str(row.assessmentId),
      employeeId: str(row.employeeId),
      assessorUserId: str(row.assessorUserId),
      witnessUserId: row.witnessUserId ? str(row.witnessUserId) : null,
      conductedAt: iso(row.conductedAt),
      location: row.location ? str(row.location) : null,
      observationNotes: row.observationNotes ? str(row.observationNotes) : '',
      aiStructured: json<Structured | null>(row.aiStructured, null),
      results: json<ItemResult[]>(row.results, []),
      passed: bool(row.passed),
      attachments: json<string[]>(row.attachments, []),
      signedAt: iso(row.signedAt),
      witnessSignedAt: iso(row.witnessSignedAt),
      status: str(row.status),
      voidReason: row.voidReason ? str(row.voidReason) : null,
      voidedAt: iso(row.voidedAt),
      updatedAt: iso(row.updatedAt),
    };
  }
  type RecordRow = ReturnType<typeof toRecord>;

  async function templateRow(id: string): Promise<Template> {
    const row = await database
      .query()
      .selectFrom('practicalAssessments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('PRACTICAL_ASSESSMENT_NOT_FOUND', 404);
    return toTemplate(row);
  }

  async function recordRow(id: string): Promise<RecordRow> {
    const row = await database
      .query()
      .selectFrom('practicalRecords')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
    return toRecord(row);
  }

  /** The record, if the action's record scope reaches it. */
  async function visibleRecord(
    actor: ActorContext,
    action: 'view' | 'conduct' | 'witness' | 'void',
    id: string,
  ): Promise<RecordRow> {
    const policies = await authorizeAction(actor.authz, RESOURCE, action);
    const visible = await database
      .repository('practicalRecords')
      .withPolicy(policyOf(policies, 'practicalRecords'))
      .findOne({ filter: { id } });
    if (!visible) throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
    return recordRow(id);
  }

  async function recordView(actor: ActorContext, record: RecordRow) {
    const template = await templateRow(record.assessmentId);
    const employee = await ctx.employee(record.employeeId);
    const files = record.attachments.length
      ? await database
          .query()
          .selectFrom('hrFiles')
          .select(['id', 'filename', 'mimeType'])
          .where('id', 'in', record.attachments)
          .execute()
      : [];
    const editable =
      record.status === 'draft' && record.assessorUserId === actor.userId;
    return {
      ...record,
      assessment: template,
      employeeName: employee.name,
      assessorName: await ctx.userName(record.assessorUserId),
      witnessName: record.witnessUserId ? await ctx.userName(record.witnessUserId) : null,
      files: files.map((f) => ({
        id: str(f.id),
        filename: str(f.filename),
        mimeType: str(f.mimeType),
      })),
      can: {
        edit: editable,
        sign: editable,
        witness:
          record.status === 'signed' && record.witnessUserId === actor.userId,
        void:
          record.status !== 'voided' &&
          (await ctx.can(actor, RESOURCE, 'void')),
      },
    };
  }

  async function structuredCall(
    run: AutomationRunContext | null,
    title: string,
    prompt: string,
    userId: string,
  ) {
    try {
      const { data, sessionId } = await deps.ai.structured({
        employee: 'examiner',
        userId: run?.owner.userId ?? userId,
        title,
        prompt,
        schema: structuredSchema,
        timeZone: platform.timeZone,
      });
      run?.usedConversation(sessionId);
      return data;
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      run?.markFallback();
      return null;
    }
  }

  const service = {
    templateRow,
    recordRow,

    // ---------- 考核表 ----------
    async listTemplates(actor: ActorContext) {
      const canManage = await ctx.can(actor, RESOURCE, 'manageTemplates');
      const canConduct = await ctx.can(actor, RESOURCE, 'conduct');
      if (!canManage && !canConduct && !(await ctx.can(actor, RESOURCE, 'view')))
        throw new HrError('FORBIDDEN', 403);
      const rows = await database
        .query()
        .selectFrom('practicalAssessments')
        .selectAll()
        .orderBy('createdAt', 'asc')
        .execute();
      const documents = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id', 'title', 'docNo', 'version'])
        .execute();
      const titleOf = new Map(
        documents.map((d) => [
          str(d.id),
          `${d.docNo ? `${str(d.docNo)} ` : ''}${str(d.title)}${d.version ? ` ${str(d.version)}` : ''}`,
        ]),
      );
      return {
        templates: rows
          .map(toTemplate)
          // Assessors only see forms that may be used.
          .filter((t) => canManage || (t.reviewStatus === 'confirmed' && t.active))
          .map((t) => ({
            ...t,
            sourceDocumentTitle: t.sourceDocumentId
              ? (titleOf.get(t.sourceDocumentId) ?? null)
              : null,
          })),
        can: { manage: canManage, conduct: canConduct },
      };
    },

    async saveTemplate(actor: ActorContext, id: string | null, input: unknown) {
      await authorizeAction(actor.authz, RESOURCE, 'manageTemplates');
      const parsed = templateInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const keys = parsed.data.checklist.map((c) => c.key);
      if (new Set(keys).size !== keys.length)
        throw new HrError('PRACTICAL_CHECKLIST_DUPLICATE', 400);
      const settings = await ctx.settings();
      const now = new Date();
      const values = {
        title: parsed.data.title,
        competencyIds: parsed.data.competencyIds,
        checklist: parsed.data.checklist.map((c) => ({
          ...c,
          sourceExcerpt: c.sourceExcerpt ?? null,
        })),
        passRule: parsed.data.passRule ?? settings.practicalPassRule,
        sourceDocumentId: parsed.data.sourceDocumentId ?? null,
        requiresWitness: parsed.data.requiresWitness ?? false,
        active: parsed.data.active ?? true,
        customFields: parsed.data.customFields ?? null,
        updatedAt: now,
      };
      if (id) {
        await templateRow(id);
        await database
          .query()
          .updateTable('practicalAssessments')
          .set(values)
          .where('id', '=', id)
          .execute();
        return templateRow(id);
      }
      const newIdValue = newId();
      await database
        .query()
        .insertInto('practicalAssessments')
        .values({
          id: newIdValue,
          ...values,
          // A person writing a form confirms it by saving it.
          reviewStatus: 'confirmed',
          source: 'manual',
          ownerUserId: actor.userId,
          confirmedBy: actor.userId,
          confirmedAt: now,
          createdAt: now,
        })
        .execute();
      return templateRow(newIdValue);
    },

    /** 确认 an AI-drafted form (the instructor or hr.admin). */
    async confirmTemplate(actor: ActorContext, id: string) {
      await authorizeAction(actor.authz, RESOURCE, 'manageTemplates');
      const template = await templateRow(id);
      if (template.reviewStatus === 'confirmed')
        throw new HrError('PRACTICAL_ALREADY_CONFIRMED', 409);
      await database
        .query()
        .updateTable('practicalAssessments')
        .set({
          reviewStatus: 'confirmed',
          confirmedBy: actor.userId,
          confirmedAt: new Date(),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      return templateRow(id);
    },

    /** examiner.draftPracticalChecklist: a draft form from a work instruction, each item with its excerpt. */
    async draftChecklist(
      run: AutomationRunContext | null,
      input: { documentId: string; competencyIds: string[]; ownerUserId: string },
    ) {
      const doc = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id', 'title', 'docNo', 'version', 'contentText'])
        .where('id', '=', input.documentId)
        .executeTakeFirst();
      if (!doc) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const text = str(doc.contentText ?? '');
      run?.summarize(`起草实操考核表：${str(doc.docNo ?? '')} ${str(doc.title ?? '')}`.trim());
      run?.reference({ documentId: input.documentId });
      let drafted: z.infer<typeof draftChecklistSchema> | null = null;
      try {
        const { data, sessionId } = await deps.ai.structured({
          employee: 'examiner',
          userId: run?.owner.userId ?? input.ownerUserId,
          title: `起草实操考核表 ${str(doc.title)}`,
          prompt: `从作业文件起草实操考核表：6–10 个可现场观察的检查项，涉及安全和质量判定的标为关键项，每项附引用的原文（sourceExcerpt 必须逐字出自原文）。
文件：${str(doc.docNo ?? '')} ${str(doc.title)} ${str(doc.version ?? '')}
原文：
${text.slice(0, 12_000)}`,
          schema: draftChecklistSchema,
          timeZone: platform.timeZone,
        });
        run?.usedConversation(sessionId);
        // Excerpts that are not in the document are dropped rather than trusted.
        drafted = {
          ...data,
          checklist: data.checklist.map((c) => ({
            ...c,
            sourceExcerpt: text.includes(c.sourceExcerpt) ? c.sourceExcerpt : '',
          })),
        };
      } catch (error) {
        if (!(error instanceof AIUnavailableError)) throw error;
        run?.markFallback();
      }
      if (!drafted) {
        // Rule fallback: every list item and sentence of the procedure sections is a check item.
        // The section and critical words are settings (practicalSectionKeywords / practicalCriticalKeywords).
        const { practicalSectionKeywords, practicalCriticalKeywords } = await ctx.settings();
        const mentions = (value: string, words: readonly string[]) =>
          words.some((word) => value.includes(word));
        const items: { item: string; critical: boolean; sourceExcerpt: string }[] = [];
        for (const section of splitSections(text)) {
          if (
            !/^\s*[4-5]/u.test(section.title) &&
            !mentions(section.title, practicalSectionKeywords)
          )
            continue;
          for (const line of section.text.split(/\n+/u)) {
            const clean = line.replace(/^[-*\d.\s]+/u, '').trim();
            if (clean.length < 8) continue;
            items.push({
              item: clean.slice(0, 120),
              critical: mentions(clean, practicalCriticalKeywords),
              sourceExcerpt: line.trim(),
            });
            if (items.length >= 10) break;
          }
          if (items.length >= 10) break;
        }
        drafted = {
          title: `${str(doc.title)}实操考评`,
          checklist: items.length
            ? items
            : [{ item: '按作业文件完成操作', critical: true, sourceExcerpt: '' }],
        };
      }
      const settings = await ctx.settings();
      const id = newId();
      const now = new Date();
      await database
        .query()
        .insertInto('practicalAssessments')
        .values({
          id,
          title: drafted.title.slice(0, 200),
          competencyIds: input.competencyIds,
          checklist: drafted.checklist.map((c, index) => ({
            key: `item${index + 1}`,
            item: c.item,
            critical: c.critical,
            sourceExcerpt: c.sourceExcerpt || null,
          })),
          passRule: settings.practicalPassRule,
          sourceDocumentId: input.documentId,
          requiresWitness: false,
          reviewStatus: 'draft',
          source: 'ai',
          active: true,
          ownerUserId: input.ownerUserId,
          confirmedBy: null,
          confirmedAt: null,
          customFields: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      await run?.recordItems('practicalAssessment', [{ id, hash: null }]);
      return { output: { assessmentId: id } };
    },

    // ---------- 考核记录 ----------
    async listRecords(
      actor: ActorContext,
      filters: { employeeId?: string; assessmentId?: string },
    ) {
      const actions = ['view', 'conduct', 'witness'] as const;
      const seen = new Map<string, Record<string, unknown>>();
      let allowed = false;
      for (const action of actions) {
        const policies = await authorizeAction(actor.authz, RESOURCE, action).catch(
          () => undefined,
        );
        if (!policies) continue;
        allowed = true;
        for (const row of (await database
          .repository('practicalRecords')
          .withPolicy(policyOf(policies, 'practicalRecords'))
          // An empty filter object is rejected ("Filter shorthand must not be empty").
          .findMany(
            filters.employeeId || filters.assessmentId
              ? {
                  filter: {
                    ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
                    ...(filters.assessmentId ? { assessmentId: filters.assessmentId } : {}),
                  },
                }
              : {},
          )) as Record<string, unknown>[])
          seen.set(str(row.id), row);
      }
      if (!allowed) throw new HrError('FORBIDDEN', 403);
      const employees = await ctx.employees();
      const templates = new Map(
        (
          await database
            .query()
            .selectFrom('practicalAssessments')
            .select(['id', 'title'])
            .execute()
        ).map((t) => [str(t.id), str(t.title)]),
      );
      const out = [];
      for (const row of seen.values()) {
        const record = toRecord(await recordRow(str(row.id)).then((r) => r as never));
        out.push({
          id: record.id,
          assessmentTitle: templates.get(record.assessmentId) ?? '',
          employeeName: employees.get(record.employeeId)?.name ?? '',
          assessorName: await ctx.userName(record.assessorUserId),
          witnessName: record.witnessUserId ? await ctx.userName(record.witnessUserId) : null,
          conductedAt: record.conductedAt,
          status: record.status,
          passed: record.status === 'draft' ? null : record.passed,
          waitingForMe:
            record.status === 'signed' && record.witnessUserId === actor.userId,
        });
      }
      return out.sort((a, b) => (b.conductedAt ?? '').localeCompare(a.conductedAt ?? ''));
    },

    async getRecord(actor: ActorContext, id: string) {
      for (const action of ['view', 'conduct', 'witness'] as const) {
        try {
          return await recordView(actor, await visibleRecord(actor, action, id));
        } catch (error) {
          if (!(error instanceof HrError)) throw error;
        }
      }
      throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
    },

    /** 开始考核: the caller is the assessor (talent.practical.conduct). */
    async start(actor: ActorContext, input: unknown) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'conduct');
      const parsed = startInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const template = await templateRow(parsed.data.assessmentId);
      if (template.reviewStatus !== 'confirmed')
        throw new HrError('PRACTICAL_ASSESSMENT_NOT_CONFIRMED', 409);
      if (!template.active) throw new HrError('PRACTICAL_ASSESSMENT_INACTIVE', 409);
      const employee = await ctx.employee(parsed.data.employeeId);
      if (employee.status === 'leave') throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      if (employee.userId === actor.userId)
        throw new HrError('PRACTICAL_SELF_ASSESSMENT', 403);
      const witness = parsed.data.witnessUserId ?? null;
      if (witness) {
        if (witness === actor.userId || witness === employee.userId)
          throw new HrError('PRACTICAL_WITNESS_INVALID', 400);
        if (!(await ctx.userName(witness)))
          throw new HrError('PRACTICAL_WITNESS_INVALID', 400);
      }
      if (template.requiresWitness && !witness)
        throw new HrError('PRACTICAL_WITNESS_REQUIRED', 400);
      const id = newId();
      const now = new Date();
      const conductedAt = parsed.data.conductedAt
        ? new Date(parsed.data.conductedAt)
        : now;
      if (Number.isNaN(conductedAt.getTime()))
        throw new HrError('INVALID_INPUT', 400);
      await database
        .repository('practicalRecords')
        .withPolicy(policyOf(policies, 'practicalRecords'))
        .createOne({
          values: {
            id,
            assessmentId: template.id,
            employeeId: employee.id,
            assessorUserId: actor.userId,
            witnessUserId: witness,
            conductedAt,
            location: parsed.data.location ?? null,
            observationNotes: null,
            aiStructured: null,
            results: [],
            passed: false,
            attachments: [],
            signedAt: null,
            witnessSignedAt: null,
            status: 'draft',
            voidReason: null,
            voidedBy: null,
            voidedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      return recordView(actor, await recordRow(id));
    },

    async update(actor: ActorContext, id: string, input: unknown) {
      const record = await visibleRecord(actor, 'conduct', id);
      if (record.status !== 'draft') throw new HrError('PRACTICAL_RECORD_SIGNED', 409);
      if (record.assessorUserId !== actor.userId)
        throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
      const parsed = recordInput.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const template = await templateRow(record.assessmentId);
      const keys = new Set(template.checklist.map((c) => c.key));
      if (parsed.data.results?.some((r) => !keys.has(r.key)))
        throw new HrError('PRACTICAL_RESULT_UNKNOWN_ITEM', 400);
      // S5: photos are added only through POST /records/:id/attachments, which stores them for
      // this record; an edit may keep or remove them, never name another file.
      if (
        parsed.data.attachments?.some(
          (fileId) => !record.attachments.includes(fileId),
        )
      )
        throw new HrError('PRACTICAL_ATTACHMENT_INVALID', 400);
      if (parsed.data.witnessUserId) {
        const employee = await ctx.employee(record.employeeId);
        if (
          parsed.data.witnessUserId === actor.userId ||
          parsed.data.witnessUserId === employee.userId
        )
          throw new HrError('PRACTICAL_WITNESS_INVALID', 400);
      }
      await database
        .query()
        .updateTable('practicalRecords')
        .set({
          ...(parsed.data.observationNotes !== undefined
            ? { observationNotes: parsed.data.observationNotes }
            : {}),
          ...(parsed.data.location !== undefined ? { location: parsed.data.location } : {}),
          ...(parsed.data.witnessUserId !== undefined
            ? { witnessUserId: parsed.data.witnessUserId }
            : {}),
          ...(parsed.data.results ? { results: parsed.data.results } : {}),
          ...(parsed.data.attachments ? { attachments: parsed.data.attachments } : {}),
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .execute();
      return recordView(actor, await recordRow(id));
    },

    /** Authorizes 让考官整理 and answers whether the notes changed since the last structuring. */
    async prepareStructure(actor: ActorContext, id: string) {
      const record = await visibleRecord(actor, 'conduct', id);
      if (record.status !== 'draft') throw new HrError('PRACTICAL_RECORD_SIGNED', 409);
      if (record.assessorUserId !== actor.userId)
        throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
      if (!record.observationNotes.trim())
        throw new HrError('PRACTICAL_NOTES_REQUIRED', 400);
      const notesHash = hashOf(record.observationNotes);
      return { record, notesHash, unchanged: record.aiStructured?.notesHash === notesHash };
    },

    /** examiner.structureObservation (the work; trusted, the caller was authorized by prepareStructure). */
    async structure(run: AutomationRunContext | null, id: string) {
      const record = await recordRow(id);
      const template = await templateRow(record.assessmentId);
      const notesHash = hashOf(record.observationNotes);
      if (record.aiStructured?.notesHash === notesHash)
        return { status: 'skipped' as const, output: { recordId: id, reason: 'unchanged' } };
      run?.summarize(`实操考核辅助记录：记录 ${id}`);
      run?.reference({ recordId: id, items: template.checklist.length });
      const rule = structureByRule(template.checklist, record.observationNotes);
      const answer = await structuredCall(
        run,
        '实操考核辅助记录',
        `把考评员的现场记录逐条对应到实操考核表的检查项。每项给出建议结果（pass / fail / notRecorded）并引用原始记录（quotes 必须逐字出自记录）。没有对应记录的检查项一律为 notRecorded，不得建议为 pass。你只整理记录，不判定考核是否通过。
检查项：${JSON.stringify(template.checklist.map((c) => ({ key: c.key, item: c.item })))}
现场记录：
${record.observationNotes.slice(0, 8000)}`,
        record.assessorUserId,
      );
      const items = template.checklist.map((c) => {
        const suggested = answer?.items.find((i) => i.key === c.key);
        const fallback = rule.find((r) => r.key === c.key)!;
        if (!suggested) return fallback;
        const quotes = suggested.quotes.filter((q) => record.observationNotes.includes(q));
        // No quoted note, no suggestion: an unrecorded item is never suggested as passed.
        if (!quotes.length) return { key: c.key, suggestion: 'notRecorded' as const, quotes: [] };
        return { key: c.key, suggestion: suggested.suggestion, quotes };
      });
      const structured: Structured = {
        items,
        notesHash,
        source: answer ? 'ai' : 'rule',
        generatedAt: new Date().toISOString(),
      };
      await database
        .query()
        .updateTable('practicalRecords')
        .set({ aiStructured: structured, updatedAt: new Date() })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .execute();
      return { output: { recordId: id, source: structured.source } };
    },

    async view(actor: ActorContext, id: string) {
      return service.getRecord(actor, id);
    },

    /** 考评员签字: every item confirmed; `passed` from the pass rule; completes without a witness. */
    async sign(actor: ActorContext, id: string) {
      const record = await visibleRecord(actor, 'conduct', id);
      if (record.assessorUserId !== actor.userId)
        throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
      if (record.status !== 'draft') throw new HrError('PRACTICAL_RECORD_SIGNED', 409);
      const template = await templateRow(record.assessmentId);
      const keys = new Set(record.results.map((r) => r.key));
      if (template.checklist.some((c) => !keys.has(c.key)))
        throw new HrError('PRACTICAL_RESULTS_INCOMPLETE', 409);
      if (template.requiresWitness && !record.witnessUserId)
        throw new HrError('PRACTICAL_WITNESS_REQUIRED', 400);
      const passed = computePassed(template.checklist, record.results, template.passRule);
      const status = record.witnessUserId ? 'signed' : 'completed';
      const now = new Date();
      await database
        .query()
        .updateTable('practicalRecords')
        .set({ passed, status, signedAt: now, updatedAt: now })
        .where('id', '=', id)
        .where('status', '=', 'draft')
        .execute();
      if (record.witnessUserId) {
        const employee = await ctx.employee(record.employeeId);
        await platform.notify({
          key: `practical:${id}:witness`,
          userIds: [record.witnessUserId],
          message: 'practicalWitness',
          params: { title: template.title, name: employee.name },
          path: `/talent/practicals/records/${id}`,
        });
      }
      if (status === 'completed') deps.onCompleted(record.employeeId);
      return recordView(actor, await recordRow(id));
    },

    /** 见证人签字, in the witness's own account (record-level grant). */
    async witnessSign(actor: ActorContext, id: string) {
      const record = await visibleRecord(actor, 'witness', id);
      if (record.witnessUserId !== actor.userId)
        throw new HrError('PRACTICAL_RECORD_NOT_FOUND', 404);
      if (record.status !== 'signed') throw new HrError('PRACTICAL_NOT_AWAITING_WITNESS', 409);
      const now = new Date();
      await database
        .query()
        .updateTable('practicalRecords')
        .set({ status: 'completed', witnessSignedAt: now, updatedAt: now })
        .where('id', '=', id)
        .where('status', '=', 'signed')
        .execute();
      await ctx.closeWorkItems(`practical:${id}:witness`);
      deps.onCompleted(record.employeeId);
      return recordView(actor, await recordRow(id));
    },

    /** 作废 (hr.admin), with a reason; the record stays for the audit trail. */
    async void(actor: ActorContext, id: string, input: unknown) {
      const record = await visibleRecord(actor, 'void', id);
      const reason =
        input && typeof input === 'object' && typeof (input as { reason?: unknown }).reason === 'string'
          ? (input as { reason: string }).reason.trim()
          : '';
      if (!reason || reason.length > 500) throw new HrError('PRACTICAL_VOID_REASON_REQUIRED', 400);
      if (record.status === 'voided') throw new HrError('PRACTICAL_RECORD_VOIDED', 409);
      const now = new Date();
      await database
        .query()
        .updateTable('practicalRecords')
        .set({
          status: 'voided',
          voidReason: reason,
          voidedBy: actor.userId,
          voidedAt: now,
          updatedAt: now,
        })
        .where('id', '=', id)
        .execute();
      return recordView(actor, await recordRow(id));
    },

    /**
     * For V4-14 and the certification gate: the latest passed, completed
     * (signed, witnessed where required), not voided record of an assessment
     * conducted within `validMonths` of `asOf`.
     */
    async validPractical(
      employeeId: string,
      assessmentId: string,
      validMonths: number,
      asOf: string = ctx.today(),
    ): Promise<{ recordId: string; conductedAt: string } | null> {
      const from = new Date(`${asOf}T00:00:00Z`);
      from.setUTCMonth(from.getUTCMonth() - validMonths);
      const rows = await database
        .query()
        .selectFrom('practicalRecords')
        .select(['id', 'conductedAt'])
        .where('employeeId', '=', employeeId)
        .where('assessmentId', '=', assessmentId)
        .where('status', '=', 'completed')
        .where('passed', '=', true)
        .where('conductedAt', '>=', from)
        .orderBy('conductedAt', 'desc')
        .execute();
      const row = rows[0];
      return row ? { recordId: str(row.id), conductedAt: iso(row.conductedAt)! } : null;
    },

    /**
     * 发证条件 (the certification service asks before issuing or renewing):
     * with practicals linked and required for this kind of issue, every one of
     * them needs a valid record. `recert` is an issue with a previous,
     * unrevoked certificate of the same certification.
     */
    async practicalGate(
      employeeId: string,
      certificationId: string,
      mode: 'initial' | 'recert',
    ): Promise<{ ok: boolean; recordIds: string[]; missing: string[] }> {
      const certification = await database
        .query()
        .selectFrom('certifications')
        .select(['practicalRequiredFor', 'practicalValidMonths'])
        .where('id', '=', certificationId)
        .executeTakeFirst();
      if (!certification) return { ok: true, recordIds: [], missing: [] };
      const requiredFor = str(certification.practicalRequiredFor ?? 'both');
      if (requiredFor !== 'both' && requiredFor !== mode)
        return { ok: true, recordIds: [], missing: [] };
      const links = await database
        .query()
        .selectFrom('certificationPracticals')
        .select(['assessmentId'])
        .where('certificationId', '=', certificationId)
        .execute();
      const months = Number(certification.practicalValidMonths ?? 12) || 12;
      const recordIds: string[] = [];
      const missing: string[] = [];
      for (const link of links) {
        const valid = await service.validPractical(employeeId, str(link.assessmentId), months);
        if (valid) recordIds.push(valid.recordId);
        else missing.push(str(link.assessmentId));
      }
      return { ok: !missing.length, recordIds, missing };
    },

    /** 认证项目 · 实操要求 (hr.admin through talent.certification.manage; the route authorizes). */
    async certificationPracticals(certificationId: string) {
      const certification = await database
        .query()
        .selectFrom('certifications')
        .select(['id', 'practicalRequiredFor', 'practicalValidMonths'])
        .where('id', '=', certificationId)
        .executeTakeFirst();
      if (!certification) throw new HrError('CERTIFICATION_NOT_FOUND', 404);
      const links = await database
        .query()
        .selectFrom('certificationPracticals')
        .select(['assessmentId'])
        .where('certificationId', '=', certificationId)
        .execute();
      return {
        certificationId,
        practicalRequiredFor: str(certification.practicalRequiredFor ?? 'both'),
        practicalValidMonths: Number(certification.practicalValidMonths ?? 12),
        assessmentIds: links.map((l) => str(l.assessmentId)),
      };
    },

    async setCertificationPracticals(certificationId: string, input: unknown) {
      const parsed = z
        .object({
          assessmentIds: z.array(z.string().min(1).max(64)).max(10),
          practicalRequiredFor: z.enum(['initial', 'recert', 'both']),
          practicalValidMonths: z.number().int().min(1).max(120),
        })
        .strict()
        .safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      await service.certificationPracticals(certificationId);
      for (const id of parsed.data.assessmentIds) {
        const template = await templateRow(id);
        if (template.reviewStatus !== 'confirmed')
          throw new HrError('PRACTICAL_ASSESSMENT_NOT_CONFIRMED', 409);
      }
      const now = new Date();
      await database.transaction(async (connection) => {
        await connection.query
          .deleteFrom('certificationPracticals')
          .where('certificationId', '=', certificationId)
          .execute();
        for (const assessmentId of parsed.data.assessmentIds)
          await connection.query
            .insertInto('certificationPracticals')
            .values({
              id: newId(),
              certificationId,
              assessmentId,
              createdAt: now,
              updatedAt: now,
            })
            .execute();
        await connection.query
          .updateTable('certifications')
          .set({
            practicalRequiredFor: parsed.data.practicalRequiredFor,
            practicalValidMonths: parsed.data.practicalValidMonths,
            updatedAt: now,
          })
          .where('id', '=', certificationId)
          .execute();
      });
      return service.certificationPracticals(certificationId);
    },

    async addAttachment(actor: ActorContext, id: string, fileId: string) {
      const record = await visibleRecord(actor, 'conduct', id);
      if (record.status !== 'draft' || record.assessorUserId !== actor.userId)
        throw new HrError('PRACTICAL_RECORD_SIGNED', 409);
      await database
        .query()
        .updateTable('practicalRecords')
        .set({ attachments: [...record.attachments, fileId].slice(0, 30), updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return recordView(actor, await recordRow(id));
    },

    /** 选择被考核人: the employees the conduct action reaches (never oneself). */
    async assessableEmployees(actor: ActorContext) {
      const policies = await authorizeAction(actor.authz, RESOURCE, 'conduct');
      const rows = (await database
        .repository('employees')
        .withPolicy(policyOf(policies, 'employees'))
        .findMany({})) as Record<string, unknown>[];
      const titles = await ctx.departmentTitles();
      return rows
        .filter((r) => str(r.userId ?? '') !== actor.userId && r.status !== 'leave')
        .map((r) => ({
          id: str(r.id),
          name: str(r.name),
          departmentTitle: titles.get(str(r.departmentId)) ?? '',
        }))
        .sort((a, b) => a.departmentTitle.localeCompare(b.departmentTitle) || a.name.localeCompare(b.name));
    },

    /** The people who may witness: active employees with an account (names only). */
    async witnessOptions(actor: ActorContext) {
      await authorizeAction(actor.authz, RESOURCE, 'conduct');
      return [...(await ctx.employees()).values()]
        .filter((e) => e.userId && e.status !== 'leave' && e.userId !== actor.userId)
        .map((e) => ({ userId: e.userId!, name: e.name }));
    },
  };
  return service;
}

export type PracticalService = ReturnType<typeof createPracticalService>;
