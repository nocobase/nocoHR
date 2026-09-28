import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement, ReactNode } from 'react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { ContractStatusBadge } from './badges.js';
import type { Contract } from './types.js';

export function ContractTable({
  rows,
  showEmployee = false,
  action,
}: {
  rows: readonly Contract[];
  showEmployee?: boolean;
  action?: (row: Contract) => ReactNode;
}): ReactElement {
  const { t } = useTranslation();
  if (!rows.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('talent.contracts.empty')}
      </p>
    );
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.contracts.contractNo')}</TableHead>
            {showEmployee ? (
              <TableHead>{t('talent.fields.name')}</TableHead>
            ) : null}
            <TableHead>{t('talent.contracts.type')}</TableHead>
            <TableHead>{t('talent.contracts.period')}</TableHead>
            <TableHead className='text-right'>
              {t('talent.contracts.remainingDays')}
            </TableHead>
            <TableHead>{t('talent.fields.status')}</TableHead>
            {action ? (
              <TableHead className='text-right'>
                {t('talent.common.actions')}
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className='font-medium'>{row.contractNo}</TableCell>
              {showEmployee ? <TableCell>{row.employeeName}</TableCell> : null}
              <TableCell>{t(`talent.contractType.${row.type}`)}</TableCell>
              <TableCell className='whitespace-nowrap tabular-nums'>
                {row.startDate} –{' '}
                {row.endDate ?? t('talent.contracts.openEnded')}
              </TableCell>
              <TableCell
                className={cn(
                  'text-right tabular-nums',
                  row.status === 'active' &&
                    row.remainingDays !== null &&
                    row.remainingDays <= 60 &&
                    'font-semibold text-destructive',
                )}
              >
                {row.status === 'active' && row.remainingDays !== null
                  ? row.remainingDays
                  : '—'}
              </TableCell>
              <TableCell>
                <ContractStatusBadge status={row.status} />
              </TableCell>
              {action ? (
                <TableCell className='text-right'>{action(row)}</TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
