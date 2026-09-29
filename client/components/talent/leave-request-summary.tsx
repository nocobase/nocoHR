import { useTranslation } from '@nocobase/i18n/client';
import { LeaveProofButton } from './leave-proof-button';
import type { LeaveRequestDetail } from './leave-request-types';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Read-only request facts shared by applicant and approver detail pages. */
export function LeaveRequestSummary({
  row,
  busy = false,
}: {
  row: LeaveRequestDetail;
  busy?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>
            {row.employeeName ?? t('attendance.approvals.unavailable')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-4 sm:grid-cols-2'>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.fields.title')}
              </dt>
              <dd>
                {row.leaveTypeTitle ?? t('attendance.approvals.unavailable')}
              </dd>
            </div>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.requestStatusLabel')}
              </dt>
              <dd>
                <Badge variant='outline'>
                  {t(`attendance.leave.requestStatus.${row.status}`)}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.fields.startAt')}
              </dt>
              <dd>{format.format(new Date(row.startAt))}</dd>
            </div>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.fields.endAt')}
              </dt>
              <dd>{format.format(new Date(row.endAt))}</dd>
            </div>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.approvals.duration')}
              </dt>
              <dd>
                {t('attendance.approvals.durationValue', {
                  duration: new Intl.NumberFormat(i18n.language).format(
                    row.duration,
                  ),
                  unit: row.leaveUnit
                    ? t(`attendance.leave.enums.${row.leaveUnit}`)
                    : t('attendance.approvals.unavailable'),
                })}
              </dd>
            </div>
            <div>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.proofLabel')}
              </dt>
              <dd>
                {row.attachmentFileId ? (
                  <LeaveProofButton requestId={row.id} disabled={busy} />
                ) : (
                  t('attendance.leave.noProof')
                )}
              </dd>
            </div>
            <div className='sm:col-span-2'>
              <dt className='text-sm text-muted-foreground'>
                {t('attendance.leave.fields.reason')}
              </dt>
              <dd className='whitespace-pre-wrap break-words'>
                {row.reason || t('attendance.approvals.noComment')}
              </dd>
            </div>
          </dl>
          <p className='mt-4 text-sm text-muted-foreground'>
            {t('attendance.leave.timeZone', {
              zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('attendance.approvals.history')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!row.approvals.length ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.approvals.noHistory')}
            </p>
          ) : (
            <ol className='grid gap-4'>
              {row.approvals.map((step, index) => (
                <li
                  key={`${step.kind}:${step.departmentId ?? ''}:${step.approverUserId ?? ''}`}
                  className='grid gap-2 border-b pb-4 last:border-0 last:pb-0'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>
                      {t('attendance.approvals.step', {
                        number: index + 1,
                        kind: t(
                          step.kind === 'hrAdmin'
                            ? 'attendance.approvals.hr'
                            : 'attendance.approvals.manager',
                        ),
                      })}
                    </span>
                    <Badge variant='outline'>
                      {['pending', 'waiting'].includes(step.status) &&
                      ['rejected', 'cancelled'].includes(row.status)
                        ? t('attendance.approvals.inactive')
                        : step.status === 'waiting'
                          ? t('attendance.approvals.waiting')
                          : t(`attendance.leave.requestStatus.${step.status}`)}
                    </Badge>
                  </div>
                  {step.decidedAt ? (
                    <time
                      className='text-sm text-muted-foreground'
                      dateTime={step.decidedAt}
                    >
                      {format.format(new Date(step.decidedAt))}
                    </time>
                  ) : null}
                  {step.comment ? (
                    <p className='whitespace-pre-wrap break-words text-sm'>
                      {step.comment}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </>
  );
}
