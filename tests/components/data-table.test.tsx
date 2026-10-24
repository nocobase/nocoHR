import type { ColumnDef } from '@tanstack/react-table';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';

// Outside an `I18nProvider` the runtime returns default values verbatim; interpolate them the way the application does.
vi.mock('@nocobase/i18n/client', () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: Record<string, unknown> & { defaultValue?: string },
    ) =>
      (options?.defaultValue ?? key).replace(/{{(\w+)}}/g, (_, name: string) =>
        String(options?.[name]),
      ),
  }),
}));

import {
  DataTable,
  DataTableColumnHeader,
} from '../../client/components/data-table/index.js';

interface Payment {
  id: string;
  email: string;
  amount: number;
}

const columns: ColumnDef<Payment, unknown>[] = [
  {
    accessorKey: 'email',
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title='Email' />
    ),
  },
  { accessorKey: 'amount', header: 'Amount' },
];

const payments: Payment[] = Array.from({ length: 12 }, (_, index) => ({
  id: String(index),
  email: `user${index}@example.com`,
  amount: index * 10,
}));

describe('DataTable', () => {
  it('renders headers and one page of rows', () => {
    render(<DataTable columns={columns} data={payments} />);

    expect(screen.getByRole('button', { name: 'Email' })).toBeInTheDocument();
    expect(
      screen.getByRole('columnheader', { name: 'Amount' }),
    ).toBeInTheDocument();
    expect(screen.getByText('user0@example.com')).toBeInTheDocument();
    expect(screen.queryByText('user10@example.com')).not.toBeInTheDocument();
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument();
  });

  it('renders every row when pagination is off', () => {
    render(<DataTable columns={columns} data={payments} pagination={false} />);

    expect(screen.getByText('user11@example.com')).toBeInTheDocument();
    expect(screen.queryByText(/Page 1 of/)).not.toBeInTheDocument();
  });

  it('shows the empty message when there is no data', () => {
    render(<DataTable columns={columns} data={[]} />);

    expect(screen.getByText('No results.')).toBeInTheDocument();
  });

  it('resets uncontrolled pagination when refreshed data gets shorter', async () => {
    const user = userEvent.setup();

    function UncontrolledTable() {
      const [data, setData] = useState(payments);

      return (
        <>
          <button onClick={() => setData(payments.slice(0, 3))}>
            Refresh rows
          </button>
          <DataTable columns={columns} data={data} pageSize={5} />
        </>
      );
    }

    render(<UncontrolledTable />);

    await user.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('user5@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh rows' }));

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 1')).toBeInTheDocument();
      expect(screen.getByText('user0@example.com')).toBeInTheDocument();
    });
  });

  it('keeps the controlled page when refreshed data changes', async () => {
    const user = userEvent.setup();

    function ControlledTable() {
      const [data, setData] = useState(payments);
      const [paginationState, setPaginationState] = useState({
        pageIndex: 1,
        pageSize: 5,
      });

      return (
        <>
          <button
            onClick={() =>
              setData(
                payments.map((payment) => ({
                  ...payment,
                  email: `refreshed-${payment.email}`,
                })),
              )
            }
          >
            Refresh rows
          </button>
          <DataTable
            columns={columns}
            data={data}
            pageSize={5}
            paginationState={paginationState}
            onPaginationChange={setPaginationState}
          />
        </>
      );
    }

    render(<ControlledTable />);

    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('user5@example.com')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Refresh rows' }));

    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
      expect(
        screen.getByText('refreshed-user5@example.com'),
      ).toBeInTheDocument();
    });
  });
});
