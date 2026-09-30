import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { RefreshCwIcon, SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
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
import { toast } from '@/components/ui/toast';

import type { ProfileSummary } from './types.js';

/**
 * V3-11 AI 画像摘要, for the employee detail 画像 tab and 我的档案 (pass
 * `employeeId="me"` there). Each sentence opens to the data it rests on; the
 * summary never quotes a business record's description. Regenerating is
 * offered to heads within scope and HR.
 */
export function ProfileSummaryCard({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const summary = useRemote<ProfileSummary>(
    `talent/profiles/${encodeURIComponent(employeeId)}/summary`,
  );
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function regenerate(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        method: 'POST',
        path: `talent/profiles/${encodeURIComponent(employeeId)}/summary/regenerate`,
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.profile.regenerated'),
      });
      summary.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex items-center gap-2'>
          <SparklesIcon className='size-4 text-muted-foreground' />
          {t('talent.insights.profile.summaryTitle')}
        </CardTitle>
        <CardDescription>
          {t('talent.insights.common.aiGenerated')}
          {summary.data?.generatedAt
            ? ` · ${t('talent.insights.profile.generatedAt', {
                date: summary.data.generatedAt.slice(0, 10),
              })}`
            : ''}
        </CardDescription>
        {summary.data?.canRegenerate ? (
          <CardAction>
            <Button
              size='sm'
              variant='outline'
              disabled={busy}
              onClick={() => void regenerate()}
            >
              <RefreshCwIcon data-icon='inline-start' />
              {t('talent.insights.profile.regenerate')}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-2 text-sm'>
        {summary.error ? (
          <LoadError error={summary.error} onRetry={summary.reload} />
        ) : !summary.data ? (
          <BlockSkeleton rows={2} />
        ) : !summary.data.sentences.length ? (
          <p className='text-muted-foreground'>
            {t('talent.insights.profile.noSummary')}
          </p>
        ) : (
          summary.data.sentences.map((sentence, index) => (
            <div key={sentence.text} className='space-y-1'>
              <p>{sentence.text}</p>
              <Button
                variant='link'
                size='sm'
                className='h-auto px-0'
                aria-expanded={open === index}
                onClick={() => setOpen(open === index ? null : index)}
              >
                {open === index
                  ? t('talent.insights.profile.hideEvidence')
                  : t('talent.insights.profile.showEvidence')}
              </Button>
              {open === index ? (
                <ul className='space-y-1 rounded-lg border border-border bg-muted/40 p-2'>
                  {sentence.evidence.map((item) => (
                    <li
                      key={item.id}
                      className='flex flex-wrap items-center gap-2'
                    >
                      <Badge variant='outline'>
                        {t(`talent.insights.evidenceTypes.${item.type}`)}
                      </Badge>
                      <span className='min-w-0 break-words'>{item.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
