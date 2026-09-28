import { useTranslation } from '@nocobase/i18n/client';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { Fragment, useState, type ReactElement, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { CategoryBadge } from './badges.js';
import type { GapRow } from './types.js';

export interface GapTableProps {
  readonly rows: readonly GapRow[];
  /** Rendered in a trailing column, such as an "Assess" button. */
  readonly action?: (row: GapRow) => ReactNode;
  /** Rendered under the competency name, such as links to courses that close the gap. */
  readonly extra?: (row: GapRow) => ReactNode;
}

/**
 * Position requirements against current levels. Rows with a gap are
 * highlighted; clicking a competency expands its level descriptions.
 */
export function GapTable({ rows, action, extra }: GapTableProps): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.gap.competency')}</TableHead>
            <TableHead className='hidden sm:table-cell'>
              {t('talent.gap.category')}
            </TableHead>
            <TableHead className='text-right'>
              {t('talent.gap.required')}
            </TableHead>
            <TableHead className='text-right'>
              {t('talent.gap.current')}
            </TableHead>
            <TableHead className='text-right'>{t('talent.gap.gap')}</TableHead>
            <TableHead>{t('talent.gap.mandatory')}</TableHead>
            {action ? (
              <TableHead className='text-right'>
                {t('talent.common.actions')}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const expanded = open === row.competencyId;
            return (
              <Fragment key={row.competencyId}>
                <TableRow className={cn(row.gap > 0 && 'bg-destructive/5')}>
                  <TableCell>
                    <button
                      type='button'
                      className='inline-flex items-center gap-1 text-left font-medium hover:underline'
                      aria-expanded={expanded}
                      onClick={() =>
                        setOpen(expanded ? null : row.competencyId)
                      }
                    >
                      {expanded ? (
                        <ChevronDownIcon className='size-4' />
                      ) : (
                        <ChevronRightIcon className='size-4' />
                      )}
                      {row.title}
                    </button>
                    {extra ? extra(row) : null}
                  </TableCell>
                  <TableCell className='hidden sm:table-cell'>
                    <CategoryBadge category={row.category} />
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {row.requiredLevel ?? '—'}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {row.currentLevel}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      row.gap > 0 && 'font-semibold text-destructive',
                    )}
                  >
                    {row.requiredLevel === null ? '—' : row.gap}
                  </TableCell>
                  <TableCell>
                    {row.requiredLevel === null ? (
                      <span className='text-muted-foreground'>
                        {t('talent.gap.extra')}
                      </span>
                    ) : row.mandatory ? (
                      <Badge variant='default'>
                        {t('talent.gap.mandatoryYes')}
                      </Badge>
                    ) : (
                      <span className='text-muted-foreground'>
                        {t('talent.gap.mandatoryNo')}
                      </span>
                    )}
                  </TableCell>
                  {action ? (
                    <TableCell className='text-right'>{action(row)}</TableCell>
                  ) : null}
                </TableRow>
                {expanded ? (
                  <TableRow className='hover:bg-transparent'>
                    <TableCell colSpan={action ? 7 : 6} className='bg-muted/40'>
                      {row.levels.length ? (
                        <ol className='space-y-1.5 py-1 text-sm'>
                          {row.levels.map((level) => (
                            <li
                              key={level.id}
                              className={cn(
                                'flex gap-2',
                                level.level === row.currentLevel &&
                                  'font-medium',
                              )}
                            >
                              <span className='w-24 shrink-0 text-muted-foreground'>
                                L{level.level} · {level.title}
                              </span>
                              <span className='whitespace-normal'>
                                {level.behaviors}
                              </span>
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p className='text-sm text-muted-foreground'>
                          {t('talent.gap.noLevels')}
                        </p>
                      )}
                    </TableCell>
                  </TableRow>
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** A compact trailing button for a row action. */
export function RowActionButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}): ReactElement {
  return (
    <Button size='sm' variant='outline' onClick={onClick}>
      {children}
    </Button>
  );
}
