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
  reload: vi.fn(),
  toast: vi.fn(),
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
import LeaveApprovalDetailPage from '../../client/pages/talent/approvals/detail';
import ApprovalsPage from '../../client/pages/talent/approvals/index';

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
  canApprove: true,
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
function mount(list = false) {
  return render(
    <MemoryRouter
      initialEntries={[
        list
          ? '/talent/approvals?status=pending'
          : '/talent/approvals/leave/request-1?status=pending',
      ]}
    >
      <Routes>
        <Route
          path='/talent/approvals'
          element={
            list ? (
              <ApprovalsPage />
            ) : (
              <Outlet context={{ reload: state.reload }} />
            )
          }
        >
          <Route
            path='leave/:requestId'
            element={<LeaveApprovalDetailPage />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
describe('leave approval detail', () => {
  beforeEach(() => {
    state.can = true;
    state.locale = 'en-US';
    state.reload.mockReset();
    state.toast.mockReset();
    state.api.request.mockReset();
    state.api.request.mockResolvedValue({ data: structuredClone(request) });
  });
  it('lists localized names and status with a deep link instead of unconfirmed decisions', async () => {
    state.api.request.mockResolvedValue({ data: [request] });
    mount(true);
    const link = await screen.findByRole('link', { name: /Li Min/u });
    expect(link).toHaveAttribute(
      'href',
      '/talent/approvals/leave/request-1?status=pending',
    );
    expect(screen.getByRole('table')).toHaveTextContent('Annual leave');
    expect(screen.getByRole('table')).toHaveTextContent('Pending approval');
    expect(screen.queryByText('private-employee-id')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve', exact: true }),
    ).not.toBeInTheDocument();
  });
  it('shows history and requires one explicit decision, blocks duplicate clicks and close while pending', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation((options) =>
      options.method
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ data: structuredClone(request) }),
    );
    mount();
    expect(await screen.findByText('Li Min')).toBeInTheDocument();
    expect(screen.getByText('Step 2 · HR')).toBeInTheDocument();
    expect(screen.getByText('Waiting for previous step')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Approval comment'), 'Reviewed');
    await userEvent.click(
      screen.getByRole('button', { name: 'Approve', exact: true }),
    );
    const confirmation = await screen.findByRole('alertdialog');
    expect(confirmation).toHaveTextContent('Approve Li Min’s leave request?');
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      0,
    );
    await userEvent.dblClick(
      within(confirmation).getByRole('button', {
        name: 'Approve',
        exact: true,
      }),
    );
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      1,
    );
    expect(
      within(confirmation).getByRole('button', { name: 'Cancel' }),
    ).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await act(async () => {
      finish?.({
        data: {
          ...request,
          canApprove: false,
          updatedAt: '2026-09-29T12:00:01.000',
          approvals: [
            {
              ...request.approvals[0],
              status: 'approved',
              comment: 'Reviewed',
              decidedAt: '2026-09-29T04:00:01Z',
            },
            { ...request.approvals[1], status: 'pending' },
          ],
        },
      });
    });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByText('Reviewed')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve', exact: true }),
    ).not.toBeInTheDocument();
    expect(state.reload).toHaveBeenCalledOnce();
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
    expect(
      state.api.request.mock.calls.find(([o]) => o.method)?.[0],
    ).toMatchObject({
      json: {
        decision: 'approved',
        comment: 'Reviewed',
        expectedUpdatedAt: request.updatedAt,
      },
    });
  });
  it('preserves the comment after a conflict and reloads the version before allowing a new decision', async () => {
    let reads = 0;
    state.api.request.mockImplementation(async (options) => {
      if (options.method)
        throw new ApiClientError('private SQL details', {
          status: 409,
          code: 'CONFLICT',
        });
      reads++;
      return {
        data: {
          ...structuredClone(request),
          updatedAt:
            reads === 1 ? request.updatedAt : '2026-09-29T12:00:02.000',
        },
      };
    });
    mount();
    await userEvent.type(
      await screen.findByLabelText('Approval comment'),
      'Needs correction',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Reject', exact: true }),
    );
    const confirmation = await screen.findByRole('alertdialog');
    expect(confirmation).toHaveTextContent(
      en.attendance.approvals.rejectDescription,
    );
    await userEvent.click(
      within(confirmation).getByRole('button', { name: 'Reject', exact: true }),
    );
    expect(
      await within(confirmation).findByText(
        en.attendance.approvals.reloadRequired,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('private SQL details')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Approval comment')).toHaveValue(
      'Needs correction',
    );
    expect(
      within(confirmation).queryByRole('button', {
        name: 'Reject',
        exact: true,
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      within(confirmation).getByRole('button', {
        name: 'Reload latest request',
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Reject', exact: true }),
      ).toBeEnabled(),
    );
    expect(screen.getByLabelText('Approval comment')).toHaveValue(
      'Needs correction',
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Reject', exact: true }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', {
        name: 'Reject',
        exact: true,
      }),
    );
    await waitFor(() =>
      expect(
        state.api.request.mock.calls.filter(([o]) => o.method),
      ).toHaveLength(2),
    );
    expect(
      state.api.request.mock.calls.filter(([o]) => o.method).at(-1)?.[0].json
        .expectedUpdatedAt,
    ).toBe('2026-09-29T12:00:02.000');
  });
  it.each(['not-current', 'no-grant'])(
    'hides decision controls when %s',
    async (mode) => {
      state.can = mode !== 'no-grant';
      state.api.request.mockResolvedValue({
        data: { ...request, canApprove: mode !== 'not-current' },
      });
      mount();
      expect(
        await screen.findByText(en.attendance.approvals.cannotDecide),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Approve', exact: true }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByLabelText('Approval comment'),
      ).not.toBeInTheDocument();
    },
  );
  it.each([403, 404])(
    'shows an accessible localized failure and no ineffective retry (%s)',
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
        screen.getByRole('button', { name: '返回审批列表' }),
      ).toHaveAttribute('href', '/talent/approvals?status=pending');
      expect(
        screen.queryByRole('button', { name: '重试' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('secret backend details'),
      ).not.toBeInTheDocument();
    },
  );
});
