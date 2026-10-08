import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// Defects found while importing a customer's data: 参保方案 could not be created, a salary item's code lost focus
// on every keystroke, a new structure showed “does not exist” after saving, the salary files did not reload after
// an import, and the bulk activation result could not scroll to its last links.
const state = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  can: true,
}));
// One client for every render, as the application provides: a new object per render would reload every list.
const api = vi.hoisted(() => ({
  request: (options: unknown) => state.request(options) as Promise<unknown>,
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => api,
}));
vi.mock('@nocobase/app-plugin-authorization/client', () => ({
  useCan: () => ({
    can: state.can,
    isPending: false,
    error: undefined,
    retry: () => undefined,
  }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useLocale: () => ({ locale: 'en-US' }),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
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
// The importer's own dialog is covered elsewhere; here only its callback matters.
vi.mock('../../client/components/talent/payroll-opening-import', () => ({
  OpeningImportButton: ({ onImported }: { onImported?: () => void }) => (
    <button type='button' onClick={() => onImported?.()}>
      fake-import
    </button>
  ),
}));

import StructurePage from '../../client/pages/settings/payroll/structure';
import {
  ActivationDialog,
  ActivationResults,
  type ActivationResult,
} from '../../client/pages/talent/employees/activation';
import SalariesPage from '../../client/pages/talent/payroll/salaries/index';
import SocialInsurancePage from '../../client/pages/talent/payroll/social-insurance/index';

type Request = { path: string; method?: string; json?: unknown };
const calls = (path: string, method = 'GET') =>
  state.request.mock.calls.filter(
    ([options]: [Request]) =>
      options.path === path && (options.method ?? 'GET') === method,
  );

beforeEach(() => {
  state.request.mockReset();
  state.toast.mockReset();
  state.can = true;
});

describe('薪资结构编辑器', () => {
  const structure = {
    id: 's1',
    title: 'Line staff',
    appliesTo: { jobFamilyIds: [], departmentIds: [] },
    items: [
      {
        code: 'base',
        title: 'Base',
        kind: 'earning',
        calc: 'formula',
        formula: 'base',
        unit: null,
        departmentIds: [],
        taxable: true,
        includedInSocialBase: true,
      },
    ],
    params: [],
    payRanges: [],
    payDaysPerMonth: 21.75,
    changeLog: [],
    active: true,
  };

  beforeEach(() => {
    state.request.mockImplementation((options: Request) => {
      if (options.path === 'talent/payroll-settings/structures')
        return options.method === 'POST'
          ? Promise.resolve({ data: { structure, trial: null } })
          : // The list the page loaded before the save: the new structure is not in it yet.
            Promise.resolve({ data: [] });
      if (options.path === 'talent/payroll-settings/variables')
        return Promise.resolve({
          data: { fixed: [], attendance: [], labels: {}, prefixes: [] },
        });
      if (options.path === 'talent/lookups')
        return Promise.resolve({ data: { departments: [], positions: [] } });
      return Promise.resolve({ data: {} });
    });
  });

  const renderNew = () =>
    render(
      <MemoryRouter initialEntries={['/settings/payroll/structures/new']}>
        <Routes>
          <Route
            path='/settings/payroll/structures/:structureId'
            element={<StructurePage />}
          />
        </Routes>
      </MemoryRouter>,
    );

  it('keeps the code input while a multi-character code is typed', async () => {
    renderNew();
    fireEvent.click(
      await screen.findByRole('button', { name: en.payroll.structure.addItem }),
    );
    const input = screen.getByLabelText(
      en.payroll.structure.code,
    ) as HTMLInputElement;
    input.focus();
    for (const value of ['b', 'ba', 'bas', 'base'])
      fireEvent.change(input, { target: { value } });
    // The same element (not a remounted row) holds the whole code and keeps focus.
    expect(input.isConnected).toBe(true);
    expect(input.value).toBe('base');
    expect(document.activeElement).toBe(input);
    expect(
      (screen.getByLabelText(en.payroll.structure.code) as HTMLInputElement)
        .value,
    ).toBe('base');
  });

  it('shows a structure it has just created, before the list reloads with it', async () => {
    renderNew();
    fireEvent.change(await screen.findByLabelText(en.payroll.structure.name), {
      target: { value: 'Line staff' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.payroll.structure.save }),
    );
    await waitFor(() =>
      expect(calls('talent/payroll-settings/structures', 'POST')).toHaveLength(
        1,
      ),
    );
    // The page's own list is loaded again, and the editor stays meanwhile.
    await waitFor(() =>
      expect(calls('talent/payroll-settings/structures')).toHaveLength(2),
    );
    expect(
      screen.queryByText(en.payroll.errors.STRUCTURE_NOT_FOUND),
    ).toBeNull();
    expect(
      await screen.findByRole('heading', { name: 'Line staff' }),
    ).toBeTruthy();
    expect(
      screen.queryByText(en.payroll.errors.STRUCTURE_NOT_FOUND),
    ).toBeNull();
  });
});

describe('薪资档案', () => {
  it('reloads the files and 待建档 after an opening import', async () => {
    state.request.mockImplementation((options: Request) => {
      if (options.path === 'talent/salaries')
        return Promise.resolve({
          data: {
            month: '2026-10',
            rows: [],
            pendingFiles: [],
            can: { manage: true, adjust: true },
          },
        });
      if (options.path === 'talent/lookups')
        return Promise.resolve({ data: { departments: [], positions: [] } });
      return Promise.resolve({ data: [] });
    });
    render(
      <MemoryRouter initialEntries={['/talent/salaries']}>
        <SalariesPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(calls('talent/salaries')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'fake-import' }));
    await waitFor(() => expect(calls('talent/salaries')).toHaveLength(2));
  });
});

describe('参保方案', () => {
  it('creates a plan from the empty state with the six insurances prefilled', async () => {
    let plans: unknown[] = [];
    state.request.mockImplementation((options: Request) => {
      if (options.path === 'talent/social-insurance')
        return Promise.resolve({ data: { plans, enrolments: [] } });
      if (options.path === 'talent/social-insurance/plans') {
        plans = [
          {
            id: 'p1',
            city: 'Suzhou',
            effectiveFrom: '2026-01',
            effectiveTo: null,
            note: null,
            items: [],
          },
        ];
        return Promise.resolve({ data: plans[0] });
      }
      return Promise.resolve({ data: [] });
    });
    render(
      <MemoryRouter initialEntries={['/talent/social-insurance']}>
        <SocialInsurancePage />
      </MemoryRouter>,
    );
    fireEvent.click(
      await screen.findByRole('button', {
        name: en.payroll.insurance.plan.create,
      }),
    );
    expect(
      screen.getAllByLabelText(en.payroll.insurance.plan.employerRate),
    ).toHaveLength(6);
    fireEvent.change(screen.getByLabelText(en.payroll.insurance.city), {
      target: { value: 'Suzhou' },
    });
    fireEvent.change(
      screen.getByLabelText(en.payroll.insurance.plan.effectiveFrom),
      { target: { value: '2026-01' } },
    );
    fireEvent.change(document.getElementById('plan-pension-employerRate')!, {
      target: { value: '16' },
    });
    fireEvent.change(document.getElementById('plan-pension-baseMax')!, {
      target: { value: '36000' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: `Remove ${en.payroll.insurance.codes.maternity}`,
      }),
    );
    // A base maximum below the minimum is refused before anything is sent.
    fireEvent.change(document.getElementById('plan-medical-baseMin')!, {
      target: { value: '5' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.payroll.common.save }),
    );
    expect(
      await screen.findByText(en.payroll.insurance.plan.baseInvalid),
    ).toBeTruthy();
    expect(calls('talent/social-insurance/plans', 'POST')).toHaveLength(0);
    fireEvent.change(document.getElementById('plan-medical-baseMin')!, {
      target: { value: '0' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.payroll.common.save }),
    );
    await waitFor(() =>
      expect(calls('talent/social-insurance/plans', 'POST')).toHaveLength(1),
    );
    const [[sent]] = calls('talent/social-insurance/plans', 'POST') as [
      [Request],
    ];
    const json = sent.json as {
      city: string;
      effectiveFrom: string;
      effectiveTo: string | null;
      items: { code: string; employerRate: number; baseMax: number }[];
    };
    expect(json.city).toBe('Suzhou');
    expect(json.effectiveFrom).toBe('2026-01');
    expect(json.effectiveTo).toBeNull();
    expect(json.items.map((i) => i.code)).toEqual([
      'pension',
      'medical',
      'unemployment',
      'injury',
      'housingFund',
    ]);
    expect(json.items[0]).toMatchObject({ employerRate: 16, baseMax: 36000 });
    // The list is loaded again and shows the new plan with its edit button.
    expect(
      await screen.findByRole('button', { name: 'Edit the plan of Suzhou' }),
    ).toBeTruthy();
  });

  it('offers no create button without the manage permission', async () => {
    state.can = false;
    state.request.mockResolvedValue({ data: { plans: [], enrolments: [] } });
    render(
      <MemoryRouter initialEntries={['/talent/social-insurance']}>
        <SocialInsurancePage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(en.payroll.insurance.noPlans)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: en.payroll.insurance.plan.create }),
    ).toBeNull();
  });
});

describe('批量开通账号 result', () => {
  const writeText = vi.fn(() => Promise.resolve());
  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  const results: ActivationResult[] = Array.from({ length: 15 }, (_, i) => ({
    employeeId: `e${String(i)}`,
    name: `Person ${String(i)}`,
    employeeNo: `GL${String(1000 + i)}`,
    login: `gl${String(1000 + i)}`,
    accountCreated: true,
    expiresAt: '2026-10-14T08:00:00.000Z',
    outcome: {
      status: 'manual',
      link: `http://localhost/activate/t${String(i)}`,
      reason: 'noChannel',
    },
  }));

  it('scrolls the body between a fixed header and footer, and copies every link at once', async () => {
    state.request.mockResolvedValue({ data: results });
    render(
      <ActivationDialog
        open
        selectedIds={results.map((r) => r.employeeId)}
        onOpenChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.goLive.activation.submit }),
    );
    const copyAll = await screen.findByRole('button', {
      name: en.goLive.activation.copyAll,
    });
    expect(screen.getAllByRole('textbox')).toHaveLength(15);
    // The links sit in a scrolling body; the close button is outside it, in the footer.
    const body = document.querySelector('[data-slot="dialog-body"]')!;
    expect(body.className).toContain('overflow-y-auto');
    expect(body.className).toContain('min-h-0');
    const dialog = document.querySelector('[data-slot="dialog-content"]')!;
    expect(dialog.className).toContain('max-h-[90dvh]');
    const close = within(
      document.querySelector<HTMLElement>('[data-slot="dialog-footer"]')!,
    ).getByRole('button', { name: en.goLive.activation.close });
    expect(body.contains(close)).toBe(false);

    fireEvent.click(copyAll);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    const lines = text.split('\n');
    expect(lines).toHaveLength(15);
    expect(lines[0]).toBe('Person 0 GL1000\thttp://localhost/activate/t0');
    expect(lines[14]).toBe('Person 14 GL1014\thttp://localhost/activate/t14');
  });

  it('copies only the links to hand over, with the login when a number is missing', async () => {
    render(
      <ActivationResults
        results={[
          { ...results[0], employeeNo: undefined },
          {
            ...results[1],
            outcome: { status: 'sent', channel: 'feishu', sentTo: 'feishu' },
          },
          results[2],
        ]}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.goLive.activation.copyAll }),
    );
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toBe(
      'Person 0 gl1000\thttp://localhost/activate/t0\n' +
        'Person 2 GL1002\thttp://localhost/activate/t2',
    );
  });

  it('offers no copy-all for a single link', () => {
    render(<ActivationResults results={[results[0]]} />);
    expect(
      screen.queryByRole('button', { name: en.goLive.activation.copyAll }),
    ).toBeNull();
  });
});
