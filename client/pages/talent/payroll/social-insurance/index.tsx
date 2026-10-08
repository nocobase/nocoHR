/**
 * V2-06 人事 / 社保公积金 (`talent.socialInsurance`, hr.payroll): city plans,
 * employee enrolments (a base outside the plan is clamped by the server and
 * the answer says so), 增减员 to confirm, 专项附加扣除, and the yearly base
 * adjustment suggestions. Rates are percentages; the seeded ones are examples.
 * Plans are created and edited in a sheet (talent.socialInsurance manage).
 */
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { OpeningImportButton } from '@/components/talent/payroll-opening-import';
import { downloadFile } from '@/components/talent/download';
import { PayrollStatus } from '@/components/talent/payroll-shared';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

const TABS = ['plans', 'enrolments', 'changes', 'deductions', 'base'] as const;
/** The server's INSURANCE_CODES (server/providers/hr/payroll/calc.ts), in order. */
const INSURANCE_CODES = [
  'pension',
  'medical',
  'unemployment',
  'injury',
  'maternity',
  'housingFund',
] as const;
type InsuranceCode = (typeof INSURANCE_CODES)[number];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/u;
const DEDUCTION_TYPES = [
  'children',
  'continuingEducation',
  'housingLoan',
  'housingRent',
  'elderly',
  'infantCare',
  'seriousIllness',
] as const;

interface Plan {
  id: string;
  city: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  items: {
    code: string;
    employerRate: number;
    employeeRate: number;
    baseMin: number;
    baseMax: number;
  }[];
  note: string | null;
}
interface Enrolment {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  planCity: string;
  socialBase: number;
  housingFundBase: number;
  startMonth: string;
  endMonth: string | null;
  status: string;
  pendingAction: 'start' | 'stop' | null;
  changeLog: { at: string; summary: string }[];
}

function thisMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

export default function SocialInsurancePage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as string)
    : 'plans';
  return (
    <PageContainer>
      <PageHeader
        title={t('payroll.insurance.title')}
        description={t('payroll.insurance.description')}
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', String(value));
          setParams(next, { replace: true });
        }}
      >
        <TabsList className='flex-wrap'>
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`payroll.insurance.tabs.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value='plans' className='pt-4'>
          <PlansTab />
        </TabsContent>
        <TabsContent value='enrolments' className='pt-4'>
          <EnrolmentsTab />
        </TabsContent>
        <TabsContent value='changes' className='pt-4'>
          <ChangesTab initialMonth={params.get('month') ?? thisMonth()} />
        </TabsContent>
        <TabsContent value='deductions' className='pt-4'>
          <DeductionsTab />
        </TabsContent>
        <TabsContent value='base' className='pt-4'>
          <BaseTab />
        </TabsContent>
      </Tabs>
    </PageContainer>
  );
}

function useOverview() {
  return useRemote<{ plans: Plan[]; enrolments: Enrolment[] }>(
    'talent/social-insurance',
  );
}

function PlansTab(): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const data = useOverview();
  const manage = useCan({
    resource: { type: 'composite', id: 'talent.socialInsurance' },
    action: 'manage',
  });
  // null: closed; 'new': a new plan; otherwise the plan being edited.
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  if (!data.data) return <BlockSkeleton rows={4} />;
  const create = manage.can ? (
    <Button onClick={() => setEditing('new')}>
      <PlusIcon data-icon='inline-start' />
      {t('payroll.insurance.plan.create')}
    </Button>
  ) : null;
  const sheet = (
    <PlanSheet
      plan={editing}
      onClose={() => setEditing(null)}
      onSaved={() => {
        setEditing(null);
        data.reload();
      }}
    />
  );
  if (!data.data.plans.length)
    return (
      <>
        <EmptyState
          title={t('payroll.insurance.noPlans')}
          description={
            manage.can
              ? t('payroll.insurance.plan.emptyDescription')
              : undefined
          }
          action={create}
        />
        {sheet}
      </>
    );
  return (
    <div className='space-y-4'>
      {create ? <div className='flex justify-end'>{create}</div> : null}
      <div className='grid gap-4 lg:grid-cols-2'>
        {data.data.plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            money={money}
            onEdit={manage.can ? () => setEditing(plan) : undefined}
          />
        ))}
      </div>
      {sheet}
    </div>
  );
}

function PlanCard({
  plan,
  money,
  onEdit,
}: {
  plan: Plan;
  money: (value: number | null | undefined) => string;
  onEdit?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-2'>
        <div className='flex flex-col gap-1.5'>
          <CardTitle>{plan.city}</CardTitle>
          <CardDescription>
            {plan.effectiveFrom} ~{' '}
            {plan.effectiveTo ?? t('payroll.insurance.open')}{' '}
            {plan.note ? `· ${plan.note}` : ''}
          </CardDescription>
        </div>
        {onEdit ? (
          <Button
            size='sm'
            variant='ghost'
            aria-label={t('payroll.insurance.plan.editOf', {
              city: plan.city,
            })}
            onClick={onEdit}
          >
            <PencilIcon data-icon='inline-start' />
            {t('payroll.common.edit')}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payroll.insurance.item')}</TableHead>
              <TableHead className='text-right'>
                {t('payroll.insurance.employerRate')}
              </TableHead>
              <TableHead className='text-right'>
                {t('payroll.insurance.employeeRate')}
              </TableHead>
              <TableHead className='text-right'>
                {t('payroll.insurance.baseRange')}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plan.items.map((item) => (
              <TableRow key={item.code}>
                <TableCell>
                  {t(`payroll.insurance.codes.${item.code}`)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {item.employerRate}%
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {item.employeeRate}%
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {money(item.baseMin)} ~ {money(item.baseMax)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

interface PlanItemDraft {
  code: InsuranceCode;
  employerRate: string;
  employeeRate: string;
  baseMin: string;
  baseMax: string;
}
interface PlanDraft {
  city: string;
  effectiveFrom: string;
  effectiveTo: string;
  note: string;
  items: PlanItemDraft[];
}

const isInsuranceCode = (code: string): code is InsuranceCode =>
  (INSURANCE_CODES as readonly string[]).includes(code);

const emptyItem = (code: InsuranceCode): PlanItemDraft => ({
  code,
  employerRate: '0',
  employeeRate: '0',
  baseMin: '0',
  baseMax: '0',
});

function draftOf(plan: Plan | 'new'): PlanDraft {
  if (plan === 'new')
    return {
      city: '',
      effectiveFrom: thisMonth(),
      effectiveTo: '',
      note: '',
      // All six with zero rates; the user fills them in or removes some.
      items: INSURANCE_CODES.map(emptyItem),
    };
  return {
    city: plan.city,
    effectiveFrom: plan.effectiveFrom,
    effectiveTo: plan.effectiveTo ?? '',
    note: plan.note ?? '',
    items: plan.items.flatMap((item) =>
      isInsuranceCode(item.code)
        ? [
            {
              code: item.code,
              employerRate: String(item.employerRate),
              employeeRate: String(item.employeeRate),
              baseMin: String(item.baseMin),
              baseMax: String(item.baseMax),
            },
          ]
        : [],
    ),
  };
}

const isNumber = (value: string): boolean =>
  value.trim() !== '' && Number.isFinite(Number(value));

/** The first problem of a draft as a translation key, or null when it can be sent. */
function draftProblem(draft: PlanDraft): string | null {
  if (!draft.city.trim()) return 'payroll.insurance.plan.cityRequired';
  if (
    !MONTH.test(draft.effectiveFrom) ||
    (draft.effectiveTo && !MONTH.test(draft.effectiveTo))
  )
    return 'payroll.insurance.plan.monthInvalid';
  if (draft.effectiveTo && draft.effectiveTo < draft.effectiveFrom)
    return 'payroll.insurance.plan.rangeInvalid';
  if (!draft.items.length) return 'payroll.insurance.plan.itemsRequired';
  for (const item of draft.items) {
    const rates = [item.employerRate, item.employeeRate];
    if (
      !rates.every(isNumber) ||
      rates.some((r) => Number(r) < 0 || Number(r) > 100)
    )
      return 'payroll.insurance.plan.rateInvalid';
    if (
      !isNumber(item.baseMin) ||
      !isNumber(item.baseMax) ||
      Number(item.baseMin) < 0 ||
      Number(item.baseMax) < Number(item.baseMin)
    )
      return 'payroll.insurance.plan.baseInvalid';
  }
  return null;
}

/** 新建方案 / 编辑方案: `POST` or `PUT talent/social-insurance/plans[/:id]`. */
function PlanSheet({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | 'new' | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Sheet
      open={plan !== null}
      onOpenChange={(open) => (open ? null : onClose())}
    >
      <SheetContent className='w-full gap-0 sm:max-w-2xl'>
        <SheetHeader>
          <SheetTitle>
            {plan === null || plan === 'new'
              ? t('payroll.insurance.plan.create')
              : t('payroll.insurance.plan.edit')}
          </SheetTitle>
          <SheetDescription>
            {t('payroll.insurance.plan.description')}
          </SheetDescription>
        </SheetHeader>
        {plan ? (
          <PlanForm
            key={plan === 'new' ? 'new' : plan.id}
            plan={plan}
            onSaved={onSaved}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function PlanForm({
  plan,
  onSaved,
}: {
  plan: Plan | 'new';
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const [draft, setDraft] = useState<PlanDraft>(() => draftOf(plan));
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const missing = INSURANCE_CODES.filter(
    (code) => !draft.items.some((item) => item.code === code),
  );
  const change = (patch: Partial<PlanDraft>) => {
    setProblem(null);
    setDraft({ ...draft, ...patch });
  };
  const setItem = (code: InsuranceCode, patch: Partial<PlanItemDraft>) =>
    change({
      items: draft.items.map((item) =>
        item.code === code ? { ...item, ...patch } : item,
      ),
    });

  async function save(): Promise<void> {
    const found = draftProblem(draft);
    if (found) {
      setProblem(found);
      return;
    }
    setSaving(true);
    try {
      await api.request({
        path:
          plan === 'new'
            ? 'talent/social-insurance/plans'
            : `talent/social-insurance/plans/${encodeURIComponent(plan.id)}`,
        method: plan === 'new' ? 'POST' : 'PUT',
        json: {
          city: draft.city.trim(),
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          note: draft.note.trim() || null,
          // Sent in the fixed order of the insurance codes.
          items: INSURANCE_CODES.flatMap((code) => {
            const item = draft.items.find((i) => i.code === code);
            return item
              ? [
                  {
                    code,
                    employerRate: Number(item.employerRate),
                    employeeRate: Number(item.employeeRate),
                    baseMin: Number(item.baseMin),
                    baseMax: Number(item.baseMax),
                  },
                ]
              : [];
          }),
        },
      });
      toast.add({ type: 'success', title: t('payroll.common.saved') });
      onSaved();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    } finally {
      setSaving(false);
    }
  }

  const numberField = (
    item: PlanItemDraft,
    field: 'employerRate' | 'employeeRate' | 'baseMin' | 'baseMax',
    label: string,
  ) => {
    const id = `plan-${item.code}-${field}`;
    return (
      <Field>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        <Input
          id={id}
          inputMode='decimal'
          value={item[field]}
          onChange={(e) => setItem(item.code, { [field]: e.target.value })}
        />
      </Field>
    );
  };

  return (
    <>
      <div className='flex-1 overflow-y-auto px-4'>
        <FieldGroup>
          <div className='grid gap-4 sm:grid-cols-3'>
            <Field>
              <FieldLabel htmlFor='plan-city'>
                {t('payroll.insurance.city')}
              </FieldLabel>
              <Input
                id='plan-city'
                maxLength={64}
                value={draft.city}
                onChange={(e) => change({ city: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='plan-from'>
                {t('payroll.insurance.plan.effectiveFrom')}
              </FieldLabel>
              <Input
                id='plan-from'
                type='month'
                value={draft.effectiveFrom}
                onChange={(e) => change({ effectiveFrom: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='plan-to'>
                {t('payroll.insurance.plan.effectiveTo')}
              </FieldLabel>
              <Input
                id='plan-to'
                type='month'
                value={draft.effectiveTo}
                onChange={(e) => change({ effectiveTo: e.target.value })}
              />
              <FieldDescription>
                {t('payroll.insurance.plan.effectiveToHint')}
              </FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor='plan-note'>
              {t('payroll.insurance.plan.note')}
            </FieldLabel>
            <Textarea
              id='plan-note'
              rows={2}
              maxLength={500}
              value={draft.note}
              onChange={(e) => change({ note: e.target.value })}
            />
          </Field>
          <section className='flex flex-col gap-3'>
            <div>
              <h3 className='text-sm font-medium'>
                {t('payroll.insurance.plan.items')}
              </h3>
              <p className='text-sm text-muted-foreground'>
                {t('payroll.insurance.plan.itemsHint')}
              </p>
            </div>
            {draft.items.map((item) => {
              const name = t(`payroll.insurance.codes.${item.code}`);
              return (
                <div
                  // The code is fixed for the row, so it is a stable key.
                  key={item.code}
                  className='flex flex-col gap-3 rounded-lg border p-3'
                >
                  <div className='flex items-center justify-between gap-2'>
                    <span className='text-sm font-medium'>{name}</span>
                    <Button
                      size='icon-sm'
                      variant='ghost'
                      aria-label={t('payroll.insurance.plan.removeItem', {
                        name,
                      })}
                      onClick={() =>
                        change({
                          items: draft.items.filter(
                            (i) => i.code !== item.code,
                          ),
                        })
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                  <div className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
                    {numberField(
                      item,
                      'employerRate',
                      t('payroll.insurance.plan.employerRate'),
                    )}
                    {numberField(
                      item,
                      'employeeRate',
                      t('payroll.insurance.plan.employeeRate'),
                    )}
                    {numberField(
                      item,
                      'baseMin',
                      t('payroll.insurance.plan.baseMin'),
                    )}
                    {numberField(
                      item,
                      'baseMax',
                      t('payroll.insurance.plan.baseMax'),
                    )}
                  </div>
                </div>
              );
            })}
            {missing.length ? (
              <div className='flex flex-wrap gap-2'>
                {missing.map((code) => (
                  <Button
                    key={code}
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      change({ items: [...draft.items, emptyItem(code)] })
                    }
                  >
                    <PlusIcon data-icon='inline-start' />
                    {t(`payroll.insurance.codes.${code}`)}
                  </Button>
                ))}
              </div>
            ) : null}
          </section>
          {problem ? <FieldError>{t(problem)}</FieldError> : null}
        </FieldGroup>
      </div>
      <SheetFooter>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner data-icon='inline-start' /> : null}
          {t('payroll.common.save')}
        </Button>
      </SheetFooter>
    </>
  );
}

function EnrolmentsTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const data = useOverview();
  const [editing, setEditing] = useState<{
    id: string;
    socialBase: string;
    housingFundBase: string;
  } | null>(null);
  async function save(): Promise<void> {
    if (!editing) return;
    try {
      const { data: result } = await api.request<{
        data: { clamped: string[] };
      }>({
        path: `talent/social-insurance/enrolments/${encodeURIComponent(editing.id)}`,
        method: 'PUT',
        json: {
          socialBase: Number(editing.socialBase),
          housingFundBase: Number(editing.housingFundBase),
        },
      });
      toast.add({
        type: 'success',
        title: result.clamped.length
          ? t('payroll.insurance.clamped')
          : t('payroll.common.saved'),
      });
      setEditing(null);
      data.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    }
  }
  if (data.error) return <LoadError error={data.error} onRetry={data.reload} />;
  if (!data.data) return <BlockSkeleton rows={6} />;
  const rows = data.data.enrolments.filter(
    (e) => e.pendingAction !== 'stop' || e.status === 'pending',
  );
  return (
    <div className='space-y-4'>
      {/* 上线准备: 导入参保 (talent.socialInsurance import). */}
      <div className='flex justify-end'>
        <OpeningImportButton kind='enrolments' onImported={data.reload} />
      </div>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payroll.common.employeeNo')}</TableHead>
              <TableHead>{t('payroll.common.name')}</TableHead>
              <TableHead>{t('payroll.insurance.city')}</TableHead>
              <TableHead className='text-right'>
                {t('payroll.insurance.socialBase')}
              </TableHead>
              <TableHead className='text-right'>
                {t('payroll.insurance.housingFundBase')}
              </TableHead>
              <TableHead>{t('payroll.insurance.period')}</TableHead>
              <TableHead>{t('payroll.cycles.status')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((e) => (
              <TableRow key={e.id}>
                <TableCell>{e.employeeNo}</TableCell>
                <TableCell>{e.employeeName}</TableCell>
                <TableCell>{e.planCity}</TableCell>
                {editing?.id === e.id ? (
                  <>
                    <TableCell>
                      <Input
                        aria-label={t('payroll.insurance.socialBase')}
                        value={editing.socialBase}
                        onChange={(ev) =>
                          setEditing({
                            ...editing,
                            socialBase: ev.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={t('payroll.insurance.housingFundBase')}
                        value={editing.housingFundBase}
                        onChange={(ev) =>
                          setEditing({
                            ...editing,
                            housingFundBase: ev.target.value,
                          })
                        }
                      />
                    </TableCell>
                  </>
                ) : (
                  <>
                    <TableCell className='text-right tabular-nums'>
                      {money(e.socialBase)}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {money(e.housingFundBase)}
                    </TableCell>
                  </>
                )}
                <TableCell>
                  {e.startMonth} ~ {e.endMonth ?? t('payroll.insurance.open')}
                </TableCell>
                <TableCell>
                  <PayrollStatus value={e.status} />
                </TableCell>
                <TableCell className='text-right'>
                  {e.status === 'active' ? (
                    editing?.id === e.id ? (
                      <Button size='sm' onClick={() => void save()}>
                        {t('payroll.common.save')}
                      </Button>
                    ) : (
                      <Button
                        size='sm'
                        variant='ghost'
                        onClick={() =>
                          setEditing({
                            id: e.id,
                            socialBase: String(e.socialBase),
                            housingFundBase: String(e.housingFundBase),
                          })
                        }
                      >
                        {t('payroll.common.edit')}
                      </Button>
                    )
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function ChangesTab({ initialMonth }: { initialMonth: string }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const [month, setMonth] = useState(initialMonth);
  // The 增减员 file is an export: it needs the export action, not view.
  const exportable = useCan({
    resource: { type: 'composite', id: 'talent.socialInsurance' },
    action: 'export',
  });
  const data = useRemote<{
    pending: Enrolment[];
    started: Enrolment[];
    stopped: Enrolment[];
  }>(/^\d{4}-\d{2}$/u.test(month) ? 'talent/social-insurance/changes' : null, {
    month,
  });
  async function confirm(id: string): Promise<void> {
    try {
      const { data: result } = await api.request<{
        data: { clamped: string[] };
      }>({
        path: `talent/social-insurance/enrolments/${encodeURIComponent(id)}/confirm`,
        method: 'POST',
        json: {},
      });
      toast.add({
        type: 'success',
        title: result.clamped.length
          ? t('payroll.insurance.clamped')
          : t('payroll.insurance.confirmed'),
      });
      data.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    }
  }
  const section = (title: string, rows: Enrolment[], action: boolean) => (
    <section className='space-y-2'>
      <h3 className='text-sm font-medium'>{title}</h3>
      {!rows.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.insurance.none')}
        </p>
      ) : (
        <ul className='divide-y rounded-lg border'>
          {rows.map((e) => (
            <li
              key={e.id}
              className='flex flex-wrap items-center justify-between gap-2 p-3 text-sm'
            >
              <span>
                {e.employeeName}（{e.employeeNo}） · {e.planCity} ·{' '}
                {money(e.socialBase)} ·{' '}
                {e.pendingAction === 'stop'
                  ? t('payroll.insurance.stopFrom', { month: e.endMonth ?? '' })
                  : t('payroll.insurance.startFrom', { month: e.startMonth })}
              </span>
              {action ? (
                <Button size='sm' onClick={() => void confirm(e.id)}>
                  {t('payroll.insurance.confirm')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end gap-2'>
        <Field className='w-48'>
          <FieldLabel htmlFor='changes-month'>
            {t('payroll.cycles.month')}
          </FieldLabel>
          <Input
            id='changes-month'
            type='month'
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </Field>
        {exportable.can ? (
          <Button
            variant='outline'
            onClick={() =>
              void downloadFile(
                api,
                'talent/social-insurance/changes/export',
                `${month}-social-insurance-changes.csv`,
                { month },
              ).catch((cause: unknown) =>
                toast.add({ type: 'error', title: failure(cause) }),
              )
            }
          >
            <DownloadIcon data-icon='inline-start' />
            {t('payroll.insurance.exportChanges')}
          </Button>
        ) : null}
      </div>
      {data.error ? (
        <LoadError error={data.error} onRetry={data.reload} />
      ) : !data.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <>
          {section(t('payroll.insurance.pending'), data.data.pending, true)}
          {section(t('payroll.insurance.started'), data.data.started, false)}
          {section(t('payroll.insurance.stopped'), data.data.stopped, false)}
        </>
      )}
    </div>
  );
}

function DeductionsTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const [year] = useState(() => new Date().getFullYear());
  const list = useRemote<
    {
      employeeId: string;
      employeeName: string;
      employeeNo: string;
      items: {
        type: string;
        monthlyAmount: number;
        startMonth: string;
        endMonth: string | null;
      }[];
    }[]
  >('talent/social-insurance/deductions', { year });
  const people = useOverview();
  const [form, setForm] = useState({
    employeeId: '',
    type: 'children',
    monthlyAmount: '',
    startMonth: `${year}-01`,
  });
  async function add(): Promise<void> {
    const existing =
      list.data?.find((d) => d.employeeId === form.employeeId)?.items ?? [];
    try {
      await api.request({
        path: 'talent/social-insurance/deductions',
        method: 'PUT',
        json: {
          employeeId: form.employeeId,
          year,
          items: [
            ...existing,
            {
              type: form.type,
              monthlyAmount: Number(form.monthlyAmount),
              startMonth: form.startMonth,
              endMonth: null,
            },
          ],
        },
      });
      toast.add({ type: 'success', title: t('payroll.common.saved') });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    }
  }
  const employees = [
    ...new Map(
      (people.data?.enrolments ?? []).map((e) => [e.employeeId, e]),
    ).values(),
  ];
  return (
    <div className='space-y-4'>
      {/* 上线准备: 导入专项附加扣除 (talent.socialInsurance import). */}
      <div className='flex justify-end'>
        <OpeningImportButton kind='deductions' onImported={list.reload} />
      </div>
      <div className='grid gap-3 sm:grid-cols-5'>
        <Field>
          <FieldLabel htmlFor='ded-employee'>
            {t('payroll.common.name')}
          </FieldLabel>
          <NativeSelect
            id='ded-employee'
            value={form.employeeId}
            onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
          >
            <NativeSelectOption value=''>
              {t('payroll.common.choose')}
            </NativeSelectOption>
            {employees.map((e) => (
              <NativeSelectOption key={e.employeeId} value={e.employeeId}>
                {e.employeeName}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='ded-type'>
            {t('payroll.deductions.type')}
          </FieldLabel>
          <NativeSelect
            id='ded-type'
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {DEDUCTION_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {t(`payroll.deductions.types.${type}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='ded-amount'>
            {t('payroll.deductions.monthlyAmount')}
          </FieldLabel>
          <Input
            id='ded-amount'
            inputMode='decimal'
            value={form.monthlyAmount}
            onChange={(e) =>
              setForm({ ...form, monthlyAmount: e.target.value })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='ded-start'>
            {t('payroll.deductions.startMonth')}
          </FieldLabel>
          <Input
            id='ded-start'
            type='month'
            value={form.startMonth}
            onChange={(e) => setForm({ ...form, startMonth: e.target.value })}
          />
        </Field>
        <div className='flex items-end'>
          <Button
            disabled={!form.employeeId || !(Number(form.monthlyAmount) > 0)}
            onClick={() => void add()}
          >
            {t('payroll.deductions.add')}
          </Button>
        </div>
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.length ? (
        <EmptyState title={t('payroll.deductions.empty')} />
      ) : (
        <ul className='divide-y rounded-lg border text-sm'>
          {list.data.map((d) => (
            <li key={d.employeeId} className='p-3'>
              <span className='font-medium'>
                {d.employeeName}（{d.employeeNo}）
              </span>
              {d.items.map((item, index) => (
                <span
                  key={`${item.type}-${String(index)}`}
                  className='ml-3 text-muted-foreground'
                >
                  {t(`payroll.deductions.types.${item.type}`)}{' '}
                  {money(item.monthlyAmount)} · {item.startMonth}
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function BaseTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const data = useRemote<{
    year: number;
    month: string;
    generatedAt: string;
    items: {
      enrolmentId: string;
      employeeName: string;
      employeeNo: string;
      averageGross: number;
      currentSocialBase: number;
      socialBase: number;
      housingFundBase: number;
      clamped: string[];
      status: string;
    }[];
  } | null>('talent/social-insurance/base-adjustment');
  const [year, setYear] = useState(() => String(new Date().getFullYear()));
  async function run(path: string, json: unknown): Promise<void> {
    try {
      await api.request({ path, method: 'POST', json });
      toast.add({ type: 'success', title: t('payroll.common.saved') });
      data.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    }
  }
  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end gap-2'>
        <Field className='w-32'>
          <FieldLabel htmlFor='base-year'>{t('payroll.base.year')}</FieldLabel>
          <Input
            id='base-year'
            inputMode='numeric'
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
        </Field>
        <Button
          variant='outline'
          onClick={() =>
            void run('talent/social-insurance/base-adjustment/generate', {
              year: Number(year),
            })
          }
        >
          {t('payroll.base.generate')}
        </Button>
        {data.data?.items.some((i) => i.status === 'pending') ? (
          <Button
            onClick={() =>
              void run('talent/social-insurance/base-adjustment/apply', {})
            }
          >
            {t('payroll.base.apply')}
          </Button>
        ) : null}
      </div>
      {data.error ? (
        <LoadError error={data.error} onRetry={data.reload} />
      ) : data.data === undefined ? (
        <BlockSkeleton rows={3} />
      ) : !data.data?.items.length ? (
        <EmptyState title={t('payroll.base.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.common.name')}</TableHead>
                <TableHead className='text-right'>
                  {t('payroll.base.average')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.base.current')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.base.suggested')}
                </TableHead>
                <TableHead>{t('payroll.cycles.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.items.map((item) => (
                <TableRow key={item.enrolmentId}>
                  <TableCell>
                    {item.employeeName}（{item.employeeNo}）
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(item.averageGross)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(item.currentSocialBase)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(item.socialBase)}
                    {item.clamped.length ? ` ${t('payroll.base.clamped')}` : ''}
                  </TableCell>
                  <TableCell>
                    {t(`payroll.base.status.${item.status}`)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
