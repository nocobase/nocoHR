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
import type { SharingRule } from '@nocobase/authorization/sharing-rules';

export type {
  AuthorizationOptionsResponse,
  AuthorizationRecordOption,
  AuthorizationSubject,
  LocalizedText,
  RecordSelection,
  ResourceRef,
  SharingRule,
};

export type SharingRuleAction = SharingRule['actions'][number];

export const SHARING_RULES_SETTINGS = {
  type: 'settings',
  id: 'authorization.sharing-rules',
} as const;

export type SharingRulePatch = Partial<
  Omit<SharingRule, 'key' | 'title' | 'reason'>
> & {
  readonly title?: SharingRule['title'] | null;
  readonly reason?: string | null;
};

export interface SharingRuleList {
  readonly data: readonly SharingRule[];
  readonly meta: { readonly total: number };
}

export interface SharingRuleRecordPage {
  readonly data: readonly AuthorizationRecordOption[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
  };
}

export interface SharingRulesOutletContext {
  readonly reload: () => Promise<readonly SharingRule[]>;
  readonly onForbidden: () => void;
}

export function listSharingRules(api: ApiClient): Promise<SharingRuleList> {
  return api.request<SharingRuleList>({ path: 'authorization/sharingRules' });
}

export async function createSharingRule(
  api: ApiClient,
  rule: SharingRule,
): Promise<SharingRule> {
  const { data } = await api.request<{ data: SharingRule }>({
    path: 'authorization/sharingRules',
    method: 'POST',
    json: rule,
  });
  return data;
}

export async function patchSharingRule(
  api: ApiClient,
  key: string,
  patch: SharingRulePatch,
): Promise<SharingRule> {
  const { data } = await api.request<{ data: SharingRule }>({
    path: `authorization/sharingRules/${encodeURIComponent(key)}`,
    method: 'PATCH',
    json: patch,
  });
  return data;
}

export async function deleteSharingRule(
  api: ApiClient,
  key: string,
): Promise<void> {
  await api.request<void>({
    path: `authorization/sharingRules/${encodeURIComponent(key)}`,
    method: 'DELETE',
  });
}

export async function listSharingRuleRecords(
  api: ApiClient,
  collection: string,
  page: number,
): Promise<SharingRuleRecordPage> {
  return api.request<SharingRuleRecordPage>({
    path: `authorization/sharingRules/records/${encodeURIComponent(collection)}`,
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

export function sharingRuleName(
  rule: Pick<SharingRule, 'key' | 'title'>,
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

export function emptySharingFilter(): unknown {
  return {
    kind: 'group',
    logic: 'and',
    items: [{ kind: 'condition', path: ['id'], operator: '$eq', value: '' }],
  };
}
