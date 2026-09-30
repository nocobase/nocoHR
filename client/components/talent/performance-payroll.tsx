/**
 * V4-12 与薪酬的衔接, the pieces the payroll pages mount:
 *
 * - `PerformanceCoefficientsCard` — 薪酬设置 · 绩效系数 (hr.payroll): each
 *   scheme's bonus coefficient per rating; renders nothing for someone who may
 *   not maintain them. Anchored at `#coefficients`.
 * - `PayrollBonusCycleCard` — 算薪周期: the review cycle (published or
 *   closed) whose final ratings `perf.coefficient` reads this month.
 * - `PerformanceAdjustmentFields` — 调薪申请: the bonus base and a published
 *   review result of the employee to cite.
 * - `ReviewResultLabel` — "周期名称 · 最终等级" of an adjustment's linked result,
 *   the only performance data an approver sees.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

import { isForbidden } from './errors.js';
import { useAction } from './performance-hooks.js';
import { useRemote } from './use-remote.js';

interface CoefficientScheme {
  id: string;
  title: string;
  active: boolean;
  ratingScale: { code: string; score: number }[];
  ratingCoefficients: Record<string, number> | null;
}

export function PerformanceCoefficientsCard(): ReactElement | null {
  const { t } = useTranslation();
  const list = useRemote<{
    schemes: CoefficientScheme[];
    can: { manageCoefficients: boolean };
  }>('talent/performance/schemes');
  if (list.error && isForbidden(list.error)) return null;
  if (list.data && !list.data.can.manageCoefficients) return null;
  return (
    <Card id='coefficients'>
      <CardHeader>
        <CardTitle>{t('performance.coefficients.title')}</CardTitle>
        <CardDescription>
          {t('performance.coefficients.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        {list.error ? (
          <p className='text-sm text-destructive'>
            {t('talent.common.loadFailed')}
          </p>
        ) : !list.data ? null : (
          list.data.schemes.map((scheme) => (
            <SchemeCoefficients
              key={scheme.id}
              scheme={scheme}
              onSaved={list.reload}
            />
          ))
        )}
      </CardContent>
    </Card>
  );
}

function SchemeCoefficients({
  scheme,
  onSaved,
}: {
  scheme: CoefficientScheme;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      scheme.ratingScale.map((r) => [
        r.code,
        scheme.ratingCoefficients?.[r.code] === undefined
          ? ''
          : String(scheme.ratingCoefficients[r.code]),
      ]),
    ),
  );
  return (
    <div className='space-y-2 rounded-lg border p-3'>
      <p className='font-medium'>{scheme.title}</p>
      {!scheme.ratingCoefficients ? (
        <p className='text-sm text-destructive'>
          {t('performance.coefficients.missing')}
        </p>
      ) : null}
      <div className='grid grid-cols-3 gap-2 sm:grid-cols-5'>
        {scheme.ratingScale.map((rating) => (
          <Field key={rating.code}>
            <FieldLabel htmlFor={`coef-${scheme.id}-${rating.code}`}>
              {rating.code}
            </FieldLabel>
            <Input
              id={`coef-${scheme.id}-${rating.code}`}
              type='number'
              step={0.1}
              min={0}
              value={values[rating.code] ?? ''}
              onChange={(e) =>
                setValues({ ...values, [rating.code]: e.target.value })
              }
            />
          </Field>
        ))}
      </div>
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className='flex justify-end'>
        <Button
          size='sm'
          disabled={action.busy}
          onClick={() => {
            void (async () => {
              const coefficients = Object.fromEntries(
                Object.entries(values)
                  .filter(([, v]) => v !== '')
                  .map(([code, v]) => [code, Number(v)]),
              );
              if (
                await action.run(
                  {
                    method: 'PUT',
                    path: `talent/performance/schemes/${encodeURIComponent(scheme.id)}/coefficients`,
                    json: { coefficients },
                  },
                  t('performance.coefficients.saved'),
                )
              )
                onSaved();
            })();
          }}
        >
          {t('performance.common.save')}
        </Button>
      </div>
    </div>
  );
}

export function PayrollBonusCycleCard({
  payrollCycleId,
  bonusCycleId,
  editable,
}: {
  payrollCycleId: string;
  bonusCycleId: string | null | undefined;
  editable: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  const options = useRemote<{ id: string; title: string; status: string }[]>(
    'talent/performance/bonus-cycles',
  );
  const action = useAction();
  const [value, setValue] = useState(bonusCycleId ?? '');
  if (options.error && isForbidden(options.error)) return null;
  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>{t('performance.bonusCycle.title')}</CardTitle>
        <CardDescription>
          {t('performance.bonusCycle.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Field>
          <FieldLabel htmlFor='bonus-cycle'>
            {t('performance.bonusCycle.label')}
          </FieldLabel>
          <NativeSelect
            id='bonus-cycle'
            disabled={!editable || action.busy}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('performance.bonusCycle.none')}
            </NativeSelectOption>
            {(options.data ?? []).map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>
            {t('performance.bonusCycle.hint')}
          </FieldDescription>
        </Field>
        {action.error ? (
          <Alert variant='destructive' className='mt-2'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      {editable ? (
        <CardFooter className='justify-end'>
          <Button
            size='sm'
            disabled={action.busy || value === (bonusCycleId ?? '')}
            onClick={() =>
              void action.run(
                {
                  method: 'PUT',
                  path: `talent/payroll/cycles/${encodeURIComponent(payrollCycleId)}/bonus-cycle`,
                  json: { bonusCycleId: value || null },
                },
                t('performance.bonusCycle.saved'),
              )
            }
          >
            {t('performance.common.save')}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

export interface PerformanceAdjustmentValue {
  relatedReviewResultId: string;
  bonusBase: string;
}

export function PerformanceAdjustmentFields({
  employeeId,
  value,
  onChange,
}: {
  employeeId: string;
  value: PerformanceAdjustmentValue;
  onChange: (next: PerformanceAdjustmentValue) => void;
}): ReactElement {
  const { t } = useTranslation();
  const results = useRemote<
    { id: string; cycleTitle: string; finalRating: string | null }[]
  >(
    employeeId ? 'talent/performance/ratings' : null,
    employeeId ? { employeeId } : undefined,
  );
  return (
    <div className='grid gap-3 sm:grid-cols-2'>
      <Field>
        <FieldLabel htmlFor='adj-bonus-base'>
          {t('performance.adjustment.bonusBase')}
        </FieldLabel>
        <Input
          id='adj-bonus-base'
          type='number'
          min={0}
          value={value.bonusBase}
          onChange={(e) => onChange({ ...value, bonusBase: e.target.value })}
        />
        <FieldDescription>
          {t('performance.adjustment.bonusBaseHint')}
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor='adj-review-result'>
          {t('performance.adjustment.reviewResult')}
        </FieldLabel>
        <NativeSelect
          id='adj-review-result'
          className='w-full'
          disabled={!employeeId}
          value={value.relatedReviewResultId}
          onChange={(e) =>
            onChange({ ...value, relatedReviewResultId: e.target.value })
          }
        >
          <NativeSelectOption value=''>
            {t('performance.adjustment.none')}
          </NativeSelectOption>
          {(results.data ?? []).map((r) => (
            <NativeSelectOption key={r.id} value={r.id}>
              {r.cycleTitle} · {r.finalRating ?? '—'}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
    </div>
  );
}

export function ReviewResultLabel({
  value,
}: {
  value: { cycleTitle: string; finalRating: string | null } | null | undefined;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!value) return null;
  return (
    <p className='text-sm'>
      <span className='text-muted-foreground'>
        {t('performance.adjustment.linked')}
      </span>{' '}
      {value.cycleTitle} · {value.finalRating ?? '—'}
    </p>
  );
}
