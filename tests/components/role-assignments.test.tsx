import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { apiClientToken } from '@nocobase/app-client';
import {
  AuthorizationClient,
  authorizationClientToken,
} from '@nocobase/app-plugin-authorization/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { expect, it, vi } from 'vitest';
import Assignments from '../../client/pages/settings/role-assignments.js';
import enUS from '../../client/locales/en-US.js';

async function mount(allow: boolean, protectedRole = false) {
  const rows = [
    {
      id: 'existing',
      subject: { type: 'user', id: 'alice' },
      permissionSet: 'operators',
    },
  ];
  const calls = vi.fn(
    ({
      path,
      method,
      json,
    }: {
      path: string;
      method: string;
      json?: unknown;
    }) => {
      if (path === 'authorization/permissions')
        return {
          data: {
            unrestricted: false,
            permissions: [
              {
                resource: {
                  type: 'settings',
                  id: 'authorization.permission-sets',
                },
                actions: allow ? ['read', 'assign'] : ['read'],
              },
            ],
          },
        };
      if (path.endsWith('/options'))
        return {
          data: {
            sections: [],
            subjectTypes: [
              {
                type: 'authenticated',
                title: 'All signed-in users',
                selection: { type: 'fixed', id: '*' },
              },
            ],
            recordAccess: [],
            collections: [],
          },
        };
      if (path.endsWith('/resolve'))
        return { data: [{ id: 'alice', title: 'Alice' }] };
      if (path.endsWith('/assignments') && method === 'POST') {
        rows.push({
          id: 'new',
          subject: { type: 'authenticated', id: '*' },
          permissionSet: 'operators',
        });
        return { data: { id: 'new', ...(json as object) } };
      }
      if (method === 'DELETE') {
        rows.splice(
          rows.findIndex((row) => path.endsWith('/' + row.id)),
          1,
        );
        return undefined;
      }
      if (path.endsWith('/assignments')) return { data: [...rows] };
      return {
        data: {
          key: 'operators',
          grants: [],
          ...(protectedRole
            ? {
                protection: {
                  owner: 'test',
                  allow: ['assign'],
                  assignableTo: ['authenticated'],
                },
              }
            : {}),
        },
      };
    },
  );
  await renderWithApp(
    <Routes>
      <Route
        path='/settings/authorization/permission-sets/edit/:key/assignments'
        element={<Assignments />}
      />
    </Routes>,
    {
      route:
        '/settings/authorization/permission-sets/edit/operators/assignments',
      namespace: 'assignment-test',
      namespaces: {
        'assignment-test': { 'en-US': async () => ({ default: enUS }) },
      },
      fetch: answerApi(calls),
      services: (app) =>
        app.container.instance(
          authorizationClientToken,
          new AuthorizationClient(app.container.resolve(apiClientToken)),
        ),
    },
  );
  return calls;
}
it('restores the old URL, displays resolved subjects and uses the native assign/revoke operations', async () => {
  const user = userEvent.setup();
  const calls = await mount(true);
  expect(await screen.findByText('Alice')).toBeVisible();
  expect(await screen.findByRole('button', { name: 'Assign' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Revoke' }));
  await user.click(await screen.findByRole('button', { name: 'Revoke' }));
  await waitFor(() =>
    expect(screen.queryByText('Alice')).not.toBeInTheDocument(),
  );
  await user.click(screen.getByRole('combobox'));
  await user.click(screen.getByRole('option', { name: 'All signed-in users' }));
  await user.click(screen.getByRole('button', { name: 'Assign' }));
  await waitFor(() =>
    expect(calls).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: 'authorization/permissionSets/operators/assignments',
        json: { subject: { type: 'authenticated', id: '*' } },
      }),
    ),
  );
});
it.each([
  { allow: false, protectedRole: false },
  { allow: true, protectedRole: true },
])(
  'retains assignment permission and the separate role revoke protection: %j',
  async ({ allow, protectedRole }) => {
    const calls = await mount(allow, protectedRole);
    expect(await screen.findByText('Alice')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Revoke' }),
    ).not.toBeInTheDocument();
    if (allow)
      expect(screen.getByRole('button', { name: 'Assign' })).toBeVisible();
    else
      expect(
        screen.queryByRole('button', { name: 'Assign' }),
      ).not.toBeInTheDocument();
    expect(
      calls.mock.calls.filter(
        ([call]) =>
          call.method === 'DELETE' ||
          (call.method === 'POST' && call.path.endsWith('/assignments')),
      ),
    ).toHaveLength(0);
  },
);
