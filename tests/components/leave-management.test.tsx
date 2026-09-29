import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  saved: vi.fn(),
  reload: vi.fn(),
  toast: vi.fn(),
  can: true,
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: state.can, isPending: false }),
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
      return typeof result === 'string'
        ? result.replace(/\{\{(\w+)\}\}/gu, (_, token: string) =>
            String(args[token] ?? ''),
          )
        : key;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));

import LeaveTypeEditor from '../../client/pages/talent/leave/types/edit';
import AdjustBalancePage from '../../client/pages/talent/leave/balances/adjust';
import InitializeBalancesPage from '../../client/pages/talent/leave/balances/initialize';
import LeaveTypesPage from '../../client/pages/talent/leave/types/index';

function mount(kind: 'type' | 'adjust' | 'initialize' | 'list', path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/leave'
          element={
            <Outlet context={{ saved: state.saved, reload: state.reload }} />
          }
        >
          <Route path='new' element={<LeaveTypeEditor />} />
          <Route path='types/:typeId/edit' element={<LeaveTypeEditor />} />
          <Route path='balances/:balanceId' element={<AdjustBalancePage />} />
          <Route path='initialize' element={<InitializeBalancesPage />} />
          <Route
            path='list'
            element={kind === 'list' ? <LeaveTypesPage /> : null}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const type = {
  id: 'annual',
  code: 'annual',
  title: 'Annual',
  payType: 'paid',
  unit: 'day',
  balanceRule: 'annualBySeniority',
  countBy: 'schedule',
  fixedDays: null,
  requiresAttachment: false,
  active: true,
  updatedAt: '2026-09-28T10:00:00.000',
};
const balance = {
  id: 'balance-1',
  employeeName: 'Li Min',
  employeeNo: 'E001',
  leaveTypeTitle: 'Annual',
  year: 2026,
  available: 5,
  adjustments: [],
  updatedAt: type.updatedAt,
  frozen: false,
};
describe('leave management UI', () => {
  beforeEach(() => {
    state.api.request.mockReset();
    state.saved.mockReset();
    state.reload.mockReset();
    state.toast.mockReset();
    state.can = true;
    state.locale = 'en-US';
  });
  it('validates before writing and preserves typed and IME text on failure', async () => {
    state.api.request.mockRejectedValue(new Error('offline'));
    mount('type', '/leave/new');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByLabelText(/Leave type/u)).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(state.api.request).not.toHaveBeenCalled();
    const title = screen.getByLabelText(/Leave type/u);
    await userEvent.type(title, 'Annul');
    fireEvent.compositionStart(title);
    fireEvent.change(title, { target: { value: '年假 Annual' } });
    fireEvent.compositionEnd(title);
    await userEvent.type(screen.getByLabelText(/Code/u), 'annual');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Request failed. Please try again.'),
    ).toBeInTheDocument();
    expect(title).toHaveValue('年假 Annual');
    expect(screen.getByRole('button', { name: 'Save' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByText('Discard unsaved leave changes?'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(title).toHaveValue('年假 Annual');
  });
  it('loads the latest record, submits the version and guards all closes while saving', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation((options: { method?: string }) =>
      options.method
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ data: type }),
    );
    mount('type', '/leave/types/annual/edit');
    const title = await screen.findByDisplayValue('Annual');
    fireEvent.change(title, { target: { value: 'Annual revised' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save/u })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(title).toBeInTheDocument();
    expect(state.api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        method: 'PATCH',
        json: expect.objectContaining({
          expectedUpdatedAt: type.updatedAt,
          value: expect.objectContaining({ title: 'Annual revised' }),
        }),
      }),
    );
    await act(async () => {
      finish?.({ data: { ...type, title: 'Annual revised' } });
    });
    await waitFor(() =>
      expect(state.saved).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Annual revised' }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByDisplayValue('Annual revised'),
      ).not.toBeInTheDocument(),
    );
  });
  it('requires a reason and reuses the idempotency key when an adjustment is retried', async () => {
    state.api.request.mockImplementation((options: { method?: string }) =>
      options.method
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: balance }),
    );
    mount('adjust', '/leave/balances/balance-1');
    const delta = await screen.findByLabelText(/Adjustment \(days\)/u);
    fireEvent.change(delta, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Enter the reason for this adjustment.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason/u), {
      target: { value: 'Verified allowance' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Request failed. Please try again.');
    const first = state.api.request.mock.calls.at(-1)![0] as {
      json: { idempotencyKey: string };
    };
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.api.request).toHaveBeenCalledTimes(3));
    const second = state.api.request.mock.calls.at(-1)![0] as {
      json: { idempotencyKey: string };
    };
    expect(second.json.idempotencyKey).toBe(first.json.idempotencyKey);
    expect(delta).toHaveValue(1);
  });
  it('shows frozen status and disables the adjustment action', async () => {
    state.api.request.mockResolvedValue({ data: { ...balance, frozen: true } });
    mount('adjust', '/leave/balances/balance-1');
    expect(
      await screen.findByText(
        'This employee has left. Their balance is frozen and cannot be adjusted.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByLabelText(/Reason/u)).toBeDisabled();
  });
  it('derives the initialization year from the date and reports skipped/missing employees', async () => {
    state.api.request.mockResolvedValue({
      data: {
        created: ['one'],
        skippedEmployeeIds: ['left'],
        needsCareerStartDate: ['missing'],
      },
    });
    mount('initialize', '/leave/initialize?year=2026');
    fireEvent.change(screen.getByLabelText(/Calculation date/u), {
      target: { value: '2025-12-31' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(state.api.request).toHaveBeenCalledWith(
        expect.objectContaining({ json: { year: 2025, asOf: '2025-12-31' } }),
      ),
    );
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Created 1 balance records',
        description: '1 employees skipped; 1 need a career start date.',
      }),
    );
  });
  it('renders Chinese text and distinguishes empty search results without exposing a denied create action', async () => {
    state.locale = 'zh-CN';
    state.can = false;
    state.api.request.mockResolvedValue({
      data: [type],
      meta: { truncated: true },
    });
    mount('list', '/leave/list');
    await screen.findByText('Annual');
    expect(
      screen.queryByRole('button', { name: '新建假期类型' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        '仅加载前 500 条记录。搜索只匹配已加载记录，不代表完整目录。',
      ),
    ).toBeInTheDocument();
    const search = screen.getByRole('textbox', {
      name: '按假期名称或编码搜索',
    });
    fireEvent.change(search, { target: { value: 'not-found' } });
    expect(screen.getByText('无匹配结果')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '清除筛选' })[0]);
    expect(search).toHaveFocus();
    expect(screen.getByText('Annual')).toBeInTheDocument();
  });
});
