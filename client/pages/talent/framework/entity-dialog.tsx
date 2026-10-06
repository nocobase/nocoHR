import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import {
  compactValues,
  customFieldErrors,
  useCustomFieldDefinitions,
  type CustomValues,
} from '@/components/talent/custom-field-model';
import { CustomFieldInputs } from '@/components/talent/custom-fields';
import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import type { JobFamily, Position } from './types.js';

export type EntityTarget =
  | { kind: 'family'; family: JobFamily | null }
  | { kind: 'position'; position: Position | null; jobFamilyId?: string };

/** Create or edit a job family or a position. */
export function EntityDialog({
  target,
  families,
  onClose,
  onSaved,
}: {
  target: EntityTarget;
  families: readonly JobFamily[];
  onClose: () => void;
  onSaved: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const current = target.kind === 'family' ? target.family : target.position;
  const [draft, setDraft] = useState<Record<string, string>>(
    (): Record<string, string> =>
      target.kind === 'family'
        ? {
            code: target.family?.code ?? '',
            title: target.family?.title ?? '',
            description: target.family?.description ?? '',
          }
        : {
            code: target.position?.code ?? '',
            title: target.position?.title ?? '',
            jobFamilyId:
              target.position?.jobFamilyId ??
              target.jobFamilyId ??
              families[0]?.id ??
              '',
            grade: target.position?.grade ?? '',
            responsibilities: target.position?.responsibilities ?? '',
          },
  );
  // 界面追加字段 on positions (设置 / 字段管理), shown on the position's own form.
  const { definitions: positionFields } = useCustomFieldDefinitions(
    'positions',
    'form',
  );
  const customDefinitions = target.kind === 'position' ? positionFields : [];
  const [custom, setCustom] = useState<CustomValues>(() =>
    target.kind === 'position' ? (target.position?.customFields ?? {}) : {},
  );
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save(): Promise<void> {
    if (!draft.code.trim() || !draft.title.trim()) {
      setError(t('talent.form.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    setCustomErrors({});
    try {
      const base =
        target.kind === 'family'
          ? 'talent/framework/job-families'
          : 'talent/framework/positions';
      const { data } = await api.request<{ data: { id: string } }>({
        path: current ? `${base}/${encodeURIComponent(current.id)}` : base,
        method: current ? 'PATCH' : 'POST',
        json: {
          ...Object.fromEntries(
            Object.entries(draft).map(([k, v]) => [k, v.trim() || null]),
          ),
          ...(customDefinitions.length
            ? { customFields: compactValues(custom) }
            : {}),
        },
      });
      toast.add({ type: 'success', title: t('talent.framework.saved') });
      onSaved(data.id);
    } catch (cause) {
      setError(errorMessage(cause, t));
      if (errorCode(cause) === 'CUSTOM_FIELD_INVALID')
        setCustomErrors(customFieldErrors(errorDetails(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {target.kind === 'family'
              ? current
                ? t('talent.framework.editFamily')
                : t('talent.framework.newFamily')
              : current
                ? t('talent.framework.editPosition')
                : t('talent.framework.newPosition')}
          </DialogTitle>
        </DialogHeader>
        <form
          id='entity-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='entity-code'>
                  {t('talent.framework.code')}
                </FieldLabel>
                <Input
                  id='entity-code'
                  value={draft.code}
                  maxLength={64}
                  onChange={(e) => set('code', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='entity-title'>
                  {t('talent.framework.titleField')}
                </FieldLabel>
                <Input
                  id='entity-title'
                  value={draft.title}
                  maxLength={200}
                  onChange={(e) => set('title', e.target.value)}
                />
              </Field>
            </div>
            {target.kind === 'family' ? (
              <Field>
                <FieldLabel htmlFor='entity-description'>
                  {t('talent.framework.descriptionField')}
                </FieldLabel>
                <Textarea
                  id='entity-description'
                  value={draft.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </Field>
            ) : (
              <>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <Field>
                    <FieldLabel htmlFor='entity-family'>
                      {t('talent.framework.family')}
                    </FieldLabel>
                    <NativeSelect
                      id='entity-family'
                      value={draft.jobFamilyId}
                      onChange={(e) => set('jobFamilyId', e.target.value)}
                    >
                      {families.map((f) => (
                        <NativeSelectOption key={f.id} value={f.id}>
                          {f.title}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='entity-grade'>
                      {t('talent.framework.grade')}
                    </FieldLabel>
                    <Input
                      id='entity-grade'
                      value={draft.grade}
                      maxLength={32}
                      onChange={(e) => set('grade', e.target.value)}
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor='entity-resp'>
                    {t('talent.framework.responsibilities')}
                  </FieldLabel>
                  <Textarea
                    id='entity-resp'
                    rows={6}
                    value={draft.responsibilities}
                    onChange={(e) => set('responsibilities', e.target.value)}
                    placeholder={t(
                      'talent.framework.responsibilitiesPlaceholder',
                    )}
                  />
                </Field>
                <CustomFieldInputs
                  definitions={customDefinitions}
                  values={custom}
                  onChange={setCustom}
                  errors={customErrors}
                  disabled={pending}
                  idPrefix='position-custom'
                />
              </>
            )}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='entity-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
