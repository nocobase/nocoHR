/** 算薪周期 · 工资条 (drawer): one employee's lines, manual items and issues, for the payroll specialist. */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { PayslipView } from '@/components/talent/payroll-payslip';
import { useMoney } from '@/components/talent/payroll-hooks';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';

import type { PayslipDetail } from '../types.js';

export default function CyclePayslipDrawer(): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const { cycleId = '', payslipId = '' } = useParams();
  const slip = useRemote<PayslipDetail>(
    `talent/payroll/cycles/${encodeURIComponent(cycleId)}/payslips/${encodeURIComponent(payslipId)}`,
  );
  const data = slip.data;
  return (
    <RouteDrawer
      title={
        data ? `${data.name}（${data.employeeNo}）` : t('payroll.payslip.title')
      }
      description={data ? `${data.month} · ${data.departmentTitle}` : undefined}
    >
      {slip.error ? (
        <LoadError error={slip.error} onRetry={slip.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : !data.lines ? (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.sheet.notCalculated')}
        </p>
      ) : (
        <div className='space-y-4'>
          <PayslipView lines={data.lines} totals={data} />
          {data.manualItems.length ? (
            <section className='space-y-1 text-sm'>
              <h3 className='font-medium'>{t('payroll.sheet.manualTitle')}</h3>
              <ul>
                {data.manualItems.map((item, index) => (
                  <li key={`${item.code}-${String(index)}`}>
                    {money(item.amount)} · {item.reason}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.issues.length ? (
            <section className='space-y-1 text-sm'>
              <h3 className='font-medium'>
                {t('payroll.cycle.tabs.anomalies')}
              </h3>
              <ul className='space-y-1'>
                {data.issues.map((issue) => (
                  <li key={issue.key}>
                    {t(`payroll.anomalies.types.${issue.type}`, {
                      defaultValue: issue.type,
                    })}
                    {issue.note ? `：${issue.note}` : ''}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </RouteDrawer>
  );
}
