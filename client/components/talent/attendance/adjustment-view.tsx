import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement, type ReactNode } from 'react';

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
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { useCustomFieldDefinitions } from '../custom-field-model.js';
import { CustomFieldValues } from '../custom-fields.js';
import { errorCode } from '../errors.js';
import { useAppTimeZone } from './app-time.js';
import { RequestStatusBadge } from './badges.js';
import { dateTimeLabel } from './dates.js';
import { attendanceErrorMessage, checkText, checksOf } from './errors.js';
import { useSwapInfo } from './swap-info.js';
import type { Adjustment } from './types.js';

function Fact({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : undefined}>
      <dt className='text-sm text-muted-foreground'>{label}</dt>
      <dd className='break-words'>{children}</dd>
    </div>
  );
}

/** The request's facts, its reason and its approval chain. */
export function AdjustmentFacts({ row }: { row: Adjustment }): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const swap = useSwapInfo(row);
  // 界面追加字段 on the detail; the endpoint already left out what this reader may not see.
  const { definitions } = useCustomFieldDefinitions(
    'attendanceAdjustments',
    'detail',
    true,
  );
  const customDefinitions = definitions.filter(
    (d) => !d.sensitive || row.customFields?.[d.key] != null,
  );
  const d = row.details;
  const unknown = t('attendance.adjustments.unknown');
  const shiftText = (value: string | null | undefined) =>
    value === null
      ? t('attendance.shifts.rest')
      : (value ?? (swap.loading ? '…' : unknown));
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className='flex flex-wrap items-center gap-2'>
            {t(`attendance.adjustments.types.${row.type}`)}
            <RequestStatusBadge status={row.status} />
            {row.source === 'hrAssistant' ? (
              <Badge variant='outline'>
                {t('attendanceV2.source.hrAssistant')}
              </Badge>
            ) : null}
            {row.approvals[0]?.submittedVia === 'feishuCard' ? (
              <Badge variant='outline'>{t('attendanceV2.viaCard')}</Badge>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className='grid gap-4 sm:grid-cols-2'>
            <Fact label={t('attendance.adjustments.fields.employee')}>
              {row.employeeName
                ? row.employeeNo
                  ? t('attendance.adjustments.employeeLabel', {
                      name: row.employeeName,
                      number: row.employeeNo,
                    })
                  : row.employeeName
                : unknown}
            </Fact>
            <Fact label={t('attendance.adjustments.fields.date')}>
              {row.date}
            </Fact>
            {row.type === 'missingPunch' ? (
              <Fact label={t('attendance.adjustments.fields.punchAt')}>
                {d.at ? dateTimeLabel(d.at, i18n.language, zone) : unknown}
              </Fact>
            ) : null}
            {row.type === 'overtime' ? (
              <>
                <Fact label={t('attendance.adjustments.fields.overtimeRange')}>
                  {d.startAt && d.endAt
                    ? t('attendance.adjustments.range', {
                        start: dateTimeLabel(d.startAt, i18n.language, zone),
                        end: dateTimeLabel(d.endAt, i18n.language, zone),
                      })
                    : unknown}
                </Fact>
                <Fact label={t('attendance.adjustments.fields.hours')}>
                  {t('attendance.units.hoursValue', { value: d.hours ?? '—' })}
                </Fact>
                <Fact label={t('attendance.adjustments.fields.overtimeType')}>
                  {d.overtimeType
                    ? t(`attendance.overtimeTypes.${d.overtimeType}`)
                    : unknown}
                </Fact>
              </>
            ) : null}
            {row.type === 'shiftSwap' ? (
              <>
                <Fact label={t('attendance.adjustments.fields.counterpart')}>
                  {swap.counterpartName ?? (swap.loading ? '…' : unknown)}
                </Fact>
                <Fact
                  label={t('attendance.adjustments.fields.counterpartDate')}
                >
                  {d.counterpartDate ?? row.date}
                </Fact>
                <Fact label={t('attendance.adjustments.fields.myShift')}>
                  {shiftText(swap.myShift)}
                </Fact>
                <Fact label={t('attendance.adjustments.fields.theirShift')}>
                  {shiftText(swap.theirShift)}
                </Fact>
              </>
            ) : null}
            {row.type === 'exception' ? (
              <>
                <Fact label={t('attendanceV2.exception.title')}>
                  {t(`attendance.recordStatus.${d.anomaly ?? 'late'}`)} ·{' '}
                  {t('attendanceV2.exception.minutes', {
                    minutes: d.minutes ?? '—',
                  })}
                </Fact>
                {d.policy ? (
                  <Fact label={t('attendanceV2.exception.policy')}>
                    《{d.policy.documentTitle}》{d.policy.citation}
                  </Fact>
                ) : null}
              </>
            ) : null}
            <Fact label={t('attendance.adjustments.fields.reason')} wide>
              <span className='whitespace-pre-wrap'>{row.reason}</span>
            </Fact>
          </dl>
          {customDefinitions.length ? (
            <div className='mt-4'>
              <CustomFieldValues
                definitions={customDefinitions}
                values={row.customFields}
              />
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('attendance.adjustments.chain')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!row.approvals.length ? (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.adjustments.noChain')}
            </p>
          ) : (
            <ol className='grid gap-4'>
              {row.approvals.map((step) => (
                <li
                  key={step.level}
                  className='grid gap-1 border-b pb-4 last:border-0 last:pb-0'
                >
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>
                      {t('attendance.adjustments.step', {
                        number: step.level,
                        kind: t(
                          `attendance.adjustments.stepKinds.${step.kind}`,
                        ),
                      })}
                    </span>
                    <Badge variant='outline'>
                      {['pending', 'waiting'].includes(step.status) &&
                      row.status !== 'pending'
                        ? t('attendance.adjustments.stepStatus.inactive')
                        : t(`attendance.adjustments.stepStatus.${step.status}`)}
                    </Badge>
                    {step.via === 'feishuCard' ? (
                      <Badge variant='outline'>
                        {t('attendanceV2.viaCard')}
                      </Badge>
                    ) : null}
                  </div>
                  {step.decidedAt ? (
                    <time
                      className='text-sm text-muted-foreground'
                      dateTime={step.decidedAt}
                    >
                      {dateTimeLabel(step.decidedAt, i18n.language, zone)}
                    </time>
                  ) : null}
                  {step.comment ? (
                    <p className='text-sm whitespace-pre-wrap break-words'>
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

/** Codes after which the request must be read again before anyone decides. */
const STALE = new Set([
  'CONFLICT',
  'REQUEST_STATE_CONFLICT',
  'SWAP_SCHEDULE_CHANGED',
  'NOT_CURRENT_APPROVER',
  'NOT_FOUND',
]);

/**
 * 同意 / 拒绝 with a comment, behind a confirmation. The decision carries the
 * version the reader saw (`expectedUpdatedAt`); a stale version or a changed
 * schedule is refused and the dialog offers to reload.
 */
export function DecideDialog({
  row,
  decision,
  open,
  onOpenChange,
  onDecided,
  onReload,
}: {
  row: Adjustment;
  decision: 'approved' | 'rejected';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDecided: () => void;
  onReload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const stale = Boolean(
    error &&
    (!(error instanceof ApiClientError) || STALE.has(errorCode(error) ?? '')),
  );
  const blocked = error ? checksOf(error) : undefined;
  const consent = row.approvals.find((s) => s.status === 'pending')?.kind;
  const verb =
    consent === 'counterparty'
      ? decision === 'approved'
        ? 'agree'
        : 'decline'
      : decision === 'approved'
        ? 'approve'
        : 'reject';
  const submit = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `talent/adjustments/${encodeURIComponent(row.id)}/decide`,
        json: {
          decision,
          comment: comment.trim() || undefined,
          expectedUpdatedAt: row.updatedAt,
        },
      });
      toast.add({
        type: 'success',
        title: t('attendance.adjustments.decided'),
      });
      setComment('');
      onOpenChange(false);
      onDecided();
    } catch (cause) {
      // A lost response may have committed: the reader reloads, never repeats blindly.
      setError(cause);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (busyRef.current) return;
        if (!next) setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(`attendance.adjustments.confirm.${verb}Title`, {
              name: row.employeeName ?? '',
              type: t(`attendance.adjustments.types.${row.type}`),
            })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(`attendance.adjustments.confirm.${verb}Description`)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className='grid gap-2'>
          <Label htmlFor={`decide-comment-${row.id}`}>
            {t('attendance.adjustments.comment')}
          </Label>
          <Textarea
            id={`decide-comment-${row.id}`}
            value={comment}
            maxLength={1000}
            disabled={busy}
            onChange={(event) => setComment(event.target.value)}
          />
        </div>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>
              <p>{attendanceErrorMessage(error, t)}</p>
              {blocked ? (
                <ul className='mt-1 list-disc pl-4'>
                  {Object.entries(blocked).flatMap(([key, list]) =>
                    list.map((check) => (
                      <li key={`${key}:${check.rule}:${check.message}`}>
                        {key.split(':')[1]} · {checkText(check, t)}
                      </li>
                    )),
                  )}
                </ul>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          {stale ? (
            <Button
              variant='outline'
              onClick={() => {
                setError(undefined);
                onOpenChange(false);
                onReload();
              }}
            >
              {t('attendance.adjustments.reload')}
            </Button>
          ) : (
            <AlertDialogAction
              variant={decision === 'rejected' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t(`attendance.adjustments.actions.${verb}`)}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The two buttons that open `DecideDialog`, for a detail page or a list row. */
export function DecideButtons({
  row,
  onDecided,
  onReload,
  size,
}: {
  row: Adjustment;
  onDecided: () => void;
  onReload: () => void;
  size?: 'sm';
}): ReactElement {
  const { t } = useTranslation();
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [open, setOpen] = useState(false);
  const consent =
    row.approvals.find((s) => s.status === 'pending')?.kind === 'counterparty';
  return (
    <>
      <div className='flex flex-wrap justify-end gap-2'>
        <Button
          variant='outline'
          size={size}
          onClick={() => {
            setDecision('rejected');
            setOpen(true);
          }}
        >
          {t(
            `attendance.adjustments.actions.${consent ? 'decline' : 'reject'}`,
          )}
        </Button>
        <Button
          size={size}
          onClick={() => {
            setDecision('approved');
            setOpen(true);
          }}
        >
          {t(`attendance.adjustments.actions.${consent ? 'agree' : 'approve'}`)}
        </Button>
      </div>
      <DecideDialog
        row={row}
        decision={decision}
        open={open}
        onOpenChange={setOpen}
        onDecided={onDecided}
        onReload={onReload}
      />
    </>
  );
}
