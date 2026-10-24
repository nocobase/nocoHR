import type { AppClientRegisteredRoute } from '@nocobase/app-client/plugins';
import {
  TestI18nProvider,
  createTestI18nRuntime,
} from '@nocobase/i18n/testing';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { AppLayout } from '../../client/layouts/app-layout.js';
import enUS from '../../client/locales/en-US.js';

const deniedRouteKeys = vi.hoisted(() => new Set<string>());

// Breadcrumb titles are route data, not keys any namespace owns: the trail translates each through its package's
// namespace with the title itself as `defaultValue`, so the runtime is not strict.
const runtime = await createTestI18nRuntime({
  application: { namespace: '@nocobase/app-template-default', resources: enUS },
  strict: false,
});

function I18n({ children }: { readonly children: ReactNode }) {
  return <TestI18nProvider runtime={runtime}>{children}</TestI18nProvider>;
}

vi.mock('@nocobase/app-plugin-i18n/client', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@nocobase/app-plugin-i18n/client')
  >()),
  useSyncServerLocale: () => {},
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useClientApplication: () => ({ runtime: { routes: [] } }),
}));
vi.mock('../../client/routing/route-navigation.js', async (original) => ({
  ...(await original<
    typeof import('../../client/routing/route-navigation.js')
  >()),
  useRouteNavigation: () => ({
    items: [],
    denied: deniedRouteKeys,
    loading: false,
  }),
}));
vi.mock('../../client/layouts/components/app-sidebar.js', async (original) => ({
  ...(await original<
    typeof import('../../client/layouts/components/app-sidebar.js')
  >()),
  AppSidebar: () => null,
}));
beforeEach(() => {
  deniedRouteKeys.clear();
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => vi.unstubAllGlobals());
vi.mock('../../client/layouts/components/header-actions.js', () => ({
  HeaderActions: () => null,
}));

it('renders route breadcrumbs in the application header and follows a parent link', async () => {
  const child: AppClientRegisteredRoute = {
    id: 'detail',
    name: 'detail',
    packageName: 'test',
    source: 'application',
    auth: 'required',
    path: '/orders/:id',
    breadcrumb: { title: 'Detail' },
    componentLoader: async () => ({ default: () => null }),
  };
  const routes = [
    {
      ...child,
      id: 'orders',
      name: 'orders',
      path: '/orders',
      breadcrumb: { title: 'Orders' },
      children: [child],
    },
  ];
  render(
    <MemoryRouter initialEntries={['/orders/42']}>
      <Routes>
        <Route element={<AppLayout routes={routes} />}>
          <Route path='/orders' element={<span>Orders home</span>} />
          <Route path='/orders/:id' element={<span>Detail page</span>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper: I18n },
  );
  expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
  const orders = screen.getByRole('link', { name: 'Orders' });
  expect(orders).toHaveAttribute('href', '/orders');
  expect(screen.getByText('Detail')).toHaveAttribute('aria-current', 'page');
  expect(screen.getByText('Detail page')).toBeVisible();
  await userEvent.click(orders);
  expect(await screen.findByText('Orders home')).toBeVisible();
});

it('does not show a denied page in the application breadcrumb', () => {
  deniedRouteKeys.add('test:/orders/:id:detail');
  const child: AppClientRegisteredRoute = {
    id: 'detail',
    name: 'detail',
    packageName: 'test',
    source: 'application',
    auth: 'required',
    path: '/orders/:id',
    breadcrumb: { title: 'Detail' },
    componentLoader: async () => ({ default: () => null }),
  };
  const routes = [
    {
      ...child,
      id: 'orders',
      name: 'orders',
      path: '/orders',
      breadcrumb: { title: 'Orders' },
      children: [child],
    },
  ];
  render(
    <MemoryRouter initialEntries={['/orders/42']}>
      <Routes>
        <Route element={<AppLayout routes={routes} />}>
          <Route path='/orders/:id' element={<span>Detail page</span>} />
        </Route>
      </Routes>
    </MemoryRouter>,
    { wrapper: I18n },
  );
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(breadcrumb).toBeVisible();
  expect(
    screen.queryByText('Detail', { selector: '[aria-current="page"]' }),
  ).not.toBeInTheDocument();
  expect(screen.getByText('Orders')).toHaveAttribute('aria-current', 'page');
});
