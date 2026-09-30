import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { AttemptResult } from '@/components/talent/exam-types';
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
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** 异常答卷 (V3-10 10B): attempts with integrity flags; an instructor keeps or voids each, with a reason. */
export function IntegrityPanel({
  examId,
  canVoid,
  onChanged,
}: {
  examId: string;
  canVoid: boolean;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<AttemptResult[]>(
    `talent/exams/${encodeURIComponent(examId)}/integrity`,
  );
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={3} />;
  if (!list.data.length)
    return <EmptyState title={t('talent.examIntegrity.empty')} />;
  return (
    <div className='space-y-4'>
      {list.data.map((attempt) => (
        <IntegrityCard
          key={attempt.id}
          attempt={attempt}
          canVoid={canVoid}
          onReviewed={() => {
            list.reload();
            onChanged();
          }}
        />
      ))}
    </div>
  );
}

function IntegrityCard({
  attempt,
  canVoid,
  onReviewed,
}: {
  attempt: AttemptResult;
  canVoid: boolean;
  onReviewed: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const integrity = attempt.integrity;
  const time = (value: string) =>
    new Intl.DateTimeFormat(locale, { timeStyle: 'medium' }).format(
      new Date(value),
    );

  async function review(decision: 'valid' | 'void'): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/attempts/${encodeURIComponent(attempt.id)}/integrity-review`,
        method: 'POST',
        json: {
          decision,
          reason: decision === 'void' ? reason : undefined,
          resetAttempts: reset,
        },
      });
      toast.add({
        type: 'success',
        title:
          decision === 'void'
            ? t('talent.examIntegrity.voided')
            : t('talent.examIntegrity.kept'),
      });
      setVoiding(false);
      onReviewed();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {attempt.employeeName} ·{' '}
          {t('talent.exams.attemptNo', { no: attempt.attemptNo })}
          <Badge variant='outline'>
            {t(`talent.attemptStatus.${attempt.status}`)}
          </Badge>
          {integrity?.review ? (
            <Badge variant='secondary'>
              {t(`talent.examIntegrity.reviews.${integrity.review}`)}
            </Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {t('talent.examIntegrity.blurCount', {
            count: integrity?.blurCount ?? 0,
          })}
          {attempt.score !== null ? ` · ${attempt.score}` : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        <ol className='space-y-1 text-sm'>
          {(integrity?.flags ?? []).map((flag) => (
            <li
              key={`${flag.type}-${flag.at}-${flag.detail ?? ''}`}
              className='flex gap-2'
            >
              <span className='w-24 shrink-0 text-muted-foreground tabular-nums'>
                {time(flag.at)}
              </span>
              <span>
                {t(`talent.examIntegrity.flagTypes.${flag.type}`)}
                {flag.type === 'multiDevice' && flag.detail
                  ? ` · ${t(`talent.examIntegrity.deviceDetail.${flag.detail}`)}`
                  : flag.type === 'blur' && flag.detail
                    ? ` · ${t('talent.examIntegrity.blurNo', { no: flag.detail })}`
                    : ''}
              </span>
            </li>
          ))}
        </ol>
        {integrity?.voidReason ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.examIntegrity.voidReason', {
              reason: integrity.voidReason,
            })}
          </p>
        ) : null}
        {!integrity?.review ? (
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void review('valid')}
            >
              {t('talent.examIntegrity.keep')}
            </Button>
            {canVoid ? (
              <Button
                variant='destructive'
                disabled={busy}
                onClick={() => setVoiding(true)}
              >
                {t('talent.examIntegrity.void')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
      <Dialog open={voiding} onOpenChange={setVoiding}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('talent.examIntegrity.voidTitle')}</DialogTitle>
            <DialogDescription>
              {t('talent.examIntegrity.voidDescription')}
            </DialogDescription>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor={`void-reason-${attempt.id}`}>
              {t('talent.examIntegrity.reason')}
            </FieldLabel>
            <Textarea
              id={`void-reason-${attempt.id}`}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <label className='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={reset}
              onCheckedChange={(checked) => setReset(checked === true)}
            />
            {t('talent.examIntegrity.resetToo')}
          </label>
          {error ? <FieldError>{error}</FieldError> : null}
          <DialogFooter>
            <Button variant='outline' onClick={() => setVoiding(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              variant='destructive'
              disabled={busy || !reason.trim()}
              onClick={() => void review('void')}
            >
              {t('talent.examIntegrity.void')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
