import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// The browser runs in New York; the application's business zone is Shanghai.
// Every time on these screens must read and be typed in Shanghai time.
process.env.TZ = 'America/New_York';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: true, isPending: false }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
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

import MissingPunchPage from '../../client/pages/talent/me/attendance/missing-punch';
import OvertimePage from '../../client/pages/talent/me/attendance/overtime';
import { MyAttendanceSection } from '../../client/pages/talent/me/attendance/section';

const summary = {
  id: 's1',
  employeeId: 'e1',
  month: '2026-09',
  scheduledDays: 22,
  workedDays: 20,
  lateCount: 1,
  earlyCount: 0,
  missingCount: 2,
  absentDays: 0,
  leaveByType: { annual: 2 },
  overtimeByType: { workday: 30 },
  nightShiftCount: 6,
  shiftCounts: { 'mc-early': 10 },
  status: 'draft',
  objection: null,
  confirmedAt: null,
  lockedBy: null,
  lockedAt: null,
  lockLog: [],
  confirmBy: 'employee',
  updatedAt: '2026-10-01T00:00:00.000Z',
};
const mine = {
  employee: {
    id: 'e1',
    employeeNo: 'E003',
    name: 'Qian Jin',
    departmentId: 'd1',
  },
  schedules: [
    {
      date: '2026-09-07',
      shiftId: 'early',
      code: 'mc-early',
      title: 'Early',
      startTime: '06:00',
      endTime: '14:00',
      isNight: false,
    },
    {
      date: '2026-09-08',
      shiftId: null,
      code: null,
      title: null,
      startTime: null,
      endTime: null,
      isNight: false,
    },
  ],
  records: [
    {
      id: 'r1',
      employeeId: 'e1',
      date: '2026-09-07',
      shiftId: 'early',
      punches: [],
      // 06:12 on 2026-09-07 in Shanghai; 18:12 the day before in New York.
      checkIn: '2026-09-06T22:12:00.000Z',
      checkOut: null,
      status: 'missingPunch',
      lateMinutes: null,
      earlyMinutes: null,
      workedMinutes: null,
      overtimeMinutes: null,
      leaveRequestId: null,
    },
  ],
  summary,
  missingPunchUsed: 1,
  missingPunchLimit: 3,
  confirmationDays: 3,
};

function Where() {
  const location = useLocation();
  return <output data-testid='where'>{location.pathname}</output>;
}

function mount(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path='/talent/me/*'
          element={
            <>
              <MyAttendanceSection employeeId='e1' leaveRevision={0} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe('my attendance', () => {
  let objections: unknown[];
  let objected: boolean;
  beforeEach(() => {
    // jsdom has no layout; the section scrolls itself into view for #attendance.
    Element.prototype.scrollIntoView = vi.fn();
    objections = [];
    objected = false;
    state.toast.mockReset();
    state.api.request.mockReset();
    state.api.request.mockImplementation(
      async (options: { path: string; json?: unknown }) => {
        if (options.path === 'talent/app-time')
          return { data: { timeZone: 'Asia/Shanghai', today: '2026-09-29' } };
        if (options.path === 'talent/attendance/me')
          return {
            data: {
              ...structuredClone(mine),
              summary: objected
                ? {
                    ...summary,
                    objection: {
                      note: 'Two days are wrong',
                      at: '2026-10-01T02:00:00.000Z',
                      handledBy: null,
                      result: null,
                    },
                  }
                : summary,
            },
          };
        if (options.path === 'talent/adjustments') return { data: [] };
        if (options.path === 'talent/leave/requests') return { data: [] };
        if (options.path === 'talent/leave/requests/my-balances')
          return { data: { year: 2026, frozen: false, items: [] } };
        if (options.path === 'talent/attendance/summaries/s1/objection') {
          objections.push(options.json);
          objected = true;
          return { data: {} };
        }
        throw new Error(`unexpected ${options.path}`);
      },
    );
  });

  it('shows the month and sends an objection note, then shows it as open', async () => {
    mount('/talent/me?month=2026-09#attendance');
    expect(
      await screen.findByText('Monthly summary · 2026-09'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Missing-punch requests this month: 1 / 3'),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('2026-09-07: Early 06:00–14:00'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('2026-09-08: rest')).toBeInTheDocument();
    // The punch reads in the application zone, not the browser's.
    expect(screen.getByText(/In 06:12 · out —/u)).toBeInTheDocument();
    // The 补卡 button and the day's status badge.
    expect(screen.getAllByText('Missing punch')).toHaveLength(2);

    await userEvent.click(
      screen.getByRole('button', { name: 'Raise an objection' }),
    );
    const dialog = await screen.findByRole('dialog');
    const submit = within(dialog).getByRole('button', {
      name: 'Raise an objection',
    });
    // The note is required.
    expect(submit).toBeDisabled();
    await userEvent.type(
      within(dialog).getByLabelText(/What is wrong/u),
      'Two days are wrong',
    );
    await userEvent.click(submit);

    await waitFor(() =>
      expect(objections).toEqual([{ note: 'Two days are wrong' }]),
    );
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Objection sent to HR.' }),
    );
    expect(
      await screen.findByText('Objection waiting for HR'),
    ).toBeInTheDocument();
    // An open objection leaves nothing to confirm until HR answers.
    expect(
      screen.queryByRole('button', { name: 'Confirm' }),
    ).not.toBeInTheDocument();
  });

  it('opens the request dialog named by ?action= and drops the parameter', async () => {
    mount('/talent/me?action=missingPunch&month=2026-09#attendance');
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(
        '/talent/me/attendance/missing-punch',
      ),
    );
  });

  it('sends a typed missed-punch time as that wall clock in the application zone', async () => {
    const posts: unknown[] = [];
    state.api.request.mockImplementation(
      async (options: { path: string; method?: string; json?: unknown }) => {
        if (options.path === 'talent/app-time')
          return { data: { timeZone: 'Asia/Shanghai', today: '2026-09-29' } };
        if (options.path === 'talent/attendance/me')
          return { data: structuredClone(mine) };
        if (options.path === 'talent/custom-fields/definitions')
          return { data: [] };
        if (
          options.path === 'talent/adjustments' &&
          options.method === 'POST'
        ) {
          posts.push(options.json);
          return { data: {} };
        }
        return { data: [] };
      },
    );
    // The browser really is in New York.
    expect(new Date('2026-09-07T00:24:00Z').getHours()).toBe(20);
    render(
      <MemoryRouter
        initialEntries={['/talent/me/attendance/missing-punch?month=2026-09']}
      >
        <Routes>
          <Route path='/talent/me' element={<Outlet />}>
            <Route
              path='attendance/missing-punch'
              element={<MissingPunchPage />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole('dialog');
    const date = within(dialog).getByLabelText(/^Date/u);
    fireEvent.change(date, { target: { value: '2026-09-07' } });
    fireEvent.change(within(dialog).getByLabelText(/Actual punch time/u), {
      target: { value: '14:03' },
    });
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/u),
      'Badge reader down',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Submit' }),
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: 'missingPunch',
      date: '2026-09-07',
      details: { at: '2026-09-07T06:03:00.000Z' },
    });
  });

  it('sends typed overtime times as wall clocks in the application zone', async () => {
    const posts: unknown[] = [];
    state.api.request.mockImplementation(
      async (options: { path: string; method?: string; json?: unknown }) => {
        if (options.path === 'talent/app-time')
          return { data: { timeZone: 'Asia/Shanghai', today: '2026-09-29' } };
        if (
          options.path === 'talent/adjustments' &&
          options.method === 'POST'
        ) {
          posts.push(options.json);
          return { data: {} };
        }
        if (options.path === 'talent/attendance/me')
          return { data: structuredClone(mine) };
        return { data: [] };
      },
    );
    render(
      <MemoryRouter initialEntries={['/talent/me/attendance/overtime']}>
        <Routes>
          <Route path='/talent/me' element={<Outlet />}>
            <Route path='attendance/overtime' element={<OvertimePage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const dialog = await screen.findByRole('dialog');
    const inputs = dialog.querySelectorAll('input');
    const [date, start, end] = [...inputs].filter((i) =>
      ['date', 'time'].includes(i.type),
    );
    fireEvent.change(date, { target: { value: '2026-09-07' } });
    fireEvent.change(start, { target: { value: '18:00' } });
    fireEvent.change(end, { target: { value: '20:30' } });
    await userEvent.type(
      within(dialog).getByLabelText(/Reason/u),
      'Line changeover',
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Submit' }),
    );
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      details: {
        startAt: '2026-09-07T10:00:00.000Z',
        endAt: '2026-09-07T12:30:00.000Z',
      },
    });
  });
});
