// @vitest-environment node

// The Feishu directory source against a fake Open Platform: the tenant token is fetched once and reused, pages are
// followed, the root takes the tenant's name, members are listed per department without duplicates, the primary
// department wins, resigned members are inactive, +86 is dropped, and a Feishu error names its code but not the secret.
import { describe, expect, it } from 'vitest';

import { createFeishuSource } from '../../server/providers/hr/org-sync/feishu-source.ts';

type Handler = (url: URL, body: unknown) => unknown;

function fakeFeishu(routes: Record<string, Handler>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace('/open-apis', '');
    calls.push(path);
    const handler = routes[path];
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : null;
    const reply = handler
      ? handler(url, body)
      : { code: 99991663, msg: 'not found' };
    return new Response(JSON.stringify(reply), { status: 200 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const baseRoutes: Record<string, Handler> = {
  '/auth/v3/tenant_access_token/internal': () => ({
    code: 0,
    tenant_access_token: 't-1',
    expire: 7200,
  }),
  '/tenant/v2/tenant/query': () => ({
    code: 0,
    data: { tenant: { name: '启衡精密' } },
  }),
  '/contact/v3/departments/0/children': (url) =>
    url.searchParams.get('page_token')
      ? {
          code: 0,
          data: {
            items: [
              {
                open_department_id: 'od-mc',
                name: '机加工车间',
                parent_department_id: 'od-sz',
                leader_user_id: 'u-chen',
              },
            ],
            has_more: false,
          },
        }
      : {
          code: 0,
          data: {
            items: [
              {
                open_department_id: 'od-sz',
                name: '苏州工厂',
                parent_department_id: '0',
              },
              {
                open_department_id: 'od-old',
                name: '已删除',
                status: { is_deleted: true },
              },
            ],
            has_more: true,
            page_token: 'p2',
          },
        },
  '/contact/v3/users/find_by_department': (url) => {
    const department = url.searchParams.get('department_id');
    const wang = {
      user_id: 'u-wang',
      name: '王磊',
      employee_no: 'QH2001',
      mobile: '+8613900000011',
      department_ids: ['od-sz', 'od-mc'],
      orders: [
        { department_id: 'od-sz', is_primary_dept: false },
        { department_id: 'od-mc', is_primary_dept: true },
      ],
      job_title: 'CNC 操作工',
      leader_user_id: 'u-chen',
    };
    const items =
      department === 'od-mc'
        ? [
            wang,
            { user_id: 'u-chen', name: '陈静', employee_no: 'QH1003' },
            {
              user_id: 'u-gone',
              name: '离职者',
              status: { is_resigned: true },
            },
          ]
        : department === 'od-sz'
          ? [wang]
          : [];
    return { code: 0, data: { items, has_more: false } };
  },
};

describe('Feishu directory source', () => {
  it('reads the tree and members in the sync shape', async () => {
    const { fetchImpl, calls } = fakeFeishu(baseRoutes);
    const source = createFeishuSource({
      appId: 'cli_test',
      appSecret: 'secret-value',
      baseUrl: 'https://open.feishu.test/',
      fetch: fetchImpl,
    });
    expect(await source.configured()).toBe(true);
    const directory = await source.fetch();
    expect(directory.departments).toEqual([
      { id: '0', name: '启衡精密', parentId: null, managerUserId: null },
      { id: 'od-sz', name: '苏州工厂', parentId: '0', managerUserId: null },
      {
        id: 'od-mc',
        name: '机加工车间',
        parentId: 'od-sz',
        managerUserId: 'u-chen',
      },
    ]);
    const byId = new Map(directory.members.map((m) => [m.userId, m]));
    expect(directory.members).toHaveLength(3);
    expect(byId.get('u-wang')).toMatchObject({
      employeeNo: 'QH2001',
      mobile: '13900000011',
      departmentId: 'od-mc',
      title: 'CNC 操作工',
      managerUserId: 'u-chen',
      active: true,
    });
    expect(byId.get('u-chen')).toMatchObject({
      departmentId: 'od-mc',
      email: null,
      active: true,
    });
    expect(byId.get('u-gone')?.active).toBe(false);
    // One token for the whole read.
    expect(
      calls.filter((c) => c === '/auth/v3/tenant_access_token/internal'),
    ).toHaveLength(1);
  });

  it('is not configured without credentials', async () => {
    const source = createFeishuSource({
      appId: '',
      appSecret: '',
      baseUrl: 'https://open.feishu.test',
    });
    expect(await source.configured()).toBe(false);
  });

  it('reports a Feishu error by code without the secret', async () => {
    const { fetchImpl } = fakeFeishu({
      ...baseRoutes,
      '/contact/v3/departments/0/children': () => ({
        code: 40004,
        msg: 'no dept authority error',
      }),
    });
    const source = createFeishuSource({
      appId: 'cli_test',
      appSecret: 'secret-value',
      baseUrl: 'https://open.feishu.test',
      fetch: fetchImpl,
    });
    const error = await source.fetch().then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).toBe('FEISHU_API_40004: no dept authority error');
    expect(error?.message).not.toContain('secret-value');
  });
});
