import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { HistoryIcon } from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import type {
  BriefView,
  RevisionGroup,
  RevisionView,
} from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

const TYPES = ['lesson', 'question', 'practiceScenario'] as const;

function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  return JSON.stringify(value, null, 2);
}

/** Highlights what changed between two texts: the common start and end stay plain, the middle is marked. */
function Diff({
  before,
  after,
}: {
  before: string;
  after: string;
}): ReactElement {
  let start = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start += 1;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end += 1;
  const mark = (value: string, className: string): ReactNode => (
    <>
      {value.slice(0, start)}
      <mark className={className}>
        {value.slice(start, value.length - end)}
      </mark>
      {value.slice(value.length - end)}
    </>
  );
  return (
    <div className='grid gap-2 md:grid-cols-2'>
      <pre className='rounded-lg bg-muted/60 p-2 text-xs whitespace-pre-wrap break-words'>
        {mark(before, 'bg-destructive/20 text-foreground')}
      </pre>
      <pre className='rounded-lg bg-muted/60 p-2 text-xs whitespace-pre-wrap break-words'>
        {mark(after, 'bg-primary/20 text-foreground')}
      </pre>
    </div>
  );
}

/**
 * 修订建议 (V3-11): suggestions grouped by document version, then by lessons,
 * questions and practice scenarios, each with the current and proposed text
 * highlighted and the new version's wording it rests on; question-quality
 * rewrites on their own tab. A course's lesson suggestions are applied
 * together, which bumps the course version and republishes it.
 */
export default function RevisionsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'quality' ? 'quality' : 'document';
  const documentId = params.get('documentId') ?? undefined;
  const groups = useRemote<RevisionGroup[]>('talent/revisions', {
    reason: tab === 'quality' ? 'lowQuality' : 'documentChanged',
    documentId: tab === 'quality' ? undefined : documentId,
  });
  const briefs = useRemote<BriefView[]>('talent/revisions/briefs');
  const [acting, setActing] = useState<{
    revision: RevisionView;
    action: 'modify' | 'reject';
  } | null>(null);
  const [history, setHistory] = useState<{ id: string; title: string } | null>(
    null,
  );

  async function accept(revision: RevisionView): Promise<void> {
    try {
      await api.request({
        method: 'POST',
        path: `talent/revisions/${encodeURIComponent(revision.id)}/accept`,
        json: {},
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.revisions.accepted'),
      });
      groups.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
      groups.reload();
    }
  }

  async function apply(courseId: string): Promise<void> {
    try {
      const response = await api.request<{ data: { version: number } }>({
        method: 'POST',
        path: `talent/revisions/courses/${encodeURIComponent(courseId)}/apply`,
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.revisions.applied', {
          version: response.data.version,
        }),
      });
      groups.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.revisions.title')}
        description={t('talent.insights.revisions.description')}
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
          <TabsTrigger value='document'>
            {t('talent.insights.revisions.tabs.document')}
          </TabsTrigger>
          <TabsTrigger value='quality'>
            {t('talent.insights.revisions.tabs.quality')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {groups.error ? (
        <LoadError error={groups.error} onRetry={groups.reload} />
      ) : !groups.data ? (
        <BlockSkeleton rows={6} />
      ) : !groups.data.length ? (
        <EmptyState title={t('talent.insights.revisions.empty')} />
      ) : (
        groups.data.map((group) => {
          const brief = briefs.data?.find(
            (b) => b.documentId === group.document?.id,
          );
          return (
            <Card key={group.document?.id ?? 'quality'}>
              <CardHeader>
                <CardTitle>
                  {group.document
                    ? `${group.document.title} ${group.document.version ?? ''}`
                    : t('talent.insights.revisions.noDocument')}
                </CardTitle>
                {group.affectedEstimate !== null ? (
                  <CardDescription>
                    {t('talent.insights.revisions.affected', {
                      count: group.affectedEstimate,
                    })}
                  </CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className='space-y-4 text-sm'>
                {group.brief ? (
                  <BriefRow
                    brief={group.brief}
                    detail={brief}
                    onSaved={briefs.reload}
                  />
                ) : null}
                {group.courses.map((course) => (
                  <div
                    key={course.id}
                    className='flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3'
                  >
                    <p>
                      {t('talent.insights.revisions.applyHint', {
                        course: course.title,
                        accepted: course.accepted,
                        open: course.open,
                      })}
                    </p>
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setHistory({ id: course.id, title: course.title })
                        }
                      >
                        <HistoryIcon data-icon='inline-start' />
                        {t('talent.insights.revisions.history')}
                      </Button>
                      <Button
                        size='sm'
                        disabled={!course.canApply}
                        onClick={() => void apply(course.id)}
                      >
                        {t('talent.insights.revisions.apply')}
                      </Button>
                    </div>
                  </div>
                ))}
                {TYPES.map((type) => {
                  const list = group.revisions.filter(
                    (r) => r.targetType === type,
                  );
                  if (!list.length) return null;
                  return (
                    <section key={type} className='space-y-3'>
                      <h3 className='font-medium'>
                        {t(`talent.insights.revisions.targetTypes.${type}`)}
                      </h3>
                      {list.map((revision) => (
                        <RevisionCard
                          key={revision.id}
                          revision={revision}
                          onAccept={() => void accept(revision)}
                          onModify={() =>
                            setActing({ revision, action: 'modify' })
                          }
                          onReject={() =>
                            setActing({ revision, action: 'reject' })
                          }
                        />
                      ))}
                    </section>
                  );
                })}
              </CardContent>
            </Card>
          );
        })
      )}
      <ActionDialog
        value={acting}
        onClose={() => setActing(null)}
        onDone={groups.reload}
      />
      <HistoryDialog value={history} onClose={() => setHistory(null)} />
    </PageContainer>
  );
}

function BriefRow({
  brief,
  detail,
  onSaved,
}: {
  brief: { id: string; title: string; status: string };
  detail: BriefView | undefined;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [days, setDays] = useState<string | null>(null);

  async function save(): Promise<void> {
    try {
      await api.request({
        method: 'PATCH',
        path: `talent/revisions/briefs/${encodeURIComponent(brief.id)}`,
        json: { revisionDueDays: Number(days) },
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.revisions.dueDaysSaved'),
      });
      setDays(null);
      onSaved();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <div className='flex flex-wrap items-end justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3'>
      <div className='space-y-1'>
        <p className='text-muted-foreground'>
          {t('talent.insights.revisions.brief')}
        </p>
        <p className='flex flex-wrap items-center gap-2'>
          <Link
            to={`/talent/courses/${encodeURIComponent(brief.id)}`}
            className='font-medium text-primary underline-offset-4 hover:underline'
          >
            {brief.title}
          </Link>
          <Badge variant='outline'>
            {t(`talent.insights.revisions.briefStatus.${brief.status}`, {
              defaultValue: brief.status,
            })}
          </Badge>
        </p>
      </div>
      <div className='flex items-end gap-2'>
        <Field className='w-40'>
          <FieldLabel htmlFor={`due-${brief.id}`}>
            {t('talent.insights.revisions.dueDays')}
          </FieldLabel>
          <Input
            id={`due-${brief.id}`}
            type='number'
            min={1}
            max={60}
            value={days ?? String(detail?.revisionDueDays ?? 5)}
            onChange={(e) => setDays(e.target.value)}
          />
        </Field>
        <Button
          size='sm'
          variant='outline'
          disabled={days === null}
          onClick={() => void save()}
        >
          {t('talent.insights.revisions.saveDueDays')}
        </Button>
      </div>
    </div>
  );
}

function RevisionCard({
  revision,
  onAccept,
  onModify,
  onReject,
}: {
  revision: RevisionView;
  onAccept: () => void;
  onModify: () => void;
  onReject: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const deactivate = revision.proposed.action === 'deactivate';
  const keys = deactivate ? [] : Object.keys(revision.proposed);
  return (
    <div className='space-y-2 rounded-lg border border-border p-3'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <p className='font-medium break-words'>{revision.targetTitle}</p>
          {revision.sectionTitle ? (
            <p className='text-muted-foreground'>{revision.sectionTitle}</p>
          ) : null}
        </div>
        <Badge variant={revision.status === 'open' ? 'default' : 'secondary'}>
          {t(`talent.insights.revisions.statuses.${revision.status}`)}
        </Badge>
      </div>
      {revision.stale ? (
        <Alert>
          <AlertDescription>
            {t('talent.insights.revisions.stale')}
          </AlertDescription>
        </Alert>
      ) : null}
      {deactivate ? (
        <p className='font-medium text-destructive'>
          {t('talent.insights.revisions.deactivate')}
        </p>
      ) : (
        keys.map((key) => (
          <div key={key} className='space-y-1'>
            <p className='text-xs text-muted-foreground'>
              {key} · {t('talent.insights.revisions.current')} →{' '}
              {t('talent.insights.revisions.proposed')}
            </p>
            <Diff
              before={text(revision.current[key])}
              after={text(revision.proposed[key])}
            />
          </div>
        ))
      )}
      <div>
        <p className='text-muted-foreground'>
          {t('talent.insights.revisions.basis')}
        </p>
        <p className='whitespace-pre-line'>{revision.explanation}</p>
      </div>
      {revision.rejectReason ? (
        <p className='text-muted-foreground'>{revision.rejectReason}</p>
      ) : null}
      <div className='flex flex-wrap justify-end gap-2'>
        {revision.can.reject ||
        (revision.stale && revision.status === 'stale') ? (
          <Button size='sm' variant='outline' onClick={onReject}>
            {t('talent.insights.revisions.reject')}
          </Button>
        ) : null}
        {revision.can.accept && !deactivate ? (
          <Button size='sm' variant='outline' onClick={onModify}>
            {t('talent.insights.revisions.acceptModified')}
          </Button>
        ) : null}
        {revision.can.accept ? (
          <Button size='sm' onClick={onAccept}>
            {t('talent.insights.revisions.accept')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function ActionDialog({
  value,
  onClose,
  onDone,
}: {
  value: { revision: RevisionView; action: 'modify' | 'reject' } | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [reason, setReason] = useState('');
  const [fields, setFields] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string>();
  const reject = value?.action === 'reject';
  const initial = value
    ? Object.fromEntries(
        Object.entries(value.revision.proposed).map(([k, v]) => [k, text(v)]),
      )
    : {};
  const current = fields ?? initial;

  async function submit(): Promise<void> {
    if (!value) return;
    setError(undefined);
    try {
      let json: unknown;
      if (reject) json = { reason };
      else {
        const modified: Record<string, unknown> = {};
        for (const [key, raw] of Object.entries(current)) {
          const original = value.revision.proposed[key];
          modified[key] = typeof original === 'string' ? raw : JSON.parse(raw);
        }
        json = { modified };
      }
      await api.request({
        method: 'POST',
        path: `talent/revisions/${encodeURIComponent(value.revision.id)}/${reject ? 'reject' : 'accept'}`,
        json,
      });
      toast.add({
        type: 'success',
        title: t(
          reject
            ? 'talent.insights.revisions.rejected'
            : 'talent.insights.revisions.accepted',
        ),
      });
      setReason('');
      setFields(null);
      onDone();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? t('talent.errors.REVISION_PROPOSAL_INVALID')
          : errorMessage(cause, t),
      );
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) {
          setFields(null);
          onClose();
        }
      }}
    >
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {t(
              reject
                ? 'talent.insights.revisions.rejectTitle'
                : 'talent.insights.revisions.modifiedTitle',
            )}
          </DialogTitle>
          <DialogDescription>
            {reject
              ? value?.revision.targetTitle
              : t('talent.insights.revisions.modifiedHint')}
          </DialogDescription>
        </DialogHeader>
        {reject ? (
          <Field>
            <FieldLabel htmlFor='revision-reason'>
              {t('talent.insights.revisions.rejectReason')}
            </FieldLabel>
            <Textarea
              id='revision-reason'
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : (
          <div className='max-h-[60vh] space-y-3 overflow-y-auto'>
            {Object.entries(current).map(([key, raw]) => (
              <Field key={key}>
                <FieldLabel htmlFor={`revision-${key}`}>{key}</FieldLabel>
                <Textarea
                  id={`revision-${key}`}
                  rows={Math.min(Math.max(raw.split('\n').length, 2), 12)}
                  value={raw}
                  onChange={(e) =>
                    setFields({ ...current, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
          </div>
        )}
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talent.insights.common.cancel')}
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            disabled={reject && !reason.trim()}
            onClick={() => void submit()}
          >
            {t(
              reject
                ? 'talent.insights.revisions.reject'
                : 'talent.insights.revisions.accept',
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  value,
  onClose,
}: {
  value: { id: string; title: string } | null;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const history = useRemote<
    {
      appliedAt: string;
      appliedByName: string | null;
      version: number | null;
      revisions: {
        id: string;
        targetTitle: string;
        sectionTitle: string | null;
      }[];
    }[]
  >(
    value
      ? `talent/revisions/courses/${encodeURIComponent(value.id)}/history`
      : null,
  );
  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talent.insights.revisions.history')}</DialogTitle>
          <DialogDescription>{value?.title}</DialogDescription>
        </DialogHeader>
        {history.error ? (
          <LoadError error={history.error} />
        ) : !history.data ? (
          <BlockSkeleton rows={2} />
        ) : !history.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.insights.revisions.noHistory')}
          </p>
        ) : (
          <ul className='space-y-3 text-sm'>
            {history.data.map((entry) => (
              <li key={entry.appliedAt}>
                <p className='font-medium'>
                  {t('talent.insights.revisions.historyVersion', {
                    version: entry.version ?? '',
                    name: entry.appliedByName ?? '',
                    date: entry.appliedAt.slice(0, 10),
                  })}
                </p>
                <ul className='list-disc ps-5 text-muted-foreground'>
                  {entry.revisions.map((r) => (
                    <li key={r.id}>
                      {r.targetTitle}
                      {r.sectionTitle ? ` · ${r.sectionTitle}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
