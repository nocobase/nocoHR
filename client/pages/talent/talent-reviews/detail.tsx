/**
 * V4-13 盘点活动 (`/talent/talent-reviews/:reviewId`).
 *
 * - 准备阶段: heads fill the potential assessment of the people in their
 *   scope (three items, 1–3 each, with an example); hr.admin sets the
 *   performance band by hand where there is no result.
 * - 盘点会: the nine-box board; a card is dragged to another box and the
 *   move needs a reason (the talent analyst's pre-placement stays as it
 *   was); each card shows the rating, the potential points and the
 *   pre-placement with its evidence; the development actions are written
 *   and the placement confirmed, after which the learning coach drafts a
 *   plan for the head.
 * - hr.admin advances draft → preparing → inSession → concluded.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useOutletContext, useParams, useSearchParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { NineBox } from '@/components/talent/talent-review-nine-box';
import { formatDate, useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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

const ACTION_TYPES = ['stretch', 'rotation', 'promotionPrep', 'retention', 'improvement'] as const;

interface Placement {
  id: string;
  employeeName: string;
  departmentTitle: string;
  positionTitle: string;
  performanceRating: string | null;
  performanceBand: number | null;
  performanceSource: string | null;
  performanceReason: string | null;
  potentialAnswers: Record<string, { score: number; example: string }> | null;
  potentialBand: number | null;
  box: number | null;
  aiSuggestion: {
    performanceBand: number | null;
    potentialEvidence: string[];
    suggestedBox: number | null;
    notes: string;
    source: string;
  } | null;
  moves: { fromBox: number | null; toBox: number; reason: string; byName: string; at: string }[];
  developmentActions: { type: string; note: string }[];
  decidedAt: string | null;
  decidedByName: string | null;
  learningPlanId: string | null;
}

interface Detail {
  review: {
    id: string;
    title: string;
    status: string;
    ownerName: string;
    departmentTitles: string[];
    cycle: { title: string; status: string } | null;
  };
  placements: Placement[];
  potentialQuestions: { key: string; title: string }[];
  boxActions: Record<string, string[]>;
  can: { manage: boolean; assessPotential: boolean; place: boolean; conclude: boolean };
}

export default function TalentReviewDetailPage(): ReactElement {
  const { t } = useTranslation();
  const { reviewId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const [params, setParams] = useSearchParams();
  const detail = useRemote<Detail>(`talent/talent-reviews/${encodeURIComponent(reviewId)}`);
  const action = useTrAction();
  const [open, setOpen] = useState<string | null>(null);
  const [moving, setMoving] = useState<{ id: string; box: number } | null>(null);
  const tab = params.get('tab') === 'list' ? 'list' : 'board';
  const reload = () => {
    detail.reload();
    outlet?.reload?.();
  };
  const data = detail.data;
  const advance = async () => {
    const done = await action.run(
      { method: 'POST', path: `talent/talent-reviews/${encodeURIComponent(reviewId)}/advance` },
      t('talentReview.detail.advanced'),
    );
    if (done) reload();
  };
  const canAdvance =
    data &&
    ((data.can.manage && ['draft', 'preparing'].includes(data.review.status)) || data.can.conclude);
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
              title={data.review.title}
              description={t('talentReview.detail.description', {
                scope: data.review.departmentTitles.join('、'),
                cycle: data.review.cycle?.title ?? t('talentReview.reviews.noCycle'),
                owner: data.review.ownerName,
              })}
              actions={
                <div className='flex items-center gap-2'>
                  <TrStatusBadge status={data.review.status} />
                  {canAdvance ? (
                    <Button size='sm' disabled={action.busy} onClick={() => void advance()}>
                      {t(`talentReview.detail.advance.${data.review.status}`)}
                    </Button>
                  ) : null}
                </div>
              }
            />
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
            <Tabs
              value={tab}
              onValueChange={(value) => {
                const next = new URLSearchParams(params);
                next.set('tab', String(value));
                setParams(next, { replace: true });
              }}
            >
              <TabsList>
                <TabsTrigger value='board'>{t('talentReview.detail.tabs.board')}</TabsTrigger>
                <TabsTrigger value='list'>{t('talentReview.detail.tabs.list')}</TabsTrigger>
              </TabsList>
            </Tabs>
            {tab === 'board' ? (
              <NineBox
                placements={data.placements}
                canPlace={data.can.place}
                onMove={(id, box) => setMoving({ id, box })}
                onOpen={setOpen}
              />
            ) : (
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('talentReview.detail.person')}</TableHead>
                      <TableHead>{t('talentReview.detail.rating')}</TableHead>
                      <TableHead>{t('talentReview.detail.performanceBand')}</TableHead>
                      <TableHead>{t('talentReview.detail.potentialBand')}</TableHead>
                      <TableHead>{t('talentReview.detail.box')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.placements.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div className='font-medium'>{p.employeeName}</div>
                          <div className='text-muted-foreground text-xs'>
                            {p.departmentTitle} · {p.positionTitle}
                          </div>
                        </TableCell>
                        <TableCell>{p.performanceRating ?? '—'}</TableCell>
                        <TableCell className='tabular-nums'>{p.performanceBand ?? '—'}</TableCell>
                        <TableCell className='tabular-nums'>{p.potentialBand ?? '—'}</TableCell>
                        <TableCell className='tabular-nums'>{p.box ?? '—'}</TableCell>
                        <TableCell className='text-end'>
                          <Button size='sm' variant='outline' onClick={() => setOpen(p.id)}>
                            {data.can.assessPotential && !p.potentialBand
                              ? t('talentReview.detail.assess')
                              : t('talentReview.common.open')}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
            {open ? (
              <CardDialog
                data={data}
                placement={data.placements.find((p) => p.id === open)!}
                onClose={() => setOpen(null)}
                onChanged={reload}
              />
            ) : null}
            {moving ? (
              <MoveDialog
                move={moving}
                placement={data.placements.find((p) => p.id === moving.id)!}
                onClose={() => setMoving(null)}
                onChanged={reload}
              />
            ) : null}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function MoveDialog({
  move,
  placement,
  onClose,
  onChanged,
}: {
  move: { id: string; box: number };
  placement: Placement;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talentReview.move.title', { name: placement.employeeName })}</DialogTitle>
          <DialogDescription>
            {t('talentReview.move.description', {
              from: placement.box ?? '—',
              to: move.box,
            })}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='tr-move-reason'>{t('talentReview.move.reason')}</FieldLabel>
          <Textarea id='tr-move-reason' value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !reason.trim()}
            onClick={() => { void (async () => {
              const done = await action.run(
                {
                  method: 'POST',
                  path: `talent/talent-placements/${encodeURIComponent(move.id)}/move`,
                  json: { box: move.box, reason },
                },
                t('talentReview.move.saved'),
              );
              if (done) {
                onChanged();
                onClose();
              }
            })(); }}
          >
            {t('talentReview.move.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CardDialog({
  data,
  placement,
  onClose,
  onChanged,
}: {
  data: Detail;
  placement: Placement;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const action = useTrAction();
  const [answers, setAnswers] = useState<Record<string, { score: number; example: string }>>(
    () =>
      placement.potentialAnswers ??
      Object.fromEntries(data.potentialQuestions.map((q) => [q.key, { score: 2, example: '' }])),
  );
  const [actions, setActions] = useState<{ uid: string; type: string; note: string }[]>(() =>
    (placement.developmentActions.length
      ? placement.developmentActions
      : (data.boxActions[String(placement.box ?? '')] ?? []).map((type) => ({ type, note: '' }))
    ).map((a, index) => ({ ...a, uid: `a${index}` })),
  );
  const [band, setBand] = useState(String(placement.performanceBand ?? ''));
  const [bandReason, setBandReason] = useState('');
  const path = `talent/talent-placements/${encodeURIComponent(placement.id)}`;
  const save = async (request: Parameters<typeof action.run>[0], success: string) => {
    const done = await action.run(request, success);
    if (done) onChanged();
    return done;
  };
  const answersComplete = data.potentialQuestions.every(
    (q) => answers[q.key]?.score && answers[q.key]?.example.trim(),
  );
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{placement.employeeName}</DialogTitle>
          <DialogDescription>
            {placement.departmentTitle} · {placement.positionTitle} ·{' '}
            {t('talentReview.detail.ratingLine', { rating: placement.performanceRating ?? '—' })}
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-4 text-sm'>
          {placement.aiSuggestion ? (
            <section className='bg-muted/40 flex flex-col gap-1 rounded-md border p-3'>
              <div className='flex items-center gap-1 font-medium'>
                <SparklesIcon className='size-4' />
                {t('talentReview.card.suggestion', {
                  box: placement.aiSuggestion.suggestedBox ?? '—',
                })}
                <Badge variant='outline'>{t(`talentReview.card.source.${placement.aiSuggestion.source}`)}</Badge>
              </div>
              <ul className='text-muted-foreground list-disc ps-5'>
                {placement.aiSuggestion.potentialEvidence.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {placement.aiSuggestion.notes ? <p>{placement.aiSuggestion.notes}</p> : null}
              <p className='text-muted-foreground text-xs'>{t('talentReview.card.referenceOnly')}</p>
            </section>
          ) : null}

          <section className='flex flex-col gap-2'>
            <h3 className='font-medium'>{t('talentReview.card.potential')}</h3>
            {data.potentialQuestions.map((q) => (
              <div key={q.key} className='grid gap-1.5 sm:grid-cols-[10rem_5rem_1fr] sm:items-start'>
                <span>{q.title}</span>
                <NativeSelect
                  aria-label={q.title}
                  disabled={!data.can.assessPotential}
                  value={String(answers[q.key]?.score ?? 2)}
                  onChange={(e) =>
                    setAnswers((a) => ({
                      ...a,
                      [q.key]: { score: Number(e.target.value), example: a[q.key]?.example ?? '' },
                    }))
                  }
                >
                  {[1, 2, 3].map((n) => (
                    <NativeSelectOption key={n} value={String(n)}>
                      {n}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Textarea
                  aria-label={t('talentReview.card.example', { item: q.title })}
                  placeholder={t('talentReview.card.examplePlaceholder')}
                  disabled={!data.can.assessPotential}
                  value={answers[q.key]?.example ?? ''}
                  onChange={(e) =>
                    setAnswers((a) => ({
                      ...a,
                      [q.key]: { score: a[q.key]?.score ?? 2, example: e.target.value },
                    }))
                  }
                />
              </div>
            ))}
            {data.can.assessPotential ? (
              <Button
                size='sm'
                className='self-end'
                disabled={action.busy || !answersComplete}
                onClick={() =>
                  void save({ method: 'POST', path: `${path}/potential`, json: { answers } }, t('talentReview.card.potentialSaved'))
                }
              >
                {t('talentReview.card.savePotential')}
              </Button>
            ) : null}
          </section>

          {data.can.place ? (
            <section className='flex flex-col gap-2'>
              <h3 className='font-medium'>{t('talentReview.card.performance')}</h3>
              <div className='grid gap-2 sm:grid-cols-[6rem_1fr_auto]'>
                <NativeSelect aria-label={t('talentReview.detail.performanceBand')} value={band} onChange={(e) => setBand(e.target.value)}>
                  <NativeSelectOption value=''>—</NativeSelectOption>
                  {[1, 2, 3].map((n) => (
                    <NativeSelectOption key={n} value={String(n)}>
                      {n}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
                <Textarea
                  aria-label={t('talentReview.move.reason')}
                  placeholder={t('talentReview.card.bandReason')}
                  value={bandReason}
                  onChange={(e) => setBandReason(e.target.value)}
                />
                <Button
                  size='sm'
                  variant='outline'
                  disabled={action.busy || !band || !bandReason.trim()}
                  onClick={() =>
                    void save(
                      { method: 'POST', path: `${path}/performance`, json: { band: Number(band), reason: bandReason } },
                      t('talentReview.card.bandSaved'),
                    )
                  }
                >
                  {t('talentReview.common.save')}
                </Button>
              </div>
            </section>
          ) : null}

          {placement.moves.length ? (
            <section className='flex flex-col gap-1'>
              <h3 className='font-medium'>{t('talentReview.card.moves')}</h3>
              {placement.moves.map((m) => (
                <p key={m.at} className='text-muted-foreground'>
                  {t('talentReview.card.moveLine', {
                    from: m.fromBox ?? '—',
                    to: m.toBox,
                    reason: m.reason,
                    by: m.byName,
                    at: formatDate(locale, m.at),
                  })}
                </p>
              ))}
            </section>
          ) : null}

          {data.can.place || placement.developmentActions.length ? (
            <section className='flex flex-col gap-2'>
              <h3 className='font-medium'>{t('talentReview.card.actions')}</h3>
              {actions.map((a, index) => (
                <div key={a.uid} className='grid gap-2 sm:grid-cols-[10rem_1fr_auto]'>
                  <NativeSelect
                    aria-label={t('talentReview.card.actionType')}
                    disabled={!data.can.place}
                    value={a.type}
                    onChange={(e) =>
                      setActions((list) => list.map((x, i) => (i === index ? { ...x, type: e.target.value } : x)))
                    }
                  >
                    {ACTION_TYPES.map((type) => (
                      <NativeSelectOption key={type} value={type}>
                        {t(`talentReview.actionType.${type}`)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Textarea
                    aria-label={t('talentReview.card.actionNote')}
                    disabled={!data.can.place}
                    value={a.note}
                    onChange={(e) =>
                      setActions((list) => list.map((x, i) => (i === index ? { ...x, note: e.target.value } : x)))
                    }
                  />
                  {data.can.place ? (
                    <Button
                      size='sm'
                      variant='ghost'
                      onClick={() => setActions((list) => list.filter((_, i) => i !== index))}
                    >
                      {t('talentReview.common.remove')}
                    </Button>
                  ) : null}
                </div>
              ))}
              {data.can.place ? (
                <div className='flex flex-wrap justify-end gap-2'>
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() =>
                      setActions((list) => [...list, { uid: `a${Date.now()}`, type: 'stretch', note: '' }])
                    }
                  >
                    {t('talentReview.card.addAction')}
                  </Button>
                  <Button
                    size='sm'
                    variant='outline'
                    disabled={action.busy}
                    onClick={() =>
                      void save({ method: 'PUT', path: `${path}/actions`, json: { actions: actions.map(({ type, note }) => ({ type, note })) } }, t('talentReview.card.actionsSaved'))
                    }
                  >
                    {t('talentReview.card.saveActions')}
                  </Button>
                  <Button
                    size='sm'
                    disabled={action.busy || !placement.box || !placement.developmentActions.length}
                    onClick={() => void save({ method: 'POST', path: `${path}/confirm` }, t('talentReview.card.confirmed'))}
                  >
                    {t('talentReview.card.confirm')}
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
          {placement.decidedAt ? (
            <p className='text-muted-foreground'>
              {t('talentReview.card.decidedLine', {
                by: placement.decidedByName ?? '',
                at: formatDate(locale, placement.decidedAt),
              })}
              {placement.learningPlanId ? ` ${t('talentReview.card.planDrafted')}` : ''}
            </p>
          ) : null}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
