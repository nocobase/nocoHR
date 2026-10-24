import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationInspection,
  type AuthorizationOptionsResponse,
} from '@nocobase/app-plugin-authorization/client';
import { screen, waitFor, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, Link } from 'react-router';
import { expect, it, vi } from 'vitest';
import Inspector from '../../client/pages/settings/inspector/index.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';

const options: AuthorizationOptionsResponse = {
  sections: [
    {
      name: 'business',
      title: 'Business',
      order: 1,
      subsections: [
        {
          name: 'business.actions',
          title: 'Business actions',
          resources: [
            {
              type: 'composite',
              id: 'orders',
              title: 'Orders',
              actions: [
                { name: 'read', title: 'Read' },
                { name: 'edit', title: 'Edit' },
                { name: 'approve', title: 'Approve' },
              ],
            },
          ],
        },
      ],
    },
  ],
  subjectTypes: [
    { type: 'user', title: 'User', selection: { type: 'collection' } },
    {
      type: 'authenticated',
      title: 'All signed-in users',
      selection: { type: 'fixed', id: '*' },
    },
  ],
  recordAccess: [],
  collections: [{ name: 'orders', fields: ['id', 'owner', 'title'] }],
};
const granted = {
  effect: 'permit' as const,
  reasons: [
    {
      code: 'GRANT_MATCHED',
      message: 'Granted by operators',
      details: {
        source: {
          plugin: 'permission-sets',
          id: 'operators',
          title: 'Operators',
        },
      },
    },
  ],
};
const denied = {
  effect: 'deny' as const,
  reasons: [{ code: 'NO_GRANT', message: 'No matching grant' }],
};
function decisions(
  checks: readonly Omit<AuthorizationInspection, 'decision'>[],
  deny = false,
): AuthorizationInspection[] {
  return checks.map((check) => ({
    ...check,
    decision:
      deny || check.action === 'approve'
        ? denied
        : check.action === 'edit'
          ? {
              effect: 'conditional',
              reasons: [],
              conditions: {
                type: 'database',
                scope: {
                  kind: 'condition',
                  path: ['owner'],
                  operator: '$eq',
                  value: 'alice',
                },
                fields: ['title'],
              },
            }
          : granted,
  }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
async function mount({
  allow = true,
  forbidden = false,
  configForbidden = false,
  late = false,
  lateDetail = false,
  locale = 'en-US',
}: {
  allow?: boolean;
  forbidden?: boolean;
  configForbidden?: boolean;
  late?: boolean;
  lateDetail?: boolean;
  locale?: string;
} = {}) {
  const oldBatch = deferred<unknown>();
  const oldConfig = deferred<unknown>();
  const oldDetail = deferred<unknown>();
  let held = false;
  let permission = allow;
  const calls = vi.fn(
    ({
      path,
      method,
      json,
      query,
    }: {
      path: string;
      method: string;
      json?: unknown;
      query?: Record<string, unknown>;
    }) => {
      if (path === 'authorization/permissions')
        return {
          data: {
            unrestricted: false,
            permissions: permission
              ? [
                  {
                    resource: {
                      type: 'settings',
                      id: 'authorization.inspector',
                    },
                    actions: ['inspect'],
                  },
                ]
              : [],
          },
        };
      if (forbidden)
        return new Response(
          JSON.stringify({
            error: {
              status: 'PERMISSION_DENIED',
              reason: 'AUTHORIZATION_DENIED',
              domain: 'authorization',
              message: 'private server detail',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        );
      if (path.endsWith('/options')) return { data: options };
      if (path.endsWith('/resolve')) {
        const ids = (json as { ids: readonly string[] }).ids;
        return {
          data: ids.map((id) => ({
            id,
            title:
              id === '*'
                ? 'All signed-in users'
                : id === 'alice'
                  ? 'Alice'
                  : 'Bob',
          })),
        };
      }
      if (path.endsWith('/subjects/user'))
        return {
          data: [
            { id: 'alice', title: 'Alice' },
            { id: 'bob', title: 'Bob' },
          ],
          meta: { page: 1, pageSize: 30, total: 2 },
        };
      if (path.endsWith('/configuredAccess')) {
        if (configForbidden)
          return new Response(
            JSON.stringify({
              error: {
                status: 'PERMISSION_DENIED',
                reason: 'AUTHORIZATION_DENIED',
                domain: 'authorization',
                message: 'private configuration',
              },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        if (late && query?.subjectId === 'alice') return oldConfig.promise;
        return {
          data: {
            unrestricted: false,
            types: ['composite'],
            resources:
              query?.subjectId === 'bob'
                ? []
                : [{ type: 'composite', id: 'orders' }],
            identity: { subjects: [{ type: 'authenticated', id: '*' }] },
            sets: [
              {
                key: 'operators',
                title: 'Operators',
                sources: [{ type: 'user', id: String(query?.subjectId) }],
              },
            ],
          },
        };
      }
      if (path.endsWith('/batchDecide')) {
        const input = json as {
          subject: { id: string };
          checks: Omit<AuthorizationInspection, 'decision'>[];
        };
        if (late && input.subject.id === 'alice' && !held) {
          held = true;
          return oldBatch.promise;
        }
        return { data: decisions(input.checks, input.subject.id === 'bob') };
      }
      if (path.endsWith('/decide'))
        return lateDetail
          ? oldDetail.promise
          : {
              data:
                (json as { action: string }).action === 'edit'
                  ? decisions([
                      {
                        resource: { type: 'composite', id: 'orders' },
                        action: 'edit',
                      },
                    ])[0]?.decision
                  : granted,
            };
      throw new Error('Unexpected inspector request ' + method + ' ' + path);
    },
  );
  let client!: AuthorizationClient;
  await renderWithApp(
    <>
      <Link to='/settings/authorization/inspector?subjectType=user&subjectId=bob'>
        Inspect Bob
      </Link>
      <Routes>
        <Route
          path='/settings/authorization/inspector'
          element={<Inspector />}
        />
      </Routes>
    </>,
    {
      route: '/settings/authorization/inspector?user=alice',
      namespace: 'inspector-test',
      locale,
      namespaces: {
        'inspector-test': {
          'en-US': async () => ({ default: enUS }),
          'zh-CN': async () => ({ default: zhCN }),
        },
      },
      fetch: answerApi(calls),
      services: (app) => {
        client = new AuthorizationClient(app.container.resolve(apiClientToken));
        app.container.instance(authorizationClientToken, client);
      },
    },
  );
  return {
    calls,
    oldBatch,
    oldConfig,
    oldDetail,
    client,
    revoke: () => {
      permission = false;
      client.invalidate();
    },
  };
}
it.each(['en-US', 'zh-CN'])(
  'renders restricted decisions, conditions and sources with the native clients: %s',
  async (locale) => {
    const { calls } = await mount({ locale });
    const user = userEvent.setup();
    const edit = await screen.findByRole('button', { name: 'Orders: Edit' });
    expect(
      screen.getByRole('button', { name: 'Orders: Approve' }),
    ).toBeVisible();
    await user.click(edit);
    const dialog = await screen.findByRole('dialog');
    expect(
      await within(dialog).findByText(
        locale === 'en-US' ? 'Allowed with limits' : '可执行（有限制）',
      ),
    ).toBeVisible();
    expect(within(dialog).getByText('title', { exact: true })).toBeVisible();
    expect(
      within(dialog).getByText(/owner/, { selector: 'p' }),
    ).toHaveTextContent('alice');
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'authorization/inspector/decide',
        method: 'POST',
        json: {
          subject: { type: 'user', id: 'alice' },
          resource: { type: 'composite', id: 'orders' },
          action: 'edit',
        },
      }),
    );
    expect(
      calls.mock.calls.filter(([call]) =>
        ['PATCH', 'DELETE', 'PUT'].includes(call.method),
      ),
    ).toHaveLength(0);
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Orders: Read' }));
    const sourceDialog = await screen.findByRole('dialog');
    expect(await within(sourceDialog).findByText('Operators')).toBeVisible();
    expect(
      within(sourceDialog).getByText(
        locale === 'en-US' ? /assigned directly/ : /直接分配/,
      ),
    ).toBeVisible();
  },
);
it('denies a read-only manager before any inspector data call', async () => {
  const { calls } = await mount({ allow: false });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    enUS.settings.denied,
  );
  expect(
    calls.mock.calls.filter(([call]) =>
      call.path.startsWith('authorization/inspector'),
    ),
  ).toHaveLength(0);
});
it('renders a native refusal without exposing the raw response or retrying it', async () => {
  const { calls } = await mount({ forbidden: true });
  expect(
    await screen.findByText(
      'You do not have permission to inspect authorization.',
    ),
  ).toBeVisible();
  expect(screen.queryByText('private server detail')).not.toBeInTheDocument();
  expect(
    calls.mock.calls.filter(([call]) => call.path.endsWith('/options')),
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});
it('discards both configured access and batch results that arrive after switching subjects', async () => {
  const { calls, oldBatch, oldConfig } = await mount({ late: true });
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'authorization/inspector/batchDecide',
        json: expect.objectContaining({
          subject: { type: 'user', id: 'alice' },
        }),
      }),
    ),
  );
  await userEvent.click(screen.getByRole('link', { name: 'Inspect Bob' }));
  expect(
    await screen.findByRole('button', { name: 'Orders: Read' }),
  ).toHaveTextContent('Read');
  await act(async () => {
    oldBatch.resolve({
      data: decisions([
        { resource: { type: 'composite', id: 'orders' }, action: 'read' },
      ]),
    });
    oldConfig.resolve({
      data: {
        unrestricted: true,
        resources: [],
        types: [],
        sets: [{ key: 'leaked-old-set', sources: [] }],
      },
    });
  });
  expect(
    calls.mock.calls.filter(([call]) => call.path.endsWith('/options')),
  ).toHaveLength(1);
  expect(screen.queryByText('leaked-old-set')).not.toBeInTheDocument();
  const cell = screen.getByRole('button', { name: 'Orders: Read' });
  expect(within(cell).getByRole('img', { name: 'Not allowed' })).toBeVisible();
});
it('clears decisions and detail portals when inspect permission is withdrawn', async () => {
  const { revoke } = await mount();
  await userEvent.click(
    await screen.findByRole('button', { name: 'Orders: Read' }),
  );
  expect(await screen.findByRole('dialog')).toBeVisible();
  act(() => revoke());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    enUS.settings.denied,
  );
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Orders: Read' }),
  ).not.toBeInTheDocument();
});

it('discards a detailed decision that arrives after switching subjects', async () => {
  const { oldDetail, calls } = await mount({ lateDetail: true });
  await userEvent.click(
    await screen.findByRole('button', { name: 'Orders: Read' }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'authorization/inspector/decide' }),
    ),
  );
  // Browser back/forward and direct entries update the same query-owned subject state.
  // The outside navigation is inert while the real modal is open, so close it before changing the subject.
  await userEvent.keyboard('{Escape}');
  await userEvent.click(screen.getByRole('link', { name: 'Inspect Bob' }));
  expect(
    await screen.findByRole('button', { name: 'Orders: Read' }),
  ).toBeVisible();
  await act(async () => {
    oldDetail.resolve({
      data: {
        ...granted,
        reasons: [
          {
            code: 'GRANT_MATCHED',
            message: 'old private detail',
            details: { source: { title: 'Old private role' } },
          },
        ],
      },
    });
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByText('Old private role')).not.toBeInTheDocument();
  expect(
    within(screen.getByRole('button', { name: 'Orders: Read' })).getByRole(
      'img',
      { name: 'Not allowed' },
    ),
  ).toBeVisible();
});

it('keeps a configured-access refusal visible when a concurrent batch succeeds', async () => {
  const { calls } = await mount({ configForbidden: true });
  expect(
    await screen.findByText(
      'You do not have permission to inspect authorization.',
    ),
  ).toBeVisible();
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'authorization/inspector/batchDecide' }),
    ),
  );
  expect(
    screen.queryByRole('button', { name: 'Orders: Read' }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText('private configuration')).not.toBeInTheDocument();
});
