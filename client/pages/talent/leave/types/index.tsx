import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { DataTable } from '@/components/data-table';
import { DataTableColumnHeader } from '@/components/data-table-column-header';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { LeaveError } from '../feedback.js';
import type { LeaveType } from '../types.js';
import { useLeaveList } from '../use-list.js';

export default function LeaveTypesPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'manageTypes',
  });
  const list = useLeaveList<LeaveType>('talent/leave/types');
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const context = useMemo(
    () => ({ saved: list.saved, reload: list.reload }),
    [list.saved, list.reload],
  );
  const columns = useMemo<ColumnDef<LeaveType>[]>(
    () => [
      {
        accessorKey: 'title',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('attendance.leave.fields.title')}
          />
        ),
        cell: ({ row }) => (
          <Link
            className='font-medium underline-offset-4 hover:underline'
            to={{
              pathname: `${row.original.id}/edit`,
              search: location.search,
            }}
          >
            {row.original.title}
            <span className='block text-xs text-muted-foreground'>
              {row.original.code}
            </span>
          </Link>
        ),
      },
      ...(['payType', 'unit', 'balanceRule', 'countBy'] as const).map(
        (key): ColumnDef<LeaveType> => ({
          accessorKey: key,
          enableHiding: false,
          header: t(`attendance.leave.fields.${key}`),
          cell: ({ row }) => (
            <Badge variant='secondary'>
              {t(`attendance.leave.enums.${row.original[key]}`)}
            </Badge>
          ),
        }),
      ),
      {
        accessorKey: 'fixedDays',
        enableHiding: false,
        header: () => (
          <div className='text-right'>
            {t('attendance.leave.fields.fixedDays')}
          </div>
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {row.original.fixedDays === null
              ? '—'
              : new Intl.NumberFormat(i18n.language).format(
                  row.original.fixedDays,
                )}
          </div>
        ),
      },
      {
        accessorKey: 'requiresAttachment',
        enableHiding: false,
        header: t('attendance.leave.fields.requiresAttachment'),
        cell: ({ row }) =>
          t(
            `attendance.leave.${row.original.requiresAttachment ? 'yes' : 'no'}`,
          ),
      },
      {
        accessorKey: 'active',
        enableHiding: false,
        header: t('attendance.leave.fields.active'),
        cell: ({ row }) => (
          <Badge variant='outline'>
            {t(
              `attendance.leave.${row.original.active ? 'active' : 'inactive'}`,
            )}
          </Badge>
        ),
      },
    ],
    [t, i18n.language, location.search],
  );
  const rows = list.rows?.filter((row) =>
    `${row.title} ${row.code}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Input
            ref={searchRef}
            className='w-full sm:w-72'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('attendance.leave.searchTypes')}
            aria-label={t('attendance.leave.searchTypes')}
          />
          {query ? (
            <Button
              variant='ghost'
              onClick={() => {
                setQuery('');
                searchRef.current?.focus();
              }}
            >
              {t('attendance.leave.clear')}
            </Button>
          ) : null}
          {list.loading && list.rows ? <Spinner /> : null}
        </div>
      </div>
      {list.error ? (
        <LeaveError error={list.error} retry={list.reload} />
      ) : !rows ? (
        <BlockSkeleton rows={5} />
      ) : !list.rows?.length ? (
        <EmptyState
          title={t('attendance.leave.emptyTypes')}
          description={t('attendance.leave.emptyTypesDescription')}
          action={
            grant.can ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'new', search: location.search }} />
                }
              >
                {t('attendance.leave.createType')}
              </Button>
            ) : null
          }
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          emptyMessage={
            <div>
              {t('attendance.leave.noResults')}
              <Button
                variant='ghost'
                onClick={() => {
                  setQuery('');
                  searchRef.current?.focus();
                }}
              >
                {t('attendance.leave.clear')}
              </Button>
            </div>
          }
        />
      )}
      {list.truncated ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.leave.cap')}
        </p>
      ) : null}
      <Outlet context={context} />
    </>
  );
}
