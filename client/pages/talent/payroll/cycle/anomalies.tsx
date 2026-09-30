/** 算薪周期 · 异常清单: the HR assistant's check of the latest calculation, one note per issue. */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

import type { Cycle, Issue } from '../types.js';

export function AnomaliesTab({
  cycle,
  epoch,
}: {
  cycle: Cycle;
  epoch: number;
}): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<{
    review: Cycle['review'];
    calculationId: string | null;
    issues: Issue[];
  }>(`talent/payroll/cycles/${encodeURIComponent(cycle.id)}/anomalies`, {
    epoch,
  });
  if (remote.error)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={4} />;
  const { review, calculationId, issues } = remote.data;
  if (!calculationId)
    return <EmptyState title={t('payroll.anomalies.notCalculated')} />;
  const pending = review?.calculationId !== calculationId;
  return (
    <div className='space-y-4'>
      {pending ? (
        <Alert>
          <AlertDescription>{t('payroll.anomalies.checking')}</AlertDescription>
        </Alert>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.anomalies.checked', {
            at: review ? new Date(review.checkedAt).toLocaleString() : '',
            total: review?.total ?? 0,
            added: review?.added.length ?? 0,
            removed: review?.removed.length ?? 0,
          })}
        </p>
      )}
      {!issues.length && !pending ? (
        <EmptyState title={t('payroll.anomalies.none')} />
      ) : (
        <ul className='space-y-2'>
          {issues.map((issue) => (
            <li key={issue.key} className='space-y-1 rounded-lg border p-3'>
              <div className='flex flex-wrap items-center gap-2'>
                <span className='font-medium'>
                  {issue.name}（{issue.employeeNo}）
                </span>
                <Badge
                  variant={
                    issue.severity === 'warn' ? 'destructive' : 'secondary'
                  }
                >
                  {t(`payroll.anomalies.types.${issue.type}`, {
                    defaultValue: issue.type,
                  })}
                </Badge>
                {issue.noteSource ? (
                  <Badge variant='outline'>
                    {t(`payroll.anomalies.source.${issue.noteSource}`)}
                  </Badge>
                ) : null}
              </div>
              {issue.note ? <p className='text-sm'>{issue.note}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
