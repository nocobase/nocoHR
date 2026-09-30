import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
      values && 'count' in values ? `${key}:${String(values.count)}` : key,
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));

const SUGGESTION = {
  id: 'sug-1',
  employeeId: 'emp-qianjin',
  employeeName: '钱进',
  employeeNo: 'QH2003',
  departmentTitle: '机加工车间',
  competencyId: 'comp-cnc',
  competencyTitle: 'CNC 设备操作',
  currentLevel: 3,
  suggestedLevel: 2,
  rationale:
    '近 180 天内有 2 起 major 质量问题；也可能存在非个人原因（如夜班）。',
  evidence: [
    { type: 'signal', id: 's1', summary: 'QI-2026-0301 首件检验 major' },
    { type: 'signal', id: 's2', summary: 'QI-2026-0457 首件检验 major' },
  ],
  reviewerName: '陈静',
  status: 'draft',
  decidedLevel: null,
  reviewedByName: null,
  reviewedAt: null,
  reviewNote: null,
  createdAt: '2026-10-05T01:00:00.000Z',
};
const RECOMMENDATION = {
  id: 'rec-1',
  departmentId: 'sz-mc',
  departmentTitle: '机加工车间',
  competencyId: 'comp-cnc',
  competencyTitle: 'CNC 设备操作',
  reason: '机加工车间近 90 天内发生 2 起首件检验问题。',
  evidence: [
    { signalId: 's3', externalId: 'QI-2026-0412', summary: '首件检验 · major' },
    {
      signalId: 's2',
      externalId: 'QI-2026-0457',
      summary: '首件检验 · major · 夜班',
    },
  ],
  audience: [
    {
      employeeId: 'emp-wanglei',
      name: '王磊',
      employeeNo: 'QH2001',
      reason: '岗位要求',
      assignments: 0,
      completed: 0,
    },
    {
      employeeId: 'emp-liuyang',
      name: '刘洋',
      employeeNo: 'QH2004',
      reason: '岗位要求',
      assignments: 0,
      completed: 0,
    },
  ],
  items: [
    { type: 'course', id: 'course-cnc-intro', title: 'CNC 岗位操作入门' },
    { type: 'exam', id: 'exam-cnc-cert', title: 'CNC 上岗考试' },
  ],
  dueDate: '2026-10-20',
  correctiveActionRefs: ['8D-2026-0088'],
  reviewerName: '陈静',
  status: 'draft',
  reviewedByName: null,
  reviewNote: null,
  completedAt: null,
  hasProof: false,
  writebackStatus: null,
  writebackError: null,
  createdAt: '2026-10-05T01:00:00.000Z',
};

vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data:
      path === 'talent/decisions/counts'
        ? { suggestions: 1, recommendations: 1, learningPlans: 0 }
        : path === 'talent/competency-suggestions'
          ? { items: [SUGGESTION], can: { accept: true, reject: true } }
          : path === 'talent/training-recommendations'
            ? {
                items: [RECOMMENDATION],
                can: { approve: true, reject: true, retryWriteback: false },
              }
            : undefined,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import Page from '../../client/pages/talent/decisions/index';

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Page />
    </MemoryRouter>,
  );
}

describe('待我决定 (V3-11)', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
    request.mockResolvedValue({ data: {} });
  });

  it('shows a level suggestion with its evidence and accepts it at the level the head decides', async () => {
    renderAt('/talent/decisions?tab=suggestions');
    expect(screen.getByText('钱进 · CNC 设备操作')).toBeInTheDocument();
    expect(screen.getByText('QI-2026-0301 首件检验 major')).toBeInTheDocument();
    expect(screen.getByText(/夜班/u)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'talent.insights.decisions.suggestion.accept',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByLabelText(
        'talent.insights.decisions.suggestion.level',
      ),
      {
        target: { value: '3' },
      },
    );
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'talent.insights.decisions.suggestion.accept',
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: 'talent/competency-suggestions/sug-1/accept',
          json: { level: 3, note: null },
        }),
      ),
    );
  });

  it('asks for a reason before rejecting', async () => {
    renderAt('/talent/decisions?tab=suggestions');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'talent.insights.decisions.suggestion.reject',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', {
      name: 'talent.insights.decisions.suggestion.reject',
    });
    expect(confirm).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText(
        'talent.insights.decisions.suggestion.rejectReason',
      ),
      {
        target: { value: '设备原因' },
      },
    );
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({ json: { reason: '设备原因' } }),
      ),
    );
  });

  it('approves a targeted training without the people the head removed', async () => {
    renderAt('/talent/decisions?tab=recommendations');
    expect(
      screen.getByText('8D-2026-0088', { exact: false }),
    ).toBeInTheDocument();
    const liuyang = screen.getByText('刘洋').closest('li')!;
    fireEvent.click(
      within(liuyang).getByRole('button', {
        name: 'talent.insights.decisions.recommendation.remove',
      }),
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'talent.insights.decisions.recommendation.approve',
      }),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(
      within(dialog).getByRole('button', {
        name: 'talent.insights.decisions.recommendation.approve',
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/training-recommendations/rec-1/approve',
          json: { removeEmployeeIds: ['emp-liuyang'], note: null },
        }),
      ),
    );
  });
});
