import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ApiClientError } from '@nocobase/app-client';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// V2-05: 界面追加字段 on 请假单. HR put 工作交接人 on the leave form; the employee fills it, a refused submit marks
// it and keeps what was typed, the retry sends it again, and the detail shows it (but not a sensitive field the
// endpoint did not send).
const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
  useService: () => ({ repository: () => ({ uploadOne: vi.fn() }) }),
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

import { LeaveRequestForm } from '../../client/components/talent/leave-request-form';
import { LeaveRequestSummary } from '../../client/components/talent/leave-request-summary';

const definition = (overrides: Record<string, unknown>) => ({
  id: 'def-handover',
  collection: 'leaveRequests',
  key: 'cf_handover',
  label: { 'zh-CN': '工作交接人', 'en-US': 'Handover to' },
  type: 'text',
  options: [],
  required: true,
  defaultValue: null,
  placements: ['form', 'detail'],
  sensitive: false,
  aiReadable: false,
  sortOrder: 0,
  active: true,
  ...overrides,
});
const definitions = [
  definition({}),
  definition({
    id: 'def-diagnosis',
    key: 'cf_diagnosis',
    label: { 'zh-CN': '病情说明', 'en-US': 'Diagnosis' },
    required: false,
    sensitive: true,
    placements: ['detail'],
  }),
];
const leaveType = {
  id: 'leave-personal',
  title: 'Personal leave',
  code: 'personal',
  unit: 'halfDay',
  requiresAttachment: false,
};
type Request = {
  path: string;
  method?: string;
  json?: Record<string, unknown>;
  query?: Record<string, unknown>;
};
let stored: Record<string, unknown> | undefined;
let refuseSubmit: boolean;

async function respond(options: Request) {
  if (options.path === 'talent/custom-fields/definitions')
    return { data: definitions };
  if (options.path.endsWith('/types')) return { data: [leaveType] };
  if (options.path.endsWith('/submit')) {
    if (refuseSubmit) {
      refuseSubmit = false;
      throw new ApiClientError('CUSTOM_FIELD_INVALID', {
        status: 400,
        code: 'CUSTOM_FIELD_INVALID',
        payload: {
          code: 'CUSTOM_FIELD_INVALID',
          details: { fields: { cf_handover: 'CUSTOM_FIELD_REQUIRED' } },
        },
        method: 'POST',
        url: '/api/talent/leave/requests/draft-1/submit',
      });
    }
    stored = { ...stored, status: 'pending' };
    return { data: stored };
  }
  if (options.path === 'talent/leave/requests' && options.method === 'POST') {
    const { clientRequestId: _id, ...json } = options.json ?? {};
    stored = {
      id: 'draft-1',
      status: 'draft',
      updatedAt: '2026-09-29T12:00:00.000Z',
      ...json,
    };
    return { data: stored };
  }
  if (options.method === 'PATCH') {
    const { expectedUpdatedAt: _v, ...json } = options.json ?? {};
    stored = { ...stored, ...json, updatedAt: '2026-09-29T12:05:00.000Z' };
  }
  return { data: stored };
}

function Location() {
  const location = useLocation();
  return <output aria-label='Current location'>{location.pathname}</output>;
}

function writes() {
  return state.api.request.mock.calls
    .map(([options]) => options as Request)
    .filter((options) => options.method);
}

describe('请假单 with 工作交接人', () => {
  beforeEach(() => {
    state.api.request.mockReset();
    state.toast.mockReset();
    stored = undefined;
    refuseSubmit = true;
    state.api.request.mockImplementation(respond);
  });

  it('sends the form field, marks it when refused and keeps the value for the retry', async () => {
    render(
      <MemoryRouter initialEntries={['/talent/me/leave/new']}>
        <Routes>
          <Route
            path='/talent/me'
            element={
              <>
                <Location />
                <Outlet />
              </>
            }
          >
            <Route path='leave/new' element={<LeaveRequestForm />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const handover = await screen.findByLabelText('Handover to *');
    // Only form fields are inputs: the detail-only sensitive field is not.
    expect(screen.queryByLabelText(/Diagnosis/u)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('combobox', { name: 'Leave type' }));
    await userEvent.click(
      await screen.findByRole('option', { name: /Personal leave/u }),
    );
    fireEvent.change(screen.getByLabelText('Starts at'), {
      target: { value: '2029-04-02T09:00' },
    });
    fireEvent.change(screen.getByLabelText('Ends at'), {
      target: { value: '2029-04-02T17:00' },
    });
    await userEvent.type(handover, 'Wang Lei');
    const submit = screen.getByRole('button', { name: 'Save and submit' });
    await userEvent.click(submit);

    await screen.findByText('Required.');
    expect(screen.getByLabelText('Handover to *')).toHaveValue('Wang Lei');
    expect(screen.getByLabelText('Handover to *')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    expect(writes()[0]).toMatchObject({
      method: 'POST',
      path: 'talent/leave/requests',
      json: { customFields: { cf_handover: 'Wang Lei' } },
    });

    await userEvent.click(submit);
    await waitFor(() =>
      expect(screen.getByLabelText('Current location')).toHaveTextContent(
        '/talent/me',
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    // The retry re-reads the saved draft; its values match, so only the submission repeats.
    const submits = writes().filter((w) => w.path.endsWith('/submit'));
    expect(submits).toHaveLength(2);
    expect(writes().filter((w) => w.method === 'PATCH')).toHaveLength(0);
    expect(stored?.status).toBe('pending');
  });

  it('shows the values the endpoint sent on the detail, and leaves out an unsent sensitive field', async () => {
    render(
      <MemoryRouter>
        <LeaveRequestSummary
          row={{
            id: 'draft-1',
            employeeId: 'emp-limin',
            employeeName: '李敏',
            leaveTypeId: 'leave-personal',
            leaveTypeTitle: 'Personal leave',
            leaveUnit: 'halfDay',
            startAt: '2029-04-02T01:00:00.000Z',
            endAt: '2029-04-02T09:00:00.000Z',
            duration: 1,
            reason: null,
            attachmentFileId: null,
            status: 'pending',
            updatedAt: '2026-09-29T12:00:00.000Z',
            canApprove: true,
            canEdit: false,
            isOwnRequest: false,
            canCancel: false,
            approvals: [],
            customFields: { cf_handover: '钱进' },
          }}
        />
      </MemoryRouter>,
    );
    expect(await screen.findByText('Handover to')).toBeInTheDocument();
    expect(screen.getByText('钱进')).toBeInTheDocument();
    expect(screen.queryByText('Diagnosis')).not.toBeInTheDocument();
  });
});
