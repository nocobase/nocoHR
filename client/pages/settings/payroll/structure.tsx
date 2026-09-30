/**
 * 薪资结构编辑器 (covering child page of 薪酬设置): items in calculation order
 * (moved up and down), each with its kind, calculation, formula (variables
 * picked from the whitelist), unit and departments; the formula parameters.
 * Saving is checked by the server — an unknown variable, parameter or later
 * item is refused with the item named — and runs a trial calculation for one
 * employee, shown below; every save is added to the change log.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { MultiCheckList } from '@/components/talent/multi-check';
import {
  useMoney,
  useNumber,
  usePayrollError,
} from '@/components/talent/payroll-hooks';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { toast } from '@/components/ui/toast';

import type {
  Structure,
  StructureItem,
  StructureParam,
} from '../../talent/payroll/types.js';

interface Variables {
  fixed: string[];
  attendance: string[];
  labels: Record<string, string>;
  prefixes: string[];
}
interface Trial {
  employeeName: string;
  month: string;
  gross: number;
  lines: {
    code: string;
    title: string;
    kind: string;
    amount: number | null;
    value: number | null;
    unit: string | null;
    expression: string | null;
  }[];
}

const EMPTY: Structure = {
  id: '',
  title: '',
  appliesTo: { jobFamilyIds: [], departmentIds: [] },
  items: [],
  params: [],
  payRanges: [],
  payDaysPerMonth: 21.75,
  changeLog: [],
  active: true,
};

export default function StructurePage(): ReactElement {
  const { t } = useTranslation();
  const { structureId = 'new' } = useParams();
  const list = useRemote<Structure[]>('talent/payroll-settings/structures');
  const isNew = structureId === 'new';
  const found = list.data?.find((s) => s.id === structureId);
  return (
    <RouteChildPage>
      <PageContainer className='max-w-5xl'>
        <Breadcrumbs />
        {list.error ? (
          <LoadError error={list.error} onRetry={list.reload} />
        ) : !list.data ? (
          <BlockSkeleton rows={6} />
        ) : !isNew && !found ? (
          <Alert variant='destructive'>
            <AlertDescription>
              {t('payroll.errors.STRUCTURE_NOT_FOUND')}
            </AlertDescription>
          </Alert>
        ) : (
          <Editor
            key={found?.id ?? 'new'}
            initial={found ?? EMPTY}
            isNew={isNew}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function Editor({
  initial,
  isNew,
}: {
  initial: Structure;
  isNew: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const money = useMoney();
  const number = useNumber();
  const failure = usePayrollError();
  const lookups = useLookups();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const variables = useRemote<Variables>('talent/payroll-settings/variables');
  const [draft, setDraft] = useState<Structure>(initial);
  const [note, setNote] = useState('');
  // Stable row keys for the parameter rows, whose codes change while typed.
  const [paramKeys, setParamKeys] = useState(() =>
    initial.params.map(() => crypto.randomUUID()),
  );
  const [trial, setTrial] = useState<Trial | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const setItem = (index: number, patch: Partial<StructureItem>) =>
    setDraft({
      ...draft,
      items: draft.items.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const move = (index: number, delta: number) => {
    const items = [...draft.items];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target], items[index]];
    setDraft({ ...draft, items });
  };
  const setParam = (index: number, patch: Partial<StructureParam>) =>
    setDraft({
      ...draft,
      params: draft.params.map((p, i) =>
        i === index ? { ...p, ...patch } : p,
      ),
    });

  const pickable = (index: number) => [
    ...(variables.data?.fixed ?? []),
    ...(variables.data?.attendance ?? []),
    ...draft.params.map((p) => `param.${p.code}`),
    ...draft.items
      .filter((i) => i.calc === 'imported')
      .map((i) => `imp.${i.code}`),
    ...draft.items.slice(0, index).map((i) => `item.${i.code}`),
    'allowance.post',
  ];

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await api.request<{
        data: { structure: Structure; trial: Trial | null };
      }>({
        path: isNew
          ? 'talent/payroll-settings/structures'
          : `talent/payroll-settings/structures/${encodeURIComponent(initial.id)}`,
        method: isNew ? 'POST' : 'PUT',
        json: {
          title: draft.title,
          appliesTo: draft.appliesTo,
          items: draft.items.map((item) => ({
            code: item.code,
            title: item.title,
            kind: item.kind,
            calc: item.calc,
            formula: item.calc === 'formula' ? item.formula : null,
            unit: item.unit || null,
            departmentIds: item.departmentIds,
            taxable: item.taxable,
            includedInSocialBase: item.includedInSocialBase,
          })),
          params: draft.params,
          payRanges: draft.payRanges,
          payDaysPerMonth: Number(draft.payDaysPerMonth),
          active: draft.active,
          note: note.trim() || null,
        },
      });
      setTrial(data.trial);
      setDraft(data.structure);
      setNote('');
      toast.add({ type: 'success', title: t('payroll.structure.saved') });
      outlet?.reload?.();
      if (isNew)
        await navigate(`../${encodeURIComponent(data.structure.id)}`, {
          relative: 'path',
          replace: true,
        });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  const departmentOptions = lookups.departments.map((d) => ({
    value: d.id,
    label: d.label,
    depth: d.depth,
  }));
  return (
    <div className='space-y-4'>
      <PageHeader
        title={isNew ? t('payroll.settings.newStructure') : draft.title}
        description={t('payroll.structure.description')}
        actions={
          <Button disabled={busy} onClick={() => void save()}>
            {t('payroll.structure.save')}
          </Button>
        }
      />
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <Card>
        <CardContent className='grid gap-4 pt-6 sm:grid-cols-3'>
          <Field>
            <FieldLabel htmlFor='structure-title'>
              {t('payroll.structure.name')}
            </FieldLabel>
            <Input
              id='structure-title'
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='structure-days'>
              {t('payroll.structure.payDays')}
            </FieldLabel>
            <Input
              id='structure-days'
              inputMode='decimal'
              value={draft.payDaysPerMonth}
              onChange={(e) =>
                setDraft({ ...draft, payDaysPerMonth: Number(e.target.value) })
              }
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='structure-note'>
              {t('payroll.structure.note')}
            </FieldLabel>
            <Input
              id='structure-note'
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <div className='sm:col-span-3'>
            <MultiCheckList
              label={t('payroll.structure.appliesTo')}
              options={departmentOptions}
              value={draft.appliesTo.departmentIds}
              onChange={(next) =>
                setDraft({
                  ...draft,
                  appliesTo: { ...draft.appliesTo, departmentIds: next },
                })
              }
            />
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('payroll.structure.items')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {draft.items.map((item, index) => (
            <div
              key={`${String(index)}-${item.code}`}
              className='space-y-3 rounded-lg border p-3'
            >
              <div className='grid gap-3 sm:grid-cols-4'>
                <Field>
                  <FieldLabel htmlFor={`item-code-${String(index)}`}>
                    {t('payroll.structure.code')}
                  </FieldLabel>
                  <Input
                    id={`item-code-${String(index)}`}
                    value={item.code}
                    onChange={(e) => setItem(index, { code: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`item-title-${String(index)}`}>
                    {t('payroll.structure.itemTitle')}
                  </FieldLabel>
                  <Input
                    id={`item-title-${String(index)}`}
                    value={item.title}
                    onChange={(e) => setItem(index, { title: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`item-kind-${String(index)}`}>
                    {t('payroll.structure.kind')}
                  </FieldLabel>
                  <NativeSelect
                    id={`item-kind-${String(index)}`}
                    value={item.kind}
                    onChange={(e) =>
                      setItem(index, {
                        kind: e.target.value as StructureItem['kind'],
                      })
                    }
                  >
                    {(['earning', 'deduction', 'reference'] as const).map(
                      (kind) => (
                        <NativeSelectOption key={kind} value={kind}>
                          {t(`payroll.kind.${kind}`)}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor={`item-calc-${String(index)}`}>
                    {t('payroll.payslip.calc')}
                  </FieldLabel>
                  <NativeSelect
                    id={`item-calc-${String(index)}`}
                    value={item.calc}
                    onChange={(e) =>
                      setItem(index, {
                        calc: e.target.value as StructureItem['calc'],
                      })
                    }
                  >
                    {(['fixed', 'formula', 'manual', 'imported'] as const).map(
                      (calc) => (
                        <NativeSelectOption key={calc} value={calc}>
                          {t(`payroll.calc.${calc}`)}
                        </NativeSelectOption>
                      ),
                    )}
                  </NativeSelect>
                </Field>
              </div>
              {item.calc === 'formula' ? (
                <div className='grid gap-3 sm:grid-cols-[1fr_16rem]'>
                  <Field>
                    <FieldLabel htmlFor={`item-formula-${String(index)}`}>
                      {t('payroll.payslip.formula')}
                    </FieldLabel>
                    <Input
                      id={`item-formula-${String(index)}`}
                      className='font-mono'
                      value={item.formula ?? ''}
                      onChange={(e) =>
                        setItem(index, { formula: e.target.value })
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`item-variable-${String(index)}`}>
                      {t('payroll.structure.insertVariable')}
                    </FieldLabel>
                    <NativeSelect
                      id={`item-variable-${String(index)}`}
                      value=''
                      onChange={(e) => {
                        if (e.target.value)
                          setItem(index, {
                            formula: `${item.formula ?? ''}${item.formula ? ' ' : ''}${e.target.value}`,
                          });
                      }}
                    >
                      <NativeSelectOption value=''>
                        {t('payroll.common.choose')}
                      </NativeSelectOption>
                      {pickable(index).map((name) => (
                        <NativeSelectOption key={name} value={name}>
                          {name}
                          {variables.data?.labels[name]
                            ? `（${variables.data.labels[name]}）`
                            : ''}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>
              ) : null}
              <div className='flex flex-wrap items-center gap-4 text-sm'>
                <Field className='w-28'>
                  <FieldLabel htmlFor={`item-unit-${String(index)}`}>
                    {t('payroll.structure.unit')}
                  </FieldLabel>
                  <Input
                    id={`item-unit-${String(index)}`}
                    value={item.unit ?? ''}
                    onChange={(e) => setItem(index, { unit: e.target.value })}
                  />
                </Field>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={item.taxable}
                    onCheckedChange={(checked) =>
                      setItem(index, { taxable: checked })
                    }
                  />
                  {t('payroll.structure.taxable')}
                </label>
                <label className='flex items-center gap-2'>
                  <Checkbox
                    checked={item.includedInSocialBase}
                    onCheckedChange={(checked) =>
                      setItem(index, { includedInSocialBase: checked })
                    }
                  />
                  {t('payroll.structure.inSocialBase')}
                </label>
                <span className='ml-auto flex gap-1'>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label={t('payroll.structure.up')}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUpIcon />
                  </Button>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label={t('payroll.structure.down')}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDownIcon />
                  </Button>
                  <Button
                    size='icon-sm'
                    variant='ghost'
                    aria-label={t('payroll.structure.remove')}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        items: draft.items.filter((_, i) => i !== index),
                      })
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </span>
              </div>
              <MultiCheckList
                label={t('payroll.structure.departments')}
                options={departmentOptions}
                value={item.departmentIds}
                height='h-28'
                onChange={(next) => setItem(index, { departmentIds: next })}
              />
            </div>
          ))}
          <Button
            variant='outline'
            onClick={() =>
              setDraft({
                ...draft,
                items: [
                  ...draft.items,
                  {
                    code: `item${String(draft.items.length + 1)}`,
                    title: '',
                    kind: 'earning',
                    calc: 'formula',
                    formula: '',
                    unit: null,
                    departmentIds: [],
                    taxable: true,
                    includedInSocialBase: false,
                  },
                ],
              })
            }
          >
            <PlusIcon data-icon='inline-start' />
            {t('payroll.structure.addItem')}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t('payroll.structure.params')}</CardTitle>
        </CardHeader>
        <CardContent className='space-y-3'>
          {draft.params.map((param, index) => (
            <div
              key={paramKeys[index] ?? param.code}
              className='grid items-end gap-3 sm:grid-cols-[1fr_1fr_8rem_6rem_auto]'
            >
              <Field>
                <FieldLabel htmlFor={`param-code-${String(index)}`}>
                  {t('payroll.structure.code')}
                </FieldLabel>
                <Input
                  id={`param-code-${String(index)}`}
                  value={param.code}
                  onChange={(e) => setParam(index, { code: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`param-title-${String(index)}`}>
                  {t('payroll.structure.itemTitle')}
                </FieldLabel>
                <Input
                  id={`param-title-${String(index)}`}
                  value={param.title}
                  onChange={(e) => setParam(index, { title: e.target.value })}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`param-value-${String(index)}`}>
                  {t('payroll.structure.value')}
                </FieldLabel>
                <Input
                  id={`param-value-${String(index)}`}
                  inputMode='decimal'
                  value={param.value}
                  onChange={(e) =>
                    setParam(index, { value: Number(e.target.value) })
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor={`param-unit-${String(index)}`}>
                  {t('payroll.structure.unit')}
                </FieldLabel>
                <Input
                  id={`param-unit-${String(index)}`}
                  value={param.unit ?? ''}
                  onChange={(e) =>
                    setParam(index, { unit: e.target.value || null })
                  }
                />
              </Field>
              <Button
                size='icon-sm'
                variant='ghost'
                aria-label={t('payroll.structure.remove')}
                onClick={() => {
                  setDraft({
                    ...draft,
                    params: draft.params.filter((_, i) => i !== index),
                  });
                  setParamKeys(paramKeys.filter((_, i) => i !== index));
                }}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          <Button
            variant='outline'
            onClick={() => {
              setDraft({
                ...draft,
                params: [
                  ...draft.params,
                  { code: '', title: '', value: 0, unit: null },
                ],
              });
              setParamKeys([...paramKeys, crypto.randomUUID()]);
            }}
          >
            <PlusIcon data-icon='inline-start' />
            {t('payroll.structure.addParam')}
          </Button>
        </CardContent>
      </Card>
      {trial ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {t('payroll.structure.trial', {
                name: trial.employeeName,
                month: trial.month,
              })}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-1 text-sm'>
              {trial.lines.map((line) => (
                <li key={line.code} className='flex justify-between gap-2'>
                  <span>
                    {line.title}
                    {line.expression ? (
                      <span className='ml-2 text-muted-foreground'>
                        {line.expression}
                      </span>
                    ) : null}
                  </span>
                  <span className='tabular-nums'>
                    {line.kind === 'reference'
                      ? `${number(line.value)} ${line.unit ?? ''}`
                      : money(line.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
      {draft.changeLog.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('payroll.structure.changeLog')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-1 text-sm'>
              {[...draft.changeLog].reverse().map((entry, index) => (
                <li key={`${entry.at}-${String(index)}`}>
                  <span className='text-muted-foreground'>
                    {new Date(entry.at).toLocaleString()} {entry.byName ?? ''}
                  </span>{' '}
                  {entry.summary}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
