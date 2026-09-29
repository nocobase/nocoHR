import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { Employee } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { str } from '@/components/talent/text';
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { EMPLOYMENT_TYPES, GENDERS, ID_TYPES } from './types.js';

type Draft = Record<string, string>;

const FIELDS = [
  'employeeNo',
  'name',
  'departmentId',
  'positionId',
  'managerEmployeeId',
  'hireDate',
  'careerStartDate',
  'email',
  'mobile',
  'gender',
  'birthDate',
  'idType',
  'idNumber',
  'employmentType',
  'workLocation',
  'address',
  'note',
] as const;

export interface EmployeeFormProps {
  readonly formId: string;
  readonly employee?: Employee;
  /** Department, position and status follow personnel actions once one has taken effect. */
  readonly coreLocked?: boolean;
  readonly canEditSensitive: boolean;
  readonly onSubmittingChange: (submitting: boolean) => void;
  readonly onSubmitted: (employee: Employee) => void;
}

/** Create and edit share this form; the container supplies the buttons. */
export function EmployeeForm({
  formId,
  employee,
  coreLocked = false,
  canEditSensitive,
  onSubmittingChange,
  onSubmitted,
}: EmployeeFormProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const managers = useRemote<{
    items: { id: string; name: string; employeeNo: string }[];
  }>('talent/employees');
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      FIELDS.map((f) => [
        f,
        employee
          ? str((employee as unknown as Record<string, unknown>)[f] ?? '')
          : f === 'employmentType'
            ? 'fullTime'
            : '',
      ]),
    ),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string>();
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));

  async function submit(): Promise<void> {
    const next: Record<string, string> = {};
    if (!draft.employeeNo.trim()) next.employeeNo = t('talent.form.required');
    if (!draft.name.trim()) next.name = t('talent.form.required');
    if (!draft.departmentId) next.departmentId = t('talent.form.required');
    if (
      draft.careerStartDate &&
      draft.hireDate &&
      draft.careerStartDate > draft.hireDate
    )
      next.careerStartDate = t('talent.errors.EMPLOYEE_CAREER_DATE_INVALID');
    setErrors(next);
    if (Object.keys(next).length) return;
    const values: Record<string, unknown> = {};
    for (const f of FIELDS) {
      if (
        !canEditSensitive &&
        (f === 'mobile' ||
          f === 'note' ||
          f === 'idNumber' ||
          f === 'birthDate' ||
          f === 'address')
      )
        continue;
      if (coreLocked && (f === 'departmentId' || f === 'positionId')) continue;
      values[f] = draft[f].trim() === '' ? null : draft[f].trim();
    }
    onSubmittingChange(true);
    setFormError(undefined);
    try {
      const { data } = await api.request<{ data: Employee }>({
        path: employee
          ? `talent/employees/${encodeURIComponent(employee.id)}`
          : 'talent/employees',
        method: employee ? 'PATCH' : 'POST',
        json: values,
      });
      toast.add({
        type: 'success',
        title: employee
          ? t('talent.employees.saved', { name: data.name })
          : t('talent.employees.created', { name: data.name }),
      });
      onSubmittingChange(false);
      onSubmitted(data);
    } catch (cause) {
      setFormError(errorMessage(cause, t));
      onSubmittingChange(false);
    }
  }

  return (
    <form
      id={formId}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FieldGroup>
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field data-invalid={Boolean(errors.employeeNo)}>
            <FieldLabel htmlFor='emp-no'>
              {t('talent.fields.employeeNo')}
            </FieldLabel>
            <Input
              id='emp-no'
              value={draft.employeeNo}
              maxLength={64}
              aria-invalid={Boolean(errors.employeeNo)}
              onChange={(e) => set('employeeNo', e.target.value)}
            />
            {errors.employeeNo ? (
              <FieldError>{errors.employeeNo}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={Boolean(errors.name)}>
            <FieldLabel htmlFor='emp-name'>
              {t('talent.fields.name')}
            </FieldLabel>
            <Input
              id='emp-name'
              value={draft.name}
              maxLength={200}
              aria-invalid={Boolean(errors.name)}
              onChange={(e) => set('name', e.target.value)}
            />
            {errors.name ? <FieldError>{errors.name}</FieldError> : null}
          </Field>
          <Field data-invalid={Boolean(errors.departmentId)}>
            <FieldLabel htmlFor='emp-dept'>
              {t('talent.fields.department')}
            </FieldLabel>
            <NativeSelect
              id='emp-dept'
              value={draft.departmentId}
              disabled={coreLocked}
              onChange={(e) => set('departmentId', e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {lookups.departments
                .filter((d) => d.active || d.id === draft.departmentId)
                .map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {'  '.repeat(d.depth)}
                    {d.label}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
            {coreLocked ? (
              <FieldDescription>
                {t('talent.employees.coreLocked')}
              </FieldDescription>
            ) : null}
            {errors.departmentId ? (
              <FieldError>{errors.departmentId}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-position'>
              {t('talent.fields.position')}
            </FieldLabel>
            <NativeSelect
              id='emp-position'
              value={draft.positionId}
              disabled={coreLocked}
              onChange={(e) => set('positionId', e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.none')}
              </NativeSelectOption>
              {lookups.positions
                .filter((p) => p.active || p.id === draft.positionId)
                .map((p) => (
                  <NativeSelectOption key={p.id} value={p.id}>
                    {p.title}
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={Boolean(errors.careerStartDate)}>
            <FieldLabel htmlFor='emp-career-start'>
              {t('talent.fields.careerStartDate')}
            </FieldLabel>
            <Input
              id='emp-career-start'
              type='date'
              value={draft.careerStartDate}
              aria-invalid={Boolean(errors.careerStartDate)}
              onChange={(e) => set('careerStartDate', e.target.value)}
            />
            {errors.careerStartDate ? (
              <FieldError>{errors.careerStartDate}</FieldError>
            ) : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-manager'>
              {t('talent.fields.manager')}
            </FieldLabel>
            <NativeSelect
              id='emp-manager'
              value={draft.managerEmployeeId}
              onChange={(e) => set('managerEmployeeId', e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.none')}
              </NativeSelectOption>
              {(managers.data?.items ?? [])
                .filter((m) => m.id !== employee?.id)
                .map((m) => (
                  <NativeSelectOption key={m.id} value={m.id}>
                    {m.name} ({m.employeeNo})
                  </NativeSelectOption>
                ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-hire'>
              {t('talent.fields.hireDate')}
            </FieldLabel>
            <Input
              id='emp-hire'
              type='date'
              value={draft.hireDate}
              onChange={(e) => set('hireDate', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-type'>
              {t('talent.fields.employmentType')}
            </FieldLabel>
            <NativeSelect
              id='emp-type'
              value={draft.employmentType}
              onChange={(e) => set('employmentType', e.target.value)}
            >
              {EMPLOYMENT_TYPES.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(`talent.employmentType.${v}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-gender'>
              {t('talent.fields.gender')}
            </FieldLabel>
            <NativeSelect
              id='emp-gender'
              value={draft.gender}
              onChange={(e) => set('gender', e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.none')}
              </NativeSelectOption>
              {GENDERS.map((v) => (
                <NativeSelectOption key={v} value={v}>
                  {t(`talent.gender.${v}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-email'>
              {t('talent.fields.email')}
            </FieldLabel>
            <Input
              id='emp-email'
              type='email'
              value={draft.email}
              maxLength={320}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='emp-location'>
              {t('talent.fields.workLocation')}
            </FieldLabel>
            <Input
              id='emp-location'
              value={draft.workLocation}
              maxLength={200}
              onChange={(e) => set('workLocation', e.target.value)}
            />
          </Field>
          {canEditSensitive ? (
            <>
              <Field>
                <FieldLabel htmlFor='emp-mobile'>
                  {t('talent.fields.mobile')}
                </FieldLabel>
                <Input
                  id='emp-mobile'
                  value={draft.mobile}
                  maxLength={32}
                  onChange={(e) => set('mobile', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='emp-birth'>
                  {t('talent.fields.birthDate')}
                </FieldLabel>
                <Input
                  id='emp-birth'
                  type='date'
                  value={draft.birthDate}
                  onChange={(e) => set('birthDate', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='emp-idtype'>
                  {t('talent.fields.idType')}
                </FieldLabel>
                <NativeSelect
                  id='emp-idtype'
                  value={draft.idType}
                  onChange={(e) => set('idType', e.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.none')}
                  </NativeSelectOption>
                  {ID_TYPES.map((v) => (
                    <NativeSelectOption key={v} value={v}>
                      {t(`talent.idType.${v}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='emp-idnumber'>
                  {t('talent.fields.idNumber')}
                </FieldLabel>
                <Input
                  id='emp-idnumber'
                  value={draft.idNumber}
                  maxLength={64}
                  onChange={(e) => set('idNumber', e.target.value)}
                />
              </Field>
            </>
          ) : null}
        </div>
        {canEditSensitive ? (
          <>
            <Field>
              <FieldLabel htmlFor='emp-address'>
                {t('talent.fields.address')}
              </FieldLabel>
              <Input
                id='emp-address'
                value={draft.address}
                maxLength={500}
                onChange={(e) => set('address', e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='emp-note'>
                {t('talent.fields.note')}
              </FieldLabel>
              <Textarea
                id='emp-note'
                value={draft.note}
                maxLength={4000}
                onChange={(e) => set('note', e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {formError ? <FieldError>{formError}</FieldError> : null}
      </FieldGroup>
    </form>
  );
}
