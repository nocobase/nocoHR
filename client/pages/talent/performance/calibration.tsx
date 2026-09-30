/**
 * V4-12 校准 (`/talent/calibration`; hr.admin adjusts and publishes, heads
 * read their own scope): the calibration pack the assistant prepared, the
 * distribution against the guide per scheme and department, and the list with
 * the reference score, the manager's rating and the assistant's anomaly
 * hints. An adjustment needs a reason and is kept; publishing makes results
 * visible to employees (no rating in any notice).
 */
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction } from '@/components/talent/performance-hooks';
import {
  CycleStatusBadge,
  RatingBadge,
} from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';

interface Distribution {
  total: number;
  counts: { code: string; count: number; percent: number }[];
  guide: {
    key: string;
    max: number | null;
    min: number | null;
    actual: number;
    outside: boolean;
  }[];
}

interface CalibrationView {
  cycle: {
    id: string;
    title: string;
    status: string;
    calibrationPack: {
      content: string;
      generatedAt: string;
      source: string;
    } | null;
  };
  groups: {
    schemeId: string;
    schemeTitle: string;
    departmentId: string | null;
    departmentTitle: string;
    distribution: Distribution;
  }[];
  results: {
    resultId: string;
    name: string;
    departmentTitle: string;
    schemeTitle: string;
    ratingScale: string[];
    computedScore: number | null;
    referenceBand: string | null;
    managerRating: string | null;
    calibratedRating: string | null;
    currentRating: string | null;
    adjustments: {
      from: string | null;
      to: string;
      reason: string;
      at: string;
    }[];
    anomalies: { type: string; detail: Record<string, unknown> }[];
  }[];
  can: { adjust: boolean; publish: boolean };
}

export default function CalibrationPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const cycles = useRemote<{
    cycles: { id: string; title: string; status: string }[];
  }>('talent/performance/cycles');
  const team = useRemote<{ id: string; title: string; status: string }[]>(
    cycles.error ? 'talent/performance/team/cycles' : null,
  );
  const options = cycles.data?.cycles ?? team.data ?? [];
  const cycleId =
    params.get('cycle') ??
    options.find((c) => c.status === 'calibration')?.id ??
    options[0]?.id ??
    null;
  const view = useRemote<CalibrationView>(
    cycleId
      ? `talent/performance/cycles/${encodeURIComponent(cycleId)}/calibration`
      : null,
  );
  const action = useAction();
  const [adjusting, setAdjusting] = useState<
    CalibrationView['results'][number] | null
  >(null);
  const [publishing, setPublishing] = useState(false);
  const data = view.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('performance.calibration.title')}
        description={t('performance.calibration.description')}
        actions={
          <>
            {options.length > 1 ? (
              <NativeSelect
                aria-label={t('performance.common.cycle')}
                value={cycleId ?? ''}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  next.set('cycle', e.target.value);
                  setParams(next, { replace: true });
                }}
              >
                {options.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            ) : null}
            {data?.can.publish ? (
              <Button onClick={() => setPublishing(true)}>
                {t('performance.calibration.publish')}
              </Button>
            ) : null}
          </>
        }
      />
      {!cycleId && (cycles.data || team.data) ? (
        <EmptyState title={t('performance.calibration.noCycle')} />
      ) : view.error ? (
        <LoadError error={view.error} onRetry={view.reload} />
      ) : !data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <>
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{data.cycle.title}</span>
            <CycleStatusBadge status={data.cycle.status} />
            {!data.can.adjust ? (
              <Badge variant='outline'>
                {t('performance.calibration.readOnly')}
              </Badge>
            ) : null}
          </div>
          {data.cycle.calibrationPack ? (
            <Alert>
              <SparklesIcon />
              <AlertTitle>{t('performance.calibration.pack')}</AlertTitle>
              <AlertDescription>
                <pre className='font-sans text-sm leading-6 break-words whitespace-pre-wrap'>
                  {data.cycle.calibrationPack.content}
                </pre>
              </AlertDescription>
            </Alert>
          ) : null}
          <div className='grid gap-3 md:grid-cols-2 xl:grid-cols-3'>
            {data.groups.map((group) => (
              <Card
                key={`${group.schemeId}:${group.departmentId ?? 'all'}`}
                size='sm'
              >
                <CardHeader>
                  <CardTitle>
                    {group.departmentTitle ||
                      t('performance.calibration.allOfScheme')}
                  </CardTitle>
                  <CardDescription>
                    {group.schemeTitle} ·{' '}
                    {t('performance.calibration.rated', {
                      count: group.distribution.total,
                    })}
                  </CardDescription>
                </CardHeader>
                <CardContent className='space-y-2 text-sm'>
                  <div className='flex flex-wrap gap-1.5'>
                    {group.distribution.counts.map((c) => (
                      <Badge
                        key={c.code}
                        variant='secondary'
                        className='tabular-nums'
                      >
                        {c.code} {c.count}（{c.percent}%）
                      </Badge>
                    ))}
                  </div>
                  {group.distribution.guide.length ? (
                    <ul className='space-y-0.5'>
                      {group.distribution.guide.map((g) => (
                        <li
                          key={g.key}
                          className={
                            g.outside
                              ? 'text-destructive'
                              : 'text-muted-foreground'
                          }
                        >
                          {t('performance.calibration.guideLine', {
                            key: g.key,
                            rule: g.max !== null ? `≤${g.max}%` : `≥${g.min}%`,
                            actual: g.actual,
                          })}
                          {g.outside
                            ? ` · ${t('performance.calibration.outside')}`
                            : ''}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
          {data.results.length ? (
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('performance.common.employee')}</TableHead>
                    <TableHead>{t('performance.cycles.scheme')}</TableHead>
                    <TableHead className='text-end'>
                      {t('performance.team.score')}
                    </TableHead>
                    <TableHead>{t('performance.calibration.band')}</TableHead>
                    <TableHead>
                      {t('performance.calibration.managerRating')}
                    </TableHead>
                    <TableHead>
                      {t('performance.calibration.current')}
                    </TableHead>
                    <TableHead>{t('performance.calibration.hints')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.results.map((row) => (
                    <TableRow key={row.resultId}>
                      <TableCell>
                        <div className='font-medium'>{row.name}</div>
                        <div className='text-xs text-muted-foreground'>
                          {row.departmentTitle}
                        </div>
                      </TableCell>
                      <TableCell>{row.schemeTitle}</TableCell>
                      <TableCell className='text-end tabular-nums'>
                        {row.computedScore ?? '—'}
                      </TableCell>
                      <TableCell>
                        <RatingBadge rating={row.referenceBand} />
                      </TableCell>
                      <TableCell>
                        <RatingBadge rating={row.managerRating} />
                      </TableCell>
                      <TableCell>
                        <RatingBadge rating={row.currentRating} />
                        {row.adjustments.length ? (
                          <span className='ms-1 text-xs text-muted-foreground'>
                            {t('performance.calibration.adjusted', {
                              count: row.adjustments.length,
                            })}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className='flex flex-wrap gap-1'>
                          {row.anomalies.map((a) => (
                            <Badge key={a.type} variant='destructive'>
                              {t(`performance.anomaly.${a.type}`)}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className='text-end'>
                        {data.can.adjust ? (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() => setAdjusting(row)}
                          >
                            {t('performance.calibration.adjust')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState title={t('performance.calibration.empty')} />
          )}
        </>
      )}
      <AdjustDialog
        row={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={view.reload}
      />
      <AlertDialog open={publishing} onOpenChange={setPublishing}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('performance.calibration.publishTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('performance.calibration.publishConfirm')}
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
                  if (!cycleId) return;
                  const done = await action.run(
                    {
                      method: 'POST',
                      path: `talent/performance/cycles/${encodeURIComponent(cycleId)}/publish`,
                    },
                    t('performance.calibration.published'),
                  );
                  setPublishing(false);
                  if (done) view.reload();
                })();
              }}
            >
              {t('performance.calibration.publish')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function AdjustDialog({
  row,
  onClose,
  onDone,
}: {
  row: CalibrationView['results'][number] | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useAction();
  const [rating, setRating] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => (open ? undefined : onClose())}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('performance.calibration.adjustTitle', {
              name: row?.name ?? '',
            })}
          </DialogTitle>
          <DialogDescription>
            {t('performance.calibration.adjustHint', {
              rating: row?.currentRating ?? '—',
            })}
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          <Field>
            <FieldLabel htmlFor='adjust-rating'>
              {t('performance.calibration.newRating')}
            </FieldLabel>
            <NativeSelect
              id='adjust-rating'
              value={rating}
              onChange={(e) => setRating(e.target.value)}
            >
              <NativeSelectOption value=''>—</NativeSelectOption>
              {(row?.ratingScale ?? []).map((code) => (
                <NativeSelectOption key={code} value={code}>
                  {code}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='adjust-reason'>
              {t('performance.calibration.reason')}
            </FieldLabel>
            <Textarea
              id='adjust-reason'
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          {row?.adjustments.length ? (
            <ul className='space-y-1 text-xs text-muted-foreground'>
              {row.adjustments.map((a) => (
                <li key={`${a.at}:${a.to}`}>
                  {a.from ?? '—'} → {a.to}：{a.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !rating || !reason.trim()}
            onClick={() => {
              void (async () => {
                if (!row) return;
                if (
                  await action.run(
                    {
                      method: 'POST',
                      path: `talent/performance/results/${encodeURIComponent(row.resultId)}/adjust`,
                      json: { rating, reason },
                    },
                    t('performance.calibration.adjustedToast'),
                  )
                ) {
                  setRating('');
                  setReason('');
                  onDone();
                  onClose();
                }
              })();
            }}
          >
            {t('performance.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
