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
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values && 'total' in values ? `${key}:${String(values.total)}` : key,
  }),
  useLocale: () => ({ locale: 'zh-CN' }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));

const CYCLE = {
  cycleId: 'cycle-1',
  cycleTitle: '2026 年度考核',
  cycleStatus: 'goalSetting',
  periodStart: '2026-01-01',
  periodEnd: '2026-12-31',
  deadline: '2026-10-02',
  resultId: 'result-1',
  resultStatus: 'inProgress',
  closedReason: null,
  published: false,
  schemeTitle: '生产操作工考核方案',
  noAccount: false,
  goals: { draft: 2, submitted: 0, approved: 0, aiDrafts: 2 },
  selfReview: null,
  peerTasks: 0,
  peers: null,
  evidence: null,
};
const GOALS = {
  goals: [
    {
      id: 'goal-1',
      cycleId: 'cycle-1',
      employeeId: 'emp-wanglei',
      departmentId: null,
      title: '本人负责工序全年无 major 及以上质量问题',
      measure: '质量系统中本人 major 质量问题 0 起',
      weight: 60,
      alignedGoalId: 'dept-goal',
      progress: 0,
      progressNotes: [],
      status: 'draft',
      source: 'ai',
      returnNote: null,
    },
    {
      id: 'goal-2',
      cycleId: 'cycle-1',
      employeeId: 'emp-wanglei',
      departmentId: null,
      title: '按期完成必修学习',
      measure: '必修学习按期完成率不低于 95%',
      weight: 40,
      alignedGoalId: null,
      progress: 0,
      progressNotes: [],
      status: 'draft',
      source: 'ai',
      returnNote: null,
    },
  ],
  departmentGoals: [
    {
      id: 'dept-goal',
      title: '全年无 critical 质量问题，major 质量问题不超过 2 起',
      measure: '—',
    },
  ],
  totalWeight: 100,
};
const RESULT = {
  resultId: 'result-0',
  cycleId: 'cycle-0',
  cycleTitle: '2025 年度考核',
  finalRating: 'B',
  ratingDescription: '良好',
  managerComment: '全年首件检验记录完整（目标记录）。',
  peers: { count: 0, averageScore: null, entries: [] },
  status: 'published',
  publishedAt: '2026-01-20T00:00:00.000Z',
  appeal: null,
  appealDeadline: '2026-01-27',
  can: { acknowledge: true, appeal: true },
};

vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data:
      path === 'talent/performance/me'
        ? { employeeId: 'emp-wanglei', cycles: [CYCLE] }
        : path === 'talent/performance/me/tasks'
          ? []
          : path === 'talent/performance/me/results'
            ? [RESULT]
            : path === 'talent/performance/me/goals'
              ? GOALS
              : undefined,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import MyReviewPage from '../../client/pages/talent/performance/my-review';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <MyReviewPage />
    </MemoryRouter>,
  );
}

describe('我的考核 (V4-12)', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
    request.mockResolvedValue({ data: {} });
  });

  it('lists the AI goal drafts with the department goal they align to, and submits them', async () => {
    renderAt('/talent/my-review');
    expect(screen.getByText('performance.goals.aiDraftsHint')).toBeTruthy();
    expect(
      screen.getByText('本人负责工序全年无 major 及以上质量问题'),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/全年无 critical 质量问题/u).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('performance.goals.total:100')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.goals.submit' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: 'talent/performance/goals/submit',
          json: { cycleId: 'cycle-1' },
        }),
      ),
    );
  });

  it('shows a published result with the manager’s comment, and acknowledges it', async () => {
    renderAt('/talent/my-review?tab=result');
    expect(screen.getByText('2025 年度考核')).toBeTruthy();
    expect(screen.getByText('B')).toBeTruthy();
    expect(screen.getByText('全年首件检验记录完整（目标记录）。')).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.my.acknowledge' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: 'talent/performance/results/result-0/acknowledge',
        }),
      ),
    );
  });

  it('appeals with a reason', async () => {
    renderAt('/talent/my-review?tab=result');
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.my.appeal' }),
    );
    fireEvent.change(screen.getByLabelText('performance.my.appealReason'), {
      target: { value: '设备原因' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.my.appealSubmit' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/performance/results/result-0/appeal',
          json: { reason: '设备原因' },
        }),
      ),
    );
  });

  it('stacks its actions for a phone: full-width tabs and buttons', () => {
    renderAt('/talent/my-review?tab=result');
    const acknowledge = screen.getByRole('button', {
      name: 'performance.my.acknowledge',
    });
    expect(acknowledge.className).toContain('w-full');
    expect(screen.getByRole('tablist').className).toContain('w-full');
  });
});
