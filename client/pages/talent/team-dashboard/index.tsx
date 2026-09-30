import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, DownloadIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { downloadFile } from '@/components/talent/download';
import type { CertState, Dashboard } from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
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

const STATE_VARIANT: Record<
  CertState,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  valid: 'secondary',
  expiring: 'default',
  expired: 'destructive',
  missing: 'destructive',
  notRequired: 'outline',
};

/** Gap cells on the chart palette: no gap, one level, two or more. */
function gapTone(gap: number | null): string {
  if (gap === null) return 'bg-transparent';
  if (gap <= 0) return 'bg-muted';
  if (gap === 1) return 'bg-primary/25';
  return 'bg-primary/60 text-primary-foreground';
}

/**
 * 团队看板 (V3-11): the certificate matrix, the gap heat map, problem records
 * by month and competency, and learning progress, within the viewer's scope
 * (a head sees their departments), from the same data as each profile.
 */
export default function TeamDashboardPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const [departmentId, setDepartmentId] = useState(
    params.get('department') ?? '',
  );
  const dashboard = useRemote<Dashboard>('talent/team-dashboard', {
    departmentId: departmentId || undefined,
  });
  const data = dashboard.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.teamDashboard.title')}
        description={t('talent.insights.teamDashboard.description')}
        actions={
          <div className='flex flex-wrap gap-2'>
            <AssistantLauncher
              employee='talentAnalyst'
              chatId='talent-analyst-dashboard'
              label={t('authz.talentAnalyst.title')}
              icon={<BotIcon data-icon='inline-start' />}
              variant='outline'
              task={() => ({
                title: t('authz.talentAnalyst.title'),
                system: `The user is on the team dashboard${departmentId ? ` of department ${departmentId}` : ''}.`,
                user: '',
              })}
            />
            {data?.canExport ? (
              <Button
                variant='outline'
                onClick={() =>
                  void downloadFile(
                    api,
                    'talent/team-dashboard/export',
                    'team-dashboard.xlsx',
                    { departmentId: departmentId || undefined },
                  )
                }
              >
                <DownloadIcon data-icon='inline-start' />
                {t('talent.insights.common.export')}
              </Button>
            ) : null}
          </div>
        }
      />
      <Field className='w-64 max-w-full'>
        <FieldLabel htmlFor='dashboard-department'>
          {t('talent.insights.common.department')}
        </FieldLabel>
        <NativeSelect
          id='dashboard-department'
          value={departmentId}
          onChange={(e) => {
            setDepartmentId(e.target.value);
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('department', e.target.value);
            else next.delete('department');
            setParams(next, { replace: true });
          }}
        >
          <NativeSelectOption value=''>
            {t('talent.insights.common.allDepartments')}
          </NativeSelectOption>
          {(data?.departments ?? []).map((d) => (
            <NativeSelectOption key={d.id} value={d.id}>
              {lookups.departmentTitle(d.id) || d.title}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      {dashboard.error ? (
        <LoadError error={dashboard.error} onRetry={dashboard.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : !data.people ? (
        <EmptyState title={t('talent.insights.teamDashboard.noPeople')} />
      ) : (
        <div className='space-y-4'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
            {(
              [
                ['inProgress', data.learning.inProgress],
                ['overdue', data.learning.overdue],
                ['completedThisMonth', data.learning.completedThisMonth],
              ] as const
            ).map(([key, value]) => (
              <Card key={key}>
                <CardHeader>
                  <CardDescription>
                    {t('talent.insights.teamDashboard.learning')} ·{' '}
                    {t(`talent.insights.teamDashboard.${key}`)}
                  </CardDescription>
                  <CardTitle className='text-2xl tabular-nums'>
                    {value}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                {t('talent.insights.teamDashboard.certMatrix')}
              </CardTitle>
              <CardDescription>
                {t('talent.insights.teamDashboard.certMatrixHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.certMatrix.columns.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.insights.teamDashboard.noColumns')}
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t('talent.insights.common.employee')}
                        </TableHead>
                        <TableHead>
                          {t('talent.insights.common.position')}
                        </TableHead>
                        {data.certMatrix.columns.map((c) => (
                          <TableHead key={c.id}>{c.title}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.certMatrix.rows.map((row) => (
                        <TableRow key={row.employeeId}>
                          <TableCell className='font-medium'>
                            {row.name}
                          </TableCell>
                          <TableCell>{row.positionTitle}</TableCell>
                          {row.cells.map((cell) => (
                            <TableCell key={cell.certificationId}>
                              {cell.state === 'notRequired' ? (
                                t(
                                  'talent.insights.teamDashboard.states.notRequired',
                                )
                              ) : (
                                <Link
                                  to={`/talent/certifications/${encodeURIComponent(cell.certificationId)}`}
                                  className='inline-flex flex-wrap items-center gap-1'
                                >
                                  <Badge variant={STATE_VARIANT[cell.state]}>
                                    {t(
                                      `talent.insights.teamDashboard.states.${cell.state}`,
                                    )}
                                  </Badge>
                                  {cell.expiresAt &&
                                  cell.state !== 'missing' ? (
                                    <span className='text-xs text-muted-foreground'>
                                      {cell.expiresAt}
                                    </span>
                                  ) : null}
                                </Link>
                              )}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                {t('talent.insights.teamDashboard.heatmap')}
              </CardTitle>
              <CardDescription>
                {t('talent.insights.teamDashboard.heatmapHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('talent.insights.common.employee')}
                      </TableHead>
                      {data.heatmap.columns.map((c) => (
                        <TableHead key={c.id}>{c.title}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.heatmap.rows.map((row) => (
                      <TableRow key={row.employeeId}>
                        <TableCell className='font-medium'>
                          {row.name}
                        </TableCell>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.competencyId} className='p-1'>
                            {cell.requiredLevel === null ? (
                              <span className='text-muted-foreground'>—</span>
                            ) : (
                              <span
                                className={`block rounded-md px-2 py-1 text-center tabular-nums ${gapTone(cell.gap)}`}
                                title={
                                  cell.currentLevel === null
                                    ? t(
                                        'talent.insights.teamDashboard.unassessed',
                                      )
                                    : undefined
                                }
                              >
                                {cell.currentLevel ?? 0}/{cell.requiredLevel}
                              </span>
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.insights.teamDashboard.trend')}</CardTitle>
              <CardDescription>
                {t('talent.insights.teamDashboard.trendHint')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!data.trend.series.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.insights.teamDashboard.noTrend')}
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t('talent.insights.signals.columns.competency')}
                        </TableHead>
                        {data.trend.months.map((m) => (
                          <TableHead key={m} className='text-right'>
                            {m}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.trend.series.map((series) => (
                        <TableRow key={series.competencyId ?? 'none'}>
                          <TableCell>
                            {series.competencyId
                              ? series.title
                              : t('talent.insights.teamDashboard.unmatched')}
                          </TableCell>
                          {series.counts.map((count, i) => (
                            <TableCell
                              key={data.trend.months[i]}
                              className='text-right tabular-nums'
                            >
                              {count || '—'}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageContainer>
  );
}
