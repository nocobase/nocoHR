import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';

import type { JobEventRow } from './types.js';

/** Where an event came from: its personnel action, or the sync run (for people who may open 组织同步). */
export function SourceLink({
  event,
  canViewRuns,
}: {
  event: JobEventRow;
  canViewRuns: boolean;
}): ReactElement | null {
  const { t } = useTranslation();
  if (event.source === 'action' && event.actionId)
    return (
      <Link
        className='text-sm text-primary underline-offset-4 hover:underline'
        to={`/talent/actions/${encodeURIComponent(event.actionId)}`}
      >
        {t('talent.events.openAction')}
      </Link>
    );
  if (event.source === 'sync' && event.syncRunId && canViewRuns)
    return (
      <Link
        className='text-sm text-primary underline-offset-4 hover:underline'
        to={`/settings/org-sync/runs/${encodeURIComponent(event.syncRunId)}`}
      >
        {t('jobEvents.openRun')}
      </Link>
    );
  return null;
}

export function ProcessingBadge({
  event,
}: {
  event: JobEventRow;
}): ReactElement {
  const { t } = useTranslation();
  if (event.processedAt)
    return <Badge variant='secondary'>{t('jobEvents.processed')}</Badge>;
  if (event.processError)
    return <Badge variant='destructive'>{t('jobEvents.failed')}</Badge>;
  return <Badge variant='outline'>{t('jobEvents.pending')}</Badge>;
}
