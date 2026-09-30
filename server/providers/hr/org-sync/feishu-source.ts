/**
 * Feishu directory source (V1-03) for a self-built app, read-only. It reads
 * the departments and members the app's contact data range allows, with the
 * tenant access token of `appId` / `appSecret`:
 *
 * - The root department (`0`) takes the tenant's name, so the sync matches it
 *   to the local root by path like any other department.
 * - Member ids are `user_id` (tenant-scoped and stable); department ids are
 *   `open_department_id`. Changing either later would orphan every binding.
 * - A member's department is the primary one in `orders`, else the first.
 * - Resigned or frozen members come back inactive.
 * - Mobile numbers lose the `+86` prefix, so they compare with local ones.
 *
 * Needed scopes: 获取部门基础信息, 获取用户基本信息, 获取用户 user ID,
 * 获取用户受雇信息 (工号), 获取用户组织架构信息, 获取企业信息, and optionally
 * email and mobile. Errors name the Feishu code, never the token or secret.
 */
import {
  createFeishuApi,
  type FeishuApi,
  type FeishuApiOptions,
} from '../feishu/api.js';
import type {
  Directory,
  DirectoryDepartment,
  DirectoryMember,
  OrgDirectorySource,
} from './source.js';

/** App credentials, or an existing client to share its tenant token. */
export type FeishuSourceOptions =
  FeishuApiOptions | { readonly api: FeishuApi };

interface FeishuPage<T> {
  items?: T[];
  has_more?: boolean;
  page_token?: string;
}

interface FeishuDepartment {
  open_department_id?: string;
  name?: string;
  parent_department_id?: string;
  leader_user_id?: string;
  status?: { is_deleted?: boolean };
}

interface FeishuUser {
  user_id?: string;
  name?: string;
  employee_no?: string;
  email?: string;
  enterprise_email?: string;
  mobile?: string;
  department_ids?: string[];
  orders?: { department_id?: string; is_primary_dept?: boolean }[];
  job_title?: string;
  leader_user_id?: string;
  status?: { is_resigned?: boolean; is_frozen?: boolean };
}

const ROOT = '0';
const PAGE_SIZE = 50;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

export function createFeishuSource(
  options: FeishuSourceOptions,
): OrgDirectorySource {
  const api = 'api' in options ? options.api : createFeishuApi(options);
  const call = api.call.bind(api);
  const configured =
    'api' in options || Boolean(options.appId && options.appSecret);

  async function pages<T>(path: string, query: Record<string, string>) {
    const items: T[] = [];
    let pageToken: string | undefined;
    for (let guard = 0; guard < 1000; guard++) {
      const params = new URLSearchParams({
        ...query,
        page_size: String(PAGE_SIZE),
        ...(pageToken ? { page_token: pageToken } : {}),
      });
      const page = await call<FeishuPage<T>>(`${path}?${params.toString()}`);
      items.push(...(page.items ?? []));
      if (!page.has_more || !page.page_token) break;
      pageToken = page.page_token;
    }
    return items;
  }

  const ids = {
    department_id_type: 'open_department_id',
    user_id_type: 'user_id',
  };

  return {
    provider: 'feishu',
    label: 'feishu',
    async configured() {
      return configured;
    },
    async fetch(): Promise<Directory> {
      const tenant = await call<{ tenant?: { name?: string } }>(
        '/tenant/v2/tenant/query',
      );
      const children = await pages<FeishuDepartment>(
        `/contact/v3/departments/${ROOT}/children`,
        { ...ids, fetch_child: 'true' },
      );
      const departments: DirectoryDepartment[] = [
        {
          id: ROOT,
          name: text(tenant.tenant?.name) ?? ROOT,
          parentId: null,
          managerUserId: null,
        },
        ...children
          .filter((d) => d.open_department_id && !d.status?.is_deleted)
          .map((d) => ({
            id: d.open_department_id!,
            name: text(d.name) ?? d.open_department_id!,
            parentId: text(d.parent_department_id) ?? ROOT,
            managerUserId: text(d.leader_user_id),
          })),
      ];
      // find_by_department lists direct members only: ask every department.
      const members = new Map<string, DirectoryMember>();
      for (const department of departments) {
        const users = await pages<FeishuUser>(
          '/contact/v3/users/find_by_department',
          { ...ids, department_id: department.id },
        );
        for (const u of users) {
          if (!u.user_id || members.has(u.user_id)) continue;
          const primary =
            u.orders?.find((o) => o.is_primary_dept)?.department_id ??
            u.department_ids?.[0] ??
            department.id;
          const active = !u.status?.is_resigned && !u.status?.is_frozen;
          members.set(u.user_id, {
            userId: u.user_id,
            name: text(u.name) ?? u.user_id,
            employeeNo: text(u.employee_no),
            email: text(u.email) ?? text(u.enterprise_email),
            mobile: text(u.mobile)?.replace(/^\+86/u, '') ?? null,
            departmentId: primary,
            title: text(u.job_title),
            managerUserId: text(u.leader_user_id),
            active,
            deactivatedAt: null,
          });
        }
      }
      return { departments, members: [...members.values()] };
    },
  };
}
