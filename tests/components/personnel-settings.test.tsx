import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
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
}));
vi.mock('../../client/components/ui/toast', () => ({ toast: { add: added } }));
const SETTINGS = {
  reminders: {
    revision: 0,
    value: { probationDays: 15, contractDays: [60, 30], dailyTime: '09:00' },
  },
  probation: { revision: 0, value: { maxMonths: 6 } },
  approvalChain: { revision: 0, value: { rules: [], mergeAdjacent: true } },
  selfService: {
    revision: 0,
    value: {
      fields: [
        'mobile',
        'email',
        'address',
        'educations',
        'experiences',
        'emergencyContacts',
      ],
    },
  },
  gradeOrder: { revision: 0, value: { families: {} } },
  jobInfo: {
    revision: 0,
    value: { importMayChangeJob: true, allowCorrection: true },
  },
};
const OPTIONS = {
  permissionSets: [{ key: 'hr.admin', title: 'HR 管理员' }],
  jobFamilies: [
    {
      id: 'jf-prod',
      title: '生产序列',
      active: true,
      grades: ['S1', 'S3', 'S4'],
    },
  ],
};
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data:
      path === 'talent/personnel-settings'
        ? SETTINGS
        : path === 'talent/personnel-settings/options'
          ? OPTIONS
          : undefined,
    loading: false,
    reload: () => undefined,
  }),
}));
vi.mock('../../client/components/talent/use-lookups', () => ({
  useLookups: () => ({
    departments: [
      {
        id: 'cd',
        title: '成都工厂',
        label: '成都工厂',
        parentId: null,
        active: true,
        depth: 0,
      },
    ],
    positions: [],
    departmentTitle: (id: string) => (id === 'cd' ? '成都工厂' : id),
    positionTitle: (id: string) => id,
    loading: false,
    error: undefined,
    reload: () => undefined,
  }),
}));

import Page from '../../client/pages/settings/personnel/index';

describe('personnel settings', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
  });

  it('saves only one section, preserving the other draft and accepting Chinese commas', async () => {
    request.mockResolvedValue({
      data: {
        revision: 1,
        value: { probationDays: 20, contractDays: [90, 30] },
      },
    });
    render(<Page />);
    const first = screen.getByLabelText(/personnelSettings.probationDays/u);
    const months = screen.getByLabelText(/personnelSettings.maxMonths/u);
    fireEvent.change(months, { target: { value: '3' } });
    fireEvent.change(first, { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText(/personnelSettings.contractDays/u), {
      target: { value: '90，30' },
    });
    fireEvent.click(
      within(first.closest('form')!).getByRole('button', {
        name: 'actions.save',
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/personnel-settings/reminders',
          method: 'PATCH',
          json: {
            revision: 0,
            value: {
              probationDays: 20,
              contractDays: [90, 30],
              dailyTime: '09:00',
            },
          },
        }),
      ),
    );
    await waitFor(() => expect(added).toHaveBeenCalled());
    expect(months).toHaveValue('3');
  });

  it('rejects duplicate windows and blank probation without submitting', async () => {
    render(<Page />);
    const windows = screen.getByLabelText(/personnelSettings.contractDays/u);
    fireEvent.change(windows, { target: { value: '30,30' } });
    fireEvent.click(
      within(windows.closest('form')!).getByRole('button', {
        name: 'actions.save',
      }),
    );
    expect(
      await screen.findByText('personnelSettings.invalidWindows'),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    const months = screen.getByLabelText(/personnelSettings.maxMonths/u);
    fireEvent.change(months, { target: { value: '' } });
    fireEvent.click(
      within(months.closest('form')!).getByRole('button', {
        name: 'actions.save',
      }),
    );
    expect(
      await screen.findByText('personnelSettings.invalidMonths'),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('keeps input on a failed save', async () => {
    request.mockRejectedValue(new Error('offline'));
    render(<Page />);
    const months = screen.getByLabelText(/personnelSettings.maxMonths/u);
    fireEvent.change(months, { target: { value: '4' } });
    fireEvent.click(
      within(months.closest('form')!).getByRole('button', {
        name: 'actions.save',
      }),
    );
    expect(
      await screen.findByText('personnelSettings.failed'),
    ).toBeInTheDocument();
    expect(months).toHaveValue('4');
  });

  it('adds a chain rule to the draft and saves the whole section once', async () => {
    request.mockResolvedValue({
      data: { revision: 1, value: { rules: [], mergeAdjacent: true } },
    });
    render(<Page />);
    expect(
      screen.getByText('personnelSettings.rulesEmpty'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: /personnelSettings.addRule/u }),
    );
    fireEvent.change(
      await screen.findByLabelText(/personnelSettings.ruleDepartment \*/u),
      { target: { value: 'cd' } },
    );
    fireEvent.change(screen.getByLabelText(/personnelSettings.ruleName \*/u), {
      target: { value: '厂长审批' },
    });
    fireEvent.change(
      screen.getByLabelText(/personnelSettings.approverDepartment/u),
      { target: { value: 'cd' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'talent.common.add' }));
    expect(await screen.findByText('厂长审批')).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
    const card = screen
      .getByText('personnelSettings.approvalChain.title')
      .closest('[data-slot="card"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: 'actions.save' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/personnel-settings/approvalChain',
          json: expect.objectContaining({
            revision: 0,
            value: expect.objectContaining({
              mergeAdjacent: true,
              rules: [
                expect.objectContaining({
                  departmentId: 'cd',
                  actionTypes: ['onboard'],
                  name: '厂长审批',
                  approver: { type: 'departmentHead', departmentId: 'cd' },
                  position: 'afterFirst',
                  enabled: true,
                }),
              ],
            }),
          }),
        }),
      ),
    );
  });

  it('asks to choose a department before previewing, and saves a job switch at once', async () => {
    request.mockResolvedValue({
      data: {
        revision: 1,
        value: { importMayChangeJob: false, allowCorrection: true },
      },
    });
    render(<Page />);
    expect(
      screen.getByText('personnelSettings.preview.idle'),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('switch', {
        name: 'personnelSettings.jobInfo.importMayChangeJob',
      }),
    );
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/personnel-settings/jobInfo',
          json: {
            revision: 0,
            value: { importMayChangeJob: false, allowCorrection: true },
          },
        }),
      ),
    );
  });
});
