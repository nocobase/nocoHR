/** 算薪周期 · 进度与前提检查: attendance locking, files, enrolments, deductions and imports. */
import { useTranslation } from '@nocobase/i18n/client';
import { CheckCircle2Icon, CircleAlertIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import { useLookups } from '@/components/talent/use-lookups';
// V4-12: 本月发放绩效奖金 — the review cycle perf.coefficient reads.
import { PayrollBonusCycleCard } from '@/components/talent/performance-payroll';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { CycleDetail } from '../types.js';

function Check({
  ok,
  title,
  children,
}: {
  ok: boolean;
  title: string;
  children?: ReactNode;
}): ReactElement {
  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle className='flex items-center gap-2 text-base'>
          {ok ? (
            <CheckCircle2Icon aria-hidden className='size-4 text-primary' />
          ) : (
            <CircleAlertIcon aria-hidden className='size-4 text-destructive' />
          )}
          {title}
        </CardTitle>
      </CardHeader>
      {children ? (
        <CardContent className='text-sm'>{children}</CardContent>
      ) : null}
    </Card>
  );
}

export function OverviewTab({ detail }: { detail: CycleDetail }): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const p = detail.prerequisites;
  const cycle = detail.cycle;
  return (
    <div className='space-y-4'>
      <dl className='grid gap-3 text-sm sm:grid-cols-3'>
        <div>
          <dt className='text-muted-foreground'>
            {t('payroll.cycle.calculatedAt')}
          </dt>
          <dd>
            {cycle.calculatedAt
              ? new Date(cycle.calculatedAt).toLocaleString()
              : '—'}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>
            {t('payroll.cycle.submittedAt')}
          </dt>
          <dd>
            {cycle.submittedAt
              ? new Date(cycle.submittedAt).toLocaleString()
              : '—'}
          </dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>
            {t('payroll.cycle.publishedAt')}
          </dt>
          <dd>
            {cycle.publishedAt
              ? new Date(cycle.publishedAt).toLocaleString()
              : '—'}
          </dd>
        </div>
      </dl>
      {p ? (
        <div className='grid gap-3 md:grid-cols-2'>
          <Check
            ok={p.attendance.ready}
            title={t('payroll.cycle.checks.attendance', {
              count: p.participants,
            })}
          >
            {p.attendance.ready ? (
              t('payroll.cycle.checks.attendanceReady')
            ) : (
              <ul className='space-y-1'>
                {p.attendance.unlocked.map((d) => (
                  <li key={d.departmentId}>
                    {t('payroll.cycle.checks.unlocked', {
                      department:
                        lookups.departmentTitle(d.departmentId) ||
                        d.departmentTitle,
                      count: d.count,
                      names: d.names.join('、'),
                    })}
                  </li>
                ))}
              </ul>
            )}
          </Check>
          <Check
            ok={!p.salaryFiles.missing.length}
            title={t('payroll.cycle.checks.files')}
          >
            {p.salaryFiles.missing.length
              ? t('payroll.cycle.checks.filesMissing', {
                  names: p.salaryFiles.missing.map((m) => m.name).join('、'),
                })
              : t('payroll.cycle.checks.ok')}
          </Check>
          <Check
            ok={!p.insurance.missing.length}
            title={t('payroll.cycle.checks.insurance')}
          >
            {p.insurance.missing.length
              ? t('payroll.cycle.checks.insuranceMissing', {
                  names: p.insurance.missing.map((m) => m.name).join('、'),
                })
              : t('payroll.cycle.checks.ok')}
          </Check>
          <Check ok title={t('payroll.cycle.checks.deductions')}>
            {t('payroll.cycle.checks.deductionsCount', {
              count: p.deductions.count,
            })}
          </Check>
          <Check
            ok={p.imports.every((i) => i.imported >= i.applicable)}
            title={t('payroll.cycle.checks.imports')}
          >
            <ul className='space-y-1'>
              {p.imports.map((item) => (
                <li key={item.code}>
                  {t('payroll.cycle.checks.importProgress', {
                    title: item.title,
                    imported: item.imported,
                    applicable: item.applicable,
                  })}
                </li>
              ))}
            </ul>
          </Check>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.cycle.approverView')}
        </p>
      )}
      {/* V4-12 */}
      {detail.can.calculate ? (
        <PayrollBonusCycleCard
          payrollCycleId={cycle.id}
          bonusCycleId={(cycle as { bonusCycleId?: string | null }).bonusCycleId}
          editable={['draft', 'calculated', 'reviewing'].includes(cycle.status)}
        />
      ) : null}
    </div>
  );
}
