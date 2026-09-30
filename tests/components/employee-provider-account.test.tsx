import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V1-03 on the employee detail page: 使用飞书身份开通 for an employee bound to a
// Feishu member without a login, through the 组织同步 account endpoint.
const state = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  reload: vi.fn(),
  canResolve: true,
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({
    can: state.canResolve,
    isPending: false,
    error: undefined,
    retry: () => undefined,
  }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      if (typeof result !== 'string') return key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [],
    positions: [],
    departmentTitle: () => 'Assembly',
    positionTitle: (id: string) => id,
    loading: false,
    reload: () => undefined,
  }),
}));

import EmployeeDetailPage from '../../client/pages/talent/employees/detail/index';

const bound = {
  employee: {
    id: 'emp-sunli',
    name: 'Sun Li',
    employeeNo: 'QH1203',
    departmentId: 'nj-as',
    positionId: null,
    status: 'probation',
    userId: null,
    externalProvider: 'feishu',
    externalUserId: 'ou_sunli',
  },
  departmentTitle: 'Assembly',
  positionTitle: null,
  userName: null,
  can: {},
};

function mount(detail: unknown) {
  state.request.mockImplementation(
    (options: { path: string; method?: string }) => {
      if (options.method === 'POST')
        return Promise.resolve({ data: { userId: 'u-new' } });
      if (options.path === 'talent/employees/emp-sunli')
        return Promise.resolve({ data: detail });
      return Promise.resolve({ data: [] });
    },
  );
  return render(
    <MemoryRouter initialEntries={['/talent/employees/emp-sunli/profile']}>
      <Routes>
        <Route
          path='/talent/employees'
          element={<Outlet context={{ reload: state.reload }} />}
        >
          <Route path=':employeeId' element={<EmployeeDetailPage />}>
            <Route path='profile' element={<p>profile tab</p>} />
          </Route>
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('使用飞书身份开通', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.reload.mockReset();
    state.canResolve = true;
  });

  it('creates the login for a bound employee, sending the email only when one is typed', async () => {
    mount(bound);
    const label = en.talent.detail.accountFromProvider.replace(
      '{{provider}}',
      en.orgSync.provider.feishu,
    );
    fireEvent.click(await screen.findByRole('button', { name: label }));
    fireEvent.click(
      await screen.findByRole('button', { name: en.orgSync.account.submit }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/org-sync/employees/emp-sunli/account',
          method: 'POST',
          json: {},
        }),
      ),
    );
    await waitFor(() => expect(state.toast).toHaveBeenCalled());
  });

  it('is not offered without the permission, a binding, or when a login exists', async () => {
    state.canResolve = false;
    const { unmount } = mount(bound);
    await screen.findByText('profile tab');
    expect(
      screen.queryByRole('button', { name: /Feishu/u }),
    ).not.toBeInTheDocument();
    unmount();
    state.canResolve = true;
    mount({ ...bound, employee: { ...bound.employee, userId: 'u1' } });
    await screen.findByText('profile tab');
    expect(
      screen.queryByRole('button', { name: /Feishu/u }),
    ).not.toBeInTheDocument();
  });
});
