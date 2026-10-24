import { z } from 'zod';
import type { DatabaseConnection } from '@nocobase/db';

// Verified against the .30 release source, not a newer package's schema.
export const legacySource = {
  sourcePackage: '@nocobase/app-plugin-ai-employee',
  sourceVersion: '1.0.0-beta.30',
} as const;
export const legacySourceUrl =
  'https://github.com/nocobase/nocobase3/tree/6f38530/packages/plugins/app-plugin-ai-employee';

export function legacyId(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string' && value.length) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value))
    return String(value);
  throw new Error('INVALID_LEGACY_ID');
}
export function jsonField(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error('INVALID_LEGACY_JSON');
  }
}
export const record = (value: unknown): Record<string, unknown> =>
  z.record(z.string(), z.unknown()).parse(value);
export const list = (value: unknown): unknown[] =>
  value == null ? [] : z.array(z.unknown()).parse(value);
export const stamp = (value: unknown) => {
  if (value == null) throw new Error('INVALID_LEGACY_TIMESTAMP');
  return z.coerce.date().parse(value).toISOString();
};
export function fileReference(input: Record<string, unknown>) {
  const path = z.string().min(1).parse(input.path);
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some((p) => !p || p === '.' || p === '..') ||
    path.includes('%') ||
    [...path].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('INVALID_LEGACY_FILE_PATH');
  return {
    id: legacyId(input.id),
    disk: z.string().min(1).parse(input.disk),
    path,
    filename: z.string().min(1).parse(input.filename),
    mimetype: z.string().min(1).parse(input.mimetype),
    size: z.number().int().nonnegative().safe().parse(input.size),
  };
}
export type AssistantFileReference = ReturnType<typeof fileReference>;

/** Preserve legacy dates and large identifiers in JSON without rounding them. */
export function legacyJson(value: unknown): unknown {
  if (value instanceof Date) return stamp(value);
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(legacyJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, value]) => value !== undefined)
        .map(([key, value]) => [key, legacyJson(value)]),
    );
  return value;
}

/** Retained tables are physical sources, not registered Collections after plugin removal. */
export async function legacyRow(
  db: DatabaseConnection,
  collection: string,
  value: Record<string, unknown>,
) {
  const json: Record<string, string[]> = {
    aiConversations: ['options'],
    aiMessages: [
      'content',
      'toolCalls',
      'attachments',
      'workContext',
      'metadata',
    ],
    aiToolMessages: ['content', 'userDecision', 'interruptAction'],
    aiFiles: ['meta'],
    aiEmployees: [
      'chatSettings',
      'skillSettings',
      'modelSettings',
      'dataSourceSettings',
      'knowledgeBase',
    ],
    llmServices: ['options', 'enabledModels', 'modelOptions'],
    aiSettings: ['options'],
  };
  const definition = await db.collections.get(collection);
  const decoded = new Set(
    definition?.fields
      ?.filter((field) => field.type === 'json')
      .map((field) => field.name),
  );
  const row = { ...value };
  // Query decodes declared JSON fields. Undeclared SQLite TEXT fields still carry JSON text.
  // Inspect the field contract instead of guessing whether a scalar string has already been decoded.
  for (const key of json[collection] ?? [])
    if (row[key] != null && !decoded.has(key)) row[key] = jsonField(row[key]);
  for (const key of ['createdAt', 'updatedAt'])
    if (row[key] != null) row[key] = stamp(row[key]);
  for (const key of [
    'enabled',
    'builtIn',
    'deprecated',
    'enableKnowledgeBase',
    'read',
    'auto',
  ])
    if (row[key] != null) {
      if (![true, false, 0, 1].includes(row[key] as never))
        throw new Error('UNMAPPED_LEGACY_BOOLEAN');
      row[key] = row[key] === true || row[key] === 1;
    }
  return row;
}
