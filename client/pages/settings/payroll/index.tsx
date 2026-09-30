/**
 * V2-06 设置 / 薪酬设置 (`talent.payrollSettings`, hr.payroll): the salary
 * structures (each edited on its own page) and the payroll rules — tax
 * table, minimum wages, anomaly thresholds, approval levels, the bank file
 * columns, the social insurance month and cut-off day, and the AI employee
 * run after a vendor bill is uploaded. Every value is validated again by the
 * server.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { usePayrollError } from '@/components/talent/payroll-hooks';
// V4-12: 薪酬设置 · 绩效系数 (#coefficients).
import { PerformanceCoefficientsCard } from '@/components/talent/performance-payroll';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';

import type { Structure } from '../../talent/payroll/types.js';

interface Settings {
  tax: {
    monthlyDeduction: number;
    brackets: { upTo: number | null; rate: number; quickDeduction: number }[];
  };
  minimumWage: { city: string; amount: number }[];
  thresholds: {
    netChangePercent: number;
    manualItemAmount: number;
    importSpikeFactor: number;
  };
  approval: { levels: { title: string; permissionSet: string }[] };
  bankExport: { columns: string[] };
  vendorBill: { aiEmployee: string | null };
  socialInsurance: {
    baseAdjustMonth: number;
    cutoffDay: number;
    cityByDepartment: { departmentId: string; city: string }[];
  };
  proration: 'workdays';
}

export default function PayrollSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const structures = useRemote<Structure[]>(
    'talent/payroll-settings/structures',
  );
  const settings = useRemote<{ value: Settings; revision: number }>(
    'talent/payroll-settings',
  );
  return (
    <>
      <PageContainer className='max-w-4xl'>
        <PageHeader
          title={t('payroll.settings.title')}
          description={t('payroll.settings.description')}
        />
        <Card>
          <CardHeader>
            <CardTitle>{t('payroll.settings.structures')}</CardTitle>
            <CardDescription>
              {t('payroll.settings.structuresDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {structures.error ? (
              <LoadError error={structures.error} onRetry={structures.reload} />
            ) : !structures.data ? (
              <BlockSkeleton rows={3} />
            ) : (
              <ul className='divide-y'>
                {structures.data.map((s) => (
                  <li
                    key={s.id}
                    className='flex flex-wrap items-center justify-between gap-2 py-3'
                  >
                    <Link
                      className='font-medium underline underline-offset-4'
                      to={`structures/${encodeURIComponent(s.id)}`}
                    >
                      {s.title}
                    </Link>
                    <span className='flex items-center gap-2 text-sm text-muted-foreground'>
                      {t('payroll.settings.itemCount', {
                        count: s.items.length,
                      })}
                      <Badge variant='secondary'>
                        {t(
                          s.active
                            ? 'payroll.settings.active'
                            : 'payroll.settings.inactive',
                        )}
                      </Badge>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
          <CardFooter className='justify-end'>
            <Button
              variant='outline'
              nativeButton={false}
              render={<Link to='structures/new' />}
            >
              <PlusIcon data-icon='inline-start' />
              {t('payroll.settings.newStructure')}
            </Button>
          </CardFooter>
        </Card>
        {settings.error ? (
          <LoadError error={settings.error} onRetry={settings.reload} />
        ) : !settings.data ? (
          <BlockSkeleton rows={4} />
        ) : (
          <RulesCard
            key={settings.data.revision}
            initial={settings.data.value}
            onSaved={settings.reload}
          />
        )}
        {/* V4-12: 绩效系数 — rendered only for those who maintain them (hr.payroll). */}
        <PerformanceCoefficientsCard />
      </PageContainer>
      <Outlet context={{ reload: structures.reload }} />
    </>
  );
}

function RulesCard({
  initial,
  onSaved,
}: {
  initial: Settings;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const [value, setValue] = useState(initial);
  const [minimumWage, setMinimumWage] = useState(
    initial.minimumWage.map((m) => `${m.city}:${m.amount}`).join('，'),
  );
  const [levels, setLevels] = useState(
    initial.approval.levels
      .map((l) => `${l.title}:${l.permissionSet}`)
      .join('，'),
  );
  async function save(): Promise<void> {
    const pairs = (text: string) =>
      text
        .split(/[,，\n]/u)
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => part.split(/[:：]/u).map((p) => p.trim()));
    try {
      await api.request({
        path: 'talent/payroll-settings',
        method: 'PUT',
        json: {
          ...value,
          minimumWage: pairs(minimumWage).map(([city, amount]) => ({
            city,
            amount: Number(amount),
          })),
          approval: {
            levels: pairs(levels).map(([title, permissionSet]) => ({
              title,
              permissionSet,
            })),
          },
        },
      });
      toast.add({ type: 'success', title: t('payroll.common.saved') });
      onSaved();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    }
  }
  const number =
    (path: (s: Settings, n: number) => Settings) =>
    (event: { target: { value: string } }) =>
      setValue(path(value, Number(event.target.value)));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('payroll.settings.rules')}</CardTitle>
        <CardDescription>
          {t('payroll.settings.rulesDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-4 sm:grid-cols-3'>
          <Field>
            <FieldLabel htmlFor='rule-deduction'>
              {t('payroll.settings.monthlyDeduction')}
            </FieldLabel>
            <Input
              id='rule-deduction'
              inputMode='decimal'
              value={value.tax.monthlyDeduction}
              onChange={number((s, n) => ({
                ...s,
                tax: { ...s.tax, monthlyDeduction: n },
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='rule-net'>
              {t('payroll.settings.netChangePercent')}
            </FieldLabel>
            <Input
              id='rule-net'
              inputMode='decimal'
              value={value.thresholds.netChangePercent}
              onChange={number((s, n) => ({
                ...s,
                thresholds: { ...s.thresholds, netChangePercent: n },
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='rule-manual'>
              {t('payroll.settings.manualItemAmount')}
            </FieldLabel>
            <Input
              id='rule-manual'
              inputMode='decimal'
              value={value.thresholds.manualItemAmount}
              onChange={number((s, n) => ({
                ...s,
                thresholds: { ...s.thresholds, manualItemAmount: n },
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='rule-spike'>
              {t('payroll.settings.importSpikeFactor')}
            </FieldLabel>
            <Input
              id='rule-spike'
              inputMode='decimal'
              value={value.thresholds.importSpikeFactor}
              onChange={number((s, n) => ({
                ...s,
                thresholds: { ...s.thresholds, importSpikeFactor: n },
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='rule-month'>
              {t('payroll.settings.baseAdjustMonth')}
            </FieldLabel>
            <Input
              id='rule-month'
              inputMode='numeric'
              value={value.socialInsurance.baseAdjustMonth}
              onChange={number((s, n) => ({
                ...s,
                socialInsurance: { ...s.socialInsurance, baseAdjustMonth: n },
              }))}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='rule-cutoff'>
              {t('payroll.settings.cutoffDay')}
            </FieldLabel>
            <Input
              id='rule-cutoff'
              inputMode='numeric'
              value={value.socialInsurance.cutoffDay}
              onChange={number((s, n) => ({
                ...s,
                socialInsurance: { ...s.socialInsurance, cutoffDay: n },
              }))}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor='rule-wage'>
            {t('payroll.settings.minimumWage')}
          </FieldLabel>
          <Input
            id='rule-wage'
            value={minimumWage}
            onChange={(e) => setMinimumWage(e.target.value)}
          />
          <FieldDescription>
            {t('payroll.settings.minimumWageHint')}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='rule-levels'>
            {t('payroll.settings.approvalLevels')}
          </FieldLabel>
          <Input
            id='rule-levels'
            value={levels}
            onChange={(e) => setLevels(e.target.value)}
          />
          <FieldDescription>
            {t('payroll.settings.approvalLevelsHint')}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='rule-ai'>
            {t('payroll.settings.billAiEmployee')}
          </FieldLabel>
          <Input
            id='rule-ai'
            value={value.vendorBill.aiEmployee ?? ''}
            onChange={(e) =>
              setValue({
                ...value,
                vendorBill: { aiEmployee: e.target.value.trim() || null },
              })
            }
          />
          <FieldDescription>
            {t('payroll.settings.billAiEmployeeHint')}
          </FieldDescription>
        </Field>
        <section className='space-y-1 text-sm'>
          <h3 className='font-medium'>{t('payroll.settings.taxTable')}</h3>
          <p className='text-muted-foreground'>
            {t('payroll.settings.taxTableHint')}
          </p>
          <ul className='grid gap-1 sm:grid-cols-2'>
            {value.tax.brackets.map((b) => (
              <li
                key={`${String(b.upTo)}-${String(b.rate)}`}
                className='tabular-nums'
              >
                {b.upTo === null ? t('payroll.settings.above') : `≤ ${b.upTo}`}{' '}
                · {b.rate}% · {b.quickDeduction}
              </li>
            ))}
          </ul>
        </section>
      </CardContent>
      <CardFooter className='justify-end'>
        <Button onClick={() => void save()}>{t('payroll.common.save')}</Button>
      </CardFooter>
    </Card>
  );
}
