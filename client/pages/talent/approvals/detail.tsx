import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState } from 'react';
import { Link, useLocation, useOutletContext, useParams } from 'react-router';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { LeaveRequestSummary } from '@/components/talent/leave-request-summary';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
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
import { LeaveError } from '../leave/feedback.js';
import type { ApprovalsContext, LeaveApprovalRequest } from './types.js';

export default function LeaveApprovalDetailPage() {
  const { requestId = '' } = useParams();
  return <Detail key={requestId} id={requestId} />;
}

function Detail({ id }: { id: string }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const list = useOutletContext<ApprovalsContext>();
  const detail = useRemote<LeaveApprovalRequest>(
    `talent/leave/requests/${encodeURIComponent(id)}`,
  );
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'approve',
  });
  const [saved, setSaved] = useState<LeaveApprovalRequest>();
  const [comment, setComment] = useState('');
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const headingRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<unknown>();
  const [blockedRecord, setBlockedRecord] = useState<LeaveApprovalRequest>();
  const row = saved ?? detail.data;
  const blocked = Boolean(row && blockedRecord === row);
  const reload = () => {
    if (busyRef.current) return;
    setSaved(undefined);
    setError(undefined);
    setOpen(false);
    detail.reload();
    list.reload();
  };
  const decide = async () => {
    if (
      !row ||
      busyRef.current ||
      blocked ||
      detail.loading ||
      detail.error ||
      !row.canApprove ||
      !grant.can ||
      grant.isPending ||
      grant.error
    )
      return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: LeaveApprovalRequest }>({
        method: 'POST',
        path: `talent/leave/requests/${encodeURIComponent(row.id)}/decide`,
        json: {
          decision,
          comment: comment.trim() || null,
          expectedUpdatedAt: row.updatedAt,
        },
      });
      setSaved({ ...row, ...response.data, canApprove: false, canEdit: false });
      setOpen(false);
      setComment('');
      list.reload();
      toast.add({ type: 'success', title: t('attendance.approvals.decided') });
    } catch (cause) {
      setError(cause);
      // A lost response may already have committed a decision. Re-read, never
      // blindly repeat; stale versions and revoked access follow the same path.
      if (!(cause instanceof ApiClientError) || cause.status !== 400)
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
          render={
            <Link
              to={{ pathname: '..', search: location.search }}
              relative='route'
            />
          }
        >
          {t('attendance.approvals.back')}
        </Button>
        <div ref={headingRef} tabIndex={-1}>
          <PageHeader
            title={t('attendance.approvals.detail')}
            description={t('attendance.approvals.detailDescription')}
          />
        </div>
        {detail.error ? (
          <LeaveError error={detail.error} retry={reload} />
        ) : !row ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            {detail.loading ? (
              <Spinner aria-label={t('actions.loading')} />
            ) : null}
            <LeaveRequestSummary row={row} busy={busy} />
            {grant.error ? (
              <LeaveError error={grant.error} retry={grant.retry} />
            ) : null}
            {row.canApprove && grant.can && !grant.isPending && !grant.error ? (
              <div className='grid gap-3'>
                <Label htmlFor='approval-comment'>
                  {t('attendance.approvals.comment')}
                </Label>
                <Textarea
                  id='approval-comment'
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  maxLength={1000}
                  disabled={busy}
                />
                <div className='flex flex-wrap justify-end gap-2'>
                  <Button
                    variant='outline'
                    disabled={busy || blocked || detail.loading}
                    onClick={() => {
                      setDecision('rejected');
                      setOpen(true);
                    }}
                  >
                    {t('attendance.leave.actions.reject')}
                  </Button>
                  <Button
                    disabled={busy || blocked || detail.loading}
                    onClick={() => {
                      setDecision('approved');
                      setOpen(true);
                    }}
                  >
                    {t('attendance.leave.actions.approve')}
                  </Button>
                </div>
              </div>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.approvals.cannotDecide')}
              </p>
            )}
            {blocked ? (
              <Alert>
                <AlertDescription>
                  {t('attendance.approvals.reloadRequired')}
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
                  row.canApprove ? true : (headingRef.current ?? true)
                }
              >
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t(
                      decision === 'approved'
                        ? 'attendance.approvals.approveTitle'
                        : 'attendance.approvals.rejectTitle',
                      {
                        name:
                          row.employeeName ??
                          t('attendance.approvals.unavailable'),
                      },
                    )}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t(
                      decision === 'approved'
                        ? 'attendance.approvals.approveDescription'
                        : 'attendance.approvals.rejectDescription',
                    )}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                {error ? <LeaveError error={error} /> : null}
                {blocked ? (
                  <p className='text-sm text-muted-foreground'>
                    {t('attendance.approvals.reloadRequired')}
                  </p>
                ) : null}
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>
                    {t('actions.cancel')}
                  </AlertDialogCancel>
                  {blocked ? (
                    <Button variant='outline' onClick={reload}>
                      {t('attendance.approvals.reload')}
                    </Button>
                  ) : (
                    <AlertDialogAction
                      variant={
                        decision === 'rejected' ? 'destructive' : 'default'
                      }
                      disabled={
                        busy ||
                        detail.loading ||
                        !grant.can ||
                        grant.isPending ||
                        Boolean(grant.error)
                      }
                      onClick={() => void decide()}
                    >
                      {busy ? <Spinner data-icon='inline-start' /> : null}
                      {t(
                        decision === 'approved'
                          ? 'attendance.leave.actions.approve'
                          : 'attendance.leave.actions.reject',
                      )}
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
