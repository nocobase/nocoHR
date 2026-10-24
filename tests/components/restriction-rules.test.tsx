import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
  type AuthorizationOptionsResponse,
} from '@nocobase/app-plugin-authorization/client';
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import RestrictionRulesPage from '../../client/pages/settings/restriction-rules/index.js';
import RestrictionRuleFormPage from '../../client/pages/settings/restriction-rules/form.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';
import type { RestrictionRule } from '@nocobase/authorization/restriction-rules';

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
              id: 'employees',
              title: 'Employees',
              group: 'hr',
              actions: [
                { name: 'read', title: 'Read' },
                { name: 'update', title: 'Update' },
              ],
            },
            {
              type: 'database.collection',
              id: 'departments',
              title: 'Departments',
              group: 'hr',
              actions: [
                { name: 'read', title: 'Read' },
                { name: 'update', title: 'Update' },
              ],
            },
            {
              type: 'composite',
              id: 'employee.handover',
              title: 'Employee handover workflow',
              group: 'hr',
              actions: [{ name: 'submit', title: 'Submit' }],
              dataScopes: {
                submit: [
                  {
                    key: 'employee',
                    title: 'Employee',
                    collection: 'employees',
                    fields: ['id', 'name'],
                    recordAccess: ['customFilter'],
                  },
                  {
                    key: 'handover',
                    title: 'Handover employee',
                    collection: 'employees',
                    fields: ['id', 'name'],
                    recordAccess: ['customFilter'],
                  },
                ],
              },
            },
          ],
        },
      ],
    },
  ],
  resourceGroups: [{ name: 'hr', title: 'Human resources' }],
  subjectTypes: [
    { type: 'user', title: 'User', selection: { type: 'collection' } },
    { type: 'team', title: 'Team', selection: { type: 'collection' } },
  ],
  recordAccess: [
    {
      key: 'customFilter',
      title: 'Custom filter',
      collections: ['employees'],
    },
  ],
  collections: [
    { name: 'employees', fields: ['id', 'name'] },
    { name: 'departments', fields: ['id', 'name'] },
  ],
};

const initialRule: RestrictionRule = {
  key: 'employee-handover',
  title: 'Employee handover',
  resource: { type: 'database.collection', id: 'employees' },
  subjects: [{ type: 'user', id: 'alice' }],
  actions: [
    {
      action: 'read',
      selection: { type: 'records', ids: ['employee-1'] },
    },
  ],
  reason: 'Cover an assigned handover',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function failure(status: number, reason: string) {
  return new Response(
    JSON.stringify({
      error: {
        status: status === 403 ? 'PERMISSION_DENIED' : 'INVALID_ARGUMENT',
        reason,
        domain: 'authorization',
        message: 'private server detail',
      },
    }),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
}

async function mount({
  route = '/settings/authorization/restriction-rules',
  permissions = ['read', 'create', 'update', 'delete'],
  latestRule,
  initialRules,
  failPatch = false,
  revokeOnPatch = false,
  holdUserSubjects = false,
  holdRecordPage,
}: {
  route?: string;
  permissions?: readonly string[];
  latestRule?: (listCall: number) => RestrictionRule;
  initialRules?: readonly RestrictionRule[];
  failPatch?: boolean;
  revokeOnPatch?: boolean;
  holdUserSubjects?: boolean;
  holdRecordPage?: { readonly collection: string; readonly page: number };
} = {}) {
  const heldSubjects = deferred<unknown>();
  const heldRecords = deferred<unknown>();
  let currentPermissions = [...permissions];
  let rules: RestrictionRule[] = [...(initialRules ?? [initialRule])];
  let listCalls = 0;
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
                      id: 'authorization.restriction-rules',
                    },
                    actions: currentPermissions,
                  },
                ]
              : [],
          },
        };
      if (call.path === 'authorization/restrictionRules/options')
        return { data: options };
      if (
        call.path === 'authorization/restrictionRules' &&
        call.method === 'GET'
      ) {
        listCalls += 1;
        const next = latestRule?.(listCalls);
        return {
          data: next ? [next] : rules,
          meta: { total: next ? 1 : rules.length },
        };
      }
      if (
        call.path === 'authorization/restrictionRules' &&
        call.method === 'POST'
      ) {
        const created = call.json as RestrictionRule;
        rules = [...rules, created];
        return { data: created };
      }
      if (
        call.path === 'authorization/restrictionRules/employee-handover' &&
        call.method === 'PATCH'
      ) {
        if (revokeOnPatch) {
          currentPermissions = ['read'];
          return failure(403, 'PERMISSION_DENIED');
        }
        if (failPatch) return failure(400, 'INVALID_AUTHORIZATION_INPUT');
        const patch = call.json as Partial<RestrictionRule>;
        const current = latestRule?.(listCalls) ?? rules[0];
        const updated = { ...current, ...patch };
        rules = rules.map((rule) =>
          rule.key === 'employee-handover' ? updated : rule,
        );
        return { data: updated };
      }
      if (
        call.path === 'authorization/restrictionRules/employee-handover' &&
        call.method === 'DELETE'
      ) {
        rules = rules.filter((rule) => rule.key !== 'employee-handover');
        return new Response(null, { status: 204 });
      }
      if (call.path.startsWith('authorization/restrictionRules/subjects/')) {
        const parts = call.path.split('/');
        const type = parts[3];
        if (parts[4] === 'resolve') {
          const body = call.json as { ids?: readonly string[] } | undefined;
          return {
            data: (body?.ids ?? []).map((id) => ({
              id,
              title: id === 'alice' ? 'Alice Employee' : id,
            })),
          };
        }
        if (holdUserSubjects && type === 'user') return heldSubjects.promise;
        return {
          data: [
            {
              id: type === 'team' ? 'team-1' : 'bob',
              title: type === 'team' ? 'Team One' : 'Bob Employee',
            },
          ],
          meta: { page: 1, pageSize: 20, total: 1 },
        };
      }
      if (call.path.startsWith('authorization/restrictionRules/records/')) {
        const collection = decodeURIComponent(call.path.split('/').at(-1)!);
        const page = Number(call.query?.page ?? 1);
        if (
          holdRecordPage?.collection === collection &&
          holdRecordPage.page === page
        )
          return heldRecords.promise;
        const items =
          collection === 'departments'
            ? [{ id: 'department-1', label: 'Finance Department' }]
            : page === 2
              ? [
                  { id: 'employee-22', label: 'Page Two Employee' },
                  { id: 'employee-23', label: 'Next Page Employee' },
                ]
              : [{ id: 'employee-2', label: 'Bob Employee' }];
        return {
          data: items,
          meta: {
            page,
            pageSize: 20,
            total: collection === 'departments' ? 1 : 22,
          },
        };
      }
      throw new Error(
        `Unexpected restriction-rules request: ${call.method} ${call.path}`,
      );
    },
  );

  let client!: AuthorizationClient;
  const rendered = await renderWithApp(
    <Routes>
      <Route
        path='/settings/authorization/restriction-rules'
        element={<RestrictionRulesPage />}
      >
        <Route path='new' element={<RestrictionRuleFormPage />} />
        <Route path='edit/:key' element={<RestrictionRuleFormPage />} />
      </Route>
    </Routes>,
    {
      route,
      namespace: 'restriction-rules-test',
      locale: 'en-US',
      namespaces: {
        'restriction-rules-test': {
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
    heldSubjects,
    heldRecords,
    setPermissions(next: readonly string[]) {
      currentPermissions = [...next];
      client.invalidate();
    },
  };
}

it('keeps read-only rules visible and hides create/edit/delete actions', async () => {
  const { calls } = await mount({ permissions: ['read'] });
  expect(await screen.findByText('Employee handover')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: 'New restriction rule' }),
  ).toBeNull();
  expect(screen.queryByRole('button', { name: /Actions for/ })).toBeNull();
  expect(
    calls.mock.calls.some(
      ([call]) =>
        call.method === 'POST' &&
        call.path === 'authorization/restrictionRules',
    ),
  ).toBe(false);
});

it('shows full cell text on hover only when it is truncated', async () => {
  await mount();
  const title = await screen.findByText('Employee handover');
  Object.defineProperty(title, 'clientWidth', {
    configurable: true,
    value: 24,
  });
  Object.defineProperty(title, 'scrollWidth', {
    configurable: true,
    value: 120,
  });
  fireEvent.mouseEnter(title);
  expect(title).toHaveAttribute('title', 'Employee handover');
  fireEvent.mouseLeave(title);
  expect(title).not.toHaveAttribute('title');

  const key = screen.getByText('employee-handover');
  Object.defineProperty(key, 'clientWidth', { configurable: true, value: 120 });
  Object.defineProperty(key, 'scrollWidth', { configurable: true, value: 120 });
  fireEvent.mouseEnter(key);
  expect(key).not.toHaveAttribute('title');
});

it('does not request rule data without read permission', async () => {
  const { calls } = await mount({ permissions: [] });
  expect(await screen.findByText(/you do not have access/i)).toBeTruthy();
  expect(
    calls.mock.calls.some(([call]) =>
      call.path.startsWith('authorization/restrictionRules'),
    ),
  ).toBe(false);
});

it('keeps list results stable while a search is composing and filters after commit', async () => {
  const user = userEvent.setup();
  await mount();
  const search = await screen.findByRole('textbox', {
    name: 'Search restriction rules',
  });
  fireEvent.compositionStart(search);
  await user.type(search, 'missing');
  expect(screen.getByText('Employee handover')).toBeTruthy();
  fireEvent.compositionEnd(search, { data: 'missing' });
  expect(await screen.findByText('No matching restriction rules')).toBeTruthy();
});

it('creates a record-scoped rule, reloads the list, and returns to the same view', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/new',
    permissions: ['read', 'create'],
  });

  await user.type(
    await screen.findByRole('textbox', { name: /Rule key/ }),
    'new-handover',
  );
  const ruleName = screen.getByLabelText('Rule name') as HTMLInputElement;
  await user.type(ruleName, 'New handover');
  fireEvent.compositionStart(ruleName);
  ruleName.setSelectionRange(3, 3);
  fireEvent.change(ruleName, { target: { value: 'New协作 handover' } });
  fireEvent.compositionEnd(ruleName, { data: '协作' });
  expect(ruleName).toHaveValue('New协作 handover');
  await user.click(screen.getByRole('combobox', { name: 'Resource' }));
  await user.click(await screen.findByRole('option', { name: /Employees/ }));
  const subjectSearch = await screen.findByLabelText('Search subjects');
  fireEvent.compositionStart(subjectSearch);
  await user.type(subjectSearch, 'Bob');
  fireEvent.compositionEnd(subjectSearch, { data: 'Bob' });
  expect(subjectSearch).toHaveValue('Bob');
  await user.click(await screen.findByRole('button', { name: 'Add subject' }));
  await user.click(
    screen.getByRole('combobox', { name: 'Choose an action and data scope' }),
  );
  await user.click(await screen.findByRole('option', { name: 'Read' }));
  await user.click(
    screen.getByRole('button', { name: 'Add action and scope' }),
  );
  await user.click(screen.getByRole('combobox', { name: 'Allowed records' }));
  await user.click(
    await screen.findByRole('option', { name: 'Choose specific records' }),
  );
  await user.click(
    await screen.findByRole('checkbox', { name: 'Bob Employee' }),
  );
  await user.click(screen.getByRole('button', { name: 'Save rule' }));

  expect(await screen.findByText('New协作 handover')).toBeTruthy();
  const createIndex = calls.mock.calls.findIndex(
    ([call]) =>
      call.method === 'POST' && call.path === 'authorization/restrictionRules',
  );
  expect(createIndex).toBeGreaterThan(-1);
  expect(
    calls.mock.calls
      .slice(createIndex + 1)
      .some(
        ([call]) =>
          call.method === 'GET' &&
          call.path === 'authorization/restrictionRules',
      ),
  ).toBe(true);
  const created = calls.mock.calls[createIndex][0].json as RestrictionRule;
  expect(created).toMatchObject({
    key: 'new-handover',
    title: 'New协作 handover',
    resource: { type: 'database.collection', id: 'employees' },
    subjects: [{ type: 'user', id: 'bob' }],
    actions: [
      {
        action: 'read',
        selection: { type: 'records', ids: ['employee-2'] },
      },
    ],
  });
});

it('allows an explicit all-record restriction rule', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/new',
    permissions: ['read', 'create'],
  });

  await user.type(
    await screen.findByRole('textbox', { name: /Rule key/ }),
    'all-records',
  );
  await user.click(screen.getByRole('combobox', { name: 'Resource' }));
  await user.click(await screen.findByRole('option', { name: /Employees/ }));
  await user.click(await screen.findByLabelText('Search subjects'));
  await user.click(await screen.findByRole('button', { name: 'Add subject' }));
  await user.click(
    screen.getByRole('combobox', { name: 'Choose an action and data scope' }),
  );
  await user.click(await screen.findByRole('option', { name: 'Read' }));
  await user.click(
    screen.getByRole('button', { name: 'Add action and scope' }),
  );
  await user.click(screen.getByRole('combobox', { name: 'Allowed records' }));
  await user.click(await screen.findByRole('option', { name: 'All records' }));
  expect(
    await screen.findByText(
      'All records remain eligible through this rule. This selection does not narrow the other authorization sources.',
    ),
  ).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Save rule' }));

  expect((await screen.findAllByText('all-records')).length).toBeGreaterThan(0);
  const createCall = calls.mock.calls.find(
    ([call]) =>
      call.method === 'POST' && call.path === 'authorization/restrictionRules',
  );
  expect(createCall?.[0].json).toMatchObject({
    key: 'all-records',
    actions: [{ action: 'read', selection: { type: 'all' } }],
  });
});

it('renames a rule through a key-only patch', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
  });
  const key = await screen.findByRole('textbox', { name: /Rule key/ });
  await user.clear(key);
  await user.type(key, 'renamed-handover');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  expect(
    (await screen.findAllByText('renamed-handover')).length,
  ).toBeGreaterThan(0);
  const patch = calls.mock.calls.find(
    ([call]) =>
      call.method === 'PATCH' &&
      call.path === 'authorization/restrictionRules/employee-handover',
  );
  expect(patch?.[0].json).toEqual({ key: 'renamed-handover' });
});

it('refuses a same-field concurrent edit instead of overwriting the latest title', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    latestRule: (listCall) =>
      listCall >= 3
        ? { ...initialRule, title: 'Changed by another admin' }
        : initialRule,
  });
  const title = await screen.findByLabelText('Rule name');
  await user.clear(title);
  await user.type(title, 'My local edit');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  expect(await screen.findByText(/updated by someone else/i)).toBeTruthy();
  expect(screen.getByLabelText('Rule name')).toHaveValue('My local edit');
  expect(
    calls.mock.calls.some(
      ([call]) =>
        call.method === 'PATCH' &&
        call.path === 'authorization/restrictionRules/employee-handover',
    ),
  ).toBe(false);
});

it('patches only changed fields so a concurrent change to an untouched action survives', async () => {
  const user = userEvent.setup();
  const extraAction: RestrictionRule['actions'][number] = {
    action: 'update',
    selection: { type: 'records', ids: ['employee-2'] },
  };
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    latestRule: (listCall) =>
      listCall >= 3
        ? { ...initialRule, actions: [...initialRule.actions, extraAction] }
        : initialRule,
  });
  const title = await screen.findByLabelText('Rule name');
  await user.clear(title);
  await user.type(title, 'Local title');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(screen.queryByLabelText('Rule name')).toBeNull());
  const patch = calls.mock.calls.find(
    ([call]) =>
      call.method === 'PATCH' &&
      call.path === 'authorization/restrictionRules/employee-handover',
  )?.[0].json;
  expect(patch).toEqual({ title: 'Local title' });
});

it('allows a metadata-only edit without rewriting an uncatalogued resource', async () => {
  const user = userEvent.setup();
  const legacyRule: RestrictionRule = {
    ...initialRule,
    resource: { type: 'legacy.plugin-resource', id: 'retired-records' },
    actions: [
      {
        action: 'legacyRead',
        selection: { type: 'records', ids: ['legacy-1'] },
      },
    ],
  };
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    initialRules: [legacyRule],
  });

  const title = await screen.findByLabelText('Rule name');
  await user.clear(title);
  await user.type(title, 'Retained legacy rule');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(screen.queryByLabelText('Rule name')).toBeNull());

  const patch = calls.mock.calls.find(
    ([call]) =>
      call.method === 'PATCH' &&
      call.path === 'authorization/restrictionRules/employee-handover',
  )?.[0].json;
  expect(patch).toEqual({ title: 'Retained legacy rule' });
});

it('keeps other composite data scopes when editing one record selection', async () => {
  const user = userEvent.setup();
  const compositeRule: RestrictionRule = {
    ...initialRule,
    resource: { type: 'composite', id: 'employee.handover' },
    actions: [
      {
        action: 'submit',
        scopeKey: 'employee',
        selection: {
          type: 'recordAccess',
          key: 'customFilter',
          params: {
            filter: {
              kind: 'group',
              logic: 'and',
              items: [
                {
                  kind: 'condition',
                  path: ['id'],
                  operator: '$eq',
                  value: 'employee-1',
                },
              ],
            },
          },
        },
      },
      {
        action: 'submit',
        scopeKey: 'handover',
        selection: { type: 'records', ids: ['employee-1'] },
      },
    ],
  };
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    initialRules: [compositeRule],
  });

  const handoverScope = await screen.findByTestId('restriction-action-1');
  await user.click(
    await within(handoverScope).findByRole('checkbox', {
      name: 'Bob Employee',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(screen.queryByLabelText('Rule name')).toBeNull());

  const patch = calls.mock.calls.find(
    ([call]) =>
      call.method === 'PATCH' &&
      call.path === 'authorization/restrictionRules/employee-handover',
  )?.[0].json;
  expect(patch).toEqual({
    actions: [
      compositeRule.actions[0],
      {
        action: 'submit',
        scopeKey: 'handover',
        selection: { type: 'records', ids: ['employee-1', 'employee-2'] },
      },
    ],
  });
});

it('keeps page two while selecting and removing records without refetching it', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
  });
  await screen.findByRole('checkbox', { name: 'Bob Employee' });
  const action = screen.getByTestId('restriction-action-0');

  await user.click(within(action).getByRole('button', { name: /next/i }));
  const pageTwoRecord = await screen.findByRole('checkbox', {
    name: 'Page Two Employee',
  });
  const nextPageRecord = screen.getByRole('checkbox', {
    name: 'Next Page Employee',
  });

  await user.click(pageTwoRecord);
  expect(
    screen.getByRole('checkbox', { name: 'Page Two Employee' }),
  ).toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Remove record employee-1' }),
  ).toBeTruthy();
  expect(
    screen.getByRole('button', { name: 'Remove record employee-22' }),
  ).toBeTruthy();
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();

  await user.click(nextPageRecord);
  expect(
    screen.getByRole('checkbox', { name: 'Next Page Employee' }),
  ).toBeChecked();
  expect(
    screen.getByRole('button', { name: 'Remove record employee-23' }),
  ).toBeTruthy();
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();

  await user.click(pageTwoRecord);
  expect(
    screen.getByRole('checkbox', { name: 'Page Two Employee' }),
  ).not.toBeChecked();
  expect(
    screen.getByRole('checkbox', { name: 'Next Page Employee' }),
  ).toBeChecked();
  expect(
    screen.queryByRole('button', { name: 'Remove record employee-22' }),
  ).toBeNull();
  expect(
    screen.getByRole('button', { name: 'Remove record employee-1' }),
  ).toBeTruthy();
  expect(screen.getByText('Page 2 of 2')).toBeTruthy();

  const recordRequests = calls.mock.calls
    .map(([call]) => call)
    .filter((call) =>
      call.path.startsWith('authorization/restrictionRules/records/'),
    );
  expect(recordRequests.map((call) => call.query?.page)).toEqual(['1', '2']);
});

it('resets the picker when the action changes', async () => {
  const user = userEvent.setup();
  const { calls, heldRecords } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    holdRecordPage: { collection: 'employees', page: 2 },
  });
  await screen.findByRole('checkbox', { name: 'Bob Employee' });
  let action = screen.getByTestId('restriction-action-0');
  await user.click(within(action).getByRole('button', { name: /next/i }));
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([call]) =>
          call.path.endsWith('/employees') && call.query?.page === '2',
      ),
    ).toBe(true),
  );

  await user.click(
    within(action).getByRole('button', { name: 'Remove this action' }),
  );
  await user.click(
    screen.getByRole('combobox', { name: 'Choose an action and data scope' }),
  );
  await user.click(await screen.findByRole('option', { name: 'Update' }));
  await user.click(
    screen.getByRole('button', { name: 'Add action and scope' }),
  );

  action = screen.getByTestId('restriction-action-0');
  expect(
    await within(action).findByRole('checkbox', { name: 'Bob Employee' }),
  ).toBeTruthy();
  await act(async () => {
    heldRecords.resolve({
      data: [{ id: 'employee-22', label: 'Late Employee Result' }],
      meta: { page: 2, pageSize: 20, total: 22 },
    });
  });
  expect(
    within(action).queryByRole('checkbox', { name: 'Page Two Employee' }),
  ).toBeNull();
  expect(
    within(action).queryByRole('checkbox', { name: 'Late Employee Result' }),
  ).toBeNull();
  expect(within(action).getByText('Page 1 of 2')).toBeTruthy();
  const recordRequests = calls.mock.calls
    .map(([call]) => call)
    .filter((call) =>
      call.path.startsWith('authorization/restrictionRules/records/'),
    );
  expect(recordRequests.map((call) => call.query?.page)).toEqual([
    '1',
    '2',
    '1',
  ]);
});

it('discards a late record response after changing resources', async () => {
  const user = userEvent.setup();
  const { calls, heldRecords } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    holdRecordPage: { collection: 'employees', page: 2 },
  });
  await screen.findByRole('checkbox', { name: 'Bob Employee' });
  const action = screen.getByTestId('restriction-action-0');
  await user.click(within(action).getByRole('button', { name: /next/i }));
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([call]) =>
          call.path.endsWith('/employees') && call.query?.page === '2',
      ),
    ).toBe(true),
  );

  await user.click(screen.getByRole('combobox', { name: 'Resource' }));
  await user.click(
    await screen.findByRole('option', {
      name: /Departments · database\.collection:departments/,
    }),
  );
  await user.click(
    await screen.findByRole('button', {
      name: 'Change resource and clear actions',
    }),
  );
  await user.click(
    screen.getByRole('combobox', { name: 'Choose an action and data scope' }),
  );
  await user.click(await screen.findByRole('option', { name: 'Read' }));
  await user.click(
    screen.getByRole('button', { name: 'Add action and scope' }),
  );
  expect(
    await screen.findByRole('checkbox', { name: 'Finance Department' }),
  ).toBeTruthy();

  await act(async () => {
    heldRecords.resolve({
      data: [{ id: 'employee-22', label: 'Late Employee Result' }],
      meta: { page: 2, pageSize: 20, total: 22 },
    });
  });

  expect(
    screen.getByRole('checkbox', { name: 'Finance Department' }),
  ).toBeTruthy();
  expect(
    screen.queryByRole('checkbox', { name: 'Late Employee Result' }),
  ).toBeNull();
  expect(
    screen.queryByRole('button', { name: 'Remove record employee-1' }),
  ).toBeNull();
  expect(
    within(screen.getByTestId('restriction-action-0')).getByText('Page 1 of 1'),
  ).toBeTruthy();
  const recordRequests = calls.mock.calls
    .map(([call]) => call)
    .filter((call) =>
      call.path.startsWith('authorization/restrictionRules/records/'),
    );
  expect(
    recordRequests.map((call) => [
      call.path.split('/').at(-1),
      call.query?.page,
    ]),
  ).toEqual([
    ['employees', '1'],
    ['employees', '2'],
    ['departments', '1'],
  ]);
});

it('keeps the form draft and hides backend details after a save validation failure', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    failPatch: true,
  });
  const title = await screen.findByLabelText('Rule name');
  await user.clear(title);
  await user.type(title, 'Keep this draft');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  expect(await screen.findByText(enUS.settings.invalidRequest)).toBeTruthy();
  expect(screen.getByLabelText('Rule name')).toHaveValue('Keep this draft');
  expect(screen.queryByText('private server detail')).toBeNull();
  expect(
    calls.mock.calls.filter(
      ([call]) =>
        call.method === 'PATCH' && call.path.includes('restrictionRules/'),
    ),
  ).toHaveLength(1);
});

it('discards a late subject directory response after the administrator changes subject type', async () => {
  const user = userEvent.setup();
  const { heldSubjects } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    holdUserSubjects: true,
  });
  const typeSelect = await screen.findByRole('combobox', {
    name: 'Subject type',
  });
  await user.click(typeSelect);
  await user.click(await screen.findByRole('option', { name: 'Team' }));
  expect(await screen.findByText('Team One')).toBeTruthy();
  await act(async () => {
    heldSubjects.resolve({
      data: [{ id: 'late-user', title: 'Late user result' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });
  await waitFor(() =>
    expect(screen.queryByText('Late user result')).toBeNull(),
  );
});

it('does not restore a pending directory result after access is revoked', async () => {
  const { calls, heldSubjects, setPermissions } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    holdUserSubjects: true,
  });
  await screen.findByLabelText('Search subjects');
  await waitFor(() =>
    expect(
      calls.mock.calls.some(
        ([call]) =>
          call.path === 'authorization/restrictionRules/subjects/user',
      ),
    ).toBe(true),
  );

  await act(async () => setPermissions([]));
  expect(await screen.findByText(/you do not have access/i)).toBeTruthy();
  await act(async () => {
    heldSubjects.resolve({
      data: [{ id: 'late-user', title: 'Late user result' }],
      meta: { page: 1, pageSize: 20, total: 1 },
    });
  });
  expect(screen.queryByText('Late user result')).toBeNull();
  expect(screen.queryByLabelText('Rule name')).toBeNull();
});

it('clears the edit form when the update permission is revoked by the target service', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({
    route: '/settings/authorization/restriction-rules/edit/employee-handover',
    permissions: ['read', 'update'],
    revokeOnPatch: true,
  });
  const title = await screen.findByLabelText('Rule name');
  await user.clear(title);
  await user.type(title, 'Unsaved private draft');
  await user.click(screen.getByRole('button', { name: 'Save rule' }));
  await waitFor(() => expect(screen.queryByLabelText('Rule name')).toBeNull());
  expect(await screen.findByText(/you do not have access/i)).toBeTruthy();
  expect(screen.queryByText('Unsaved private draft')).toBeNull();
  expect(calls.mock.calls.some(([call]) => call.method === 'PATCH')).toBe(true);
});

it('confirms deletes, skips writes on cancel, and restores focus after deletion', async () => {
  const user = userEvent.setup();
  const { calls } = await mount({ permissions: ['read', 'delete'] });
  const menuButton = await screen.findByRole('button', {
    name: 'Actions for Employee handover',
  });

  await user.click(menuButton);
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  let dialog = await screen.findByRole('alertdialog');
  expect(dialog.textContent).toContain('permanently removes the rule');
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(calls.mock.calls.some(([call]) => call.method === 'DELETE')).toBe(
    false,
  );
  expect(screen.getByText('Employee handover')).toBeTruthy();

  await user.click(menuButton);
  await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
  dialog = await screen.findByRole('alertdialog');
  await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText('No restriction rules yet')).toBeTruthy();
  expect(
    calls.mock.calls.filter(([call]) => call.method === 'DELETE'),
  ).toHaveLength(1);
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen
        .getByRole('heading', { name: 'Restriction rules' })
        .querySelector('span'),
    ),
  );
});

it('returns focus to the list heading when an edit page closes', async () => {
  const user = userEvent.setup();
  await mount();
  await user.click(
    await screen.findByRole('button', {
      name: 'Actions for Employee handover',
    }),
  );
  await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));
  expect(await screen.findByLabelText('Rule name')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen
        .getByRole('heading', { name: 'Restriction rules' })
        .querySelector('span'),
    ),
  );
});
