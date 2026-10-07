import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key} ${JSON.stringify(values)}` : key,
  }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));

import {
  SuccessionCandidateTable,
  type SuccessionCandidate,
} from '../../client/pages/talent/succession/candidate-table';

const LONG_NOTE =
  '与岗位要求的差距：客户关系管理（1/2）、制动系统产品知识（2/3）、报价与合同管理（1/3）；已有发展记录：学习计划（待确认）、学习计划（已确认）、学习计划（已过期）';

const candidate = (
  overrides: Partial<SuccessionCandidate>,
): SuccessionCandidate => ({
  employeeId: 'emp-gao',
  name: '高原',
  departmentTitle: '销售部',
  readiness: null,
  source: 'ai',
  note: LONG_NOTE,
  left: false,
  currentGaps: [],
  latestRating: 'A',
  developmentPlanId: null,
  ...overrides,
});

function renderTable(requirementsSet: boolean) {
  return render(
    <MemoryRouter>
      <SuccessionCandidateTable
        candidates={[candidate({})]}
        requirementsSet={requirementsSet}
        canManage
        readinessOf={(c) => c.readiness}
        onReadiness={vi.fn()}
        onRemove={vi.fn()}
      />
    </MemoryRouter>,
  );
}

describe('SuccessionCandidateTable', () => {
  it('wraps a long note in its own cell and keeps 移除 in a narrow column of its own', () => {
    renderTable(true);
    const note = screen.getByText(LONG_NOTE).closest('td')!;
    expect(note.dataset.column).toBe('note');
    expect(note.className).toContain('whitespace-normal');
    expect(note.className).toContain('break-words');
    expect(note.className).toContain('min-w-48');
    const button = screen.getByRole('button', {
      name: 'talentReview.common.remove',
    });
    const actions = button.closest('td')!;
    expect(actions).not.toBe(note);
    expect(actions.dataset.column).toBe('actions');
    expect(actions.className).toContain('w-0');
    expect(button.className).toContain('shrink-0');
    expect(within(actions).queryByText(LONG_NOTE)).toBeNull();
  });

  it('a position without requirements shows that gaps cannot be compared, not “meets”', () => {
    renderTable(false);
    expect(
      screen.getByText('talentReview.succession.noRequirements'),
    ).toBeTruthy();
    expect(screen.queryByText('talentReview.succession.noGap')).toBeNull();
  });

  it('a position with requirements and no gap still reads “meets”', () => {
    renderTable(true);
    expect(screen.getByText('talentReview.succession.noGap')).toBeTruthy();
  });
});
