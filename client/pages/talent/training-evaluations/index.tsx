/**
 * V4-13 培训评估 (`/talent/training-evaluations`): 待我填写 (a learner's l1
 * after completing training, a head's l3 thirty days later), the results by
 * course, session and instructor (hr.admin all, instructors their own
 * courses and sessions, heads their departments) and, for hr.admin, the
 * questionnaire periods. A task opens as the child page `:evaluationId`.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { formatDate, useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Task {
  id: string;
  level: 'l1' | 'l3';
  targetTitle: string;
  employeeName: string;
  status: string;
  dueAt: string | null;
  mine: boolean;
}
interface Row {
  id?: string;
  key?: string;
  title?: string;
  name?: string;
  l1Average: number | null;
  l1Responses: number;
  l1Tasks: number;
  l3Average: number | null;
  l3Responses: number;
  examPassRate?: number | null;
}
interface Summary {
  courses: Row[];
  sessions: Row[];
  instructors: Row[];
}

export default function TrainingEvaluationsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'mine';
  // Tabs follow what the caller may read: the summary (view) and the rules (configure).
  const summary = useRemote<Summary>('talent/training-evaluations/summary');
  const settings = useRemote<{ value: Record<string, number> }>('talent/talent-reviews/settings');
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', value);
    setParams(next, { replace: true });
  };
  return (
    <PageContainer>
      <PageHeader title={t('talentReview.evaluations.title')} description={t('talentReview.evaluations.description')} />
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTrigger value='mine'>{t('talentReview.evaluations.mine')}</TabsTrigger>
          {summary.data ? (
            <TabsTrigger value='summary'>{t('talentReview.evaluations.summary')}</TabsTrigger>
          ) : null}
          {settings.data ? (
            <TabsTrigger value='rules'>{t('talentReview.evaluations.rules')}</TabsTrigger>
          ) : null}
        </TabsList>
      </Tabs>
      {tab === 'summary' && summary.data ? (
        <SummaryTab data={summary.data} />
      ) : tab === 'rules' && settings.data ? (
        <RulesTab data={settings.data} onSaved={settings.reload} />
      ) : (
        <MineTab />
      )}
      <Outlet />
    </PageContainer>
  );
}

function MineTab(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const mine = useRemote<Task[]>('talent/training-evaluations/mine');
  if (mine.error) return <LoadError error={mine.error} onRetry={mine.reload} />;
  if (!mine.data) return <BlockSkeleton rows={3} />;
  if (!mine.data.length) return <EmptyState title={t('talentReview.evaluations.noTasks')} />;
  return (
    <div className='flex flex-col gap-2'>
      {mine.data.map((task) => (
        <Link
          key={task.id}
          to={encodeURIComponent(task.id)}
          className='bg-card hover:bg-accent flex flex-col gap-1 rounded-lg border p-3 text-sm'
        >
          <span className='flex items-center justify-between gap-2'>
            <span className='font-medium'>
              {t(`talentReview.evaluations.level.${task.level}`)} · {task.targetTitle}
            </span>
            <TrStatusBadge status={task.status} />
          </span>
          <span className='text-muted-foreground text-xs'>
            {task.level === 'l3' ? `${task.employeeName} · ` : ''}
            {t('talentReview.evaluations.due', { date: formatDate(locale, task.dueAt) })}
          </span>
        </Link>
      ))}
    </div>
  );
}

function SummaryTab({ data }: { data: Summary }): ReactElement {
  const { t } = useTranslation();
  const table = (title: string, rows: Row[], withPass: boolean) => (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {!rows.length ? (
          <p className='text-muted-foreground text-sm'>{t('talentReview.evaluations.noData')}</p>
        ) : (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talentReview.evaluations.target')}</TableHead>
                  <TableHead className='text-end'>{t('talentReview.evaluations.l1Average')}</TableHead>
                  <TableHead className='text-end'>{t('talentReview.evaluations.responses')}</TableHead>
                  {withPass ? <TableHead className='text-end'>{t('talentReview.evaluations.examPassRate')}</TableHead> : null}
                  <TableHead className='text-end'>{t('talentReview.evaluations.l3Average')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.id ?? r.key}>
                    <TableCell>{r.title ?? r.name}</TableCell>
                    <TableCell className='text-end tabular-nums'>{r.l1Average ?? '—'}</TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {r.l1Responses}/{r.l1Tasks}
                    </TableCell>
                    {withPass ? (
                      <TableCell className='text-end tabular-nums'>
                        {r.examPassRate === null || r.examPassRate === undefined ? '—' : `${r.examPassRate}%`}
                      </TableCell>
                    ) : null}
                    <TableCell className='text-end tabular-nums'>{r.l3Average ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
  return (
    <div className='flex flex-col gap-4'>
      {table(t('talentReview.evaluations.byCourse'), data.courses, true)}
      {table(t('talentReview.evaluations.bySession'), data.sessions, false)}
      {table(t('talentReview.evaluations.byInstructor'), data.instructors, false)}
    </div>
  );
}

function RulesTab({
  data,
  onSaved,
}: {
  data: { value: Record<string, number> };
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const keys = ['l1DueDays', 'l3AfterDays', 'l3DueDays', 'evaluationReminderDays'] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talentReview.evaluations.rules')}</CardTitle>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <div className='grid gap-3 sm:grid-cols-2'>
          {keys.map((key) => (
            <Field key={key}>
              <FieldLabel htmlFor={`rule-${key}`}>{t(`talentReview.evaluations.settings.${key}`)}</FieldLabel>
              <Input
                id={`rule-${key}`}
                type='number'
                min={0}
                value={values[key] ?? String(data.value[key] ?? '')}
                onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          className='self-end'
          disabled={action.busy || !Object.keys(values).length}
          onClick={() => { void (async () => {
            const done = await action.run(
              {
                method: 'PUT',
                path: 'talent/talent-reviews/settings/evaluation',
                json: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)])),
              },
              t('talentReview.evaluations.rulesSaved'),
            );
            if (done) {
              setValues({});
              onSaved();
            }
          })(); }}
        >
          {t('talentReview.common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
