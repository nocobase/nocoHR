import { zodResolver } from '@hookform/resolvers/zod';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import {
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { z } from 'zod';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { LeaveError } from '../feedback.js';
import { LeaveFormOverlay } from '../form-overlay.js';
import { LEAVE_FORM_ID, useLeaveForm } from '../form-context.js';
import type { LeaveBalance, LeaveListContext } from '../types.js';

export default function AdjustBalancePage() {
  const { balanceId = '' } = useParams();
  return <AdjustView key={balanceId} id={balanceId} />;
}
function AdjustView({ id }: { id: string }) {
  const { t } = useTranslation();
  const detail = useRemote<LeaveBalance>(
    `talent/leave/balances/${encodeURIComponent(id)}`,
  );
  return (
    <LeaveFormOverlay
      title={t('attendance.leave.adjust')}
      description={t('attendance.leave.adjustDescription')}
      enabled={Boolean(detail.data && !detail.data.frozen && !detail.error)}
    >
      {detail.error ? (
        <LeaveError error={detail.error} retry={detail.reload} />
      ) : !detail.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <AdjustForm record={detail.data} />
      )}
    </LeaveFormOverlay>
  );
}
function AdjustForm({ record }: { record: LeaveBalance }) {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const api = useApiClient();
  const overlay = useLeaveForm();
  const navigate = useNavigate();
  const location = useLocation();
  const list = useOutletContext<LeaveListContext<LeaveBalance>>();
  const [error, setError] = useState<unknown>();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const schema = z.object({
    delta: z.string().refine((s) => {
      const n = Number(s);
      return (
        Number.isFinite(n) &&
        n !== 0 &&
        Math.abs(n) <= 366 &&
        Math.abs(n * 10000 - Math.round(n * 10000)) < 1e-7
      );
    }, t('attendance.leave.invalidDelta')),
    reason: z
      .string()
      .trim()
      .min(1, t('attendance.leave.reasonRequired'))
      .max(1000),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: { delta: '', reason: '' },
  });
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 4,
  });
  return (
    <form
      id={record.frozen ? undefined : LEAVE_FORM_ID}
      noValidate
      onChange={overlay.markDirty}
      onSubmit={(event) => {
        void form.handleSubmit(async (values) => {
          if (record.frozen) return;
          overlay.start();
          setError(undefined);
          try {
            const { data } = await api.request<{ data: LeaveBalance }>({
              path: `talent/leave/balances/${encodeURIComponent(record.id)}/adjust`,
              method: 'POST',
              json: {
                ...values,
                delta: Number(values.delta),
                expectedUpdatedAt: record.updatedAt,
                idempotencyKey,
              },
            });
            list.saved({ ...record, ...data });
            overlay.saved();
            toast.add({
              type: 'success',
              title: t('attendance.leave.saved', { name: record.employeeName }),
            });
            await navigate(
              { pathname: '..', search: location.search },
              { relative: 'route', replace: true },
            );
          } catch (cause) {
            setError(cause);
            overlay.end();
          }
        })(event);
      }}
    >
      <FieldGroup>
        <p className='font-medium'>
          {t('attendance.leave.balanceIdentity', {
            name: record.employeeName,
            type: record.leaveTypeTitle,
            year: record.year,
          })}
        </p>
        <p>
          {t('attendance.leave.availableDays', {
            value: number.format(record.available),
          })}
        </p>
        {record.frozen ? (
          <p>{t('attendance.leave.errors.BALANCE_FROZEN')}</p>
        ) : null}
        {error ? <LeaveError error={error} /> : null}
        <fieldset
          disabled={overlay.pending || record.frozen}
          className='grid gap-4'
        >
          <Field data-invalid={Boolean(form.formState.errors.delta)}>
            <FieldLabel htmlFor='leave-delta'>
              {t('attendance.leave.fields.delta')} *
            </FieldLabel>
            <Input
              id='leave-delta'
              type='number'
              step='0.0001'
              {...form.register('delta')}
              aria-invalid={Boolean(form.formState.errors.delta)}
            />
            <FieldError>{form.formState.errors.delta?.message}</FieldError>
          </Field>
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor='leave-reason'>
              {t('attendance.leave.fields.reason')} *
            </FieldLabel>
            <Textarea
              id='leave-reason'
              maxLength={1000}
              {...form.register('reason')}
              aria-invalid={Boolean(form.formState.errors.reason)}
            />
            <FieldError>{form.formState.errors.reason?.message}</FieldError>
          </Field>
        </fieldset>
        <section className='space-y-2'>
          <h3 className='font-medium'>{t('attendance.leave.history')}</h3>
          {record.adjustments.length ? (
            record.adjustments.map((entry) => (
              <div
                key={
                  entry.idempotencyKey ??
                  `${entry.at}-${entry.by}-${entry.delta}`
                }
                className='rounded-lg border p-3 text-sm'
              >
                <p className='tabular-nums'>
                  {number.format(entry.delta)} ·{' '}
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: zone,
                  }).format(new Date(entry.at))}
                </p>
                <p className='break-words whitespace-pre-wrap'>
                  {entry.reason}
                </p>
                <p className='text-muted-foreground'>
                  {t('attendance.leave.adjustedBy', { by: entry.by })}
                </p>
              </div>
            ))
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('attendance.leave.noHistory')}
            </p>
          )}
        </section>
      </FieldGroup>
    </form>
  );
}
