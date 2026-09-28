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
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: () => ({
    data: {
      reminders: {
        revision: 0,
        value: { probationDays: 15, contractDays: [60, 30] },
      },
      probation: { revision: 0, value: { maxMonths: 6 } },
    },
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
            value: { probationDays: 20, contractDays: [90, 30] },
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
});
