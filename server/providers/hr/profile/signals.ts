/**
 * V3-11 业务数据接入: quality issues, tickets and project tasks from other
 * systems, pushed through `POST /api/talent/signals:ingest` with an API key,
 * or imported from Excel by HR. Matching is a server rule, never AI:
 *
 * - the person: `personKey` against an active employee's number, work email,
 *   then login account; otherwise `unmatchedPerson`, assigned by hand;
 * - the department: the person's department when it happened (the department
 *   they left in a later job event), else their current one;
 * - the competency: a confirmed rule for (sourceSystem, category); otherwise
 *   `unmatchedCompetency`, for which the talent analyst drafts a rule.
 *
 * (sourceSystem, externalId) is unique: a repeated push updates the row. A
 * person assigned by hand stays assigned when the same record is pushed again.
 * Matched quality issues start the analyst's training check.
 */
import * as XLSX from 'xlsx';

import { authorizeAction, policyOf, tryAuthorizeAction } from '../authorize.js';
import {
  displayValue,
  fieldLabel,
  type CustomFieldDefinition,
  type ExtensibleCollection,
} from '../custom-fields.js';
import type { ActorContext } from '../framework-service.js';
import { json } from '../platform.js';
import { HrError, isRecord, newId, str } from '../shared.js';
import {
  dateOnly,
  iso,
  isActive,
  nullable,
  PERSON_COLUMNS,
  toPerson,
  type PersonRow,
  type ProfileDeps,
  type ProfileReads,
} from './context.js';

const SIGNAL = 'talent.signal';
export const SOURCE_SYSTEMS = ['qms', 'ticket', 'project', 'other'] as const;
export const SIGNAL_TYPES = [
  'qualityIssue',
  'correctiveAction',
  'ticketResolved',
  'ticketReopened',
  'ticketEscalated',
  'taskDelivered',
  'taskDelayed',
] as const;
export const SEVERITIES = ['minor', 'major', 'critical'] as const;
export const MATCH_STATUSES = [
  'matched',
  'unmatchedPerson',
  'unmatchedCompetency',
  'ignored',
] as const;
/** The record types the dashboard trend counts as problems. */
export const PROBLEM_TYPES = [
  'qualityIssue',
  'ticketReopened',
  'ticketEscalated',
  'taskDelayed',
] as const;
export const INGEST_LIMIT = 500;
/** The business-data table as the custom-field service knows it (registration: custom-fields.ts). */
export const SIGNAL_COLLECTION =
  'businessSignals' as unknown as ExtensibleCollection;

export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];
export type SignalType = (typeof SIGNAL_TYPES)[number];

export interface SignalView {
  readonly id: string;
  readonly sourceSystem: string;
  readonly externalId: string;
  readonly signalType: string;
  readonly category: string | null;
  readonly severity: string | null;
  readonly title: string;
  /** Present only for readers of the record (HR in scope, heads in scope). */
  readonly summary: string | null;
  readonly occurredAt: string;
  readonly employeeId: string | null;
  readonly employeeName: string | null;
  readonly personKey: string;
  readonly departmentId: string | null;
  readonly departmentTitle: string | null;
  readonly competencyId: string | null;
  readonly competencyTitle: string | null;
  readonly correctiveActionRef: string | null;
  readonly link: string | null;
  readonly matchStatus: string;
  readonly channel: string;
  readonly customFields: Record<string, unknown>;
  /** HR administrators only. */
  readonly rawPayload?: unknown;
  /** A draft rule the analyst proposed for an unmatched category. */
  readonly draftRule?: RuleView | null;
}

export interface RuleView {
  readonly id: string;
  readonly sourceSystem: string;
  readonly category: string;
  readonly competencyId: string;
  readonly competencyTitle: string;
  readonly source: string;
  readonly reviewStatus: string;
  readonly note: string | null;
  readonly unmatchedCount: number;
  readonly updatedAt: string;
}

export interface IngestResult {
  readonly received: number;
  readonly created: number;
  readonly updated: number;
  readonly results: readonly {
    readonly index: number;
    readonly externalId: string | null;
    readonly id?: string;
    readonly status: 'created' | 'updated' | 'error';
    readonly matchStatus?: string;
    readonly error?: string;
    readonly details?: unknown;
  }[];
}

interface ParsedSignal {
  sourceSystem: SourceSystem;
  externalId: string;
  signalType: SignalType;
  category: string | null;
  severity: string | null;
  title: string;
  summary: string | null;
  occurredAt: Date;
  personKey: string;
  correctiveActionRef: string | null;
  link: string | null;
  fields: Record<string, unknown>;
  raw: unknown;
}

const KNOWN_KEYS = new Set([
  'sourceSystem',
  'externalId',
  'signalType',
  'category',
  'severity',
  'title',
  'summary',
  'occurredAt',
  'personKey',
  'correctiveActionRef',
  'link',
  'customFields',
  'fields',
]);

function text(value: unknown, max: number): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

/** Validates one pushed or imported record. */
export function parseSignal(
  input: unknown,
): { ok: true; value: ParsedSignal } | { ok: false; code: string } {
  if (!isRecord(input)) return { ok: false, code: 'SIGNAL_INVALID' };
  const sourceSystem = text(input.sourceSystem, 16);
  if (
    !sourceSystem ||
    !(SOURCE_SYSTEMS as readonly string[]).includes(sourceSystem)
  )
    return { ok: false, code: 'SIGNAL_SOURCE_INVALID' };
  const externalId = text(input.externalId, 128);
  if (!externalId) return { ok: false, code: 'SIGNAL_EXTERNAL_ID_REQUIRED' };
  const signalType = text(input.signalType, 32);
  if (!signalType || !(SIGNAL_TYPES as readonly string[]).includes(signalType))
    return { ok: false, code: 'SIGNAL_TYPE_INVALID' };
  const severity = text(input.severity, 16);
  if (severity && !(SEVERITIES as readonly string[]).includes(severity))
    return { ok: false, code: 'SIGNAL_SEVERITY_INVALID' };
  const title = text(input.title, 500);
  if (!title) return { ok: false, code: 'SIGNAL_TITLE_REQUIRED' };
  const personKey = text(input.personKey, 128);
  if (!personKey) return { ok: false, code: 'SIGNAL_PERSON_REQUIRED' };
  const occurredRaw =
    input.occurredAt instanceof Date
      ? input.occurredAt.toISOString()
      : text(input.occurredAt, 40);
  const occurredAt = occurredRaw ? new Date(occurredRaw) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime()))
    return { ok: false, code: 'SIGNAL_OCCURRED_AT_INVALID' };
  const link = text(input.link, 1000);
  if (link && !/^https?:\/\//iu.test(link))
    return { ok: false, code: 'SIGNAL_LINK_INVALID' };
  const fields: Record<string, unknown> = {};
  for (const source of [input.customFields, input.fields])
    if (isRecord(source)) Object.assign(fields, source);
  // Administrator-added fields may also arrive at the top level, by name.
  for (const [key, value] of Object.entries(input))
    if (!KNOWN_KEYS.has(key)) fields[key] = value;
  return {
    ok: true,
    value: {
      sourceSystem: sourceSystem as SourceSystem,
      externalId,
      signalType: signalType as SignalType,
      category: text(input.category, 128),
      severity,
      title,
      summary: text(input.summary, 4000),
      occurredAt,
      personKey,
      correctiveActionRef: text(input.correctiveActionRef, 64),
      link,
      fields,
      raw: input,
    },
  };
}

export const IMPORT_HEADER = [
  '来源系统',
  '编号',
  '类型',
  '分类',
  '严重程度',
  '标题',
  '描述',
  '发生时间',
  '人员标识',
  '8D 编号',
  '链接',
] as const;
const IMPORT_KEYS = [
  'sourceSystem',
  'externalId',
  'signalType',
  'category',
  'severity',
  'title',
  'summary',
  'occurredAt',
  'personKey',
  'correctiveActionRef',
  'link',
] as const;

export interface SignalFilters {
  readonly sourceSystem?: string;
  readonly signalType?: string;
  readonly matchStatus?: string;
  readonly from?: string;
  readonly to?: string;
  readonly employeeId?: string;
  readonly q?: string;
}

export interface SignalServiceHooks {
  /** Matched quality issues were written: the analyst's training check. */
  readonly onQualityMatched: (signalIds: readonly string[]) => void;
}

export function createSignalService(
  deps: ProfileDeps,
  reads: ProfileReads,
  hooks: SignalServiceHooks,
) {
  const { platform } = deps;
  const { database } = platform;

  async function definitions(): Promise<CustomFieldDefinition[]> {
    return (await deps.customFields().list(SIGNAL_COLLECTION)).filter(
      (d) => d.active,
    );
  }

  /** Maps submitted custom values keyed by internal key or by name to internal keys. */
  function keyed(
    defs: readonly CustomFieldDefinition[],
    fields: Record<string, unknown>,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(fields)) {
      const def = defs.find(
        (d) =>
          d.key === name ||
          d.label['zh-CN'] === name ||
          (d.label['en-US'] && d.label['en-US'] === name),
      );
      if (def) out[def.key] = value;
    }
    return out;
  }

  async function matchPerson(
    personKey: string,
  ): Promise<PersonRow | undefined> {
    const key = personKey.trim();
    const query = database.query();
    const pick = (rows: Record<string, unknown>[]) =>
      rows.map(toPerson).find(isActive);
    const byNo = pick(
      await query
        .selectFrom('employees')
        .select([...PERSON_COLUMNS])
        .where('employeeNo', '=', key)
        .execute(),
    );
    if (byNo) return byNo;
    if (key.includes('@')) {
      const lower = key.toLowerCase();
      const byEmail = pick(
        (
          await query
            .selectFrom('employees')
            .select([...PERSON_COLUMNS, 'email'])
            .where('email', 'is not', null)
            .execute()
        ).filter((row) => str(row.email).toLowerCase() === lower),
      );
      if (byEmail) return byEmail;
    }
    const users = await deps
      .users()
      .list({ search: key, pageSize: 20 })
      .catch(() => ({ items: [] as { id: string; username?: string }[] }));
    const user = users.items.find(
      (u) => (u.username ?? '').toLowerCase() === key.toLowerCase(),
    );
    if (!user) return undefined;
    return pick(
      await query
        .selectFrom('employees')
        .select([...PERSON_COLUMNS])
        .where('userId', '=', user.id)
        .execute(),
    );
  }

  /** The department the person was in when it happened. */
  async function departmentAt(
    employee: PersonRow,
    occurredAt: Date,
  ): Promise<string> {
    const date = occurredAt.toISOString().slice(0, 10);
    const later = await database
      .query()
      .selectFrom('jobEvents')
      .select(['fromDepartmentId', 'effectiveDate'])
      .where('employeeId', '=', employee.id)
      .where('effectiveDate', '>', date)
      .where('fromDepartmentId', 'is not', null)
      .orderBy('effectiveDate', 'asc')
      .executeTakeFirst();
    return later?.fromDepartmentId
      ? str(later.fromDepartmentId)
      : employee.departmentId;
  }

  async function ruleFor(
    sourceSystem: string,
    category: string | null,
  ): Promise<string | null> {
    if (!category) return null;
    const row = await database
      .query()
      .selectFrom('signalCompetencyRules')
      .select(['competencyId'])
      .where('sourceSystem', '=', sourceSystem)
      .where('category', '=', category)
      .where('reviewStatus', '=', 'confirmed')
      .executeTakeFirst();
    return row ? str(row.competencyId) : null;
  }

  async function writeOne(
    item: ParsedSignal,
    defs: readonly CustomFieldDefinition[],
    channel: string,
    userId: string | null,
  ): Promise<{
    id: string;
    created: boolean;
    matchStatus: string;
    qualityMatched: boolean;
  }> {
    const existing = await database
      .query()
      .selectFrom('businessSignals')
      .selectAll()
      .where('sourceSystem', '=', item.sourceSystem)
      .where('externalId', '=', item.externalId)
      .executeTakeFirst();
    let person = await matchPerson(item.personKey);
    // The same record again with a person HR assigned by hand keeps that person.
    if (
      !person &&
      existing?.employeeId &&
      str(existing.personKey) === item.personKey
    )
      person = (await reads.people([str(existing.employeeId)]))[0];
    const competencyId = await ruleFor(item.sourceSystem, item.category);
    const departmentId = person
      ? await departmentAt(person, item.occurredAt)
      : null;
    let matchStatus = !person
      ? 'unmatchedPerson'
      : !competencyId
        ? 'unmatchedCompetency'
        : 'matched';
    if (existing?.matchStatus === 'ignored') matchStatus = 'ignored';
    const customFields = deps
      .customFields()
      .prepare(
        defs,
        keyed(defs, item.fields),
        json<Record<string, unknown>>(existing?.customFields, {}),
      );
    const stamp = new Date();
    const values = {
      signalType: item.signalType,
      category: item.category,
      severity: item.severity,
      title: item.title,
      summary: item.summary,
      occurredAt: item.occurredAt,
      employeeId: person?.id ?? null,
      personKey: item.personKey,
      departmentId,
      competencyId,
      correctiveActionRef: item.correctiveActionRef,
      link: item.link,
      matchStatus,
      rawPayload: item.raw as Record<string, unknown>,
      customFields,
      channel,
      ingestedBy: userId,
      updatedAt: stamp,
    };
    let id: string;
    if (existing) {
      id = str(existing.id);
      await database
        .query()
        .updateTable('businessSignals')
        .set(values)
        .where('id', '=', id)
        .execute();
    } else {
      id = newId();
      await database
        .query()
        .insertInto('businessSignals')
        .values({
          id,
          sourceSystem: item.sourceSystem,
          externalId: item.externalId,
          ...values,
          createdAt: stamp,
        })
        .execute();
    }
    return {
      id,
      created: !existing,
      matchStatus,
      qualityMatched:
        matchStatus === 'matched' && item.signalType === 'qualityIssue',
    };
  }

  async function ingestItems(
    items: readonly unknown[],
    channel: string,
    userId: string | null,
  ): Promise<IngestResult> {
    if (items.length > INGEST_LIMIT)
      throw new HrError('SIGNAL_BATCH_TOO_LARGE', 400, { max: INGEST_LIMIT });
    const defs = await definitions();
    const results: IngestResult['results'][number][] = [];
    const quality: string[] = [];
    let created = 0;
    let updated = 0;
    for (const [index, raw] of items.entries()) {
      const parsed = parseSignal(raw);
      const externalId = isRecord(raw) ? text(raw.externalId, 128) : null;
      if (!parsed.ok) {
        results.push({
          index,
          externalId,
          status: 'error',
          error: parsed.code,
        });
        continue;
      }
      try {
        const written = await writeOne(parsed.value, defs, channel, userId);
        if (written.created) created += 1;
        else updated += 1;
        if (written.qualityMatched) quality.push(written.id);
        results.push({
          index,
          externalId,
          id: written.id,
          status: written.created ? 'created' : 'updated',
          matchStatus: written.matchStatus,
        });
      } catch (error) {
        if (!(error instanceof HrError)) throw error;
        results.push({
          index,
          externalId,
          status: 'error',
          error: error.code,
          details: error.details ?? null,
        });
      }
    }
    if (quality.length) hooks.onQualityMatched(quality);
    return { received: items.length, created, updated, results };
  }

  async function competencyTitles(): Promise<Map<string, string>> {
    return new Map(
      [...(await reads.competencies()).values()].map((c) => [c.id, c.title]),
    );
  }

  async function toView(
    row: Record<string, unknown>,
    context: {
      names: Map<string, string>;
      competencies: Map<string, string>;
      defs: readonly CustomFieldDefinition[];
      admin: boolean;
      summary: boolean;
    },
  ): Promise<SignalView> {
    const employeeId = nullable(row.employeeId);
    const departmentId = nullable(row.departmentId);
    const competencyId = nullable(row.competencyId);
    return {
      id: str(row.id),
      sourceSystem: str(row.sourceSystem),
      externalId: str(row.externalId),
      signalType: str(row.signalType),
      category: nullable(row.category),
      severity: nullable(row.severity),
      title: str(row.title),
      summary: context.summary ? nullable(row.summary) : null,
      occurredAt: iso(row.occurredAt) ?? '',
      employeeId,
      employeeName: employeeId ? (context.names.get(employeeId) ?? null) : null,
      personKey: str(row.personKey),
      departmentId,
      departmentTitle: departmentId
        ? await deps.departmentTitle(departmentId)
        : null,
      competencyId,
      competencyTitle: competencyId
        ? (context.competencies.get(competencyId) ?? null)
        : null,
      correctiveActionRef: nullable(row.correctiveActionRef),
      link: nullable(row.link),
      matchStatus: str(row.matchStatus),
      channel: str(row.channel ?? 'push'),
      customFields: deps
        .customFields()
        .project(context.defs, row.customFields, { sensitive: context.admin }),
      ...(context.admin ? { rawPayload: json(row.rawPayload, null) } : {}),
    };
  }

  async function names(ids: readonly string[]): Promise<Map<string, string>> {
    return new Map(
      (await reads.people([...new Set(ids)])).map((p) => [p.id, p.name]),
    );
  }

  async function scopedRows(
    ctx: ActorContext,
  ): Promise<Record<string, unknown>[]> {
    const policies = await authorizeAction(ctx.authz, SIGNAL, 'view');
    return await database
      .repository('businessSignals')
      .withPolicy(policyOf(policies, 'businessSignals'))
      .findMany({
        sort: (s) => [s.field('occurredAt').desc()],
      });
  }

  async function ruleViews(): Promise<RuleView[]> {
    const rows = await database
      .query()
      .selectFrom('signalCompetencyRules')
      .selectAll()
      .orderBy('updatedAt', 'desc')
      .execute();
    const competencies = await competencyTitles();
    const unmatched = await database
      .query()
      .selectFrom('businessSignals')
      .select(['sourceSystem', 'category'])
      .where('matchStatus', '=', 'unmatchedCompetency')
      .execute();
    return rows.map((row) => ({
      id: str(row.id),
      sourceSystem: str(row.sourceSystem),
      category: str(row.category),
      competencyId: str(row.competencyId),
      competencyTitle:
        competencies.get(str(row.competencyId)) ?? str(row.competencyId),
      source: str(row.source),
      reviewStatus: str(row.reviewStatus),
      note: nullable(row.note),
      unmatchedCount: unmatched.filter(
        (u) =>
          str(u.sourceSystem) === str(row.sourceSystem) &&
          str(u.category) === str(row.category),
      ).length,
      updatedAt: iso(row.updatedAt) ?? '',
    }));
  }

  const service = {
    /** API push: the integration account's only permission. */
    async ingest(ctx: ActorContext, body: unknown): Promise<IngestResult> {
      await authorizeAction(ctx.authz, SIGNAL, 'ingest');
      const items = Array.isArray(body)
        ? body
        : isRecord(body) && Array.isArray(body.items)
          ? body.items
          : isRecord(body)
            ? [body]
            : null;
      if (!items) throw new HrError('SIGNAL_INVALID', 400);
      return ingestItems(items, 'push', ctx.userId);
    },

    /** Trusted writes from the application itself (workflows, demo seeds use their own inserts). */
    ingestTrusted(items: readonly unknown[], channel: string) {
      return ingestItems(items, channel, null);
    },

    async list(
      ctx: ActorContext,
      filters: SignalFilters,
    ): Promise<{
      items: SignalView[];
      counts: Record<string, number>;
      fields: { key: string; label: string; type: string }[];
      can: {
        match: boolean;
        import: boolean;
        manageRules: boolean;
        retryWriteback: boolean;
      };
    }> {
      let rows = await scopedRows(ctx);
      const counts: Record<string, number> = { all: rows.length };
      for (const status of MATCH_STATUSES)
        counts[status] = rows.filter((r) => r.matchStatus === status).length;
      const from = filters.from ? new Date(`${filters.from}T00:00:00Z`) : null;
      const to = filters.to ? new Date(`${filters.to}T23:59:59Z`) : null;
      rows = rows.filter((row) => {
        if (filters.sourceSystem && row.sourceSystem !== filters.sourceSystem)
          return false;
        if (filters.signalType && row.signalType !== filters.signalType)
          return false;
        if (filters.employeeId && row.employeeId !== filters.employeeId)
          return false;
        if (filters.matchStatus) {
          const wanted =
            filters.matchStatus === 'unmatched'
              ? ['unmatchedPerson', 'unmatchedCompetency']
              : [filters.matchStatus];
          if (!wanted.includes(str(row.matchStatus))) return false;
        }
        const at = new Date(iso(row.occurredAt) ?? 0);
        if (from && at < from) return false;
        if (to && at > to) return false;
        if (filters.q) {
          const q = filters.q.toLowerCase();
          if (
            !`${str(row.externalId)} ${str(row.title)} ${str(row.category ?? '')} ${str(row.personKey)}`
              .toLowerCase()
              .includes(q)
          )
            return false;
        }
        return true;
      });
      const admin = await platform.can(ctx, SIGNAL, 'import');
      const defs = await definitions();
      const context = {
        names: await names(
          rows
            .map((r) => nullable(r.employeeId))
            .filter((v): v is string => Boolean(v)),
        ),
        competencies: await competencyTitles(),
        defs,
        admin,
        summary: true,
      };
      const rules = (await ruleViews()).filter(
        (r) => r.reviewStatus === 'draft',
      );
      const items: SignalView[] = [];
      for (const row of rows.slice(0, 1000)) {
        const view = await toView(row, context);
        items.push(
          view.matchStatus === 'unmatchedCompetency'
            ? {
                ...view,
                draftRule:
                  rules.find(
                    (r) =>
                      r.sourceSystem === view.sourceSystem &&
                      r.category === view.category,
                  ) ?? null,
              }
            : view,
        );
      }
      return {
        items,
        counts,
        fields: defs
          .filter((d) => admin || !d.sensitive)
          .map((d) => ({
            key: d.key,
            label: fieldLabel(d, 'zh-CN'),
            type: d.type,
          })),
        can: {
          match: await platform.can(ctx, SIGNAL, 'match'),
          import: admin,
          manageRules: await platform.can(ctx, SIGNAL, 'manageRules'),
          retryWriteback: await platform.can(
            ctx,
            'talent.trainingRecommendation',
            'retryWriteback',
          ),
        },
      };
    },

    async get(ctx: ActorContext, id: string): Promise<SignalView> {
      const policies = await authorizeAction(ctx.authz, SIGNAL, 'view');
      const row = (await database
        .repository('businessSignals')
        .withPolicy(policyOf(policies, 'businessSignals'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('SIGNAL_NOT_FOUND', 404);
      const admin = await platform.can(ctx, SIGNAL, 'import');
      return toView(
        admin
          ? ((await database
              .query()
              .selectFrom('businessSignals')
              .selectAll()
              .where('id', '=', id)
              .executeTakeFirst()) as Record<string, unknown>)
          : row,
        {
          names: await names(row.employeeId ? [str(row.employeeId)] : []),
          competencies: await competencyTitles(),
          defs: await definitions(),
          admin,
          summary: true,
        },
      );
    },

    /** 待匹配: HR names the employee of an unmatched record. */
    async assignPerson(
      ctx: ActorContext,
      id: string,
      input: unknown,
    ): Promise<SignalView> {
      const policies = await authorizeAction(ctx.authz, SIGNAL, 'match');
      const row = (await database
        .repository('businessSignals')
        .withPolicy(policyOf(policies, 'businessSignals'))
        .findOne({ filter: { id } })) as Record<string, unknown> | undefined;
      if (!row) throw new HrError('SIGNAL_NOT_FOUND', 404);
      const employeeId =
        isRecord(input) && typeof input.employeeId === 'string'
          ? input.employeeId
          : '';
      const employee = (await reads.people([employeeId]))[0];
      if (!employee || !isActive(employee))
        throw new HrError('EMPLOYEE_NOT_FOUND', 404);
      const occurredAt = new Date(iso(row.occurredAt) ?? Date.now());
      const competencyId =
        nullable(row.competencyId) ??
        (await ruleFor(str(row.sourceSystem), nullable(row.category)));
      const matchStatus = competencyId ? 'matched' : 'unmatchedCompetency';
      await database
        .query()
        .updateTable('businessSignals')
        .set({
          employeeId: employee.id,
          departmentId: await departmentAt(employee, occurredAt),
          competencyId,
          matchStatus,
          updatedAt: new Date(),
        })
        .where('id', '=', id)
        .execute();
      if (matchStatus === 'matched' && row.signalType === 'qualityIssue')
        hooks.onQualityMatched([id]);
      return service.get(ctx, id);
    },

    async ignore(ctx: ActorContext, id: string): Promise<SignalView> {
      const policies = await authorizeAction(ctx.authz, SIGNAL, 'match');
      const row = await database
        .repository('businessSignals')
        .withPolicy(policyOf(policies, 'businessSignals'))
        .findOne({ filter: { id } });
      if (!row) throw new HrError('SIGNAL_NOT_FOUND', 404);
      await database
        .query()
        .updateTable('businessSignals')
        .set({ matchStatus: 'ignored', updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return service.get(ctx, id);
    },

    async listRules(ctx: ActorContext): Promise<RuleView[]> {
      await authorizeAction(ctx.authz, SIGNAL, 'view');
      return ruleViews();
    },

    /** A manual rule, confirmed at once; an existing rule for the category is changed and confirmed. */
    async saveRule(ctx: ActorContext, input: unknown): Promise<RuleView> {
      await authorizeAction(ctx.authz, SIGNAL, 'manageRules');
      if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
      const sourceSystem = text(input.sourceSystem, 16);
      if (
        !sourceSystem ||
        !(SOURCE_SYSTEMS as readonly string[]).includes(sourceSystem)
      )
        throw new HrError('SIGNAL_SOURCE_INVALID', 400);
      const category = text(input.category, 128);
      if (!category) throw new HrError('SIGNAL_RULE_CATEGORY_REQUIRED', 400);
      const competencyId = text(input.competencyId, 64);
      const competency = competencyId
        ? (await reads.competencies()).get(competencyId)
        : undefined;
      if (!competency || !competency.active)
        throw new HrError('COMPETENCY_NOT_FOUND', 404);
      const existing = await database
        .query()
        .selectFrom('signalCompetencyRules')
        .select(['id', 'competencyId', 'source'])
        .where('sourceSystem', '=', sourceSystem)
        .where('category', '=', category)
        .executeTakeFirst();
      const stamp = new Date();
      let id: string;
      if (existing) {
        id = str(existing.id);
        await database
          .query()
          .updateTable('signalCompetencyRules')
          .set({
            competencyId: competency.id,
            reviewStatus: 'confirmed',
            confirmedBy: ctx.userId,
            confirmedAt: stamp,
            note: text(input.note, 1000),
            updatedAt: stamp,
          })
          .where('id', '=', id)
          .execute();
        if (existing.source === 'ai')
          await reads.recordOutcome(
            'signalRule',
            id,
            str(existing.competencyId) === competency.id
              ? 'adopted'
              : 'modified',
            ctx.userId,
          );
      } else {
        id = newId();
        await database
          .query()
          .insertInto('signalCompetencyRules')
          .values({
            id,
            sourceSystem,
            category,
            competencyId: competency.id,
            source: 'manual',
            reviewStatus: 'confirmed',
            note: text(input.note, 1000),
            createdBy: ctx.userId,
            confirmedBy: ctx.userId,
            confirmedAt: stamp,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
      }
      await service.rematch(sourceSystem, category);
      const rule = (await ruleViews()).find((r) => r.id === id);
      if (!rule) throw new HrError('SIGNAL_RULE_NOT_FOUND', 404);
      return rule;
    },

    /** Confirms a draft rule as it stands, or with another competency. */
    async confirmRule(
      ctx: ActorContext,
      id: string,
      input: unknown,
    ): Promise<RuleView> {
      await authorizeAction(ctx.authz, SIGNAL, 'manageRules');
      const row = await database
        .query()
        .selectFrom('signalCompetencyRules')
        .selectAll()
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('SIGNAL_RULE_NOT_FOUND', 404);
      return service.saveRule(ctx, {
        sourceSystem: row.sourceSystem,
        category: row.category,
        competencyId:
          isRecord(input) && typeof input.competencyId === 'string'
            ? input.competencyId
            : row.competencyId,
        note: row.note,
      });
    },

    /** The analyst's draft for an unmatched category; skipped when any rule exists for it. */
    async draftRule(input: {
      sourceSystem: string;
      category: string;
      competencyId: string;
      note: string | null;
      userId: string;
    }): Promise<string | null> {
      const existing = await database
        .query()
        .selectFrom('signalCompetencyRules')
        .select(['id'])
        .where('sourceSystem', '=', input.sourceSystem)
        .where('category', '=', input.category)
        .executeTakeFirst();
      if (existing) return null;
      const competency = (await reads.competencies()).get(input.competencyId);
      if (!competency?.active) throw new HrError('COMPETENCY_NOT_FOUND', 404);
      const id = newId();
      const stamp = new Date();
      await database
        .query()
        .insertInto('signalCompetencyRules')
        .values({
          id,
          sourceSystem: input.sourceSystem,
          category: input.category,
          competencyId: input.competencyId,
          source: 'ai',
          reviewStatus: 'draft',
          note: input.note ? input.note.slice(0, 1000) : null,
          createdBy: input.userId,
          confirmedBy: null,
          confirmedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
        })
        .execute();
      return id;
    },

    /** Categories of unmatched-competency records without any rule: what the analyst drafts rules for. */
    async unmatchedCategories(): Promise<
      {
        sourceSystem: string;
        category: string;
        count: number;
        titles: string[];
      }[]
    > {
      const rows = await database
        .query()
        .selectFrom('businessSignals')
        .select(['sourceSystem', 'category', 'title'])
        .where('matchStatus', '=', 'unmatchedCompetency')
        .where('category', 'is not', null)
        .execute();
      const rules = await database
        .query()
        .selectFrom('signalCompetencyRules')
        .select(['sourceSystem', 'category'])
        .execute();
      const groups = new Map<
        string,
        {
          sourceSystem: string;
          category: string;
          count: number;
          titles: string[];
        }
      >();
      for (const row of rows) {
        const key = `${str(row.sourceSystem)}|${str(row.category)}`;
        if (
          rules.some(
            (r) =>
              str(r.sourceSystem) === str(row.sourceSystem) &&
              str(r.category) === str(row.category),
          )
        )
          continue;
        const group = groups.get(key) ?? {
          sourceSystem: str(row.sourceSystem),
          category: str(row.category),
          count: 0,
          titles: [],
        };
        group.count += 1;
        // Titles only: descriptions are sensitive and never leave for the model.
        if (group.titles.length < 5) group.titles.push(str(row.title));
        groups.set(key, group);
      }
      return [...groups.values()];
    },

    /** Re-matches unmatched-competency records of a category after its rule was confirmed. */
    async rematch(sourceSystem: string, category: string): Promise<number> {
      const competencyId = await ruleFor(sourceSystem, category);
      if (!competencyId) return 0;
      const rows = await database
        .query()
        .selectFrom('businessSignals')
        .select(['id', 'signalType', 'employeeId'])
        .where('sourceSystem', '=', sourceSystem)
        .where('category', '=', category)
        .where('matchStatus', '=', 'unmatchedCompetency')
        .execute();
      const quality: string[] = [];
      for (const row of rows) {
        await database
          .query()
          .updateTable('businessSignals')
          .set({ competencyId, matchStatus: 'matched', updatedAt: new Date() })
          .where('id', '=', str(row.id))
          .execute();
        if (row.signalType === 'qualityIssue') quality.push(str(row.id));
      }
      if (quality.length) hooks.onQualityMatched(quality);
      return rows.length;
    },

    importTemplate(): Uint8Array {
      const sheet = XLSX.utils.aoa_to_sheet([
        [...IMPORT_HEADER],
        [
          'qms',
          'QI-2026-0500',
          'qualityIssue',
          '首件检验',
          'minor',
          '首件尺寸超差',
          '',
          new Date().toISOString().slice(0, 10),
          'QH2001',
          '',
          '',
        ],
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'signals');
      return XLSX.write(book, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Uint8Array;
    },

    /** Excel import by HR: the same validation and matching as a push, row by row. */
    async importFile(
      ctx: ActorContext,
      bytes: Uint8Array,
    ): Promise<IngestResult> {
      await authorizeAction(ctx.authz, SIGNAL, 'import');
      let book: XLSX.WorkBook;
      try {
        book = XLSX.read(bytes, { type: 'array', cellDates: true });
      } catch {
        throw new HrError('SIGNAL_IMPORT_UNREADABLE', 400);
      }
      const sheet = book.Sheets[book.SheetNames[0] ?? ''];
      if (!sheet) throw new HrError('SIGNAL_IMPORT_UNREADABLE', 400);
      const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: '',
      });
      const header = (rows[0] ?? []).map((cell) => str(cell).trim());
      const items = rows
        .slice(1)
        .filter((r) => r.some((cell) => str(cell).trim()));
      if (items.length > INGEST_LIMIT)
        throw new HrError('SIGNAL_BATCH_TOO_LARGE', 400, { max: INGEST_LIMIT });
      const parsed = items.map((cells) => {
        const item: Record<string, unknown> = {};
        header.forEach((name, i) => {
          const at = (IMPORT_HEADER as readonly string[]).indexOf(name);
          const value = cells[i];
          if (at >= 0)
            item[IMPORT_KEYS[at]] =
              value instanceof Date ? value.toISOString() : value;
          else if (name) item[name] = value;
        });
        return item;
      });
      return ingestItems(parsed, 'import', ctx.userId);
    },

    /** The list as a workbook, administrator-added fields included. */
    async exportFile(
      ctx: ActorContext,
      filters: SignalFilters,
    ): Promise<Uint8Array> {
      const { items } = await service.list(ctx, filters);
      const defs = (await definitions()).filter(
        (d) => d.placements.includes('export') || d.placements.includes('list'),
      );
      const admin = await platform.can(ctx, SIGNAL, 'import');
      const visible = defs.filter((d) => admin || !d.sensitive);
      const sheet = XLSX.utils.aoa_to_sheet([
        [
          '来源系统',
          '编号',
          '类型',
          '当事人',
          '部门',
          '能力项',
          '严重程度',
          '发生时间',
          '匹配状态',
          '8D 编号',
          ...visible.map((d) => fieldLabel(d, 'zh-CN')),
        ],
        ...items.map((s) => [
          s.sourceSystem,
          s.externalId,
          s.signalType,
          s.employeeName ?? s.personKey,
          s.departmentTitle ?? '',
          s.competencyTitle ?? '',
          s.severity ?? '',
          dateOnly(s.occurredAt) ?? '',
          s.matchStatus,
          s.correctiveActionRef ?? '',
          ...visible.map((d) => displayValue(d, s.customFields[d.key])),
        ]),
      ]);
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(book, sheet, 'signals');
      return XLSX.write(book, {
        type: 'buffer',
        bookType: 'xlsx',
      }) as Uint8Array;
    },

    /**
     * An employee's records for the profile timeline and the analyst: every
     * record for readers of the business data in scope, one's own to the
     * person. `summary` only for those readers and the person.
     */
    async forEmployee(
      ctx: ActorContext,
      employeeId: string,
      options: { sinceDays?: number } = {},
    ): Promise<SignalView[]> {
      const own =
        (await platform.employeeOfUser(ctx.userId))?.id === employeeId;
      const policies = await tryAuthorizeAction(ctx.authz, SIGNAL, 'view');
      let rows: Record<string, unknown>[] = [];
      if (policies?.businessSignals)
        rows = await database
          .repository('businessSignals')
          .withPolicy(policyOf(policies, 'businessSignals'))
          .findMany({ filter: { employeeId } });
      if (!rows.length && own)
        rows = await database
          .query()
          .selectFrom('businessSignals')
          .selectAll()
          .where('employeeId', '=', employeeId)
          .execute();
      const since = options.sinceDays
        ? Date.now() - options.sinceDays * 86_400_000
        : 0;
      rows = rows
        .filter((r) => r.matchStatus !== 'ignored')
        .filter((r) => new Date(iso(r.occurredAt) ?? 0).getTime() >= since)
        .sort((a, b) =>
          (iso(b.occurredAt) ?? '').localeCompare(iso(a.occurredAt) ?? ''),
        );
      const context = {
        names: await names([employeeId]),
        competencies: await competencyTitles(),
        defs: await definitions(),
        admin: false,
        summary: true,
      };
      const views: SignalView[] = [];
      for (const row of rows) views.push(await toView(row, context));
      return views;
    },
  };
  return service;
}

export type SignalService = ReturnType<typeof createSignalService>;
