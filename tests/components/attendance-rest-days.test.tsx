import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// 每周休息日 on 设置 / 考勤设置 · 节假日与调休: Saturday and Sunday by default, editable, and at least one workday kept.
const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
}));
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, args: Record<string, unknown> = {}) => {
      let result: unknown = en;
      for (const segment of key.split('.'))
        result =
          result && typeof result === 'object'
            ? (result as Record<string, unknown>)[segment]
            : undefined;
      return typeof result === 'string'
        ? result.replace(/\{\{(\w+)\}\}/gu, (_, token: string) =>
            String(args[token] ?? ''),
          )
        : key;
    },
  }),
}));
vi.mock('../../client/components/ui/toast', () => ({
  toast: { add: state.toast },
}));

import { ConfigCard } from '../../client/pages/settings/attendance/config-card';

beforeEach(() => {
  state.api.request.mockReset();
  state.toast.mockReset();
});

const writes = () =>
  state.api.request.mock.calls.map(([o]) => o).filter((o) => o.method);

describe('weekly rest days', () => {
  it('shows Saturday and Sunday for a calendar saved before rest days existed, and saves a six-day week', async () => {
    state.api.request.mockImplementation(
      async (options: { method?: string; json?: { value: unknown } }) =>
        options.method
          ? { data: { revision: 1, value: options.json!.value } }
          : { data: { revision: 0, value: { years: [] } } },
    );
    render(<ConfigCard section='calendar' />);
    const saturday = await screen.findByRole('checkbox', { name: 'Saturday' });
    expect(saturday).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Sunday' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Monday' })).not.toBeChecked();
    fireEvent.click(saturday);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0].json.value).toEqual({ years: [], weeklyRestDays: [0] });
  });

  it('refuses a week without a workday', async () => {
    state.api.request.mockResolvedValue({
      data: {
        revision: 0,
        value: { years: [], weeklyRestDays: [0, 1, 2, 3, 4, 5] },
      },
    });
    render(<ConfigCard section='calendar' />);
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Saturday' }));
    expect(
      await screen.findByText(en.attendance.settings.invalidRestDays),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(writes()).toHaveLength(0);
  });
});
