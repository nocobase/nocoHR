import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));

import { PerformanceReviewForm } from '../../client/components/talent/performance-review-form';
import type { ReviewContext } from '../../client/components/talent/performance-shared';

const DRAFT_COMMENT =
  '考核期内 2 起质量问题（QI-2026-0301 major、QI-2026-0457 major）（质量系统）；必修学习 3/3 按期完成（学习任务）。';

function context(
  overrides: Partial<ReviewContext['review']> = {},
): ReviewContext {
  return {
    review: {
      id: 'review-1',
      role: 'manager',
      status: 'notStarted',
      items: {},
      overallRating: null,
      overallReason: null,
      comment: null,
      aiDraft: {
        comment: DRAFT_COMMENT,
        itemSuggestions: {
          goals: [{ goalId: 'goal-1', comment: '进度 60%（目标记录）' }],
          competencies: [
            {
              competencyId: 'comp-cnc',
              comment: '当前等级 L3，岗位要求 L3（能力评定）',
            },
          ],
          qualitySafety: { score: 2, comment: '参考分 2（质量系统）' },
        },
        evidenceRefs: [{ type: 'signal', id: 's1', label: 'QI-2026-0301' }],
        generatedAt: '2026-11-01T00:00:00.000Z',
        source: 'rule',
      },
      hints: null,
      submissionCount: 0,
      submittedAt: null,
      activeSeconds: 0,
      editable: true,
      ...overrides,
    },
    cycle: {
      id: 'cycle-1',
      title: '2026 年度考核',
      status: 'managerReview',
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      deadline: '2026-12-20',
    },
    employee: {
      id: 'emp-qianjin',
      name: '钱进',
      departmentTitle: '机加工车间',
    },
    scheme: {
      id: 'scheme-1',
      title: '生产操作工考核方案',
      sections: [
        { key: 'goals', weight: 30 },
        { key: 'competencies', weight: 40 },
        { key: 'qualitySafety', weight: 30 },
      ],
      ratingScale: [
        { code: 'S', score: 5, description: '卓越' },
        { code: 'A', score: 4, description: '优秀' },
        { code: 'B', score: 3, description: '良好' },
        { code: 'C', score: 2, description: '待改进' },
        { code: 'D', score: 1, description: '不合格' },
      ],
      scoring: { overrideReasonDelta: 1, ratingReasonGap: 2 },
    },
    goals: [
      {
        id: 'goal-1',
        cycleId: 'cycle-1',
        employeeId: 'emp-qianjin',
        departmentId: null,
        title: '首件检验记录完整',
        measure: '首件检验记录完整率 100%',
        weight: 100,
        alignedGoalId: null,
        progress: 60,
        progressNotes: [],
        status: 'approved',
        source: 'manual',
        returnNote: null,
      },
    ],
    evidence: { snapshot: null, summary: null },
    requirements: [
      {
        competencyId: 'comp-cnc',
        title: 'CNC 设备操作',
        requiredLevel: 3,
        maxLevel: 5,
        currentLevel: 3,
      },
    ],
    selfReview: null,
    peers: { count: 0, averageScore: null, entries: [] },
    reference: {
      computedScore: 2,
      band: 'C',
      bandRange: { from: 1.5, to: 2.5 },
      qualityReference: 2,
      dimensions: {},
    },
  };
}

describe('PerformanceReviewForm (V4-12 评价表)', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
    request.mockResolvedValue({ data: {} });
  });

  it('shows the AI draft card but leaves the form empty until 采用到评价表', () => {
    render(
      <MemoryRouter>
        <PerformanceReviewForm context={context()} onSaved={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByText('performance.review.aiDraft')).toBeTruthy();
    expect(screen.getByText(DRAFT_COMMENT)).toBeTruthy();
    const comment = screen.getByLabelText(
      'performance.review.comment',
    ) as HTMLTextAreaElement;
    expect(comment.value).toBe('');
    expect(
      (
        screen.getByLabelText(
          'performance.review.overallRatingRequired',
        ) as HTMLSelectElement
      ).value,
    ).toBe('');
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.review.adopt' }),
    );
    expect(comment.value).toBe(DRAFT_COMMENT);
    // The item notes come along; the rating stays the reviewer's.
    expect(
      (document.getElementById('goal-comment-goal-1') as HTMLTextAreaElement)
        .value,
    ).toBe('进度 60%（目标记录）');
    expect(
      (
        screen.getByLabelText(
          'performance.review.overallRatingRequired',
        ) as HTMLSelectElement
      ).value,
    ).toBe('');
    // Each item can still be changed.
    fireEvent.change(comment, {
      target: { value: `${DRAFT_COMMENT}补充：带教新人 2 名。` },
    });
    expect(comment.value).toContain('补充');
  });

  it('submits the form with the reviewer’s rating and reason', async () => {
    const saved = vi.fn();
    render(
      <MemoryRouter>
        <PerformanceReviewForm context={context()} onSaved={saved} />
      </MemoryRouter>,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.review.adopt' }),
    );
    fireEvent.change(
      screen.getByLabelText('performance.review.overallRatingRequired'),
      { target: { value: 'A' } },
    );
    fireEvent.change(
      screen.getByLabelText('performance.review.overallReason'),
      { target: { value: '承担带教' } },
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.review.submit' }),
    );
    await waitFor(() => expect(saved).toHaveBeenCalled());
    const call = request.mock.calls.find(([options]) =>
      String(options.path).endsWith('/submit'),
    );
    expect(call?.[0]).toMatchObject({
      method: 'POST',
      path: 'talent/performance/reviews/review-1/submit',
      json: {
        overallRating: 'A',
        overallReason: '承担带教',
        comment: DRAFT_COMMENT,
      },
    });
    expect(call?.[0].json.items.qualitySafety.score).toBe(2);
  });

  it('shows the assistant’s hints of the latest submission and offers to submit again', () => {
    render(
      <MemoryRouter>
        <PerformanceReviewForm
          context={context({
            status: 'submitted',
            submissionCount: 1,
            overallRating: 'A',
            comment: DRAFT_COMMENT,
            hints: {
              submission: 1,
              items: [
                {
                  type: 'ratingVsScore',
                  text: '总评 A 与参考分 2（对应 C 档）相差 2 档，请核对评分依据。',
                },
                {
                  type: 'highRatingLowQuality',
                  text: '总评等级较高，但质量与安全参考分为 2。',
                },
              ],
              at: '2026-11-02T00:00:00.000Z',
            },
          })}
          onSaved={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('performance.review.hintsTitle')).toBeTruthy();
    expect(screen.getByText(/相差 2 档/u)).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'performance.review.resubmit' }),
    ).toBeTruthy();
  });

  it('gives a peer neither the draft, the competencies nor the quality section', () => {
    render(
      <MemoryRouter>
        <PerformanceReviewForm
          context={{
            ...context({ role: 'peer', aiDraft: null }),
            requirements: [],
          }}
          onSaved={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('performance.review.aiDraft')).toBeNull();
    expect(screen.queryByText('performance.review.qualitySafety')).toBeNull();
    expect(
      screen.getByLabelText('performance.review.overallRating'),
    ).toBeTruthy();
    expect(screen.getByText('performance.review.peerCommentHint')).toBeTruthy();
  });
});
