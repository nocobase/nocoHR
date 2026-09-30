import { useMemo } from 'react';

import { useRemote } from './use-remote.js';

/**
 * 界面追加字段 (总纲 可定制约定): definitions, the hook that loads them and the
 * helpers shared by the components in `custom-fields.tsx` and the pages.
 */
/** A scalar as text; anything else as JSON, never "[object Object]". */
export function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return value == null ? '' : JSON.stringify(value);
}

export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multiSelect'
  | 'boolean';
export type CustomFieldPlacement =
  | 'detail'
  | 'list'
  | 'filter'
  | 'import'
  | 'export'
  | 'onboardForm'
  | 'selfService'
  | 'form'
  | 'publicApply';

const EMPLOYEE_PLACEMENTS: readonly CustomFieldPlacement[] = [
  'detail',
  'list',
  'filter',
  'import',
  'export',
  'onboardForm',
  'selfService',
];

/** The tables open for added fields and where their fields can appear; mirrors the server's COLLECTION_PLACEMENTS. */
export const COLLECTION_PLACEMENTS = {
  employees: EMPLOYEE_PLACEMENTS,
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
} as const satisfies Record<string, readonly CustomFieldPlacement[]>;
export type ExtensibleCollection = keyof typeof COLLECTION_PLACEMENTS;
export const EXTENSIBLE_COLLECTIONS = Object.keys(
  COLLECTION_PLACEMENTS,
) as ExtensibleCollection[];

export function placementsOf(
  collection: string,
): readonly CustomFieldPlacement[] {
  return (
    (COLLECTION_PLACEMENTS as Record<string, readonly CustomFieldPlacement[]>)[
      collection
    ] ?? ['detail']
  );
}

export interface CustomFieldDefinition {
  id: string;
  collection: string;
  key: string;
  label: { 'zh-CN': string; 'en-US': string | null };
  type: CustomFieldType;
  options: { value: string; label: string; active: boolean }[];
  required: boolean;
  defaultValue: unknown;
  placements: CustomFieldPlacement[];
  sensitive: boolean;
  aiReadable: boolean;
  sortOrder: number;
  active: boolean;
}

export type CustomValues = Record<string, unknown>;

/** The definitions of one table, optionally narrowed to a placement (inactive ones only on request). */
export function useCustomFieldDefinitions(
  collection: string,
  placement?: CustomFieldPlacement,
  includeInactive = false,
) {
  const remote = useRemote<CustomFieldDefinition[]>(
    'talent/custom-fields/definitions',
    { collection, includeInactive: includeInactive ? 'true' : undefined },
  );
  const definitions = useMemo(
    () =>
      // A caller whose API returns something else (a test mock) sees no added fields.
      (Array.isArray(remote.data) ? remote.data : []).filter(
        (d) =>
          (includeInactive || d.active) &&
          (!placement || d.placements.includes(placement)),
      ),
    [remote.data, placement, includeInactive],
  );
  return { ...remote, definitions };
}

export function fieldLabel(
  definition: CustomFieldDefinition,
  language: string,
): string {
  return language.startsWith('en')
    ? (definition.label['en-US'] ?? definition.label['zh-CN'])
    : definition.label['zh-CN'];
}

/** A stored value as text: option labels, 是/否, joined lists. */
export function displayValue(
  definition: CustomFieldDefinition,
  value: unknown,
  yes: string,
  no: string,
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
      return value === true ? yes : no;
    default:
      return asText(value);
  }
}

/** Drops empty strings so the server sees "no value" rather than a blank text. */
export function compactValues(values: CustomValues): CustomValues {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [
      key,
      value === '' ? null : value,
    ]),
  );
}

/** The per-field error codes of a `CUSTOM_FIELD_INVALID` answer. */
export function customFieldErrors(details: unknown): Record<string, string> {
  if (!details || typeof details !== 'object') return {};
  const fields = (details as { fields?: unknown }).fields;
  return fields && typeof fields === 'object'
    ? (fields as Record<string, string>)
    : {};
}
