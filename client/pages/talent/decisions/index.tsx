import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import type {
  RecommendationView,
  SuggestionView,
} from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

const TABS = ['suggestions', 'recommendations', 'learningPlans'] as const;
type Tab = (typeof TABS)[number];

interface Counts {
  suggestions: number | null;
  recommendations: number | null;
  learningPlans: number | null;
}

/**
 * 待我决定 (V3-11): what the AI employees propose and a head decides —
 * level suggestions, targeted training and (on their own page, as before)
 * learning plans. Each tab shows its count; every suggestion carries its
 * evidence, and nothing takes effect until the head decides.
 */
export default function DecisionsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const counts = useRemote<Counts>('talent/decisions/counts');
  const available = TABS.filter((tab) => counts.data?.[tab] !== null);
  const requested = params.get('tab') as Tab | null;
  const tab: Tab =
    requested && available.includes(requested)
      ? requested
      : (available[0] ?? 'suggestions');
  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.decisions.title')}
        description={t('talent.insights.decisions.description')}
      />
      {counts.error ? (
        <LoadError error={counts.error} onRetry={counts.reload} />
      ) : !counts.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <>
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              next.set('tab', String(value));
              next.delete('id');
              setParams(next, { replace: true });
            }}
          >
            <TabsList>
              {available.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {t(`talent.insights.decisions.tabs.${name}`)}
                  {counts.data?.[name] ? (
                    <Badge className='ms-1'>{counts.data[name]}</Badge>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {tab === 'suggestions' ? (
            <Suggestions onChanged={counts.reload} />
          ) : tab === 'recommendations' ? (
            <Recommendations onChanged={counts.reload} />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>
                  {t('talent.insights.decisions.pendingPlans', {
                    count: counts.data.learningPlans ?? 0,
                  })}
                </CardTitle>
                <CardDescription>
                  {t('talent.insights.decisions.learningPlansHint')}
                </CardDescription>
                <CardAction>
                  <Button render={<Link to='/talent/learning-plans' />}>
                    {t('talent.insights.decisions.openLearningPlans')}
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          )}
        </>
      )}
    </PageContainer>
  );
}

function EvidenceList({
  items,
}: {
  items: readonly { type?: string; summary: string; key: string }[];
}): ReactElement {
  const { t } = useTranslation();
  return (
    <ul className='space-y-1'>
      {items.map((item) => (
        <li key={item.key} className='flex flex-wrap items-center gap-2'>
          {item.type ? (
            <Badge variant='outline'>
              {t(`talent.insights.evidenceTypes.${item.type}`)}
            </Badge>
          ) : null}
          <span className='min-w-0 break-words'>{item.summary}</span>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({ status }: { status: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={status === 'draft' ? 'default' : 'secondary'}>
      {t(`talent.insights.decisions.statuses.${status}`, {
        defaultValue: status,
      })}
    </Badge>
  );
}

function Suggestions({ onChanged }: { onChanged: () => void }): ReactElement {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const list = useRemote<{
    items: SuggestionView[];
    can: { accept: boolean; reject: boolean };
  }>('talent/competency-suggestions', all ? {} : { status: 'open' });
  const [acting, setActing] = useState<{
    item: SuggestionView;
    action: 'accept' | 'reject';
  } | null>(null);
  return (
    <div className='space-y-3'>
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={all} onCheckedChange={setAll} />
        {t('talent.insights.decisions.showDecided')}
      </label>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.items.length ? (
        <EmptyState title={t('talent.insights.decisions.suggestion.empty')} />
      ) : (
        <div className='grid gap-3 lg:grid-cols-2'>
          {list.data.items.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle>
                  {item.employeeName} · {item.competencyTitle}
                </CardTitle>
                <CardDescription>
                  {item.departmentTitle} ·{' '}
                  {t('talent.insights.decisions.suggestion.levels', {
                    from: item.currentLevel,
                    to: item.suggestedLevel,
                  })}
                </CardDescription>
                <CardAction>
                  <StatusBadge status={item.status} />
                </CardAction>
              </CardHeader>
              <CardContent className='space-y-3 text-sm'>
                <div>
                  <p className='text-muted-foreground'>
                    {t('talent.insights.decisions.suggestion.rationale')}
                  </p>
                  <p className='whitespace-pre-line'>{item.rationale}</p>
                </div>
                <div>
                  <p className='text-muted-foreground'>
                    {t('talent.insights.common.evidence')}
                  </p>
                  <EvidenceList
                    items={item.evidence.map((e) => ({
                      key: e.id,
                      type: e.type,
                      summary: e.summary,
                    }))}
                  />
                </div>
                {item.status === 'accepted' && item.decidedLevel !== null ? (
                  <p className='text-muted-foreground'>
                    {t('talent.insights.decisions.suggestion.decided', {
                      level: item.decidedLevel,
                    })}
                    {item.reviewNote ? ` · ${item.reviewNote}` : ''}
                  </p>
                ) : item.reviewNote ? (
                  <p className='text-muted-foreground'>{item.reviewNote}</p>
                ) : null}
                {item.status === 'draft' ? (
                  <div className='flex flex-wrap justify-end gap-2'>
                    {list.data?.can.reject ? (
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setActing({ item, action: 'reject' })}
                      >
                        {t('talent.insights.decisions.suggestion.reject')}
                      </Button>
                    ) : null}
                    {list.data?.can.accept ? (
                      <Button
                        size='sm'
                        onClick={() => setActing({ item, action: 'accept' })}
                      >
                        {t('talent.insights.decisions.suggestion.accept')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <SuggestionDialog
        value={acting}
        onClose={() => setActing(null)}
        onDone={() => {
          list.reload();
          onChanged();
        }}
      />
    </div>
  );
}

function SuggestionDialog({
  value,
  onClose,
  onDone,
}: {
  value: { item: SuggestionView; action: 'accept' | 'reject' } | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [level, setLevel] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reject = value?.action === 'reject';

  async function submit(): Promise<void> {
    if (!value) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `talent/competency-suggestions/${encodeURIComponent(value.item.id)}/${value.action}`,
        json: reject
          ? { reason: note }
          : {
              level: level === '' ? value.item.suggestedLevel : Number(level),
              note: note || null,
            },
      });
      toast.add({
        type: 'success',
        title: t(
          reject
            ? 'talent.insights.decisions.suggestion.rejected'
            : 'talent.insights.decisions.suggestion.accepted',
        ),
      });
      setLevel('');
      setNote('');
      onDone();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              reject
                ? 'talent.insights.decisions.suggestion.rejectTitle'
                : 'talent.insights.decisions.suggestion.acceptTitle',
            )}
          </DialogTitle>
          <DialogDescription>
            {value
              ? `${value.item.employeeName} · ${value.item.competencyTitle} · ${t(
                  'talent.insights.decisions.suggestion.levels',
                  {
                    from: value.item.currentLevel,
                    to: value.item.suggestedLevel,
                  },
                )}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {reject ? null : (
          <>
            <p className='text-sm text-muted-foreground'>
              {t('talent.insights.decisions.suggestion.acceptHint')}
            </p>
            <Field>
              <FieldLabel htmlFor='suggestion-level'>
                {t('talent.insights.decisions.suggestion.level')}
              </FieldLabel>
              <Input
                id='suggestion-level'
                type='number'
                min={0}
                placeholder={String(value?.item.suggestedLevel ?? '')}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field>
          <FieldLabel htmlFor='suggestion-note'>
            {reject
              ? t('talent.insights.decisions.suggestion.rejectReason')
              : t('talent.insights.common.note')}
          </FieldLabel>
          <Textarea
            id='suggestion-note'
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talent.insights.common.cancel')}
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            disabled={busy || (reject && !note.trim())}
            onClick={() => void submit()}
          >
            {t(
              reject
                ? 'talent.insights.decisions.suggestion.reject'
                : 'talent.insights.decisions.suggestion.accept',
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Recommendations({
  onChanged,
}: {
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [all, setAll] = useState(false);
  const list = useRemote<{
    items: RecommendationView[];
    can: { approve: boolean; reject: boolean; retryWriteback: boolean };
  }>('talent/training-recommendations', all ? {} : { status: 'open' });
  const [removed, setRemoved] = useState<Record<string, string[]>>({});
  const [acting, setActing] = useState<{
    item: RecommendationView;
    action: 'approve' | 'reject';
  } | null>(null);
  const toggle = (id: string, employeeId: string) =>
    setRemoved((previous) => {
      const current = previous[id] ?? [];
      return {
        ...previous,
        [id]: current.includes(employeeId)
          ? current.filter((e) => e !== employeeId)
          : [...current, employeeId],
      };
    });
  return (
    <div className='space-y-3'>
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={all} onCheckedChange={setAll} />
        {t('talent.insights.decisions.showDecided')}
      </label>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.items.length ? (
        <EmptyState
          title={t('talent.insights.decisions.recommendation.empty')}
        />
      ) : (
        <div className='space-y-3'>
          {list.data.items.map((item) => {
            const out = removed[item.id] ?? [];
            const open = item.status === 'draft';
            return (
              <Card key={item.id}>
                <CardHeader>
                  <CardTitle>
                    {item.departmentTitle} · {item.competencyTitle}
                  </CardTitle>
                  <CardDescription>
                    {item.dueDate
                      ? `${t('talent.insights.decisions.recommendation.dueDate')} ${item.dueDate}`
                      : ''}
                    {item.correctiveActionRefs.length
                      ? ` · ${t('talent.insights.decisions.recommendation.refs')} ${item.correctiveActionRefs.join('、')}`
                      : ''}
                  </CardDescription>
                  <CardAction>
                    <StatusBadge status={item.status} />
                  </CardAction>
                </CardHeader>
                <CardContent className='grid gap-4 text-sm lg:grid-cols-2'>
                  <div className='space-y-3'>
                    <div>
                      <p className='text-muted-foreground'>
                        {t('talent.insights.decisions.recommendation.reason')}
                      </p>
                      <p className='whitespace-pre-line'>{item.reason}</p>
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        {t('talent.insights.common.evidence')}
                      </p>
                      <EvidenceList
                        items={item.evidence.map((e) => ({
                          key: e.signalId,
                          type: 'signal',
                          summary: `${e.externalId} · ${e.summary}${e.occurredAt ? ` · ${e.occurredAt.slice(0, 10)}` : ''}`,
                        }))}
                      />
                    </div>
                    <div>
                      <p className='text-muted-foreground'>
                        {t('talent.insights.decisions.recommendation.items')}
                      </p>
                      {item.items.length ? (
                        <ol className='list-decimal space-y-1 ps-5'>
                          {item.items.map((i) => (
                            <li key={i.id}>
                              {t(
                                `talent.insights.decisions.recommendation.itemTypes.${i.type}`,
                              )}
                              {' · '}
                              {i.title}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <p>
                          {t(
                            'talent.insights.decisions.recommendation.noItems',
                          )}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className='space-y-2'>
                    <p className='text-muted-foreground'>
                      {t('talent.insights.decisions.recommendation.audience')}
                    </p>
                    <ul className='divide-y divide-border rounded-lg border border-border'>
                      {item.audience.map((person) => {
                        const isOut = out.includes(person.employeeId);
                        return (
                          <li
                            key={person.employeeId}
                            className='flex flex-wrap items-center justify-between gap-2 p-2'
                          >
                            <div
                              className={
                                isOut
                                  ? 'text-muted-foreground line-through'
                                  : ''
                              }
                            >
                              <p className='font-medium'>
                                {person.name}
                                <span className='ms-2 text-muted-foreground'>
                                  {person.employeeNo}
                                </span>
                              </p>
                              <p className='text-muted-foreground'>
                                {person.reason}
                              </p>
                            </div>
                            {open && list.data?.can.approve ? (
                              <Button
                                size='sm'
                                variant='ghost'
                                onClick={() =>
                                  toggle(item.id, person.employeeId)
                                }
                              >
                                {isOut
                                  ? t(
                                      'talent.insights.decisions.recommendation.restore',
                                    )
                                  : t(
                                      'talent.insights.decisions.recommendation.remove',
                                    )}
                              </Button>
                            ) : person.assignments ? (
                              <span className='text-muted-foreground'>
                                {t(
                                  'talent.insights.decisions.recommendation.progress',
                                  {
                                    completed: person.completed,
                                    total: person.assignments,
                                  },
                                )}
                              </span>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <div className='flex flex-wrap justify-end gap-2'>
                      {item.hasProof ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() =>
                            void downloadFile(
                              api,
                              `talent/training-recommendations/${encodeURIComponent(item.id)}/proof`,
                              'training-proof.pdf',
                            )
                          }
                        >
                          <DownloadIcon data-icon='inline-start' />
                          {t('talent.insights.decisions.recommendation.proof')}
                        </Button>
                      ) : null}
                      {open && list.data?.can.reject ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => setActing({ item, action: 'reject' })}
                        >
                          {t('talent.insights.decisions.recommendation.reject')}
                        </Button>
                      ) : null}
                      {open && list.data?.can.approve ? (
                        <Button
                          size='sm'
                          disabled={
                            !item.items.length ||
                            out.length >= item.audience.length
                          }
                          onClick={() => setActing({ item, action: 'approve' })}
                        >
                          {t(
                            'talent.insights.decisions.recommendation.approve',
                          )}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <RecommendationDialog
        value={acting}
        removed={acting ? (removed[acting.item.id] ?? []) : []}
        onClose={() => setActing(null)}
        onDone={() => {
          list.reload();
          onChanged();
        }}
      />
    </div>
  );
}

function RecommendationDialog({
  value,
  removed,
  onClose,
  onDone,
}: {
  value: { item: RecommendationView; action: 'approve' | 'reject' } | null;
  removed: string[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reject = value?.action === 'reject';
  const remaining = value
    ? value.item.audience.filter((a) => !removed.includes(a.employeeId))
    : [];

  async function submit(): Promise<void> {
    if (!value) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `talent/training-recommendations/${encodeURIComponent(value.item.id)}/${value.action}`,
        json: reject
          ? { reason: note }
          : { removeEmployeeIds: removed, note: note || null },
      });
      toast.add({
        type: 'success',
        title: t(
          reject
            ? 'talent.insights.decisions.recommendation.rejected'
            : 'talent.insights.decisions.recommendation.approved',
        ),
      });
      setNote('');
      onDone();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t(
              reject
                ? 'talent.insights.decisions.recommendation.rejectTitle'
                : 'talent.insights.decisions.recommendation.approveTitle',
            )}
          </DialogTitle>
          <DialogDescription>
            {value
              ? `${value.item.departmentTitle} · ${value.item.competencyTitle}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        {reject ? null : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.insights.decisions.recommendation.approveHint')}{' '}
            {t('talent.insights.common.people', { count: remaining.length })}
          </p>
        )}
        <Field>
          <FieldLabel htmlFor='recommendation-note'>
            {reject
              ? t('talent.insights.decisions.recommendation.rejectReason')
              : t('talent.insights.common.note')}
          </FieldLabel>
          <Textarea
            id='recommendation-note'
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talent.insights.common.cancel')}
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            disabled={busy || (reject && !note.trim())}
            onClick={() => void submit()}
          >
            {t(
              reject
                ? 'talent.insights.decisions.recommendation.reject'
                : 'talent.insights.decisions.recommendation.approve',
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
