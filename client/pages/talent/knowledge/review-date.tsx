import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

import { reviewState } from './types.js';

/** The next review date with its state: due within the notice window, or overdue. */
export function ReviewDate({
  date,
}: {
  date: string | null | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  if (!date) return <span className='text-muted-foreground'>—</span>;
  const state = reviewState(date);
  return (
    <span className='flex flex-wrap items-center gap-2 tabular-nums'>
      {new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
        new Date(`${date}T00:00:00`),
      )}
      {state ? (
        <Badge variant={state === 'overdue' ? 'destructive' : 'secondary'}>
          {t(`knowledgeService.review.${state}`)}
        </Badge>
      ) : null}
    </span>
  );
}
