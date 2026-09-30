import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { DataTable } from '@/components/data-table';
import { adjustmentSummary } from '@/components/talent/attendance/adjustment-text';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { RequestStatusBadge } from '@/components/talent/attendance/badges';
import { dateTimeLabel } from '@/components/talent/attendance/dates';
import type {
  Adjustment,
  AdjustmentType,
} from '@/components/talent/attendance/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';

/**
 * One adjustment tab: 待我处理 (`view=todo`, the requests whose current step
 * is mine) or, for approvers, 本范围 (`view=scope`, everything I may approve
 * or read). A row opens `adjustments/:id` over this page.
 */
export function AdjustmentApprovals({
  type,
  revision,
}: {
  type: AdjustmentType;
  revision: number;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const approve = useCan({
    resource: { type: 'composite', id: 'talent.adjustment' },
    action: 'approve',
  });
  const scope = approve.can && params.get('view') === 'scope';
  const list = useRemote<Adjustment[]>('talent/adjustments', {
    view: scope ? 'scope' : 'todo',
    type,
    refresh: location.key,
    revision,
  });
  return (
    <div className='grid gap-3'>
      {approve.can ? (
        <Label className='flex w-fit items-center gap-2 font-normal'>
          <Switch
            checked={scope}
            onCheckedChange={(checked) => {
              const next = new URLSearchParams(params);
              if (checked) next.set('view', 'scope');
              else next.delete('view');
              setParams(next, { replace: true });
            }}
          />
          {t('attendance.adjustments.scopeToggle')}
        </Label>
      ) : null}
      {list.error && !list.data ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.length ? (
        <EmptyState
          title={t(
            scope
              ? 'attendance.adjustments.emptyScope'
              : 'attendance.adjustments.emptyTodo',
          )}
          description={t('attendance.adjustments.emptyDescription')}
        />
      ) : (
        <>
          {list.loading ? <Spinner aria-label={t('status.loading')} /> : null}
          <DataTable
            data={list.data}
            getRowId={(row) => row.id}
            pageSize={10}
            columns={[
              {
                accessorKey: 'employeeName',
                header: t('attendance.adjustments.fields.employee'),
                cell: ({ row }) => (
                  <Link
                    className='font-medium text-primary underline-offset-4 hover:underline'
                    to={{
                      pathname:
                        'adjustments/' + encodeURIComponent(row.original.id),
                      search: location.search,
                    }}
                  >
                    {row.original.employeeName ||
                      t('attendance.adjustments.unknown')}
                    <span className='block text-sm font-normal text-muted-foreground'>
                      {row.original.employeeNo}
                    </span>
                  </Link>
                ),
              },
              {
                accessorKey: 'date',
                header: t('attendance.adjustments.fields.date'),
              },
              {
                id: 'summary',
                header: t('attendance.adjustments.fields.summary'),
                cell: ({ row }) =>
                  adjustmentSummary(row.original, t, i18n.language, zone),
              },
              {
                accessorKey: 'status',
                header: t('attendance.adjustments.fields.status'),
                cell: ({ row }) => (
                  <RequestStatusBadge status={row.original.status} />
                ),
              },
              {
                accessorKey: 'createdAt',
                header: t('attendance.adjustments.fields.createdAt'),
                cell: ({ row }) =>
                  dateTimeLabel(row.original.createdAt, i18n.language, zone),
              },
            ]}
          />
        </>
      )}
    </div>
  );
}
