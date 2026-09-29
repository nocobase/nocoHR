import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
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
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';
import { LeaveError } from '../feedback.js';
import { LeaveFormOverlay } from '../form-overlay.js';
import { LEAVE_FORM_ID, useLeaveForm } from '../form-context.js';
import type { LeaveListContext, LeaveType } from '../types.js';

export default function LeaveTypeEditor() {
  const { typeId } = useParams();
  return <EditView key={typeId ?? 'new'} id={typeId} />;
}
function EditView({ id }: { id?: string }) {
  const { t } = useTranslation();
  const grant = useCan({
    resource: { type: 'composite', id: 'talent.leaveRequest' },
    action: 'manageTypes',
  });
  const detail = useRemote<LeaveType>(
    id ? `talent/leave/types/${encodeURIComponent(id)}` : null,
  );
  return (
    <LeaveFormOverlay
      page
      title={t(`attendance.leave.${id ? 'editType' : 'createType'}`)}
      description={t('attendance.leave.typeDescription')}
      enabled={grant.can && !detail.error && (!id || Boolean(detail.data))}
    >
      {grant.isPending ? (
        <BlockSkeleton rows={4} />
      ) : grant.error ? (
        <LeaveError error={grant.error} retry={grant.retry} />
      ) : !grant.can ? (
        <p>{t('attendance.leave.errors.forbidden')}</p>
      ) : detail.error ? (
        <LeaveError error={detail.error} retry={detail.reload} />
      ) : id && !detail.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <TypeForm record={detail.data} />
      )}
    </LeaveFormOverlay>
  );
}
function TypeForm({ record }: { record?: LeaveType }) {
  const { t } = useTranslation();
  const api = useApiClient();
  const overlay = useLeaveForm();
  const navigate = useNavigate();
  const location = useLocation();
  const list = useOutletContext<LeaveListContext<LeaveType>>();
  const [error, setError] = useState<unknown>();
  const [deactivate, setDeactivate] = useState(false);
  const invalid = t('attendance.leave.invalid');
  const schema = z
    .object({
      code: z
        .string()
        .trim()
        .min(1, invalid)
        .max(64, invalid)
        .regex(/^[a-zA-Z0-9_-]+$/u, invalid),
      title: z.string().trim().min(1, invalid).max(255, invalid),
      payType: z.enum(['paid', 'partial', 'unpaid']),
      unit: z.enum(['day', 'halfDay', 'hour']),
      balanceRule: z.enum([
        'annualBySeniority',
        'fixedPerEvent',
        'earned',
        'none',
      ]),
      fixedDays: z.string(),
      countBy: z.enum(['workdays', 'schedule', 'calendar']),
      requiresAttachment: z.enum(['true', 'false']),
      active: z.enum(['true', 'false']),
    })
    .superRefine((v, ctx) => {
      if (
        v.balanceRule === 'fixedPerEvent' &&
        (!Number.isFinite(Number(v.fixedDays)) ||
          Number(v.fixedDays) <= 0 ||
          Number(v.fixedDays) > 366)
      )
        ctx.addIssue({ code: 'custom', path: ['fixedDays'], message: invalid });
    });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      code: record?.code ?? '',
      title: record?.title ?? '',
      payType: record?.payType ?? 'paid',
      unit: record?.unit ?? 'day',
      balanceRule: record?.balanceRule ?? 'annualBySeniority',
      fixedDays: record?.fixedDays == null ? '' : String(record.fixedDays),
      countBy: record?.countBy ?? 'schedule',
      requiresAttachment: record?.requiresAttachment
        ? ('true' as const)
        : ('false' as const),
      active: record?.active === false ? ('false' as const) : ('true' as const),
    },
  });
  const write = async (values: z.infer<typeof schema>) => {
    overlay.start();
    setError(undefined);
    try {
      const response = await api.request<{ data: LeaveType }>({
        path: record
          ? `talent/leave/types/${encodeURIComponent(record.id)}`
          : 'talent/leave/types',
        method: record ? 'PATCH' : 'POST',
        json: {
          value: {
            ...values,
            fixedDays:
              values.balanceRule === 'fixedPerEvent'
                ? Number(values.fixedDays)
                : null,
            requiresAttachment: values.requiresAttachment === 'true',
            active: values.active === 'true',
          },
          ...(record ? { expectedUpdatedAt: record.updatedAt } : {}),
        },
      });
      list.saved(response.data);
      overlay.saved();
      toast.add({
        type: 'success',
        title: t('attendance.leave.saved', { name: response.data.title }),
      });
      // Successful writes leave directly: an earlier blocked Escape may still have a close promise in flight.
      await navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        cause.code === 'LEAVE_TYPE_CODE_CONFLICT'
      )
        form.setError(
          'code',
          { message: t('attendance.leave.errors.LEAVE_TYPE_CODE_CONFLICT') },
          { shouldFocus: true },
        );
      else setError(cause);
      overlay.end();
    }
  };
  const options = {
    payType: ['paid', 'partial', 'unpaid'],
    unit: ['day', 'halfDay', 'hour'],
    balanceRule: ['annualBySeniority', 'fixedPerEvent', 'earned', 'none'],
    countBy: ['workdays', 'schedule', 'calendar'],
  } as const;
  return (
    <>
      <form
        id={LEAVE_FORM_ID}
        noValidate
        onChange={overlay.markDirty}
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            if (record?.active && values.active === 'false')
              setDeactivate(true);
            else return write(values);
          })(event);
        }}
      >
        <FieldGroup>
          {error ? <LeaveError error={error} /> : null}
          <fieldset
            disabled={overlay.pending}
            className='grid gap-4 sm:grid-cols-2'
          >
            {(['title', 'code'] as const).map((key) => (
              <Field
                key={key}
                data-invalid={Boolean(form.formState.errors[key])}
              >
                <FieldLabel htmlFor={`leave-${key}`}>
                  {t(`attendance.leave.fields.${key}`)} *
                </FieldLabel>
                <Input
                  id={`leave-${key}`}
                  {...form.register(key)}
                  aria-invalid={Boolean(form.formState.errors[key])}
                />
                <FieldError>{form.formState.errors[key]?.message}</FieldError>
              </Field>
            ))}
            {(Object.keys(options) as (keyof typeof options)[]).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`leave-${key}`}>
                  {t(`attendance.leave.fields.${key}`)} *
                </FieldLabel>
                <NativeSelect id={`leave-${key}`} {...form.register(key)}>
                  {options[key].map((value) => (
                    <NativeSelectOption key={value} value={value}>
                      {t(`attendance.leave.enums.${value}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ))}
            <Field data-invalid={Boolean(form.formState.errors.fixedDays)}>
              <FieldLabel htmlFor='leave-fixedDays'>
                {t('attendance.leave.fields.fixedDays')}
              </FieldLabel>
              <Input
                id='leave-fixedDays'
                type='number'
                min={0.0001}
                max={366}
                step='any'
                {...form.register('fixedDays')}
                aria-invalid={Boolean(form.formState.errors.fixedDays)}
              />
              <FieldError>
                {form.formState.errors.fixedDays?.message}
              </FieldError>
            </Field>
            {(['requiresAttachment', 'active'] as const).map((key) => (
              <Field key={key}>
                <FieldLabel htmlFor={`leave-${key}`}>
                  {t(`attendance.leave.fields.${key}`)} *
                </FieldLabel>
                <NativeSelect id={`leave-${key}`} {...form.register(key)}>
                  <NativeSelectOption value='true'>
                    {t('attendance.leave.yes')}
                  </NativeSelectOption>
                  <NativeSelectOption value='false'>
                    {t('attendance.leave.no')}
                  </NativeSelectOption>
                </NativeSelect>
              </Field>
            ))}
          </fieldset>
        </FieldGroup>
      </form>
      <AlertDialog open={deactivate} onOpenChange={setDeactivate}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.leave.deactivateTitle', { name: record?.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.leave.deactivateDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setDeactivate(false);
                void form.handleSubmit(write)();
              }}
            >
              {t('attendance.leave.deactivate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
