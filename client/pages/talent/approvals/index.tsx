import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useReducer, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { DataTable } from '@/components/data-table';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { formatLeaveDuration } from '@/components/talent/leave-duration';
import { BlockSkeleton, EmptyState } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { LeaveError } from '../leave/feedback.js';
import { AdjustmentApprovals } from './adjustments.js';
import type { ApprovalsContext, LeaveApprovalRequest } from './types.js';

// V2-05 (realigned): 异常说明 (考勤异常说明) has its own tab.
const TABS = [
  'leave',
  'missingPunch',
  'overtime',
  'shiftSwap',
  'exception',
] as const;
type Tab = (typeof TABS)[number];

/**
 * 审批 (V2-05): 请假 · 补卡 · 加班 · 调班 · 异常说明 as `?tab=`. Each adjustment tab
 * lists the requests whose current step is mine; `view=scope` shows every
 * request in my approval scope instead.
 */
export default function ApprovalsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const leaveGrant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'approve',
  });
  const requested = params.get('tab') as Tab | null;
  const tab: Tab =
    requested && TABS.includes(requested)
      ? requested
      : !leaveGrant.isPending && !leaveGrant.can
        ? 'missingPunch'
        : 'leave';
  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  const context: ApprovalsContext = { reload: bump };
  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.approvals.title')}
        description={t('attendance.approvals.description')}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', String(value));
          setParams(next, { replace: true });
        }}
      >
        <TabsList className='max-w-full overflow-x-auto'>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`attendance.adjustments.types.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'leave' ? (
        <LeaveApprovals revision={revision} />
      ) : (
        <AdjustmentApprovals type={tab} revision={revision} />
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

function LeaveApprovals({ revision }: { revision: number }): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'approve',
  });
  const data = useRemote<LeaveApprovalRequest[]>(
    grant.can ? 'talent/leave/approvals' : null,
    { refresh: location.key, revision },
  );
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: zone,
  });
  return grant.isPending ? (
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
            cell: ({ row }) => format.format(new Date(row.original.startAt)),
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
              formatLeaveDuration(
                row.original.duration,
                row.original.leaveUnit,
                t,
                i18n.language,
              ),
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
  );
}
