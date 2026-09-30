import { ApiClientError } from '@nocobase/app-client';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const DEFAULTS = {
  dueSoonDays: 3,
  planExpiryDays: 14,
  checkInOpensMinutes: 30,
  minWatchPercent: 90,
  onboardingBackfillDays: 30,
};
vi.mock('../../client/components/talent/use-remote', () => ({
  useRemote: (path: string | null) => ({
    data:
      path === 'talent/learning-settings'
        ? { value: DEFAULTS, defaults: DEFAULTS, revision: 0, updatedAt: null }
        : undefined,
    loading: false,
    reload: () => undefined,
  }),
}));

import Page from '../../client/pages/settings/learning/index';

describe('learning rules (设置 · 学习规则)', () => {
  beforeEach(() => {
    request.mockReset();
    added.mockReset();
  });

  it('saves the rules at the revision read', async () => {
    request.mockResolvedValue({
      data: {
        value: { ...DEFAULTS, dueSoonDays: 5 },
        defaults: DEFAULTS,
        revision: 1,
        updatedAt: null,
      },
    });
    render(<Page />);
    fireEvent.change(
      screen.getByLabelText(/learningSettings.rules.dueSoonDays/u),
      { target: { value: '5' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'talent/learning-settings',
          method: 'PUT',
          json: { revision: 0, value: { ...DEFAULTS, dueSoonDays: 5 } },
        }),
      ),
    );
    await waitFor(() => expect(added).toHaveBeenCalled());
  });

  it('refuses a value out of range without submitting', async () => {
    render(<Page />);
    fireEvent.change(
      screen.getByLabelText(/learningSettings.rules.minWatchPercent/u),
      { target: { value: '5' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    expect(
      await screen.findByText('learningSettings.invalidRange'),
    ).toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });

  it('offers a reload after another administrator saved first', async () => {
    request.mockRejectedValue(
      new ApiClientError('conflict', {
        status: 409,
        code: 'SETTINGS_CONFLICT',
        payload: { code: 'SETTINGS_CONFLICT' },
        method: 'PUT',
        url: '/api/talent/learning-settings',
      }),
    );
    render(<Page />);
    fireEvent.change(
      screen.getByLabelText(/learningSettings.rules.planExpiryDays/u),
      { target: { value: '20' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'actions.save' }));
    expect(
      await screen.findByText('learningSettings.conflict'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'learningSettings.reload' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actions.save' })).toBeDisabled();
  });
});
