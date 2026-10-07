import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import type { RequirementSourceClause } from './types.js';

/**
 * V3-08 每项注明出自说明书哪一条: "依据：说明书第 N 条（岗位职责 2）「…」"
 * under a drafted requirement. A requirement without clauses (entered by hand,
 * or drafted before clauses were recorded) shows nothing.
 */
export function SourceClauses({
  clauses,
}: {
  readonly clauses: readonly RequirementSourceClause[] | null | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!clauses?.length) return null;
  const text = clauses
    .map((c) =>
      t(
        c.source === 'jd'
          ? 'talent.framework.sourceClauseJd'
          : 'talent.framework.sourceClauseDuties',
        {
          number: c.number,
          quote: c.quote,
          place: c.section
            ? t('talent.framework.sourceClausePlace', {
                place: c.item ? `${c.section} ${c.item}` : c.section,
              })
            : '',
        },
      ),
    )
    .join(' · ');
  return (
    <p className='mt-1 text-xs font-normal text-muted-foreground'>
      {t('talent.framework.sourceBasis', { clauses: text })}
    </p>
  );
}
