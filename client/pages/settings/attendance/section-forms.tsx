import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@nocobase/i18n/client';
import { XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { DepartmentSelect } from '@/components/talent/attendance/department-select';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

import { CardForm } from './card-form.js';
import { useSave } from './use-save.js';
import {
  SETTINGS_API,
  type Configuration,
  type SettingsData,
  type Versioned,
} from './types.js';

type Rotation = Configuration['rotations']['templates'][number];
type ExtraLevel = Configuration['approval']['extraLevels'][number];

const KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/u;
const REQUEST_TYPES = [
  'leave',
  'missingPunch',
  'overtime',
  'shiftSwap',
] as const;

/** Rows have no id of their own; a counter keeps React keys stable while rows are added and removed. */
let sequence = 0;
const withKey = <T extends object>(row: T): T & { rowKey: string } => ({
  ...row,
  rowKey: `row-${++sequence}`,
});
const withoutKey = <T extends { rowKey: string }>({
  rowKey: _key,
  ...row
}: T): Omit<T, 'rowKey'> => row;

const integerIn = (value: number, min: number, max: number) =>
  Number.isInteger(value) && value >= min && value <= max;

/** The first problem of each template, by row; `null` when the row is valid. */
function rotationProblems(templates: readonly Rotation[]): (string | null)[] {
  return templates.map((row, index) => {
    if (!KEY.test(row.key)) return 'invalidKey';
    if (templates.findIndex((other) => other.key === row.key) !== index)
      return 'duplicateKey';
    if (!row.title.trim() || row.title.trim().length > 100)
      return 'invalidTitle';
    if (!row.shiftCodes.length || row.shiftCodes.length > 10)
      return 'invalidShifts';
    if (!integerIn(row.periodDays, 1, 31)) return 'invalidPeriod';
    if (!integerIn(row.workDays, 1, row.periodDays)) return 'invalidWorkDays';
    return null;
  });
}

/**
 * 轮班模板: a key the schedulers use, a title, the shifts in rotation order,
 * and the period. Each period works `workDays` days on one shift, then rests;
 * the next period moves to the next shift.
 */
export function RotationsForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['rotations']>;
  reload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const catalog = useRemote<SettingsData>(SETTINGS_API);
  const codes = (catalog.data?.shifts.data ?? [])
    .filter((s) => s.active)
    .map((s) => ({ code: s.code, title: s.title }));
  const titleOf = (code: string) =>
    codes.find((c) => c.code === code)?.title ?? code;
  const [rows, setRows] = useState(() =>
    initial.value.templates.map((row) => withKey(row)),
  );
  const [pending, setPending] = useState(false);
  const [tried, setTried] = useState(false);
  const { save, error } = useSave('rotations', initial);
  const problems = rotationProblems(rows);
  const update = (index: number, patch: Partial<Rotation>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  return (
    <CardForm
      pending={pending}
      error={error}
      reload={reload}
      submit={async () => {
        setTried(true);
        if (problems.some(Boolean)) return;
        setPending(true);
        const saved = await save({
          templates: rows.map((row) => ({
            ...withoutKey(row),
            title: row.title.trim(),
          })),
        });
        setPending(false);
        if (saved) {
          setRows(saved.templates.map((row) => withKey(row)));
          setTried(false);
        }
      }}
    >
      {!rows.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.settings.rotationsEmpty')}
        </p>
      ) : null}
      {rows.map((row, index) => {
        const problem = tried ? problems[index] : null;
        const id = `rotation-${index}`;
        return (
          <div
            key={row.rowKey}
            className='space-y-3 rounded-lg border p-4'
            data-invalid={problem ? true : undefined}
          >
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor={`${id}-title`}>
                  {t('attendance.settings.fields.rotationTitle')} *
                </FieldLabel>
                <Input
                  id={`${id}-title`}
                  value={row.title}
                  maxLength={100}
                  onChange={(event) =>
                    update(index, { title: event.target.value })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-key`}>
                  {t('attendance.settings.fields.rotationKey')} *
                </FieldLabel>
                <Input
                  id={`${id}-key`}
                  value={row.key}
                  maxLength={40}
                  onChange={(event) =>
                    update(index, { key: event.target.value.trim() })
                  }
                />
              </Field>
            </div>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-medium'>
                {t('attendance.settings.fields.shiftCodes')} *
              </legend>
              <ol className='flex flex-wrap gap-2'>
                {row.shiftCodes.map((code, position) => (
                  <li key={code}>
                    <Badge variant='secondary' className='gap-1 pr-1'>
                      {position + 1}. {titleOf(code)}
                      <button
                        type='button'
                        className='rounded-sm hover:bg-muted'
                        aria-label={t('attendance.settings.removeShift', {
                          shift: titleOf(code),
                        })}
                        onClick={() =>
                          update(index, {
                            shiftCodes: row.shiftCodes.filter(
                              (_, i) => i !== position,
                            ),
                          })
                        }
                      >
                        <XIcon className='size-3' />
                      </button>
                    </Badge>
                  </li>
                ))}
              </ol>
              <NativeSelect
                aria-label={t('attendance.settings.addShift')}
                value=''
                disabled={!codes.length || row.shiftCodes.length >= 10}
                onChange={(event) =>
                  event.target.value &&
                  update(index, {
                    shiftCodes: [...row.shiftCodes, event.target.value],
                  })
                }
              >
                <NativeSelectOption value=''>
                  {t('attendance.settings.addShift')}
                </NativeSelectOption>
                {codes
                  .filter((c) => !row.shiftCodes.includes(c.code))
                  .map((c) => (
                    <NativeSelectOption key={c.code} value={c.code}>
                      {`${c.title}（${c.code}）`}
                    </NativeSelectOption>
                  ))}
              </NativeSelect>
            </fieldset>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor={`${id}-period`}>
                  {t('attendance.settings.fields.periodDays')} *
                </FieldLabel>
                <Input
                  id={`${id}-period`}
                  type='number'
                  min={1}
                  max={31}
                  value={Number.isFinite(row.periodDays) ? row.periodDays : ''}
                  onChange={(event) =>
                    update(index, { periodDays: event.target.valueAsNumber })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-work`}>
                  {t('attendance.settings.fields.workDays')} *
                </FieldLabel>
                <Input
                  id={`${id}-work`}
                  type='number'
                  min={1}
                  max={31}
                  value={Number.isFinite(row.workDays) ? row.workDays : ''}
                  onChange={(event) =>
                    update(index, { workDays: event.target.valueAsNumber })
                  }
                />
              </Field>
            </div>
            {problem ? (
              <FieldError>
                {t(`attendance.settings.rotationErrors.${problem}`)}
              </FieldError>
            ) : null}
            <Button
              type='button'
              variant='outline'
              onClick={() =>
                setRows((current) => current.filter((_, i) => i !== index))
              }
            >
              {t('attendance.settings.removeRow', { row: index + 1 })}
            </Button>
          </div>
        );
      })}
      <Button
        type='button'
        variant='outline'
        disabled={rows.length >= 50}
        onClick={() =>
          setRows((current) => [
            ...current,
            withKey({
              key: '',
              title: '',
              shiftCodes: [],
              periodDays: 7,
              workDays: 5,
            }),
          ])
        }
      >
        {t('attendance.settings.addRotation')}
      </Button>
    </CardForm>
  );
}

const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;

/** 半天与小时假: the hour step, a standard day and the work window of a day without a shift. */
export function LeaveUnitsForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['leaveUnits']>;
  reload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const invalid = t('attendance.settings.invalidNumber');
  const invalidWindow = t('attendance.settings.invalidWindow');
  const schema = z.object({
    hourStep: z.number({ error: invalid }).positive(invalid).max(8, invalid),
    standardDayHours: z
      .number({ error: invalid })
      .positive(invalid)
      .max(24, invalid),
    dayWindow: z
      .object({
        start: z.string().regex(TIME, invalidWindow),
        end: z.string().regex(TIME, invalidWindow),
      })
      .refine((w) => w.start < w.end, {
        message: invalidWindow,
        path: ['end'],
      }),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: initial.value,
  });
  const { save, error } = useSave('leaveUnits', initial);
  const errors = form.formState.errors;
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
        {(['hourStep', 'standardDayHours'] as const).map((key) => (
          <Field key={key} data-invalid={Boolean(errors[key])}>
            <FieldLabel htmlFor={`leave-units-${key}`}>
              {t(`attendance.settings.fields.${key}`)} *
            </FieldLabel>
            <Input
              id={`leave-units-${key}`}
              type='number'
              step='any'
              aria-invalid={Boolean(errors[key])}
              {...form.register(key, { valueAsNumber: true })}
            />
            <FieldError>{errors[key]?.message}</FieldError>
          </Field>
        ))}
        {(['start', 'end'] as const).map((key) => (
          <Field key={key} data-invalid={Boolean(errors.dayWindow?.[key])}>
            <FieldLabel htmlFor={`leave-units-window-${key}`}>
              {t(
                `attendance.settings.fields.window${key === 'start' ? 'Start' : 'End'}`,
              )}{' '}
              *
            </FieldLabel>
            <Input
              id={`leave-units-window-${key}`}
              type='time'
              aria-invalid={Boolean(errors.dayWindow?.[key])}
              {...form.register(`dayWindow.${key}`)}
            />
            <FieldError>{errors.dayWindow?.[key]?.message}</FieldError>
          </Field>
        ))}
      </div>
    </CardForm>
  );
}

/** 预计当月加班: the standard day the forecast measures scheduled hours against. */
export function OvertimeForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['overtime']>;
  reload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const invalid = t('attendance.settings.invalidNumber');
  const schema = z.object({
    standardDayHours: z
      .number({ error: invalid })
      .positive(invalid)
      .max(24, invalid),
  });
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: initial.value,
  });
  const { save, error } = useSave('overtime', initial);
  const message = form.formState.errors.standardDayHours?.message;
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
      <Field data-invalid={Boolean(message)} className='sm:max-w-xs'>
        <FieldLabel htmlFor='overtime-standard'>
          {t('attendance.settings.fields.standardDayHours')} *
        </FieldLabel>
        <Input
          id='overtime-standard'
          type='number'
          step='any'
          aria-invalid={Boolean(message)}
          {...form.register('standardDayHours', { valueAsNumber: true })}
        />
        <FieldError>{message}</FieldError>
      </Field>
    </CardForm>
  );
}

interface UserOption {
  id: string;
  name: string;
  username: string | null;
}

/**
 * 按部门追加审批级别: one more approver, after the default chain, for the
 * chosen request types of a department and its sub-departments.
 */
export function ApprovalForm({
  initial,
  reload,
}: {
  initial: Versioned<Configuration['approval']>;
  reload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const users = useRemote<UserOption[]>('talent/users');
  const [rows, setRows] = useState(() =>
    initial.value.extraLevels.map((row) => withKey(row)),
  );
  const [pending, setPending] = useState(false);
  const [tried, setTried] = useState(false);
  const { save, error } = useSave('approval', initial);
  const invalid = rows.map(
    (row) => !row.departmentId || !row.approverUserId || !row.types.length,
  );
  const update = (index: number, patch: Partial<ExtraLevel>) =>
    setRows((current) =>
      current.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  return (
    <CardForm
      pending={pending}
      error={error}
      reload={reload}
      submit={async () => {
        setTried(true);
        if (invalid.some(Boolean)) return;
        setPending(true);
        const saved = await save({
          extraLevels: rows.map((row) => withoutKey(row)),
        });
        setPending(false);
        if (saved) {
          setRows(saved.extraLevels.map((row) => withKey(row)));
          setTried(false);
        }
      }}
    >
      {!rows.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.settings.approvalEmpty')}
        </p>
      ) : null}
      {users.error ? (
        <p className='text-sm text-muted-foreground'>
          {t('attendance.settings.usersUnavailable')}
        </p>
      ) : null}
      {rows.map((row, index) => {
        const id = `approval-${index}`;
        const known = (users.data ?? []).some(
          (u) => u.id === row.approverUserId,
        );
        return (
          <div key={row.rowKey} className='space-y-3 rounded-lg border p-4'>
            <div className='grid gap-3 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor={`${id}-department`}>
                  {t('attendance.filters.department')} *
                </FieldLabel>
                <DepartmentSelect
                  id={`${id}-department`}
                  className='w-full'
                  value={row.departmentId}
                  emptyLabel={t('attendance.filters.chooseDepartment')}
                  onChange={(value) => update(index, { departmentId: value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`${id}-approver`}>
                  {t('attendance.settings.fields.approver')} *
                </FieldLabel>
                <NativeSelect
                  id={`${id}-approver`}
                  className='w-full'
                  value={row.approverUserId}
                  onChange={(event) =>
                    update(index, { approverUserId: event.target.value })
                  }
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.choose')}
                  </NativeSelectOption>
                  {row.approverUserId && !known ? (
                    <NativeSelectOption value={row.approverUserId}>
                      {row.approverUserId}
                    </NativeSelectOption>
                  ) : null}
                  {(users.data ?? []).map((u) => (
                    <NativeSelectOption key={u.id} value={u.id}>
                      {u.username ? `${u.name}（${u.username}）` : u.name}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <fieldset className='space-y-2'>
              <legend className='text-sm font-medium'>
                {t('attendance.settings.fields.requestTypes')} *
              </legend>
              <div className='flex flex-wrap gap-4'>
                {REQUEST_TYPES.map((type) => (
                  <Label
                    key={type}
                    className='flex items-center gap-2 font-normal'
                  >
                    <Checkbox
                      checked={row.types.includes(type)}
                      onCheckedChange={(checked) =>
                        update(index, {
                          types: checked
                            ? [...row.types, type]
                            : row.types.filter((value) => value !== type),
                        })
                      }
                    />
                    {t(`attendance.adjustments.types.${type}`)}
                  </Label>
                ))}
              </div>
            </fieldset>
            {tried && invalid[index] ? (
              <FieldError>
                {t('attendance.settings.approvalInvalid')}
              </FieldError>
            ) : null}
            <Button
              type='button'
              variant='outline'
              onClick={() =>
                setRows((current) => current.filter((_, i) => i !== index))
              }
            >
              {t('attendance.settings.removeRow', { row: index + 1 })}
            </Button>
          </div>
        );
      })}
      <Button
        type='button'
        variant='outline'
        disabled={rows.length >= 50}
        onClick={() =>
          setRows((current) => [
            ...current,
            withKey<ExtraLevel>({
              departmentId: '',
              approverUserId: '',
              types: ['leave'],
            }),
          ])
        }
      >
        {t('attendance.settings.addApproval')}
      </Button>
    </CardForm>
  );
}
