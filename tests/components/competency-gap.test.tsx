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
import zh from '../../client/locales/zh-CN';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  locale: 'zh-CN',
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
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

import { ActionCompetencyGap } from '../../client/components/talent/competency-gap-block';
import { TargetGapCards } from '../../client/components/talent/competency-view';
import { GapTable } from '../../client/components/talent/gap-table';
import { CandidatesPanel } from '../../client/pages/talent/framework/candidates';

const row = (overrides: Record<string, unknown>) => ({
  competencyId: 'c',
  code: 'c',
  title: 'C',
  category: 'skill',
  maxLevel: 5,
  requiredLevel: 2,
  mandatory: true,
  currentLevel: 0,
  assessed: true,
  gap: 2,
  levels: [],
  ...overrides,
});

describe('V3-08 gap table', () => {
  beforeEach(() => {
    state.locale = 'zh-CN';
  });

  it('marks an unassessed competency 未评定 and keeps an assessment of 0 as 0', () => {
    render(
      <GapTable
        rows={[
          row({ competencyId: 'a', title: '安全生产与 5S', assessed: false }),
          row({ competencyId: 'b', title: '质量记录规范', assessed: true }),
        ]}
      />,
    );
    const unassessed = screen.getByText('安全生产与 5S').closest('tr')!;
    expect(within(unassessed).getByText('未评定')).toBeTruthy();
    const zero = screen.getByText('质量记录规范').closest('tr')!;
    expect(within(zero).queryByText('未评定')).toBeNull();
    expect(within(zero).getAllByText('0').length).toBeGreaterThan(0);
  });

  it('shows the target position comparison in English without Chinese wording', () => {
    state.locale = 'en-US';
    const { container } = render(
      <TargetGapCards
        targets={[
          {
            id: 't1',
            targetPositionId: 'p',
            targetPositionTitle: 'Solution manager',
            reason: null,
            createdAt: '2026-09-29T00:00:00.000Z',
            rows: [row({ title: 'Quotation', assessed: false, gap: 3 })],
            summary: { mandatoryGaps: 1, totalGap: 3, unassessedMandatory: 1 },
          },
        ]}
      />,
    );
    expect(screen.getByText('Target position comparison')).toBeTruthy();
    expect(screen.getByText('Not assessed')).toBeTruthy();
    expect(container.textContent).not.toMatch(/[一-鿿]/u);
  });
});

describe('V3-08 transfer reference block', () => {
  beforeEach(() => {
    state.locale = 'zh-CN';
    state.api.request.mockReset();
  });

  it('lists requirements only when the approver may not see assessments', async () => {
    state.api.request.mockResolvedValue({
      data: {
        positionId: 'pos-assembler',
        positionTitle: '装配工',
        levelsVisible: false,
        rows: [
          {
            competencyId: 'comp-safety',
            title: '安全生产与 5S',
            category: 'skill',
            requiredLevel: 2,
            currentLevel: null,
            assessed: null,
            gap: null,
          },
        ],
      },
    });
    render(<ActionCompetencyGap actionId='action-1' />);
    await screen.findByText('安全生产与 5S');
    expect(state.api.request.mock.calls[0][0].path).toBe(
      'talent/competency/actions/action-1/gap',
    );
    expect(
      screen.getByText(zh.talent.competencyExt.actionGap.levelsHidden),
    ).toBeTruthy();
    expect(screen.queryByText(zh.talent.gap.current)).toBeNull();
  });

  it('renders nothing for an action without a target position', async () => {
    state.api.request.mockResolvedValue({ data: null });
    const { container } = render(<ActionCompetencyGap actionId='action-2' />);
    await waitFor(() => expect(state.api.request).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});

describe('V3-08 candidates panel', () => {
  beforeEach(() => {
    state.locale = 'zh-CN';
    state.api.request.mockReset().mockResolvedValue({ data: {} });
  });

  it('shows each candidate’s gap and cancels a target', async () => {
    const reload = vi.fn();
    render(
      <MemoryRouter>
        <CandidatesPanel
          position={{
            id: 'p',
            code: 'sales-solution-manager',
            title: '销售解决方案经理',
            jobFamilyId: 'jf-sales',
            grade: 'S3',
            responsibilities: null,
            aiDraftedAt: null,
            active: true,
            sortOrder: 0,
          }}
          list={{
            loading: false,
            error: undefined,
            reload,
            data: {
              canManage: true,
              items: [
                {
                  id: 't1',
                  employeeId: 'e1',
                  employeeName: '高原',
                  employeeNo: 'QH5101',
                  currentPositionTitle: '销售工程师',
                  departmentTitle: '销售部',
                  createdByName: '程远',
                  reason: '新设岗位拟任',
                  status: 'active',
                  summary: {
                    mandatoryGaps: 1,
                    totalGap: 3,
                    unassessedMandatory: 1,
                  },
                },
              ],
            },
          }}
        />
      </MemoryRouter>,
    );
    const line = screen.getByText('高原').closest('tr')!;
    expect(within(line).getByText('1 / 3')).toBeTruthy();
    expect(within(line).getByText('1 项必备未评定')).toBeTruthy();
    fireEvent.click(within(line).getByRole('button', { name: '取消' }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(state.api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/competency/targets/t1/cancel',
        method: 'POST',
      }),
    );
  });
});
