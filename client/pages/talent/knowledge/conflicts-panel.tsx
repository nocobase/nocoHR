import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, EyeOffIcon, UploadIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorCode, errorMessage } from '@/components/talent/errors';
import type { DocumentConflict } from '@/components/talent/learning-types';
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
  CardFooter,
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
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

type Decision = 'resolve' | 'ignore';

/**
 * 文档冲突 (V1-04): passages in two documents that say different things about
 * the same matter, found by the knowledge assistant's conflict check. Both
 * passages sit side by side; the owner (or HR) marks the conflict resolved,
 * ignores it with a reason, or uploads a new version of either document.
 */
export function ConflictsPanel(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const conflicts = useRemote<DocumentConflict[]>('talent/kb/conflicts', {
    status,
  });
  const [handling, setHandling] = useState<{
    conflict: DocumentConflict;
    decision: Decision;
  } | null>(null);
  const format = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  return (
    <div className='space-y-3'>
      <div className='flex items-center gap-2'>
        <NativeSelect
          value={status}
          onChange={(e) => setStatus(e.target.value === 'all' ? 'all' : 'open')}
          aria-label={t('talent.fields.status')}
        >
          <NativeSelectOption value='open'>
            {t('knowledgeService.conflicts.status.open')}
          </NativeSelectOption>
          <NativeSelectOption value='all'>
            {t('knowledgeService.conflicts.status.all')}
          </NativeSelectOption>
        </NativeSelect>
        {conflicts.loading && conflicts.data ? <Spinner /> : null}
      </div>
      {conflicts.error ? (
        <LoadError error={conflicts.error} onRetry={conflicts.reload} />
      ) : !conflicts.data ? (
        <BlockSkeleton rows={3} />
      ) : !conflicts.data.length ? (
        <EmptyState
          title={t('knowledgeService.conflicts.empty')}
          description={t('knowledgeService.conflicts.emptyDescription')}
        />
      ) : (
        conflicts.data.map((conflict) => (
          <Card key={conflict.id}>
            <CardHeader>
              <CardTitle className='flex flex-wrap items-center gap-2'>
                {conflict.description}
                <Badge
                  variant={conflict.status === 'open' ? 'default' : 'outline'}
                >
                  {t(`knowledgeService.conflicts.status.${conflict.status}`)}
                </Badge>
              </CardTitle>
              <CardDescription>
                {t('knowledgeService.conflicts.found', {
                  date: format.format(new Date(conflict.createdAt)),
                })}
              </CardDescription>
            </CardHeader>
            <CardContent className='space-y-3'>
              <div className='grid gap-3 md:grid-cols-2'>
                <Side
                  documentId={conflict.documentId}
                  title={conflict.documentTitle}
                  section={conflict.sectionTitle}
                  excerpt={conflict.excerpt}
                  canUpload={conflict.can.resolve}
                />
                <Side
                  documentId={conflict.otherDocumentId}
                  title={conflict.otherDocumentTitle}
                  section={conflict.otherSectionTitle}
                  excerpt={conflict.otherExcerpt}
                  canUpload={conflict.can.resolve}
                />
              </div>
              {conflict.status !== 'open' ? (
                <p className='text-sm text-muted-foreground'>
                  {t('knowledgeService.conflicts.handled', {
                    name: conflict.handledByName ?? '—',
                  })}
                  {conflict.resolutionNote
                    ? ` · ${conflict.resolutionNote}`
                    : ''}
                </p>
              ) : null}
            </CardContent>
            {conflict.can.resolve || conflict.can.ignore ? (
              <CardFooter className='justify-end gap-2'>
                {conflict.can.ignore ? (
                  <Button
                    variant='ghost'
                    onClick={() =>
                      setHandling({ conflict, decision: 'ignore' })
                    }
                  >
                    <EyeOffIcon data-icon='inline-start' />
                    {t('knowledgeService.conflicts.ignore')}
                  </Button>
                ) : null}
                {conflict.can.resolve ? (
                  <Button
                    variant='outline'
                    onClick={() =>
                      setHandling({ conflict, decision: 'resolve' })
                    }
                  >
                    <CheckIcon data-icon='inline-start' />
                    {t('knowledgeService.conflicts.resolve')}
                  </Button>
                ) : null}
              </CardFooter>
            ) : null}
          </Card>
        ))
      )}
      <DecisionDialog
        handling={handling}
        onClose={() => setHandling(null)}
        onDone={() => {
          setHandling(null);
          conflicts.reload();
        }}
      />
    </div>
  );
}

function Side({
  documentId,
  title,
  section,
  excerpt,
  canUpload,
}: {
  documentId: string;
  title: string;
  section: string;
  excerpt: string | null;
  canUpload: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const path = `/talent/knowledge/${encodeURIComponent(documentId)}`;
  return (
    <div className='flex flex-col gap-2 rounded-lg border bg-muted/40 p-4'>
      <Link to={path} className='font-medium hover:underline'>
        {title}
      </Link>
      <p className='text-xs text-muted-foreground'>{section}</p>
      <p className='flex-1 text-sm break-words whitespace-pre-wrap'>
        {excerpt ?? '—'}
      </p>
      {canUpload ? (
        <Button
          size='sm'
          variant='outline'
          className='self-start'
          nativeButton={false}
          render={<Link to={`${path}/versions/new`} />}
        >
          <UploadIcon data-icon='inline-start' />
          {t('knowledgeService.version.upload')}
        </Button>
      ) : null}
    </div>
  );
}

/** 标记已解决 (note optional) or 忽略 (note required) for one conflict. */
function DecisionDialog({
  handling,
  onClose,
  onDone,
}: {
  handling: { conflict: DocumentConflict; decision: Decision } | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [openFor, setOpenFor] = useState<typeof handling>(null);
  if (openFor !== handling) {
    setOpenFor(handling);
    setNote('');
    setNoteError(undefined);
    setError(undefined);
  }
  const decision = handling?.decision ?? 'resolve';

  async function submit(): Promise<void> {
    if (!handling) return;
    if (decision === 'ignore' && !note.trim()) {
      setNoteError(t('knowledgeService.conflicts.noteRequired'));
      document.getElementById('conflict-note')?.focus();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/kb/conflicts/${encodeURIComponent(handling.conflict.id)}/${decision}`,
        method: 'POST',
        json: note.trim() ? { note: note.trim() } : {},
      });
      toast.add({
        type: 'success',
        title: t(`knowledgeService.conflicts.done.${decision}`),
      });
      onDone();
    } catch (cause) {
      if (errorCode(cause) === 'CONFLICT_NOTE_REQUIRED')
        setNoteError(errorMessage(cause, t));
      else setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(handling)}
      onOpenChange={(open) => (!open && !busy ? onClose() : undefined)}
    >
      <DialogContent>
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
              {t(`knowledgeService.conflicts.${decision}Title`)}
            </DialogTitle>
            <DialogDescription>
              {handling?.conflict.description}
            </DialogDescription>
          </DialogHeader>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={Boolean(noteError)}>
            <FieldLabel htmlFor='conflict-note'>
              {t('knowledgeService.conflicts.note')}
              {decision === 'ignore' ? ' *' : null}
            </FieldLabel>
            <Textarea
              id='conflict-note'
              rows={3}
              maxLength={1000}
              value={note}
              disabled={busy}
              aria-invalid={Boolean(noteError)}
              placeholder={t(
                `knowledgeService.conflicts.${decision}Placeholder`,
              )}
              onChange={(e) => setNote(e.target.value)}
            />
            {noteError ? <FieldError>{noteError}</FieldError> : null}
          </Field>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              disabled={busy}
              onClick={onClose}
            >
              {t('actions.cancel')}
            </Button>
            <Button type='submit' disabled={busy}>
              {busy ? <Spinner data-icon='inline-start' /> : null}
              {t(`knowledgeService.conflicts.${decision}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
