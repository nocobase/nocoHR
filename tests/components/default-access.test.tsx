import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationOptionsResponse,
} from '@nocobase/app-plugin-authorization/client';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import DefaultAccessPage from '../../client/pages/settings/default-access/index.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';

const options: AuthorizationOptionsResponse = {
  sections: [
    {
      name: 'database',
      title: 'Database',
      order: 1,
      subsections: [
        {
          name: 'database.collections',
          title: 'Collections',
          resources: [
            {
              type: 'database.collection',
              id: 'documents',
              title: 'Documents',
              group: 'hr',
              actions: [
                { name: 'read', title: 'Read' },
                { name: 'update', title: 'Update' },
              ],
            },
          ],
        },
      ],
    },
  ],
  resourceGroups: [{ name: 'hr', title: 'HR' }],
  subjectTypes: [],
  recordAccess: [
    {
      key: 'document-policy',
      title: 'Document policy',
      collections: ['documents'],
    },
    {
      key: 'employee-policy',
      title: 'Employee policy',
      collections: ['employees'],
    },
  ],
  collections: [{ name: 'documents', fields: ['id', 'title'] }],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount({
  allowed = ['read', 'create', 'update', 'delete'],
  failPost = false,
  holdSecondList = false,
}: {
  allowed?: readonly string[];
  failPost?: boolean;
  holdSecondList?: boolean;
} = {}) {
  const heldList = deferred<unknown>();
  let currentPermissions = [...allowed];
  let postFails = failPost;
  let listCalls = 0;
  let rules: {
    key: string;
    resource: { type: string; id: string };
    actions: readonly { action: string; selection: unknown }[];
  }[] = [];
  const calls = vi.fn(
    (call: {
      method: string;
      path: string;
      json?: unknown;
      query?: Readonly<Record<string, string | readonly string[]>>;
    }) => {
      if (call.path === 'authorization/permissions')
        return {
          data: {
            unrestricted: false,
            permissions: currentPermissions.length
              ? [
                  {
                    resource: {
                      type: 'settings',
                      id: 'authorization.default-access',
                    },
                    actions: currentPermissions,
                  },
                ]
              : [],
          },
        };
      if (call.path === 'authorization/defaultAccess/options')
        return { data: options };
      if (
        call.path === 'authorization/defaultAccess' &&
        call.method === 'GET'
      ) {
        listCalls += 1;
        if (holdSecondList && listCalls === 2) return heldList.promise;
        return { data: rules, meta: { total: rules.length } };
      }
      if (
        call.path === 'authorization/defaultAccess' &&
        call.method === 'POST'
      ) {
        if (postFails)
          return new Response(
            JSON.stringify({
              error: {
                status: 'INVALID_ARGUMENT',
                reason: 'INVALID_AUTHORIZATION_INPUT',
                domain: 'authorization',
                message: 'private validation detail',
                fieldViolations: [
                  { field: 'actions[0].selection', description: 'invalid' },
                ],
              },
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
          );
        const rule = call.json as (typeof rules)[number];
        rules = [rule];
        return { data: rule };
      }
      if (
        call.path ===
          'authorization/defaultAccess/database.collection.documents' &&
        call.method === 'PATCH'
      ) {
        const current = rules[0];
        if (!current) throw new Error('Missing synthetic rule');
        rules = [
          { ...current, ...(call.json as { actions: typeof current.actions }) },
        ];
        return { data: rules[0] };
      }
      if (call.path.startsWith('authorization/defaultAccess/records/')) {
        const page = Number(call.query?.page ?? 1);
        return {
          data: [{ id: `doc-${page}`, label: `Document ${page}` }],
          meta: { page, pageSize: 20, total: 21 },
        };
      }
      throw new Error(
        `Unexpected default-access request: ${call.method} ${call.path}`,
      );
    },
  );

  let client!: AuthorizationClient;
  const rendered = await renderWithApp(
    <Routes>
      <Route
        path='/settings/authorization/default-access'
        element={<DefaultAccessPage />}
      />
    </Routes>,
    {
      route: '/settings/authorization/default-access',
      namespace: 'default-access-test',
      locale: 'en-US',
      namespaces: {
        'default-access-test': {
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
    rendered,
    client,
    heldList,
    setPermissions(next: readonly string[]) {
      currentPermissions = [...next];
      client.invalidate();
    },
    setPostFails(next: boolean) {
      postFails = next;
    },
  };
}

it('shows the full resource matrix to a read-only identity without mutation controls', async () => {
  await mount({ allowed: ['read'] });
  expect(await screen.findByText('Documents')).toBeVisible();
  expect(screen.getAllByText('No default scope').length).toBeGreaterThan(0);
  expect(
    screen.queryByRole('combobox', { name: 'Documents: Read' }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Clear default access' }),
  ).not.toBeInTheDocument();
});

it('denies a direct route request when the identity has no read permission', async () => {
  await mount({ allowed: [] });
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'You no longer have permission to manage default access.',
  );
  expect(screen.queryByText('Documents')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Clear default access' }),
  ).not.toBeInTheDocument();
});

it('keeps a failed scope save in the editor, then creates and rereads with the native client', async () => {
  const { calls, rendered, setPostFails } = await mount({ failPost: true });
  const user = userEvent.setup();
  const scope = await screen.findByRole('combobox', {
    name: 'Documents: Read',
  });
  await user.click(scope);
  await user.click(
    await screen.findByRole('option', { name: 'Specific scope' }),
  );
  const editor = await screen.findByRole('dialog');
  const selection = within(editor).getByRole('combobox', {
    name: 'Read record scope',
  });
  await user.click(selection);
  expect(
    await screen.findByRole('option', { name: 'Document policy' }),
  ).toBeVisible();
  expect(
    screen.queryByRole('option', { name: 'Employee policy' }),
  ).not.toBeInTheDocument();
  await user.click(await screen.findByRole('option', { name: 'All records' }));
  await user.click(within(editor).getByRole('button', { name: 'Save' }));

  const fieldError = await screen.findByText(
    'The selected record scope is no longer valid for this action. Review the scope and save again.',
  );
  expect(fieldError).toBeVisible();
  expect(selection.closest('section')).toContainElement(fieldError);
  expect(
    screen.queryByText('private validation detail'),
  ).not.toBeInTheDocument();
  expect(calls.mock.calls.some(([call]) => call.method === 'POST')).toBe(true);

  setPostFails(false);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  expect(rendered.toasts().at(-1)?.title).toBe(
    'Default access saved for Documents.',
  );
  expect(
    calls.mock.calls.filter(
      ([call]) =>
        call.path === 'authorization/defaultAccess' && call.method === 'GET',
    ).length,
  ).toBeGreaterThanOrEqual(3);
});

it('uses target record search and page metadata in the scope picker', async () => {
  const { calls } = await mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('combobox', { name: 'Documents: Read' }),
  );
  await user.click(
    await screen.findByRole('option', { name: 'Specific scope' }),
  );
  const editor = await screen.findByRole('dialog');
  const scope = within(editor).getByRole('combobox', {
    name: 'Read record scope',
  });
  await user.click(scope);
  await user.click(
    await screen.findByRole('option', { name: 'Specific records' }),
  );
  expect(await screen.findByText('Document 1')).toBeVisible();
  expect(screen.getByText('1/2')).toBeVisible();

  const nextPage = screen.getAllByRole('button', { name: 'Next page' }).at(-1);
  if (!nextPage) throw new Error('The record picker pager is missing');
  await user.click(nextPage);
  expect(await screen.findByText('Document 2')).toBeVisible();
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([call]) =>
          call.path === 'authorization/defaultAccess/records/documents' &&
          call.query?.page === '2',
      ),
    ).toBe(true),
  );

  await user.type(screen.getByRole('textbox', { name: 'Search records' }), 'd');
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([call]) =>
          call.path === 'authorization/defaultAccess/records/documents' &&
          call.query?.q === 'd' &&
          call.query?.page === '1',
      ),
    ).toBe(true),
  );
});

it('does not reopen an editor from a list response that arrives after read access is revoked', async () => {
  const { heldList, setPermissions } = await mount({ holdSecondList: true });
  const user = userEvent.setup();
  const scope = await screen.findByRole('combobox', {
    name: 'Documents: Read',
  });
  await user.click(scope);
  await user.click(
    await screen.findByRole('option', { name: 'Specific scope' }),
  );
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
  setPermissions([]);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'You no longer have permission to manage default access.',
    ),
  );
  await act(async () => {
    heldList.resolve({ data: [], meta: { total: 0 } });
    await heldList.promise;
  });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(
    'You no longer have permission to manage default access.',
  );
});
