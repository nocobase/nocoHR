import { answerApi, renderWithApp } from '@nocobase/app-testing/client';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Routes, Route, useLocation } from 'react-router';
import { expect, it, vi } from 'vitest';
import Explorer from '../../client/pages/settings/database-explorer/database-explorer-page.js';
import Fields from '../../client/pages/settings/database-explorer/collection-fields.js';
import Columns from '../../client/pages/settings/database-explorer/collection-columns.js';
import enUS from '../../client/locales/en-US.js';
function Location() {
  const loc = useLocation();
  return <output data-testid='db-location'>{loc.pathname + loc.search}</output>;
}
it('uses public read clients and keeps a selected collection through tab navigation and direct reload', async () => {
  const calls = vi.fn(({ path }: { path: string }) => {
    if (path.endsWith('/connections'))
      return {
        data: [
          {
            name: 'main',
            dialect: 'sqlite',
            isDefault: true,
            schemaManagement: 'managed',
          },
        ],
      };
    if (path.endsWith('/collections'))
      return {
        data: [
          {
            name: 'employees',
            tableName: 'employees',
            schema: 'main',
            kind: 'table',
          },
        ],
        meta: {},
      };
    if (path.endsWith('/physicalSchema'))
      return {
        data: {
          schema: {
            physical: { columns: [], indexes: [], foreignKeys: [], checks: [] },
          },
        },
      };
    return {
      data: {
        collection: {
          collection: {
            name: 'employees',
            fields: [{ name: 'employeeNumber', type: 'string' }],
            constraints: [],
          },
          warnings: [],
        },
        metadata: null,
      },
    };
  });
  const mount = () =>
    renderWithApp(
      <>
        <Location />
        <Routes>
          <Route path='/settings/database-explorer' element={<Explorer />}>
            <Route path='fields' element={<Fields />} />
            <Route path='columns' element={<Columns />} />
          </Route>
        </Routes>
      </>,
      {
        route:
          '/settings/database-explorer?connection=main&collection=employees',
        namespace: 'db-test',
        namespaces: { 'db-test': { 'en-US': async () => ({ default: enUS }) } },
        fetch: answerApi(calls),
      },
    );
  const user = userEvent.setup();
  const first = await mount();
  expect(await screen.findByText('employeeNumber')).toBeVisible();
  expect(screen.getByTestId('db-location')).toHaveTextContent(
    '/settings/database-explorer/fields?connection=main&collection=employees',
  );
  await user.click(
    screen.getByRole('link', { name: enUS.databaseExplorer.tabs.columns }),
  );
  await waitFor(() =>
    expect(screen.getByTestId('db-location')).toHaveTextContent(
      '/columns?connection=main&collection=employees',
    ),
  );
  expect(
    calls.mock.calls.every(
      ([call]) => !('method' in call) || call.method === 'GET',
    ),
  ).toBe(true);
  first.unmount();
  await mount();
  expect(await screen.findByText('employeeNumber')).toBeVisible();
});
