import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

interface HrReport {
  reminderDays: { probation: number; contract: number };
  headcount: number;
  probation: number;
  joined: number;
  left: number;
  turnoverRate: number;
  monthly: { month: string; joined: number; left: number }[];
  byDepartment: { departmentId: string; title: string; count: number }[];
  tenure: { bucket: string; count: number }[];
  employmentTypes: { type: string; count: number }[];
  probationEnding: {
    employeeId: string;
    name: string;
    probationEndDate: string;
    departmentTitle: string;
  }[];
  contractsEnding: {
    contractId: string;
    employeeId: string;
    name: string;
    endDate: string;
    contractNo: string;
  }[];
}

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** 人事报表 — headcount, movement and reminders for the caller's scope. */
export default function HrReportsPage(): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const [departmentId, setDepartmentId] = useState('');
  const [from, setFrom] = useState(() => isoDate(-364));
  const [to, setTo] = useState(() => isoDate(0));
  const report = useRemote<HrReport>('talent/hr-reports', {
    departmentId: departmentId || undefined,
    from,
    to,
  });
  const trendConfig = useMemo(
    () =>
      ({
        joined: { label: t('talent.reports.joined'), color: 'var(--chart-1)' },
        left: { label: t('talent.reports.left'), color: 'var(--chart-2)' },
      }) satisfies ChartConfig,
    [t],
  );
  const barConfig = useMemo(
    () =>
      ({
        count: {
          label: t('talent.reports.headcount'),
          color: 'var(--chart-1)',
        },
      }) satisfies ChartConfig,
    [t],
  );
  const typeConfig = useMemo(
    () =>
      Object.fromEntries(
        ['fullTime', 'partTime', 'intern', 'outsourced', 'dispatched'].map(
          (type, i) => [
            type,
            {
              label: t(`talent.employmentType.${type}`),
              color: `var(--chart-${i + 1})`,
            },
          ],
        ),
      ) satisfies ChartConfig,
    [t],
  );
  const data = report.data;

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.reports.title')}
        description={t('talent.reports.description')}
      />
      <div className='flex flex-wrap items-end gap-3'>
        <Field className='w-56'>
          <FieldLabel htmlFor='report-dept'>
            {t('talent.fields.department')}
          </FieldLabel>
          <NativeSelect
            id='report-dept'
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.reports.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'  '.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-40'>
          <FieldLabel htmlFor='report-from'>
            {t('talent.reports.from')}
          </FieldLabel>
          <Input
            id='report-from'
            type='date'
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field className='w-40'>
          <FieldLabel htmlFor='report-to'>{t('talent.reports.to')}</FieldLabel>
          <Input
            id='report-to'
            type='date'
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </Field>
      </div>
      {report.error ? (
        <LoadError error={report.error} onRetry={report.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-5'>
            {[
              ['headcount', data.headcount],
              ['probation', data.probation],
              ['joined', data.joined],
              ['left', data.left],
              ['turnoverRate', `${data.turnoverRate}%`],
            ].map(([key, value]) => (
              <Card key={String(key)}>
                <CardHeader>
                  <CardDescription>
                    {t(`talent.reports.${key}`)}
                  </CardDescription>
                  <CardTitle className='text-3xl tabular-nums'>
                    {value}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <div className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.reports.trend')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={trendConfig} className='h-64 w-full'>
                  <LineChart
                    data={data.monthly}
                    margin={{ left: -20, right: 8 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey='month'
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line
                      dataKey='joined'
                      type='monotone'
                      stroke='var(--color-joined)'
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey='left'
                      type='monotone'
                      stroke='var(--color-left)'
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.reports.byDepartment')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={barConfig} className='h-64 w-full'>
                  <BarChart
                    data={data.byDepartment.map((d) => ({
                      ...d,
                      title: lookups.departmentTitle(d.departmentId) || d.title,
                    }))}
                    layout='vertical'
                    margin={{ left: 8, right: 8 }}
                  >
                    <CartesianGrid horizontal={false} />
                    <XAxis
                      type='number'
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                    />
                    <YAxis
                      type='category'
                      dataKey='title'
                      width={96}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey='count'
                      fill='var(--color-count)'
                      radius={4}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.reports.tenure')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={barConfig} className='h-56 w-full'>
                  <BarChart
                    data={data.tenure.map((b) => ({
                      ...b,
                      label: t(`talent.reports.tenureBuckets.${b.bucket}`),
                    }))}
                    margin={{ left: -20, right: 8 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey='label' tickLine={false} axisLine={false} />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      dataKey='count'
                      fill='var(--color-count)'
                      radius={4}
                      isAnimationActive={false}
                    />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.reports.employmentTypes')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={typeConfig} className='h-56 w-full'>
                  <PieChart>
                    <ChartTooltip
                      content={<ChartTooltipContent nameKey='type' hideLabel />}
                    />
                    <Pie
                      data={data.employmentTypes}
                      dataKey='count'
                      nameKey='type'
                      innerRadius={48}
                      strokeWidth={2}
                      isAnimationActive={false}
                    >
                      {data.employmentTypes.map((entry) => (
                        <Cell
                          key={entry.type}
                          fill={`var(--color-${entry.type})`}
                        />
                      ))}
                    </Pie>
                    <ChartLegend
                      content={<ChartLegendContent nameKey='type' />}
                    />
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>
          <div className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('talent.reports.probationEnding', {
                    days: data.reminderDays.probation,
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-2 text-sm'>
                {data.probationEnding.length ? (
                  data.probationEnding.map((p) => (
                    <div
                      key={p.employeeId}
                      className='flex justify-between gap-3'
                    >
                      <Link
                        className='hover:underline'
                        to={`/talent/employees/${p.employeeId}/profile`}
                      >
                        {p.name}
                      </Link>
                      <span className='text-muted-foreground tabular-nums'>
                        {p.probationEndDate}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className='text-muted-foreground'>
                    {t('talent.common.none')}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('talent.reports.contractsEnding', {
                    days: data.reminderDays.contract,
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-2 text-sm'>
                {data.contractsEnding.length ? (
                  data.contractsEnding.map((c) => (
                    <div
                      key={c.contractId}
                      className='flex justify-between gap-3'
                    >
                      <span>
                        {c.name}{' '}
                        <span className='text-muted-foreground'>
                          · {c.contractNo}
                        </span>
                      </span>
                      <span className='text-muted-foreground tabular-nums'>
                        {c.endDate}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className='text-muted-foreground'>
                    {t('talent.common.none')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </PageContainer>
  );
}
