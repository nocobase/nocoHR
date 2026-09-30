import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../../client/locales/en-US';

// V2-07 用工计划: the three options with the server's numbers — overtime over the limit is shown not feasible and
// cannot be chosen — and the head's decision sends the chosen options.
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
      if (typeof result !== 'string')
        return typeof args.defaultValue === 'string' ? args.defaultValue : key;
      for (const [name, value] of Object.entries(args))
        result = (result as string).replaceAll(`{{${name}}}`, String(value));
      return result;
    },
  }),
}));

import WorkforcePlanDetail from '../../client/pages/talent/recruiting/workforce-plans/detail';

const PLAN = {
  id: 'plan-1',
  month: '2026-10',
  departmentTitle: '成都机加工车间',
  positionTitle: 'CNC 操作工',
  status: 'calculated',
  plannedOutput: 61600,
  aiSummary: '缺口 10 人。',
  decision: null,
  requisitionId: null,
  calculation: {
    headcount: 18,
    outputPerShift: 100,
    shiftsPerMonth: 22,
    hoursPerShift: 8,
    capacity: 39600,
    plannedOutput: 61600,
    currentOutput: 40000,
    gapHeadcount: 10,
    overtimeLimitHours: 36,
    recruitingCycleDays: 14,
    onboardingDays: 14,
    absorbedOvertimeHours: null,
    sources: { overtimeLimit: 'attendanceRule', onboarding: 'path' },
  },
  options: [
    {
      type: 'overtime',
      feasible: false,
      detail: { hoursPerPerson: 98, limitHours: 36 },
      risks: ['overLimit'],
      costNote: '现有 18 人每人每月约加班 98 小时',
      note: '不可行',
    },
    {
      type: 'transfer',
      feasible: true,
      detail: { maxHeadcount: 4, covers: false },
      risks: ['partialCover'],
      costNote: '最多可借调 4 人',
    },
    {
      type: 'hire',
      feasible: true,
      detail: { readyInWeeks: 4, readyInDays: 28 },
      risks: ['gapBeforeReady'],
      costNote: '约 4 周',
    },
  ],
  can: { decide: true, recalculate: true, settings: false },
};

beforeEach(() => state.request.mockReset());

describe('WorkforcePlanDetail', () => {
  it('shows the gap and the options, and sends the head’s choice', async () => {
    state.request.mockResolvedValue({ data: PLAN });
    render(
      <MemoryRouter initialEntries={['/talent/workforce-plans/plan-1']}>
        <Routes>
          <Route
            path='/talent/workforce-plans/:planId'
            element={<WorkforcePlanDetail />}
          />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText('39,600');
    expect(screen.getByText(en.recruiting.workforce.infeasible)).toBeTruthy();
    expect(
      screen.getByText(
        en.recruiting.workforce.hoursPerPerson
          .replace('{{hours}}', '98')
          .replace('{{limit}}', '36'),
      ),
    ).toBeTruthy();
    expect(screen.getByText(en.recruiting.labels.risk.overLimit)).toBeTruthy();
    const boxes = screen.getAllByRole('checkbox');
    // Overtime is not feasible, so it cannot be chosen.
    expect(
      boxes[0].getAttribute('aria-disabled') === 'true' ||
        boxes[0].hasAttribute('data-disabled'),
    ).toBe(true);
    fireEvent.click(boxes[1]);
    fireEvent.click(boxes[2]);
    fireEvent.click(
      screen.getByRole('button', { name: en.recruiting.workforce.decide }),
    );
    await waitFor(() =>
      expect(state.request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/recruiting/workforce-plans/plan-1/decide',
          json: { types: ['transfer', 'hire'], note: null },
        }),
      ),
    );
  });
});
