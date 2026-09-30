/**
 * 薪资档案详情 (drawer): the file history (never edited, only added to) and
 * the employee's adjustments; for 待建档, the form that creates the first file.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { PayrollStatus } from '@/components/talent/payroll-shared';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';

import {
  MONTH_PATTERN,
  type Adjustment,
  type SalaryFile,
  type Structure,
} from '../types.js';

interface Detail {
  employee: {
    id: string;
    employeeNo: string;
    name: string;
    departmentTitle: string;
    hireDate: string | null;
  };
  files: SalaryFile[];
  adjustments: Adjustment[];
  defaultStructureId: string | null;
}

export default function SalaryDetailDrawer(): ReactElement {
  const { t } = useTranslation();
  const { employeeId = '' } = useParams();
  const money = useMoney();
  const detail = useRemote<Detail>(
    `talent/salaries/${encodeURIComponent(employeeId)}`,
  );
  const data = detail.data;
  return (
    <RouteDrawer
      title={
        data
          ? `${data.employee.name}（${data.employee.employeeNo}）`
          : t('payroll.salaries.title')
      }
      description={data?.employee.departmentTitle}
    >
      {detail.error ? (
        <LoadError error={detail.error} onRetry={detail.reload} />
      ) : !data ? (
        <BlockSkeleton rows={5} />
      ) : (
        <div className='space-y-6'>
          {!data.files.length ? (
            <NewFileForm detail={data} onCreated={detail.reload} />
          ) : null}
          <section className='space-y-2'>
            <h3 className='text-sm font-medium'>
              {t('payroll.salaries.history')}
            </h3>
            <ul className='space-y-2 text-sm'>
              {data.files.map((file) => (
                <li key={file.id} className='rounded-lg border p-3'>
                  <div className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>
                      {t('payroll.salaries.effectiveFrom', {
                        month: file.effectiveMonth,
                      })}
                    </span>
                    <span className='text-muted-foreground'>
                      {t(`payroll.salaries.sources.${file.source}`, {
                        defaultValue: file.source,
                      })}
                    </span>
                  </div>
                  <p>
                    {t('payroll.salaries.base')} {money(file.baseSalary)}
                    {file.fixedAllowances.map(
                      (a) =>
                        ` · ${t(`payroll.salaries.allowance.${a.code}`, { defaultValue: a.code })} ${money(a.amount)}`,
                    )}
                  </p>
                  {file.bankAccount?.accountNo ? (
                    <p className='text-muted-foreground'>
                      {file.bankAccount.bankName} · {file.bankAccount.accountNo}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
          {data.adjustments.length ? (
            <section className='space-y-2'>
              <h3 className='text-sm font-medium'>
                {t('payroll.salaries.tabs.adjustments')}
              </h3>
              <ul className='space-y-1 text-sm'>
                {data.adjustments.map((a) => (
                  <li key={a.id} className='flex flex-wrap items-center gap-2'>
                    <PayrollStatus value={a.status} />
                    {t('payroll.salaries.effectiveFrom', {
                      month: a.effectiveMonth,
                    })}{' '}
                    · {a.reason}
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

function NewFileForm({
  detail,
  onCreated,
}: {
  detail: Detail;
  onCreated: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const structures = useRemote<Structure[]>(
    'talent/payroll-settings/structures',
  );
  const [form, setForm] = useState({
    effectiveMonth: detail.employee.hireDate?.slice(0, 7) ?? '',
    baseSalary: '',
    post: '',
    structureId: detail.defaultStructureId ?? '',
    bankName: '',
    accountNo: '',
  });
  const [error, setError] = useState<string>();
  async function save(): Promise<void> {
    if (
      !MONTH_PATTERN.test(form.effectiveMonth) ||
      !(Number(form.baseSalary) > 0)
    ) {
      setError(t('payroll.salaries.fileInvalid'));
      return;
    }
    try {
      await api.request({
        path: 'talent/salaries',
        method: 'POST',
        json: {
          employeeId: detail.employee.id,
          effectiveMonth: form.effectiveMonth,
          baseSalary: Number(form.baseSalary),
          fixedAllowances: form.post
            ? [{ code: 'post', amount: Number(form.post) }]
            : [],
          salaryStructureId: form.structureId || null,
          bankAccount: form.accountNo
            ? { bankName: form.bankName || null, accountNo: form.accountNo }
            : null,
          source: 'manual',
        },
      });
      toast.add({ type: 'success', title: t('payroll.salaries.fileCreated') });
      onCreated();
    } catch (cause) {
      setError(failure(cause));
    }
  }
  return (
    <section className='space-y-3 rounded-lg border p-3'>
      <h3 className='text-sm font-medium'>
        {t('payroll.salaries.createFile')}
      </h3>
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='file-month'>
            {t('payroll.salaries.effectiveMonth')}
          </FieldLabel>
          <Input
            id='file-month'
            type='month'
            value={form.effectiveMonth}
            onChange={(e) =>
              setForm({ ...form, effectiveMonth: e.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='file-structure'>
            {t('payroll.salaries.structure')}
          </FieldLabel>
          <NativeSelect
            id='file-structure'
            value={form.structureId}
            onChange={(e) => setForm({ ...form, structureId: e.target.value })}
          >
            <NativeSelectOption value=''>
              {t('payroll.common.choose')}
            </NativeSelectOption>
            {(structures.data ?? []).map((s) => (
              <NativeSelectOption key={s.id} value={s.id}>
                {s.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='file-base'>
            {t('payroll.salaries.base')}
          </FieldLabel>
          <Input
            id='file-base'
            inputMode='decimal'
            value={form.baseSalary}
            onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='file-post'>
            {t('payroll.salaries.allowance.post')}
          </FieldLabel>
          <Input
            id='file-post'
            inputMode='decimal'
            value={form.post}
            onChange={(e) => setForm({ ...form, post: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='file-bank'>
            {t('payroll.salaries.bankName')}
          </FieldLabel>
          <Input
            id='file-bank'
            value={form.bankName}
            onChange={(e) => setForm({ ...form, bankName: e.target.value })}
          />
        </Field>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor='file-account'>
            {t('payroll.salaries.accountNo')}
          </FieldLabel>
          <Input
            id='file-account'
            inputMode='numeric'
            value={form.accountNo}
            onChange={(e) => setForm({ ...form, accountNo: e.target.value })}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </div>
      <div className='flex justify-end'>
        <Button onClick={() => void save()}>{t('payroll.common.save')}</Button>
      </div>
    </section>
  );
}
