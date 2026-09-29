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
import { ApiClientError } from '@nocobase/app-client';
import en from '../../client/locales/en-US';
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  upload: vi.fn(),
  locale: 'en-US',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
  useService: () => ({ repository: () => ({ uploadOne: state.upload }) }),
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
      return typeof result === 'string' ? result : (args.defaultValue ?? key);
    },
  }),
}));
vi.mock(
  '../../client/extensions/nocobase-file-component-ui',
  async (original) => ({
    ...(await original<
      typeof import('../../client/extensions/nocobase-file-component-ui')
    >()),
    // The real upload field runs; this stub verifies authorized preview handoff,
    // not PDF rendering fidelity (which requires an actual browser).
    FilePreviewDialog: ({
      files,
      onOpenChange,
    }: {
      files: { filename: string }[];
      onOpenChange: (value: boolean) => void;
    }) => (
      <div role='dialog' aria-label='Test proof preview'>
        {files[0]?.filename}
        <button onClick={() => onOpenChange(false)}>Close preview</button>
      </div>
    ),
  }),
);

import NewLeaveRequestPage from '../../client/pages/talent/me/leave-new';
import { LeaveProofButton } from '../../client/components/talent/leave-proof-button';
import { MyLeaveRequests } from '../../client/pages/talent/me/leave-requests';

const file = {
  id: 'proof-1',
  filename: 'medical-proof.pdf',
  ext: 'pdf',
  mimeType: 'application/pdf',
  size: 17,
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z',
  contentUrl: '/main/uploads/leave-proofs/proof-1.pdf',
};
const leaveType = {
  id: 'sick',
  title: 'Sick leave',
  code: 'sick',
  unit: 'day',
  requiresAttachment: true,
};
function mount(path = '/talent/me/leave/new') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path='/talent/me'
          element={
            <>
              <p>My profile</p>
              <Outlet />
            </>
          }
        >
          <Route path='leave/new' element={<NewLeaveRequestPage />} />
          <Route
            path='leave/:requestId/edit'
            element={<NewLeaveRequestPage />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}
async function fill() {
  await waitFor(() => expect(screen.getByRole('combobox')).toBeEnabled());
  await userEvent.click(screen.getByRole('combobox'));
  await userEvent.click(
    await screen.findByRole('option', { name: /Sick leave/u }),
  );
  fireEvent.change(screen.getByLabelText('Starts at'), {
    target: { value: '2029-04-02T09:00' },
  });
  fireEvent.change(screen.getByLabelText('Ends at'), {
    target: { value: '2029-04-02T17:00' },
  });
  await userEvent.type(screen.getByLabelText('Reason'), 'Medical appointment');
}
async function chooseProof() {
  const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
  await userEvent.upload(
    input,
    new File(['%PDF-1.4 Test'], 'medical-proof.pdf', {
      type: 'application/pdf',
    }),
  );
}

describe('private leave proof UI', () => {
  beforeEach(() => {
    state.api.request.mockReset();
    state.upload.mockReset();
    state.locale = 'en-US';
    state.api.request.mockResolvedValue({ data: [leaveType] });
    state.upload.mockResolvedValue({ record: file, createdTargets: [] });
  });
  it('requires proof and prevents submission and dialog closing while uploading', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.upload.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    mount();
    await fill();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    expect(
      screen.getByText('This leave type requires proof before submission.'),
    ).toBeInTheDocument();
    await chooseProof();
    expect(state.upload).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Cancel', exact: true }),
      ).toBeDisabled(),
    );
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      state.api.request.mock.calls.filter(([options]) => options.method),
    ).toHaveLength(0);
    await act(async () => {
      finish?.({ record: file, createdTargets: [] });
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and submit' }),
      ).toBeEnabled(),
    );
  });
  it('keeps the proof id and form when business submission fails and reuses the draft on retry', async () => {
    let stored: Record<string, unknown>;
    let attempts = 0;
    state.api.request.mockImplementation(
      async (options: {
        path: string;
        method?: string;
        json?: Record<string, unknown>;
      }) => {
        if (options.path.endsWith('/types')) return { data: [leaveType] };
        if (options.method === 'POST' && options.path.endsWith('/requests')) {
          stored = {
            ...options.json,
            id: 'draft-1',
            updatedAt: '2026-09-29T12:00:00.000',
            status: 'draft',
          };
          return { data: stored };
        }
        if (options.path.endsWith('/submit')) {
          attempts += 1;
          if (attempts === 1) throw new Error('private backend error');
          return { data: { ...stored!, status: 'pending' } };
        }
        return { data: stored! };
      },
    );
    mount();
    await fill();
    await chooseProof();
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and submit' }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    expect(
      await screen.findByText('Request failed. Please try again.'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveValue('Medical appointment');
    expect(screen.getByText('medical-proof.pdf')).toBeInTheDocument();
    expect(screen.queryByText('private backend error')).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(state.upload).toHaveBeenCalledOnce();
    const creates = state.api.request.mock.calls.filter(
      ([o]) => o.method === 'POST' && o.path.endsWith('/requests'),
    );
    expect(creates).toHaveLength(1);
    expect(creates[0]![0].json.attachmentFileId).toBe('proof-1');
    expect(attempts).toBe(2);
  });
  it('blocks blind retries of uncertain uploads without displaying raw errors', async () => {
    state.upload.mockRejectedValue(new Error('secret storage details'));
    mount();
    await fill();
    await chooseProof();
    await waitFor(() =>
      expect(
        screen.getAllByText(en.attendance.leave.proofUploadUncertain).length,
      ).toBeGreaterThan(0),
    );
    expect(
      screen.queryByText('secret storage details'),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Retry: medical-proof.pdf' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Upload proof' })).toBeDisabled();
    expect(state.upload).toHaveBeenCalledOnce();
  });
  it('refetches authorized proof metadata every time the preview opens', async () => {
    state.api.request.mockResolvedValue({ data: file });
    render(<LeaveProofButton requestId='request-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'View proof' }));
    expect(
      await screen.findByRole('dialog', { name: 'Test proof preview' }),
    ).toHaveTextContent('medical-proof.pdf');
    await userEvent.click(
      screen.getByRole('button', { name: 'Close preview' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'View proof' }));
    expect(
      await screen.findByRole('dialog', { name: 'Test proof preview' }),
    ).toBeInTheDocument();
    expect(state.api.request).toHaveBeenCalledTimes(2);
    expect(state.api.request.mock.calls[0]![0].path).toBe(
      'talent/leave/requests/request-1/proof',
    );
  });
  it('cancels a pending metadata read and ignores late responses', async () => {
    let finish: ((value: unknown) => void) | undefined;
    state.api.request.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<LeaveProofButton requestId='request-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'View proof' }));
    expect(screen.getByText('Loading proof…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(state.api.request.mock.calls[0]![0].signal.aborted).toBe(true);
    await act(async () => {
      finish?.({ data: file });
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View proof' })).toBeEnabled();
  });
  it('shows a localized unavailable state, never raw server error text', async () => {
    state.locale = 'zh-CN';
    state.api.request.mockRejectedValue(new Error('secret'));
    render(<LeaveProofButton requestId='request-1' />);
    await userEvent.click(screen.getByRole('button', { name: '查看证明' }));
    expect(
      await screen.findByText(zh.attendance.leave.proofUnavailable),
    ).toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('shows the applicant request status and fetches proof only when requested', async () => {
    state.api.request.mockResolvedValue({ data: file });
    render(
      <MemoryRouter>
        <MyLeaveRequests
          rows={[
            {
              id: 'mine',
              startAt: '2029-04-02T01:00:00Z',
              endAt: '2029-04-02T09:00:00Z',
              status: 'pending',
              attachmentFileId: file.id,
            },
          ]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('table')).toHaveTextContent('Pending approval');
    expect(
      screen.getByRole('link', { name: /View leave request starting/u }),
    ).toHaveAttribute('href', '/talent/me/leave/mine');
    expect(state.api.request).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'View proof' }));
    expect(
      await screen.findByRole('dialog', { name: 'Test proof preview' }),
    ).toHaveTextContent(file.filename);
    expect(state.api.request.mock.calls[0]![0].path).toBe(
      'talent/leave/requests/mine/proof',
    );
  });
  it('saves an incomplete proof draft without submitting it', async () => {
    state.api.request.mockImplementation(async (options) =>
      options.method
        ? {
            data: {
              ...options.json,
              id: 'draft-1',
              status: 'draft',
              updatedAt: '2026-09-29T12:00:00.000',
            },
          }
        : { data: [leaveType] },
    );
    mount();
    await fill();
    expect(
      screen.getByRole('button', { name: 'Save and submit' }),
    ).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Save draft', exact: true }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    const writes = state.api.request.mock.calls.filter(([o]) => o.method);
    expect(writes).toHaveLength(1);
    expect(writes[0]![0]).toMatchObject({
      path: 'talent/leave/requests',
      method: 'POST',
      json: { attachmentFileId: null },
    });
  });
  it('restores a saved AI draft and proof on a fresh deep link without creating or uploading again', async () => {
    let saved = {
      id: 'draft-1',
      status: 'draft',
      canEdit: true,
      leaveTypeId: leaveType.id,
      startAt: '2029-04-02T01:00:00.000Z',
      endAt: '2029-04-02T09:00:00.000Z',
      reason: 'Saved reason',
      source: 'hrAssistant',
      attachmentFileId: file.id,
      updatedAt: '2026-09-29T12:00:00.000',
    };
    state.api.request.mockImplementation(async (options) => {
      if (options.path.endsWith('/types')) return { data: [leaveType] };
      if (options.method === 'PATCH')
        saved = {
          ...saved,
          ...options.json,
          updatedAt: '2026-09-29T12:00:01.000',
        };
      return { data: { ...saved } };
    });
    mount('/talent/me/leave/draft-1/edit');
    const reason = await screen.findByLabelText('Reason');
    expect(reason).toHaveValue('Saved reason');
    expect(
      new Date(
        (screen.getByLabelText('Starts at') as HTMLInputElement).value,
      ).toISOString(),
    ).toBe(saved.startAt);
    expect(screen.getByRole('button', { name: 'View proof' })).toBeEnabled();
    await userEvent.type(reason, ' updated');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save and submit' }),
      ).toBeEnabled(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Save and submit' }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(state.upload).not.toHaveBeenCalled();
    const writes = state.api.request.mock.calls.filter(([o]) => o.method);
    expect(writes).toHaveLength(2);
    expect(writes[0]![0]).toMatchObject({
      method: 'PATCH',
      path: 'talent/leave/requests/draft-1',
      json: {
        source: 'hrAssistant',
        reason: 'Saved reason updated',
        attachmentFileId: file.id,
        expectedUpdatedAt: '2026-09-29T12:00:00.000',
      },
    });
    expect(writes[1]![0]).toMatchObject({
      path: 'talent/leave/requests/draft-1/submit',
      json: { expectedUpdatedAt: '2026-09-29T12:00:01.000' },
    });
  });
  it('keeps edited input on a stale draft and requires confirmed reload before another write', async () => {
    const saved = {
      id: 'draft-1',
      status: 'draft',
      canEdit: true,
      leaveTypeId: leaveType.id,
      startAt: '2029-04-02T01:00:00.000Z',
      endAt: '2029-04-02T09:00:00.000Z',
      reason: 'Saved reason',
      source: 'self',
      attachmentFileId: file.id,
      updatedAt: '2026-09-29T12:00:00.000',
    };
    let reads = 0;
    state.api.request.mockImplementation(async (options) => {
      if (options.path.endsWith('/types')) return { data: [leaveType] };
      reads++;
      return {
        data:
          reads === 1
            ? saved
            : {
                ...saved,
                reason: 'Concurrent edit',
                updatedAt: '2026-09-29T12:00:01.000',
              },
      };
    });
    mount('/talent/me/leave/draft-1/edit');
    await userEvent.type(await screen.findByLabelText('Reason'), ' my changes');
    await userEvent.click(
      screen.getByRole('button', { name: 'Save draft', exact: true }),
    );
    expect(
      await screen.findByText(en.attendance.leave.errors.conflict),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Reason')).toHaveValue(
      'Saved reason my changes',
    );
    expect(
      screen.getByRole('button', { name: 'Save draft', exact: true }),
    ).toBeDisabled();
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      0,
    );
    await userEvent.click(
      screen.getByRole('button', { name: 'Reload saved draft' }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      en.attendance.leave.reloadDraftDescription,
    );
    await userEvent.click(
      screen.getAllByRole('button', { name: 'Reload saved draft' }).at(-1)!,
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Reason')).toHaveValue('Concurrent edit'),
    );
    expect(
      screen.getByRole('button', { name: 'Save draft', exact: true }),
    ).toBeEnabled();
  });
  it.each([403, 404])(
    'blocks foreign or inaccessible draft deep links (%s)',
    async (status) => {
      state.api.request.mockRejectedValue(
        new ApiClientError('secret details', { status }),
      );
      mount('/talent/me/leave/foreign/edit');
      expect(
        await screen.findByText(
          status === 403
            ? en.attendance.leave.errors.forbidden
            : en.attendance.leave.errors.notFound,
        ),
      ).toBeInTheDocument();
      expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Retry' }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('secret details')).not.toBeInTheDocument();
    },
  );
  it('does not open a submitted request as an editable draft', async () => {
    state.api.request.mockResolvedValue({
      data: { id: 'request-1', status: 'pending', canEdit: false },
    });
    mount('/talent/me/leave/request-1/edit');
    expect(
      await screen.findByText(en.attendance.leave.draftUnavailable),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Reason')).not.toBeInTheDocument();
  });
  it('confirms discarding unsaved draft changes on close', async () => {
    mount();
    await fill();
    await userEvent.click(
      screen.getByRole('button', { name: 'Cancel', exact: true }),
    );
    expect(await screen.findByRole('alertdialog')).toHaveTextContent(
      en.attendance.leave.discardDescription,
    );
    await userEvent.click(
      screen.getByRole('button', { name: en.attendance.leave.keepEditing }),
    );
    expect(screen.getByLabelText('Reason')).toHaveValue('Medical appointment');
    expect(state.api.request.mock.calls.filter(([o]) => o.method)).toHaveLength(
      0,
    );
  });
});
