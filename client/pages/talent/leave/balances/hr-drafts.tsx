import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, useLocation } from 'react-router';
import { DataTable } from '@/components/data-table';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LeaveError } from '../feedback.js';

interface HrDraft {
  id: string;
  employeeName: string | null;
  leaveTypeTitle: string | null;
  startAt: string;
  status: string;
  source: string;
}

export function HrLeaveDrafts() {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const request = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'request',
  });
  const hr = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'manageTypes',
  });
  const allowed =
    request.can &&
    hr.can &&
    !request.isPending &&
    !hr.isPending &&
    !request.error &&
    !hr.error;
  const drafts = useRemote<HrDraft[]>(
    allowed ? 'talent/leave/requests' : null,
    { source: 'hr', status: 'draft', refresh: location.key },
  );
  if (request.error || hr.error)
    return (
      <LeaveError
        error={request.error || hr.error}
        retry={() => {
          void request.retry();
          void hr.retry();
        }}
      />
    );
  if (!allowed) return null;
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
        <div className='grid gap-2'>
          <CardTitle>{t('attendance.leave.hrEntry.title')}</CardTitle>
          <CardDescription>
            {t('attendance.leave.hrEntry.description')}
          </CardDescription>
        </div>
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to={{ pathname: 'entry', search: location.search }} />}
        >
          {t('attendance.leave.hrEntry.create')}
        </Button>
      </CardHeader>
      <CardContent>
        {drafts.error ? (
          <LeaveError error={drafts.error} retry={drafts.reload} />
        ) : drafts.loading ? (
          <BlockSkeleton rows={2} />
        ) : (
          <DataTable
            data={(drafts.data ?? []).filter(
              (row) => row.source === 'hr' && row.status === 'draft',
            )}
            pageSize={5}
            pageSizeOptions={[5, 10, 20]}
            getRowId={(row) => row.id}
            emptyMessage={t('attendance.leave.hrEntry.noDrafts')}
            columns={[
              {
                accessorKey: 'employeeName',
                header: t('attendance.leave.fields.employee'),
                cell: ({ row }) => (
                  <Link
                    className='font-medium text-primary underline-offset-4 hover:underline'
                    to={{
                      pathname: `entry/${encodeURIComponent(row.original.id)}`,
                      search: location.search,
                    }}
                    aria-label={t('attendance.leave.hrEntry.editFor', {
                      name:
                        row.original.employeeName ??
                        t('attendance.approvals.unavailable'),
                    })}
                  >
                    {row.original.employeeName ??
                      t('attendance.approvals.unavailable')}
                  </Link>
                ),
              },
              {
                accessorKey: 'leaveTypeTitle',
                header: t('attendance.leave.fields.title'),
                cell: ({ row }) =>
                  row.original.leaveTypeTitle ??
                  t('attendance.approvals.unavailable'),
              },
              {
                accessorKey: 'startAt',
                header: t('attendance.leave.fields.startAt'),
                cell: ({ row }) =>
                  format.format(new Date(row.original.startAt)),
              },
            ]}
          />
        )}
        {(drafts.data?.length ?? 0) >= 500 ? (
          <p className='mt-3 text-sm text-muted-foreground'>
            {t('attendance.leave.cap')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
