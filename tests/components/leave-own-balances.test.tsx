import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { ApiClientError } from '@nocobase/app-client';
import { Link, MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  permission: { can: true, isPending: false, error: undefined as unknown },
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => state.permission,
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: state.locale },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = state.locale === 'zh-CN' ? zh : en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      if (typeof result !== 'string') return key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(
          '{{' + name + '}}',
          String(value),
        );
      return result;
    },
  }),
}));
import { MyLeaveBalances } from '../../client/pages/talent/me/leave-balances';

const payload = {
  year: 2040,
  frozen: false,
  items: [
    {
      id: 'own-1',
      leaveTypeTitle: 'Annual leave',
      entitled: 12.5,
      carriedOver: 1,
      used: 2.25,
      pending: 1.5,
      adjusted: -0.25,
      available: 9.5,
    },
  ],
};
function Harness({ revision = 0 }: { revision?: number }) {
  return (
    <MemoryRouter initialEntries={['/talent/me']}>
      <Link to='/talent/me?returned=1'>Return to profile</Link>
      <MyLeaveBalances revision={revision} />
    </MemoryRouter>
  );
}
describe('own leave balance summary', () => {
  beforeEach(() => {
    state.api.request.mockReset().mockResolvedValue({ data: payload });
    state.permission = { can: true, isPending: false, error: undefined };
    state.locale = 'en-US';
  });
  it('uses the server year and numeric ledger values without HR controls or an employee selector', async () => {
    render(<Harness />);
    expect(
      await screen.findByRole('heading', {
        name: 'Leave balances · 2040 (days)',
      }),
    ).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(
      within(rows[1])
        .getAllByRole('cell')
        .map((cell) => cell.textContent),
    ).toEqual(['Annual leave', '12.5', '1', '2.25', '1.5', '-0.25', '9.5']);
    expect(state.api.request).toHaveBeenCalledTimes(1);
    expect(state.api.request.mock.calls[0][0]).toMatchObject({
      path: 'talent/leave/requests/my-balances',
      query: { revision: 0 },
    });
    expect(state.api.request.mock.calls[0][0].query).not.toHaveProperty(
      'employeeId',
    );
    expect(state.api.request.mock.calls[0][0].query).not.toHaveProperty('year');
    expect(
      screen.queryByRole('button', { name: 'Adjust balance' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Initialize balances' }),
    ).not.toBeInTheDocument();
  });
  it('shows loading and then an honest empty state, not an invented zero balance', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await act(async () => finish?.({ data: { ...payload, items: [] } }));
    expect(
      screen.getByText(en.attendance.mine.emptyBalancesDescription),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
  it('localizes frozen balances and unavailable type labels', async () => {
    state.locale = 'zh-CN';
    state.api.request.mockResolvedValue({
      data: {
        ...payload,
        frozen: true,
        items: [{ ...payload.items[0], leaveTypeTitle: null }],
      },
    });
    render(<Harness />);
    expect(
      await screen.findByRole('heading', { name: '假期余额 · 2040 年（天）' }),
    ).toBeInTheDocument();
    expect(screen.getByText('已冻结')).toBeInTheDocument();
    expect(screen.getByText('假期类型不可用')).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: '可用' }),
    ).toBeInTheDocument();
  });
  it.each(['pending', 'denied', 'error'] as const)(
    'does not fetch when permission is %s',
    (kind) => {
      state.permission = {
        can: kind !== 'denied',
        isPending: kind === 'pending',
        error: kind === 'error' ? new Error('private') : undefined,
      };
      render(<Harness />);
      expect(state.api.request).not.toHaveBeenCalled();
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      expect(screen.queryByText('private')).not.toBeInTheDocument();
    },
  );
  it('hides previously loaded data immediately after permission is revoked', async () => {
    const view = render(<Harness />);
    await screen.findByText('Annual leave');
    state.permission.can = false;
    view.rerender(<Harness />);
    expect(screen.queryByText('Annual leave')).not.toBeInTheDocument();
    expect(state.api.request).toHaveBeenCalledTimes(1);
  });
  it('retries network failures without displaying raw backend details', async () => {
    state.api.request.mockRejectedValueOnce(new Error('private SQL details'));
    render(<Harness />);
    expect(
      await screen.findByText(en.attendance.leave.errors.failed),
    ).toBeInTheDocument();
    expect(screen.queryByText('private SQL details')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: en.attendance.leave.retry }),
    );
    await screen.findByText('Annual leave');
    expect(state.api.request).toHaveBeenCalledTimes(2);
  });
  it.each([403, 404])(
    'does not offer a misleading retry for HTTP %s',
    async (status) => {
      state.api.request.mockRejectedValue(
        new ApiClientError('private details', { status }),
      );
      render(<Harness />);
      await screen.findByText(
        status === 403
          ? en.attendance.leave.errors.forbidden
          : en.attendance.leave.errors.notFound,
      );
      expect(
        screen.queryByRole('button', { name: en.attendance.leave.retry }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('private details')).not.toBeInTheDocument();
    },
  );
  it('does not show an old balance while refreshing after submission or cancellation', async () => {
    const view = render(<Harness />);
    await screen.findByText('Annual leave');
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    view.rerender(<Harness revision={1} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Annual leave')).not.toBeInTheDocument();
    await act(async () =>
      finish?.({
        data: {
          ...payload,
          items: [{ ...payload.items[0], pending: 2.5, available: 8.5 }],
        },
      }),
    );
    expect(
      screen.getByRole('cell', { name: '8.5', exact: true }),
    ).toBeInTheDocument();
    expect(state.api.request.mock.lastCall?.[0].query.revision).toBe(1);
    fireEvent.click(screen.getByRole('link', { name: 'Return to profile' }));
    await waitFor(() => expect(state.api.request).toHaveBeenCalledTimes(3));
    await screen.findByRole('cell', { name: '9.5', exact: true });
  });
  it('removes stale values after a failed reload', async () => {
    const view = render(<Harness />);
    await screen.findByText('Annual leave');
    state.api.request.mockRejectedValueOnce(new Error('private reload error'));
    view.rerender(<Harness revision={1} />);
    await screen.findByText(en.attendance.leave.errors.failed);
    expect(screen.queryByText('Annual leave')).not.toBeInTheDocument();
  });
  it('ignores a late response from an older revision', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(<Harness />);
    view.rerender(<Harness revision={1} />);
    await screen.findByText('Annual leave');
    await act(async () =>
      finish?.({
        data: {
          ...payload,
          items: [
            { ...payload.items[0], leaveTypeTitle: 'Stale private balance' },
          ],
        },
      }),
    );
    expect(screen.queryByText('Stale private balance')).not.toBeInTheDocument();
    expect(screen.getByText('Annual leave')).toBeInTheDocument();
  });
});
