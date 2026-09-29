import { zodResolver } from '@hookform/resolvers/zod';
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactNode } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { z } from 'zod';
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
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { SettingsError } from './feedback.js';
import {
  SETTINGS_API,
  type Configuration,
  type Section,
  type Versioned,
} from './types.js';

export function ConfigCard({ section }: { section: Section }) {
  const { t } = useTranslation();
  const [epoch, setEpoch] = useState(0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`attendance.settings.${section}`)}</CardTitle>
        <CardDescription>
          {t(`attendance.settings.${section}Description`)}
        </CardDescription>
      </CardHeader>
      <ConfigLoader
        key={epoch}
        section={section}
        reload={() => setEpoch((n) => n + 1)}
      />
    </Card>
  );
}
function ConfigLoader({
  section,
  reload,
}: {
  section: Section;
  reload: () => void;
}) {
  const remote = useRemote<Versioned<Configuration[Section]>>(
    `${SETTINGS_API}/config/${section}`,
  );
  if (remote.error)
    return (
      <CardContent>
        <SettingsError error={remote.error} retry={reload} />
      </CardContent>
    );
  if (!remote.data)
    return (
      <CardContent>
        <BlockSkeleton rows={3} />
      </CardContent>
    );
  // Section selects both the endpoint and its known response contract.
  if (section === 'limits')
    return (
      <LimitsForm
        initial={remote.data as Versioned<Configuration['limits']>}
        reload={reload}
      />
    );
  if (section === 'annualLeave')
    return (
      <BandsForm
        initial={remote.data as Versioned<Configuration['annualLeave']>}
        reload={reload}
      />
    );
  return (
    <CalendarForm
      initial={remote.data as Versioned<Configuration['calendar']>}
      reload={reload}
    />
  );
}

function useSave<T>(section: Section, initial: Versioned<T>) {
  const api = useApiClient();
  const { t } = useTranslation();
  const revisionRef = useRef(initial.revision);
  const writingRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const save = async (value: T): Promise<T | undefined> => {
    if (writingRef.current) return;
    writingRef.current = true;
    setError(undefined);
    try {
      const response = await api.request<{ data: Versioned<T> }>({
        path: `${SETTINGS_API}/config/${section}`,
        method: 'PATCH',
        json: { value, revision: revisionRef.current },
      });
      revisionRef.current = response.data.revision;
      toast.add({
        type: 'success',
        title: t('attendance.leave.saved', {
          name: t(`attendance.settings.${section}`),
        }),
      });
      return response.data.value;
    } catch (cause) {
      setError(cause);
    } finally {
      writingRef.current = false;
    }
  };
  return { save, error };
}

function CardForm({
  children,
  submit,
  pending,
  reload,
  error,
}: {
  children: ReactNode;
  submit: () => Promise<void>;
  pending: boolean;
  reload: () => void;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void submit();
        }}
      >
        <CardContent className='space-y-4'>
          {error ? <SettingsError error={error} /> : null}
          <fieldset disabled={pending} className='space-y-4'>
            {children}
          </fieldset>
        </CardContent>
        <CardFooter className='justify-end gap-2 pt-4'>
          <Button
            type='button'
            variant='outline'
            disabled={pending}
            onClick={() => setConfirm(true)}
          >
            {t('attendance.settings.reload')}
          </Button>
          <Button type='submit' variant='outline' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </CardFooter>
      </form>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.settings.reloadTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.settings.reloadDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={reload}>
              {t('attendance.settings.reload')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LimitsForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['limits']>;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const invalid = t('attendance.settings.invalidNumber');
  const integer = (min: number, max: number) =>
    z
      .number({ error: invalid })
      .int(invalid)
      .min(min, invalid)
      .max(max, invalid);
  const schema = z.object({
    leaveSecondLevelDays: z
      .number({ error: invalid })
      .positive(invalid)
      .max(366, invalid),
    monthlyMissingPunchLimit: integer(0, 31),
    monthlyConfirmationDays: integer(1, 31),
    consecutiveMissingReminderDays: integer(1, 31),
    overtimeReminderRatio: z
      .number({ error: invalid })
      .positive(invalid)
      .max(1, invalid),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: initial.value,
  });
  const { save, error } = useSave('limits', initial);
  return (
    <CardForm
      pending={form.formState.isSubmitting}
      error={error}
      reload={reload}
      submit={form.handleSubmit(async (value) => {
        const saved = await save(value);
        if (saved) form.reset(saved);
      })}
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        {(Object.keys(schema.shape) as (keyof Configuration['limits'])[]).map(
          (key) => (
            <Field key={key} data-invalid={Boolean(form.formState.errors[key])}>
              <FieldLabel htmlFor={`limits-${key}`}>
                {t(`attendance.settings.fields.${key}`)} *
              </FieldLabel>
              <Input
                id={`limits-${key}`}
                type='number'
                step={
                  key === 'overtimeReminderRatio' ||
                  key === 'leaveSecondLevelDays'
                    ? 'any'
                    : '1'
                }
                {...form.register(key, { valueAsNumber: true })}
                aria-required='true'
                aria-invalid={Boolean(form.formState.errors[key])}
              />
              <FieldError>{form.formState.errors[key]?.message}</FieldError>
            </Field>
          ),
        )}
      </div>
    </CardForm>
  );
}

function BandsForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['annualLeave']>;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const invalid = t('attendance.settings.invalidBands');
  const schema = z.object({
    bands: z
      .array(
        z.object({
          minimumYears: z
            .number({ error: invalid })
            .int(invalid)
            .min(0, invalid)
            .max(100, invalid),
          days: z
            .number({ error: invalid })
            .int(invalid)
            .min(0, invalid)
            .max(366, invalid),
        }),
      )
      .min(1, invalid)
      .max(20, invalid)
      .superRefine((bands, ctx) => {
        bands.forEach((band, index) => {
          if (!index) return;
          if (band.minimumYears <= bands[index - 1].minimumYears)
            ctx.addIssue({
              code: 'custom',
              path: [index, 'minimumYears'],
              message: invalid,
            });
          if (band.days < bands[index - 1].days)
            ctx.addIssue({
              code: 'custom',
              path: [index, 'days'],
              message: invalid,
            });
        });
      }),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: initial.value,
  });
  const list = useFieldArray({ control: form.control, name: 'bands' });
  const { save, error } = useSave('annualLeave', initial);
  return (
    <CardForm
      pending={form.formState.isSubmitting}
      error={error}
      reload={reload}
      submit={form.handleSubmit(async (value) => {
        const saved = await save(value);
        if (saved) form.reset(saved);
      })}
    >
      {list.fields.map((item, index) => (
        <div key={item.id} className='flex flex-wrap items-end gap-3'>
          {(['minimumYears', 'days'] as const).map((key) => (
            <Field
              key={key}
              className='min-w-0 flex-1'
              data-invalid={Boolean(
                form.formState.errors.bands?.[index]?.[key],
              )}
            >
              <FieldLabel htmlFor={`band-${item.id}-${key}`}>
                {t(`attendance.settings.fields.${key}`)} *
              </FieldLabel>
              <Input
                id={`band-${item.id}-${key}`}
                type='number'
                {...form.register(`bands.${index}.${key}`, {
                  valueAsNumber: true,
                })}
                aria-required='true'
                aria-invalid={Boolean(
                  form.formState.errors.bands?.[index]?.[key],
                )}
              />
              <FieldError>
                {form.formState.errors.bands?.[index]?.[key]?.message}
              </FieldError>
            </Field>
          ))}
          <Button
            type='button'
            variant='outline'
            disabled={list.fields.length === 1}
            onClick={() => list.remove(index)}
          >
            {t('attendance.settings.removeRow', { row: index + 1 })}
          </Button>
        </div>
      ))}
      <FieldError>
        {form.formState.errors.bands?.root?.message ??
          form.formState.errors.bands?.message}
      </FieldError>
      <Button
        type='button'
        variant='outline'
        disabled={list.fields.length >= 20}
        onClick={() => list.append({ minimumYears: 0, days: 0 })}
      >
        {t('attendance.settings.addBand')}
      </Button>
    </CardForm>
  );
}

const splitDates = (value: string) => value.split(/[\s,，]+/u).filter(Boolean);
function CalendarForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['calendar']>;
  reload: () => void;
}) {
  const { t } = useTranslation();
  const invalid = t('attendance.settings.invalidCalendar');
  const schema = z.object({
    years: z
      .array(
        z
          .object({
            year: z
              .number({ error: invalid })
              .int(invalid)
              .min(1900, invalid)
              .max(2200, invalid),
            holidays: z.string(),
            adjustedWorkdays: z.string(),
          })
          .superRefine((entry, ctx) => {
            for (const key of ['holidays', 'adjustedWorkdays'] as const) {
              const dates = splitDates(entry[key]);
              if (
                dates.length > 366 ||
                new Set(dates).size !== dates.length ||
                dates.some(
                  (date) =>
                    !z.iso.date().safeParse(date).success ||
                    !date.startsWith(`${entry.year}-`),
                ) ||
                (key === 'adjustedWorkdays' &&
                  dates.some((date) =>
                    splitDates(entry.holidays).includes(date),
                  ))
              )
                ctx.addIssue({ code: 'custom', path: [key], message: invalid });
            }
          }),
      )
      .max(50, invalid)
      .superRefine((years, ctx) => {
        const seen = new Set<number>();
        years.forEach((entry, index) => {
          if (seen.has(entry.year))
            ctx.addIssue({
              code: 'custom',
              path: [index, 'year'],
              message: invalid,
            });
          seen.add(entry.year);
        });
      }),
  });
  const toForm = (value: Configuration['calendar']) => ({
    years: value.years.map((entry) => ({
      year: entry.year,
      holidays: entry.holidays.join('\n'),
      adjustedWorkdays: entry.adjustedWorkdays.join('\n'),
    })),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: toForm(initial.value),
  });
  const list = useFieldArray({ control: form.control, name: 'years' });
  const { save, error } = useSave('calendar', initial);
  return (
    <CardForm
      pending={form.formState.isSubmitting}
      error={error}
      reload={reload}
      submit={form.handleSubmit(async (value) => {
        const saved = await save({
          years: value.years.map((entry) => ({
            year: entry.year,
            holidays: splitDates(entry.holidays),
            adjustedWorkdays: splitDates(entry.adjustedWorkdays),
          })),
        });
        if (saved) form.reset(toForm(saved));
      })}
    >
      {!list.fields.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.settings.noCalendar')}
        </p>
      ) : null}
      {list.fields.map((item, index) => (
        <div key={item.id} className='space-y-3 rounded-lg border p-4'>
          <Field
            data-invalid={Boolean(form.formState.errors.years?.[index]?.year)}
          >
            <FieldLabel htmlFor={`year-${item.id}`}>
              {t('attendance.leave.fields.year')} *
            </FieldLabel>
            <Input
              id={`year-${item.id}`}
              type='number'
              {...form.register(`years.${index}.year`, { valueAsNumber: true })}
              aria-required='true'
              aria-invalid={Boolean(form.formState.errors.years?.[index]?.year)}
            />
            <FieldError>
              {form.formState.errors.years?.[index]?.year?.message}
            </FieldError>
          </Field>
          <div className='grid gap-3 sm:grid-cols-2'>
            {(['holidays', 'adjustedWorkdays'] as const).map((key) => (
              <Field
                key={key}
                data-invalid={Boolean(
                  form.formState.errors.years?.[index]?.[key],
                )}
              >
                <FieldLabel htmlFor={`year-${item.id}-${key}`}>
                  {t(`attendance.settings.fields.${key}`)}
                </FieldLabel>
                <Textarea
                  id={`year-${item.id}-${key}`}
                  rows={4}
                  {...form.register(`years.${index}.${key}`)}
                  aria-invalid={Boolean(
                    form.formState.errors.years?.[index]?.[key],
                  )}
                />
                <FieldError>
                  {form.formState.errors.years?.[index]?.[key]?.message}
                </FieldError>
              </Field>
            ))}
          </div>
          <Button
            type='button'
            variant='outline'
            onClick={() => list.remove(index)}
          >
            {t('attendance.settings.removeRow', { row: index + 1 })}
          </Button>
        </div>
      ))}
      <FieldError>
        {form.formState.errors.years?.root?.message ??
          form.formState.errors.years?.message}
      </FieldError>
      <Button
        type='button'
        variant='outline'
        disabled={list.fields.length >= 50}
        onClick={() =>
          list.append({
            year: new Date().getFullYear(),
            holidays: '',
            adjustedWorkdays: '',
          })
        }
      >
        {t('attendance.settings.addYear')}
      </Button>
    </CardForm>
  );
}
