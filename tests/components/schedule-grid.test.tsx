import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ApiClientError } from '@nocobase/app-client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// The browser runs in New York; the application's business zone is Shanghai.
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

import SchedulesPage from '../../client/pages/talent/schedules/index';

const board = {
  departmentId: 'd1',
  from: '2026-10-05',
  to: '2026-10-06',
  dates: ['2026-10-05', '2026-10-06'],
  employees: [
    {
      id: 'e1',
      employeeNo: 'E001',
      name: 'Wang Lei',
      status: 'active',
      departmentId: 'd1',
      hireDate: null,
      leaveDate: null,
    },
  ],
  shifts: [
    {
      id: 'night',
      code: 'mc-night',
      title: 'Night',
      startTime: '22:00',
      endTime: '06:00',
      breakMinutes: 30,
      isNight: true,
      departmentIds: null,
      active: true,
    },
  ],
  cells: [
    {
      id: 'c2',
      employeeId: 'e1',
      date: '2026-10-06',
      shiftId: null,
      status: 'published',
      checkResult: null,
      replacementSuggestion: null,
      publishedAt: '2026-09-30T00:00:00.000Z',
      updatedAt: '2026-09-30T00:00:00.000Z',
    },
  ],
  meta: {},
};

function conflict(code: string, checks: Record<string, unknown[]>) {
  return new ApiClientError('private details', {
    status: 409,
    code,
    payload: { code, details: { checks } },
    method: 'POST',
    url: '/api/talent/schedules/save',
  });
}

function mount() {
  return render(
    <MemoryRouter
      initialEntries={[
        '/talent/schedules?department=d1&from=2026-10-05&to=2026-10-06',
      ]}
    >
      <Routes>
        <Route path='/talent/schedules' element={<SchedulesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('schedule grid', () => {
  let saves: { cells: unknown[]; acknowledgeWarnings: boolean }[];
  beforeEach(() => {
    saves = [];
    state.toast.mockReset();
    state.api.request.mockReset();
  });

  it('asks to confirm warnings and saves again with acknowledgeWarnings', async () => {
    state.api.request.mockImplementation(
      async (options: { path: string; json?: never }) => {
        if (options.path === 'talent/lookups')
          return { data: { departments: [], positions: [] } };
        if (options.path === 'talent/schedules')
          return { data: structuredClone(board) };
        if (options.path === 'talent/schedules/save') {
          saves.push(options.json!);
          if (saves.length === 1)
            throw conflict('SCHEDULE_WARNING_CONFIRMATION', {
              'e1:2026-10-05': [
                {
                  rule: 'consecutiveNights',
                  level: 'warn',
                  message: 'CONSECUTIVE_NIGHTS',
                },
              ],
            });
          return { data: { saved: 1, checks: {} } };
        }
        throw new Error(`unexpected ${options.path}`);
      },
    );
    mount();
    const cell = await screen.findByRole('combobox', {
      name: 'Wang Lei, 2026-10-05',
    });
    await userEvent.selectOptions(cell, 'night');
    await userEvent.click(screen.getByRole('button', { name: 'Save (1)' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Save with warnings?');
    expect(dialog).toHaveTextContent(
      'Consecutive nights: more consecutive night shifts than the rule allows',
    );
    expect(saves[0]).toEqual({
      acknowledgeWarnings: false,
      cells: [
        {
          employeeId: 'e1',
          date: '2026-10-05',
          shiftId: 'night',
          expectedUpdatedAt: null,
        },
      ],
    });

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Save anyway' }),
    );
    await waitFor(() => expect(saves).toHaveLength(2));
    expect(saves[1]).toEqual({ ...saves[0], acknowledgeWarnings: true });
    await waitFor(() =>
      expect(state.toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: '1 cells saved.' }),
      ),
    );
  });

  it('marks a blocked cell and keeps the edit when the save is refused', async () => {
    state.api.request.mockImplementation(
      async (options: { path: string; json?: never }) => {
        if (options.path === 'talent/lookups')
          return { data: { departments: [], positions: [] } };
        if (options.path === 'talent/schedules')
          return { data: structuredClone(board) };
        if (options.path === 'talent/schedules/save') {
          saves.push(options.json!);
          throw conflict('SCHEDULE_BLOCKED', {
            'e1:2026-10-06': [
              {
                rule: 'leaveConflict',
                level: 'block',
                message: 'LEAVE_CONFLICT',
              },
            ],
          });
        }
        throw new Error(`unexpected ${options.path}`);
      },
    );
    mount();
    const cell = await screen.findByRole('combobox', {
      name: 'Wang Lei, 2026-10-06',
    });
    await userEvent.selectOptions(cell, 'night');
    await userEvent.click(screen.getByRole('button', { name: 'Save (1)' }));

    expect(
      await screen.findByText(
        'Some cells break a blocking rule and nothing was saved. They are marked in red.',
      ),
    ).toBeInTheDocument();
    // The stored row's version travels with the edit.
    expect(saves[0].cells).toEqual([
      {
        employeeId: 'e1',
        date: '2026-10-06',
        shiftId: 'night',
        expectedUpdatedAt: '2026-09-30T00:00:00.000Z',
      },
    ]);
    expect(cell.closest('td')).toHaveAttribute('data-level', 'block');
    expect(cell).toHaveValue('night');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    // Listed under the grid, and read out on the cell.
    expect(
      screen.getAllByText(/Leave: the employee has pending or approved leave/u),
    ).toHaveLength(2);
  });

  it('opens on today in the application zone, not the browser zone', async () => {
    // 01:00 on 2026-10-05 in Shanghai is still 2026-10-04 in New York.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-04T17:00:00Z'));
    try {
      const queries: Record<string, unknown>[] = [];
      state.api.request.mockImplementation(
        async (options: { path: string; query?: Record<string, unknown> }) => {
          if (options.path === 'talent/app-time')
            return { data: { timeZone: 'Asia/Shanghai', today: '2026-10-05' } };
          if (options.path === 'talent/lookups')
            return { data: { departments: [], positions: [] } };
          if (options.path === 'talent/schedules') {
            queries.push(options.query ?? {});
            return { data: structuredClone(board) };
          }
          throw new Error(`unexpected ${options.path}`);
        },
      );
      expect(new Date().getDate()).toBe(4);
      render(
        <MemoryRouter initialEntries={['/talent/schedules?department=d1']}>
          <Routes>
            <Route path='/talent/schedules' element={<SchedulesPage />} />
          </Routes>
        </MemoryRouter>,
      );
      await waitFor(() => expect(queries.length).toBeGreaterThan(0));
      expect(queries[0]).toMatchObject({
        from: '2026-10-05',
        to: '2026-10-11',
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
