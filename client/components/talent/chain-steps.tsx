import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';

import { stepTags, stepTitle } from './chain-text.js';
import type { ApprovalStep } from './types.js';

/** A chain as the previews show it: numbered levels, their approvers and notes. */
export function ChainSteps({
  steps,
  departmentTitle,
}: {
  readonly steps: readonly ApprovalStep[];
  readonly departmentTitle: (id: string | null | undefined) => string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ol className='space-y-2'>
      {steps.map((step) => (
        <li key={step.level} className='flex gap-3 text-sm'>
          <span className='w-5 shrink-0 text-right text-muted-foreground tabular-nums'>
            {step.level}
          </span>
          <div className='min-w-0 flex-1 space-y-1'>
            <p className='font-medium'>{stepTitle(step, t, departmentTitle)}</p>
            <p className='text-muted-foreground'>
              {step.anyHrAdmin ||
              (step.kind === 'hrAdmin' && !step.approverNames?.length)
                ? t('talent.chain.anyHrAdmin')
                : step.approverNames?.length
                  ? step.approverNames.join('、')
                  : '—'}
            </p>
            {stepTags(step, t).length ? (
              <div className='flex flex-wrap gap-1'>
                {stepTags(step, t).map((tag) => (
                  <Badge key={tag} variant='secondary'>
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
