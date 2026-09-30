import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V2-06 工资条: lines expand to their calculation, reference items are listed apart, and 我的工资条 asks for the
// password before showing any amount.
const state = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request: state.request }),
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
      if (typeof result !== 'string') return key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));

import { PayslipView } from '../../client/components/talent/payroll-payslip';
import MyPayslipsPage from '../../client/pages/talent/payroll/my-payslips';

const LINES = [
  {
    code: 'night',
    title: '夜班津贴',
    kind: 'earning' as const,
    calc: 'formula' as const,
    amount: 600,
    value: null,
    unit: null,
    formula: 'att.nightShiftCount × param.nightRate',
    expression: '12 × 50',
    sources: [
      { name: 'att.nightShiftCount', value: 12, source: 'attendance' },
      { name: 'param.nightRate', value: 50, source: 'param' },
    ],
  },
  {
    code: 'pieceCount',
    title: '计件数',
    kind: 'reference' as const,
    calc: 'imported' as const,
    amount: null,
    value: 2400,
    unit: '件',
    formula: null,
    expression: null,
    sources: [],
  },
];
const TOTALS = {
  gross: 600,
  socialEmployee: 10,
  housingFundEmployee: 5,
  tax: 0,
  net: 585,
};

beforeEach(() => state.request.mockReset());

describe('PayslipView', () => {
  it('lists reference items apart and expands a line to its calculation', () => {
    render(<PayslipView lines={LINES} totals={TOTALS} />);
    expect(screen.getByText(en.payroll.payslip.references)).toBeTruthy();
    expect(screen.getByText('2,400 件')).toBeTruthy();
    fireEvent.click(screen.getByText('夜班津贴'));
    expect(screen.getByText('12 × 50')).toBeTruthy();
    expect(screen.getByText(en.payroll.source.attendance)).toBeTruthy();
    expect(screen.getByText('585.00')).toBeTruthy();
  });
});

describe('MyPayslipsPage', () => {
  it('asks for the password before any amount, then shows the payslip', async () => {
    let verified = false;
    state.request.mockImplementation((input?: { path?: string }) => {
      const path = input?.path;
      if (path === 'talent/my-payslips')
        return Promise.resolve({
          data: {
            verified,
            months: [
              { month: '2026-08', net: verified ? 585 : null, viewedAt: null },
            ],
          },
        });
      if (path === 'talent/my-payslips/verify') {
        verified = true;
        return Promise.resolve({ data: { verified: true } });
      }
      if (path === 'talent/my-payslips/2026-08')
        return Promise.resolve({
          data: { month: '2026-08', lines: LINES, ...TOTALS },
        });
      return Promise.resolve({
        data: { enrolment: null, month: null, contributions: [] },
      });
    });
    render(
      <MemoryRouter initialEntries={['/talent/my-payslips']}>
        <MyPayslipsPage />
      </MemoryRouter>,
    );
    await screen.findByText(en.payroll.mine.verifyTitle);
    expect(screen.queryByText('585.00')).toBeNull();
    fireEvent.change(screen.getByLabelText(en.payroll.mine.password), {
      target: { value: 'secret' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: en.payroll.mine.verify }),
    );
    await waitFor(() => expect(screen.getByText('585.00')).toBeTruthy());
    expect(state.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/my-payslips/verify',
        json: { password: 'secret' },
      }),
    );
  });
});
