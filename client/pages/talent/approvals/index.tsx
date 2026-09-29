import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet, useLocation } from 'react-router';
import { DataTable } from '@/components/data-table';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { LeaveError } from '../leave/feedback.js';
import type { LeaveApprovalRequest } from './types.js';

export default function ApprovalsPage() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'approve',
  });
  const data = useRemote<LeaveApprovalRequest[]>(
    grant.can ? 'talent/leave/approvals' : null,
    { refresh: location.key },
  );
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.approvals.title')}
        description={t('attendance.approvals.description')}
      />
      {grant.isPending ? (
        <BlockSkeleton rows={4} />
      ) : grant.error ? (
        <LeaveError error={grant.error} retry={grant.retry} />
      ) : !grant.can ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('attendance.leave.errors.forbidden')}
          </AlertDescription>
        </Alert>
      ) : data.error ? (
        <LeaveError error={data.error} retry={data.reload} />
      ) : !data.data ? (
        <BlockSkeleton rows={4} />
      ) : !data.data.length ? (
        <EmptyState
          title={t('attendance.approvals.empty')}
          description={t('attendance.approvals.emptyDescription')}
        />
      ) : (
        <>
          {data.loading ? <Spinner aria-label={t('actions.loading')} /> : null}
          <DataTable
            data={data.data}
            getRowId={(row) => row.id}
            pageSize={10}
            columns={[
              {
                accessorKey: 'employeeName',
                header: t('attendance.approvals.applicant'),
                cell: ({ row }) => (
                  <Link
                    className='font-medium text-primary underline-offset-4 hover:underline'
                    to={{
                      pathname: 'leave/' + encodeURIComponent(row.original.id),
                      search: location.search,
                    }}
                  >
                    {row.original.employeeName ??
                      t('attendance.approvals.unavailable')}
                    <span className='block text-sm font-normal text-muted-foreground'>
                      {row.original.leaveTypeTitle ??
                        t('attendance.approvals.unavailable')}
                    </span>
                  </Link>
                ),
              },
              {
                accessorKey: 'startAt',
                header: t('attendance.leave.fields.startAt'),
                cell: ({ row }) =>
                  format.format(new Date(row.original.startAt)),
              },
              {
                accessorKey: 'endAt',
                header: t('attendance.leave.fields.endAt'),
                cell: ({ row }) => format.format(new Date(row.original.endAt)),
              },
              {
                accessorKey: 'duration',
                header: t('attendance.approvals.duration'),
                cell: ({ row }) =>
                  t('attendance.approvals.durationValue', {
                    duration: new Intl.NumberFormat(i18n.language).format(
                      row.original.duration,
                    ),
                    unit: row.original.leaveUnit
                      ? t('attendance.leave.enums.' + row.original.leaveUnit)
                      : t('attendance.approvals.unavailable'),
                  }),
              },
              {
                accessorKey: 'status',
                header: t('attendance.leave.requestStatusLabel'),
                cell: ({ row }) => (
                  <Badge variant='outline'>
                    {t('attendance.leave.requestStatus.' + row.original.status)}
                  </Badge>
                ),
              },
            ]}
          />
          {data.data.length >= 500 ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.leave.cap')}
            </p>
          ) : null}
        </>
      )}
      <Outlet context={{ reload: data.reload }} />
    </PageContainer>
  );
}
