/**
 * V2-06 工资条: the lines of one payslip, each expandable to show how it was
 * calculated and where the values came from; reference items (such as a
 * piece count) listed apart; the totals below. Used by 我的工资条 and the
 * payroll specialist's payslip drawer. Works at phone width.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { ChevronDownIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';

import { useMoney, useNumber } from './payroll-hooks.js';

export interface PayslipLineView {
  code: string;
  title: string;
  kind: 'earning' | 'deduction' | 'reference' | 'adjustment';
  calc: 'fixed' | 'formula' | 'manual' | 'imported';
  amount: number | null;
  value: number | null;
  unit: string | null;
  formula: string | null;
  expression: string | null;
  sources: { name: string; value: number; source: string }[];
}

export interface PayslipTotals {
  gross: number | null;
  socialEmployee: number | null;
  housingFundEmployee: number | null;
  tax: number | null;
  net: number | null;
}

function LineDetail({ line }: { line: PayslipLineView }): ReactElement {
  const { t } = useTranslation();
  const number = useNumber();
  return (
    <div className='space-y-1 rounded-md bg-muted/50 p-3 text-sm'>
      <p>
        <span className='text-muted-foreground'>
          {t('payroll.payslip.calc')}：
        </span>
        {t(`payroll.calc.${line.calc}`)}
      </p>
      {line.formula ? (
        <p className='break-words'>
          <span className='text-muted-foreground'>
            {t('payroll.payslip.formula')}：
          </span>
          <code className='font-mono text-xs'>{line.formula}</code>
        </p>
      ) : null}
      {line.expression ? (
        <p className='break-words'>
          <span className='text-muted-foreground'>
            {t('payroll.payslip.expression')}：
          </span>
          {line.expression}
        </p>
      ) : null}
      {line.sources.length ? (
        <ul className='space-y-0.5'>
          {line.sources.map((source) => (
            <li key={source.name} className='flex flex-wrap gap-x-2'>
              <code className='font-mono text-xs'>{source.name}</code>
              <span>= {number(source.value)}</span>
              <span className='text-muted-foreground'>
                {t(`payroll.source.${source.source}`, {
                  defaultValue: source.source,
                })}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LineRow({ line }: { line: PayslipLineView }): ReactElement {
  const money = useMoney();
  const number = useNumber();
  const { t } = useTranslation();
  const amount =
    line.kind === 'reference'
      ? `${number(line.value)}${line.unit ? ` ${line.unit}` : ''}`
      : `${line.kind === 'deduction' ? '−' : ''}${money(line.amount)}`;
  return (
    <Collapsible>
      <CollapsibleTrigger className='flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-muted'>
        <span className='flex min-w-0 items-center gap-2'>
          <ChevronDownIcon
            aria-hidden
            className='size-4 shrink-0 text-muted-foreground'
          />
          <span className='truncate'>{line.title}</span>
          {line.kind === 'adjustment' ? (
            <span className='text-xs text-muted-foreground'>
              {t('payroll.payslip.manual')}
            </span>
          ) : null}
        </span>
        <span className='shrink-0 tabular-nums'>{amount}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className='px-2 pb-2'>
        <LineDetail line={line} />
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PayslipView({
  lines,
  totals,
}: {
  lines: readonly PayslipLineView[];
  totals: PayslipTotals;
}): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const pay = lines.filter((l) => l.kind !== 'reference');
  const references = lines.filter((l) => l.kind === 'reference');
  return (
    <div className='space-y-4'>
      <section aria-label={t('payroll.payslip.items')} className='space-y-1'>
        {pay.map((line) => (
          <LineRow key={line.code + line.title} line={line} />
        ))}
      </section>
      {references.length ? (
        <section className='space-y-1'>
          <h3 className='px-2 text-sm font-medium text-muted-foreground'>
            {t('payroll.payslip.references')}
          </h3>
          {references.map((line) => (
            <LineRow key={line.code} line={line} />
          ))}
        </section>
      ) : null}
      <Separator />
      <dl className='grid grid-cols-2 gap-x-4 gap-y-2 px-2 text-sm'>
        {(
          [
            ['gross', totals.gross],
            ['socialEmployee', totals.socialEmployee],
            ['housingFundEmployee', totals.housingFundEmployee],
            ['tax', totals.tax],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className='contents'>
            <dt className='text-muted-foreground'>
              {t(`payroll.payslip.${key}`)}
            </dt>
            <dd className='text-right tabular-nums'>
              {key === 'gross' ? '' : '−'}
              {money(value)}
            </dd>
          </div>
        ))}
        <dt className='font-medium'>{t('payroll.payslip.net')}</dt>
        <dd className='text-right text-base font-semibold tabular-nums'>
          {money(totals.net)}
        </dd>
      </dl>
    </div>
  );
}
