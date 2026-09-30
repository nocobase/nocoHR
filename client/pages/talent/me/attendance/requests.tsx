import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { adjustmentSummary } from '@/components/talent/attendance/adjustment-text';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { DecideButtons } from '@/components/talent/attendance/adjustment-view';
import { RequestStatusBadge } from '@/components/talent/attendance/badges';
import { DraftActions } from '@/components/talent/attendance/draft-actions';
import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import type { Adjustment } from '@/components/talent/attendance/types';
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
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const detailPath = (id: string) =>
  `/talent/me/attendance/adjustments/${encodeURIComponent(id)}`;

/**
 * 我的申请: my 补卡 / 加班 / 调班 / 考勤异常说明 requests; a pending one can be
 * withdrawn, and a draft the HR assistant prepared is submitted (or
 * discarded) here by me.
 */
export function MyAdjustments({
  rows,
  onChanged,
}: {
  rows: Adjustment[];
  onChanged: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const api = useApiClient();
  const [cancelling, setCancelling] = useState<Adjustment | null>(null);
  const [busy, setBusy] = useState(false);
  if (!rows.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('attendance.my.noRequests')}
      </p>
    );
  const cancel = async () => {
    if (!cancelling || busy) return;
    setBusy(true);
    try {
      await api.request({
        method: 'POST',
        path: `talent/adjustments/${encodeURIComponent(cancelling.id)}/cancel`,
      });
      toast.add({ type: 'success', title: t('attendance.my.cancelled') });
      setCancelling(null);
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: attendanceErrorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <ul className='divide-y rounded-lg border'>
        {rows.map((row) => (
          <li
            key={row.id}
            className='flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm'
          >
            <Link
              to={detailPath(row.id)}
              className='min-w-0 flex-1 underline-offset-4 hover:underline'
            >
              <span className='font-medium'>
                {t(`attendance.adjustments.types.${row.type}`)} · {row.date}
              </span>
              <span className='block text-muted-foreground'>
                {adjustmentSummary(row, t, i18n.language, zone)}
              </span>
              {row.status === 'draft' && row.source === 'hrAssistant' ? (
                <span className='block text-xs text-muted-foreground'>
                  {t('attendanceV2.drafts.hint')}
                </span>
              ) : null}
            </Link>
            <span className='flex flex-wrap items-center gap-2'>
              <RequestStatusBadge status={row.status} />
              {row.status === 'draft' ? (
                <DraftActions row={row} onChanged={onChanged} />
              ) : null}
              {row.status === 'pending' ? (
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => setCancelling(row)}
                >
                  {t('attendance.my.cancel')}
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <AlertDialog
        open={Boolean(cancelling)}
        onOpenChange={(open) => !open && !busy && setCancelling(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.my.cancelTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.my.cancelDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('attendance.my.keep')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              disabled={busy}
              onClick={() => void cancel()}
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t('attendance.my.cancel')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 待我同意的调班: colleagues asking me to swap; only the consent step reaches me. */
export function SwapConsents({
  rows,
  onChanged,
}: {
  rows: Adjustment[];
  onChanged: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!rows.length) return null;
  return (
    <ul className='divide-y rounded-lg border'>
      {rows.map((row) => (
        <li
          key={row.id}
          className='flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm'
        >
          <Link
            to={detailPath(row.id)}
            className='min-w-0 flex-1 underline-offset-4 hover:underline'
          >
            <span className='font-medium'>
              {t('attendance.my.swapFrom', {
                name: row.employeeName ?? '',
                date: row.date,
                other: row.details.counterpartDate ?? row.date,
              })}
            </span>
            <span className='block text-muted-foreground'>{row.reason}</span>
          </Link>
          <DecideButtons
            row={row}
            size='sm'
            onDecided={onChanged}
            onReload={onChanged}
          />
        </li>
      ))}
    </ul>
  );
}
