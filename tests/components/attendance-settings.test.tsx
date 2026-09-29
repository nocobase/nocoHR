import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  saved: vi.fn(),
  gone: vi.fn(),
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

import { ApiClientError } from '@nocobase/app-client';
import SettingsPage from '../../client/pages/settings/attendance/index';
import Editor from '../../client/pages/settings/attendance/catalog/edit';
import { ConfigCard } from '../../client/pages/settings/attendance/config-card';

const meta = { truncated: false };
const catalog = {
  shifts: { data: [], meta },
  rules: { data: [], meta },
  departments: {
    data: [{ id: 'workshop', title: 'Workshop', active: true }],
    meta,
  },
};
const shift = {
  id: 'night',
  title: 'Night',
  code: 'night',
  startTime: '22:00:00',
  endTime: '06:00:00',
  breakMinutes: 30,
  isNight: true,
  active: true,
  departmentIds: null,
  updatedAt: '2026-09-29T00:00:00.000',
};
const limits = {
  leaveSecondLevelDays: 3,
  monthlyMissingPunchLimit: 3,
  monthlyConfirmationDays: 3,
  consecutiveMissingReminderDays: 2,
  overtimeReminderRatio: 0.8,
};
function mountEditor(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/attendance'
          element={
            <Outlet context={{ saved: state.saved, gone: state.gone }} />
          }
        >
          <Route path=':kind/new' element={<Editor />} />
          <Route path=':kind/:recordId/edit' element={<Editor />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  state.api.request.mockReset();
  state.saved.mockReset();
  state.gone.mockReset();
  state.toast.mockReset();
  state.can = true;
  state.locale = 'en-US';
});
describe('attendance settings UI', () => {
  it('clearing all shift departments sends all-department availability rather than the previous selection', async () => {
    state.api.request.mockImplementation(
      (o: { path: string; method?: string; json?: { value: object } }) =>
        Promise.resolve({
          data: o.method
            ? { ...shift, ...o.json!.value }
            : o.path.endsWith('/night')
              ? { ...shift, departmentIds: ['workshop'] }
              : catalog,
        }),
    );
    mountEditor('/attendance/shifts/night/edit');
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Workshop' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.saved).toHaveBeenCalled());
    expect(state.api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        json: expect.objectContaining({
          value: expect.objectContaining({ departmentIds: null }),
        }),
      }),
    );
  });
  it('focuses the offending annual band instead of an unregistered array root', async () => {
    state.api.request.mockResolvedValue({
      data: {
        revision: 0,
        value: {
          bands: [
            { minimumYears: 1, days: 5 },
            { minimumYears: 10, days: 10 },
          ],
        },
      },
    });
    render(<ConfigCard section='annualLeave' />);
    const fields = await screen.findAllByLabelText(/Minimum career years/u);
    fireEvent.change(fields[1], { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(fields[1]).toHaveFocus());
    expect(state.api.request).toHaveBeenCalledTimes(1);
  });
  it('refreshes the parent when an edit URL resolves to a missing record', async () => {
    state.api.request.mockImplementation((o: { path: string }) =>
      o.path.endsWith('/night')
        ? Promise.reject(
            new ApiClientError('missing', {
              status: 404,
              method: 'GET',
              url: '/test',
            }),
          )
        : Promise.resolve({ data: catalog }),
    );
    mountEditor('/attendance/shifts/night/edit');
    await screen.findByText(en.attendance.leave.errors.notFound);
    expect(state.gone).toHaveBeenCalledWith('shifts', 'night');
    expect(
      screen.queryByRole('button', { name: 'Retry' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
  it('validates cross-midnight shifts and preserves IME input after a failed save', async () => {
    state.api.request.mockImplementation((options: { method?: string }) =>
      options.method
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ data: catalog }),
    );
    mountEditor('/attendance/shifts/new');
    const title = await screen.findByLabelText(/Title/u);
    await userEvent.type(title, 'Night');
    fireEvent.compositionStart(title);
    fireEvent.change(title, { target: { value: '夜班 Night' } });
    fireEvent.compositionEnd(title);
    fireEvent.change(screen.getByLabelText(/Code/u), {
      target: { value: 'night' },
    });
    fireEvent.change(screen.getByLabelText(/Start time/u), {
      target: { value: '22:00' },
    });
    fireEvent.change(screen.getByLabelText(/End time/u), {
      target: { value: '06:00' },
    });
    fireEvent.change(screen.getByLabelText(/Break/u), {
      target: { value: '480' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Break time must be shorter than the shift.'),
    ).toBeInTheDocument();
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      0,
    );
    fireEvent.change(screen.getByLabelText(/Break/u), {
      target: { value: '30' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Request failed. Please try again.');
    expect(title).toHaveValue('夜班 Night');
    expect(state.api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        json: {
          value: expect.objectContaining({
            startTime: '22:00',
            endTime: '06:00',
            departmentIds: null,
          }),
        },
      }),
    );
  });
  it('loads a fresh version, confirms disabling and prevents closing during the save', async () => {
    let finish: ((v: unknown) => void) | undefined;
    state.api.request.mockImplementation(
      (o: { path: string; method?: string }) =>
        o.method
          ? new Promise((resolve) => {
              finish = resolve;
            })
          : Promise.resolve({
              data: o.path.endsWith('/night') ? shift : catalog,
            }),
    );
    mountEditor('/attendance/shifts/night/edit');
    await screen.findByDisplayValue('Night');
    fireEvent.change(screen.getByLabelText(/Active/u), {
      target: { value: 'false' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Disable "Night"?');
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      0,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Save/u })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByDisplayValue('Night')).toBeInTheDocument();
    expect(state.api.request).toHaveBeenLastCalledWith(
      expect.objectContaining({
        json: {
          expectedUpdatedAt: shift.updatedAt,
          value: expect.objectContaining({
            active: false,
            departmentIds: null,
          }),
        },
      }),
    );
    await act(async () => {
      finish?.({ data: { ...shift, active: false } });
    });
    await waitFor(() =>
      expect(state.saved).toHaveBeenCalledWith(
        'shifts',
        expect.objectContaining({ active: false }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByDisplayValue('Night')).not.toBeInTheDocument(),
    );
  });
  it('saves cards independently and advances only the saved revision', async () => {
    state.api.request.mockImplementation(
      (o: {
        path: string;
        method?: string;
        json?: { value: unknown; revision: number };
      }) =>
        Promise.resolve({
          data: o.method
            ? { value: o.json!.value, revision: o.json!.revision + 1 }
            : o.path.endsWith('/limits')
              ? { value: limits, revision: 4 }
              : {
                  value: { bands: [{ minimumYears: 1, days: 5 }] },
                  revision: 2,
                },
        }),
    );
    render(
      <>
        <ConfigCard section='limits' />
        <ConfigCard section='annualLeave' />
      </>,
    );
    const limit = await screen.findByLabelText(/Monthly missing-punch limit/u);
    fireEvent.change(await screen.findByLabelText(/Annual leave days/u), {
      target: { value: '10' },
    });
    fireEvent.change(limit, { target: { value: '4' } });
    const card = limit.closest('form')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText(/Annual leave days/u)).toHaveValue(10);
    fireEvent.change(limit, { target: { value: '5' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.toast).toHaveBeenCalledTimes(2));
    const writes = state.api.request.mock.calls
      .map(([o]) => o)
      .filter((o) => o.method);
    expect(writes.map((o) => [o.path, o.json.revision])).toEqual([
      ['talent/attendance-settings/config/limits', 4],
      ['talent/attendance-settings/config/limits', 5],
    ]);
  });
  it('rejects invalid or overlapping calendar dates before writing', async () => {
    state.api.request.mockResolvedValue({
      data: {
        revision: 0,
        value: { years: [{ year: 2026, holidays: [], adjustedWorkdays: [] }] },
      },
    });
    render(<ConfigCard section='calendar' />);
    const dates = await screen.findByLabelText('Statutory holidays');
    fireEvent.change(dates, { target: { value: '2026-02-29' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(dates).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(dates, { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Adjusted workdays'), {
      target: { value: '2026-10-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Adjusted workdays')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(state.api.request).toHaveBeenCalledTimes(1);
  });
  it('shows translated 403 without retry or raw exception text', async () => {
    state.locale = 'zh-CN';
    state.api.request.mockRejectedValue(
      new ApiClientError('SECRET', {
        status: 403,
        method: 'GET',
        url: '/test',
      }),
    );
    render(<ConfigCard section='limits' />);
    expect(
      await screen.findByText(zh.attendance.leave.errors.forbidden),
    ).toBeInTheDocument();
    expect(screen.queryByText('SECRET')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('hides forms and makes no requests without the management action', () => {
    state.can = false;
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    );
    expect(
      screen.queryByRole('button', { name: 'New shift' }),
    ).not.toBeInTheDocument();
    expect(state.api.request).not.toHaveBeenCalled();
  });
});
