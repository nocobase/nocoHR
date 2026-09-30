import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

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

const shift = (id: string, code: string, title: string) => ({
  id,
  code,
  title,
  startTime: '06:00:00',
  endTime: '14:00:00',
  breakMinutes: 0,
  isNight: false,
  active: true,
  departmentIds: null,
  updatedAt: '2026-09-29T00:00:00.000Z',
});
const meta = { truncated: false };
const catalog = {
  shifts: {
    data: [
      shift('s1', 'mc-early', 'Early'),
      shift('s2', 'mc-middle', 'Middle'),
      shift('s3', 'mc-night', 'Night'),
    ],
    meta,
  },
  rules: { data: [], meta },
  departments: { data: [], meta },
};
const template = {
  key: 'three-shift-weekly',
  title: 'Three shifts',
  shiftCodes: ['mc-early', 'mc-middle'],
  periodDays: 7,
  workDays: 5,
};

describe('rotation templates card', () => {
  let patches: unknown[];
  beforeEach(() => {
    patches = [];
    state.toast.mockReset();
    state.api.request.mockReset();
    state.api.request.mockImplementation(
      async (options: { path: string; method?: string; json?: never }) => {
        if (options.path === 'talent/attendance-settings')
          return { data: catalog };
        if (options.path === 'talent/attendance-settings/config/rotations') {
          if (options.method === 'PATCH') {
            patches.push(options.json);
            const body = options.json as { value: unknown; revision: number };
            return { data: { value: body.value, revision: body.revision + 1 } };
          }
          return { data: { value: { templates: [template] }, revision: 2 } };
        }
        throw new Error(`unexpected ${options.path}`);
      },
    );
  });

  it('checks the key, keeps the shift order and saves with the revision read', async () => {
    render(
      <MemoryRouter>
        <ConfigCard section='rotations' />
      </MemoryRouter>,
    );
    const add = await screen.findByRole('combobox', { name: 'Add a shift' });
    await waitFor(() => expect(add).toContainHTML('Night（mc-night）'));
    // Chosen shifts are not offered twice.
    expect(add).not.toContainHTML('mc-early');
    await userEvent.selectOptions(add, 'mc-night');
    expect(screen.getByText('3. Night')).toBeInTheDocument();

    const key = screen.getByLabelText(/^Key/u);
    await userEvent.clear(key);
    await userEvent.type(key, '3shift');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'The key starts with a letter and uses up to 40 letters, digits, "_" or "-".',
      ),
    ).toBeInTheDocument();
    expect(patches).toHaveLength(0);

    await userEvent.clear(key);
    await userEvent.type(key, 'three-shift');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({
      revision: 2,
      value: {
        templates: [
          {
            ...template,
            key: 'three-shift',
            shiftCodes: ['mc-early', 'mc-middle', 'mc-night'],
          },
        ],
      },
    });
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });
});
