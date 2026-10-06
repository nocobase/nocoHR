/**
 * 界面追加字段 (总纲 可定制约定): administrators add fields to a business table
 * and choose where each appears. Definitions live in `customFieldDefinitions`,
 * values in the table's `customFields` JSON column keyed by the definition's
 * internal key. Both are data, so upgrades leave them alone.
 *
 * The service is the single place that validates and coerces values, drops
 * keys nobody defined, and hides sensitive fields from readers without the
 * table's sensitive capability. Callers decide who may read or write the
 * record itself; this module only shapes the custom part.
 */
import { randomBytes } from 'node:crypto';

import type { DatabaseConnection, DatabaseManager } from '@nocobase/db';
import { z } from 'zod';

import type { ActorContext } from './framework-service.js';
import { PERSONNEL_SETTINGS_AUTH } from './personnel-settings.js';
import { HrError, isRecord, newId, str } from './shared.js';

/** Tables opened for extension; later steps add theirs here (V3-08: the framework tables, migration 202610020001). */
export const EXTENSIBLE_COLLECTIONS = [
  'employees',
  'competencies',
  'competencyLevels',
  'positionRequirements',
  // V2-05 (migration 202609300005).
  'leaveRequests',
  'attendanceAdjustments',
  'shifts',
  // V3-11 业务数据 (migration 202610080001).
  'businessSignals',
  // V2-07 候选人 (migration 202610090001).
  'candidates',
  // V4-12 考核方案 (migration 202610100001).
  'reviewSchemes',
  // V4-13 内训师档案、实操考核 (migration 202610110001).
  'instructorProfiles',
  'practicalAssessments',
  // 组织与岗位 (migration 202610210001): industries describe their units and posts.
  'departments',
  'positions',
] as const;
export type ExtensibleCollection = (typeof EXTENSIBLE_COLLECTIONS)[number];

export const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiSelect',
  'boolean',
] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

/**
 * Where a field appears. detail/list/filter/import/export apply to the table
 * itself; onboardForm and selfService are the documents that carry an
 * employee field (V1-02): the onboarding action and the change request;
 * form is the table's own submission form (请假单, 补卡/加班/调班申请);
 * publicApply is the public careers form a candidate fills in (V2-07).
 */
export const CUSTOM_FIELD_PLACEMENTS = [
  'detail',
  'list',
  'filter',
  'import',
  'export',
  'onboardForm',
  'selfService',
  'form',
  'publicApply',
] as const;
export type CustomFieldPlacement = (typeof CUSTOM_FIELD_PLACEMENTS)[number];

/** Where a table's fields can appear: the framework tables have no import, onboarding or self-service. */
export const COLLECTION_PLACEMENTS: Record<
  ExtensibleCollection,
  readonly CustomFieldPlacement[]
> = {
  employees: [
    'detail',
    'list',
    'filter',
    'import',
    'export',
    'onboardForm',
    'selfService',
  ],
  competencies: ['detail', 'list'],
  competencyLevels: ['detail', 'list'],
  positionRequirements: ['detail', 'list'],
  leaveRequests: ['form', 'detail'],
  attendanceAdjustments: ['form', 'detail'],
  shifts: ['detail', 'list'],
  businessSignals: ['detail', 'list', 'filter', 'import', 'export'],
  candidates: ['detail', 'list', 'publicApply'],
  reviewSchemes: ['detail', 'list', 'form'],
  instructorProfiles: ['detail', 'list', 'form'],
  practicalAssessments: ['detail', 'list', 'form'],
  departments: ['detail', 'form'],
  positions: ['detail', 'form'],
};

/**
 * 受保护特征 (V2-07, 总纲 AI 约定): a field about sex, age, marriage, ethnicity
 * and the like is never given to AI employees. Judged on the key and both
 * labels; recruiting also filters with it when it reads.
 */
export const PROTECTED_CHARACTERISTIC =
  /(gender|sex|\bage\b|birth|marital|married|child|ethnic|nation|native|hukou|religion|faith|politic|party|photo|height|weight|health|性别|年龄|出生|生日|婚|生育|子女|民族|籍贯|户籍|户口|宗教|信仰|政治|党员|照片|身高|体重|健康)/iu;

function assertAiReadable(definition: {
  collection: ExtensibleCollection;
  label: { 'zh-CN': string; 'en-US': string | null };
  aiReadable: boolean;
}) {
  if (
    definition.aiReadable &&
    definition.collection === 'candidates' &&
    PROTECTED_CHARACTERISTIC.test(
      `${definition.label['zh-CN']} ${definition.label['en-US'] ?? ''}`,
    )
  )
    throw new HrError('CUSTOM_FIELD_PROTECTED_AI', 400);
}

export const MAX_FIELDS_PER_COLLECTION = 50;

export interface CustomFieldOption {
  value: string;
  label: string;
  active: boolean;
}

export interface CustomFieldDefinition {
  id: string;
  collection: ExtensibleCollection;
  key: string;
  label: { 'zh-CN': string; 'en-US': string | null };
  type: CustomFieldType;
  options: CustomFieldOption[];
  required: boolean;
  defaultValue: unknown;
  placements: CustomFieldPlacement[];
  sensitive: boolean;
  aiReadable: boolean;
  sortOrder: number;
  active: boolean;
  updatedBy: string | null;
  updatedAt: string;
}

const optionSchema = z
  .object({
    value: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(64),
    active: z.boolean().default(true),
  })
  .strict();

const definitionSchema = z
  .object({
    collection: z.enum(EXTENSIBLE_COLLECTIONS),
    label: z
      .object({
        'zh-CN': z.string().trim().min(1).max(40),
        'en-US': z.string().trim().max(60).nullable().default(null),
      })
      .strict(),
    type: z.enum(CUSTOM_FIELD_TYPES),
    options: z.array(optionSchema).max(50).default([]),
    required: z.boolean().default(false),
    defaultValue: z.unknown().optional(),
    placements: z
      .array(z.enum(CUSTOM_FIELD_PLACEMENTS))
      .max(CUSTOM_FIELD_PLACEMENTS.length)
      .default(['detail']),
    sensitive: z.boolean().default(false),
    aiReadable: z.boolean().default(false),
  })
  .strict();

// The type and the collection are fixed once created: stored values keep their meaning.
const patchSchema = definitionSchema
  .omit({ collection: true, type: true })
  .partial()
  .strict();

function parseJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function toDefinition(row: Record<string, unknown>): CustomFieldDefinition {
  const label = parseJson<Record<string, string | null>>(row.label, {});
  return {
    id: str(row.id),
    collection: str(row.collection) as ExtensibleCollection,
    key: str(row.key),
    label: {
      'zh-CN': str(label['zh-CN'] ?? ''),
      'en-US': label['en-US'] == null ? null : str(label['en-US']),
    },
    type: str(row.type) as CustomFieldType,
    options: parseJson<CustomFieldOption[]>(row.options, []),
    required: row.required === true || row.required === 1,
    defaultValue: parseJson<unknown>(row.defaultValue, null),
    placements: parseJson<CustomFieldPlacement[]>(row.placements, []),
    sensitive: row.sensitive === true || row.sensitive === 1,
    aiReadable: row.aiReadable === true || row.aiReadable === 1,
    sortOrder: Number(row.sortOrder ?? 0),
    active: row.active === true || row.active === 1,
    updatedBy: row.updatedBy == null ? null : str(row.updatedBy),
    updatedAt: new Date(str(row.updatedAt)).toISOString(),
  };
}

/** A scalar as text; anything else as JSON, never "[object Object]". */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return value == null ? '' : JSON.stringify(value);
}

/** A placement's label, for the display name of a field in a given language. */
export function fieldLabel(
  definition: CustomFieldDefinition,
  locale: string,
): string {
  return locale.startsWith('en')
    ? (definition.label['en-US'] ?? definition.label['zh-CN'])
    : definition.label['zh-CN'];
}

/**
 * One value checked against its definition: the stored shape, or an error
 * code. Empty input (undefined, null, '') means "no value".
 */
export function coerceValue(
  definition: CustomFieldDefinition,
  value: unknown,
): { ok: true; value: unknown } | { ok: false; code: string } {
  const empty =
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.trim() === '') ||
    (Array.isArray(value) && value.length === 0);
  if (empty) return { ok: true, value: null };
  const activeOptions = new Set(
    definition.options.filter((o) => o.active).map((o) => o.value),
  );
  switch (definition.type) {
    case 'text':
    case 'textarea': {
      if (typeof value !== 'string' && typeof value !== 'number')
        return { ok: false, code: 'CUSTOM_FIELD_TYPE' };
      const text = asText(value).trim();
      const max = definition.type === 'text' ? 200 : 2000;
      if (text.length > max)
        return { ok: false, code: 'CUSTOM_FIELD_TOO_LONG' };
      return { ok: true, value: text };
    }
    case 'number': {
      const number =
        typeof value === 'number' ? value : Number(asText(value).trim());
      if (!Number.isFinite(number))
        return { ok: false, code: 'CUSTOM_FIELD_TYPE' };
      return { ok: true, value: number };
    }
    case 'date': {
      const text = asText(value).trim().slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(text)))
        return { ok: false, code: 'CUSTOM_FIELD_TYPE' };
      return { ok: true, value: text };
    }
    case 'boolean': {
      if (typeof value === 'boolean') return { ok: true, value };
      const text = asText(value).trim().toLowerCase();
      if (['true', '1', '是', 'yes', 'y'].includes(text))
        return { ok: true, value: true };
      if (['false', '0', '否', 'no', 'n'].includes(text))
        return { ok: true, value: false };
      return { ok: false, code: 'CUSTOM_FIELD_TYPE' };
    }
    case 'select': {
      const text = asText(value).trim();
      // An import may carry the option's label; store its value.
      const byLabel = definition.options.find(
        (o) => o.active && o.label === text,
      );
      const chosen = activeOptions.has(text) ? text : byLabel?.value;
      if (!chosen) return { ok: false, code: 'CUSTOM_FIELD_OPTION' };
      return { ok: true, value: chosen };
    }
    case 'multiSelect': {
      const items = Array.isArray(value)
        ? value.map((v) => asText(v).trim())
        : asText(value)
            .split(/[,，、;；]/u)
            .map((v) => v.trim())
            .filter(Boolean);
      const chosen: string[] = [];
      for (const item of items) {
        const byLabel = definition.options.find(
          (o) => o.active && o.label === item,
        );
        const next = activeOptions.has(item) ? item : byLabel?.value;
        if (!next) return { ok: false, code: 'CUSTOM_FIELD_OPTION' };
        if (!chosen.includes(next)) chosen.push(next);
      }
      return { ok: true, value: chosen };
    }
  }
}

/** A stored value as text, for exports, notifications and AI tools. */
export function displayValue(
  definition: CustomFieldDefinition,
  value: unknown,
  locale = 'zh-CN',
): string {
  if (value == null || value === '') return '';
  const optionLabel = (v: string) =>
    definition.options.find((o) => o.value === v)?.label ?? v;
  switch (definition.type) {
    case 'select':
      return optionLabel(asText(value));
    case 'multiSelect':
      return (Array.isArray(value) ? value : [value])
        .map((v) => optionLabel(asText(v)))
        .join('、');
    case 'boolean':
      return value === true
        ? locale.startsWith('en')
          ? 'Yes'
          : '是'
        : locale.startsWith('en')
          ? 'No'
          : '否';
    default:
      return asText(value);
  }
}

export function readValues(stored: unknown): Record<string, unknown> {
  const values = parseJson<unknown>(stored, {});
  return isRecord(values) ? values : {};
}

export interface CustomFieldReadOptions {
  /** The caller may read the table's sensitive fields (HR administrators and the person). */
  sensitive: boolean;
  /** Only fields with one of these placements. */
  placement?: CustomFieldPlacement;
  /** Include inactive fields (the detail page shows their stored values). */
  includeInactive?: boolean;
  /** Only fields AI employees may read. */
  aiOnly?: boolean;
}

function newKey(): string {
  return `cf_${randomBytes(4).toString('hex')}`;
}

export function createCustomFieldService(database: DatabaseManager) {
  async function list(
    collection: ExtensibleCollection,
    connection?: DatabaseConnection,
  ): Promise<CustomFieldDefinition[]> {
    const rows = await (connection ? connection.query : database.query())
      .selectFrom('customFieldDefinitions')
      .selectAll()
      .where('collection', '=', collection)
      .orderBy('sortOrder', 'asc')
      .orderBy('createdAt', 'asc')
      .execute();
    return rows.map((row: Record<string, unknown>) => toDefinition(row));
  }

  function visible(
    definitions: readonly CustomFieldDefinition[],
    options: CustomFieldReadOptions,
  ): CustomFieldDefinition[] {
    return definitions.filter(
      (d) =>
        (options.includeInactive || d.active) &&
        (options.sensitive || !d.sensitive) &&
        (!options.aiOnly || d.aiReadable) &&
        (!options.placement || d.placements.includes(options.placement)),
    );
  }

  /**
   * Validates submitted values for a write. Only the given definitions are
   * writable; unknown keys are dropped, inactive fields are ignored, and a
   * required field may not be cleared. `existing` merges a partial update.
   */
  function prepare(
    definitions: readonly CustomFieldDefinition[],
    input: unknown,
    existing: Record<string, unknown> = {},
    options: { enforceRequired?: boolean } = {},
  ): Record<string, unknown> {
    // Nothing sent keeps the stored values, but a submission still checks its required fields.
    if (input === undefined && !options.enforceRequired) return existing;
    input ??= {};
    if (!isRecord(input)) throw new HrError('INVALID_INPUT', 400);
    const next = { ...existing };
    const errors: Record<string, string> = {};
    for (const definition of definitions) {
      if (!definition.active) continue;
      if (!(definition.key in input)) continue;
      const result = coerceValue(definition, input[definition.key]);
      if (!result.ok) {
        errors[definition.key] = result.code;
        continue;
      }
      if (result.value === null) delete next[definition.key];
      else next[definition.key] = result.value;
    }
    if (options.enforceRequired)
      for (const definition of definitions)
        if (
          definition.active &&
          definition.required &&
          next[definition.key] == null
        )
          errors[definition.key] = 'CUSTOM_FIELD_REQUIRED';
    if (Object.keys(errors).length)
      throw new HrError('CUSTOM_FIELD_INVALID', 400, { fields: errors });
    return next;
  }

  /** The values a reader may see, restricted to the visible definitions. */
  function project(
    definitions: readonly CustomFieldDefinition[],
    stored: unknown,
    options: CustomFieldReadOptions,
  ): Record<string, unknown> {
    const values = readValues(stored);
    const out: Record<string, unknown> = {};
    for (const definition of visible(definitions, options))
      if (values[definition.key] != null)
        out[definition.key] = values[definition.key];
    return out;
  }

  return {
    list,
    visible,
    prepare,
    project,

    /** Definitions for rendering: every signed-in user reads the active, non-sensitive ones; sensitive ones only with the capability. */
    async forReader(
      collection: ExtensibleCollection,
      options: CustomFieldReadOptions,
    ): Promise<CustomFieldDefinition[]> {
      return visible(await list(collection), options);
    },

    /** The settings page: every definition, active or not. */
    async listForAdmin(ctx: ActorContext, collection: string) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const parsed = z.enum(EXTENSIBLE_COLLECTIONS).safeParse(collection);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const definitions = await list(parsed.data);
      const counts = await filledCounts(parsed.data);
      return definitions.map((d) => ({ ...d, filled: counts.get(d.key) ?? 0 }));
    },

    async create(ctx: ActorContext, input: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const parsed = definitionSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      const value = parsed.data;
      checkOptions(value.type, value.options);
      assertAiReadable(value);
      return database.transaction(async (connection) => {
        const existing = await list(value.collection, connection);
        if (existing.length >= MAX_FIELDS_PER_COLLECTION)
          throw new HrError('CUSTOM_FIELD_LIMIT', 400);
        if (
          existing.some(
            (d) => d.active && d.label['zh-CN'] === value.label['zh-CN'],
          )
        )
          throw new HrError('CUSTOM_FIELD_DUPLICATE_LABEL', 409);
        const draft = toDefinition({
          id: 'draft',
          collection: value.collection,
          key: 'draft',
          label: value.label,
          type: value.type,
          options: value.options,
          placements: value.placements,
          updatedAt: new Date().toISOString(),
        });
        const defaultValue = normalizeDefault(draft, value.defaultValue);
        const stamp = new Date();
        const id = newId();
        let key = newKey();
        while (existing.some((d) => d.key === key)) key = newKey();
        await connection.query
          .insertInto('customFieldDefinitions')
          .values({
            id,
            collection: value.collection,
            key,
            label: JSON.stringify(value.label),
            type: value.type,
            options: JSON.stringify(value.options),
            required: value.required,
            defaultValue: JSON.stringify(defaultValue),
            placements: JSON.stringify(sanitizePlacements(value)),
            sensitive: value.sensitive,
            aiReadable: value.aiReadable,
            sortOrder: existing.length
              ? Math.max(...existing.map((d) => d.sortOrder)) + 1
              : 0,
            active: true,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
            createdAt: stamp,
            updatedAt: stamp,
          })
          .execute();
        return (await list(value.collection, connection)).find(
          (d) => d.id === id,
        )!;
      });
    },

    async update(ctx: ActorContext, id: string, input: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const parsed = patchSchema.safeParse(input);
      if (!parsed.success) throw new HrError('INVALID_INPUT', 400);
      // `.partial()` keeps the create schema's defaults (zod fills them in for absent keys),
      // so only the keys the caller sent are a change; a PATCH of {required} leaves placements alone.
      const sent = new Set(Object.keys(input as Record<string, unknown>));
      const patch = Object.fromEntries(
        Object.entries(parsed.data).filter(([key]) => sent.has(key)),
      ) as typeof parsed.data;
      return database.transaction(async (connection) => {
        const row = await connection.query
          .selectFrom('customFieldDefinitions')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new HrError('NOT_FOUND', 404);
        const current = toDefinition(row);
        if (patch.options) {
          checkOptions(current.type, patch.options);
          // Options in use are kept: they can be disabled, never removed.
          const kept = new Set(patch.options.map((o) => o.value));
          if (current.options.some((o) => !kept.has(o.value)))
            throw new HrError('CUSTOM_FIELD_OPTION_REMOVED', 400);
        }
        const next = {
          ...current,
          ...patch,
          label: patch.label ?? current.label,
          options: patch.options ?? current.options,
        };
        // A rename can make an AI-readable candidate field protected, so check the result.
        assertAiReadable(next);
        const values: Record<string, unknown> = {
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        };
        if (patch.label) {
          const others = (await list(current.collection, connection)).filter(
            (d) => d.id !== id && d.active,
          );
          if (others.some((d) => d.label['zh-CN'] === patch.label!['zh-CN']))
            throw new HrError('CUSTOM_FIELD_DUPLICATE_LABEL', 409);
          values.label = JSON.stringify(patch.label);
        }
        if (patch.options) values.options = JSON.stringify(patch.options);
        if (patch.required !== undefined) values.required = patch.required;
        if (patch.placements !== undefined || patch.sensitive !== undefined)
          values.placements = JSON.stringify(sanitizePlacements(next));
        if (patch.sensitive !== undefined) values.sensitive = patch.sensitive;
        if (patch.aiReadable !== undefined)
          values.aiReadable = patch.aiReadable;
        if (patch.defaultValue !== undefined)
          values.defaultValue = JSON.stringify(
            normalizeDefault(next, patch.defaultValue),
          );
        await connection.query
          .updateTable('customFieldDefinitions')
          .set(values)
          .where('id', '=', id)
          .execute();
        return (await list(current.collection, connection)).find(
          (d) => d.id === id,
        )!;
      });
    },

    /** Deactivates or re-activates a field; values stay stored either way. */
    async setActive(ctx: ActorContext, id: string, active: boolean) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const row = await database
        .query()
        .selectFrom('customFieldDefinitions')
        .select(['collection'])
        .where('id', '=', id)
        .executeTakeFirst();
      if (!row) throw new HrError('NOT_FOUND', 404);
      await database
        .query()
        .updateTable('customFieldDefinitions')
        .set({ active, updatedBy: ctx.userId, updatedAt: new Date() })
        .where('id', '=', id)
        .execute();
      return (await list(str(row.collection) as ExtensibleCollection)).find(
        (d) => d.id === id,
      )!;
    },

    async reorder(ctx: ActorContext, collection: string, ids: unknown) {
      await ctx.authz.require(PERSONNEL_SETTINGS_AUTH);
      const parsedCollection = z
        .enum(EXTENSIBLE_COLLECTIONS)
        .safeParse(collection);
      const parsedIds = z
        .array(z.string().min(1).max(64))
        .max(200)
        .safeParse(ids);
      if (!parsedCollection.success || !parsedIds.success)
        throw new HrError('INVALID_INPUT', 400);
      await database.transaction(async (connection) => {
        const existing = await list(parsedCollection.data, connection);
        const known = new Set(existing.map((d) => d.id));
        if (parsedIds.data.some((id) => !known.has(id)))
          throw new HrError('INVALID_INPUT', 400);
        let order = 0;
        for (const id of parsedIds.data)
          await connection.query
            .updateTable('customFieldDefinitions')
            .set({ sortOrder: order++, updatedAt: new Date() })
            .where('id', '=', id)
            .execute();
      });
      return list(parsedCollection.data);
    },
  };

  async function filledCounts(
    collection: ExtensibleCollection,
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const rows = await database
      .query()
      .selectFrom(collection)
      .select(['customFields'])
      .where('customFields', 'is not', null)
      .execute();
    for (const row of rows)
      for (const [key, value] of Object.entries(readValues(row.customFields)))
        if (value != null) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }
}

function checkOptions(
  type: CustomFieldType,
  options: readonly CustomFieldOption[],
) {
  const choice = type === 'select' || type === 'multiSelect';
  if (choice && !options.some((o) => o.active))
    throw new HrError('CUSTOM_FIELD_OPTIONS_REQUIRED', 400);
  if (!choice && options.length) throw new HrError('INVALID_INPUT', 400);
  if (new Set(options.map((o) => o.value)).size !== options.length)
    throw new HrError('INVALID_INPUT', 400);
}

function normalizeDefault(
  definition: CustomFieldDefinition,
  value: unknown,
): unknown {
  if (value === undefined) return null;
  const result = coerceValue(definition, value);
  if (!result.ok)
    throw new HrError('CUSTOM_FIELD_INVALID', 400, {
      fields: { defaultValue: result.code },
    });
  return result.value;
}

/** A sensitive field never becomes self-service editable or AI readable through placements. */
function sanitizePlacements(definition: {
  collection: ExtensibleCollection;
  placements?: readonly CustomFieldPlacement[];
  sensitive?: boolean;
}): CustomFieldPlacement[] {
  const allowed = COLLECTION_PLACEMENTS[definition.collection];
  const placements = [...new Set(definition.placements ?? [])].filter((p) =>
    allowed.includes(p),
  );
  return definition.sensitive
    ? placements.filter((p) => p !== 'selfService')
    : placements;
}

export type CustomFieldService = ReturnType<typeof createCustomFieldService>;
