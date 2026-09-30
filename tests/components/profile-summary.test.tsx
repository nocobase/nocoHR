import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added, remote } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
  remote: { canRegenerate: true },
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data: path?.endsWith('/summary')
      ? {
          employeeId: 'emp-wanglei',
          summary:
            'CNC 岗位上岗证：有效；岗位要求的能力均已达标。近 12 个月业务数据：质量问题（首件检验） 1 条。',
          generatedAt: '2026-10-05T01:00:00.000Z',
          canRegenerate: remote.canRegenerate,
          sentences: [
            {
              text: 'CNC 岗位上岗证：有效；岗位要求的能力均已达标。',
              evidence: [
                {
                  id: '0-0',
                  type: 'certificate',
                  refId: 'c1',
                  label: 'CNC 岗位上岗证：有效',
                },
              ],
            },
            {
              text: '近 12 个月业务数据：质量问题（首件检验） 1 条。',
              evidence: [
                {
                  id: '1-0',
                  type: 'signal',
                  refId: 's1',
                  label: '质量问题（首件检验） 1 条',
                },
              ],
            },
          ],
        }
      : path?.endsWith('/timeline')
        ? [
            {
              kind: 'signal',
              at: '2026-07-11T03:00:00.000Z',
              title: 'QI-2026-0412 停机后未做首件检验即批量加工',
              detail: '质量问题 · 首件检验 · major',
              competencyId: 'comp-cnc',
              competencyTitle: 'CNC 设备操作',
              link: 'https://qms.example.test/issues/QI-2026-0412',
              signalId: 's1',
              signalType: 'qualityIssue',
            },
            {
              kind: 'course',
              at: '2026-05-01T00:00:00.000Z',
              title: 'CNC 岗位操作入门',
              detail: null,
              competencyId: null,
              competencyTitle: null,
              link: null,
              signalId: null,
              signalType: null,
            },
          ]
        : undefined,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import { BusinessTimeline } from '../../client/components/talent/profile/business-timeline';
import { ProfileSummaryCard } from '../../client/components/talent/profile/profile-summary-card';

describe('AI 画像摘要 and the business-data timeline (V3-11)', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
    remote.canRegenerate = true;
    request.mockResolvedValue({ data: {} });
  });

  it('opens each sentence to its data and regenerates for those who may', async () => {
    render(<ProfileSummaryCard employeeId='emp-wanglei' />);
    expect(
      screen.getByText('talent.insights.common.aiGenerated', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.queryByText('CNC 岗位上岗证：有效')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getAllByRole('button', {
        name: 'talent.insights.profile.showEvidence',
      })[0],
    );
    expect(screen.getByText('CNC 岗位上岗证：有效')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: /talent.insights.profile.regenerate/u,
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: 'talent/profiles/emp-wanglei/summary/regenerate',
        }),
      ),
    );
  });

  it('shows oneself the summary without the regenerate button', () => {
    remote.canRegenerate = false;
    render(<ProfileSummaryCard employeeId='me' />);
    expect(
      screen.queryByRole('button', {
        name: /talent.insights.profile.regenerate/u,
      }),
    ).not.toBeInTheDocument();
  });

  it('lists business records with their competency and source link, not other entries', () => {
    render(
      <MemoryRouter>
        <BusinessTimeline employeeId='me' />
      </MemoryRouter>,
    );
    expect(
      screen.getByText('QI-2026-0412 停机后未做首件检验即批量加工'),
    ).toBeInTheDocument();
    expect(screen.getByText(/CNC 设备操作/u)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /talent.insights.common.openRecord/u }),
    ).toHaveAttribute('href', 'https://qms.example.test/issues/QI-2026-0412');
    expect(screen.queryByText('CNC 岗位操作入门')).not.toBeInTheDocument();
  });
});
