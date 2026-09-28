import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

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
} from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { errorMessage } from './errors.js';

export interface AssessTarget {
  readonly competencyId: string;
  readonly title: string;
  readonly maxLevel: number;
  readonly currentLevel: number;
  readonly levels: readonly {
    level: number;
    title: string;
    behaviors: string;
  }[];
}

export interface AssessmentDialogProps {
  readonly employeeId: string;
  readonly employeeName: string;
  /** The competency being assessed; `null` closes the dialog. */
  readonly target: AssessTarget | null;
  /** Other competencies that may be assessed when opened without a target competency. */
  readonly choices?: readonly AssessTarget[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSaved: () => void;
}

/** Records one assessment. Assessments are append-only: each one is a new row of history. */
export function AssessmentDialog({
  employeeId,
  employeeName,
  target,
  choices = [],
  open,
  onOpenChange,
  onSaved,
}: AssessmentDialogProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [competencyId, setCompetencyId] = useState('');
  const [level, setLevel] = useState('');
  const [evidence, setEvidence] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const selected =
    target ?? choices.find((c) => c.competencyId === competencyId) ?? null;

  const reset = (next: AssessTarget | null) => {
    setCompetencyId(next?.competencyId ?? '');
    setLevel(next ? String(next.currentLevel) : '');
    setEvidence('');
    setError(undefined);
  };

  async function submit(): Promise<void> {
    if (!selected) {
      setError(t('talent.assess.competencyRequired'));
      return;
    }
    if (level === '') {
      setError(t('talent.assess.levelRequired'));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/employees/${encodeURIComponent(employeeId)}/assessments`,
        method: 'POST',
        json: {
          competencyId: selected.competencyId,
          level: Number(level),
          evidence: evidence.trim() || null,
        },
      });
      toast.add({
        type: 'success',
        title: t('talent.assess.saved', { name: employeeName }),
      });
      onOpenChange(false);
      onSaved();
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
        if (next) reset(target);
        onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {t('talent.assess.title', { name: employeeName })}
          </DialogTitle>
          <DialogDescription>
            {t('talent.assess.description')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='assessment-form'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            {target ? null : (
              <Field>
                <FieldLabel htmlFor='assess-competency'>
                  {t('talent.assess.competency')}
                </FieldLabel>
                <NativeSelect
                  id='assess-competency'
                  value={competencyId}
                  onChange={(event) => {
                    setCompetencyId(event.target.value);
                    const next = choices.find(
                      (c) => c.competencyId === event.target.value,
                    );
                    setLevel(next ? String(next.currentLevel) : '');
                  }}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.choose')}
                  </NativeSelectOption>
                  {choices.map((c) => (
                    <NativeSelectOption
                      key={c.competencyId}
                      value={c.competencyId}
                    >
                      {c.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {selected ? (
              <Field>
                <FieldLabel htmlFor='assess-level'>
                  {t('talent.assess.level', { title: selected.title })}
                </FieldLabel>
                <NativeSelect
                  id='assess-level'
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.choose')}
                  </NativeSelectOption>
                  {Array.from({ length: selected.maxLevel + 1 }, (_, value) => {
                    const described = selected.levels.find(
                      (l) => l.level === value,
                    );
                    return (
                      <NativeSelectOption key={value} value={String(value)}>
                        {value === 0
                          ? t('talent.assess.levelZero')
                          : `L${value}${described ? ` · ${described.title}` : ''}`}
                      </NativeSelectOption>
                    );
                  })}
                </NativeSelect>
                {level && Number(level) > 0 ? (
                  <FieldDescription>
                    {
                      selected.levels.find((l) => l.level === Number(level))
                        ?.behaviors
                    }
                  </FieldDescription>
                ) : null}
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor='assess-evidence'>
                {t('talent.assess.evidence')}
              </FieldLabel>
              <Textarea
                id='assess-evidence'
                value={evidence}
                maxLength={4000}
                onChange={(event) => setEvidence(event.target.value)}
                placeholder={t('talent.assess.evidencePlaceholder')}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
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
          <Button type='submit' form='assessment-form' disabled={saving}>
            {saving ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.assess.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
