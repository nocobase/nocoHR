import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request, added, remote } = vi.hoisted(() => ({
  request: vi.fn(),
  added: vi.fn(),
  remote: { schemes: undefined as unknown },
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
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data: path === 'talent/performance/schemes' ? remote.schemes : undefined,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import {
  PerformanceCoefficientsCard,
  ReviewResultLabel,
} from '../../client/components/talent/performance-payroll';

const SCHEME = {
  id: 'perf-scheme-operator',
  title: '生产操作工考核方案',
  active: true,
  ratingScale: [
    { code: 'S', score: 5 },
    { code: 'A', score: 4 },
    { code: 'B', score: 3 },
    { code: 'C', score: 2 },
    { code: 'D', score: 1 },
  ],
  ratingCoefficients: { S: 1.5, A: 1.2, B: 1, C: 0.7, D: 0 },
};

describe('V4-12 与薪酬的衔接 (client)', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ data: {} });
  });

  it('shows 绩效系数 only to those who maintain them, and saves a scheme’s coefficients', async () => {
    remote.schemes = { schemes: [SCHEME], can: { manageCoefficients: false } };
    const { container, unmount } = render(
      <MemoryRouter>
        <PerformanceCoefficientsCard />
      </MemoryRouter>,
    );
    expect(container.textContent).toBe('');
    unmount();
    remote.schemes = { schemes: [SCHEME], can: { manageCoefficients: true } };
    render(
      <MemoryRouter>
        <PerformanceCoefficientsCard />
      </MemoryRouter>,
    );
    expect(screen.getByText('performance.coefficients.title')).toBeTruthy();
    const a = screen.getByLabelText('A') as HTMLInputElement;
    expect(a.value).toBe('1.2');
    fireEvent.change(a, { target: { value: '1.3' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'performance.common.save' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          path: 'talent/performance/schemes/perf-scheme-operator/coefficients',
          json: { coefficients: { S: 1.5, A: 1.3, B: 1, C: 0.7, D: 0 } },
        }),
      ),
    );
  });

  it('shows an approver the linked result as “周期名称 · 最终等级” only', () => {
    render(
      <ReviewResultLabel
        value={{ cycleTitle: '2026 年度考核', finalRating: 'A' }}
      />,
    );
    expect(screen.getByText(/2026 年度考核 · A/u)).toBeTruthy();
    const { container } = render(<ReviewResultLabel value={null} />);
    expect(container.textContent).toBe('');
  });
});
