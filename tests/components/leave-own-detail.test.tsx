import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ApiClientError } from '@nocobase/app-client';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  can: true,
  pending: false,
  reload: vi.fn(),
  toast: vi.fn(),
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({ can: state.can, isPending: state.pending }),
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
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));
import OwnLeaveDetailPage from '../../client/pages/talent/me/leave-detail';

const request = {
  id: 'request-1',
  employeeName: 'Li Min',
  employeeId: 'private-employee-id',
  leaveTypeId: 'private-type-id',
  leaveTypeTitle: 'Annual leave',
  leaveUnit: 'day',
  startAt: '2029-04-02T01:00:00Z',
  endAt: '2029-04-05T09:00:00Z',
  duration: 4,
  reason: 'Family visit',
  status: 'pending',
  canApprove: false,
  canCancel: true,
  isOwnRequest: true,
  canEdit: false,
  attachmentFileId: null,
  updatedAt: '2026-09-29T12:00:00.000',
  approvals: [
    {
      kind: 'departmentHead',
      approverUserId: 'manager',
      departmentId: 'department',
      status: 'pending',
      comment: null,
      decidedAt: null,
    },
    {
      kind: 'hrAdmin',
      approverUserId: null,
      departmentId: null,
      status: 'waiting',
      comment: null,
      decidedAt: null,
    },
  ],
};

function mount() {
  return render(
    <MemoryRouter initialEntries={['/talent/me/leave/request-1']}>
      <Routes>
        <Route
          path='/talent/me'
          element={<Outlet context={{ reloadLeaveRequests: state.reload }} />}
        >
          <Route path='leave/:requestId' element={<OwnLeaveDetailPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
const writes = () =>
  state.api.request.mock.calls.filter(([options]) => options.method);
async function openConfirmation() {
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Cancel leave request',
      exact: true,
    }),
  );
  return screen.findByRole('alertdialog');
}
async function confirm(dialog: HTMLElement) {
  await userEvent.click(
    within(dialog).getByRole('button', {
      name: 'Cancel leave request',
      exact: true,
    }),
  );
}
describe('own leave detail and cancellation', () => {
  beforeEach(() => {
    state.can = true;
    state.pending = false;
    state.locale = 'en-US';
    state.reload.mockReset();
    state.toast.mockReset();
    state.api.request.mockReset();
    state.api.request.mockResolvedValue({ data: structuredClone(request) });
  });
  it('shows loading then a safe retry after a transient detail read failure', async () => {
    let fail: ((reason: unknown) => void) | undefined;
    state.api.request.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    mount();
    expect(screen.queryByText('Li Min')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Cancel leave request',
        exact: true,
      }),
    ).not.toBeInTheDocument();
    await act(async () => {
      fail?.(new TypeError('Network unavailable'));
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Li Min')).toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });
  it.each([403, 404])(
    'blocks writes and hides stale details when access disappears (%s)',
    async (status) => {
      state.api.request.mockResolvedValueOnce({
        data: structuredClone(request),
      });
      state.api.request.mockRejectedValue(
        new ApiClientError('private details', { status }),
      );
      mount();
      const dialog = await openConfirmation();
      await confirm(dialog);
      await within(dialog).findByText(
        en.attendance.leave.ownDetail.reloadRequired,
      );
      expect(
        within(dialog).queryByRole('button', {
          name: 'Cancel leave request',
          exact: true,
        }),
      ).not.toBeInTheDocument();
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Reload latest request' }),
      );
      await waitFor(() =>
        expect(screen.queryByText('Family visit')).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: 'Cancel leave request',
          exact: true,
        }),
      ).not.toBeInTheDocument();
      expect(writes()).toHaveLength(1);
      expect(state.toast).not.toHaveBeenCalled();
    },
  );
  it('shows own facts and history, with specific pending consequences and no write on dismiss', async () => {
    mount();
    expect(await screen.findByText('Li Min')).toBeInTheDocument();
    expect(screen.getByText('Family visit')).toBeInTheDocument();
    expect(screen.getByText('Step 2 · HR')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: en.attendance.leave.ownDetail.back }),
    ).toHaveAttribute('href', '/talent/me#attendance');
    const dialog = await openConfirmation();
    expect(dialog).toHaveTextContent('Cancel this Annual leave request?');
    expect(dialog).toHaveTextContent(
      'Approval stops and any reserved balance is released.',
    );
    expect(dialog).toHaveTextContent('2029');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Keep request' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(0);
  });
  it('explains approved leave restoration and locking before cancellation', async () => {
    state.api.request.mockResolvedValue({
      data: { ...request, status: 'approved' },
    });
    mount();
    const dialog = await openConfirmation();
    expect(dialog).toHaveTextContent('Recorded usage is reversed');
    expect(dialog).toHaveTextContent(
      'Locked months or changed attendance prevent cancellation',
    );
    expect(writes()).toHaveLength(0);
  });
  it('posts only the latest version once, blocks duplicate clicks and closing, and refreshes the parent on success', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation((options) =>
      options.method
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ data: structuredClone(request) }),
    );
    mount();
    const dialog = await openConfirmation();
    await userEvent.dblClick(
      within(dialog).getByRole('button', {
        name: 'Cancel leave request',
        exact: true,
      }),
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.[0]).toMatchObject({
      method: 'POST',
      path: 'talent/leave/requests/request-1/cancel',
      json: { expectedUpdatedAt: request.updatedAt },
    });
    expect(Object.keys(writes()[0]?.[0].json)).toEqual(['expectedUpdatedAt']);
    expect(
      within(dialog).getByRole('button', { name: 'Keep request' }),
    ).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await act(async () => {
      finish?.({ data: { ...request, status: 'cancelled' } });
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getAllByText('Not processed')).toHaveLength(2);
    expect(
      screen.queryByRole('button', {
        name: 'Cancel leave request',
        exact: true,
      }),
    ).not.toBeInTheDocument();
    expect(state.reload).toHaveBeenCalledOnce();
    expect(state.toast).toHaveBeenCalledWith({
      type: 'success',
      title: en.attendance.leave.ownDetail.cancelled,
    });
  });
  it.each(['CONFLICT', 'MONTH_LOCKED', 'ATTENDANCE_RECALCULATION_REQUIRED'])(
    'retains request and blocks retry after %s until latest GET and explicit confirmation',
    async (code) => {
      let reads = 0;
      state.api.request.mockImplementation(async (options) => {
        if (options.method)
          throw new ApiClientError('private SQL details', {
            status: 409,
            code,
          });
        reads++;
        return {
          data: {
            ...request,
            updatedAt:
              reads === 1 ? request.updatedAt : '2026-09-29T12:00:02.000',
          },
        };
      });
      mount();
      const dialog = await openConfirmation();
      await confirm(dialog);
      expect(
        await within(dialog).findByText(
          en.attendance.leave.ownDetail.reloadRequired,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText('private SQL details')).not.toBeInTheDocument();
      expect(screen.getByText('Family visit')).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('button', {
          name: 'Cancel leave request',
          exact: true,
        }),
      ).not.toBeInTheDocument();
      expect(writes()).toHaveLength(1);
      expect(state.toast).not.toHaveBeenCalled();
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Reload latest request' }),
      );
      await waitFor(() =>
        expect(
          screen.getByRole('button', {
            name: 'Cancel leave request',
            exact: true,
          }),
        ).toBeEnabled(),
      );
      const again = await openConfirmation();
      await confirm(again);
      expect(writes()).toHaveLength(2);
      expect(writes().at(-1)?.[0].json.expectedUpdatedAt).toBe(
        '2026-09-29T12:00:02.000',
      );
    },
  );
  it('does not repeat an uncertain POST and accepts an already-cancelled reload', async () => {
    let reads = 0;
    state.api.request.mockImplementation(async (options) => {
      if (options.method) throw new TypeError('Lost response');
      reads++;
      return {
        data: {
          ...request,
          status: reads === 1 ? 'pending' : 'cancelled',
          canCancel: reads === 1,
        },
      };
    });
    mount();
    const dialog = await openConfirmation();
    await confirm(dialog);
    await within(dialog).findByText(
      en.attendance.leave.ownDetail.reloadRequired,
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reload latest request' }),
    );
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Cancel leave request',
        exact: true,
      }),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(1);
  });
  it('does not display another employee request even when the approver can read it', async () => {
    state.api.request.mockResolvedValue({
      data: {
        ...request,
        isOwnRequest: false,
        canCancel: false,
        canApprove: true,
        attachmentFileId: 'private-file',
      },
    });
    mount();
    expect(
      await screen.findByText(en.attendance.leave.ownDetail.unavailable),
    ).toBeInTheDocument();
    expect(screen.queryByText('Li Min')).not.toBeInTheDocument();
    expect(screen.queryByText('Family visit')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'View proof' }),
    ).not.toBeInTheDocument();
    expect(state.api.request).toHaveBeenCalledOnce();
  });
  it.each(['draft', 'rejected', 'cancelled'])(
    'shows no cancellation for %s, with draft editing only when eligible',
    async (status) => {
      state.api.request.mockResolvedValue({
        data: {
          ...request,
          status,
          canCancel: false,
          canEdit: status === 'draft',
        },
      });
      mount();
      expect(
        await screen.findByText(en.attendance.leave.ownDetail.cannotCancel),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', {
          name: 'Cancel leave request',
          exact: true,
        }),
      ).not.toBeInTheDocument();
      if (status === 'draft')
        expect(
          screen.getByRole('button', { name: 'Continue leave draft' }),
        ).toHaveAttribute('href', '/talent/me/leave/request-1/edit');
      else
        expect(
          screen.queryByRole('button', { name: 'Continue leave draft' }),
        ).not.toBeInTheDocument();
      expect(writes()).toHaveLength(0);
    },
  );
  it.each(['denied', 'pending'])(
    'hides cancellation while action permission is %s',
    async (mode) => {
      state.can = mode !== 'denied';
      state.pending = mode === 'pending';
      mount();
      await screen.findByText('Li Min');
      expect(
        screen.queryByRole('button', {
          name: 'Cancel leave request',
          exact: true,
        }),
      ).not.toBeInTheDocument();
    },
  );
  it.each([403, 404])(
    'shows localized GET failure without stale details or ineffective retries (%s)',
    async (status) => {
      state.locale = 'zh-CN';
      state.api.request.mockRejectedValue(
        new ApiClientError('secret backend details', { status }),
      );
      mount();
      expect(
        await screen.findByText(
          status === 403
            ? zh.attendance.leave.errors.forbidden
            : zh.attendance.leave.errors.notFound,
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', {
          name: zh.attendance.leave.ownDetail.back,
        }),
      ).toHaveAttribute('href', '/talent/me#attendance');
      expect(
        screen.queryByRole('button', { name: '重试' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Li Min')).not.toBeInTheDocument();
      expect(
        screen.queryByText('secret backend details'),
      ).not.toBeInTheDocument();
    },
  );
});
