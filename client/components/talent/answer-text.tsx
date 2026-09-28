import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import type { QuestionOption, QuestionType } from './exam-types.js';
import { str } from './text.js';

/** A response or an answer as readable text for its question type. */
export function AnswerText({
  type,
  value,
  options,
}: {
  type: QuestionType;
  value: unknown;
  options: readonly QuestionOption[];
}): ReactElement {
  const { t } = useTranslation();
  const label = (key: string) => {
    const option = options.find((o) => o.key === key);
    return option ? `${key}. ${option.text}` : key;
  };
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  )
    return <span>{t('talent.exams.noAnswer')}</span>;
  switch (type) {
    case 'single':
      return <span>{label(str(value))}</span>;
    case 'multiple':
      return (
        <span>
          {(value as unknown[]).map((v) => label(String(v))).join('；')}
        </span>
      );
    case 'judge':
      return (
        <span>
          {value === true
            ? t('talent.questions.judge.true')
            : t('talent.questions.judge.false')}
        </span>
      );
    case 'blank':
      return (
        <span>
          {(value as unknown[])
            .map(
              (blank, i) =>
                `${i + 1}. ${Array.isArray(blank) ? blank.join(' / ') : str(blank ?? '')}`,
            )
            .join('；')}
        </span>
      );
    case 'short':
      return <span className='whitespace-pre-wrap'>{str(value)}</span>;
  }
}
