import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { DataTable } from '@/components/data-table';
import { DataTableColumnHeader } from '@/components/data-table-column-header';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { today } from '@/components/talent/attendance/dates';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { LeaveError } from '../feedback.js';
import type { LeaveBalance } from '../types.js';
import { useLeaveList } from '../use-list.js';
import { HrLeaveDrafts } from './hr-drafts.js';

export default function LeaveBalancesPage() {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [currentYear] = useState(() => Number(today(zone).slice(0, 4)));
  const year = Number(params.get('year') || currentYear);
  const validYear =
    Number.isInteger(year) && year >= 1900 && year <= 2200 ? year : currentYear;
  const [yearDraft, setYearDraft] = useState(String(validYear));
  const [previousYear, setPreviousYear] = useState(validYear);
  if (previousYear !== validYear) {
    setPreviousYear(validYear);
    setYearDraft(String(validYear));
  }
  const [query, setQuery] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'adjustBalance',
  });
  // 初始数据导入: opening balances from Excel, a child page (./import.tsx).
  const importGrant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'importBalances',
  });
  const list = useLeaveList<LeaveBalance>(
    `talent/leave/balances?year=${validYear}`,
  );
  const context = useMemo(
    () => ({ saved: list.saved, reload: list.reload }),
    [list.saved, list.reload],
  );
  const columns = useMemo<ColumnDef<LeaveBalance>[]>(
    () => [
      {
        accessorKey: 'employeeName',
        enableHiding: false,
        header: ({ column }) => (
          <DataTableColumnHeader
            column={column}
            title={t('attendance.leave.fields.employee')}
          />
        ),
        cell: ({ row }) => (
          <>
            <Link
              className='font-medium underline-offset-4 hover:underline'
              to={{ pathname: row.original.id, search: location.search }}
            >
              {row.original.employeeName}
            </Link>
            <div className='text-xs text-muted-foreground'>
              {row.original.employeeNo}
            </div>
            {row.original.needsCareerStartDate ? (
              <Badge variant='outline'>
                {t('attendance.leave.missingCareer')}
              </Badge>
            ) : null}
            {row.original.frozen ? (
              <Badge variant='outline'>{t('attendance.leave.frozen')}</Badge>
            ) : null}
          </>
        ),
      },
      {
        accessorKey: 'leaveTypeTitle',
        enableHiding: false,
        header: t('attendance.leave.fields.title'),
      },
      ...(
        [
          'entitled',
          'carriedOver',
          'used',
          'pending',
          'adjusted',
          'available',
        ] as const
      ).map((key): ColumnDef<LeaveBalance> => ({
        accessorKey: key,
        enableHiding: false,
        header: () => (
          <div className='text-right'>
            {t(`attendance.leave.fields.${key}`)}
          </div>
        ),
        cell: ({ row }) => (
          <div className='text-right tabular-nums'>
            {new Intl.NumberFormat(i18n.language, {
              maximumFractionDigits: 4,
            }).format(row.original[key])}
          </div>
        ),
      })),
    ],
    [t, i18n.language, location.search],
  );
  const rows = list.rows?.filter((row) =>
    `${row.employeeName} ${row.employeeNo} ${row.leaveTypeTitle}`
      .toLocaleLowerCase()
      .includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          <Label htmlFor='leave-year'>
            {t('attendance.leave.fields.year')}
          </Label>
          <Input
            id='leave-year'
            type='number'
            className='w-28'
            value={yearDraft}
            min={1900}
            max={2200}
            onChange={(e) => setYearDraft(e.target.value)}
            onBlur={() => {
              const value = Number(yearDraft);
              if (Number.isInteger(value) && value >= 1900 && value <= 2200) {
                const next = new URLSearchParams(params);
                next.set('year', String(value));
                setParams(next);
              } else setYearDraft(String(validYear));
            }}
          />
          <Input
            ref={searchRef}
            className='w-full sm:w-72'
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('attendance.leave.searchBalances')}
            aria-label={t('attendance.leave.searchBalances')}
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
        {importGrant.can ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={
              <Link to={{ pathname: 'import', search: location.search }} />
            }
          >
            {t('dataImport.openBalances')}
          </Button>
        ) : null}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('attendance.leave.balanceNote')}
      </p>
      <HrLeaveDrafts />
      {list.error ? (
        <LeaveError error={list.error} retry={list.reload} />
      ) : !rows ? (
        <BlockSkeleton rows={5} />
      ) : !list.rows?.length ? (
        <EmptyState
          title={t('attendance.leave.emptyBalances')}
          description={t('attendance.leave.emptyBalancesDescription')}
          action={
            grant.can ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={{ pathname: 'initialize', search: location.search }}
                  />
                }
              >
                {t('attendance.leave.initialize')}
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
