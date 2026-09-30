import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// V2-05 (realigned): the HR assistant's drafts in 我的申请, 已说明 on my days, and 发出顶班邀请 in the cover dialog.
const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
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

import type {
  Adjustment,
  AttendanceRecord,
  ScheduleBoard,
  ScheduleCell,
} from '../../client/components/talent/attendance/types';
import { MyRecords } from '../../client/pages/talent/me/attendance/records';
import { MyAdjustments } from '../../client/pages/talent/me/attendance/requests';
import { CoverDialog } from '../../client/pages/talent/schedules/cover-dialog';

const draft: Adjustment = {
  id: 'a1',
  type: 'missingPunch',
  employeeId: 'e1',
  date: '2026-09-27',
  details: { at: '2026-09-27T06:00:00.000Z' },
  reason: 'Forgot to punch',
  status: 'draft',
  source: 'hrAssistant',
  approvals: [],
  createdAt: '2026-09-29T01:00:00.000Z',
  updatedAt: '2026-09-29T01:00:00.000Z',
};

describe('attendance in Feishu, in the app', () => {
  beforeEach(() => {
    state.toast.mockReset();
    state.api.request.mockReset();
  });

  it('lets me submit a draft the HR assistant prepared', async () => {
    state.api.request.mockResolvedValue({ data: {} });
    const changed = vi.fn();
    render(
      <MemoryRouter>
        <MyAdjustments rows={[draft]} onChanged={changed} />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(en.attendanceV2.drafts.hint, { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await waitFor(() =>
      expect(state.api.request).toHaveBeenCalledWith({
        method: 'POST',
        path: 'talent/adjustments/a1/submit',
      }),
    );
    expect(changed).toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Missing punch submitted for approval.',
      }),
    );
  });

  it('marks an explained late day', () => {
    const record: AttendanceRecord = {
      id: 'r1',
      employeeId: 'e1',
      date: '2026-09-27',
      shiftId: 'early',
      punches: [],
      checkIn: '2026-09-26T22:12:00.000Z',
      checkOut: '2026-09-27T06:04:00.000Z',
      status: 'late',
      lateMinutes: 12,
      earlyMinutes: null,
      workedMinutes: 440,
      overtimeMinutes: null,
      leaveRequestId: null,
      excusedByAdjustmentId: 'a2',
    };
    render(<MyRecords records={[record]} />);
    expect(screen.getByText('Explained')).toBeInTheDocument();
  });

  it('sends cover invitations only on the click and shows who was reached', async () => {
    const cell: ScheduleCell = {
      id: 's1',
      employeeId: 'e3',
      date: '2026-10-04',
      shiftId: 'early',
      status: 'published',
      checkResult: [
        { rule: 'leaveConflict', level: 'block', message: 'LEAVE_CONFLICT' },
      ],
      replacementSuggestion: {
        candidates: [
          { employeeId: 'e2', name: 'Li Min', reasons: ['Free that day'] },
        ],
      },
      publishedAt: null,
      updatedAt: null,
    };
    const board = {
      departmentId: 'd1',
      from: '2026-09-29',
      to: '2026-10-12',
      dates: [],
      employees: [
        { id: 'e2', name: 'Li Min' },
        { id: 'e3', name: 'Qian Jin' },
      ],
      shifts: [{ id: 'early', title: 'Early' }],
      cells: [cell],
      meta: {},
    } as unknown as ScheduleBoard;
    state.api.request.mockImplementation(
      async (options: { path: string; json?: unknown }) => {
        if (options.path === 'talent/schedules/s1/candidates')
          return { data: { candidates: [] } };
        if (options.path === 'talent/schedules/s1/invitations')
          return {
            data: {
              results: { e2: 'sent' },
              invitations: [
                {
                  employeeId: 'e2',
                  sentAt: '2026-09-29T01:00:00.000Z',
                  response: null,
                  respondedAt: null,
                },
              ],
            },
          };
        throw new Error(`unexpected ${options.path}`);
      },
    );
    const invited = vi.fn();
    render(
      <CoverDialog
        cell={cell}
        board={board}
        onClose={() => undefined}
        onPick={() => undefined}
        onInvited={invited}
      />,
    );
    const dialog = await screen.findByRole('dialog');
    // Nothing is sent before the click.
    expect(
      state.api.request.mock.calls.some(
        ([options]) =>
          (options as { path: string }).path ===
          'talent/schedules/s1/invitations',
      ),
    ).toBe(false);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send cover invitations' }),
    );
    await waitFor(() =>
      expect(state.api.request).toHaveBeenCalledWith({
        method: 'POST',
        path: 'talent/schedules/s1/invitations',
        json: { candidateIds: ['e2'] },
      }),
    );
    expect(await within(dialog).findByText('Sent')).toBeInTheDocument();
    expect(within(dialog).getByText('Waiting')).toBeInTheDocument();
    expect(invited).toHaveBeenCalled();
  });
});
