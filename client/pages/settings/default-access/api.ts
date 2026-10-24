import type { ApiClient } from '@nocobase/app-client';
import type { AuthorizationClient } from '@nocobase/app-plugin-authorization/client';
import type {
  AuthorizationOptionsResponse,
  DefaultAccessRecordOption,
  DefaultAccessRule,
} from './model.js';

export const DEFAULT_ACCESS_SETTINGS = {
  type: 'settings',
  id: 'authorization.default-access',
} as const;

const RESERVED_RULE_KEYS = new Set(['options', 'subjects', 'records']);

export function isReservedRuleKey(key: string): boolean {
  return RESERVED_RULE_KEYS.has(key);
}

export function defaultAccessRuleKey(resource: {
  type: string;
  id: string;
}): string {
  const key = `${resource.type}.${resource.id}`;
  if (isReservedRuleKey(key))
    throw new Error('The resource produces a reserved default-access key.');
  return key;
}

export function loadDefaultAccessOptions(
  authz: AuthorizationClient,
): Promise<AuthorizationOptionsResponse> {
  return authz.loadOptions('defaultAccess');
}

export async function listDefaultAccess(
  api: ApiClient,
): Promise<readonly DefaultAccessRule[]> {
  const { data } = await api.request<{
    data: readonly DefaultAccessRule[];
    meta: { total: number };
  }>({ path: 'authorization/defaultAccess' });
  return data;
}

export async function listDefaultAccessRecords(
  api: ApiClient,
  collection: string,
  query: { search: string; page: number; pageSize: number },
): Promise<{
  items: readonly DefaultAccessRecordOption[];
  total: number;
}> {
  const { data, meta } = await api.request<{
    data: readonly DefaultAccessRecordOption[];
    meta: { page: number; pageSize: number; total: number };
  }>({
    path: `authorization/defaultAccess/records/${encodeURIComponent(collection)}`,
    query: {
      q: query.search || undefined,
      page: query.page,
      pageSize: query.pageSize,
    },
  });
  return { items: data, total: meta.total };
}

export async function saveDefaultAccess(
  api: ApiClient,
  rule: DefaultAccessRule,
  existingKey?: string,
): Promise<DefaultAccessRule> {
  if (isReservedRuleKey(rule.key))
    throw new Error('The rule key is reserved by the default-access service.');
  const path = existingKey
    ? `authorization/defaultAccess/${encodeURIComponent(existingKey)}`
    : 'authorization/defaultAccess';
  const { data } = await api.request<{ data: DefaultAccessRule }>(
    existingKey
      ? { path, method: 'PATCH', json: { actions: rule.actions } }
      : { path, method: 'POST', json: rule },
  );
  return data;
}

export async function deleteDefaultAccess(
  api: ApiClient,
  key: string,
): Promise<void> {
  if (isReservedRuleKey(key))
    throw new Error('The rule key is reserved by the default-access service.');
  await api.request<void>({
    path: `authorization/defaultAccess/${encodeURIComponent(key)}`,
    method: 'DELETE',
  });
}
