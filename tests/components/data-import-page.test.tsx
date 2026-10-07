import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { MemoryRouter, Outlet, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../../client/locales/en-US';

const state = vi.hoisted(() => ({
  api: { request: vi.fn() },
  show: vi.fn(),
  reload: vi.fn(),
}));
vi.mock('@nocobase/app-client', async (original) => ({
  ...(await original<typeof import('@nocobase/app-client')>()),
  useApiClient: () => state.api,
  useToaster: () => ({ show: state.show, close: vi.fn() }),
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

import ImportDepartmentsPage from '../../client/pages/settings/departments/import';

const row = (
  line: number,
  code: string,
  errors: { column: string; code: string }[] = [],
  action = 'create',
) => ({
  line,
  cells: {
    code,
    title: `Dept ${code}`,
    parentCode: '',
    managerNo: '',
    sortOrder: '',
  },
  errors,
  action,
});

function mount() {
  return render(
    <MemoryRouter initialEntries={['/settings/departments/import']}>
      <Routes>
        <Route
          path='/settings/departments'
          element={<Outlet context={{ reload: state.reload }} />}
        >
          <Route path='import' element={<ImportDepartmentsPage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe('department import page', () => {
  beforeEach(() => {
    state.api.request.mockReset();
    state.show.mockReset();
    state.reload.mockReset();
  });

  it('shows each row problem by column and blocks the import until the file is clean', async () => {
    state.api.request.mockResolvedValueOnce({
      data: {
        rows: [
          row(2, 'D1'),
          row(3, 'D2', [{ column: 'parentCode', code: 'DEPARTMENT_CYCLE' }]),
        ],
        created: 1,
        updated: 0,
        unchanged: 0,
      },
    });
    mount();
    const file = new File(['xlsx'], 'departments.xlsx');
    await userEvent.upload(await screen.findByLabelText('Upload a file'), file);
    expect(
      await screen.findByText(
        '1 of 2 rows have problems. Fix them in the file and upload it again.',
      ),
    ).toBeInTheDocument();
    const rows = within(screen.getByRole('table')).getAllByRole('row');
    expect(rows[2]).toHaveTextContent(
      'Parent department code：The parent chain would loop back to this department',
    );
    expect(rows[1]).toHaveTextContent('Create');
    expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled();
    expect(state.api.request).toHaveBeenCalledWith(
      expect.objectContaining({
        path: 'talent/data-import/departments/preview',
        method: 'POST',
      }),
    );
  });

  it('sends the previewed rows back and reports the batch', async () => {
    state.api.request
      .mockResolvedValueOnce({
        data: {
          rows: [row(2, 'D1'), row(3, 'D2', [], 'update')],
          created: 1,
          updated: 1,
          unchanged: 0,
        },
      })
      .mockResolvedValueOnce({
        data: { batchId: 'IMP-DEP-1', created: 1, updated: 1, unchanged: 0 },
      });
    mount();
    await userEvent.upload(
      await screen.findByLabelText('Upload a file'),
      new File(['xlsx'], 'departments.xlsx'),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Import' }),
    );
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    expect(state.api.request).toHaveBeenLastCalledWith({
      path: 'talent/data-import/departments/commit',
      method: 'POST',
      json: {
        rows: [
          { line: 2, cells: row(2, 'D1').cells },
          { line: 3, cells: row(3, 'D2').cells },
        ],
      },
    });
    expect(state.show).toHaveBeenCalledWith({
      type: 'success',
      title: 'Imported: 1 created, 1 updated, 0 unchanged.',
      description: 'Batch IMP-DEP-1',
    });
  });
});
