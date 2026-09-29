import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { LeaveRequestSummary } from '@/components/talent/leave-request-summary';
import type { LeaveRequestDetail } from '@/components/talent/leave-request-types';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LeaveError } from '../leave/feedback';
import type { MyLeaveRequestsContext } from './leave-requests';

export default function OwnLeaveDetailPage() {
  const { requestId = '' } = useParams();
  return <Detail key={requestId} id={requestId} />;
}

function Detail({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const list = useOutletContext<MyLeaveRequestsContext>();
  const detail = useRemote<LeaveRequestDetail>(
    `talent/leave/requests/${encodeURIComponent(id)}`,
  );
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'request',
  });
  const [saved, setSaved] = useState<LeaveRequestDetail>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>();
  const [blockedRecord, setBlockedRecord] = useState<LeaveRequestDetail>();
  const row = saved ?? detail.data;
  const blocked = Boolean(row && blockedRecord === row);
  const allowed = Boolean(grant.can && !grant.isPending && !grant.error);
  const canCancel = Boolean(
    row?.isOwnRequest &&
    row.canCancel &&
    allowed &&
    !busy &&
    !blocked &&
    !detail.loading &&
    !detail.error,
  );
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  const reload = () => {
    if (busyRef.current) return;
    setSaved(undefined);
    setError(undefined);
    setOpen(false);
    detail.reload();
    list.reloadLeaveRequests();
  };
  const cancel = async () => {
    if (!row || !canCancel || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: LeaveRequestDetail }>({
        method: 'POST',
        path: `talent/leave/requests/${encodeURIComponent(row.id)}/cancel`,
        json: { expectedUpdatedAt: row.updatedAt },
      });
      setSaved({
        ...row,
        ...response.data,
        canCancel: false,
        canEdit: false,
        canApprove: false,
      });
      setOpen(false);
      list.reloadLeaveRequests();
      toast.add({
        type: 'success',
        title: t('attendance.leave.ownDetail.cancelled'),
      });
    } catch (cause) {
      setError(cause);
      // The response may have been lost after commit. Every failure requires a
      // fresh GET and explicit confirmation, never an automatic repeat POST.
      setBlockedRecord(row);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <Button
          variant='outline'
          disabled={busy}
          nativeButton={false}
          render={<Link to='/talent/me#attendance' />}
        >
          {t('attendance.leave.ownDetail.back')}
        </Button>
        <div ref={headingRef} tabIndex={-1}>
          <PageHeader
            title={t('attendance.leave.ownDetail.title')}
            description={t('attendance.leave.ownDetail.description')}
          />
        </div>
        {detail.error ? (
          <LeaveError error={detail.error} retry={reload} />
        ) : !row ? (
          <BlockSkeleton rows={6} />
        ) : !row.isOwnRequest ? (
          <Alert>
            <AlertDescription>
              {t('attendance.leave.ownDetail.unavailable')}
            </AlertDescription>
          </Alert>
        ) : (
          <>
            {detail.loading ? (
              <Spinner aria-label={t('actions.loading')} />
            ) : null}
            <LeaveRequestSummary row={row} busy={busy} />
            {grant.error ? (
              <LeaveError error={grant.error} retry={grant.retry} />
            ) : null}
            <div className='flex flex-wrap justify-end gap-2'>
              {row.canEdit && allowed ? (
                <Button
                  disabled={busy || detail.loading}
                  nativeButton={false}
                  render={
                    <Link
                      to={`/talent/me/leave/${encodeURIComponent(row.id)}/edit`}
                    />
                  }
                >
                  {t('attendance.leave.editDraft')}
                </Button>
              ) : null}
              {row.canCancel && allowed ? (
                <Button
                  variant='outline'
                  disabled={!canCancel}
                  onClick={() => setOpen(true)}
                >
                  {t('attendance.leave.ownDetail.cancel')}
                </Button>
              ) : null}
            </div>
            {!row.canCancel ? (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.leave.ownDetail.cannotCancel')}
              </p>
            ) : !grant.isPending && !allowed ? (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.leave.errors.forbidden')}
              </p>
            ) : null}
            {blocked ? (
              <Alert>
                <AlertDescription>
                  {t('attendance.leave.ownDetail.reloadRequired')}
                </AlertDescription>
              </Alert>
            ) : null}
            {error && !open ? <LeaveError error={error} /> : null}
            <div>
              <Button
                variant='outline'
                disabled={busy || detail.loading}
                onClick={reload}
              >
                {t('attendance.approvals.reload')}
              </Button>
            </div>
            <AlertDialog
              open={open}
              onOpenChange={(next) => {
                if (!busyRef.current) setOpen(next);
              }}
            >
              <AlertDialogContent
                finalFocus={() =>
                  row.canCancel && !blocked
                    ? true
                    : (headingRef.current ?? true)
                }
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('attendance.leave.ownDetail.cancelTitle', {
                      type:
                        row.leaveTypeTitle ??
                        t('attendance.approvals.unavailable'),
                    })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      row.status === 'approved'
                        ? 'attendance.leave.ownDetail.approvedConsequence'
                        : 'attendance.leave.ownDetail.pendingConsequence',
                      {
                        start: format.format(new Date(row.startAt)),
                        end: format.format(new Date(row.endAt)),
                      },
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {error ? <LeaveError error={error} /> : null}
                {blocked ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('attendance.leave.ownDetail.reloadRequired')}
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>
                    {t('attendance.leave.ownDetail.keep')}
                  </AlertDialogCancel>
                  {blocked ? (
                    <Button variant='outline' onClick={reload}>
                      {t('attendance.approvals.reload')}
                    </Button>
                  ) : (
                    <AlertDialogAction
                      variant='destructive'
                      disabled={!canCancel}
                      onClick={() => void cancel()}
                    >
                      {busy ? <Spinner data-icon='inline-start' /> : null}
                      {t('attendance.leave.ownDetail.cancel')}
                    </AlertDialogAction>
                  )}
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
