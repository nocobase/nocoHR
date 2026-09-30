/**
 * V2-06 薪酬与社保: formatting, error messages and status badges the payroll
 * pages share. Amounts are shown with two decimals in the viewer's language.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

const TONE: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  draft: 'outline',
  calculated: 'secondary',
  reviewing: 'secondary',
  pendingApproval: 'default',
  approved: 'default',
  published: 'secondary',
  closed: 'outline',
  pending: 'default',
  rejected: 'destructive',
  active: 'secondary',
  stopped: 'outline',
  uploaded: 'outline',
  reconciled: 'secondary',
  confirmed: 'default',
  disputed: 'destructive',
};

/** A status in the viewer's language, from `payroll.status.<value>`. */
export function PayrollStatus({ value }: { value: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={TONE[value] ?? 'outline'}>
      {t(`payroll.status.${value}`, { defaultValue: value })}
    </Badge>
  );
}

export interface ApprovalStepView {
  level: number;
  title: string;
  status: string;
  decidedByName: string | null;
  decidedAt: string | null;
  comment: string | null;
}

export function ApprovalSteps({
  steps,
}: {
  steps: readonly ApprovalStepView[];
}): ReactElement | null {
  const { t } = useTranslation();
  if (!steps.length) return null;
  return (
    <ol className='space-y-1 text-sm'>
      {steps.map((step) => (
        <li key={step.level} className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground'>
            {t('payroll.approval.level', { level: step.level })}
          </span>
          <span>{step.title}</span>
          <PayrollStatus value={step.status} />
          {step.decidedByName ? (
            <span className='text-muted-foreground'>{step.decidedByName}</span>
          ) : null}
          {step.comment ? <span>「{step.comment}」</span> : null}
        </li>
      ))}
    </ol>
  );
}
