import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { CustomFieldInputs } from '@/components/talent/custom-fields';
import {
  compactValues,
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { errorMessage } from '@/components/talent/errors';
import type { Employee, EmployeeProfile } from '@/components/talent/types';
import { str } from '@/components/talent/text';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const DEGREES = [
  'highSchool',
  'associate',
  'bachelor',
  'master',
  'doctor',
  'other',
] as const;

type Row = Record<string, string>;

function rowsOf(
  items: readonly Record<string, unknown>[],
  keys: readonly string[],
): Row[] {
  return items.map((item) =>
    Object.fromEntries(
      keys.map((k) => [k, item[k] == null ? '' : str(item[k])]),
    ),
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ProfileChangeDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly employee: Employee;
  readonly profile: EmployeeProfile;
  readonly onSubmitted: () => void;
  /** The fields 人事设置 · 员工自助 allows; the server checks the same list. */
  readonly fields: readonly string[];
}

/**
 * The self-service change request. Only the whitelisted fields can be edited;
 * the request is reviewed by HR and applied only after approval.
 */
export function ProfileChangeDialog({
  open,
  onOpenChange,
  employee,
  profile,
  onSubmitted,
  fields,
}: ProfileChangeDialogProps): ReactElement {
  const { t } = useTranslation();
  const allowed = (field: string) => fields.includes(field);
  const api = useApiClient();
  const initial = {
    mobile: employee.mobile ?? '',
    email: employee.email ?? '',
    address: employee.address ?? '',
    personalEmail: employee.personalEmail ?? '',
    educations: rowsOf(profile.educations, [
      'school',
      'degree',
      'major',
      'startDate',
      'endDate',
    ]),
    experiences: rowsOf(profile.experiences, [
      'company',
      'title',
      'startDate',
      'endDate',
      'description',
    ]),
    emergencyContacts: rowsOf(profile.emergencyContacts, [
      'name',
      'relation',
      'phone',
    ]),
  };
  const [draft, setDraft] = useState(initial);
  // 界面追加字段 placed for self-service (工服尺码…); sensitive ones never are.
  const { definitions: selfFields } = useCustomFieldDefinitions(
    'employees',
    'selfService',
  );
  const initialCustom = employee.customFields ?? {};
  const [custom, setCustom] = useState<CustomValues>(initialCustom);
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const updateRow = (
    kind: 'educations' | 'experiences' | 'emergencyContacts',
    index: number,
    key: string,
    value: string,
  ) =>
    setDraft((d) => ({
      ...d,
      [kind]: d[kind].map((row, i) =>
        i === index ? { ...row, [key]: value } : row,
      ),
    }));
  const addRow = (
    kind: 'educations' | 'experiences' | 'emergencyContacts',
    row: Row,
  ) => setDraft((d) => ({ ...d, [kind]: [...d[kind], row] }));
  const removeRow = (
    kind: 'educations' | 'experiences' | 'emergencyContacts',
    index: number,
  ) =>
    setDraft((d) => ({ ...d, [kind]: d[kind].filter((_, i) => i !== index) }));

  async function submit(): Promise<void> {
    const changes: Record<string, unknown> = {};
    for (const key of ['mobile', 'email', 'address', 'personalEmail'] as const)
      if (draft[key] !== initial[key]) changes[key] = draft[key].trim() || null;
    const clean = (rows: Row[]) =>
      rows.map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([k, v]) => [k, v.trim() || null]),
        ),
      );
    for (const kind of [
      'educations',
      'experiences',
      'emergencyContacts',
    ] as const)
      if (!same(draft[kind], initial[kind])) changes[kind] = clean(draft[kind]);
    const customChanged = Object.fromEntries(
      Object.entries(compactValues(custom)).filter(
        ([key, value]) =>
          JSON.stringify(value ?? null) !==
          JSON.stringify(initialCustom[key] ?? null),
      ),
    );
    if (Object.keys(customChanged).length) changes.customFields = customChanged;
    if (!Object.keys(changes).length) {
      setError(t('talent.me.change.noChanges'));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/me/profile-change',
        method: 'POST',
        json: { changes },
      });
      toast.add({ type: 'success', title: t('talent.me.change.submitted') });
      onOpenChange(false);
      onSubmitted();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (next) {
          setDraft(initial);
          setCustom(initialCustom);
          setError(undefined);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className='max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('talent.me.change.title')}</DialogTitle>
          <DialogDescription>
            {t('talent.me.change.description')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='profile-change-form'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-2'>
              {allowed('mobile') ? (
                <Field>
                  <FieldLabel htmlFor='change-mobile'>
                    {t('talent.fields.mobile')}
                  </FieldLabel>
                  <Input
                    id='change-mobile'
                    value={draft.mobile}
                    maxLength={32}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, mobile: e.target.value }))
                    }
                  />
                </Field>
              ) : null}
              {allowed('email') ? (
                <Field>
                  <FieldLabel htmlFor='change-email'>
                    {t('talent.fields.email')}
                  </FieldLabel>
                  <Input
                    id='change-email'
                    type='email'
                    value={draft.email}
                    maxLength={320}
                    onChange={(e) =>
                      setDraft((d) => ({ ...d, email: e.target.value }))
                    }
                  />
                </Field>
              ) : null}
            </div>
            {allowed('address') ? (
              <Field>
                <FieldLabel htmlFor='change-address'>
                  {t('talent.fields.address')}
                </FieldLabel>
                <Input
                  id='change-address'
                  value={draft.address}
                  maxLength={300}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, address: e.target.value }))
                  }
                />
              </Field>
            ) : null}
            {allowed('personalEmail') ? (
              <Field>
                <FieldLabel htmlFor='change-personal-email'>
                  {t('talent.fields.personalEmail')}
                </FieldLabel>
                <Input
                  id='change-personal-email'
                  type='email'
                  value={draft.personalEmail}
                  maxLength={320}
                  onChange={(e) =>
                    setDraft((d) => ({ ...d, personalEmail: e.target.value }))
                  }
                />
                <FieldDescription>
                  {t('talent.fields.personalEmailHint')}
                </FieldDescription>
              </Field>
            ) : null}

            {allowed('emergencyContacts') ? (
              <FieldSet>
                <FieldLegend>
                  {t('talent.profile.emergencyContacts')}
                </FieldLegend>
                {draft.emergencyContacts.map((row, index) => (
                  <div
                    key={index}
                    className='grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2'
                  >
                    <Input
                      aria-label={t('talent.profile.contactName')}
                      placeholder={t('talent.profile.contactName')}
                      value={row.name}
                      onChange={(e) =>
                        updateRow(
                          'emergencyContacts',
                          index,
                          'name',
                          e.target.value,
                        )
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.relation')}
                      placeholder={t('talent.profile.relation')}
                      value={row.relation}
                      onChange={(e) =>
                        updateRow(
                          'emergencyContacts',
                          index,
                          'relation',
                          e.target.value,
                        )
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.phone')}
                      placeholder={t('talent.profile.phone')}
                      value={row.phone}
                      onChange={(e) =>
                        updateRow(
                          'emergencyContacts',
                          index,
                          'phone',
                          e.target.value,
                        )
                      }
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('talent.common.remove')}
                      onClick={() => removeRow('emergencyContacts', index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='w-fit'
                  onClick={() =>
                    addRow('emergencyContacts', {
                      name: '',
                      relation: '',
                      phone: '',
                    })
                  }
                >
                  <PlusIcon data-icon='inline-start' />
                  {t('talent.profile.addContact')}
                </Button>
              </FieldSet>
            ) : null}

            {allowed('educations') ? (
              <FieldSet>
                <FieldLegend>{t('talent.profile.educations')}</FieldLegend>
                {draft.educations.map((row, index) => (
                  <div
                    key={index}
                    className='grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_1fr_auto]'
                  >
                    <Input
                      aria-label={t('talent.profile.school')}
                      placeholder={t('talent.profile.school')}
                      value={row.school}
                      onChange={(e) =>
                        updateRow('educations', index, 'school', e.target.value)
                      }
                    />
                    <NativeSelect
                      aria-label={t('talent.profile.degree')}
                      value={row.degree}
                      onChange={(e) =>
                        updateRow('educations', index, 'degree', e.target.value)
                      }
                    >
                      {DEGREES.map((d) => (
                        <NativeSelectOption key={d} value={d}>
                          {t(`talent.degree.${d}`)}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                    <Input
                      aria-label={t('talent.profile.major')}
                      placeholder={t('talent.profile.major')}
                      value={row.major}
                      onChange={(e) =>
                        updateRow('educations', index, 'major', e.target.value)
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.startDate')}
                      type='date'
                      value={row.startDate}
                      onChange={(e) =>
                        updateRow(
                          'educations',
                          index,
                          'startDate',
                          e.target.value,
                        )
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.endDate')}
                      type='date'
                      value={row.endDate}
                      onChange={(e) =>
                        updateRow(
                          'educations',
                          index,
                          'endDate',
                          e.target.value,
                        )
                      }
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('talent.common.remove')}
                      onClick={() => removeRow('educations', index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='w-fit'
                  onClick={() =>
                    addRow('educations', {
                      school: '',
                      degree: 'bachelor',
                      major: '',
                      startDate: '',
                      endDate: '',
                    })
                  }
                >
                  <PlusIcon data-icon='inline-start' />
                  {t('talent.profile.addEducation')}
                </Button>
              </FieldSet>
            ) : null}

            {allowed('experiences') ? (
              <FieldSet>
                <FieldLegend>{t('talent.profile.experiences')}</FieldLegend>
                {draft.experiences.map((row, index) => (
                  <div
                    key={index}
                    className='grid grid-cols-2 items-end gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]'
                  >
                    <Input
                      aria-label={t('talent.profile.company')}
                      placeholder={t('talent.profile.company')}
                      value={row.company}
                      onChange={(e) =>
                        updateRow(
                          'experiences',
                          index,
                          'company',
                          e.target.value,
                        )
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.jobTitle')}
                      placeholder={t('talent.profile.jobTitle')}
                      value={row.title}
                      onChange={(e) =>
                        updateRow('experiences', index, 'title', e.target.value)
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.startDate')}
                      type='date'
                      value={row.startDate}
                      onChange={(e) =>
                        updateRow(
                          'experiences',
                          index,
                          'startDate',
                          e.target.value,
                        )
                      }
                    />
                    <Input
                      aria-label={t('talent.profile.endDate')}
                      type='date'
                      value={row.endDate}
                      onChange={(e) =>
                        updateRow(
                          'experiences',
                          index,
                          'endDate',
                          e.target.value,
                        )
                      }
                    />
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      aria-label={t('talent.common.remove')}
                      onClick={() => removeRow('experiences', index)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                ))}
                <Button
                  type='button'
                  variant='outline'
                  size='sm'
                  className='w-fit'
                  onClick={() =>
                    addRow('experiences', {
                      company: '',
                      title: '',
                      startDate: '',
                      endDate: '',
                      description: '',
                    })
                  }
                >
                  <PlusIcon data-icon='inline-start' />
                  {t('talent.profile.addExperience')}
                </Button>
              </FieldSet>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
            {selfFields.length ? (
              <div className='grid gap-4 sm:grid-cols-2'>
                <CustomFieldInputs
                  definitions={selfFields}
                  values={custom}
                  onChange={setCustom}
                  disabled={saving}
                  idPrefix='change-cf'
                />
              </div>
            ) : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='profile-change-form' disabled={saving}>
            {saving ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.me.change.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
