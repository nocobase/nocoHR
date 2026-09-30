import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ApiClientError } from '@nocobase/app-client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// The browser runs in New York; the application's business zone is Shanghai.
process.env.TZ = 'America/New_York';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
  reload: vi.fn(),
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

import AdjustmentApprovalPage from '../../client/pages/talent/approvals/adjustment-detail';

const request = {
  id: 'a1',
  type: 'overtime',
  employeeId: 'e3',
  date: '2026-10-01',
  details: {
    startAt: '2026-10-01T01:00:00.000Z',
    endAt: '2026-10-01T03:30:00.000Z',
    hours: 2.5,
    overtimeType: 'holiday',
  },
  reason: 'Line changeover',
  status: 'pending',
  approvals: [
    {
      level: 1,
      kind: 'departmentHead',
      approverUserId: 'mgr',
      status: 'pending',
      decidedBy: null,
      decidedAt: null,
      comment: null,
    },
  ],
  createdAt: '2026-10-01T04:00:00.000Z',
  updatedAt: '2026-10-01T04:00:00.000Z',
  canDecide: true,
  canCancel: false,
};

function mount() {
  return render(
    <MemoryRouter
      initialEntries={['/talent/approvals/adjustments/a1?tab=overtime']}
    >
      <Routes>
        <Route
          path='/talent/approvals'
          element={<Outlet context={{ reload: state.reload }} />}
        >
          <Route
            path='adjustments/:adjustmentId'
            element={<AdjustmentApprovalPage />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('adjustment approval detail', () => {
  let decisions: unknown[];
  beforeEach(() => {
    decisions = [];
    state.toast.mockReset();
    state.reload.mockReset();
    state.api.request.mockReset();
  });

  function respond(decide: () => unknown, row: object = request) {
    state.api.request.mockImplementation(
      async (options: { path: string; json?: unknown }) => {
        if (options.path === 'talent/app-time')
          return { data: { timeZone: 'Asia/Shanghai', today: '2026-10-01' } };
        if (options.path === 'talent/adjustments/a1')
          return { data: structuredClone(row) };
        if (options.path === 'talent/adjustments')
          return {
            data: [
              {
                ...row,
                employeeName: 'Qian Jin',
                employeeNo: 'E003',
                departmentId: 'd1',
              },
            ],
          };
        if (options.path === 'talent/adjustments/a1/decide') {
          decisions.push(options.json);
          return decide();
        }
        throw new Error(`unexpected ${options.path}`);
      },
    );
  }

  it('shows the overtime facts and sends the decision with the version read', async () => {
    respond(() => ({ data: { ...request, status: 'approved' } }));
    mount();
    expect(await screen.findByText('Qian Jin (E003)')).toBeInTheDocument();
    expect(screen.getByText('2.5 h')).toBeInTheDocument();
    // 01:00Z–03:30Z read in the application zone, not New York's.
    expect(
      screen.getByText(/Oct 1, 2026, 9:00\sAM – Oct 1, 2026, 11:30\sAM/u),
    ).toBeInTheDocument();
    expect(screen.getByText('Public holiday')).toBeInTheDocument();
    expect(screen.getByText('Step 1 · Department head')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(
      'Approve the Overtime request of Qian Jin?',
    );
    await userEvent.type(within(dialog).getByLabelText('Comment'), 'Agreed');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve' }),
    );

    await waitFor(() => expect(decisions).toHaveLength(1));
    expect(decisions[0]).toEqual({
      decision: 'approved',
      comment: 'Agreed',
      expectedUpdatedAt: '2026-10-01T04:00:00.000Z',
    });
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Decision recorded.' }),
    );
  });

  it('offers a reload instead of repeating a decision on a stale version', async () => {
    respond(() => {
      throw new ApiClientError('private details', {
        status: 409,
        code: 'CONFLICT',
        payload: { code: 'CONFLICT' },
        method: 'POST',
        url: '/api/talent/adjustments/a1/decide',
      });
    });
    mount();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reject' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject' }),
    );
    expect(
      await within(dialog).findByText(
        'The request changed meanwhile. Reload and try again.',
      ),
    ).toBeInTheDocument();
    expect(decisions).toEqual([
      {
        decision: 'rejected',
        expectedUpdatedAt: '2026-10-01T04:00:00.000Z',
      },
    ]);
    expect(
      within(dialog).queryByRole('button', { name: 'Reject' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reload' }),
    );
    expect(state.reload).toHaveBeenCalled();
  });

  it('shows a missed punch at its time in the application zone', async () => {
    respond(() => ({ data: {} }), {
      ...request,
      type: 'missingPunch',
      date: '2026-10-01',
      details: { at: '2026-10-01T00:24:00.000Z' },
    });
    mount();
    expect(await screen.findByText('Qian Jin (E003)')).toBeInTheDocument();
    // New York would read 8:24 PM the evening before.
    expect(new Date('2026-10-01T00:24:00Z').getHours()).toBe(20);
    expect(screen.getByText(/Oct 1, 2026, 8:24\sAM/u)).toBeInTheDocument();
  });
});
