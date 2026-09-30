/**
 * 用工计划详情: the calculation with where each number came from, the three
 * options (feasibility, risks, cost note and the HR assistant's words), and
 * the department head's decision. Choosing 招聘 produces a draft requisition;
 * 借调 a coordination to-do for the lending department.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { useAction } from '@/components/talent/recruiting-lib';
import { StatusBadge } from '@/components/talent/recruiting-shared';
import type { Plan } from '@/components/talent/recruiting-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';

export default function WorkforcePlanDetail(): ReactElement {
  const { t } = useTranslation();
  const { planId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const plan = useRemote<Plan>(
    `talent/recruiting/workforce-plans/${encodeURIComponent(planId)}`,
  );
  const { busy, run } = useAction();
  const [types, setTypes] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const refresh = () => {
    plan.reload();
    outlet?.reload?.();
  };
  const data = plan.data;
  const c = data?.calculation ?? undefined;
  return (
    <RouteChildPage>
      <PageContainer>
        <PageHeader
          title={
            data
              ? `${data.month} ${data.departmentTitle} · ${data.positionTitle}`
              : t('recruiting.workforce.title')
          }
          description={
            data ? <StatusBadge kind='plan' value={data.status} /> : undefined
          }
          actions={
            data?.can?.recalculate ? (
              <Button
                variant='outline'
                disabled={busy !== null}
                onClick={() => {
                  void (async () => {
                    if (
                      await run(
                        'recalc',
                        {
                          path: `talent/recruiting/workforce-plans/${planId}/recalculate`,
                        },
                        t('recruiting.workforce.recalculated'),
                      )
                    )
                      refresh();
                  })();
                }}
              >
                {t('recruiting.workforce.recalculate')}
              </Button>
            ) : null
          }
        />
        {plan.error ? (
          <LoadError error={plan.error} onRetry={plan.reload} />
        ) : !data || !c ? (
          <BlockSkeleton rows={6} />
        ) : (
          <div className='space-y-4'>
            <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
              <Metric
                label={t('recruiting.workforce.planned')}
                value={Number(c.plannedOutput).toLocaleString()}
                hint={
                  c.currentOutput !== null
                    ? `${t('recruiting.workforce.current')} ${Number(c.currentOutput).toLocaleString()}`
                    : undefined
                }
              />
              <Metric
                label={t('recruiting.workforce.headcountOnDuty')}
                value={String(c.headcount)}
              />
              <Metric
                label={t('recruiting.workforce.capacity')}
                value={Number(c.capacity).toLocaleString()}
              />
              <Metric
                label={t('recruiting.workforce.gap')}
                value={t('recruiting.common.people', { count: c.gapHeadcount })}
              />
            </div>
            {c.absorbedOvertimeHours ? (
              <p className='text-sm text-muted-foreground'>
                {t('recruiting.workforce.absorbed', {
                  hours: c.absorbedOvertimeHours,
                })}
              </p>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t('recruiting.workforce.params')}</CardTitle>
                <CardDescription>
                  {t('recruiting.workforce.paramsDescription')}{' '}
                  {data.can?.settings ? (
                    <Link
                      className='underline underline-offset-4'
                      to='/settings/recruiting'
                    >
                      {t('recruiting.workforce.settingsLink')}
                    </Link>
                  ) : null}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className='grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2'>
                  <Param
                    label={t('recruiting.workforce.perShift')}
                    value={c.outputPerShift}
                    source={t('recruiting.workforce.sourceSettings')}
                  />
                  <Param
                    label={t('recruiting.workforce.shiftsPerMonth')}
                    value={c.shiftsPerMonth}
                    source={t('recruiting.workforce.sourceSettings')}
                  />
                  <Param
                    label={t('recruiting.workforce.hoursPerShift')}
                    value={c.hoursPerShift}
                    source={t('recruiting.workforce.sourceSettings')}
                  />
                  <Param
                    label={t('recruiting.workforce.headcountOnDuty')}
                    value={c.headcount}
                    source={t('recruiting.workforce.sourceEmployees')}
                  />
                  <Param
                    label={t('recruiting.workforce.overtimeLimit')}
                    value={c.overtimeLimitHours}
                    source={
                      c.sources?.overtimeLimit === 'attendanceRule'
                        ? t('recruiting.workforce.sourceRule')
                        : t('recruiting.workforce.sourceDefault')
                    }
                  />
                  <Param
                    label={t('recruiting.workforce.recruitingCycle')}
                    value={t('recruiting.common.days', {
                      count: c.recruitingCycleDays,
                    })}
                    source={t('recruiting.workforce.sourceSettings')}
                  />
                  <Param
                    label={t('recruiting.workforce.onboardingDays')}
                    value={t('recruiting.common.days', {
                      count: c.onboardingDays,
                    })}
                    source={
                      c.sources?.onboarding === 'path'
                        ? t('recruiting.workforce.sourcePath')
                        : t('recruiting.workforce.sourceSettings')
                    }
                  />
                </dl>
              </CardContent>
            </Card>
            {data.options?.length ? (
              <div className='grid gap-4 lg:grid-cols-3'>
                {data.options.map((o) => (
                  <Card key={o.type}>
                    <CardHeader>
                      <CardTitle className='flex items-center gap-2'>
                        {t(`recruiting.labels.option.${o.type}`)}
                        <Badge variant={o.feasible ? 'default' : 'destructive'}>
                          {o.feasible
                            ? t('recruiting.workforce.feasible')
                            : t('recruiting.workforce.infeasible')}
                        </Badge>
                      </CardTitle>
                      <CardDescription>
                        {o.type === 'overtime'
                          ? t('recruiting.workforce.hoursPerPerson', {
                              hours: o.detail?.hoursPerPerson ?? '—',
                              limit: o.detail?.limitHours,
                            })
                          : o.type === 'transfer'
                            ? t('recruiting.workforce.transferMax', {
                                count: o.detail?.maxHeadcount ?? 0,
                              })
                            : t('recruiting.workforce.readyIn', {
                                weeks: o.detail?.readyInWeeks,
                                days: o.detail?.readyInDays,
                              })}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className='space-y-2 text-sm'>
                      <p>{o.costNote}</p>
                      {o.risks.length ? (
                        <div className='flex flex-wrap gap-1'>
                          {o.risks.map((r) => (
                            <Badge key={r} variant='outline'>
                              {t(`recruiting.labels.risk.${r}`)}
                            </Badge>
                          ))}
                        </div>
                      ) : null}
                      {o.note ? (
                        <p className='text-muted-foreground'>{o.note}</p>
                      ) : null}
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : null}
            {c.gapHeadcount > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.workforce.assistant')}</CardTitle>
                </CardHeader>
                <CardContent className='text-sm'>
                  {data.aiSummary ? (
                    <p className='whitespace-pre-wrap'>{data.aiSummary}</p>
                  ) : (
                    <p className='text-muted-foreground'>
                      {t('recruiting.workforce.assistantPending')}
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : null}
            {data.decision ? (
              <p className='text-sm text-muted-foreground'>
                {data.decision.types
                  .map((x) => t(`recruiting.labels.option.${x}`))
                  .join(' + ')}
                {data.decision.note ? ` · ${data.decision.note}` : ''}
                {data.requisitionId ? (
                  <>
                    {' · '}
                    <Link
                      className='underline underline-offset-4'
                      to={`/talent/requisitions/${data.requisitionId}`}
                    >
                      {t('recruiting.workforce.requisitionLink')}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
            {data.can?.decide ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('recruiting.workforce.decide')}</CardTitle>
                  <CardDescription>
                    {t('recruiting.workforce.decideDescription')}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-3'>
                  <div className='flex flex-wrap gap-4'>
                    {data.options.map((o) => (
                      <label
                        key={o.type}
                        className='flex items-center gap-2 text-sm'
                      >
                        <Checkbox
                          disabled={!o.feasible}
                          checked={types.includes(o.type)}
                          onCheckedChange={(checked) =>
                            setTypes((v) =>
                              checked
                                ? [...v, o.type]
                                : v.filter((x) => x !== o.type),
                            )
                          }
                        />
                        {t(`recruiting.labels.option.${o.type}`)}
                      </label>
                    ))}
                  </div>
                  <Field>
                    <FieldLabel htmlFor='wp-note'>
                      {t('recruiting.common.note')}
                    </FieldLabel>
                    <Textarea
                      id='wp-note'
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={!types.length || busy !== null}
                    onClick={() => {
                      void (async () => {
                        if (
                          await run(
                            'decide',
                            {
                              path: `talent/recruiting/workforce-plans/${planId}/decide`,
                              json: { types, note: note || null },
                            },
                            t('recruiting.workforce.decided'),
                          )
                        )
                          refresh();
                      })();
                    }}
                  >
                    {t('recruiting.workforce.decide')}
                  </Button>
                </CardContent>
              </Card>
            ) : null}
          </div>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): ReactElement {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className='text-2xl tabular-nums'>{value}</CardTitle>
        {hint ? <CardDescription>{hint}</CardDescription> : null}
      </CardHeader>
    </Card>
  );
}

function Param({
  label,
  value,
  source,
}: {
  label: string;
  value: unknown;
  source: string;
}): ReactElement {
  return (
    <div className='flex flex-wrap items-baseline justify-between gap-2 border-b py-1'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='tabular-nums'>
        {String(value)}{' '}
        <span className='text-xs text-muted-foreground'>· {source}</span>
      </dd>
    </div>
  );
}
