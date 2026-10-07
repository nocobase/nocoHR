import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useEffect, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { z } from 'zod';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { RouteDialog } from '@/components/route-dialog';
import { useRemote } from '@/components/talent/use-remote';
import { BlockSkeleton } from '@/components/talent/states';
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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { LicensedShiftRequirementField } from '@/components/talent/licensed-shift-certifications';
import { SettingsError } from '../feedback.js';
import {
  SETTINGS_API,
  type Shift,
  type Rule,
  type SettingsData,
  type CatalogContext,
} from '../types.js';
import { responseCode } from '@/components/talent/errors';

export default function CatalogEditor() {
  const { kind, recordId } = useParams();
  if (kind !== 'shifts' && kind !== 'rules') return <UnknownKind />;
  return (
    <Editor key={`${kind}/${recordId ?? 'new'}`} kind={kind} id={recordId} />
  );
}
function UnknownKind() {
  const { t } = useTranslation();
  return <p>{t('attendance.leave.errors.notFound')}</p>;
}

function Editor({ kind, id }: { kind: 'shifts' | 'rules'; id?: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { gone } = useOutletContext<CatalogContext>();
  const permission = useCan({
    resource: { type: 'composite', id: 'talent.attendanceSettings' },
    action: 'manage',
  });
  const detail = useRemote<Shift | Rule>(
    id && permission.can
      ? `${SETTINGS_API}/${kind}/${encodeURIComponent(id)}`
      : null,
  );
  const catalog = useRemote<SettingsData>(permission.can ? SETTINGS_API : null);
  useEffect(() => {
    if (
      id &&
      detail.error instanceof ApiClientError &&
      detail.error.status === 404
    )
      gone(kind, id);
  }, [id, kind, detail.error, gone]);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [fatal, setFatal] = useState<unknown>();
  const [discard, setDiscard] = useState<(answer: boolean) => void>();
  const title = t(
    `attendance.settings.${id ? 'edit' : 'new'}${kind === 'shifts' ? 'Shift' : 'Rule'}`,
  );
  const beforeClose = () => {
    if (pendingRef.current) return false;
    if (!dirtyRef.current) return true;
    return new Promise<boolean>((resolve) => setDiscard(() => resolve));
  };
  const close = async () => {
    if (await beforeClose())
      await navigate('..', { relative: 'route', replace: true });
  };
  const ready =
    permission.can &&
    !fatal &&
    !detail.error &&
    !catalog.error &&
    (!id || detail.data) &&
    catalog.data;
  const buttons = (
    <>
      <Button variant='outline' disabled={pending} onClick={() => void close()}>
        {t('actions.cancel')}
      </Button>
      <Button
        type='submit'
        form='attendance-catalog'
        disabled={pending || !ready}
      >
        {pending ? <Spinner data-icon='inline-start' /> : null}
        {t('actions.save')}
      </Button>
    </>
  );
  const body = (
    <>
      {permission.isPending ? (
        <BlockSkeleton rows={4} />
      ) : permission.error ? (
        <SettingsError error={permission.error} retry={permission.retry} />
      ) : !permission.can ? (
        <p>{t('attendance.leave.errors.forbidden')}</p>
      ) : fatal ? (
        <SettingsError error={fatal} />
      ) : detail.error ? (
        <SettingsError error={detail.error} retry={detail.reload} />
      ) : catalog.error ? (
        <SettingsError error={catalog.error} retry={catalog.reload} />
      ) : !ready ? (
        <BlockSkeleton rows={6} />
      ) : (
        <CatalogForm
          kind={kind}
          record={detail.data}
          departments={catalog.data.departments}
          pending={pending}
          onFatal={setFatal}
          onDirty={() => {
            dirtyRef.current = true;
          }}
          onPending={(value) => {
            pendingRef.current = value;
            setPending(value);
          }}
        />
      )}
      {/* V4-14: 要求的认证 of an existing shift, saved on its own (licensed-shift-certifications.tsx). */}
      {ready && kind === 'shifts' && id ? (
        <LicensedShiftRequirementField shiftId={id} />
      ) : null}
      <AlertDialog
        open={Boolean(discard)}
        onOpenChange={(open) => {
          if (!open) {
            discard?.(false);
            setDiscard(undefined);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.settings.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.leave.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('attendance.leave.keepEditing')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                dirtyRef.current = false;
                discard?.(true);
                setDiscard(undefined);
              }}
            >
              {t('attendance.leave.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
  return kind === 'shifts' ? (
    <RouteDialog
      title={title}
      description={t('attendance.settings.shiftsDescription')}
      beforeClose={beforeClose}
      footer={buttons}
    >
      {body}
    </RouteDialog>
  ) : (
    <RouteChildPage>
      <PageContainer className='max-w-4xl'>
        <PageHeader
          title={title}
          description={t('attendance.settings.rulesDescription')}
        />
        {body}
        <div className='flex justify-end gap-2'>{buttons}</div>
      </PageContainer>
    </RouteChildPage>
  );
}

function CatalogForm({
  kind,
  record,
  departments,
  onDirty,
  onPending,
  pending,
  onFatal,
}: {
  kind: 'shifts' | 'rules';
  record?: Shift | Rule;
  departments: SettingsData['departments'];
  onDirty: () => void;
  onPending: (value: boolean) => void;
  pending: boolean;
  onFatal: (error: unknown) => void;
}) {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const parent = useOutletContext<CatalogContext>();
  const [error, setError] = useState<unknown>();
  const [confirm, setConfirm] = useState(false);
  const busyRef = useRef(false);
  const isShift = kind === 'shifts';
  const shift = record as Shift | undefined;
  const rule = record as Rule | undefined;
  const invalid = t('attendance.settings.invalidNumber');
  const integer = (max: number) =>
    z.number({ error: invalid }).int(invalid).min(0, invalid).max(max, invalid);
  const schema = z
    .object({
      title: z
        .string()
        .trim()
        .min(1, t('attendance.settings.requiredTitle'))
        .max(255, t('attendance.leave.invalid')),
      code: z.string(),
      startTime: z.string(),
      endTime: z.string(),
      breakMinutes: integer(1439),
      isNight: z.enum(['true', 'false']),
      active: z.enum(['true', 'false']),
      departmentIds: z.array(z.string()).max(500),
      workHourSystem: z.enum(['standard', 'comprehensive', 'flexible']),
      punchSource: z.enum(['feishu', 'dingtalk', 'wecom', 'device']),
      lateGraceMinutes: integer(240),
      overtimeRequiresApproval: z.enum(['true', 'false']),
      exceptionExcusable: z.enum(['true', 'false']),
      monthlyOvertimeAlertHours: integer(744),
      minRestHours: integer(72),
      maxConsecutiveNights: integer(31),
    })
    .superRefine((value, ctx) => {
      const issue = (path: string, message: string) =>
        ctx.addIssue({ code: 'custom', path: [path], message });
      if (isShift) {
        if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(value.code))
          issue('code', t('attendance.settings.invalidCode'));
        const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
        if (!time.test(value.startTime))
          issue('startTime', t('attendance.settings.invalidTime'));
        if (!time.test(value.endTime))
          issue('endTime', t('attendance.settings.invalidTime'));
        if (time.test(value.startTime) && time.test(value.endTime)) {
          const minutes = (v: string) =>
            Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
          const duration =
            (minutes(value.endTime) - minutes(value.startTime) + 1440) % 1440;
          if (!duration) issue('endTime', t('attendance.settings.invalidTime'));
          if (value.breakMinutes >= duration)
            issue('breakMinutes', t('attendance.settings.invalidBreak'));
        }
      } else if (!value.departmentIds.length)
        issue('departmentIds', t('attendance.settings.requiredDepartment'));
    });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      title: record?.title ?? '',
      code: shift?.code ?? '',
      startTime: shift?.startTime?.slice(0, 5) ?? '09:00',
      endTime: shift?.endTime?.slice(0, 5) ?? '18:00',
      breakMinutes: shift?.breakMinutes ?? 30,
      isNight: shift?.isNight ? ('true' as const) : ('false' as const),
      active: record?.active === false ? ('false' as const) : ('true' as const),
      departmentIds: record?.departmentIds ?? [],
      workHourSystem: rule?.workHourSystem ?? 'standard',
      punchSource: rule?.punchSource ?? 'device',
      lateGraceMinutes: rule?.lateGraceMinutes ?? 5,
      overtimeRequiresApproval:
        rule?.overtimeRequiresApproval === false
          ? ('false' as const)
          : ('true' as const),
      // 允许说明豁免 (V2-05 realigned), on unless the rule turned it off.
      exceptionExcusable:
        rule?.exceptionExcusable === false
          ? ('false' as const)
          : ('true' as const),
      monthlyOvertimeAlertHours: rule?.monthlyOvertimeAlertHours ?? 36,
      minRestHours: rule?.minRestHours ?? 11,
      maxConsecutiveNights: rule?.maxConsecutiveNights ?? 5,
    },
  });
  const write = async (values: z.infer<typeof schema>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    onPending(true);
    setError(undefined);
    try {
      const common = {
        title: values.title,
        active: values.active === 'true',
        departmentIds: values.departmentIds,
      };
      const value = isShift
        ? {
            ...common,
            departmentIds: values.departmentIds.length
              ? values.departmentIds
              : record?.departmentIds?.length === 0
                ? []
                : null,
            code: values.code,
            startTime: values.startTime,
            endTime: values.endTime,
            breakMinutes: values.breakMinutes,
            isNight: values.isNight === 'true',
          }
        : {
            ...common,
            workHourSystem: values.workHourSystem,
            punchSource: values.punchSource,
            lateGraceMinutes: values.lateGraceMinutes,
            overtimeRequiresApproval:
              values.overtimeRequiresApproval === 'true',
            exceptionExcusable: values.exceptionExcusable === 'true',
            monthlyOvertimeAlertHours: values.monthlyOvertimeAlertHours,
            minRestHours: values.minRestHours,
            maxConsecutiveNights: values.maxConsecutiveNights,
          };
      const response = await api.request<{ data: Shift | Rule }>({
        path: `${SETTINGS_API}/${kind}${record ? `/${encodeURIComponent(record.id)}` : ''}`,
        method: record ? 'PATCH' : 'POST',
        json: {
          value,
          ...(record ? { expectedUpdatedAt: record.updatedAt } : {}),
        },
      });
      parent.saved(kind, response.data);
      toast.add({
        type: 'success',
        title: t('attendance.leave.saved', { name: response.data.title }),
      });
      await navigate('..', { relative: 'route', replace: true });
    } catch (cause) {
      if (
        cause instanceof ApiClientError &&
        responseCode(cause) === 'SHIFT_CODE_CONFLICT'
      )
        form.setError(
          'code',
          { message: t('attendance.settings.errors.SHIFT_CODE_CONFLICT') },
          { shouldFocus: true },
        );
      else if (
        cause instanceof ApiClientError &&
        (responseCode(cause) === 'ATTENDANCE_RULE_CONFLICT' ||
          responseCode(cause) === 'INVALID_DEPARTMENT')
      ) {
        form.setError(
          'departmentIds',
          { message: t(`attendance.settings.errors.${responseCode(cause)}`) },
          { shouldFocus: true },
        );
      } else {
        const fields =
          cause instanceof ApiClientError
            ? z
                .object({ details: z.object({ fields: z.array(z.string()) }) })
                .safeParse(cause.payload)
            : null;
        let mapped = false;
        if (fields?.success)
          for (const path of fields.data.details.fields) {
            const key = path.replace(/^value\./u, '').split('.')[0];
            if (Object.hasOwn(form.getValues(), key)) {
              form.setError(
                key as keyof z.infer<typeof schema>,
                { message: t('attendance.settings.errors.INVALID_INPUT') },
                { shouldFocus: !mapped },
              );
              mapped = true;
            }
          }
        if (!mapped) setError(cause);
        if (record && cause instanceof ApiClientError && cause.status === 404)
          parent.gone(kind, record.id);
        if (
          cause instanceof ApiClientError &&
          [403, 404].includes(cause.status)
        )
          onFatal(cause);
      }
    } finally {
      busyRef.current = false;
      onPending(false);
    }
  };
  const textFields = isShift
    ? (['title', 'code', 'startTime', 'endTime', 'breakMinutes'] as const)
    : ([
        'title',
        'lateGraceMinutes',
        'monthlyOvertimeAlertHours',
        'minRestHours',
        'maxConsecutiveNights',
      ] as const);
  const options: Partial<
    Record<
      | 'isNight'
      | 'active'
      | 'workHourSystem'
      | 'punchSource'
      | 'overtimeRequiresApproval'
      | 'exceptionExcusable',
      string[]
    >
  > = isShift
    ? { isNight: ['true', 'false'], active: ['true', 'false'] }
    : {
        workHourSystem: ['standard', 'comprehensive', 'flexible'],
        punchSource: ['feishu', 'dingtalk', 'wecom', 'device'],
        overtimeRequiresApproval: ['true', 'false'],
        exceptionExcusable: ['true', 'false'],
        active: ['true', 'false'],
      };
  return (
    <>
      <form
        id='attendance-catalog'
        noValidate
        onChange={onDirty}
        onSubmit={(event) => {
          void form.handleSubmit((value) => {
            if (record?.active && value.active === 'false') setConfirm(true);
            else return write(value);
          })(event);
        }}
      >
        {error ? <SettingsError error={error} /> : null}
        <fieldset disabled={pending} className='grid gap-4 sm:grid-cols-2'>
          {textFields.map((key) => {
            const numeric = !['title', 'code', 'startTime', 'endTime'].includes(
              key,
            );
            return (
              <Field
                key={key}
                data-invalid={Boolean(form.formState.errors[key])}
              >
                <FieldLabel htmlFor={`catalog-${key}`}>
                  {t(`attendance.settings.fields.${key}`)} *
                </FieldLabel>
                <Input
                  id={`catalog-${key}`}
                  type={
                    numeric ? 'number' : key.endsWith('Time') ? 'time' : 'text'
                  }
                  {...form.register(key, { valueAsNumber: numeric })}
                  aria-required='true'
                  aria-invalid={Boolean(form.formState.errors[key])}
                />
                <FieldError>{form.formState.errors[key]?.message}</FieldError>
              </Field>
            );
          })}
          {Object.entries(options).map(([key, values]) => (
            <Field
              key={key}
              data-invalid={Boolean(
                form.formState.errors[key as keyof z.infer<typeof schema>],
              )}
            >
              <FieldLabel htmlFor={`catalog-${key}`}>
                {key === 'exceptionExcusable'
                  ? t('attendanceV2.rule.exceptionExcusable')
                  : t(`attendance.settings.fields.${key}`)}{' '}
                *
              </FieldLabel>
              <NativeSelect
                id={`catalog-${key}`}
                aria-required='true'
                aria-invalid={Boolean(
                  form.formState.errors[key as keyof z.infer<typeof schema>],
                )}
                {...form.register(
                  key as
                    | 'active'
                    | 'isNight'
                    | 'workHourSystem'
                    | 'punchSource'
                    | 'overtimeRequiresApproval'
                    | 'exceptionExcusable',
                )}
              >
                {values.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value === 'true' || value === 'false'
                      ? t(`attendance.leave.${value === 'true' ? 'yes' : 'no'}`)
                      : t(`attendance.settings.enums.${value}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {key === 'exceptionExcusable' ? (
                <FieldDescription>
                  {t('attendanceV2.rule.exceptionExcusableHint')}
                </FieldDescription>
              ) : null}
              <FieldError>
                {
                  form.formState.errors[key as keyof z.infer<typeof schema>]
                    ?.message
                }
              </FieldError>
            </Field>
          ))}
          <Controller
            control={form.control}
            name='departmentIds'
            render={({ field, fieldState }) => (
              <Field
                className='sm:col-span-2'
                data-invalid={fieldState.invalid}
              >
                <FieldLabel>
                  {t('attendance.settings.fields.departmentIds')}
                  {!isShift ? ' *' : ''}
                </FieldLabel>
                <p className='text-sm text-muted-foreground'>
                  {t(
                    `attendance.settings.${isShift ? 'allDepartments' : 'departmentHelp'}`,
                  )}
                </p>
                {departments.meta.truncated ? (
                  <p>{t('attendance.leave.cap')}</p>
                ) : null}
                {departments.data
                  .filter((d) => d.active || field.value.includes(d.id))
                  .map((d, index) => (
                    <div key={d.id} className='flex items-center gap-2'>
                      <Checkbox
                        id={`department-${d.id}`}
                        ref={index === 0 ? field.ref : undefined}
                        checked={field.value.includes(d.id)}
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                        onCheckedChange={(checked) => {
                          field.onChange(
                            checked
                              ? [...field.value, d.id]
                              : field.value.filter((id) => id !== d.id),
                          );
                          onDirty();
                        }}
                      />
                      <FieldLabel htmlFor={`department-${d.id}`}>
                        {d.title}
                      </FieldLabel>
                    </div>
                  ))}
                <FieldError>{fieldState.error?.message}</FieldError>
              </Field>
            )}
          />
        </fieldset>
      </form>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.leave.deactivateTitle', { name: record?.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.settings.deactivateDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirm(false);
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
