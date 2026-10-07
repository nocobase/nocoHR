import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// 上线准备: the checklist page shows each step's status from the status endpoint and marks a step as not needed;
// the bulk activation dialog sends the selection and shows the hand-over links once, labelled.
const state = vi.hoisted(() => ({
  request: vi.fn(),
  toast: vi.fn(),
  can: true,
}));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
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

import GoLivePage from '../../client/pages/settings/go-live/index';
import { ActivationDialog } from '../../client/pages/talent/employees/activation';

const status = {
  steps: [
    {
      key: 'config',
      group: 'hr',
      status: 'inProgress',
      facts: {
        companyName: true,
        publicOrigin: false,
        mail: true,
        feishu: false,
        ai: false,
      },
      skipped: false,
      canSkip: true,
    },
    {
      key: 'employees',
      group: 'hr',
      status: 'done',
      facts: { count: 42, lastImport: null },
      skipped: false,
      canSkip: true,
    },
    {
      key: 'contracts',
      group: 'hr',
      status: 'notStarted',
      facts: { covered: 0, total: 42 },
      skipped: false,
      canSkip: true,
    },
    {
      key: 'taxOpening',
      group: 'payroll',
      status: 'notNeeded',
      facts: { firstPayrollMonth: '2026-01', available: true },
      skipped: false,
      canSkip: false,
    },
  ],
  remaining: 2,
  firstPayrollMonth: '2026-01',
  firstPayrollMonthConfigured: '2026-01',
  revision: 3,
  can: { setFirstPayrollMonth: true },
};

describe('上线准备', () => {
  beforeEach(() => {
    state.request.mockReset();
    state.toast.mockReset();
    state.can = true;
    state.request.mockImplementation(
      (options: { path: string; method?: string }) => {
        if (options.path === 'talent/go-live/status')
          return Promise.resolve({ data: status });
        if (options.path === 'talent/go-live/activation-settings')
          return Promise.resolve({
            data: { value: { linkDays: 7 }, revision: 0 },
          });
        return Promise.resolve({ data: {} });
      },
    );
  });

  it('lists the steps in order with their status, facts and the page where each is done', async () => {
    render(
      <MemoryRouter>
        <GoLivePage />
      </MemoryRouter>,
    );
    const config = await screen.findByText(en.goLive.steps.config.title);
    const rows = document.querySelectorAll('li[data-step]');
    expect([...rows].map((row) => row.getAttribute('data-step'))).toEqual([
      'config',
      'employees',
      'contracts',
      'taxOpening',
    ]);
    const configRow = within(config.closest('li')!);
    expect(configRow.getByText(en.goLive.status.inProgress)).toBeTruthy();
    expect(
      configRow.getByText(
        `${en.goLive.facts.publicOrigin} · ${en.goLive.facts.notConfigured}`,
      ),
    ).toBeTruthy();
    const contracts = within(
      screen.getByText(en.goLive.steps.contracts.title).closest('li')!,
    );
    expect(contracts.getByText(en.goLive.status.notStarted)).toBeTruthy();
    expect(contracts.getByText('0 of 42 employees in service')).toBeTruthy();
    expect(
      contracts
        .getByRole('button', { name: en.goLive.steps.contracts.action })
        .getAttribute('href'),
    ).toBe('/talent/contracts/import');
    const tax = within(
      screen.getByText(en.goLive.steps.taxOpening.title).closest('li')!,
    );
    expect(tax.getByText(en.goLive.status.notNeeded)).toBeTruthy();
    // Payroll's own step cannot be marked by this caller; a not-needed one offers nothing.
    expect(tax.queryByRole('button', { name: en.goLive.skip })).toBeNull();
    // The activation link lifetime for HR administrators.
    expect(
      await screen.findByLabelText(en.goLive.activation.linkDays),
    ).toBeTruthy();

    fireEvent.click(contracts.getByRole('button', { name: en.goLive.skip }));
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/go-live/steps/contracts',
          method: 'PUT',
          json: { skipped: true },
        }),
      ),
    );
  });

  it('opens accounts for the selection and shows the hand-over links once, labelled', async () => {
    state.request.mockResolvedValue({
      data: [
        {
          employeeId: 'e1',
          name: 'Wang Fang',
          login: 'gl1001',
          accountCreated: true,
          expiresAt: '2026-10-14T08:00:00.000Z',
          outcome: {
            status: 'manual',
            link: 'http://localhost/activate/abc',
            reason: 'noChannel',
          },
        },
        {
          employeeId: 'e2',
          name: 'Li Lei',
          login: 'gl1002',
          accountCreated: true,
          expiresAt: '2026-10-14T08:00:00.000Z',
          outcome: { status: 'sent', channel: 'feishu', sentTo: 'feishu' },
        },
        {
          employeeId: 'e3',
          name: 'Zhao Min',
          login: null,
          accountCreated: false,
          expiresAt: null,
          outcome: { status: 'skipped', reason: 'noEmail' },
        },
      ],
    });
    const onDone = vi.fn();
    render(
      <ActivationDialog
        open
        selectedIds={['e1', 'e2', 'e3']}
        onOpenChange={() => undefined}
        onDone={onDone}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.goLive.activation.submit }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/account-activation/bulk',
          method: 'POST',
          json: { employeeIds: ['e1', 'e2', 'e3'] },
        }),
      ),
    );
    expect(
      await screen.findByText(en.goLive.activation.handOverTitle),
    ).toBeTruthy();
    const link = screen.getByLabelText(
      'Activation link of Wang Fang',
    ) as HTMLInputElement;
    expect(link.value).toBe('http://localhost/activate/abc');
    expect(screen.getByText(en.goLive.activation.sentBy.feishu)).toBeTruthy();
    expect(
      screen.getByText(en.goLive.activation.skippedReason.noEmail),
    ).toBeTruthy();
    // The other employees' links are never shown.
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
  });

  it('offers every employee without an account when nothing is selected', async () => {
    state.request.mockResolvedValue({ data: [] });
    render(
      <ActivationDialog
        open
        selectedIds={[]}
        onOpenChange={() => undefined}
        onDone={() => undefined}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: en.goLive.activation.submit }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({ json: { allWithoutAccount: true } }),
      ),
    );
  });
});
