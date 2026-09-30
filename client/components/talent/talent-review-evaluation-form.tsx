/**
 * V4-13 培训评估问卷: scale items (1–5, large touch targets so it works at
 * 375 px) and text items, from the administrator's template. Submits once
 * every item is answered; the score is the server's.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export interface EvaluationQuestion {
  key: string;
  title: string;
  kind: 'scale' | 'text';
}

export function EvaluationForm({
  questions,
  initial,
  disabled,
  busy,
  onSubmit,
}: {
  questions: readonly EvaluationQuestion[];
  initial?: Record<string, number | string> | null;
  disabled?: boolean;
  busy?: boolean;
  onSubmit: (answers: Record<string, number | string>) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [answers, setAnswers] = useState<Record<string, number | string>>(initial ?? {});
  const complete = questions.every((q) =>
    q.kind === 'scale' ? typeof answers[q.key] === 'number' : String(answers[q.key] ?? '').trim(),
  );
  return (
    <form
      className='flex flex-col gap-5'
      onSubmit={(event) => {
        event.preventDefault();
        if (complete) onSubmit(answers);
      }}
    >
      {questions.map((q, index) => (
        <fieldset key={q.key} className='flex flex-col gap-2' disabled={disabled}>
          <legend className='mb-1 text-sm font-medium'>
            {index + 1}. {q.title}
          </legend>
          {q.kind === 'scale' ? (
            <div className='grid grid-cols-5 gap-2' role='radiogroup' aria-label={q.title}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type='button'
                  role='radio'
                  aria-checked={answers[q.key] === n}
                  aria-label={t('talentReview.evaluations.scaleValue', { value: n })}
                  onClick={() => setAnswers((a) => ({ ...a, [q.key]: n }))}
                  className={cn(
                    'h-11 rounded-md border text-base tabular-nums',
                    answers[q.key] === n ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-accent',
                  )}
                >
                  {n}
                </button>
              ))}
              <span className='text-muted-foreground col-span-2 text-xs'>{t('talentReview.evaluations.scaleLow')}</span>
              <span className='text-muted-foreground col-span-3 text-end text-xs'>{t('talentReview.evaluations.scaleHigh')}</span>
            </div>
          ) : (
            <Textarea
              aria-label={q.title}
              value={String(answers[q.key] ?? '')}
              onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
            />
          )}
        </fieldset>
      ))}
      {disabled ? null : (
        <Button type='submit' disabled={busy || !complete} className='w-full sm:w-auto sm:self-end'>
          {t('talentReview.evaluations.submit')}
        </Button>
      )}
    </form>
  );
}
