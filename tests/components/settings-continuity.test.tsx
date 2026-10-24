import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { apiClientToken, type ClientApplication } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
} from '@nocobase/app-plugin-authorization/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation, useNavigate } from 'react-router';
import { expect, it, vi } from 'vitest';
import RolesPage from '../../client/pages/settings/roles.js';
import UsersPage from '../../client/pages/settings/users.js';
import { ConfirmAction } from '../../client/pages/settings/shared.js';
import enUS from '../../client/locales/en-US.js';
import zhCN from '../../client/locales/zh-CN.js';

const namespace = '@nocobase/settings-continuity-test';
const namespaces = {
  [namespace]: {
    'en-US': async () => ({ default: enUS }),
    'zh-CN': async () => ({ default: zhCN }),
  },
};
const services = (app: ClientApplication) =>
  app.container.instance(
    authorizationClientToken,
    new AuthorizationClient(app.container.resolve(apiClientToken)),
  );
const userRow = {
  id: 'test-user',
  name: 'Test User',
  username: 'test-user',
  email: 'test-user@example.test',
  disabledAt: null,
  roleScopes: { department: ['sales'] },
};
const userOptions = {
  data: {
    roleScopes: [
      {
        key: 'department',
        label: 'Department',
        selection: 'multiple' as const,
        requiredOnCreate: false,
        options: [{ value: 'sales', label: 'Sales team' }],
      },
    ],
  },
};

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid='location'>
      {location.pathname}
      {location.search}
    </output>
  );
}

function DetailRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p>Detail {location.pathname}</p>
      <button onClick={() => void navigate(-1)}>Back to users</button>
    </>
  );
}

function RoleEditRoute() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p>Role editor {location.pathname}</p>
      <button onClick={() => void navigate(-1)}>Back to roles</button>
    </>
  );
}

it('keeps user list filters in the URL while opening the existing detail route and returning', async () => {
  const user = userEvent.setup();
  const calls = vi.fn(({ path }: { path: string }) => {
    if (path === 'authorization/permissions')
      return { data: { unrestricted: true, permissions: [] } };
    if (path === 'users/options') return userOptions;
    return { data: [userRow], meta: { total: 41 } };
  });

  await renderWithApp(
    <>
      <Routes>
        <Route path='/settings/users' element={<UsersPage />}>
          <Route path=':userId' element={<DetailRoute />} />
          <Route path=':userId/edit' element={<p>User editor</p>} />
        </Route>
      </Routes>
      <LocationProbe />
    </>,
    {
      route:
        '/settings/users?page=2&pageSize=20&q=Test&status=enabled&source=directory',
      namespace,
      namespaces,
      services,
      fetch: answerApi(calls),
    },
  );

  const nameLink = await screen.findByRole('link', { name: 'Test User' });
  expect(nameLink).toHaveAttribute(
    'href',
    '/settings/users/test-user?page=2&pageSize=20&q=Test&status=enabled&source=directory',
  );
  await user.click(nameLink);
  expect(
    await screen.findByText('Detail /settings/users/test-user'),
  ).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('source=directory');

  await user.click(screen.getByRole('button', { name: 'Back to users' }));
  expect(await screen.findByRole('link', { name: 'Test User' })).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent('page=2');
  expect(screen.getByTestId('location')).toHaveTextContent('q=Test');
  expect(screen.getByTestId('location')).toHaveTextContent('source=directory');
  await waitFor(() =>
    expect(
      screen.getByRole('textbox', { name: enUS.settings.userSearch }),
    ).toHaveFocus(),
  );
});

it('applies paired role filters and clears only this page’s filters', async () => {
  const user = userEvent.setup();
  const calls = vi.fn(({ path }: { path: string }) => {
    if (path === 'authorization/permissions')
      return { data: { unrestricted: false, permissions: [] } };
    if (path === 'users/options') return userOptions;
    return { data: [userRow], meta: { total: 41 } };
  });

  await renderWithApp(
    <>
      <UsersPage />
      <LocationProbe />
    </>,
    {
      route:
        '/settings/users?page=2&pageSize=20&status=enabled&order=desc&source=directory&returnTo=%2Fsettings%2Froles',
      namespace,
      namespaces,
      services,
      fetch: answerApi(calls),
    },
  );

  await user.click(
    await screen.findByRole('combobox', {
      name: enUS.settings.assignedRoles,
    }),
  );
  await user.click(
    await screen.findByRole('option', { name: 'Department · Sales team' }),
  );
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'users',
        query: expect.objectContaining({
          roleScope: 'department',
          role: 'sales',
        }),
      }),
    ),
  );
  expect(screen.getByTestId('location')).toHaveTextContent('source=directory');

  await user.click(screen.getByRole('button', { name: 'Clear filters' }));
  await waitFor(() =>
    expect(screen.getByTestId('location')).not.toHaveTextContent('roleScope='),
  );
  const current = screen.getByTestId('location');
  expect(current).toHaveTextContent('pageSize=20');
  expect(current).toHaveTextContent('order=desc');
  expect(current).toHaveTextContent('source=directory');
  expect(current).toHaveTextContent('returnTo=');
});

it('keeps an incomplete role filter visible and reports the server rejection', async () => {
  const calls = vi.fn(
    ({ path, query }: { path: string; query?: Record<string, string> }) => {
      if (path === 'authorization/permissions')
        return { data: { unrestricted: false, permissions: [] } };
      if (path === 'users/options') return userOptions;
      if (query?.role)
        return Response.json(
          { error: { code: 'INVALID_ARGUMENT', message: 'Invalid filter' } },
          { status: 400 },
        );
      return { data: [userRow], meta: { total: 1 } };
    },
  );

  await renderWithApp(<UsersPage />, {
    route: '/settings/users?role=sales',
    namespace,
    namespaces,
    services,
    fetch: answerApi(calls),
  });

  expect(
    await screen.findByText(enUS.settings.roleFilterIncomplete),
  ).toBeVisible();
  expect(await screen.findByText(enUS.settings.invalidRequest)).toBeVisible();
  expect(
    calls.mock.calls.some(
      ([call]) => call.path === 'users' && call.query?.role === 'sales',
    ),
  ).toBe(true);
});

it('keeps role table page and query through direct edit navigation and browser Back', async () => {
  const user = userEvent.setup();
  const roles = Array.from({ length: 12 }, (_, index) => ({
    key: `role-${index}`,
    title: `Role ${String(index).padStart(2, '0')}`,
    grants: [],
  }));
  const calls = vi.fn(({ path }: { path: string }) =>
    path === 'authorization/permissions'
      ? { data: { unrestricted: true, permissions: [] } }
      : { data: roles },
  );

  await renderWithApp(
    <>
      <Routes>
        <Route
          path='/settings/authorization/permission-sets'
          element={<RolesPage />}
        >
          <Route path='edit/:key' element={<RoleEditRoute />} />
        </Route>
      </Routes>
      <LocationProbe />
    </>,
    {
      route:
        '/settings/authorization/permission-sets?page=2&pageSize=10&source=permission-sets',
      namespace,
      namespaces,
      services,
      fetch: answerApi(calls),
    },
  );

  const roleLink = await screen.findByRole('link', { name: 'Role 11' });
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
  expect(roleLink).toHaveAttribute(
    'href',
    '/settings/authorization/permission-sets/edit/role-11?page=2&pageSize=10&source=permission-sets',
  );
  await user.click(roleLink);
  expect(
    await screen.findByText(
      'Role editor /settings/authorization/permission-sets/edit/role-11',
    ),
  ).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Back to roles' }));
  expect(await screen.findByRole('link', { name: 'Role 11' })).toBeVisible();
  expect(screen.getByText('Page 2 of 2')).toBeVisible();
  expect(screen.getByTestId('location')).toHaveTextContent(
    'source=permission-sets',
  );
});

it('shows a translated invalid-request state without a retry action', async () => {
  await renderWithApp(<RolesPage />, {
    route: '/settings/authorization/permission-sets',
    namespace,
    namespaces,
    services,
    fetch: answerApi(({ path }) =>
      path === 'authorization/permissions'
        ? { data: { unrestricted: true, permissions: [] } }
        : Response.json(
            { error: { code: 'INVALID_ARGUMENT', message: 'Invalid input' } },
            { status: 400 },
          ),
    ),
  });

  expect(await screen.findByText(enUS.settings.invalidRequest)).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});

it('shows a denied settings-data state without exposing an empty role table', async () => {
  await renderWithApp(<RolesPage />, {
    route: '/settings/authorization/permission-sets',
    namespace,
    namespaces,
    services,
    fetch: answerApi(({ path }) =>
      path === 'authorization/permissions'
        ? { data: { unrestricted: true, permissions: [] } }
        : Response.json(
            { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
            { status: 403 },
          ),
    ),
  });

  expect(await screen.findByText(enUS.settings.denied)).toBeVisible();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'Retry' }),
  ).not.toBeInTheDocument();
});

it('shows the loading state for a direct users URL until its rows arrive', async () => {
  let resolveUsers!: (value: unknown) => void;
  const pendingUsers = new Promise<unknown>((resolve) => {
    resolveUsers = resolve;
  });

  await renderWithApp(<UsersPage />, {
    route: '/settings/users?page=2&pageSize=20&source=directory',
    namespace,
    namespaces,
    services,
    fetch: answerApi(({ path }) =>
      path === 'authorization/permissions'
        ? { data: { unrestricted: true, permissions: [] } }
        : path === 'users/options'
          ? userOptions
          : pendingUsers,
    ),
  });

  expect(screen.getByLabelText(enUS.settings.loading)).toBeVisible();
  resolveUsers({ data: [userRow], meta: { total: 41 } });
  expect(await screen.findByRole('link', { name: 'Test User' })).toBeVisible();
});

it('explains the empty read-only state without adding creation actions', async () => {
  await renderWithApp(<RolesPage />, {
    route: '/settings/authorization/permission-sets',
    namespace,
    namespaces,
    services,
    fetch: answerApi(({ path }) =>
      path === 'authorization/permissions'
        ? { data: { unrestricted: false, permissions: [] } }
        : { data: [] },
    ),
  });

  expect(
    await screen.findByText(enUS.settings.rolesReadOnlyEmpty),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'New role' }),
  ).not.toBeInTheDocument();
});

it('explains the empty read-only user state without adding creation actions', async () => {
  await renderWithApp(<UsersPage />, {
    route: '/settings/users',
    namespace,
    namespaces,
    services,
    fetch: answerApi(({ path }) =>
      path === 'authorization/permissions'
        ? { data: { unrestricted: false, permissions: [] } }
        : path === 'users/options'
          ? userOptions
          : { data: [], meta: { total: 0 } },
    ),
  });

  expect(
    await screen.findByText(enUS.settings.usersReadOnlyEmpty),
  ).toBeVisible();
  expect(
    screen.queryByRole('button', { name: 'New user' }),
  ).not.toBeInTheDocument();
});

it('keeps a failed action visible in the confirmation dialog', async () => {
  await renderWithApp(
    <ConfirmAction
      open
      title='Confirm action'
      description='This action changes access.'
      error={<p role='alert'>The action failed.</p>}
      busy={false}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
    { namespace, namespaces },
  );

  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The action failed.',
  );
});
