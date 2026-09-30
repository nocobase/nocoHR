import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { ParseStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type { KbDocumentDetail } from '@/components/talent/learning-types';
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** 版本链: every version with the document's number, newest first. */
export function VersionsCard({
  document,
}: {
  document: KbDocumentDetail;
}): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const versions = document.versions ?? [];
  if (versions.length < 2) return null;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('knowledgeService.version.chain')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className='space-y-3 text-sm'>
          {versions.map((v) => (
            <li key={v.id} className='flex flex-wrap items-center gap-2'>
              {v.id === document.id ? (
                <span className='font-medium'>
                  {v.version ?? t('knowledgeService.version.unnumbered')}
                </span>
              ) : (
                <Link
                  to={`/talent/knowledge/${encodeURIComponent(v.id)}`}
                  className='text-primary underline-offset-4 hover:underline'
                >
                  {v.version ?? t('knowledgeService.version.unnumbered')}
                </Link>
              )}
              <span className='text-muted-foreground tabular-nums'>
                {v.effectiveDate
                  ? format.format(new Date(`${v.effectiveDate}T00:00:00`))
                  : '—'}
              </span>
              {v.superseded ? (
                <Badge variant='outline'>
                  {t('knowledgeService.version.superseded')}
                </Badge>
              ) : v.parseStatus === 'ready' ? (
                <Badge variant='secondary'>
                  {t('knowledgeService.version.current')}
                </Badge>
              ) : (
                <ParseStatusBadge
                  status={v.parseStatus as 'pending' | 'ready' | 'failed'}
                />
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

/** 与上一版本的变化: only changed sections, old and new text side by side. */
export function ChangesCard({
  document,
}: {
  document: KbDocumentDetail;
}): ReactElement | null {
  const { t } = useTranslation();
  const changes = document.changeSummary ?? [];
  if (!document.previousVersionId || document.parseStatus !== 'ready')
    return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('knowledgeService.version.changes')}</CardTitle>
        <CardDescription>
          {changes.length
            ? t('knowledgeService.version.changesDescription', {
                count: changes.length,
              })
            : t('knowledgeService.version.noChanges')}
        </CardDescription>
      </CardHeader>
      {changes.length ? (
        <CardContent className='space-y-4'>
          {changes.map((change) => (
            <section
              key={`${change.changeType}-${change.sectionTitle}`}
              className='space-y-2'
            >
              <h3 className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                {change.sectionTitle || t('talent.knowledge.untitledSection')}
                <Badge variant='outline'>
                  {t(`knowledgeService.changeType.${change.changeType}`)}
                </Badge>
              </h3>
              <div className='grid gap-2 md:grid-cols-2'>
                <div className='rounded-md border bg-muted/40 p-3'>
                  <p className='mb-1 text-xs text-muted-foreground'>
                    {t('knowledgeService.version.before')}
                  </p>
                  <p className='text-sm break-words whitespace-pre-wrap'>
                    {change.before ?? '—'}
                  </p>
                </div>
                <div className='rounded-md border p-3'>
                  <p className='mb-1 text-xs text-muted-foreground'>
                    {t('knowledgeService.version.after')}
                  </p>
                  <p className='text-sm break-words whitespace-pre-wrap'>
                    {change.after ?? '—'}
                  </p>
                </div>
              </div>
            </section>
          ))}
        </CardContent>
      ) : null}
    </Card>
  );
}

/**
 * 标记已复核: records the review and moves the next review date on by the
 * default cycle (人事设置 · 制度复核), or to the date entered here. A single
 * action with one optional field, so it opens from component state.
 */
export function MarkReviewedDialog({
  open,
  onOpenChange,
  document,
  onReviewed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: KbDocumentDetail;
  onReviewed: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [date, setDate] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDate('');
      setError(undefined);
    }
  }

  async function submit(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/kb/documents/${encodeURIComponent(document.id)}/reviewed`,
        method: 'POST',
        json: date ? { nextReviewDate: date } : {},
      });
      toast.add({
        type: 'success',
        title: t('knowledgeService.review.marked', { title: document.title }),
      });
      onOpenChange(false);
      onReviewed();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (!busy ? onOpenChange(next) : undefined)}
    >
      <DialogContent className='sm:max-w-md'>
        <form
          noValidate
          className='grid gap-4'
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {t('knowledgeService.review.markTitle', {
                title: document.title,
              })}
            </DialogTitle>
            <DialogDescription>
              {t('knowledgeService.review.markDescription')}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor='kb-next-review'>
              {t('knowledgeService.review.nextDate')}
            </FieldLabel>
            <Input
              id='kb-next-review'
              type='date'
              className='w-48'
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
            <FieldDescription>
              {t('knowledgeService.review.nextDateHint')}
            </FieldDescription>
          </Field>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {t('actions.cancel')}
            </Button>
            <Button type='submit' disabled={busy}>
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t('knowledgeService.review.mark')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
