import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { LockIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { SummaryStatusBadge } from '@/components/talent/attendance/badges';
import { NoteDialog } from '@/components/talent/attendance/note-dialog';
import type { MonthlySummary } from '@/components/talent/attendance/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

const total = (values: Record<string, number>) =>
  Math.round(Object.values(values).reduce((a, b) => a + b, 0) * 100) / 100;

/**
 * 月度考勤汇总: the month's figures. A draft is 确认 by the employee or gets
 * an objection (a note HR answers, which recomputes the month); a locked
 * summary feeds payroll and only HR can unlock it.
 */
export function MySummary({
  summary,
  confirmationDays,
  onChanged,
}: {
  summary: MonthlySummary | null;
  confirmationDays: number;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [dialog, setDialog] = useState<'confirm' | 'objection' | null>(null);
  if (!summary)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('attendance.my.summary.none')}
      </p>
    );
  const objection = summary.objection;
  const openObjection = Boolean(objection && !objection.handledBy);
  const canAct = summary.status === 'draft' && !openObjection;
  const figures: [string, string | number][] = [
    ['scheduledDays', summary.scheduledDays],
    ['workedDays', summary.workedDays],
    ['late', summary.lateCount],
    ['early', summary.earlyCount],
    ['missing', summary.missingCount],
    ['absent', summary.absentDays],
    ['leaveDays', total(summary.leaveByType)],
    ['overtimeHours', total(summary.overtimeByType)],
    ['nights', summary.nightShiftCount],
  ];
  const post = async (path: string, json?: Record<string, string>) => {
    await api.request({
      method: 'POST',
      path: `talent/attendance/summaries/${encodeURIComponent(summary.id)}/${path}`,
      json,
    });
    onChanged();
  };
  return (
    <div className='grid gap-3'>
      <div className='flex flex-wrap items-center gap-2'>
        <SummaryStatusBadge status={summary.status} />
        {summary.status === 'locked' ? (
          <span className='flex items-center gap-1 text-sm text-muted-foreground'>
            <LockIcon className='size-3' />
            {t('attendance.my.summary.locked')}
          </span>
        ) : summary.status === 'draft' ? (
          <span className='text-sm text-muted-foreground'>
            {t('attendance.my.summary.confirmHint', { days: confirmationDays })}
          </span>
        ) : null}
      </div>
      <dl className='grid grid-cols-3 gap-3 sm:grid-cols-5 lg:grid-cols-9'>
        {figures.map(([key, value]) => (
          <div key={key} className='rounded-lg border p-2'>
            <dt className='text-xs text-muted-foreground'>
              {t(`attendance.my.summary.fields.${key}`)}
            </dt>
            <dd className='text-lg font-semibold tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
      {objection ? (
        <Alert>
          <AlertTitle>
            {objection.handledBy
              ? t('attendance.my.summary.objectionHandled')
              : t('attendance.my.summary.objectionOpen')}
          </AlertTitle>
          <AlertDescription>
            <p className='whitespace-pre-wrap'>{objection.note}</p>
            {objection.result ? (
              <p>
                {t('attendance.my.summary.result', {
                  result: objection.result,
                })}
              </p>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {canAct ? (
        <div className='flex flex-wrap justify-end gap-2'>
          <Button variant='outline' onClick={() => setDialog('objection')}>
            {t('attendance.my.summary.object')}
          </Button>
          <Button onClick={() => setDialog('confirm')}>
            {t('attendance.my.summary.confirm')}
          </Button>
        </div>
      ) : null}
      {dialog ? (
        <NoteDialog
          open
          onOpenChange={(open) => !open && setDialog(null)}
          title={t(`attendance.my.summary.${dialog}Title`, {
            month: summary.month,
          })}
          description={t(`attendance.my.summary.${dialog}Description`)}
          label={
            dialog === 'objection' ? t('attendance.my.summary.note') : undefined
          }
          confirmLabel={t(
            dialog === 'objection'
              ? 'attendance.my.summary.object'
              : 'attendance.my.summary.confirm',
          )}
          onSubmit={async (text) => {
            if (dialog === 'objection') await post('objection', { note: text });
            else await post('confirm');
            toast.add({
              type: 'success',
              title: t(
                dialog === 'objection'
                  ? 'attendance.my.summary.objected'
                  : 'attendance.my.summary.confirmed',
              ),
            });
          }}
        />
      ) : null}
    </div>
  );
}
