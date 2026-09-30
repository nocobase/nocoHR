import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V1-03 UI: 待处理 (ignore needs a reason, 发起调岗单 carries the item), 职务映射
// (confirm sends the ids) and the personnel action form pre-filled from an item.
const state = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({
    can: true,
    isPending: false,
    error: undefined,
    retry: () => undefined,
  }),
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
      {
        id: 'pos-asm',
        code: 'asm',
        title: 'Assembler',
        active: true,
        jobFamilyId: 'jf',
      },
    ],
    departmentTitle: (id: string) =>
      ({ 'sz-mc': 'Machining', 'sz-as': 'Assembly' })[id] ?? id,
    positionTitle: (id: string) =>
      ({ 'pos-cnc': 'CNC operator', 'pos-asm': 'Assembler' })[id] ?? id,
    loading: false,
    reload: () => undefined,
  }),
}));

import NewActionPage from '../../client/pages/talent/actions/new';
import OrgSyncAliasesTab from '../../client/pages/settings/org-sync/aliases';
import OrgSyncIssuesTab from '../../client/pages/settings/org-sync/issues';

const mismatch = {
  key: 'orgMismatch:ou_limin',
  type: 'orgMismatch',
  externalId: 'ou_limin',
  employeeId: 'emp-limin',
  detail: {
    name: 'Li Min',
    from: { departmentId: 'sz-mc', positionId: 'pos-cnc' },
    to: { departmentId: 'sz-as', positionId: 'pos-asm' },
    suggestedAction: 'transfer',
  },
  status: 'open',
};

const syncContext = {
  status: {
    settings: {
      value: {
        provider: 'feishu',
        scopeRootDepartments: [],
        orgMaster: 'nocohr',
        syncDepartmentTree: true,
        fullSyncTime: '02:00',
        syncedProbationMonths: 0,
        masterChangedBy: null,
        masterChangedAt: null,
      },
      revision: 1,
    },
    source: { label: 'mock', configured: true },
    lastRun: null,
  },
  statusError: undefined,
  reloadStatus: () => undefined,
  epoch: 0,
  bump: () => undefined,
};

function Where() {
  const location = useLocation();
  return (
    <output aria-label='location'>
      {location.pathname}
      {location.search}
    </output>
  );
}

function mountTab(path: string, element: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={[`/settings/org-sync/${path}`]}>
      <Where />
      <Routes>
        <Route
          path='/settings/org-sync'
          element={<Outlet context={syncContext} />}
        >
          <Route path={path} element={element} />
        </Route>
        <Route path='/talent/actions/new' element={<p>action form</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('待处理', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.request.mockImplementation((options: { path: string }) =>
      Promise.resolve({
        data:
          options.path === 'talent/org-sync/issues'
            ? { runId: 'run-1', orgMaster: 'nocohr', issues: [mismatch] }
            : options.path === 'talent/employees'
              ? { items: [] }
              : {},
      }),
    );
  });

  it('shows both sides and requires a reason before ignoring', async () => {
    mountTab('issues', <OrgSyncIssuesTab />);
    expect(await screen.findByText('Li Min')).toBeInTheDocument();
    // NocoHR's position beside the office suite's.
    expect(screen.getByText('CNC operator')).toBeInTheDocument();
    expect(screen.getByText('Assembler')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: en.orgSync.issues.ignore }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) =>
          b.textContent === en.orgSync.issues.ignoreConfirm &&
          b.getAttribute('type') === 'submit',
      )!,
    );
    expect(
      await screen.findByText(en.orgSync.issues.reasonRequired),
    ).toBeInTheDocument();
    expect(
      state.request.mock.calls.filter(
        ([o]) =>
          (o as { path: string }).path === 'talent/org-sync/issues/ignore',
      ),
    ).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Reason/u), {
      target: { value: 'Temporary secondment' },
    });
    fireEvent.click(
      Array.from(dialog.querySelectorAll('button')).find(
        (b) => b.getAttribute('type') === 'submit',
      )!,
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/org-sync/issues/ignore',
          method: 'POST',
          json: { key: mismatch.key, reason: 'Temporary secondment' },
        }),
      ),
    );
  });

  it('raises a transfer with the item it came from', async () => {
    mountTab('issues', <OrgSyncIssuesTab />);
    const label = await screen.findByText(en.orgSync.issues.transfer);
    fireEvent.click(label.closest('a')!);
    await waitFor(() =>
      expect(screen.getByLabelText('location')).toHaveTextContent(
        `/talent/actions/new?fromIssue=${encodeURIComponent(mismatch.key)}`,
      ),
    );
  });
});

describe('职务映射', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.request.mockImplementation((options: { path: string }) =>
      Promise.resolve({
        data:
          options.path === 'talent/position-aliases'
            ? [
                {
                  id: 'alias-1',
                  provider: 'feishu',
                  externalTitle: 'CNC machine operator',
                  positionId: 'pos-cnc',
                  positionTitle: 'CNC operator',
                  source: 'ai',
                  reviewStatus: 'draft',
                  draftReason: 'Same job family and duties',
                  confirmedBy: null,
                  confirmedAt: null,
                  headcount: 0,
                },
              ]
            : {},
      }),
    );
  });

  it('confirms a draft by id', async () => {
    mountTab('aliases', <OrgSyncAliasesTab />);
    expect(
      await screen.findByText('Why: Same job family and duties'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: en.orgSync.aliases.confirm }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/position-aliases/confirm',
          method: 'POST',
          json: { ids: ['alias-1'] },
        }),
      ),
    );
  });
});

describe('action form from a pending item', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.reload.mockReset();
    state.request.mockImplementation(
      (options: { path: string; method?: string }) => {
        if (options.path === 'talent/org-sync/issues/prefill')
          return Promise.resolve({
            data: {
              issueKey: mismatch.key,
              actionType: 'transfer',
              effectiveDate: '2026-09-29',
              employeeId: 'emp-limin',
              toDepartmentId: 'sz-as',
              toPositionId: 'pos-asm',
            },
          });
        if (options.path === 'talent/employees')
          return Promise.resolve({
            data: {
              items: [
                {
                  id: 'emp-limin',
                  name: 'Li Min',
                  employeeNo: 'QH1001',
                  departmentId: 'sz-mc',
                  status: 'active',
                },
              ],
            },
          });
        if (options.path === 'talent/framework')
          return Promise.resolve({
            data: { requirements: [], competencies: [] },
          });
        if (options.path === 'talent/actions' && options.method === 'POST')
          return Promise.resolve({ data: { id: 'action-1' } });
        if (options.path === 'talent/actions/preview')
          return Promise.resolve({ data: [] });
        return Promise.resolve({ data: { rows: [] } });
      },
    );
  });

  it('pre-fills the transfer and sends the item key', async () => {
    render(
      <MemoryRouter
        initialEntries={[
          `/talent/actions/new?fromIssue=${encodeURIComponent(mismatch.key)}`,
        ]}
      >
        <Where />
        <Routes>
          <Route
            path='/talent/actions'
            element={<Outlet context={{ reload: state.reload }} />}
          >
            <Route path='new' element={<NewActionPage />} />
            <Route path=':actionId' element={<p>detail</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByText(en.talent.actions.prefilledFromSync),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        (screen.getByLabelText(en.talent.actions.employee) as HTMLSelectElement)
          .value,
      ).toBe('emp-limin'),
    );
    expect(
      (screen.getByLabelText(en.talent.actions.type) as HTMLSelectElement)
        .value,
    ).toBe('transfer');
    // The item key is read once and dropped from the URL.
    expect(screen.getByLabelText('location')).not.toHaveTextContent(
      'fromIssue',
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.talent.actions.submit }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/actions',
          method: 'POST',
          json: expect.objectContaining({
            actionType: 'transfer',
            employeeId: 'emp-limin',
            toDepartmentId: 'sz-as',
            toPositionId: 'pos-asm',
            syncIssueKey: mismatch.key,
          }),
        }),
      ),
    );
  });
});
