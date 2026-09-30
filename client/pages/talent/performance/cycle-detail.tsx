/**
 * V4-12 考核周期详情 (`/talent/review-cycles/:cycleId`, hr.admin): 进度看板
 * (each stage's completion, the overdue list, 推进阶段 after telling how many
 * have not finished, 一键催办 — one reminder per person in 24 hours, 刷新快照),
 * 参与名单 (the matched scheme, which HR may change; exclusions and reasons),
 * 统计 (AI draft adoption and the manager reviews' active editing time, by
 * department) and 申诉.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { useAction, useDateText } from '@/components/talent/performance-hooks';
import {
  CycleStatusBadge,
  RatingBadge,
  TaskStatusBadge,
} from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';

const TABS = ['progress', 'participants', 'stats', 'appeals'] as const;
type Tab = (typeof TABS)[number];

interface Detail {
  cycle: {
    id: string;
    title: string;
    status: string;
    periodStart: string;
    periodEnd: string;
    stageDeadlines: Record<string, string>;
    ownerName: string;
    autoAdvance: boolean;
  };
  stages: Record<string, { total: number; done: number; rate: number | null }>;
  pending: number;
  overdue: {
    id: string;
    kind: string;
    employeeName: string;
    reviewerName: string;
  }[];
  next: string | null;
  participants: {
    resultId: string;
    employeeNo: string;
    name: string;
    departmentTitle: string;
    schemeId: string;
    schemeTitle: string;
    managerName: string;
    skipLevelName: string | null;
    skipLevelSkipped: boolean;
    noAccount: boolean;
    status: string;
    closedReason: string | null;
  }[];
  exclusions: { employeeId: string; name: string; reasons: string[] }[];
  can: { manage: boolean; advance: boolean; remind: boolean };
}

export default function ReviewCycleDetailPage(): ReactElement {
  const { t } = useTranslation();
  const { cycleId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const [params, setParams] = useSearchParams();
  const date = useDateText();
  const detail = useRemote<Detail>(
    `talent/performance/cycles/${encodeURIComponent(cycleId)}`,
  );
  const requested = params.get('tab') as Tab | null;
  const tab: Tab =
    requested && TABS.includes(requested) ? requested : 'progress';
  const reload = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const data = detail.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            <PageHeader
              title={data.cycle.title}
              description={t('performance.cycles.detailDescription', {
                start: date(data.cycle.periodStart),
                end: date(data.cycle.periodEnd),
                owner: data.cycle.ownerName,
              })}
              actions={<CycleStatusBadge status={data.cycle.status} />}
            />
            <Tabs
              value={tab}
              onValueChange={(value) => {
                const next = new URLSearchParams(params);
                next.set('tab', String(value));
                setParams(next, { replace: true });
              }}
            >
              <TabsList>
                {TABS.map((name) => (
                  <TabsTrigger key={name} value={name}>
                    {t(`performance.cycles.tabs.${name}`)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            {tab === 'progress' ? (
              <ProgressTab data={data} onChanged={reload} />
            ) : tab === 'participants' ? (
              <ParticipantsTab data={data} onChanged={reload} />
            ) : tab === 'stats' ? (
              <StatsTab cycleId={data.cycle.id} />
            ) : (
              <AppealsTab cycleId={data.cycle.id} />
            )}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function ProgressTab({
  data,
  onChanged,
}: {
  data: Detail;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const date = useDateText();
  const action = useAction();
  const [confirming, setConfirming] = useState(false);
  const stages = [
    'goalSetting',
    'selfReview',
    'peerReview',
    'managerReview',
    'skipLevelReview',
  ] as const;
  return (
    <div className='space-y-4'>
      <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
        {stages.map((stage) => {
          const value = data.stages[stage] ?? { total: 0, done: 0, rate: null };
          if (!value.total && stage !== 'goalSetting') return null;
          return (
            <Card key={stage} size='sm'>
              <CardHeader>
                <CardDescription>
                  {t(`performance.stage.${stage}`)}
                </CardDescription>
                <CardTitle className='tabular-nums'>
                  {value.done}/{value.total}
                </CardTitle>
              </CardHeader>
              <CardContent className='space-y-1'>
                <Progress
                  value={value.rate ?? 0}
                  aria-label={t(`performance.stage.${stage}`)}
                />
                {data.cycle.stageDeadlines[
                  stage === 'skipLevelReview' ? 'managerReview' : stage
                ] ? (
                  <p className='text-xs text-muted-foreground'>
                    {t('performance.common.deadline', {
                      date: date(
                        data.cycle.stageDeadlines[
                          stage === 'skipLevelReview' ? 'managerReview' : stage
                        ],
                      ),
                    })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      <div className='flex flex-col gap-2 sm:flex-row sm:justify-end'>
        {['selfReview', 'peerReview', 'managerReview', 'calibration'].includes(
          data.cycle.status,
        ) && data.can.manage ? (
          <Button
            variant='outline'
            disabled={action.busy}
            onClick={() => {
              void (async () => {
                const done = await action.run<{ refreshed: number }>(
                  {
                    method: 'POST',
                    path: `talent/performance/cycles/${encodeURIComponent(data.cycle.id)}/refresh-snapshots`,
                  },
                  t('performance.cycles.refreshed'),
                );
                if (done) onChanged();
              })();
            }}
          >
            {t('performance.cycles.refreshSnapshots')}
          </Button>
        ) : null}
        {data.can.remind ? (
          <Button
            variant='outline'
            disabled={action.busy}
            onClick={() => {
              void (async () => {
                const done = await action.run<{
                  sent: number;
                  skipped: number;
                }>({
                  method: 'POST',
                  path: `talent/performance/cycles/${encodeURIComponent(data.cycle.id)}/remind`,
                });
                if (done) onChanged();
              })();
            }}
          >
            {t('performance.cycles.remind', { count: data.pending })}
          </Button>
        ) : null}
        {data.can.advance && data.next ? (
          <Button onClick={() => setConfirming(true)}>
            {t('performance.cycles.advance', {
              stage: t(`performance.cycleStatus.${data.next}`),
            })}
          </Button>
        ) : null}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('performance.cycles.overdue')}</CardTitle>
          <CardAction>
            <Badge variant={data.overdue.length ? 'destructive' : 'secondary'}>
              {data.overdue.length}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          {data.overdue.length ? (
            <ul className='space-y-1 text-sm'>
              {data.overdue.map((item) => (
                <li key={item.id}>
                  {item.employeeName} · {t(`performance.kind.${item.kind}`)}
                  {item.reviewerName ? ` · ${item.reviewerName}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('performance.cycles.noOverdue')}
            </p>
          )}
        </CardContent>
      </Card>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('performance.cycles.advance', {
                stage: t(`performance.cycleStatus.${data.next ?? 'draft'}`),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('performance.cycles.advanceConfirm', { count: data.pending })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('performance.common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={action.busy}
              onClick={() => {
                void (async () => {
                  const done = await action.run(
                    {
                      method: 'POST',
                      path: `talent/performance/cycles/${encodeURIComponent(data.cycle.id)}/advance`,
                      json: { confirm: true },
                    },
                    t('performance.cycles.advanced'),
                  );
                  setConfirming(false);
                  if (done) onChanged();
                })();
              }}
            >
              {t('performance.common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ParticipantsTab({
  data,
  onChanged,
}: {
  data: Detail;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const schemes = useRemote<{ schemes: { id: string; title: string }[] }>(
    'talent/performance/schemes',
  );
  const action = useAction();
  const changeable =
    ['draft', 'goalSetting', 'selfReview'].includes(data.cycle.status) &&
    data.can.manage;
  return (
    <div className='space-y-4'>
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {data.participants.length ? (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('performance.common.employee')}</TableHead>
                <TableHead>{t('performance.common.department')}</TableHead>
                <TableHead>{t('performance.cycles.scheme')}</TableHead>
                <TableHead>{t('performance.cycles.manager')}</TableHead>
                <TableHead>{t('performance.cycles.skipLevel')}</TableHead>
                <TableHead>{t('performance.common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.participants.map((row) => (
                <TableRow key={row.resultId}>
                  <TableCell>
                    {row.name}
                    {row.noAccount ? (
                      <Badge variant='outline' className='ms-2'>
                        {t('performance.cycles.noAccountSkip')}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{row.departmentTitle}</TableCell>
                  <TableCell>
                    {changeable && schemes.data ? (
                      <NativeSelect
                        size='sm'
                        aria-label={t('performance.cycles.scheme')}
                        value={row.schemeId}
                        onChange={(e) => {
                          void (async () => {
                            if (
                              await action.run(
                                {
                                  method: 'PATCH',
                                  path: `talent/performance/results/${encodeURIComponent(row.resultId)}/scheme`,
                                  json: { schemeId: e.target.value },
                                },
                                t('performance.cycles.schemeChanged'),
                              )
                            )
                              onChanged();
                          })();
                        }}
                      >
                        {schemes.data.schemes.map((s) => (
                          <NativeSelectOption key={s.id} value={s.id}>
                            {s.title}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    ) : (
                      row.schemeTitle
                    )}
                  </TableCell>
                  <TableCell>{row.managerName}</TableCell>
                  <TableCell>
                    {row.skipLevelName ??
                      (row.skipLevelSkipped
                        ? t('performance.cycles.skipLevelSkipped')
                        : '—')}
                  </TableCell>
                  <TableCell>
                    <Badge variant='outline'>
                      {t(`performance.resultStatus.${row.status}`)}
                      {row.closedReason
                        ? ` · ${t(`performance.closedReason.${row.closedReason}`)}`
                        : ''}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <EmptyState title={t('performance.cycles.noParticipantsYet')} />
      )}
      {data.exclusions.length ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('performance.cycles.excluded')}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className='space-y-1 text-sm'>
              {data.exclusions.map((row) => (
                <li key={row.employeeId}>
                  {row.name}：
                  {row.reasons
                    .map((reason) => t(`performance.exclusion.${reason}`))
                    .join('、')}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function StatsTab({ cycleId }: { cycleId: string }): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const [departmentId, setDepartmentId] = useState('');
  const stats = useRemote<{
    submitted: number;
    adoption: {
      adoptedAsIs: number | null;
      edited: number | null;
      discarded: number | null;
    };
    averageActiveSeconds: number | null;
    reviews: {
      reviewId: string;
      role: string;
      employeeName: string;
      reviewerName: string;
      status: string;
      aiDraftAdoption: string | null;
      activeSeconds: number;
    }[];
  }>(
    `talent/performance/cycles/${encodeURIComponent(cycleId)}/stats`,
    departmentId ? { departmentId } : undefined,
  );
  const minutes = (seconds: number | null) =>
    seconds === null
      ? '—'
      : t('performance.stats.minutes', {
          value: Math.round((seconds / 60) * 10) / 10,
        });
  return (
    <div className='space-y-4'>
      <NativeSelect
        aria-label={t('performance.common.department')}
        value={departmentId}
        onChange={(e) => setDepartmentId(e.target.value)}
      >
        <NativeSelectOption value=''>
          {t('performance.stats.allDepartments')}
        </NativeSelectOption>
        {lookups.departments.map((d) => (
          <NativeSelectOption key={d.id} value={d.id}>
            {'　'.repeat(d.depth)}
            {d.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {stats.error ? (
        <LoadError error={stats.error} onRetry={stats.reload} />
      ) : !stats.data ? (
        <BlockSkeleton rows={3} />
      ) : (
        <>
          <div className='grid gap-3 sm:grid-cols-4'>
            {(['adoptedAsIs', 'edited', 'discarded'] as const).map((key) => (
              <Card key={key} size='sm'>
                <CardHeader>
                  <CardDescription>
                    {t(`performance.adoption.${key}`)}
                  </CardDescription>
                  <CardTitle className='tabular-nums'>
                    {stats.data!.adoption[key] === null
                      ? '—'
                      : `${stats.data!.adoption[key]}%`}
                  </CardTitle>
                </CardHeader>
              </Card>
            ))}
            <Card size='sm'>
              <CardHeader>
                <CardDescription>
                  {t('performance.stats.averageTime')}
                </CardDescription>
                <CardTitle className='tabular-nums'>
                  {minutes(stats.data.averageActiveSeconds)}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('performance.common.employee')}</TableHead>
                  <TableHead>{t('performance.stats.reviewer')}</TableHead>
                  <TableHead>{t('performance.common.status')}</TableHead>
                  <TableHead>{t('performance.stats.adoption')}</TableHead>
                  <TableHead className='text-end'>
                    {t('performance.stats.activeTime')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.data.reviews.map((row) => (
                  <TableRow key={row.reviewId}>
                    <TableCell>
                      {row.employeeName}
                      {row.role === 'skipLevel'
                        ? ` · ${t('performance.team.skipLevel')}`
                        : ''}
                    </TableCell>
                    <TableCell>{row.reviewerName}</TableCell>
                    <TableCell>
                      <TaskStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      {row.aiDraftAdoption
                        ? t(`performance.adoption.${row.aiDraftAdoption}`)
                        : '—'}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>
                      {minutes(row.activeSeconds)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}

function AppealsTab({ cycleId }: { cycleId: string }): ReactElement {
  const { t } = useTranslation();
  const appeals = useRemote<
    {
      resultId: string;
      name: string;
      finalRating: string | null;
      status: string;
      appeal: { reason: string; result?: string | null; note?: string | null };
    }[]
  >(`talent/performance/cycles/${encodeURIComponent(cycleId)}/appeals`);
  const action = useAction();
  const [handling, setHandling] = useState<string | null>(null);
  const [result, setResult] = useState<'upheld' | 'changed'>('upheld');
  const [note, setNote] = useState('');
  const [rating, setRating] = useState('');
  if (appeals.error)
    return <LoadError error={appeals.error} onRetry={appeals.reload} />;
  if (!appeals.data) return <BlockSkeleton rows={2} />;
  if (!appeals.data.length)
    return <EmptyState title={t('performance.appeal.none')} />;
  return (
    <div className='space-y-3'>
      {appeals.data.map((row) => (
        <Card key={row.resultId}>
          <CardHeader>
            <CardTitle className='flex items-center gap-2'>
              {row.name}
              <RatingBadge rating={row.finalRating} />
            </CardTitle>
            <CardDescription className='break-words'>
              {row.appeal.reason}
            </CardDescription>
            <CardAction>
              {row.status === 'appealed' ? (
                <Button size='sm' onClick={() => setHandling(row.resultId)}>
                  {t('performance.appeal.handle')}
                </Button>
              ) : (
                <Badge variant='secondary'>
                  {t(
                    `performance.appeal.results.${row.appeal.result ?? 'upheld'}`,
                  )}
                </Badge>
              )}
            </CardAction>
          </CardHeader>
          {row.appeal.note ? (
            <CardContent className='text-sm break-words'>
              {row.appeal.note}
            </CardContent>
          ) : null}
        </Card>
      ))}
      <Dialog
        open={Boolean(handling)}
        onOpenChange={(open) => (open ? undefined : setHandling(null))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('performance.appeal.handle')}</DialogTitle>
            <DialogDescription>
              {t('performance.appeal.handleHint')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <Field>
              <FieldLabel htmlFor='appeal-result'>
                {t('performance.appeal.result')}
              </FieldLabel>
              <NativeSelect
                id='appeal-result'
                value={result}
                onChange={(e) =>
                  setResult(e.target.value as 'upheld' | 'changed')
                }
              >
                <NativeSelectOption value='upheld'>
                  {t('performance.appeal.results.upheld')}
                </NativeSelectOption>
                <NativeSelectOption value='changed'>
                  {t('performance.appeal.results.changed')}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
            {result === 'changed' ? (
              <Field>
                <FieldLabel htmlFor='appeal-rating'>
                  {t('performance.appeal.newRating')}
                </FieldLabel>
                <NativeSelect
                  id='appeal-rating'
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                >
                  <NativeSelectOption value=''>—</NativeSelectOption>
                  {['S', 'A', 'B', 'C', 'D'].map((code) => (
                    <NativeSelectOption key={code} value={code}>
                      {code}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor='appeal-note'>
                {t('performance.appeal.note')}
              </FieldLabel>
              <Textarea
                id='appeal-note'
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setHandling(null)}>
              {t('performance.common.cancel')}
            </Button>
            <Button
              disabled={action.busy || !note.trim()}
              onClick={() => {
                void (async () => {
                  if (!handling) return;
                  if (
                    await action.run(
                      {
                        method: 'POST',
                        path: `talent/performance/results/${encodeURIComponent(handling)}/appeal/handle`,
                        json: {
                          result,
                          note,
                          rating: result === 'changed' ? rating : null,
                        },
                      },
                      t('performance.appeal.handled'),
                    )
                  ) {
                    setHandling(null);
                    setNote('');
                    appeals.reload();
                  }
                })();
              }}
            >
              {t('performance.common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
