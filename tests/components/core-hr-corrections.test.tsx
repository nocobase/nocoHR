import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V1-02 UI: 更正任职信息 (reason required, the correction sent, the dialog
// closed) and the HR review of an HR-assistant suggestion field by field.
const state = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      if (typeof result !== 'string') return key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [
      {
        id: 'sz-mc',
        title: 'Machining',
        label: 'Machining',
        parentId: null,
        active: true,
        depth: 0,
      },
      {
        id: 'sz-as',
        title: 'Assembly',
        label: 'Assembly',
        parentId: null,
        active: true,
        depth: 0,
      },
    ],
    positions: [
      {
        id: 'pos-cnc',
        code: 'cnc',
        title: 'CNC operator',
        active: true,
        jobFamilyId: 'jf',
      },
    ],
    departmentTitle: (id: string) => id,
    positionTitle: (id: string) => id,
    loading: false,
    reload: () => undefined,
  }),
}));

import CorrectJobDialog from '../../client/pages/talent/employees/detail/correct-job';
import ProfileChangesPage from '../../client/pages/talent/employees/changes';

const detail = {
  employee: {
    id: 'emp-qianjin',
    name: 'Qian Jin',
    employeeNo: 'QH2003',
    departmentId: 'sz-mc',
    positionId: 'pos-cnc',
    status: 'active',
  },
  can: { correctJob: true },
};

function Where() {
  const location = useLocation();
  return <output aria-label='location'>{location.pathname}</output>;
}

describe('更正任职信息', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.reload.mockReset();
    state.request.mockImplementation(
      (options: { path: string; method?: string }) =>
        Promise.resolve({ data: options.method ? {} : detail }),
    );
  });

  function mount() {
    return render(
      <MemoryRouter initialEntries={['/e/profile/correct-job']}>
        <Routes>
          <Route
            path='/e/profile'
            element={
              <>
                <Where />
                <Outlet
                  context={{
                    detail,
                    departmentTitle: 'Machining',
                    reload: state.reload,
                  }}
                />
              </>
            }
          >
            <Route path='correct-job' element={<CorrectJobDialog />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
  }

  it('requires a reason, then sends the correction and closes', async () => {
    mount();
    const department = await screen.findByLabelText(/Department \*/u);
    fireEvent.change(department, { target: { value: 'sz-as' } });
    fireEvent.click(screen.getByRole('button', { name: en.actions.save }));
    expect(
      await screen.findByText(en.talent.correctJob.noteRequired),
    ).toBeInTheDocument();
    expect(
      state.request.mock.calls.filter(
        ([o]) => (o as { method?: string }).method,
      ),
    ).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Reason \*/u), {
      target: { value: 'Wrong department at hire' },
    });
    fireEvent.click(screen.getByRole('button', { name: en.actions.save }));
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/employees/emp-qianjin/correct-job',
          method: 'POST',
          json: expect.objectContaining({
            departmentId: 'sz-as',
            status: 'active',
            note: 'Wrong department at hire',
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('location')).toHaveTextContent('/e/profile'),
    );
    expect(state.reload).toHaveBeenCalled();
    expect(state.toast).toHaveBeenCalled();
  });
});

describe('reviewing an HR-assistant suggestion', () => {
  const suggestion = {
    id: 'change-ai',
    employeeId: 'emp-sunli',
    employeeName: 'Sun Li',
    changes: { idNumber: '999999199501010099', birthDate: '1995-01-01' },
    current: { idNumber: '999999199001010011', birthDate: '1990-01-01' },
    source: 'ai',
    attachmentFileId: 'file-1',
    attachmentPath: '/uploads/hr-files/file-1.pdf',
    confidence: {
      idNumber: { confidence: 0.92, snippet: 'ID 9999…' },
      birthDate: { confidence: 0.6, snippet: 'Born 1995' },
    },
    status: 'pending',
    reviewerUserId: null,
    reviewedAt: null,
    comment: null,
    createdAt: '2026-09-29T01:00:00.000Z',
  };

  beforeEach(() => {
    state.request.mockReset();
    state.request.mockImplementation((options: { method?: string }) =>
      Promise.resolve({ data: options.method ? suggestion : [suggestion] }),
    );
  });

  it('sends only the adopted fields with HR’s final values', async () => {
    render(
      <MemoryRouter initialEntries={['/employees/changes']}>
        <Routes>
          <Route
            path='/employees'
            element={<Outlet context={{ reload: state.reload }} />}
          >
            <Route path='changes' element={<ProfileChangesPage />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(en.talent.changes.source.ai),
    ).toBeInTheDocument();
    expect(screen.getByText('Confidence 92%')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Adopt Date of birth' }),
    );
    fireEvent.change(screen.getByLabelText('Value read for ID number'), {
      target: { value: '999999199501010098' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.talent.changes.approve }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/profile-changes/change-ai/approve',
          json: {
            comment: null,
            values: { idNumber: '999999199501010098' },
          },
        }),
      ),
    );
  });
});
