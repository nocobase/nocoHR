/** 算薪周期 · 导出文件: bank payment, tax declaration and accounting summary, after publishing; each download is logged. */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { downloadFile } from '@/components/talent/download';
import { usePayrollError } from '@/components/talent/payroll-hooks';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';

import type { CycleDetail } from '../types.js';

const KINDS = ['bank', 'tax', 'accounting'] as const;

export function ExportsTab({ detail }: { detail: CycleDetail }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const cycle = detail.cycle;
  const ready = cycle.status === 'published' || cycle.status === 'closed';
  return (
    <div className='space-y-4'>
      {!ready ? (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.exports.notReady')}
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {KINDS.map((kind) => (
          <Button
            key={kind}
            variant='outline'
            disabled={!ready || !detail.can.export}
            onClick={() =>
              void downloadFile(
                api,
                `talent/payroll/cycles/${encodeURIComponent(cycle.id)}/exports/${kind}`,
                `${cycle.month}-${kind}.csv`,
              ).catch((cause: unknown) =>
                toast.add({ type: 'error', title: failure(cause) }),
              )
            }
          >
            <DownloadIcon data-icon='inline-start' />
            {t(`payroll.exports.kinds.${kind}`)}
          </Button>
        ))}
      </div>
      {cycle.exports.length ? (
        <ul className='space-y-1 text-sm text-muted-foreground'>
          {cycle.exports.map((entry, index) => (
            <li key={`${entry.kind}-${entry.at}-${String(index)}`}>
              {t(`payroll.exports.log.${entry.action}`, {
                kind: t(`payroll.exports.kinds.${entry.kind}`, {
                  defaultValue: entry.kind,
                }),
                at: new Date(entry.at).toLocaleString(),
              })}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
