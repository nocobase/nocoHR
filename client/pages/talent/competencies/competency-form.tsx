import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorDetails, errorMessage } from '@/components/talent/errors';
import {
  Field,
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import {
  CATEGORIES,
  type CompetencyItem,
  type CompetencyLevel,
} from './types.js';

export interface CompetencyFormProps {
  readonly formId: string;
  readonly competency?: CompetencyItem;
  readonly disabled?: boolean;
  readonly onSubmittingChange: (value: boolean) => void;
  readonly onSubmitted: (competency: CompetencyItem) => void;
}

/** Basic information and the per-level names and behaviours, edited together. */
export function CompetencyForm({
  formId,
  competency,
  disabled = false,
  onSubmittingChange,
  onSubmitted,
}: CompetencyFormProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [draft, setDraft] = useState({
    code: competency?.code ?? '',
    title: competency?.title ?? '',
    category: competency?.category ?? 'skill',
    description: competency?.description ?? '',
    maxLevel: String(competency?.maxLevel ?? 5),
  });
  const [levels, setLevels] = useState<CompetencyLevel[]>(
    () =>
      competency?.levels.map((l) => ({
        level: l.level,
        title: l.title,
        behaviors: l.behaviors,
      })) ?? [],
  );
  const [error, setError] = useState<string>();
  const [conflicts, setConflicts] = useState<string[]>([]);
  const maxLevel = Number(draft.maxLevel);
  const rows = Array.from(
    { length: maxLevel },
    (_, i) =>
      levels.find((l) => l.level === i + 1) ?? {
        level: i + 1,
        title: '',
        behaviors: '',
      },
  );

  const setLevel = (level: number, key: 'title' | 'behaviors', value: string) =>
    setLevels((current) => {
      const existing = current.find((l) => l.level === level);
      if (existing)
        return current.map((l) =>
          l.level === level ? { ...l, [key]: value } : l,
        );
      return [...current, { level, title: '', behaviors: '', [key]: value }];
    });

  async function submit(): Promise<void> {
    if (!draft.code.trim() || !draft.title.trim()) {
      setError(t('talent.form.required'));
      return;
    }
    const filled = rows.filter((r) => r.title.trim() || r.behaviors.trim());
    if (filled.some((r) => !r.title.trim() || !r.behaviors.trim())) {
      setError(t('talent.competencies.levelsIncomplete'));
      return;
    }
    onSubmittingChange(true);
    setError(undefined);
    setConflicts([]);
    try {
      const { data } = await api.request<{ data: CompetencyItem }>({
        path: competency
          ? `talent/competencies/${encodeURIComponent(competency.id)}`
          : 'talent/competencies',
        method: competency ? 'PATCH' : 'POST',
        json: {
          code: draft.code.trim(),
          title: draft.title.trim(),
          category: draft.category,
          description: draft.description.trim() || null,
          maxLevel,
          levels: filled.map((r) => ({
            level: r.level,
            title: r.title.trim(),
            behaviors: r.behaviors.trim(),
          })),
        },
      });
      toast.add({
        type: 'success',
        title: t('talent.competencies.saved', { title: data.title }),
      });
      onSubmittingChange(false);
      onSubmitted(data);
    } catch (cause) {
      setError(errorMessage(cause, t));
      const details = errorDetails(cause) as
        | {
            requirements?: { positionId: string; requiredLevel: number }[];
            assessments?: { employeeId: string; level: number }[];
          }
        | undefined;
      if (details) {
        setConflicts([
          ...(details.requirements ?? []).map((r) =>
            t('talent.competencies.conflictRequirement', {
              position: r.positionId,
              level: r.requiredLevel,
            }),
          ),
          ...(details.assessments ?? []).map((a) =>
            t('talent.competencies.conflictAssessment', {
              employee: a.employeeId,
              level: a.level,
            }),
          ),
        ]);
      }
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
      <fieldset disabled={disabled} className='contents'>
        <FieldGroup>
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='comp-code'>
                {t('talent.framework.code')}
              </FieldLabel>
              <Input
                id='comp-code'
                value={draft.code}
                maxLength={64}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, code: e.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='comp-title'>
                {t('talent.framework.titleField')}
              </FieldLabel>
              <Input
                id='comp-title'
                value={draft.title}
                maxLength={200}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, title: e.target.value }))
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='comp-category'>
                {t('talent.gap.category')}
              </FieldLabel>
              <NativeSelect
                id='comp-category'
                value={draft.category}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    category: e.target.value,
                    maxLevel:
                      e.target.value === 'qualification' ? '1' : d.maxLevel,
                  }))
                }
              >
                {CATEGORIES.map((c) => (
                  <NativeSelectOption key={c} value={c}>
                    {t(`talent.category.${c}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='comp-max'>
                {t('talent.competencies.maxLevel')}
              </FieldLabel>
              <NativeSelect
                id='comp-max'
                value={draft.maxLevel}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, maxLevel: e.target.value }))
                }
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <NativeSelectOption key={n} value={String(n)}>
                    {n}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor='comp-description'>
              {t('talent.framework.descriptionField')}
            </FieldLabel>
            <Textarea
              id='comp-description'
              value={draft.description}
              onChange={(e) =>
                setDraft((d) => ({ ...d, description: e.target.value }))
              }
            />
          </Field>
          <FieldSet>
            <FieldLegend>{t('talent.competencies.levels')}</FieldLegend>
            {rows.map((row) => (
              <div
                key={row.level}
                className='grid gap-2 sm:grid-cols-[3rem_10rem_1fr]'
              >
                <span className='pt-2 text-sm font-medium text-muted-foreground'>
                  L{row.level}
                </span>
                <Input
                  aria-label={t('talent.competencies.levelTitle', {
                    level: row.level,
                  })}
                  placeholder={t('talent.competencies.levelTitlePlaceholder')}
                  value={row.title}
                  onChange={(e) => setLevel(row.level, 'title', e.target.value)}
                />
                <Textarea
                  aria-label={t('talent.competencies.levelBehaviors', {
                    level: row.level,
                  })}
                  placeholder={t(
                    'talent.competencies.levelBehaviorsPlaceholder',
                  )}
                  rows={2}
                  value={row.behaviors}
                  onChange={(e) =>
                    setLevel(row.level, 'behaviors', e.target.value)
                  }
                />
              </div>
            ))}
          </FieldSet>
          {error ? <FieldError>{error}</FieldError> : null}
          {conflicts.length ? (
            <ul className='list-disc pl-5 text-sm text-destructive'>
              {conflicts.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          ) : null}
        </FieldGroup>
      </fieldset>
    </form>
  );
}
