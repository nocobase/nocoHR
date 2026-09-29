import { useTranslation } from '@nocobase/i18n/client';
import { DataTable } from '@/components/data-table';
import { LeaveProofButton } from '@/components/talent/leave-proof-button';
import { Link } from 'react-router';

export interface OwnLeaveRequest {
  id: string;
  startAt: string;
  endAt: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'cancelled';
  attachmentFileId: string | null;
}

export interface MyLeaveRequestsContext {
  reloadLeaveRequests: () => void;
}

export function MyLeaveRequests({ rows }: { rows: OwnLeaveRequest[] }) {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <div className='grid gap-3'>
      <DataTable
        data={rows}
        pageSize={5}
        pageSizeOptions={[5, 10, 20]}
        getRowId={(row) => row.id}
        emptyMessage={t('attendance.leave.noRequests')}
        columns={[
          {
            accessorKey: 'startAt',
            header: t('attendance.leave.fields.startAt'),
            cell: ({ row }) =>
              row.original.status === 'draft' ? (
                <Link
                  className='font-medium text-primary underline-offset-4 hover:underline'
                  to={`/talent/me/leave/${encodeURIComponent(row.original.id)}/edit`}
                  aria-label={t('attendance.leave.editDraftFor', {
                    date: format.format(new Date(row.original.startAt)),
                  })}
                >
                  {format.format(new Date(row.original.startAt))}
                </Link>
              ) : (
                <Link
                  className='font-medium text-primary underline-offset-4 hover:underline'
                  to={`/talent/me/leave/${encodeURIComponent(row.original.id)}`}
                  aria-label={t('attendance.leave.ownDetail.openFor', {
                    date: format.format(new Date(row.original.startAt)),
                  })}
                >
                  {format.format(new Date(row.original.startAt))}
                </Link>
              ),
          },
          {
            accessorKey: 'endAt',
            header: t('attendance.leave.fields.endAt'),
            cell: ({ row }) => format.format(new Date(row.original.endAt)),
          },
          {
            accessorKey: 'status',
            header: t('attendance.leave.requestStatusLabel'),
            cell: ({ row }) =>
              t(`attendance.leave.requestStatus.${row.original.status}`),
          },
          {
            id: 'proof',
            header: t('attendance.leave.proofLabel'),
            cell: ({ row }) =>
              row.original.attachmentFileId ? (
                <LeaveProofButton requestId={row.original.id} />
              ) : (
                <span className='text-muted-foreground'>
                  {t('attendance.leave.noProof')}
                </span>
              ),
          },
        ]}
      />
      {rows.length >= 500 ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.leave.cap')}
        </p>
      ) : null}
    </div>
  );
}
