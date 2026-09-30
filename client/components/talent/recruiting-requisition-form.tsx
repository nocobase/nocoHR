/**
 * 招聘需求表单 (V2-07): department, position (its job description shown, with
 * a hint when it is empty), headcount, reason, target date, and the
 * department's checklist — typed items, each must-have or preferred.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { REQUIREMENT_TYPES } from '@/components/talent/recruiting-lib';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

export interface RequisitionValues {
  departmentId: string;
  positionId: string;
  headcount: number;
  reason: 'newHeadcount' | 'replacement';
  targetDate: string;
  requirementsChecklist: { type: string; text: string; mustHave: boolean }[];
}

type ChecklistItem = RequisitionValues['requirementsChecklist'][number];

interface PositionContext {
  responsibilities: string | null;
  lastChecklist?: ChecklistItem[];
}

let rowSeed = 0;
/** A stable React key for a checklist row the user is editing; stripped before saving. */
const withUid = (item: ChecklistItem) => ({
  ...item,
  uid: `row-${(rowSeed += 1)}`,
});

export function RequisitionForm({
  initial,
  busy,
  onSubmit,
}: {
  initial?: Partial<RequisitionValues>;
  busy: boolean;
  onSubmit: (values: RequisitionValues) => void;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const [values, setValues] = useState<
    Omit<RequisitionValues, 'requirementsChecklist'> & {
      requirementsChecklist: (ChecklistItem & { uid: string })[];
    }
  >({
    departmentId: initial?.departmentId ?? '',
    positionId: initial?.positionId ?? '',
    headcount: initial?.headcount ?? 1,
    reason: initial?.reason ?? 'newHeadcount',
    targetDate: initial?.targetDate ?? '',
    requirementsChecklist: (initial?.requirementsChecklist ?? []).map(withUid),
  });
  const position = useRemote<PositionContext>(
    values.positionId
      ? `talent/recruiting/positions/${encodeURIComponent(values.positionId)}/context`
      : null,
  );
  const set = <K extends keyof typeof values>(
    key: K,
    value: (typeof values)[K],
  ) => setValues((v) => ({ ...v, [key]: value }));
  const setItem = (index: number, patch: Partial<ChecklistItem>) =>
    set(
      'requirementsChecklist',
      values.requirementsChecklist.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    );
  return (
    <form
      className='space-y-4'
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          ...values,
          requirementsChecklist: values.requirementsChecklist
            .filter((i) => i.text.trim())
            .map(({ type, text, mustHave }) => ({ type, text, mustHave })),
        });
      }}
    >
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='rq-department'>
            {t('recruiting.common.department')}
          </FieldLabel>
          <NativeSelect
            id='rq-department'
            required
            value={values.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <NativeSelectOption value=''>—</NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {`${'　'.repeat(d.depth)}${d.label}`}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='rq-position'>
            {t('recruiting.common.position')}
          </FieldLabel>
          <NativeSelect
            id='rq-position'
            required
            value={values.positionId}
            onChange={(e) => set('positionId', e.target.value)}
          >
            <NativeSelectOption value=''>—</NativeSelectOption>
            {lookups.positions.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='rq-headcount'>
            {t('recruiting.common.headcount')}
          </FieldLabel>
          <Input
            id='rq-headcount'
            type='number'
            min={1}
            required
            value={values.headcount}
            onChange={(e) => set('headcount', Number(e.target.value))}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='rq-reason'>
            {t('recruiting.requisitions.reason')}
          </FieldLabel>
          <NativeSelect
            id='rq-reason'
            value={values.reason}
            onChange={(e) =>
              set('reason', e.target.value as RequisitionValues['reason'])
            }
          >
            <NativeSelectOption value='newHeadcount'>
              {t('recruiting.labels.reason.newHeadcount')}
            </NativeSelectOption>
            <NativeSelectOption value='replacement'>
              {t('recruiting.labels.reason.replacement')}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='rq-target'>
            {t('recruiting.requisitions.targetDate')}
          </FieldLabel>
          <Input
            id='rq-target'
            type='date'
            required
            value={values.targetDate}
            onChange={(e) => set('targetDate', e.target.value)}
          />
        </Field>
      </div>
      {values.positionId && position.data ? (
        <div className='space-y-2 rounded-lg border p-3 text-sm'>
          <p className='font-medium'>
            {t('recruiting.requisitions.responsibilities')}
          </p>
          {position.data.responsibilities ? (
            <p className='text-muted-foreground'>
              {position.data.responsibilities}
            </p>
          ) : (
            <Alert>
              <AlertDescription>
                {t('recruiting.requisitions.responsibilitiesMissing')}
              </AlertDescription>
            </Alert>
          )}
          {!values.requirementsChecklist.length &&
          position.data.lastChecklist?.length ? (
            <Button
              type='button'
              size='sm'
              variant='outline'
              onClick={() =>
                set(
                  'requirementsChecklist',
                  (position.data?.lastChecklist ?? []).map(withUid),
                )
              }
            >
              {t('recruiting.requisitions.addItem')} ·{' '}
              {position.data.lastChecklist.length}
            </Button>
          ) : null}
        </div>
      ) : null}
      <div className='space-y-2'>
        <p className='text-sm font-medium'>
          {t('recruiting.requisitions.checklist')}
        </p>
        <p className='text-sm text-muted-foreground'>
          {t('recruiting.requisitions.checklistHint')}
        </p>
        {values.requirementsChecklist.map((item, index) => (
          <div key={item.uid} className='flex flex-wrap items-center gap-2'>
            <NativeSelect
              aria-label={t('recruiting.common.source')}
              value={item.type}
              onChange={(e) => setItem(index, { type: e.target.value })}
            >
              {REQUIREMENT_TYPES.map((type) => (
                <NativeSelectOption key={type} value={type}>
                  {t(`recruiting.labels.requirementType.${type}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <Input
              className='min-w-48 flex-1'
              aria-label={t('recruiting.postings.requirementText')}
              value={item.text}
              onChange={(e) => setItem(index, { text: e.target.value })}
            />
            <label className='flex items-center gap-1 text-sm'>
              <Checkbox
                checked={item.mustHave}
                onCheckedChange={(checked) =>
                  setItem(index, { mustHave: Boolean(checked) })
                }
              />
              {t('recruiting.common.mustHave')}
            </label>
            <Button
              type='button'
              size='sm'
              variant='ghost'
              onClick={() =>
                set(
                  'requirementsChecklist',
                  values.requirementsChecklist.filter((_, i) => i !== index),
                )
              }
            >
              {t('recruiting.common.remove')}
            </Button>
          </div>
        ))}
        <Button
          type='button'
          size='sm'
          variant='outline'
          onClick={() =>
            set('requirementsChecklist', [
              ...values.requirementsChecklist,
              withUid({ type: 'skill', text: '', mustHave: true }),
            ])
          }
        >
          {t('recruiting.requisitions.addItem')}
        </Button>
      </div>
      <Button type='submit' disabled={busy}>
        {t('recruiting.common.save')}
      </Button>
    </form>
  );
}
