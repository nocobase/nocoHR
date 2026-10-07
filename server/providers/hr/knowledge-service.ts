/**
 * The knowledge base: documents with their visibility scope and competency
 * tags, background text extraction, retrieval for the knowledge assistant, and
 * the knowledge gaps it records.
 *
 * Retrieval is the application's own keyword search over the sections of the
 * documents the caller may read. The visibility rule is a record access the
 * authorization service evaluates on the server, so the scope is never taken
 * from the model or the page. A database full-text index was not chosen
 * because the dialects differ and SQLite's tokenizer does not split Chinese;
 * vector search would need an embedding service the application does not
 * configure. The document set is small, so ranking in memory after the
 * authorized query is fast enough.
 */
import type { DatabaseManager, RepositoryRecord } from '@nocobase/db';
import type { NocoBaseDriveManager } from '@nocobase/drive';

import { authorizeAction, policyOf, tryAuthorizeAction } from './authorize.js';
import { diffSections, type SectionChange } from './document-changes.js';
import {
  documentKind,
  extractDocumentText,
  rankPassages,
  splitSections,
  type DocumentSection,
} from './document-text.js';
import type { ActorContext } from './framework-service.js';
import { assertUsableHrFile } from './hr-files.js';
import { bool, json, type Platform } from './platform.js';
import {
  HrError,
  isRecord,
  newId,
  optionalDate,
  requireEnum,
  requireString,
  str,
} from './shared.js';

export const DOCUMENT_CATEGORIES = [
  'policy',
  'sop',
  'manual',
  'other',
] as const;
export const DOCUMENT_VISIBILITIES = ['all', 'restricted'] as const;
const DOCUMENT = 'talent.kbDocument';
const GAP = 'talent.knowledgeGap';
const ASSISTANT = 'talent.knowledgeAssistant';
const CONFLICT = 'talent.documentConflict';
/** Review dates within this many days are reminded; past ones are reminded at most once in 7 days. */
const REVIEW_NOTICE_DAYS = 30;
const REVIEW_REMINDER_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export interface KbDocumentSummary {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly fileId: string;
  readonly parseStatus: string;
  readonly parseError: string | null;
  readonly visibility: string;
  readonly ownerUserId: string;
  readonly ownerName: string | null;
  readonly reviewDate: string | null;
  readonly autoDraftCourse: boolean;
  readonly active: boolean;
  readonly competencies: readonly { id: string; title: string }[];
  readonly departments: readonly { id: string; title: string }[];
  readonly positions: readonly { id: string; title: string }[];
  readonly updatedAt: string;
  readonly canManage: boolean;
  /** V2 step 6: the document number and version; a superseded version no longer answers questions. */
  readonly docNo: string | null;
  readonly version: string | null;
  readonly effectiveDate: string | null;
  readonly previousVersionId: string | null;
  readonly supersededById: string | null;
  readonly supersededByVersion: string | null;
  readonly lastReviewedAt: string | null;
}

export interface KbDocumentDetail extends KbDocumentSummary {
  readonly sections: readonly DocumentSection[];
  /** Every version with the same document number, newest first. */
  readonly versions: readonly {
    id: string;
    version: string | null;
    effectiveDate: string | null;
    parseStatus: string;
    superseded: boolean;
  }[];
  /** Section changes against the previous version, computed when this version was extracted. */
  readonly changeSummary: readonly SectionChange[] | null;
  readonly changeNote: string | null;
  readonly can: {
    uploadVersion: boolean;
    markReviewed: boolean;
    rerunRevision: boolean;
  };
  /** Courses written from this document, including drafts the content writer produced; for people who may see courses. */
  readonly courses: readonly {
    id: string;
    title: string;
    source: string;
    reviewStatus: string;
    published: boolean;
  }[];
  readonly file: {
    id: string;
    filename: string;
    ext: string;
    mimeType: string;
    size: number;
  } | null;
}

export interface KnowledgePassage {
  /** V1-04: open conflicts this section is part of — both sayings are to be shown. */
  readonly conflicts?: readonly {
    readonly otherDocumentTitle: string;
    readonly otherSectionTitle: string;
    readonly otherExcerpt: string | null;
  }[];
  readonly documentId: string;
  readonly documentTitle: string;
  readonly sectionIndex: number;
  readonly sectionTitle: string;
  readonly excerpt: string;
  /** The application path that opens the document at the section. */
  readonly path: string;
  /** The same location with the deployment base path, for links written into an answer. */
  readonly href: string;
  readonly citation: string;
  /** How well the passage matches the query; higher is closer. */
  readonly score: number;
}

export interface KnowledgeGap {
  readonly id: string;
  readonly question: string;
  /** The asker's department only: the gap list does not name who asked (V1-04). */
  readonly askedByName: string | null;
  readonly channel: string;
  readonly askCount: number;
  readonly askedAt: string;
  readonly lastAskedAt: string;
  readonly relatedDocumentId: string | null;
  readonly relatedDocumentTitle: string | null;
  /** The topic the knowledge assistant's weekly report grouped this question under. */
  readonly topic: string | null;
  readonly reportedAt: string | null;
  readonly status: string;
  readonly resolvedDocumentId: string | null;
  readonly resolvedDocumentTitle: string | null;
}

export interface KnowledgeService {
  listDocuments(
    ctx: ActorContext,
    filters: {
      q?: string;
      category?: string;
      competencyId?: string;
      parseStatus?: string;
    },
  ): Promise<{
    items: KbDocumentSummary[];
    canCreate: boolean;
    canViewGaps: boolean;
  }>;
  getDocument(
    ctx: ActorContext,
    id: string,
  ): Promise<KbDocumentDetail | undefined>;
  createDocument(ctx: ActorContext, input: unknown): Promise<KbDocumentSummary>;
  updateDocument(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<KbDocumentSummary>;
  setDocumentActive(
    ctx: ActorContext,
    id: string,
    active: boolean,
  ): Promise<KbDocumentSummary>;
  retryParse(ctx: ActorContext, id: string): Promise<KbDocumentSummary>;
  /** Extracts a document's text; used after upload, on retry and by the minute job. */
  parseDocument(id: string): Promise<'ready' | 'failed' | 'skipped'>;
  parsePending(olderThanMs: number): Promise<number>;
  /** The file behind a document, when the caller may read the document. */
  documentFile(
    ctx: ActorContext,
    id: string,
  ): Promise<
    | { disk: string; key: string; filename: string; mimeType: string }
    | undefined
  >;
  search(
    ctx: ActorContext,
    query: string,
    limit?: number,
  ): Promise<KnowledgePassage[]>;
  /** The sections of a readable, active and parsed document, for the content writer. */
  readDocument(
    ctx: ActorContext,
    id: string,
  ): Promise<{
    id: string;
    title: string;
    sections: readonly DocumentSection[];
  }>;
  /** One row per question asked; the weekly report groups questions with the same meaning into topics. */
  recordGap(
    ctx: ActorContext,
    question: string,
    relatedDocumentId?: string | null,
    channel?: 'app' | 'feishu' | 'dingtalk' | 'wecom',
  ): Promise<{ id: string }>;
  listGaps(ctx: ActorContext, status?: string): Promise<KnowledgeGap[]>;
  resolveGap(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<KnowledgeGap>;
  /** Document ids the caller may read; published courses follow the visibility of their source document. */
  visibleDocumentIds(ctx: ActorContext): Promise<Set<string>>;
  /** A new version of a document: it inherits the tags, visibility and owner; the old one is superseded once extracted. */
  uploadVersion(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<KbDocumentSummary>;
  /** Reviewed without changes: the next review date moves 12 months on, or to the given date. */
  markReviewed(
    ctx: ActorContext,
    id: string,
    input: unknown,
  ): Promise<KbDocumentSummary>;
  /** The content writer's (draft) explanation of a version's changes; the instructor may edit it. */
  setChangeNote(
    ctx: ActorContext,
    id: string,
    note: string | null,
  ): Promise<void>;
  listConflicts(
    ctx: ActorContext,
    status?: string,
  ): Promise<DocumentConflictView[]>;
  handleConflict(
    ctx: ActorContext,
    id: string,
    status: 'resolved' | 'ignored',
    note?: string | null,
  ): Promise<DocumentConflictView>;
  /** Records a conflict once per pair of sections; answers whether it was new. */
  recordConflict(input: {
    documentId: string;
    sectionTitle: string;
    otherDocumentId: string;
    otherSectionTitle: string;
    description: string;
    excerpt: string | null;
    otherExcerpt: string | null;
    source?: 'ai' | 'manual';
  }): Promise<{ id: string; created: boolean }>;
  /** Daily: review dates due within 30 days, and overdue ones (at most once in 7 days per document). */
  runReviewReminders(): Promise<{ upcoming: number; overdue: number }>;
}

export interface DocumentConflictView {
  readonly id: string;
  readonly documentId: string;
  readonly documentTitle: string;
  readonly sectionTitle: string;
  readonly otherDocumentId: string;
  readonly otherDocumentTitle: string;
  readonly otherSectionTitle: string;
  readonly description: string;
  readonly excerpt: string | null;
  readonly otherExcerpt: string | null;
  readonly status: string;
  readonly handledByName: string | null;
  readonly createdAt: string;
  readonly can: { resolve: boolean; ignore: boolean };
}

export interface KnowledgeServiceDeps {
  readonly platform: Platform;
  /** V1-04: review notice days, overdue interval and default cycle (人事设置 · 制度复核). */
  readonly reviewConfig?: () => Promise<{
    reviewNoticeDays: number;
    overdueIntervalDays: number;
    defaultReviewMonths: number;
  }>;
  /** V1-04 知识范围: the documents an AI employee may search (by number or category); empty is no limit. */
  readonly knowledgeScope?: (employee: string) => Promise<{
    docNos: readonly string[];
    categories: readonly string[];
  }>;
  readonly drive: () => NocoBaseDriveManager;
  readonly departmentTitle: (id: string) => Promise<string>;
  /** The public base path, such as `/main`, for links the assistant writes. */
  readonly basePath: () => string;
  /**
   * Called once a document's text is extracted. A new version has already
   * superseded the previous one and carries its change list; the content
   * writer revises, the knowledge assistant checks for conflicts.
   */
  readonly onDocumentParsed?: () =>
    | ((
        documentId: string,
        details: { newVersion: boolean; autoDraftCourse: boolean },
      ) => void)
    | undefined;
}

const DOCUMENT_COLUMNS = [
  'id',
  'title',
  'category',
  'fileId',
  'contentText',
  'parseStatus',
  'parseError',
  'visibility',
  'ownerUserId',
  'reviewDate',
  'autoDraftCourse',
  'active',
  'docNo',
  'version',
  'previousVersionId',
  'supersededById',
  'effectiveDate',
  'changeSummary',
  'changeNote',
  'lastReviewedAt',
  'createdAt',
  'updatedAt',
] as const;

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return value ? new Date(str(value)).toISOString() : '';
}
function dateOnly(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : str(value).slice(0, 10);
}
function stringList(value: unknown, code: string): string[] {
  if (value === undefined || value === null) return [];
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.length > 64)
  )
    throw new HrError(code, 400);
  return [...new Set(value as string[])];
}

export function createKnowledgeService(
  deps: KnowledgeServiceDeps,
): KnowledgeService {
  const { platform, drive, departmentTitle } = deps;
  const withBase = (path: string) =>
    `${deps.basePath().replace(/\/+$/u, '')}${path}`;
  const { database } = platform;

  async function titlesOf(
    table: 'competencies' | 'positions',
    ids: readonly string[],
  ): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const rows = await database
      .query()
      .selectFrom(table)
      .select(['id', 'title'])
      .where('id', 'in', [...ids])
      .execute();
    return new Map(rows.map((row) => [String(row.id), String(row.title)]));
  }

  async function linksOf(documentIds: readonly string[]) {
    const empty = {
      competencies: new Map<string, string[]>(),
      departments: new Map<string, string[]>(),
      positions: new Map<string, string[]>(),
    };
    if (!documentIds.length) return empty;
    const query = database.query();
    const collect = async (
      table: string,
      column: string,
      target: Map<string, string[]>,
    ) => {
      const rows = await query
        .selectFrom(table)
        .select(['documentId', column])
        .where('documentId', 'in', [...documentIds])
        .execute();
      for (const row of rows) {
        const list = target.get(String(row.documentId)) ?? [];
        list.push(String(row[column]));
        target.set(String(row.documentId), list);
      }
    };
    await collect('kbDocumentCompetencies', 'competencyId', empty.competencies);
    await collect('kbDocumentDepartments', 'departmentId', empty.departments);
    await collect('kbDocumentPositions', 'positionId', empty.positions);
    return empty;
  }

  async function manageableIds(
    ctx: ActorContext,
    ids: readonly string[],
  ): Promise<Set<string>> {
    const policies = await tryAuthorizeAction(ctx.authz, DOCUMENT, 'manage');
    if (!policies || !ids.length) return new Set();
    const rows = await database
      .repository('kbDocuments')
      .withPolicy(policyOf(policies, 'kbDocuments'))
      .findMany({
        filter: (f) => f.or(ids.map((id) => f.string('id').eq(id))),
      });
    return new Set(
      rows.map((row) => String((row as Record<string, unknown>).id)),
    );
  }

  async function toSummaries(
    ctx: ActorContext,
    rows: readonly Record<string, unknown>[],
  ): Promise<KbDocumentSummary[]> {
    const ids = rows.map((row) => String(row.id));
    const links = await linksOf(ids);
    const competencyTitles = await titlesOf('competencies', [
      ...new Set([...links.competencies.values()].flat()),
    ]);
    const positionTitles = await titlesOf('positions', [
      ...new Set([...links.positions.values()].flat()),
    ]);
    const manageable = await manageableIds(ctx, ids);
    const successors = rows
      .map((row) => row.supersededById)
      .filter(Boolean)
      .map(String);
    const versionOf = new Map(
      successors.length
        ? (
            await database
              .query()
              .selectFrom('kbDocuments')
              .select(['id', 'version'])
              .where('id', 'in', successors)
              .execute()
          ).map((r) => [str(r.id), r.version == null ? '' : str(r.version)])
        : [],
    );
    const result: KbDocumentSummary[] = [];
    for (const row of rows) {
      const id = String(row.id);
      const departments = [];
      for (const departmentId of links.departments.get(id) ?? [])
        departments.push({
          id: departmentId,
          title: await departmentTitle(departmentId),
        });
      result.push({
        id,
        title: String(row.title),
        category: String(row.category),
        fileId: String(row.fileId),
        parseStatus: String(row.parseStatus),
        parseError: row.parseError == null ? null : str(row.parseError),
        visibility: String(row.visibility),
        ownerUserId: String(row.ownerUserId),
        ownerName: await platform.userName(String(row.ownerUserId)),
        reviewDate: dateOnly(row.reviewDate),
        autoDraftCourse: bool(row.autoDraftCourse),
        active: bool(row.active),
        competencies: (links.competencies.get(id) ?? []).map((cid) => ({
          id: cid,
          title: competencyTitles.get(cid) ?? cid,
        })),
        departments,
        positions: (links.positions.get(id) ?? []).map((pid) => ({
          id: pid,
          title: positionTitles.get(pid) ?? pid,
        })),
        updatedAt: iso(row.updatedAt),
        canManage: manageable.has(id),
        docNo: row.docNo == null ? null : str(row.docNo),
        version: row.version == null ? null : str(row.version),
        effectiveDate: dateOnly(row.effectiveDate),
        previousVersionId:
          row.previousVersionId == null ? null : str(row.previousVersionId),
        supersededById:
          row.supersededById == null ? null : str(row.supersededById),
        supersededByVersion: row.supersededById
          ? (versionOf.get(str(row.supersededById)) ?? null)
          : null,
        lastReviewedAt: row.lastReviewedAt ? iso(row.lastReviewedAt) : null,
      });
    }
    return result;
  }

  interface DocumentInput {
    title: string;
    category: string;
    fileId: string | null;
    visibility: string;
    reviewDate: string | null;
    autoDraftCourse: boolean;
    competencyIds: string[];
    departmentIds: string[];
    positionIds: string[];
    docNo: string | null;
    version: string | null;
    effectiveDate: string | null;
  }

  function parseInput(
    input: unknown,
    partial: boolean,
  ): Partial<DocumentInput> {
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const values: Partial<DocumentInput> = {};
    if (!partial || input.title !== undefined)
      values.title = requireString(input.title, 'DOCUMENT_TITLE_REQUIRED', {
        max: 200,
      })!;
    if (!partial || input.category !== undefined)
      values.category = requireEnum(
        input.category,
        DOCUMENT_CATEGORIES,
        'DOCUMENT_CATEGORY_INVALID',
      );
    if (!partial || input.fileId !== undefined)
      values.fileId = requireString(input.fileId, 'DOCUMENT_FILE_REQUIRED', {
        max: 64,
      });
    if (!partial || input.visibility !== undefined)
      values.visibility = requireEnum(
        input.visibility ?? 'all',
        DOCUMENT_VISIBILITIES,
        'DOCUMENT_VISIBILITY_INVALID',
      );
    if (input.reviewDate !== undefined)
      values.reviewDate = optionalDate(input.reviewDate, 'INVALID_INPUT');
    if (input.autoDraftCourse !== undefined)
      values.autoDraftCourse = input.autoDraftCourse !== false;
    if (!partial || input.competencyIds !== undefined)
      values.competencyIds = stringList(input.competencyIds, 'INVALID_INPUT');
    if (!partial || input.departmentIds !== undefined)
      values.departmentIds = stringList(input.departmentIds, 'INVALID_INPUT');
    if (!partial || input.positionIds !== undefined)
      values.positionIds = stringList(input.positionIds, 'INVALID_INPUT');
    if (input.docNo !== undefined)
      values.docNo = requireString(input.docNo, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      });
    if (input.version !== undefined)
      values.version = requireString(input.version, 'INVALID_INPUT', {
        optional: true,
        max: 32,
      });
    if (input.effectiveDate !== undefined)
      values.effectiveDate = optionalDate(input.effectiveDate, 'INVALID_INPUT');
    return values;
  }

  async function assertReferences(
    values: Partial<DocumentInput>,
    ctx: ActorContext,
    currentFileId?: unknown,
  ): Promise<void> {
    const query = database.query();
    const check = async (
      table: string,
      ids: readonly string[] | undefined,
      code: string,
    ) => {
      if (!ids?.length) return;
      const rows = await query
        .selectFrom(table)
        .select(['id'])
        .where('id', 'in', [...ids])
        .execute();
      if (rows.length !== ids.length) throw new HrError(code, 404);
    };
    await check('competencies', values.competencyIds, 'COMPETENCY_NOT_FOUND');
    await check('departments', values.departmentIds, 'DEPARTMENT_NOT_FOUND');
    await check('positions', values.positionIds, 'POSITION_NOT_FOUND');
    if (values.fileId) {
      // S5: only a file the caller uploaded for the knowledge base, or the document's own file.
      await assertUsableHrFile(database, {
        fileId: values.fileId,
        userId: ctx.userId,
        purpose: 'kbDocument',
        referencedHere:
          currentFileId != null && str(currentFileId) === values.fileId,
        code: 'DOCUMENT_FILE_REQUIRED',
      });
      const file = await query
        .selectFrom('hrFiles')
        .select(['id', 'filename', 'mimeType'])
        .where('id', '=', values.fileId)
        .executeTakeFirst();
      if (!file) throw new HrError('DOCUMENT_FILE_REQUIRED', 404);
      if (!documentKind(String(file.filename), String(file.mimeType)))
        throw new HrError('DOCUMENT_TYPE_UNSUPPORTED', 400);
    }
  }

  async function loadRow(
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    return await database
      .query()
      .selectFrom('kbDocuments')
      .select([...DOCUMENT_COLUMNS])
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /** Starts extraction without holding the request; the minute job picks up anything left pending. */
  function scheduleParse(id: string): void {
    setImmediate(() => {
      void service.parseDocument(id).catch(() => undefined);
    });
  }

  const service: KnowledgeService = {
    async listDocuments(ctx, filters) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'view');
      const canCreate = await platform.can(ctx, DOCUMENT, 'manage');
      const q = filters.q?.trim();
      let rows = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findMany({
          filter: (f) =>
            f.and([
              ...(filters.category
                ? [f.string('category').eq(filters.category)]
                : []),
              ...(filters.parseStatus
                ? [f.string('parseStatus').eq(filters.parseStatus)]
                : []),
              ...(q
                ? [f.string('title').includes(q, { mode: 'insensitive' })]
                : []),
              ...(canCreate ? [] : [f.boolean('active').isTrue()]),
            ]),
          sort: (s) => [s.field('updatedAt').desc()],
        })) as Record<string, unknown>[];
      // V4-13: AI drafts wait in the 待审核 tab and translations in 译文审核.
      rows = rows.filter(
        (row) =>
          !row.translationOfId &&
          (row.reviewStatus ?? 'confirmed') !== 'draft',
      );
      if (filters.competencyId) {
        const tagged = await database
          .query()
          .selectFrom('kbDocumentCompetencies')
          .select(['documentId'])
          .where('competencyId', '=', filters.competencyId)
          .execute();
        const ids = new Set(tagged.map((row) => String(row.documentId)));
        rows = rows.filter((row) => ids.has(String(row.id)));
      }
      return {
        items: await toSummaries(ctx, rows),
        canCreate,
        canViewGaps: await platform.can(ctx, GAP, 'view'),
      };
    },

    async getDocument(ctx, id) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'view');
      const row = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      const [summary] = await toSummaries(ctx, [row]);
      if (!summary.active && !summary.canManage) return undefined;
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .select(['id', 'filename', 'ext', 'mimeType', 'size'])
        .where('id', '=', String(row.fileId))
        .executeTakeFirst();
      const courses = (await platform.can(ctx, 'talent.course', 'view'))
        ? await database
            .query()
            .selectFrom('courses')
            .select(['id', 'title', 'source', 'reviewStatus', 'published'])
            .where('sourceDocumentId', '=', id)
            .orderBy('createdAt', 'desc')
            .execute()
        : [];
      const chainKey = row.docNo ? str(row.docNo) : null;
      const chain = chainKey
        ? await database
            .query()
            .selectFrom('kbDocuments')
            .select([
              'id',
              'version',
              'effectiveDate',
              'parseStatus',
              'supersededById',
              'createdAt',
            ])
            .where('docNo', '=', chainKey)
            .orderBy('createdAt', 'desc')
            .execute()
        : [];
      const latest = !row.supersededById;
      return {
        ...summary,
        sections: splitSections(row.contentText as string | null),
        versions: chain.map((v) => ({
          id: str(v.id),
          version: v.version == null ? null : str(v.version),
          effectiveDate: dateOnly(v.effectiveDate),
          parseStatus: str(v.parseStatus),
          superseded: Boolean(v.supersededById),
        })),
        changeSummary: row.changeSummary
          ? json<SectionChange[]>(row.changeSummary, [])
          : null,
        changeNote: row.changeNote == null ? null : str(row.changeNote),
        can: {
          uploadVersion:
            latest && (await ownedOrScoped(ctx, 'uploadVersion', id)),
          markReviewed:
            latest && (await ownedOrScoped(ctx, 'markReviewed', id)),
          rerunRevision:
            Boolean(row.previousVersionId) &&
            row.parseStatus === 'ready' &&
            (await ownedOrScoped(ctx, 'uploadVersion', id)),
        },
        courses: courses.map((course) => ({
          id: str(course.id),
          title: str(course.title),
          source: str(course.source),
          reviewStatus: str(course.reviewStatus),
          published: bool(course.published),
        })),
        file: file
          ? {
              id: String(file.id),
              filename: String(file.filename),
              ext: String(file.ext),
              mimeType: String(file.mimeType),
              size: Number(file.size),
            }
          : null,
      };
    },

    async createDocument(ctx, input) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'manage');
      const values = parseInput(input, false) as DocumentInput;
      await assertReferences(values, ctx);
      // 版本规则: one enabled, current version per number; (docNo, version) unique.
      if (values.docNo) {
        const sameNo = await database
          .query()
          .selectFrom('kbDocuments')
          .select(['id', 'version', 'active', 'supersededById'])
          .where('docNo', '=', values.docNo)
          .execute();
        if (
          sameNo.some(
            (d) => values.version && str(d.version) === values.version,
          )
        )
          throw new HrError('DOCUMENT_VERSION_EXISTS', 409);
        if (sameNo.some((d) => bool(d.active) && !d.supersededById))
          throw new HrError('DOCUMENT_NO_ACTIVE_EXISTS', 409);
      }
      // An HR administrator may name another owner; everyone else owns what they upload.
      const requestedOwner =
        isRecord(input) && typeof input.ownerUserId === 'string'
          ? input.ownerUserId
          : null;
      const ownerUserId =
        requestedOwner &&
        requestedOwner !== ctx.userId &&
        (await ctx.authz.can({
          resource: { type: 'settings', id: 'talent.hr' },
          action: 'administer',
        })) &&
        (await platform.userName(requestedOwner))
          ? requestedOwner
          : ctx.userId;
      const id = newId();
      const stamp = new Date();
      await database.transaction(async (connection) => {
        await connection
          .repository('kbDocuments')
          .withPolicy(policyOf(policies, 'kbDocuments'))
          .createOne({
            values: {
              id,
              title: values.title,
              category: values.category,
              fileId: values.fileId,
              contentText: null,
              parseStatus: 'pending',
              parseError: null,
              visibility: values.visibility,
              ownerUserId,
              reviewDate: values.reviewDate ?? null,
              autoDraftCourse: values.autoDraftCourse ?? true,
              active: true,
              docNo: values.docNo ?? null,
              version: values.version ?? null,
              effectiveDate: values.effectiveDate ?? null,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        await writeLinks(connection, policies, id, values);
      });
      scheduleParse(id);
      const [summary] = await toSummaries(ctx, [(await loadRow(id))!]);
      return summary;
    },

    async updateDocument(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'manage');
      const values = parseInput(input, true);
      const repo = database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'));
      const current = (await repo.findOne({ filter: { id } })) as
        Record<string, unknown> | undefined;
      if (!current) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      await assertReferences(values, ctx, current.fileId);
      const fileChanged =
        values.fileId !== undefined && values.fileId !== current.fileId;
      await database.transaction(async (connection) => {
        const update: RepositoryRecord = { updatedAt: new Date() };
        for (const key of [
          'title',
          'category',
          'visibility',
          'reviewDate',
          'fileId',
          'autoDraftCourse',
          'docNo',
          'version',
          'effectiveDate',
        ] as const)
          if (values[key] !== undefined) update[key] = values[key];
        if (fileChanged)
          Object.assign(update, {
            parseStatus: 'pending',
            parseError: null,
            contentText: null,
          });
        await connection
          .repository('kbDocuments')
          .withPolicy(policyOf(policies, 'kbDocuments'))
          .updateOne({ filter: { id }, values: update });
        await writeLinks(connection, policies, id, values);
      });
      if (fileChanged) scheduleParse(id);
      const [summary] = await toSummaries(ctx, [(await loadRow(id))!]);
      return summary;
    },

    async setDocumentActive(ctx, id, active) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'manage');
      const repo = database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'));
      const current = await repo.findOne({ filter: { id } });
      if (!current) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      await repo.updateOne({
        filter: { id },
        values: { active, updatedAt: new Date() },
      });
      if (!active) await closeConflictsOf(database.query(), id, '文档已停用');
      const [summary] = await toSummaries(ctx, [(await loadRow(id))!]);
      return summary;
    },

    async retryParse(ctx, id) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'manage');
      const repo = database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'));
      const current = await repo.findOne({ filter: { id } });
      if (!current) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      await repo.updateOne({
        filter: { id },
        values: {
          parseStatus: 'pending',
          parseError: null,
          updatedAt: new Date(),
        },
      });
      await service.parseDocument(id);
      const [summary] = await toSummaries(ctx, [(await loadRow(id))!]);
      return summary;
    },

    async parseDocument(id) {
      const row = await loadRow(id);
      if (!row || row.parseStatus !== 'pending') return 'skipped';
      const finish = async (values: Record<string, unknown>) => {
        // Only a still-pending row is written, so a concurrent retry cannot be overwritten with stale output.
        await database
          .query()
          .updateTable('kbDocuments')
          .set({ ...values, updatedAt: new Date() })
          .where('id', '=', id)
          .where('parseStatus', '=', 'pending')
          .execute();
      };
      try {
        const file = await database
          .query()
          .selectFrom('hrFiles')
          .select(['disk', 'key', 'filename', 'mimeType'])
          .where('id', '=', String(row.fileId))
          .executeTakeFirst();
        if (!file) throw new HrError('DOCUMENT_FILE_MISSING', 400);
        const kind = documentKind(String(file.filename), String(file.mimeType));
        if (!kind) throw new HrError('DOCUMENT_TYPE_UNSUPPORTED', 400);
        const bytes = await drive()
          .use(String(file.disk))
          .getBytes(String(file.key));
        const text = await extractDocumentText(bytes, kind);
        const previousId =
          row.previousVersionId == null ? null : str(row.previousVersionId);
        if (previousId) {
          // One transaction: the new version's text and change list, and the old version leaving the knowledge base.
          const previous = await loadRow(previousId);
          const changes = diffSections(
            (previous?.contentText as string | null) ?? '',
            text,
          );
          await database.transaction(async (connection) => {
            const stamp = new Date();
            await connection.query
              .updateTable('kbDocuments')
              .set({
                contentText: text,
                parseStatus: 'ready',
                parseError: null,
                changeSummary: JSON.stringify(changes),
                updatedAt: stamp,
              })
              .where('id', '=', id)
              .where('parseStatus', '=', 'pending')
              .execute();
            await connection.query
              .updateTable('kbDocuments')
              .set({ supersededById: id, updatedAt: stamp })
              .where('id', '=', previousId)
              .execute();
            // The old version leaves conflict checking too: its open conflicts close.
            await closeConflictsOf(
              connection.query,
              previousId,
              '文档已被新版本取代',
            );
          });
        } else {
          await finish({
            contentText: text,
            parseStatus: 'ready',
            parseError: null,
          });
        }
        deps.onDocumentParsed?.()?.(id, {
          newVersion: Boolean(previousId),
          autoDraftCourse: !previousId && bool(row.autoDraftCourse),
        });
        return 'ready';
      } catch (error) {
        const reason =
          error instanceof HrError
            ? [
                error.code,
                isRecord(error.details) &&
                typeof error.details.reason === 'string'
                  ? error.details.reason
                  : '',
              ]
                .filter(Boolean)
                .join(': ')
            : error instanceof Error
              ? error.message
              : String(error);
        await finish({
          parseStatus: 'failed',
          parseError: reason.slice(0, 500),
        });
        return 'failed';
      }
    },

    async parsePending(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const rows = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id'])
        .where('parseStatus', '=', 'pending')
        .where('updatedAt', '<', cutoff)
        .limit(20)
        .execute();
      let count = 0;
      for (const row of rows)
        if ((await service.parseDocument(String(row.id))) !== 'skipped')
          count += 1;
      return count;
    },

    async documentFile(ctx, id) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'view');
      const row = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) return undefined;
      if (!bool(row.active) && !(await manageableIds(ctx, [id])).has(id))
        return undefined;
      const file = await database
        .query()
        .selectFrom('hrFiles')
        .select(['disk', 'key', 'filename', 'mimeType'])
        .where('id', '=', String(row.fileId))
        .executeTakeFirst();
      return file
        ? {
            disk: String(file.disk),
            key: String(file.key),
            filename: String(file.filename),
            mimeType: String(file.mimeType),
          }
        : undefined;
    },

    async search(ctx, query, limit = 5) {
      const policies = await authorizeAction(ctx.authz, ASSISTANT, 'use');
      const text = query.trim().slice(0, 500);
      if (!text) return [];
      const rows = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findMany({
          filter: { active: true, parseStatus: 'ready' },
        })) as Record<string, unknown>[];
      // A superseded version no longer answers: only the current version of a document is cited.
      // 知识范围 (设置 / AI 入口) narrows further; it never widens what the user may read.
      const scope = (await deps.knowledgeScope?.('knowledgeAssistant')) ?? {
        docNos: [],
        categories: [],
      };
      const current = rows.filter(
        (row) =>
          !row.supersededById &&
          // V4-13: a draft (an AI-drafted FAQ not yet confirmed) never answers; translations are not searched.
          (row.reviewStatus ?? 'confirmed') !== 'draft' &&
          !row.translationOfId &&
          (!scope.docNos.length ||
            scope.docNos.includes(str(row.docNo ?? ''))) &&
          (!scope.categories.length ||
            scope.categories.includes(str(row.category))),
      );
      const passages = current.flatMap((row) =>
        splitSections(row.contentText as string | null).map((section) => ({
          item: {
            documentId: String(row.id),
            documentTitle: String(row.title),
            section,
          },
          title: `${String(row.title)} ${section.title}`,
          text: section.text,
        })),
      );
      const ranked = rankPassages(
        text,
        passages,
        Math.min(Math.max(limit, 1), 8),
      );
      // Open conflicts on the returned sections, with the other side only when the user may read it.
      const openConflicts = ranked.length
        ? await database
            .query()
            .selectFrom('documentConflicts')
            .selectAll()
            .where('status', '=', 'open')
            .execute()
        : [];
      const readable = new Map(
        current.map((row) => [str(row.id), str(row.title)]),
      );
      const conflictsFor = (documentId: string, sectionTitle: string) =>
        openConflicts
          .map((c) =>
            str(c.documentId) === documentId &&
            str(c.sectionTitle) === sectionTitle
              ? {
                  other: str(c.otherDocumentId),
                  otherSection: str(c.otherSectionTitle),
                  excerpt: c.otherExcerpt,
                }
              : str(c.otherDocumentId) === documentId &&
                  str(c.otherSectionTitle) === sectionTitle
                ? {
                    other: str(c.documentId),
                    otherSection: str(c.sectionTitle),
                    excerpt: c.excerpt,
                  }
                : null,
          )
          .filter(
            (c): c is NonNullable<typeof c> =>
              Boolean(c) && readable.has(c!.other),
          )
          .map((c) => ({
            otherDocumentTitle: readable.get(c.other)!,
            otherSectionTitle: c.otherSection,
            otherExcerpt: c.excerpt == null ? null : str(c.excerpt),
          }));
      // V4-13: an uncontrolled document (an AI-drafted FAQ) is cited with a notice.
      const uncontrolled = new Set(
        current
          .filter((row) => row.controlled === false || row.controlled === 0)
          .map((row) => String(row.id)),
      );
      return ranked.map(({ item, excerpt, score }) => {
        const sectionTitle = item.section.title || item.documentTitle;
        const conflicts = conflictsFor(item.documentId, item.section.title);
        const notice = uncontrolled.has(item.documentId)
          ? '非受控文件，仅供参考'
          : null;
        return {
          ...(conflicts.length ? { conflicts } : {}),
          ...(notice ? { uncontrolled: true, notice } : {}),
          documentId: item.documentId,
          documentTitle: item.documentTitle,
          sectionIndex: item.section.index,
          sectionTitle,
          excerpt,
          path: `/talent/knowledge/${item.documentId}?section=${item.section.index}`,
          href: withBase(
            `/talent/knowledge/${item.documentId}?section=${item.section.index}`,
          ),
          citation: `《${item.documentTitle}》· ${sectionTitle}${notice ? `（${notice}）` : ''}`,
          score: Math.round(score * 100) / 100,
        };
      });
    },

    async readDocument(ctx, id) {
      const policies = await authorizeAction(ctx.authz, DOCUMENT, 'view');
      const row = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row || !bool(row.active))
        throw new HrError('DOCUMENT_NOT_FOUND', 404);
      if (row.parseStatus !== 'ready')
        throw new HrError('DOCUMENT_NOT_READY', 409);
      // A superseded version is kept for the record; courses are written from the current one.
      if (row.supersededById) throw new HrError('DOCUMENT_SUPERSEDED', 409);
      return {
        id,
        title: String(row.title),
        sections: splitSections(row.contentText as string | null),
      };
    },

    async recordGap(ctx, question, relatedDocumentId, channel = 'app') {
      const policies = await authorizeAction(ctx.authz, ASSISTANT, 'use');
      const text = question.trim().slice(0, 1000);
      if (!text) throw new HrError('INVALID_INPUT', 400);
      // A document id the model names is kept only when the asker may read that document.
      const related =
        relatedDocumentId &&
        (await service.visibleDocumentIds(ctx)).has(relatedDocumentId)
          ? relatedDocumentId
          : null;
      const stamp = new Date();
      const id = newId();
      await database
        .repository('knowledgeGaps')
        .withPolicy(policyOf(policies, 'knowledgeGaps'))
        .createOne({
          values: {
            id,
            question: text,
            askedByUserId: ctx.userId,
            askedAt: stamp,
            askCount: 1,
            lastAskedAt: stamp,
            relatedDocumentId: related,
            channel,
            topic: null,
            reportedAt: null,
            status: 'open',
            resolvedDocumentId: null,
            resolvedByUserId: null,
            resolvedAt: null,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      return { id };
    },

    async listGaps(ctx, status = 'open') {
      const policies = await authorizeAction(ctx.authz, GAP, 'view');
      const rows = (await database
        .repository('knowledgeGaps')
        .withPolicy(policyOf(policies, 'knowledgeGaps'))
        .findMany({
          filter: status === 'all' ? {} : { status },
          sort: (s) => [s.field('lastAskedAt').desc()],
        })) as Record<string, unknown>[];
      return Promise.all(rows.map(toGap));
    },

    async resolveGap(ctx, id, input) {
      const policies = await authorizeAction(ctx.authz, GAP, 'resolve');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const status = requireEnum(
        input.status,
        ['resolved', 'ignored', 'open'] as const,
        'INVALID_INPUT',
      );
      const documentId = requireString(input.documentId, 'INVALID_INPUT', {
        optional: true,
        max: 64,
      });
      if (documentId && !(await loadRow(documentId)))
        throw new HrError('DOCUMENT_NOT_FOUND', 404);
      const repo = database
        .repository('knowledgeGaps')
        .withPolicy(policyOf(policies, 'knowledgeGaps'));
      const stamp = new Date();
      const { record } = await repo.updateOne({
        filter: { id },
        values:
          status === 'open'
            ? {
                status,
                resolvedDocumentId: null,
                resolvedByUserId: null,
                resolvedAt: null,
                updatedAt: stamp,
              }
            : {
                status,
                resolvedDocumentId: status === 'resolved' ? documentId : null,
                resolvedByUserId: ctx.userId,
                resolvedAt: stamp,
                updatedAt: stamp,
              },
      });
      return toGap(record);
    },

    async uploadVersion(ctx, id, input) {
      const policies = await authorizeAction(
        ctx.authz,
        DOCUMENT,
        'uploadVersion',
      );
      const current = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!current) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      if (current.supersededById) throw new HrError('DOCUMENT_SUPERSEDED', 409);
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const fileId = requireString(input.fileId, 'DOCUMENT_FILE_REQUIRED', {
        max: 64,
      })!;
      const version = requireString(
        input.version,
        'DOCUMENT_VERSION_REQUIRED',
        { max: 32 },
      )!;
      const effectiveDate = optionalDate(input.effectiveDate, 'INVALID_INPUT');
      const docNo =
        (current.docNo == null ? null : str(current.docNo)) ??
        requireString(input.docNo, 'DOCUMENT_NO_REQUIRED', { max: 64 })!;
      const title =
        requireString(input.title, 'INVALID_INPUT', {
          optional: true,
          max: 200,
        }) ?? str(current.title);
      // One new version at a time: a pending successor must finish (or fail and be retried) first.
      const pending = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id'])
        .where('previousVersionId', '=', id)
        .where('supersededById', 'is', null)
        .executeTakeFirst();
      if (pending) throw new HrError('DOCUMENT_VERSION_PENDING', 409);
      await assertReferences({ fileId }, ctx);
      const links = await linksOf([id]);
      const newIdValue = newId();
      const stamp = new Date();
      await database.transaction(async (connection) => {
        await connection
          .repository('kbDocuments')
          .withPolicy(policyOf(policies, 'kbDocuments'))
          .createOne({
            values: {
              id: newIdValue,
              title,
              category: str(current.category),
              fileId,
              contentText: null,
              parseStatus: 'pending',
              parseError: null,
              visibility: str(current.visibility),
              // The document keeps its owner; whoever uploads the version.
              ownerUserId: str(current.ownerUserId),
              reviewDate:
                optionalDate(input.reviewDate, 'INVALID_INPUT') ??
                dateOnly(current.reviewDate),
              // A version is revised through its changes, never redrafted as a whole course.
              autoDraftCourse: false,
              active: true,
              docNo,
              version,
              previousVersionId: id,
              supersededById: null,
              effectiveDate,
              changeSummary: null,
              changeNote: null,
              lastReviewedAt: null,
              createdAt: stamp,
              updatedAt: stamp,
            },
          });
        if (current.docNo == null)
          await connection.query
            .updateTable('kbDocuments')
            .set({ docNo, updatedAt: stamp })
            .where('id', '=', id)
            .execute();
        await writeLinks(connection, policies, newIdValue, {
          visibility: str(current.visibility),
          competencyIds: links.competencies.get(id) ?? [],
          departmentIds: links.departments.get(id) ?? [],
          positionIds: links.positions.get(id) ?? [],
        });
      });
      scheduleParse(newIdValue);
      const [summary] = await toSummaries(ctx, [(await loadRow(newIdValue))!]);
      return summary;
    },

    async markReviewed(ctx, id, input) {
      const policies = await authorizeAction(
        ctx.authz,
        DOCUMENT,
        'markReviewed',
      );
      const current = (await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!current) throw new HrError('DOCUMENT_NOT_FOUND', 404);
      if (current.supersededById) throw new HrError('DOCUMENT_SUPERSEDED', 409);
      const today = platform.currentDate();
      const months = (await deps.reviewConfig?.())?.defaultReviewMonths ?? 12;
      const next =
        optionalDate(
          isRecord(input) ? input.nextReviewDate : undefined,
          'INVALID_INPUT',
        ) ??
        (() => {
          const date = new Date(`${today}T00:00:00Z`);
          date.setUTCMonth(date.getUTCMonth() + months);
          return date.toISOString().slice(0, 10);
        })();
      if (next <= today) throw new HrError('INVALID_INPUT', 400);
      await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .updateOne({
          filter: { id },
          values: {
            reviewDate: next,
            lastReviewedAt: new Date(),
            updatedAt: new Date(),
          },
        });
      const [summary] = await toSummaries(ctx, [(await loadRow(id))!]);
      return summary;
    },

    async setChangeNote(ctx, id, note) {
      if (!(await ownedOrScoped(ctx, 'uploadVersion', id)))
        throw new HrError('DOCUMENT_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('kbDocuments')
        .set({
          changeNote: note ? note.slice(0, 8000) : null,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
    },

    async listConflicts(ctx, status = 'open') {
      const policies = await authorizeAction(ctx.authz, CONFLICT, 'view');
      const rows = (await database
        .repository('documentConflicts')
        .withPolicy(policyOf(policies, 'documentConflicts'))
        .findMany({
          ...(status === 'all' ? {} : { filter: { status } }),
          sort: (s) => [s.field('createdAt').desc()],
        })) as Record<string, unknown>[];
      const result: DocumentConflictView[] = [];
      for (const row of rows) result.push(await toConflict(ctx, row));
      return result;
    },

    async handleConflict(ctx, id, status, note = null) {
      if (status === 'ignored' && !note?.trim())
        throw new HrError('CONFLICT_NOTE_REQUIRED', 400);
      const policies = await authorizeAction(
        ctx.authz,
        CONFLICT,
        status === 'resolved' ? 'resolve' : 'ignore',
      );
      const repo = database
        .repository('documentConflicts')
        .withPolicy(policyOf(policies, 'documentConflicts'));
      const row = await repo.findOne({ filter: { id } });
      if (!row) throw new HrError('CONFLICT_NOT_FOUND', 404);
      const { record } = await repo.updateOne({
        filter: { id },
        values: {
          status,
          handledBy: ctx.userId,
          handledAt: new Date(),
          resolutionNote: note?.trim().slice(0, 1000) || null,
          updatedAt: new Date(),
        },
      });
      return toConflict(ctx, record);
    },

    async recordConflict(input) {
      const existing = await database
        .query()
        .selectFrom('documentConflicts')
        .select(['id'])
        .where('documentId', '=', input.documentId)
        .where('sectionTitle', '=', input.sectionTitle)
        .where('otherDocumentId', '=', input.otherDocumentId)
        .where('otherSectionTitle', '=', input.otherSectionTitle)
        .executeTakeFirst();
      if (existing) return { id: str(existing.id), created: false };
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('documentConflicts')
        .values({
          id,
          ...input,
          source: input.source ?? 'ai',
          status: 'open',
          handledBy: null,
          handledAt: null,
          resolutionNote: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return { id, created: true };
    },

    async runReviewReminders() {
      const report = { upcoming: 0, overdue: 0 };
      const config = (await deps.reviewConfig?.()) ?? {
        reviewNoticeDays: REVIEW_NOTICE_DAYS,
        overdueIntervalDays: REVIEW_REMINDER_INTERVAL_MS / 86_400_000,
        defaultReviewMonths: 12,
      };
      const today = platform.currentDate();
      const soon = new Date(`${today}T00:00:00Z`);
      soon.setUTCDate(soon.getUTCDate() + config.reviewNoticeDays);
      const rows = await database
        .query()
        .selectFrom('kbDocuments')
        .select(['id', 'title', 'ownerUserId', 'reviewDate'])
        .where('active', '=', true)
        .where('supersededById', 'is', null)
        .where('reviewDate', 'is not', null)
        .where('reviewDate', '<=', soon.toISOString().slice(0, 10))
        .execute();
      const hrAdmins = await platform.holdersOfSettings(
        'talent.hr',
        'administer',
      );
      for (const row of rows) {
        const id = str(row.id);
        const reviewDate = dateOnly(row.reviewDate)!;
        const overdue = reviewDate < today;
        // At most once in 7 days per document, whichever day the daily job runs.
        const recent = await database
          .query()
          .selectFrom('hrReminderLog')
          .select(['id'])
          .where('reminderKey', 'like', `kbReview:${id}:%`)
          .where(
            'sentAt',
            '>',
            new Date(Date.now() - config.overdueIntervalDays * 86_400_000),
          )
          .executeTakeFirst();
        if (recent) continue;
        const recipients = overdue
          ? [...new Set([str(row.ownerUserId), ...hrAdmins])]
          : [str(row.ownerUserId)];
        await platform.reminderOnce(`kbReview:${id}:${today}`, () =>
          platform.notify({
            key: `kbReview:${id}:${today}`,
            userIds: recipients,
            message: overdue ? 'documentReviewOverdue' : 'documentReviewDue',
            params: { title: str(row.title), date: reviewDate },
            path: `/talent/knowledge/${encodeURIComponent(id)}`,
          }),
        );
        if (overdue) report.overdue += 1;
        else report.upcoming += 1;
      }
      return report;
    },

    async visibleDocumentIds(ctx) {
      const policies = await tryAuthorizeAction(ctx.authz, DOCUMENT, 'view');
      if (!policies) return new Set();
      const rows = await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findMany({ filter: { active: true } });
      return new Set(
        rows.map((row) => String((row as Record<string, unknown>).id)),
      );
    },
  };

  async function askerDepartment(userId: string): Promise<string | null> {
    const employee = await platform.employeeOfUser(userId);
    if (!employee) return null;
    return deps.departmentTitle(employee.departmentId);
  }

  /** A superseded or deactivated document takes its open conflicts with it; the system is the handler. */
  async function closeConflictsOf(
    query: ReturnType<DatabaseManager['query']>,
    documentId: string,
    note: string,
  ): Promise<void> {
    const stamp = new Date();
    for (const column of ['documentId', 'otherDocumentId'] as const)
      await query
        .updateTable('documentConflicts')
        .set({
          status: 'resolved',
          handledBy: 'system',
          handledAt: stamp,
          resolutionNote: note,
          updatedAt: stamp,
        })
        .where(column, '=', documentId)
        .where('status', '=', 'open')
        .execute();
  }

  /** Whether the caller holds a document action and the document is in its scope. */
  async function ownedOrScoped(
    ctx: ActorContext,
    action: string,
    id: string,
  ): Promise<boolean> {
    const policies = await tryAuthorizeAction(ctx.authz, DOCUMENT, action);
    if (!policies) return false;
    return Boolean(
      await database
        .repository('kbDocuments')
        .withPolicy(policyOf(policies, 'kbDocuments'))
        .findOne({ filter: { id } }),
    );
  }

  async function toConflict(
    ctx: ActorContext,
    row: Record<string, unknown>,
  ): Promise<DocumentConflictView> {
    const document = await loadRow(str(row.documentId));
    const other = await loadRow(str(row.otherDocumentId));
    const label = (doc: Record<string, unknown> | undefined) =>
      doc
        ? `${str(doc.title)}${doc.version ? ` ${str(doc.version)}` : ''}`
        : '';
    return {
      id: str(row.id),
      documentId: str(row.documentId),
      documentTitle: label(document),
      sectionTitle: str(row.sectionTitle),
      otherDocumentId: str(row.otherDocumentId),
      otherDocumentTitle: label(other),
      otherSectionTitle: str(row.otherSectionTitle),
      description: str(row.description),
      excerpt: row.excerpt == null ? null : str(row.excerpt),
      otherExcerpt: row.otherExcerpt == null ? null : str(row.otherExcerpt),
      status: str(row.status),
      handledByName: await platform.userName(
        row.handledBy == null ? null : str(row.handledBy),
      ),
      createdAt: iso(row.createdAt),
      can: {
        resolve:
          row.status === 'open' &&
          (await platform.can(ctx, CONFLICT, 'resolve')),
        ignore:
          row.status === 'open' &&
          (await platform.can(ctx, CONFLICT, 'ignore')),
      },
    };
  }

  async function toGap(row: Record<string, unknown>): Promise<KnowledgeGap> {
    const documentId =
      row.resolvedDocumentId == null ? null : str(row.resolvedDocumentId);
    const document = documentId ? await loadRow(documentId) : undefined;
    const relatedId =
      row.relatedDocumentId == null ? null : str(row.relatedDocumentId);
    const related = relatedId ? await loadRow(relatedId) : undefined;
    return {
      id: String(row.id),
      question: String(row.question),
      askedByName: await askerDepartment(str(row.askedByUserId)),
      channel: row.channel == null ? 'app' : str(row.channel),
      askCount: Number(row.askCount),
      askedAt: iso(row.askedAt ?? row.createdAt),
      lastAskedAt: iso(row.lastAskedAt),
      relatedDocumentId: relatedId,
      relatedDocumentTitle: related ? String(related.title) : null,
      topic: row.topic == null ? null : str(row.topic),
      reportedAt: row.reportedAt == null ? null : iso(row.reportedAt),
      status: String(row.status),
      resolvedDocumentId: documentId,
      resolvedDocumentTitle: document ? String(document.title) : null,
    };
  }

  async function writeLinks(
    connection: import('@nocobase/db').DatabaseConnection,
    policies: import('./authorize.js').CollectionPolicies,
    documentId: string,
    values: Partial<DocumentInput>,
  ): Promise<void> {
    const sets: [string, string, string[] | undefined][] = [
      ['kbDocumentCompetencies', 'competencyId', values.competencyIds],
      [
        'kbDocumentDepartments',
        'departmentId',
        values.visibility === 'all' ? [] : values.departmentIds,
      ],
      [
        'kbDocumentPositions',
        'positionId',
        values.visibility === 'all' ? [] : values.positionIds,
      ],
    ];
    const stamp = new Date();
    for (const [table, column, ids] of sets) {
      if (ids === undefined) continue;
      const repo = connection
        .repository(table)
        .withPolicy(policyOf(policies, table));
      const existing = (await repo.findMany({
        filter: { documentId },
      })) as Record<string, unknown>[];
      const keep = new Set(ids);
      for (const row of existing)
        if (!keep.has(String(row[column])))
          await repo.deleteOne({ filter: { id: String(row.id) } });
      const present = new Set(existing.map((row) => String(row[column])));
      for (const id of ids) {
        if (present.has(id)) continue;
        await repo.createOne({
          values: {
            id: newId(),
            documentId,
            [column]: id,
            createdAt: stamp,
            updatedAt: stamp,
          },
        });
      }
    }
  }

  return service;
}
