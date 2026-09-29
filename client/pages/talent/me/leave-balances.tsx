import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useLocation } from 'react-router';
import { DataTable } from '@/components/data-table';
import { LeaveError } from '@/components/talent/leave-error';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';

interface OwnLeaveBalance {
  id: string;
  leaveTypeTitle: string | null;
  entitled: number;
  carriedOver: number;
  used: number;
  pending: number;
  adjusted: number;
  available: number;
}
interface OwnLeaveBalances {
  year: number;
  frozen: boolean;
  items: OwnLeaveBalance[];
}

/** V2-05 own balances only. The server resolves the employee and business year. */
export function MyLeaveBalances({ revision }: { revision: number }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const permission = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'request',
  });
  const allowed = !permission.isPending && !permission.error && permission.can;
  const balances = useRemote<OwnLeaveBalances>(
    allowed ? 'talent/leave/requests/my-balances' : null,
    { refresh: location.key, revision },
  );
  if (permission.isPending) return <BlockSkeleton rows={2} />;
  if (permission.error) return <LeaveError error={permission.error} />;
  if (!allowed) return null;
  if (balances.error)
    return <LeaveError error={balances.error} retry={balances.reload} />;
  // Never display an old balance as current while a submit/cancel reloads it.
  if (balances.loading || !balances.data) return <BlockSkeleton rows={2} />;
  const { year, frozen, items } = balances.data;
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 4,
  });
  return (
    <section aria-labelledby='my-leave-balances-title' className='grid gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <h3 id='my-leave-balances-title' className='text-sm font-medium'>
          {t('attendance.mine.balances', { year: String(year) })}
        </h3>
        {frozen ? (
          <Badge variant='secondary'>{t('attendance.leave.frozen')}</Badge>
        ) : null}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('attendance.mine.balanceHelp')}
      </p>
      {!items.length ? (
        <EmptyState
          title={t('attendance.leave.emptyBalances')}
          description={t('attendance.mine.emptyBalancesDescription')}
        />
      ) : (
        <DataTable
          data={items}
          getRowId={(row) => row.id}
          pageSize={5}
          pageSizeOptions={[5, 10, 20]}
          columns={[
            {
              accessorKey: 'leaveTypeTitle',
              header: t('attendance.leave.fields.title'),
              cell: ({ row }) =>
                row.original.leaveTypeTitle ?? t('attendance.mine.unknownType'),
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
            ).map((key) => ({
              accessorKey: key,
              header: () => (
                <div className='text-right'>
                  {t(`attendance.leave.fields.${key}`)}
                </div>
              ),
              cell: ({ row }: { row: { original: OwnLeaveBalance } }) => (
                <div className='text-right tabular-nums'>
                  {number.format(row.original[key])}
                </div>
              ),
            })),
          ]}
        />
      )}
    </section>
  );
}
