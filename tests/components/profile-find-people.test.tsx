import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => ({ request }),
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values ? `${key}|${JSON.stringify(values)}` : key,
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: vi.fn() },
}));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [],
    positions: [],
    departmentTitle: (id: string) => (id === 'sz' ? '苏州工厂' : id),
    positionTitle: (id: string) => id,
  }),
}));
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data:
      path === 'talent/find-people/lookups'
        ? {
            departments: [{ id: 'sz', title: '苏州工厂' }],
            positions: [],
            certifications: [{ id: 'cert-cnc', title: 'CNC 岗位上岗证' }],
            competencies: [
              { id: 'comp-cnc', title: 'CNC 设备操作', maxLevel: 5 },
            ],
          }
        : undefined,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import Page from '../../client/pages/talent/find-people/index';

const CONDITIONS = {
  departmentIds: ['sz'],
  positionIds: [],
  certifications: [{ certificationId: 'cert-cnc', status: 'valid' }],
  competencies: [{ competencyId: 'comp-cnc', minLevel: 4, maxLevel: null }],
  signals: { mode: 'none', types: ['qualityIssue'], withinDays: 180 },
  activeOnly: true,
};

describe('找人 (V3-11)', () => {
  beforeEach(() => request.mockReset());

  it('shows the conditions read from the sentence and the people with their reasons', async () => {
    request.mockResolvedValue({
      data: {
        conditions: CONDITIONS,
        labels: [],
        results: [
          {
            employeeId: 'emp-profile-guqiang',
            name: '顾强',
            employeeNo: 'QH2091',
            departmentTitle: '机加工车间',
            positionTitle: 'CNC 操作工',
            reasons: [
              '在机加工车间',
              'CNC 设备操作 4 级',
              '近 180 天没有质量问题记录',
            ],
          },
        ],
        strictest: null,
        parsedBy: 'rules',
      },
    });
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    fireEvent.change(
      screen.getByPlaceholderText('talent.insights.findPeople.placeholder'),
      {
        target: {
          value:
            '苏州工厂持 CNC 岗位上岗证、近半年没有质量问题、CNC 设备操作 4 级以上的人',
        },
      },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /talent.insights.findPeople.search/u,
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
          path: 'talent/find-people/parse',
        }),
      ),
    );
    expect(await screen.findByText('顾强')).toBeInTheDocument();
    expect(screen.getByText('CNC 设备操作 4 级')).toBeInTheDocument();
    // The condition chip names the department.
    expect(
      screen
        .getAllByText(/苏州工厂/u)
        .some((e) => e.closest('[data-slot="badge"]')),
    ).toBe(true);
    expect(
      screen.getByLabelText('talent.insights.findPeople.minLevel'),
    ).toHaveValue(4);
  });

  it('searches again with edited conditions and names the strictest one when nobody matches', async () => {
    request
      .mockResolvedValueOnce({
        data: {
          conditions: CONDITIONS,
          labels: [],
          results: [],
          strictest: null,
          parsedBy: 'rules',
        },
      })
      .mockResolvedValueOnce({
        data: {
          conditions: {
            ...CONDITIONS,
            competencies: [
              { competencyId: 'comp-cnc', minLevel: 5, maxLevel: null },
            ],
          },
          labels: [],
          results: [],
          strictest: { label: 'CNC 设备操作 ≥ 5 级', passing: 0 },
        },
      });
    render(
      <MemoryRouter>
        <Page />
      </MemoryRouter>,
    );
    fireEvent.change(
      screen.getByPlaceholderText('talent.insights.findPeople.placeholder'),
      {
        target: { value: 'CNC 设备操作 4 级以上' },
      },
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: /talent.insights.findPeople.search/u,
      }),
    );
    const min = await screen.findByLabelText(
      'talent.insights.findPeople.minLevel',
    );
    fireEvent.change(min, { target: { value: '5' } });
    fireEvent.click(
      screen.getByRole('button', { name: 'talent.insights.findPeople.rerun' }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenLastCalledWith(
        expect.objectContaining({
          path: 'talent/find-people/search',
          json: {
            conditions: expect.objectContaining({
              competencies: [
                { competencyId: 'comp-cnc', minLevel: 5, maxLevel: null },
              ],
            }),
          },
        }),
      ),
    );
    expect(await screen.findByText(/CNC 设备操作 ≥ 5 级/u)).toBeInTheDocument();
  });
});
