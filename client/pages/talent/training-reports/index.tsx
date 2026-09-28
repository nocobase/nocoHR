import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { str } from '@/components/talent/text';
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface TrainingReport {
  metrics: {
    completionRate: number | null;
    overdue: number;
    firstPassRate: number | null;
    finalPassRate: number | null;
    coverage: number | null;
    expiring: number;
    expired: number;
    openGaps: number;
    pathCompletionRate: number | null;
    pathOnTimeRate: number | null;
    attendanceRate: number | null;
    practiceCount: number;
    practiceAverage: number | null;
    planAdoptionRate: number | null;
  };
  trend: {
    month: string;
    completionRate: number | null;
    passRate: number | null;
  }[];
  coverageByDepartment: {
    departmentId: string;
    title: string;
    coverage: number | null;
    covered: number;
    total: number;
  }[];
  details: {
    completion: {
      employee: string;
      target: string;
      status: string;
      dueDate: string | null;
    }[];
    overdue: { employee: string; target: string; dueDate: string | null }[];
    exams: {
      employee: string;
      exam: string;
      firstPassed: boolean;
      passed: boolean;
    }[];
    coverageMissing: {
      employee: string;
      position: string;
      certification: string;
    }[];
    expiring: {
      employee: string;
      certification: string;
      expiresAt: string | null;
    }[];
    expired: {
      employee: string;
      certification: string;
      expiresAt: string | null;
    }[];
    gaps: { question: string; askCount: number; lastAskedAt: string }[];
    paths: {
      employee: string;
      path: string;
      status: string;
      progress: number;
      dueDate: string | null;
      onTime: boolean;
    }[];
    attendance: {
      employee: string;
      session: string;
      startAt: string | null;
      status: string;
      method: string | null;
    }[];
    practice: {
      employee: string;
      scenario: string;
      score: number | null;
      completedAt: string | null;
    }[];
  };
}

type MetricKey = keyof TrainingReport['metrics'];

/** Which detail list each metric card opens; the plan adoption rate has none. */
const METRIC_DETAIL: Record<MetricKey, keyof TrainingReport['details'] | null> =
  {
    completionRate: 'completion',
    overdue: 'overdue',
    firstPassRate: 'exams',
    finalPassRate: 'exams',
    coverage: 'coverageMissing',
    expiring: 'expiring',
    expired: 'expired',
    openGaps: 'gaps',
    // V2 step 5.
    pathCompletionRate: 'paths',
    pathOnTimeRate: 'paths',
    attendanceRate: 'attendance',
    practiceCount: 'practice',
    practiceAverage: 'practice',
    planAdoptionRate: null,
  };
const PERCENT_METRICS = new Set<MetricKey>([
  'completionRate',
  'firstPassRate',
  'finalPassRate',
  'coverage',
  'pathCompletionRate',
  'pathOnTimeRate',
  'attendanceRate',
  'planAdoptionRate',
]);

function isoDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** 培训报表 — completion, pass rates, required-certificate coverage and open knowledge gaps in the caller's scope. */
export default function TrainingReportsPage(): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const steward = useCan({
    resource: { type: 'composite', id: 'talent.certificationSteward' },
    action: 'use',
  });
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  const [from, setFrom] = useState(isoDate(-364));
  const [to, setTo] = useState(isoDate(0));
  const [detail, setDetail] = useState<MetricKey | null>(null);
  const report = useRemote<TrainingReport>('talent/training-report', {
    departmentId: departmentId || undefined,
    positionId: positionId || undefined,
    from,
    to,
  });
  const trendConfig = useMemo(
    () =>
      ({
        completionRate: {
          label: t('talent.trainingReport.metrics.completionRate'),
          color: 'var(--chart-1)',
        },
        passRate: {
          label: t('talent.trainingReport.passRate'),
          color: 'var(--chart-2)',
        },
      }) satisfies ChartConfig,
    [t],
  );
  const coverageConfig = useMemo(
    () =>
      ({
        coverage: {
          label: t('talent.trainingReport.metrics.coverage'),
          color: 'var(--chart-1)',
        },
      }) satisfies ChartConfig,
    [t],
  );
  const data = report.data;
  const percent = (value: number | null) =>
    value === null ? '—' : `${value}%`;

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentTrainingReports')}
        description={t('talent.trainingReport.description')}
        actions={
          steward.can ? (
            <AssistantLauncher
              employee='certificationSteward'
              chatId='steward-training-report'
              label={t('talent.certifications.askSteward')}
              icon={<BotIcon data-icon='inline-start' />}
              task={() => ({
                title: t('talent.certifications.stewardTitle'),
                system: 'The user is on the training report page.',
                user: t('talent.trainingReport.stewardPrompt'),
              })}
            />
          ) : null
        }
      />
      <div className='flex flex-wrap items-end gap-3'>
        <Field className='w-56'>
          <FieldLabel htmlFor='training-dept'>
            {t('talent.fields.department')}
          </FieldLabel>
          <NativeSelect
            id='training-dept'
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.reports.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'  '.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-48'>
          <FieldLabel htmlFor='training-position'>
            {t('talent.fields.position')}
          </FieldLabel>
          <NativeSelect
            id='training-position'
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.trainingReport.allPositions')}
            </NativeSelectOption>
            {lookups.positions.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-40'>
          <FieldLabel htmlFor='training-from'>
            {t('talent.reports.from')}
          </FieldLabel>
          <Input
            id='training-from'
            type='date'
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </Field>
        <Field className='w-40'>
          <FieldLabel htmlFor='training-to'>
            {t('talent.reports.to')}
          </FieldLabel>
          <Input
            id='training-to'
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
          <div className='grid grid-cols-2 gap-4 lg:grid-cols-4'>
            {(Object.keys(METRIC_DETAIL) as MetricKey[]).map((key) => (
              <button
                key={key}
                type='button'
                disabled={!METRIC_DETAIL[key]}
                onClick={() => setDetail(key)}
                className='rounded-xl text-left focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
              >
                <Card className='h-full transition-colors hover:bg-muted/40'>
                  <CardHeader>
                    <CardDescription>
                      {t(`talent.trainingReport.metrics.${key}`)}
                    </CardDescription>
                    <CardTitle className='text-3xl tabular-nums'>
                      {PERCENT_METRICS.has(key)
                        ? percent(data.metrics[key])
                        : (data.metrics[key] ?? '—')}
                    </CardTitle>
                  </CardHeader>
                </Card>
              </button>
            ))}
          </div>
          <div className='grid gap-4 lg:grid-cols-2'>
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.trainingReport.trend')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ChartContainer config={trendConfig} className='h-64 w-full'>
                  <LineChart data={data.trend} margin={{ left: -20, right: 8 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey='month'
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                    />
                    <YAxis
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      unit='%'
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Line
                      dataKey='completionRate'
                      type='monotone'
                      stroke='var(--color-completionRate)'
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                    <Line
                      dataKey='passRate'
                      type='monotone'
                      stroke='var(--color-passRate)'
                      strokeWidth={2}
                      connectNulls
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ChartContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('talent.trainingReport.coverageByDepartment')}
                </CardTitle>
                <CardDescription>
                  {t('talent.trainingReport.coverageHint')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.coverageByDepartment.length ? (
                  <ChartContainer
                    config={coverageConfig}
                    className='h-64 w-full'
                  >
                    <BarChart
                      data={data.coverageByDepartment.map((d) => ({
                        ...d,
                        title:
                          lookups.departmentTitle(d.departmentId) || d.title,
                        coverage: d.coverage ?? 0,
                      }))}
                      layout='vertical'
                      margin={{ left: 8, right: 8 }}
                    >
                      <CartesianGrid horizontal={false} />
                      <XAxis
                        type='number'
                        domain={[0, 100]}
                        unit='%'
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
                        dataKey='coverage'
                        fill='var(--color-coverage)'
                        radius={4}
                        isAnimationActive={false}
                      />
                    </BarChart>
                  </ChartContainer>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('talent.trainingReport.noRequired')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
      <Sheet
        open={detail !== null}
        onOpenChange={(open) => (!open ? setDetail(null) : undefined)}
      >
        <SheetContent className='w-full overflow-y-auto sm:max-w-xl'>
          <SheetHeader>
            <SheetTitle>
              {detail ? t(`talent.trainingReport.metrics.${detail}`) : ''}
            </SheetTitle>
            <SheetDescription>
              {detail && METRIC_DETAIL[detail]
                ? t(`talent.trainingReport.details.${METRIC_DETAIL[detail]}`)
                : ''}
            </SheetDescription>
          </SheetHeader>
          <div className='px-4 pb-4'>
            {data && detail && METRIC_DETAIL[detail] ? (
              <DetailTable report={data} list={METRIC_DETAIL[detail]} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </PageContainer>
  );
}

function DetailTable({
  report,
  list,
}: {
  report: TrainingReport;
  list: keyof TrainingReport['details'];
}): ReactElement {
  const { t } = useTranslation();
  const columns: Record<keyof TrainingReport['details'], string[]> = {
    completion: ['employee', 'target', 'status', 'dueDate'],
    overdue: ['employee', 'target', 'dueDate'],
    exams: ['employee', 'exam', 'firstPassed', 'passed'],
    coverageMissing: ['employee', 'position', 'certification'],
    expiring: ['employee', 'certification', 'expiresAt'],
    expired: ['employee', 'certification', 'expiresAt'],
    gaps: ['question', 'askCount', 'lastAskedAt'],
    paths: ['employee', 'path', 'status', 'progress', 'dueDate', 'onTime'],
    attendance: ['employee', 'session', 'startAt', 'attendance', 'method'],
    practice: ['employee', 'scenario', 'score', 'completedAt'],
  };
  const rows = (report.details[list] as readonly Record<string, unknown>[]).map(
    // The attendance list's status is an enrollment status, labelled apart from task statuses.
    (row) => (list === 'attendance' ? { ...row, attendance: row.status } : row),
  );
  const cell = (column: string, value: unknown): string => {
    if (typeof value === 'boolean')
      return value ? t('talent.common.yes') : t('talent.common.no');
    if (column === 'status')
      return t(`talent.assignmentStatus.${String(value)}`);
    if (column === 'attendance')
      return t(`talent.sessions.enrollmentStatus.${str(value)}`);
    if (column === 'method' && value)
      return t(`talent.sessions.method.${str(value)}`);
    if (column === 'progress' && typeof value === 'number') return `${value}%`;
    if (
      (column === 'lastAskedAt' ||
        column === 'startAt' ||
        column === 'completedAt') &&
      typeof value === 'string'
    )
      return value.slice(0, 10);
    return value === null || value === undefined || value === ''
      ? '—'
      : str(value);
  };
  if (!rows.length)
    return (
      <p className='text-sm text-muted-foreground'>{t('talent.common.none')}</p>
    );
  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns[list].map((column) => (
            <TableHead key={column}>
              {t(`talent.trainingReport.columns.${column}`)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, index) => (
          <TableRow key={index}>
            {columns[list].map((column) => (
              <TableCell key={column}>{cell(column, row[column])}</TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
