import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { FileDiffIcon, RefreshCwIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

interface DocumentRevisionInfo {
  readonly documentId: string;
  readonly changeNote: string | null;
  readonly brief: { id: string; title: string; status: string } | null;
  readonly revisions: { total: number; open: number };
  readonly affectedEstimate: number | null;
  readonly can: { rerun: boolean; editNote: boolean; viewRevisions: boolean };
}

/**
 * V3-11 知识库 · 升版修订: under a version's changes, the content writer's
 * change note (editable by the owner and HR), the version's change brief, its
 * revision suggestions and the affected estimate; HR and the owner may run
 * the revision again (the brief and open suggestions are not duplicated).
 */
export function DocumentRevisionPanel({
  documentId,
}: {
  documentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const info = useRemote<DocumentRevisionInfo>(
    `talent/revisions/documents/${encodeURIComponent(documentId)}`,
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = info.data;
  // For the people who maintain the content: the document's owner, HR and the instructors reviewing suggestions.
  if (
    !data ||
    !(data.can.editNote || data.can.viewRevisions) ||
    (!data.changeNote &&
      !data.brief &&
      !data.revisions.total &&
      !data.can.rerun)
  )
    return null;

  async function saveNote(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        method: 'PATCH',
        path: `talent/revisions/documents/${encodeURIComponent(documentId)}/change-note`,
        json: { changeNote: editing },
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.knowledge.noteSaved'),
      });
      setEditing(null);
      info.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  async function rerun(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        method: 'POST',
        path: `talent/revisions/documents/${encodeURIComponent(documentId)}/rerun`,
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.knowledge.rerunDone'),
      });
      info.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.insights.knowledge.changeNote')}</CardTitle>
        {data.can.editNote && editing === null ? (
          <CardAction>
            <Button
              size='sm'
              variant='outline'
              onClick={() => setEditing(data.changeNote ?? '')}
            >
              {t('talent.insights.knowledge.editNote')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        {editing !== null ? (
          <div className='space-y-2'>
            <Textarea
              aria-label={t('talent.insights.knowledge.changeNote')}
              rows={5}
              value={editing}
              onChange={(e) => setEditing(e.target.value)}
            />
            <div className='flex justify-end gap-2'>
              <Button
                variant='outline'
                size='sm'
                onClick={() => setEditing(null)}
              >
                {t('talent.insights.common.cancel')}
              </Button>
              <Button size='sm' disabled={busy} onClick={() => void saveNote()}>
                {t('talent.insights.knowledge.saveNote')}
              </Button>
            </div>
          </div>
        ) : (
          <p className='whitespace-pre-line text-muted-foreground'>
            {data.changeNote ?? t('talent.insights.knowledge.noChangeNote')}
          </p>
        )}
        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-muted-foreground'>
            {t('talent.insights.knowledge.brief')}
          </span>
          {data.brief ? (
            <>
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={`/talent/courses/${data.brief.id}`}
              >
                {data.brief.title}
              </Link>
              <Badge variant='outline'>
                {t(
                  `talent.insights.revisions.briefStatus.${data.brief.status}`,
                  {
                    defaultValue: data.brief.status,
                  },
                )}
              </Badge>
            </>
          ) : (
            <span>{t('talent.insights.knowledge.noBrief')}</span>
          )}
        </div>
        {data.revisions.total ? (
          <Link
            className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
            to={`/talent/revisions?documentId=${encodeURIComponent(documentId)}`}
          >
            <FileDiffIcon className='size-4' />
            {t('talent.insights.knowledge.revisionsLink', data.revisions)}
          </Link>
        ) : null}
        {data.affectedEstimate !== null ? (
          <p className='text-muted-foreground'>
            {t('talent.insights.knowledge.affected', {
              count: data.affectedEstimate,
            })}
          </p>
        ) : null}
        {data.can.rerun ? (
          <Button
            size='sm'
            variant='outline'
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <RefreshCwIcon data-icon='inline-start' />
            {t('talent.insights.knowledge.rerun')}
          </Button>
        ) : null}
      </CardContent>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.insights.knowledge.rerunTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.insights.knowledge.rerunHint')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('talent.insights.common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void rerun()}>
              {t('talent.insights.common.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
