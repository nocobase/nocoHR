import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ColumnDef } from '@tanstack/react-table';
import { LockIcon, MoreHorizontalIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { DataTable } from '@/components/data-table';
import { SummaryStatusBadge } from '@/components/talent/attendance/badges';
import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import type {
  AttendanceEmployee,
  MonthlySummary,
} from '@/components/talent/attendance/types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { NoteDialog } from '@/components/talent/attendance/note-dialog';

const SUMMARY_STATUSES = ['draft', 'confirmed', 'locked'] as const;
const sum = (values: Record<string, number>) =>
  Math.round(Object.values(values).reduce((a, b) => a + b, 0) * 100) / 100;

type Pending =
  | { kind: 'unlock'; row: MonthlySummary }
  | { kind: 'handle'; row: MonthlySummary }
  | { kind: 'confirm'; row: MonthlySummary };

/**
 * 月报: one summary per employee and month. HR selects and 锁定 them for
 * payroll; 解锁 needs a reason; an open objection is 处理 with a result
 * (which recomputes the summary); 代为确认 is for employees without an
 * account, whose summary HR confirms.
 */
export function MonthlyTab({
  month,
  departmentId,
  status,
  onStatus,
  refresh,
  canLock,
  canUnlock,
}: {
  month: string;
  departmentId: string;
  status: string;
  onStatus: (value: string) => void;
  refresh: string;
  canLock: boolean;
  canUnlock: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<{
    employees: AttendanceEmployee[];
    summaries: MonthlySummary[];
  }>('talent/attendance/monthly', {
    month,
    departmentId: departmentId || undefined,
    status: SUMMARY_STATUSES.includes(status as never) ? status : undefined,
    refresh,
  });
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  if (remote.error && !remote.data)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={6} />;
  const employees = new Map(remote.data.employees.map((e) => [e.id, e]));
  const nameOf = (row: MonthlySummary) =>
    employees.get(row.employeeId)?.name ?? '—';

  const lock = async (ids: string[], done: () => void) => {
    if (busy || !ids.length) return;
    setBusy(true);
    try {
      const response = await api.request<{
        data: { locked: string[]; refused: { id: string; code: string }[] };
      }>({
        method: 'POST',
        path: 'talent/attendance/summaries/lock',
        json: { ids },
      });
      const { locked, refused } = response.data;
      toast.add({
        type: refused.length ? 'error' : 'success',
        title: t('attendance.board.lockResult', {
          locked: locked.length,
          refused: refused.length,
        }),
        description: refused.length
          ? refused
              .map((item) => {
                const row = remote.data?.summaries.find(
                  (s) => s.id === item.id,
                );
                return t('attendance.board.refusedItem', {
                  name: row ? nameOf(row) : item.id,
                  reason: t(`attendance.errors.${item.code}`),
                });
              })
              .join('\n')
          : undefined,
      });
      done();
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: attendanceErrorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  };

  const act = async (item: Pending, text: string) => {
    const id = encodeURIComponent(item.row.id);
    const path =
      item.kind === 'unlock'
        ? `talent/attendance/summaries/${id}/unlock`
        : item.kind === 'handle'
          ? `talent/attendance/summaries/${id}/handle`
          : `talent/attendance/summaries/${id}/confirm`;
    await api.request({
      method: 'POST',
      path,
      json:
        item.kind === 'unlock'
          ? { reason: text }
          : item.kind === 'handle'
            ? { result: text }
            : undefined,
    });
    toast.add({
      type: 'success',
      title: t(`attendance.board.done.${item.kind}`, {
        name: nameOf(item.row),
      }),
    });
    remote.reload();
  };

  const columns: ColumnDef<MonthlySummary>[] = [
    ...(canLock
      ? [
          {
            id: 'select',
            header: ({ table }) => (
              <Checkbox
                checked={table.getIsAllPageRowsSelected()}
                indeterminate={
                  table.getIsSomePageRowsSelected() &&
                  !table.getIsAllPageRowsSelected()
                }
                onCheckedChange={(checked) =>
                  table.toggleAllPageRowsSelected(checked)
                }
                aria-label={t('attendance.board.selectAll')}
              />
            ),
            cell: ({ row }) => (
              <Checkbox
                checked={row.getIsSelected()}
                disabled={row.original.status === 'locked'}
                onCheckedChange={(checked) => row.toggleSelected(checked)}
                aria-label={t('attendance.board.selectRow', {
                  name: nameOf(row.original),
                })}
              />
            ),
            enableSorting: false,
          } satisfies ColumnDef<MonthlySummary>,
        ]
      : []),
    {
      id: 'employee',
      header: t('attendance.board.columns.employee'),
      accessorFn: (row) => nameOf(row),
      cell: ({ row }) => (
        <div className='min-w-24'>
          <span className='block font-medium'>{nameOf(row.original)}</span>
          <span className='block text-xs text-muted-foreground'>
            {employees.get(row.original.employeeId)?.employeeNo ?? ''}
          </span>
        </div>
      ),
    },
    {
      id: 'days',
      header: t('attendance.board.columns.days'),
      cell: ({ row }) =>
        `${row.original.workedDays} / ${row.original.scheduledDays}`,
    },
    {
      id: 'exceptions',
      header: t('attendance.board.columns.exceptions'),
      cell: ({ row }) =>
        t('attendance.board.exceptionsValue', {
          late: row.original.lateCount,
          early: row.original.earlyCount,
          missing: row.original.missingCount,
          absent: row.original.absentDays,
        }),
    },
    {
      id: 'leave',
      header: t('attendance.board.columns.leaveDays'),
      cell: ({ row }) => sum(row.original.leaveByType),
    },
    {
      id: 'overtime',
      header: t('attendance.board.columns.overtimeHours'),
      cell: ({ row }) => sum(row.original.overtimeByType),
    },
    {
      accessorKey: 'nightShiftCount',
      header: t('attendance.board.columns.nights'),
    },
    {
      accessorKey: 'status',
      header: t('attendance.board.columns.status'),
      cell: ({ row }) => (
        <div className='flex flex-col items-start gap-1'>
          <SummaryStatusBadge status={row.original.status} />
          {row.original.objection ? (
            <span className='text-xs text-muted-foreground'>
              {row.original.objection.handledBy
                ? t('attendance.board.objectionHandled')
                : t('attendance.board.objectionOpen')}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'objection',
      header: t('attendance.board.columns.objection'),
      cell: ({ row }) =>
        row.original.objection ? (
          <div className='max-w-56 text-sm'>
            <p className='break-words whitespace-pre-wrap'>
              {row.original.objection.note}
            </p>
            {row.original.objection.result ? (
              <p className='text-muted-foreground'>
                {t('attendance.board.resultLabel', {
                  result: row.original.objection.result,
                })}
              </p>
            ) : null}
          </div>
        ) : (
          '—'
        ),
    },
    {
      id: 'actions',
      header: () => (
        <span className='sr-only'>{t('attendance.board.columns.actions')}</span>
      ),
      cell: ({ row }) => {
        const summary = row.original;
        const openObjection = Boolean(
          summary.objection && !summary.objection.handledBy,
        );
        const items = [
          canLock && openObjection && summary.status !== 'locked'
            ? ('handle' as const)
            : null,
          canLock && summary.confirmBy === 'hr' && summary.status === 'draft'
            ? ('confirm' as const)
            : null,
          canUnlock && summary.status === 'locked' ? ('unlock' as const) : null,
        ].filter((item) => item !== null);
        if (!items.length) return null;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('attendance.board.moreFor', {
                    name: nameOf(summary),
                  })}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              {items.map((kind) => (
                <DropdownMenuItem
                  key={kind}
                  onClick={() => setPending({ kind, row: summary })}
                >
                  {t(`attendance.board.actions.${kind}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className='grid gap-3'>
      {remote.loading ? <Spinner aria-label={t('status.loading')} /> : null}
      <DataTable
        data={remote.data.summaries}
        getRowId={(row) => row.id}
        pageSize={20}
        emptyMessage={t('attendance.board.noSummaries')}
        columns={columns}
        toolbar={(table) => {
          const ids = table
            .getSelectedRowModel()
            .rows.filter((row) => row.original.status !== 'locked')
            .map((row) => row.original.id);
          return (
            <div className='flex flex-wrap items-center gap-2'>
              <NativeSelect
                aria-label={t('attendance.filters.status')}
                value={status}
                onChange={(event) => onStatus(event.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('attendance.filters.allStatuses')}
                </NativeSelectOption>
                {SUMMARY_STATUSES.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {t(`attendance.summaryStatus.${value}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {canLock ? (
                <Button
                  size='sm'
                  disabled={busy || !ids.length}
                  onClick={() =>
                    void lock(ids, () => table.resetRowSelection())
                  }
                >
                  {busy ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <LockIcon data-icon='inline-start' />
                  )}
                  {t('attendance.board.lockSelected', { count: ids.length })}
                </Button>
              ) : null}
            </div>
          );
        }}
      />
      {pending ? (
        <NoteDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={t(`attendance.board.dialogs.${pending.kind}.title`, {
            name: nameOf(pending.row),
            month: pending.row.month,
          })}
          description={t(
            `attendance.board.dialogs.${pending.kind}.description`,
          )}
          label={
            pending.kind === 'confirm'
              ? undefined
              : t(`attendance.board.dialogs.${pending.kind}.label`)
          }
          confirmLabel={t(`attendance.board.actions.${pending.kind}`)}
          onSubmit={(text) => act(pending, text)}
        >
          {pending.kind === 'handle' && pending.row.objection ? (
            <p className='rounded-lg bg-muted p-3 text-sm whitespace-pre-wrap'>
              {pending.row.objection.note}
            </p>
          ) : null}
        </NoteDialog>
      ) : null}
    </div>
  );
}
