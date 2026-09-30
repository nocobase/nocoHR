/**
 * V4-13 知识库 · 待审核 (mounted in client/pages/talent/knowledge): the FAQ
 * documents the knowledge assistant drafted from resolved tickets and
 * featured forum posts, with their source candidates and the statements left
 * out for conflicting with a controlled document. A draft answers no
 * question until its owner (or hr.admin) confirms it; confirmed FAQs are
 * cited as 非受控文件，仅供参考.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Markdown } from './markdown.js';
import { BlockSkeleton, EmptyState, LoadError } from './states.js';
import { useTrAction } from './talent-review-lib.js';
import { useRemote } from './use-remote.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface Pending {
  id: string;
  title: string;
  contentText: string;
  ownerName: string;
  notes: {
    sources?: { sourceSystem: string; externalId: string; title: string; link: string | null }[];
    conflicts?: { externalId: string; sentence: string; document: string; documentSentence: string }[];
  };
}

export function KnowledgePendingPanel(): ReactElement {
  const { t } = useTranslation();
  const pending = useRemote<Pending[]>('talent/knowledge-candidates/pending-documents');
  const action = useTrAction();
  if (pending.error) return <LoadError error={pending.error} onRetry={pending.reload} />;
  if (!pending.data) return <BlockSkeleton rows={3} />;
  if (!pending.data.length) return <EmptyState title={t('talentReview.kbPending.empty')} />;
  const decide = async (id: string, decision: 'confirm' | 'discard') => {
    const done = await action.run(
      { method: 'POST', path: `talent/knowledge-candidates/pending-documents/${encodeURIComponent(id)}/${decision}` },
      t(`talentReview.kbPending.${decision}ed`),
    );
    if (done) pending.reload();
  };
  return (
    <div className='flex flex-col gap-3'>
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {pending.data.map((doc) => (
        <Card key={doc.id}>
          <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-2'>
            <div>
              <CardTitle>{doc.title}</CardTitle>
              <CardDescription>{t('talentReview.kbPending.owner', { name: doc.ownerName })}</CardDescription>
            </div>
            <div className='flex gap-2'>
              <Button size='sm' variant='outline' disabled={action.busy} onClick={() => void decide(doc.id, 'discard')}>
                {t('talentReview.kbPending.discard')}
              </Button>
              <Button size='sm' disabled={action.busy} onClick={() => void decide(doc.id, 'confirm')}>
                {t('talentReview.kbPending.confirm')}
              </Button>
            </div>
          </CardHeader>
          <CardContent className='flex flex-col gap-3 text-sm'>
            <Markdown>{doc.contentText}</Markdown>
            {doc.notes.sources?.length ? (
              <div>
                <div className='font-medium'>{t('talentReview.kbPending.sources')}</div>
                <ul className='text-muted-foreground list-disc ps-5'>
                  {doc.notes.sources.map((s) => (
                    <li key={s.externalId}>
                      {s.externalId} · {s.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {doc.notes.conflicts?.length ? (
              <Alert variant='destructive'>
                <AlertDescription className='flex flex-col gap-1'>
                  <span className='font-medium'>{t('talentReview.kbPending.conflicts')}</span>
                  {doc.notes.conflicts.map((c) => (
                    <span key={`${c.externalId}-${c.sentence}`}>
                      {t('talentReview.kbPending.conflictLine', {
                        id: c.externalId,
                        sentence: c.sentence,
                        document: c.document,
                        rule: c.documentSentence,
                      })}
                    </span>
                  ))}
                </AlertDescription>
              </Alert>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
