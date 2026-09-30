/**
 * 发起调薪 (dialog). Opened from the list, or from a transfer / promotion
 * notification or change checklist with `?actionId=`, which pre-fills the
 * employee, the effective month and the related personnel action.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

// V4-12
import {
  PerformanceAdjustmentFields,
  type PerformanceAdjustmentValue,
} from '@/components/talent/performance-payroll';
import { useSearchParams } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import {
  MONTH_PATTERN,
  type SalaryFile,
  type SalaryList,
  type Structure,
} from '../types.js';

interface Prefill {
  employeeId: string;
  relatedActionId: string;
  effectiveMonth: string;
  current: SalaryFile | null;
  suggestedStructureId: string | null;
}

export default function NewAdjustmentDialog(): ReactElement {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const actionId = params.get('actionId');
  const prefill = useRemote<Prefill>(
    actionId ? 'talent/salaries/adjustments/prefill' : null,
    {
      actionId: actionId ?? undefined,
    },
  );
  return (
    <RouteDialog
      title={t('payroll.salaries.newAdjustment')}
      description={t('payroll.salaries.newAdjustmentDescription')}
    >
      {actionId && !prefill.data && !prefill.error ? (
        <BlockSkeleton rows={4} />
      ) : (
        <AdjustmentForm prefill={prefill.data ?? null} />
      )}
    </RouteDialog>
  );
}

function AdjustmentForm({
  prefill,
}: {
  prefill: Prefill | null;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const overlay = useRouteOverlay();
  const list = useRemote<SalaryList>('talent/salaries');
  const structures = useRemote<Structure[]>(
    'talent/payroll-settings/structures',
  );
  const [form, setForm] = useState({
    employeeId: prefill?.employeeId ?? '',
    effectiveMonth: prefill?.effectiveMonth ?? '',
    baseSalary: prefill?.current ? String(prefill.current.baseSalary) : '',
    post: prefill?.current
      ? String(
          prefill.current.fixedAllowances.find((a) => a.code === 'post')
            ?.amount ?? '',
        )
      : '',
    structureId:
      prefill?.suggestedStructureId ??
      prefill?.current?.salaryStructureId ??
      '',
    reason: '',
  });
  // V4-12: the bonus base and a published review result to cite.
  const [performance, setPerformance] = useState<PerformanceAdjustmentValue>({
    relatedReviewResultId: '',
    bonusBase: '',
  });
  const [error, setError] = useState<string>();
  const current = list.data?.rows.find((r) => r.employeeId === form.employeeId);
  async function submit(): Promise<void> {
    if (
      !form.employeeId ||
      !MONTH_PATTERN.test(form.effectiveMonth) ||
      !(Number(form.baseSalary) > 0) ||
      !form.structureId ||
      !form.reason.trim()
    ) {
      setError(t('payroll.salaries.adjustmentInvalid'));
      return;
    }
    try {
      await api.request({
        path: 'talent/salaries/adjustments',
        method: 'POST',
        json: {
          employeeId: form.employeeId,
          effectiveMonth: form.effectiveMonth,
          baseSalary: Number(form.baseSalary),
          fixedAllowances: form.post
            ? [{ code: 'post', amount: Number(form.post) }]
            : [],
          salaryStructureId: form.structureId,
          reason: form.reason.trim(),
          relatedActionId: prefill?.relatedActionId ?? null,
          // V4-12
          relatedReviewResultId: performance.relatedReviewResultId || null,
          ...(performance.bonusBase === ''
            ? {}
            : { bonusBase: Number(performance.bonusBase) }),
        },
      });
      toast.add({
        type: 'success',
        title: t('payroll.salaries.adjustmentSubmitted'),
      });
      await overlay.close();
    } catch (cause) {
      setError(failure(cause));
    }
  }
  return (
    <div className='space-y-3'>
      <Field>
        <FieldLabel htmlFor='adj-employee'>
          {t('payroll.common.name')}
        </FieldLabel>
        <NativeSelect
          id='adj-employee'
          value={form.employeeId}
          disabled={Boolean(prefill)}
          onChange={(e) => {
            const row = list.data?.rows.find(
              (r) => r.employeeId === e.target.value,
            );
            setForm({
              ...form,
              employeeId: e.target.value,
              baseSalary: row?.baseSalary ? String(row.baseSalary) : '',
              post: String(
                row?.fixedAllowances.find((a) => a.code === 'post')?.amount ??
                  '',
              ),
              structureId: row?.salaryStructureId ?? '',
            });
          }}
        >
          <NativeSelectOption value=''>
            {t('payroll.common.choose')}
          </NativeSelectOption>
          {(list.data?.rows ?? [])
            .filter((r) => r.baseSalary !== null)
            .map((r) => (
              <NativeSelectOption key={r.employeeId} value={r.employeeId}>
                {r.name}（{r.employeeNo}）
              </NativeSelectOption>
            ))}
        </NativeSelect>
      </Field>
      {current ? (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.salaries.currentFile', {
            base: money(current.baseSalary),
            structure: current.structureTitle ?? '—',
          })}
        </p>
      ) : null}
      {prefill?.relatedActionId ? (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.salaries.relatedAction')}
        </p>
      ) : null}
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='adj-month'>
            {t('payroll.salaries.effectiveMonth')}
          </FieldLabel>
          <Input
            id='adj-month'
            type='month'
            value={form.effectiveMonth}
            onChange={(e) =>
              setForm({ ...form, effectiveMonth: e.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='adj-structure'>
            {t('payroll.salaries.structure')}
          </FieldLabel>
          <NativeSelect
            id='adj-structure'
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
          <FieldLabel htmlFor='adj-base'>
            {t('payroll.salaries.base')}
          </FieldLabel>
          <Input
            id='adj-base'
            inputMode='decimal'
            value={form.baseSalary}
            onChange={(e) => setForm({ ...form, baseSalary: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='adj-post'>
            {t('payroll.salaries.allowance.post')}
          </FieldLabel>
          <Input
            id='adj-post'
            inputMode='decimal'
            value={form.post}
            onChange={(e) => setForm({ ...form, post: e.target.value })}
          />
        </Field>
      </div>
      {/* V4-12 */}
      <PerformanceAdjustmentFields
        employeeId={form.employeeId}
        value={performance}
        onChange={setPerformance}
      />
      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor='adj-reason'>
          {t('payroll.sheet.reason')}
        </FieldLabel>
        <Textarea
          id='adj-reason'
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
        />
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      <div className='flex justify-end gap-2'>
        <Button variant='outline' onClick={() => void overlay.close()}>
          {t('payroll.common.cancel')}
        </Button>
        <Button onClick={() => void submit()}>
          {t('payroll.salaries.submitAdjustment')}
        </Button>
      </div>
    </div>
  );
}
