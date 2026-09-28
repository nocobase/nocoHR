import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useMemo, type ReactElement } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import type { AssessmentRow } from './types.js';

/** Assessment history, newest first. */
export function AssessmentHistory({
  rows,
}: {
  rows: readonly AssessmentRow[];
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }),
    [locale],
  );
  if (!rows.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('talent.assess.noHistory')}
      </p>
    );
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.assess.assessedAt')}</TableHead>
            <TableHead>{t('talent.gap.competency')}</TableHead>
            <TableHead className='text-right'>
              {t('talent.assess.levelShort')}
            </TableHead>
            <TableHead>{t('talent.assess.assessedBy')}</TableHead>
            <TableHead>{t('talent.assess.evidence')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='whitespace-nowrap text-muted-foreground'>
                {format.format(new Date(row.assessedAt))}
              </TableCell>
              <TableCell>{row.competencyTitle}</TableCell>
              <TableCell className='text-right tabular-nums'>
                {row.level}
              </TableCell>
              <TableCell>{row.assessedByName}</TableCell>
              <TableCell className='max-w-sm whitespace-normal text-muted-foreground'>
                {row.evidence ?? '—'}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
