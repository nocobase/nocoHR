import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import type { Competency, Requirement } from './types.js';

export interface RequirementDialogProps {
  readonly positionId: string;
  readonly competencies: readonly Competency[];
  /** `null` adds a requirement. */
  readonly requirement: Requirement | null;
  readonly existing: readonly string[];
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

export function RequirementDialog({
  positionId,
  competencies,
  requirement,
  existing,
  onClose,
  onSaved,
}: RequirementDialogProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [competencyId, setCompetencyId] = useState(
    requirement?.competencyId ?? '',
  );
  const [level, setLevel] = useState(
    requirement ? String(requirement.requiredLevel) : '',
  );
  const [mandatory, setMandatory] = useState(requirement?.mandatory ?? false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const competency = competencies.find((c) => c.id === competencyId);
  const available = competencies.filter(
    (c) =>
      c.active &&
      (c.id === requirement?.competencyId || !existing.includes(c.id)),
  );

  async function save(): Promise<void> {
    if (!competency || !level) {
      setError(t('talent.form.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: requirement
          ? `talent/framework/requirements/${encodeURIComponent(requirement.id)}`
          : `talent/framework/positions/${encodeURIComponent(positionId)}/requirements`,
        method: requirement ? 'PATCH' : 'POST',
        json: {
          positionId,
          competencyId,
          requiredLevel: Number(level),
          mandatory,
        },
      });
      toast.add({
        type: 'success',
        title: t('talent.framework.requirementSaved'),
      });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {requirement
              ? t('talent.framework.editRequirement')
              : t('talent.framework.addRequirement')}
          </DialogTitle>
          <DialogDescription>
            {t('talent.framework.requirementDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='requirement-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='req-competency'>
                {t('talent.gap.competency')}
              </FieldLabel>
              <NativeSelect
                id='req-competency'
                value={competencyId}
                disabled={Boolean(requirement)}
                onChange={(e) => {
                  setCompetencyId(e.target.value);
                  setLevel('');
                }}
              >
                <NativeSelectOption value=''>
                  {t('talent.common.choose')}
                </NativeSelectOption>
                {available.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.title}
                    {c.reviewStatus === 'draft'
                      ? ` (${t('talent.reviewStatus.draft')})`
                      : ''}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='req-level'>
                {t('talent.gap.required')}
              </FieldLabel>
              <NativeSelect
                id='req-level'
                value={level}
                disabled={!competency}
                onChange={(e) => setLevel(e.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('talent.common.choose')}
                </NativeSelectOption>
                {competency
                  ? Array.from(
                      { length: competency.maxLevel },
                      (_, i) => i + 1,
                    ).map((value) => {
                      const described = competency.levels?.find(
                        (l) => l.level === value,
                      );
                      return (
                        <NativeSelectOption key={value} value={String(value)}>
                          L{value}
                          {described ? ` · ${described.title}` : ''}
                        </NativeSelectOption>
                      );
                    })
                  : null}
              </NativeSelect>
            </Field>
            <Field orientation='horizontal'>
              <Checkbox
                id='req-mandatory'
                checked={mandatory}
                onCheckedChange={(checked) => setMandatory(checked === true)}
              />
              <FieldLabel htmlFor='req-mandatory'>
                {t('talent.framework.mandatory')}
              </FieldLabel>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='requirement-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
