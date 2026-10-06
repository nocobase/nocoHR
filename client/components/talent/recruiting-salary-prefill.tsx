/**
 * V2-07 待建档 · 按 Offer 预填: shown beside a new employee in 薪资档案's
 * 待建档 tab when they joined from an accepted offer. The salary file is
 * written only when a payroll specialist confirms it (source=offer).
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { useAction } from '@/components/talent/recruiting-lib';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';

export function RecruitingSalaryPrefill({
  employeeId,
  onDone,
}: {
  employeeId: string;
  onDone: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const prefill = useRemote<{
    filed: boolean;
    baseSalary: number;
    salaryStructureId: string;
    salaryStructureTitle: string | null;
    effectiveMonth: string;
  } | null>(
    `talent/recruiting/salary-prefill/${encodeURIComponent(employeeId)}`,
  );
  const { busy, run } = useAction();
  const data = prefill.data;
  if (!data || data.filed) return null;
  return (
    <span className='flex flex-wrap items-center gap-2 text-xs text-muted-foreground'>
      <span>
        {t('recruiting.prefill.title')} ·{' '}
        {t('recruiting.prefill.detail', {
          amount: Number(data.baseSalary).toLocaleString(),
          structure: data.salaryStructureTitle ?? data.salaryStructureId,
          month: data.effectiveMonth,
        })}
      </span>
      <Button
        size='sm'
        disabled={busy !== null}
        onClick={() => {
          void run(
            'confirm',
            {
              path: `talent/recruiting/salary-prefill/${encodeURIComponent(employeeId)}/confirm`,
              json: {},
            },
            t('recruiting.prefill.confirmed'),
          ).then((done) => {
            if (done) onDone();
          });
        }}
      >
        {t('recruiting.prefill.confirm')}
      </Button>
    </span>
  );
}
