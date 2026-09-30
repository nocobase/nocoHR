import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

// The browser runs in New York; the application's business zone is Shanghai.
process.env.TZ = 'America/New_York';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  toast: vi.fn(),
  reload: vi.fn(),
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

import AttendanceImportPage from '../../client/pages/talent/attendance/import';

const preview = {
  rows: [
    {
      row: 2,
      employeeNo: 'E001',
      name: 'Li Min',
      at: '2026-09-28T06:12:00.000Z',
      employeeId: 'e1',
      errors: [],
    },
    {
      row: 3,
      employeeNo: 'E999',
      name: 'Nobody',
      at: '2026-09-28T06:00:00.000Z',
      employeeId: null,
      errors: ['EMPLOYEE_NOT_FOUND'],
    },
    {
      row: 4,
      employeeNo: '',
      name: null,
      at: null,
      employeeId: null,
      errors: ['EMPLOYEE_NO_REQUIRED', 'PUNCH_TIME_INVALID'],
    },
  ],
  valid: 1,
  invalid: 2,
};

function mount() {
  return render(
    <MemoryRouter initialEntries={['/talent/attendance/import?tab=daily']}>
      <Routes>
        <Route
          path='/talent/attendance'
          element={<Outlet context={{ reload: state.reload }} />}
        >
          <Route path='import' element={<AttendanceImportPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('attendance punch import', () => {
  beforeEach(() => {
    state.toast.mockReset();
    state.reload.mockReset();
    state.api.request.mockReset();
  });

  it('previews every row with its errors before importing only the valid ones', async () => {
    const sent: { path: string; body?: FormData }[] = [];
    state.api.request.mockImplementation(
      async (options: { path: string; body?: FormData }) => {
        if (options.path === 'talent/app-time')
          return { data: { timeZone: 'Asia/Shanghai', today: '2026-09-29' } };
        sent.push(options);
        if (options.path === 'talent/attendance/import/preview')
          return { data: preview };
        if (options.path === 'talent/attendance/import')
          return { data: { imported: 1, computed: 2, skippedLocked: 0 } };
        throw new Error(`unexpected ${options.path}`);
      },
    );
    mount();
    const file = new File(['xlsx'], 'punches.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    await userEvent.upload(await screen.findByLabelText('Punch file'), file);

    expect(
      await screen.findByText('1 valid rows, 2 with errors'),
    ).toBeInTheDocument();
    const table = screen.getByRole('table');
    const rows = within(table).getAllByRole('row');
    expect(rows[2]).toHaveTextContent('E999');
    expect(rows[2]).toHaveTextContent('Employee number not found');
    expect(rows[3]).toHaveTextContent('Employee number missing');
    expect(rows[3]).toHaveTextContent('Invalid punch time');
    expect(rows[1]).toHaveTextContent('OK');
    // 06:12Z is 2:12 PM in Shanghai (2:12 AM in New York).
    expect(rows[1]).toHaveTextContent(/Sep 28, 2026, 2:12\sPM/u);
    expect(sent[0].body?.get('file')).toBe(file);

    // With errors, importing everything is refused; skipping them is offered.
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    await userEvent.click(
      screen.getByRole('button', { name: 'Skip 2 error rows and import' }),
    );
    await waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1].path).toBe('talent/attendance/import');
    expect(sent[1].body?.get('skipInvalid')).toBe('true');
    expect(sent[1].body?.get('file')).toBe(file);
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title:
          '1 punches imported, 2 days computed, 0 skipped in locked months.',
      }),
    );
  });
});
