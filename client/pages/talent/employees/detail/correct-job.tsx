import { zodResolver } from '@hookform/resolvers/zod';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useOutletContext } from 'react-router';
import { z } from 'zod';

import { RouteDialog } from '@/components/route-dialog';
import { errorCode, errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { EmployeeDetail } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { useRouteOverlay } from '@/components/use-route-overlay';

import { LEAVE_REASONS } from '../types.js';
import type { DetailOutletContext } from './types.js';

const FORM_ID = 'correct-job-form';
const STATUSES = ['probation', 'active', 'leave'] as const;

/**
 * Route `/talent/employees/:employeeId/profile/correct-job` — 更正任职信息:
 * fixes a data-entry mistake in department, position or status without an
 * approval, with a reason, and writes a manual job event. Day-to-day moves
 * and leaving go through personnel actions. It reads the record again when it
 * opens, so it never writes from the page's possibly stale copy.
 */
export default function CorrectJobDialog(): ReactElement {
  const { t } = useTranslation();
  const { detail } = useOutletContext<DetailOutletContext>();
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  return (
    <RouteDialog
      title={t('talent.correctJob.title', { name: detail.employee.name })}
      description={t('talent.correctJob.description')}
      beforeClose={() => !busyRef.current}
      footer={<Footer submitting={submitting} />}
    >
      <CorrectJobForm
        onSubmittingChange={(value) => {
          busyRef.current = value;
          setSubmitting(value);
        }}
      />
    </RouteDialog>
  );
}

function CorrectJobForm({
  onSubmittingChange,
}: {
  readonly onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { detail, reload } = useOutletContext<DetailOutletContext>();
  const latest = useRemote<EmployeeDetail>(
    `talent/employees/${encodeURIComponent(detail.employee.id)}`,
  );
  if (latest.error)
    return errorCode(latest.error) === 'EMPLOYEE_NOT_FOUND' ||
      errorCode(latest.error) === 'NOT_FOUND' ? (
      <Alert variant='destructive'>
        <AlertDescription>{t('talent.correctJob.notFound')}</AlertDescription>
      </Alert>
    ) : (
      <LoadError error={latest.error} onRetry={latest.reload} />
    );
  if (!latest.data) return <BlockSkeleton rows={4} />;
  if (!latest.data.can.correctJob)
    return (
      <Alert variant='destructive'>
        <AlertDescription>
          {t('talent.correctJob.unavailable')}
        </AlertDescription>
      </Alert>
    );
  return (
    <LoadedForm
      detail={latest.data}
      onSubmittingChange={onSubmittingChange}
      onSaved={reload}
    />
  );
}

function LoadedForm({
  detail,
  onSubmittingChange,
  onSaved,
}: {
  readonly detail: EmployeeDetail;
  readonly onSubmittingChange: (value: boolean) => void;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const { close } = useRouteOverlay();
  const [failure, setFailure] = useState<string>();
  const employee = detail.employee;
  const schema = useMemo(
    () =>
      z
        .object({
          departmentId: z
            .string()
            .min(1, t('talent.correctJob.departmentRequired')),
          positionId: z.string(),
          status: z.enum(STATUSES),
          leaveDate: z.string(),
          leaveReason: z.string(),
          note: z
            .string()
            .trim()
            .min(1, t('talent.correctJob.noteRequired'))
            .max(2000, t('talent.correctJob.noteTooLong')),
        })
        .superRefine((value, ctx) => {
          if (value.status === 'leave' && !value.leaveDate)
            ctx.addIssue({
              code: 'custom',
              path: ['leaveDate'],
              message: t('talent.correctJob.leaveDateRequired'),
            });
        }),
    [t],
  );
  const [todayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      departmentId: employee.departmentId,
      positionId: employee.positionId ?? '',
      status: (STATUSES as readonly string[]).includes(employee.status)
        ? (employee.status as (typeof STATUSES)[number])
        : 'active',
      leaveDate: todayDate,
      leaveReason: 'resign',
      note: '',
    },
  });
  const status = useWatch({ control: form.control, name: 'status' });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    onSubmittingChange(true);
    setFailure(undefined);
    try {
      await api.request({
        path: `talent/employees/${encodeURIComponent(employee.id)}/correct-job`,
        method: 'POST',
        json: {
          departmentId: values.departmentId,
          positionId: values.positionId || null,
          status: values.status,
          ...(values.status === 'leave'
            ? { leaveDate: values.leaveDate, leaveReason: values.leaveReason }
            : {}),
          note: values.note.trim(),
        },
      });
      toast.add({
        type: 'success',
        title: t('talent.correctJob.done', { name: employee.name }),
      });
      onSubmittingChange(false);
      onSaved();
      void close();
    } catch (cause) {
      onSubmittingChange(false);
      const code = errorCode(cause);
      if (
        code === 'EMPLOYEE_POSITION_INACTIVE' ||
        code === 'EMPLOYEE_POSITION_NOT_FOUND'
      )
        form.setError(
          'positionId',
          { message: errorMessage(cause, t) },
          { shouldFocus: true },
        );
      else if (
        code === 'EMPLOYEE_DEPARTMENT_NOT_FOUND' ||
        code === 'EMPLOYEE_DEPARTMENT_INACTIVE'
      )
        form.setError(
          'departmentId',
          { message: errorMessage(cause, t) },
          { shouldFocus: true },
        );
      else if (code === 'EMPLOYEE_CORRECTION_NOTE_REQUIRED')
        form.setError(
          'note',
          { message: errorMessage(cause, t) },
          { shouldFocus: true },
        );
      else setFailure(errorMessage(cause, t));
    }
  });
  return (
    <form id={FORM_ID} noValidate onSubmit={(event) => void submit(event)}>
      <FieldGroup>
        {failure ? (
          <Alert variant='destructive'>
            <AlertDescription>{failure}</AlertDescription>
          </Alert>
        ) : null}
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field data-invalid={Boolean(errors.departmentId)}>
            <FieldLabel htmlFor='correct-department'>
              {t('talent.fields.department')} *
            </FieldLabel>
            <NativeSelect
              id='correct-department'
              aria-required='true'
              aria-invalid={Boolean(errors.departmentId)}
              {...form.register('departmentId')}
            >
              {lookups.departments
                .filter((d) => d.active || d.id === employee.departmentId)
                .map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {'　'.repeat(d.depth)}
                    {d.label}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            <FieldError errors={[errors.departmentId]} />
          </Field>
          <Field data-invalid={Boolean(errors.positionId)}>
            <FieldLabel htmlFor='correct-position'>
              {t('talent.fields.position')}
            </FieldLabel>
            <NativeSelect
              id='correct-position'
              aria-invalid={Boolean(errors.positionId)}
              {...form.register('positionId')}
            >
              <NativeSelectOption value=''>
                {t('talent.common.none')}
              </NativeSelectOption>
              {lookups.positions
                .filter((p) => p.active || p.id === employee.positionId)
                .map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.title}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            <FieldError errors={[errors.positionId]} />
          </Field>
          <Field>
            <FieldLabel htmlFor='correct-status'>
              {t('talent.fields.status')}
            </FieldLabel>
            <NativeSelect id='correct-status' {...form.register('status')}>
              {STATUSES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`talent.employeeStatus.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        </div>
        {status === 'leave' ? (
          <>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field data-invalid={Boolean(errors.leaveDate)}>
                <FieldLabel htmlFor='correct-leave-date'>
                  {t('talent.fields.leaveDate')} *
                </FieldLabel>
                <Input
                  id='correct-leave-date'
                  type='date'
                  aria-required='true'
                  aria-invalid={Boolean(errors.leaveDate)}
                  {...form.register('leaveDate')}
                />
                <FieldError errors={[errors.leaveDate]} />
              </Field>
              <Field>
                <FieldLabel htmlFor='correct-leave-reason'>
                  {t('talent.fields.leaveReason')}
                </FieldLabel>
                <NativeSelect
                  id='correct-leave-reason'
                  {...form.register('leaveReason')}
                >
                  {LEAVE_REASONS.map((reason) => (
                    <NativeSelectOption key={reason} value={reason}>
                      {t(`talent.leaveReason.${reason}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Alert>
              <AlertDescription>
                {t('talent.correctJob.leaveNote')}
              </AlertDescription>
            </Alert>
          </>
        ) : null}
        <Field data-invalid={Boolean(errors.note)}>
          <FieldLabel htmlFor='correct-note'>
            {t('talent.correctJob.note')} *
          </FieldLabel>
          <Textarea
            id='correct-note'
            aria-required='true'
            aria-invalid={Boolean(errors.note)}
            placeholder={t('talent.correctJob.notePlaceholder')}
            {...form.register('note')}
          />
          <FieldDescription>{t('talent.correctJob.noteHint')}</FieldDescription>
          <FieldError errors={[errors.note]} />
        </Field>
      </FieldGroup>
    </form>
  );
}

function Footer({
  submitting,
}: {
  readonly submitting: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={submitting}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={submitting}>
        {submitting ? <Spinner data-icon='inline-start' /> : null}
        {t('actions.save')}
      </Button>
    </>
  );
}
