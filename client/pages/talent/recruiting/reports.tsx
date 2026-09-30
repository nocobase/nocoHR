/**
 * V2-07 招聘 / 招聘报表 (`talent.recruitingReports`): conversion by stage,
 * days from publishing to joining, channels, the screening agreement rate,
 * interview attendance and the AI initial interview comparison. A recruiter
 * sees their requisitions; hr.admin the totals only.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import type { Report } from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export default function RecruitingReportsPage(): ReactElement {
  const { t } = useTranslation();
  const report = useRemote<Report>('talent/recruiting/reports');
  const data = report.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('recruiting.reports.title')}
        description={
          data?.scope === 'summary'
            ? t('recruiting.reports.summaryOnly')
            : t('recruiting.reports.description')
        }
      />
      {report.error ? (
        <LoadError error={report.error} onRetry={report.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <div className='space-y-4'>
          <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            <Metric
              title={t('recruiting.reports.daysToHire')}
              value={data.averageDaysToHire ?? '—'}
              hint={t('recruiting.reports.hires', { count: data.hires })}
            />
            <Metric
              title={t('recruiting.reports.agreement')}
              value={
                data.screening.agreementRate === null
                  ? '—'
                  : t('recruiting.reports.rate', {
                      rate: data.screening.agreementRate,
                    })
              }
              hint={t('recruiting.reports.agreementHint', {
                agreed: data.screening.agreed,
                decided: data.screening.decided,
              })}
            />
            <Metric
              title={t('recruiting.reports.attendance')}
              value={
                data.interviews.attendanceRate === null
                  ? '—'
                  : t('recruiting.reports.rate', {
                      rate: data.interviews.attendanceRate,
                    })
              }
              hint={t('recruiting.reports.attendanceHint', {
                attended: data.interviews.attended,
                held: data.interviews.held,
              })}
            />
            <Metric
              title={t('recruiting.reports.aiInterview')}
              value={String(data.aiInterview.compared)}
              hint={t('recruiting.reports.aiInterviewHint', {
                advanced: data.aiInterview.averageScoreWhenAdvanced ?? '—',
                other: data.aiInterview.averageScoreWhenNot ?? '—',
                count: data.aiInterview.compared,
              })}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>{t('recruiting.reports.funnel')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className='space-y-2'>
                {data.funnel.map((f) => (
                  <li
                    key={f.stage}
                    className='grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-sm'
                  >
                    <span>{t(`recruiting.status.stage.${f.stage}`)}</span>
                    <span className='h-2 rounded bg-muted'>
                      <span
                        className='block h-2 rounded bg-primary'
                        style={{
                          width: `${data.funnel[0].count ? Math.round((f.count / data.funnel[0].count) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <span className='text-right tabular-nums'>
                      {f.count}
                      {f.rate !== null ? ` · ${f.rate}%` : ''}
                    </span>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('recruiting.reports.channels')}</CardTitle>
            </CardHeader>
            <CardContent className='overflow-x-auto'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('recruiting.candidates.channel')}</TableHead>
                    <TableHead className='text-right'>
                      {t('recruiting.reports.applications')}
                    </TableHead>
                    <TableHead className='text-right'>
                      {t('recruiting.reports.hired')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.channels.map((c) => (
                    <TableRow key={c.name}>
                      <TableCell>
                        {t(`recruiting.labels.source.${c.name}`, {
                          defaultValue: c.name,
                        })}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {c.applications}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {c.hired}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}

function Metric({
  title,
  value,
  hint,
}: {
  title: string;
  value: string | number;
  hint: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className='text-2xl tabular-nums'>{value}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
    </Card>
  );
}
