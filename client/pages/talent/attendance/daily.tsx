import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { DataTable } from '@/components/data-table';
import {
  ExcusedBadge,
  RecordStatusBadge,
} from '@/components/talent/attendance/badges';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { clock } from '@/components/talent/attendance/dates';
import type {
  AttendanceEmployee,
  AttendanceRecord,
} from '@/components/talent/attendance/types';
import { useLookups } from '@/components/talent/use-lookups';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

const RECORD_STATUSES = [
  'normal',
  'late',
  'earlyLeave',
  'missingPunch',
  'absent',
  'leave',
  'rest',
] as const;

const minutes = (value: number | null) => (value ? String(value) : '—');
const hours = (value: number | null) =>
  value == null ? '—' : String(Math.round((value / 60) * 10) / 10);

/** 日报: every employee's day — status, punches, lateness and hours. */
export function DailyTab({
  from,
  to,
  departmentId,
  status,
  onStatus,
  refresh,
}: {
  from: string;
  to: string;
  departmentId: string;
  status: string;
  onStatus: (value: string) => void;
  refresh: string;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const lookups = useLookups();
  const remote = useRemote<{
    employees: AttendanceEmployee[];
    records: AttendanceRecord[];
    truncated?: boolean;
  }>('talent/attendance/daily', {
    from,
    to,
    departmentId: departmentId || undefined,
    status: RECORD_STATUSES.includes(status as never) ? status : undefined,
    refresh,
  });
  if (remote.error && !remote.data)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={6} />;
  const employees = new Map(remote.data.employees.map((e) => [e.id, e]));
  return (
    <div className='grid gap-3'>
      {remote.loading ? <Spinner aria-label={t('status.loading')} /> : null}
      <DataTable
        data={remote.data.records}
        getRowId={(row) => row.id}
        pageSize={20}
        emptyMessage={t('attendance.board.noRecords')}
        toolbar={() => (
          <NativeSelect
            aria-label={t('attendance.filters.status')}
            value={status}
            onChange={(event) => onStatus(event.target.value)}
          >
            <NativeSelectOption value=''>
              {t('attendance.filters.allStatuses')}
            </NativeSelectOption>
            {RECORD_STATUSES.map((value) => (
              <NativeSelectOption key={value} value={value}>
                {t(`attendance.recordStatus.${value}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        columns={[
          {
            id: 'employee',
            header: t('attendance.board.columns.employee'),
            accessorFn: (row) => employees.get(row.employeeId)?.name ?? '',
            cell: ({ row }) => {
              const employee = employees.get(row.original.employeeId);
              return (
                <div className='min-w-24'>
                  <span className='block font-medium'>
                    {employee?.name ?? '—'}
                  </span>
                  <span className='block text-xs text-muted-foreground'>
                    {employee
                      ? `${employee.employeeNo} · ${lookups.departmentTitle(employee.departmentId)}`
                      : ''}
                  </span>
                </div>
              );
            },
          },
          { accessorKey: 'date', header: t('attendance.board.columns.date') },
          {
            accessorKey: 'status',
            header: t('attendance.board.columns.status'),
            cell: ({ row }) => (
              <span className='flex flex-wrap items-center gap-1'>
                <RecordStatusBadge status={row.original.status} />
                {row.original.excusedByAdjustmentId ? <ExcusedBadge /> : null}
              </span>
            ),
          },
          {
            id: 'punches',
            header: t('attendance.board.columns.punches'),
            cell: ({ row }) =>
              `${clock(row.original.checkIn, i18n.language, zone)} / ${clock(row.original.checkOut, i18n.language, zone)}`,
          },
          {
            id: 'late',
            header: t('attendance.board.columns.lateEarly'),
            cell: ({ row }) =>
              `${minutes(row.original.lateMinutes)} / ${minutes(row.original.earlyMinutes)}`,
          },
          {
            id: 'worked',
            header: t('attendance.board.columns.worked'),
            cell: ({ row }) => hours(row.original.workedMinutes),
          },
          {
            id: 'overtime',
            header: t('attendance.board.columns.overtime'),
            cell: ({ row }) => hours(row.original.overtimeMinutes),
          },
        ]}
      />
      {remote.data.truncated ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.board.truncated')}
        </p>
      ) : null}
    </div>
  );
}
