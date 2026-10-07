import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ApiClientError } from '@nocobase/app-client';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  upload: vi.fn(),
  toast: vi.fn(),
  canRequest: true,
  canHr: true,
  pending: false,
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
  useService: () => ({ repository: () => ({ uploadOne: state.upload }) }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: ({ action }: { action: string }) => ({
    can: action === 'request' ? state.canRequest : state.canHr,
    isPending: state.pending,
  }),
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
      if (typeof result !== 'string') return args.defaultValue ?? key;
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

import HrLeaveEntryPage from '../../client/pages/talent/leave/balances/hr-entry';
import { HrLeaveDrafts } from '../../client/pages/talent/leave/balances/hr-drafts';

const employee = { id: 'emp-sunli', name: 'Sun Li', employeeNo: 'HR-004' };
const leaveType = {
  id: 'annual',
  title: 'Annual leave',
  code: 'annual',
  unit: 'day',
  requiresAttachment: false,
};
const draft = {
  id: 'hr-draft-1',
  employeeId: employee.id,
  employeeName: employee.name,
  leaveTypeId: leaveType.id,
  leaveTypeTitle: leaveType.title,
  startAt: '2029-04-02T01:00:00.000Z',
  endAt: '2029-04-02T09:00:00.000Z',
  reason: 'Family appointment',
  status: 'draft',
  source: 'hr',
  updatedAt: '2026-09-29T12:00:00.000Z',
  attachmentFileId: null,
  canEditHr: true,
};
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, unknown>;
};
let stored: Record<string, unknown>;
let employees: (typeof employee)[];
let type: typeof leaveType;
async function respond(options: Request) {
  if (options.path.endsWith('/entry-employees')) return { data: employees };
  if (options.path.endsWith('/types')) return { data: [type] };
  if (options.path.endsWith('/submit')) {
    stored = { ...stored, status: 'pending', canEditHr: false };
    return { data: stored };
  }
  if (options.path === 'talent/leave/requests') {
    if (options.method === 'POST') {
      stored = { ...draft, ...options.json };
      return { data: stored };
    }
    return { data: stored.status === 'draft' ? [stored] : [] };
  }
  if (options.method === 'PATCH') stored = { ...stored, ...options.json };
  return { data: stored };
}
function Location() {
  const location = useLocation();
  return (
    <output aria-label='Current location'>
      {location.pathname}
      {location.search}
    </output>
  );
}
function mount(
  path = '/talent/leave/balances/entry?year=2029',
  withDrafts = false,
) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/talent/leave/balances'
          element={
            <>
              <Location />
              {withDrafts ? <HrLeaveDrafts /> : <p>Leave balances</p>}
              <Outlet />
            </>
          }
        >
          <Route path='entry' element={<HrLeaveEntryPage />} />
          <Route path='entry/:requestId' element={<HrLeaveEntryPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
function writes() {
  return state.api.request.mock.calls
    .map(([options]) => options as Request)
    .filter((options) => options.method);
}
async function fill() {
  await waitFor(() =>
    expect(screen.getByRole('combobox', { name: 'Employee' })).toBeEnabled(),
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Employee' }));
  expect(await screen.findAllByRole('option')).toHaveLength(1);
  await userEvent.click(
    screen.getByRole('option', { name: 'Sun Li · HR-004' }),
  );
  await userEvent.click(screen.getByRole('combobox', { name: 'Leave type' }));
  await userEvent.click(
    await screen.findByRole('option', { name: /Annual leave/u }),
  );
  fireEvent.change(screen.getByLabelText('Starts at'), {
    target: { value: '2029-04-02T09:00' },
  });
  fireEvent.change(screen.getByLabelText('Ends at'), {
    target: { value: '2029-04-02T17:00' },
  });
  await userEvent.type(screen.getByLabelText('Reason'), 'Family appointment');
}

describe('documented HR entry for employees without accounts', () => {
  beforeEach(() => {
    state.api.request.mockReset();
    state.upload.mockReset();
    state.toast.mockReset();
    state.canRequest = true;
    state.canHr = true;
    state.pending = false;
    state.locale = 'en-US';
    stored = { ...draft };
    employees = [employee];
    type = { ...leaveType };
    state.api.request.mockImplementation(respond);
  });

  it.each(['pending', 'requestDenied', 'hrDenied'] as const)(
    'does not fetch employee data while gate is %s',
    async (gate) => {
      state.pending = gate === 'pending';
      state.canRequest = gate !== 'requestDenied';
      state.canHr = gate !== 'hrDenied';
      mount(undefined, true);
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(state.api.request).not.toHaveBeenCalled();
    },
  );

  it('uses the authorized employee selector and submits source=hr through the existing approval endpoint', async () => {
    mount();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(2);
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: 'talent/leave/requests',
      json: {
        employeeId: employee.id,
        source: 'hr',
        reason: 'Family appointment',
      },
    });
    expect(writes()[1]).toMatchObject({
      method: 'POST',
      path: 'talent/leave/requests/hr-draft-1/submit',
      json: { expectedUpdatedAt: draft.updatedAt },
    });
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/talent/leave/balances?year=2029',
    );
    expect(stored.status).toBe('pending');
  });

  it('saves without submitting, refreshes the HR draft list and preserves parent filters when continuing', async () => {
    stored = { status: 'pending' };
    mount(undefined, true);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(1);
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: en.attendance.leave.hrEntry.draftSaved,
      }),
    );
    const link = await screen.findByRole('link', {
      name: 'Continue HR leave draft for Sun Li',
    });
    expect(link).toHaveAttribute(
      'href',
      '/talent/leave/balances/entry/hr-draft-1?year=2029',
    );
    const listCalls = state.api.request.mock.calls
      .map(([options]) => options as Request)
      .filter(
        (options) =>
          options.path === 'talent/leave/requests' && !options.method,
      );
    expect(listCalls.length).toBeGreaterThan(1);
    expect(listCalls.at(-1)?.query).toMatchObject({
      source: 'hr',
      status: 'draft',
    });
    await userEvent.click(link);
    expect(await screen.findByLabelText('Reason')).toHaveValue(
      'Family appointment',
    );
    expect(screen.getByRole('combobox', { name: 'Employee' })).toBeDisabled();
  });

  it('shows eligible-empty state and blocks writes', async () => {
    employees = [];
    mount();
    expect(
      await screen.findByText(en.attendance.leave.hrEntry.noEmployees),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    expect(writes()).toHaveLength(0);
  });

  it('localizes lookup failures and retries without exposing backend details', async () => {
    let fail = true;
    state.api.request.mockImplementation(async (options: Request) => {
      if (options.path.endsWith('/entry-employees') && fail)
        throw new Error('private backend details');
      return respond(options);
    });
    mount();
    expect(
      await screen.findByText(en.attendance.leave.errors.failed),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('private backend details'),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Retry/u }));
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Employee' })).toBeEnabled(),
    );
  });

  it('restores the HR draft and proof, locks the employee and does not create a second draft', async () => {
    stored = { ...draft, attachmentFileId: 'proof-1' };
    mount('/talent/leave/balances/entry/hr-draft-1?year=2029');
    expect(await screen.findByLabelText('Reason')).toHaveValue(draft.reason);
    expect(
      screen.getByRole('button', { name: 'View proof' }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and submit' }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole('combobox', { name: 'Employee' })).toBeDisabled();
    expect(
      screen.getByRole('combobox', { name: 'Employee' }),
    ).toHaveTextContent('Sun Li · HR-004');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(writes()).toHaveLength(1);
    expect(writes()[0]?.path).toBe('talent/leave/requests/hr-draft-1/submit');
    expect(stored.attachmentFileId).toBe('proof-1');
  });

  it('does not render editable fields for a no-longer-eligible HR draft', async () => {
    stored.canEditHr = false;
    mount('/talent/leave/balances/entry/hr-draft-1');
    expect(
      await screen.findByText(en.attendance.leave.hrEntry.unavailable),
    ).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(
      state.api.request.mock.calls.some(([options]) =>
        options.path.endsWith('/entry-employees'),
      ),
    ).toBe(false);
  });

  it('requires proof before submission and retains input after a known upload failure', async () => {
    type.requiresAttachment = true;
    state.upload.mockRejectedValue(
      new ApiClientError('private storage details', { status: 400 }),
    );
    mount();
    await fill();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      new File(['%PDF-1.4 test'], 'proof.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(
        screen.getAllByText(en.attendance.leave.proofUploadFailed).length,
      ).toBeGreaterThan(0),
    );
    expect(screen.getByLabelText('Reason')).toHaveValue('Family appointment');
    expect(
      screen.getByRole('combobox', { name: 'Employee' }),
    ).toHaveTextContent('Sun Li · HR-004');
    expect(
      screen.queryByText('private storage details'),
    ).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('blocks duplicate submit and closing while the mutation is pending', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation(async (options: Request) => {
      if (options.path.endsWith('/submit'))
        return new Promise((resolve) => {
          finish = resolve;
        });
      return respond(options);
    });
    mount();
    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    await waitFor(() => expect(finish).toBeDefined());
    expect(
      screen.getByRole('button', { name: 'Cancel', exact: true }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Save and submit/u }),
    ).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(writes()).toHaveLength(2);
    await act(async () => {
      finish?.({ data: { ...stored, status: 'pending' } });
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('keeps form input on account-link conflict and requires confirmed reload instead of blind retry', async () => {
    state.api.request.mockImplementation(async (options: Request) => {
      if (options.path.endsWith('/submit')) {
        stored.canEditHr = false;
        throw new ApiClientError('HR_ENTRY_REQUIRES_NO_ACCOUNT', {
          status: 409,
          payload: { code: 'HR_ENTRY_REQUIRES_NO_ACCOUNT' },
          method: 'POST',
          url: '/api/talent/leave/hr-entries/submit',
        });
      }
      return respond(options);
    });
    mount();
    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    expect(
      await screen.findByText(
        en.attendance.leave.errors.HR_ENTRY_REQUIRES_NO_ACCOUNT,
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveValue('Family appointment');
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: en.attendance.leave.reloadDraft }),
    );
    const confirmation = screen.getByRole('alertdialog');
    await userEvent.click(
      within(confirmation).getByRole('button', {
        name: en.attendance.leave.reloadDraft,
      }),
    );
    expect(
      await screen.findByText(en.attendance.leave.hrEntry.unavailable),
    ).toBeInTheDocument();
    expect(writes()).toHaveLength(2);
    expect(screen.getByLabelText('Current location')).toHaveTextContent(
      '/talent/leave/balances/entry/hr-draft-1?year=2029',
    );
  });

  it('renders the HR entry and employee labels in Chinese', async () => {
    state.locale = 'zh-CN';
    employees = [{ ...employee, name: '孙丽' }];
    mount();
    expect(
      screen.getByRole('heading', { name: zh.attendance.leave.hrEntry.title }),
    ).toBeInTheDocument();
    const selector = screen.getByRole('combobox', {
      name: zh.attendance.leave.fields.employee,
    });
    await waitFor(() => expect(selector).toBeEnabled());
    await userEvent.click(selector);
    expect(
      await screen.findByRole('option', { name: '孙丽 · HR-004' }),
    ).toBeInTheDocument();
  });
});
