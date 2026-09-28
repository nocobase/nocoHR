import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, QuoteIcon, Trash2Icon } from 'lucide-react';
import { useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { Question, QuestionType } from '@/components/talent/exam-types';
import { MultiCheckList } from '@/components/talent/multi-check';
import { useRemote } from '@/components/talent/use-remote';
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { DIFFICULTIES, QUESTION_TYPES } from './options.js';

interface Draft {
  type: QuestionType;
  stem: string;
  options: { key: string; text: string }[];
  single: string;
  multiple: string[];
  judge: boolean;
  blanks: string[];
  short: string;
  explanation: string;
  gradingNotes: string;
  difficulty: string;
  competencyIds: string[];
}

const letters = (count: number) =>
  Array.from({ length: count }, (_, i) => String.fromCharCode(65 + i));

function fromQuestion(question: Question | null): Draft {
  const answer = question?.answer;
  return {
    type: question?.type ?? 'single',
    stem: question?.stem ?? '',
    options: question?.options.length
      ? question.options.map((o) => ({ ...o }))
      : letters(4).map((key) => ({ key, text: '' })),
    single:
      question?.type === 'single' && typeof answer === 'string' ? answer : '',
    multiple:
      question?.type === 'multiple' && Array.isArray(answer)
        ? answer.map(String)
        : [],
    judge: question?.type === 'judge' ? answer === true : true,
    blanks:
      question?.type === 'blank' && Array.isArray(answer)
        ? answer.map((b) => (Array.isArray(b) ? b.join(' / ') : String(b)))
        : [''],
    short:
      question?.type === 'short' && typeof answer === 'string' ? answer : '',
    explanation: question?.explanation ?? '',
    gradingNotes: question?.gradingNotes ?? '',
    difficulty: question?.difficulty ?? 'medium',
    competencyIds: question?.competencies.map((c) => c.id) ?? [],
  };
}

/** Create or edit a question; the answer editor follows the question type. */
export function QuestionDialog({
  open,
  onOpenChange,
  question,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question: Question | null;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const competencies = useRemote<{
    competencies: {
      id: string;
      title: string;
      category: string;
      reviewStatus: string;
      active: boolean;
    }[];
  }>(open ? 'talent/competencies' : null);
  const [draft, setDraft] = useState<Draft>(() => fromQuestion(question));
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Opening the dialog, or opening it for another question, starts from that question.
  const [synced, setSynced] = useState<{
    open: boolean;
    source: typeof question;
  }>({
    open: false,
    source: null,
  });
  if (synced.open !== open || (open && synced.source !== question)) {
    setSynced({ open, source: question });
    if (open) {
      setDraft(fromQuestion(question));
      setError(undefined);
    }
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const choice = draft.type === 'single' || draft.type === 'multiple';

  function answer(): unknown {
    switch (draft.type) {
      case 'single':
        return draft.single;
      case 'multiple':
        return [...draft.multiple].sort();
      case 'judge':
        return draft.judge;
      case 'blank':
        return draft.blanks.map((b) =>
          b
            .split('/')
            .map((a) => a.trim())
            .filter(Boolean),
        );
      case 'short':
        return draft.short.trim();
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        type: draft.type,
        stem: draft.stem,
        options: choice ? draft.options.filter((o) => o.text.trim()) : [],
        answer: answer(),
        explanation: draft.explanation || null,
        gradingNotes:
          draft.type === 'short' ? draft.gradingNotes || null : null,
        difficulty: draft.difficulty,
        competencyIds: draft.competencyIds,
        sourceDocumentId: question?.sourceDocumentId ?? null,
        sourceExcerpt: question?.sourceExcerpt ?? null,
      };
      if (question)
        await api.request({
          path: `talent/questions/${encodeURIComponent(question.id)}`,
          method: 'PATCH',
          json,
        });
      else
        await api.request({ path: 'talent/questions', method: 'POST', json });
      toast.add({ type: 'success', title: t('talent.questions.saved') });
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {question
              ? t('talent.questions.editTitle')
              : t('talent.questions.createTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('talent.questions.dialogDescription')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='question-form'
          onSubmit={(e) => void submit(e)}
          className='max-h-[65svh] overflow-y-auto pr-1'
        >
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='question-type'>
                  {t('talent.questions.fields.type')}
                </FieldLabel>
                <NativeSelect
                  id='question-type'
                  className='w-full'
                  value={draft.type}
                  disabled={Boolean(question)}
                  onChange={(e) => set('type', e.target.value as QuestionType)}
                >
                  {QUESTION_TYPES.map((type) => (
                    <NativeSelectOption key={type} value={type}>
                      {t(`talent.questionType.${type}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='question-difficulty'>
                  {t('talent.questions.fields.difficulty')}
                </FieldLabel>
                <NativeSelect
                  id='question-difficulty'
                  className='w-full'
                  value={draft.difficulty}
                  onChange={(e) => set('difficulty', e.target.value)}
                >
                  {DIFFICULTIES.map((d) => (
                    <NativeSelectOption key={d} value={d}>
                      {t(`talent.difficulty.${d}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor='question-stem'>
                {t('talent.questions.fields.stem')}
              </FieldLabel>
              <Textarea
                id='question-stem'
                rows={3}
                value={draft.stem}
                onChange={(e) => set('stem', e.target.value)}
              />
              {draft.type === 'blank' ? (
                <FieldDescription>
                  {t('talent.questions.blankHint')}
                </FieldDescription>
              ) : null}
            </Field>
            {choice ? (
              <Field>
                <FieldLabel>{t('talent.questions.fields.options')}</FieldLabel>
                <div className='space-y-2'>
                  {draft.options.map((option, index) => (
                    <div key={option.key} className='flex items-center gap-2'>
                      {draft.type === 'single' ? (
                        <input
                          type='radio'
                          name='single-answer'
                          aria-label={t('talent.questions.markCorrect', {
                            key: option.key,
                          })}
                          checked={draft.single === option.key}
                          onChange={() => set('single', option.key)}
                          className='size-4 accent-primary'
                        />
                      ) : (
                        <Checkbox
                          aria-label={t('talent.questions.markCorrect', {
                            key: option.key,
                          })}
                          checked={draft.multiple.includes(option.key)}
                          onCheckedChange={(checked) =>
                            set(
                              'multiple',
                              checked === true
                                ? [...draft.multiple, option.key]
                                : draft.multiple.filter(
                                    (k) => k !== option.key,
                                  ),
                            )
                          }
                        />
                      )}
                      <span className='w-5 text-sm font-medium'>
                        {option.key}
                      </span>
                      <Input
                        value={option.text}
                        onChange={(e) =>
                          set(
                            'options',
                            draft.options.map((o, i) =>
                              i === index ? { ...o, text: e.target.value } : o,
                            ),
                          )
                        }
                        aria-label={t('talent.questions.optionText', {
                          key: option.key,
                        })}
                      />
                      <Button
                        type='button'
                        size='icon-sm'
                        variant='ghost'
                        aria-label={t('talent.common.remove')}
                        disabled={draft.options.length <= 2}
                        onClick={() => {
                          const next = draft.options
                            .filter((_, i) => i !== index)
                            .map((o, i) => ({ ...o, key: letters(8)[i] }));
                          setDraft((current) => ({
                            ...current,
                            options: next,
                            single: '',
                            multiple: [],
                          }));
                        }}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  {draft.options.length < 8 ? (
                    <Button
                      type='button'
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        set('options', [
                          ...draft.options,
                          { key: letters(8)[draft.options.length], text: '' },
                        ])
                      }
                    >
                      <PlusIcon data-icon='inline-start' />
                      {t('talent.questions.addOption')}
                    </Button>
                  ) : null}
                </div>
                <FieldDescription>
                  {draft.type === 'single'
                    ? t('talent.questions.singleHint')
                    : t('talent.questions.multipleHint')}
                </FieldDescription>
              </Field>
            ) : null}
            {draft.type === 'judge' ? (
              <Field>
                <FieldLabel>{t('talent.questions.fields.answer')}</FieldLabel>
                <RadioGroup
                  value={draft.judge ? 'true' : 'false'}
                  onValueChange={(v) => set('judge', v === 'true')}
                  className='flex gap-6'
                >
                  {(['true', 'false'] as const).map((v) => (
                    <label key={v} className='flex items-center gap-2 text-sm'>
                      <RadioGroupItem value={v} />
                      {t(`talent.questions.judge.${v}`)}
                    </label>
                  ))}
                </RadioGroup>
              </Field>
            ) : null}
            {draft.type === 'blank' ? (
              <Field>
                <FieldLabel>{t('talent.questions.fields.answer')}</FieldLabel>
                <div className='space-y-2'>
                  {draft.blanks.map((blank, index) => (
                    <div key={index} className='flex items-center gap-2'>
                      <span className='w-16 shrink-0 text-sm text-muted-foreground'>
                        {t('talent.questions.blankN', { index: index + 1 })}
                      </span>
                      <Input
                        value={blank}
                        onChange={(e) =>
                          set(
                            'blanks',
                            draft.blanks.map((b, i) =>
                              i === index ? e.target.value : b,
                            ),
                          )
                        }
                      />
                      <Button
                        type='button'
                        size='icon-sm'
                        variant='ghost'
                        aria-label={t('talent.common.remove')}
                        disabled={draft.blanks.length <= 1}
                        onClick={() =>
                          set(
                            'blanks',
                            draft.blanks.filter((_, i) => i !== index),
                          )
                        }
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type='button'
                    size='sm'
                    variant='outline'
                    onClick={() => set('blanks', [...draft.blanks, ''])}
                  >
                    <PlusIcon data-icon='inline-start' />
                    {t('talent.questions.addBlank')}
                  </Button>
                </div>
                <FieldDescription>
                  {t('talent.questions.alternativesHint')}
                </FieldDescription>
              </Field>
            ) : null}
            {draft.type === 'short' ? (
              <>
                <Field>
                  <FieldLabel htmlFor='question-short'>
                    {t('talent.questions.fields.referenceAnswer')}
                  </FieldLabel>
                  <Textarea
                    id='question-short'
                    rows={3}
                    value={draft.short}
                    onChange={(e) => set('short', e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='question-notes'>
                    {t('talent.questions.fields.gradingNotes')}
                  </FieldLabel>
                  <Textarea
                    id='question-notes'
                    rows={2}
                    value={draft.gradingNotes}
                    onChange={(e) => set('gradingNotes', e.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <Field>
              <FieldLabel htmlFor='question-explanation'>
                {t('talent.questions.fields.explanation')}
              </FieldLabel>
              <Textarea
                id='question-explanation'
                rows={2}
                value={draft.explanation}
                onChange={(e) => set('explanation', e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel>
                {t('talent.questions.fields.competencies')}
              </FieldLabel>
              <MultiCheckList
                options={(competencies.data?.competencies ?? [])
                  .filter((c) => c.active && c.reviewStatus === 'confirmed')
                  .map((c) => ({
                    value: c.id,
                    label: c.title,
                    hint: t(`talent.category.${c.category}`),
                  }))}
                value={draft.competencyIds}
                onChange={(next) => set('competencyIds', next)}
                label={t('talent.questions.fields.competencies')}
                height='h-28'
              />
            </Field>
            {question?.sourceExcerpt ? (
              <div className='rounded-md border bg-muted/40 p-3 text-sm'>
                <p className='mb-1 flex items-center gap-1.5 font-medium'>
                  <QuoteIcon className='size-4' />
                  {t('talent.questions.sourceExcerpt')}
                  {question.sourceDocumentTitle ? (
                    <span className='font-normal text-muted-foreground'>
                      · {question.sourceDocumentTitle}
                    </span>
                  ) : null}
                </p>
                <p className='whitespace-pre-wrap text-muted-foreground'>
                  {question.sourceExcerpt}
                </p>
              </div>
            ) : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='question-form' disabled={busy}>
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
