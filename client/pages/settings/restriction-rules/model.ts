import type { ApiClient } from '@nocobase/app-client';
import type {
  AuthorizationOptionsResponse,
  AuthorizationSubject,
  AuthorizationRecordOption,
  LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import type {
  RecordSelection,
  ResourceRef,
} from '@nocobase/authorization/core';
import type { RestrictionRule } from '@nocobase/authorization/restriction-rules';

export type {
  AuthorizationOptionsResponse,
  AuthorizationRecordOption,
  AuthorizationSubject,
  LocalizedText,
  RecordSelection,
  ResourceRef,
  RestrictionRule,
};

export type RestrictionRuleAction = RestrictionRule['actions'][number];

export const RESTRICTION_RULES_SETTINGS = {
  type: 'settings',
  id: 'authorization.restriction-rules',
} as const;

export type RestrictionRulePatch = Partial<
  Omit<RestrictionRule, 'title' | 'reason'>
> & {
  readonly title?: RestrictionRule['title'] | null;
  readonly reason?: string | null;
};

const RESERVED_RULE_KEYS = new Set(['options', 'subjects', 'records']);

export function isReservedRestrictionRuleKey(key: string): boolean {
  return RESERVED_RULE_KEYS.has(key);
}

export interface RestrictionRuleList {
  readonly data: readonly RestrictionRule[];
  readonly meta: { readonly total: number };
}

export interface RestrictionRuleRecordPage {
  readonly data: readonly AuthorizationRecordOption[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
  };
}

export interface RestrictionRulesOutletContext {
  readonly reload: () => Promise<readonly RestrictionRule[]>;
  readonly onForbidden: () => void;
}

export function listRestrictionRules(
  api: ApiClient,
): Promise<RestrictionRuleList> {
  return api.request<RestrictionRuleList>({
    path: 'authorization/restrictionRules',
  });
}

export async function createRestrictionRule(
  api: ApiClient,
  rule: RestrictionRule,
): Promise<RestrictionRule> {
  const { data } = await api.request<{ data: RestrictionRule }>({
    path: 'authorization/restrictionRules',
    method: 'POST',
    json: rule,
  });
  return data;
}

export async function patchRestrictionRule(
  api: ApiClient,
  key: string,
  patch: RestrictionRulePatch,
): Promise<RestrictionRule> {
  const { data } = await api.request<{ data: RestrictionRule }>({
    path: `authorization/restrictionRules/${encodeURIComponent(key)}`,
    method: 'PATCH',
    json: patch,
  });
  return data;
}

export async function deleteRestrictionRule(
  api: ApiClient,
  key: string,
): Promise<void> {
  await api.request<void>({
    path: `authorization/restrictionRules/${encodeURIComponent(key)}`,
    method: 'DELETE',
  });
}

export async function listRestrictionRuleRecords(
  api: ApiClient,
  collection: string,
  page: number,
): Promise<RestrictionRuleRecordPage> {
  return api.request<RestrictionRuleRecordPage>({
    path: `authorization/restrictionRules/records/${encodeURIComponent(collection)}`,
    query: { page, pageSize: 20 },
  });
}

export function stableValue(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (item && typeof item === 'object') {
      return Object.fromEntries(
        Object.keys(item)
          .sort()
          .map((key) => [key, normalize(Reflect.get(item, key))]),
      );
    }
    return item;
  };
  return JSON.stringify(normalize(value)) ?? 'undefined';
}

export function sameValue(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

export function restrictionRuleName(
  rule: Pick<RestrictionRule, 'key' | 'title'>,
  text: (value: LocalizedText) => string,
): string {
  const title = rule.title;
  if (typeof title === 'string' && title.trim()) return title;
  if (title && typeof title === 'object') return text(title);
  return rule.key;
}

export function subjectIdentity(subject: AuthorizationSubject): string {
  return JSON.stringify([subject.type, subject.id]);
}

export function recordAccessFilter(selection: RecordSelection): unknown {
  if (selection.type !== 'recordAccess' || selection.key !== 'customFilter')
    return undefined;
  return selection.params && typeof selection.params === 'object'
    ? Reflect.get(selection.params, 'filter')
    : undefined;
}

export function emptyRestrictionFilter(): unknown {
  return {
    kind: 'group',
    logic: 'and',
    items: [{ kind: 'condition', path: ['id'], operator: '$eq', value: '' }],
  };
}
