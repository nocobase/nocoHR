import { useTranslation } from '@nocobase/i18n/client';
import { ExternalLinkIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { TimelineItem } from './types.js';

/** Chart palette tokens: one colour per competency, so the same competency reads the same everywhere. */
const TONES = [
  'bg-chart-1',
  'bg-chart-2',
  'bg-chart-3',
  'bg-chart-4',
  'bg-chart-5',
] as const;

function toneOf(key: string | null): string {
  if (!key) return 'bg-muted-foreground';
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TONES[hash % TONES.length];
}

/**
 * V3-11 成长时间线 · 业务数据: quality issues, tickets and project tasks of one
 * employee (`me` for oneself), coloured by competency, each linking to the
 * source record. Descriptions are not shown here.
 */
export function BusinessTimeline({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const timeline = useRemote<TimelineItem[]>(
    `talent/profiles/${encodeURIComponent(employeeId)}/timeline`,
  );
  const records = (timeline.data ?? []).filter((e) => e.kind === 'signal');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.insights.profile.timelineTitle')}</CardTitle>
        <CardDescription>
          {t('talent.insights.teamDashboard.trendHint')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {timeline.error ? (
          <LoadError error={timeline.error} onRetry={timeline.reload} />
        ) : !timeline.data ? (
          <BlockSkeleton rows={3} />
        ) : !records.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.insights.profile.timelineEmpty')}
          </p>
        ) : (
          <ol className='space-y-3'>
            {records.map((record) => (
              <li
                key={record.signalId ?? record.at}
                className='flex gap-3 text-sm'
              >
                <span
                  aria-hidden
                  className={`mt-1.5 size-2.5 shrink-0 rounded-full ${toneOf(record.competencyId)}`}
                />
                <div className='min-w-0 flex-1 space-y-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium break-words'>
                      {record.title}
                    </span>
                    {record.signalType ? (
                      <Badge variant='outline'>
                        {t(
                          `talent.insights.signals.types.${record.signalType}`,
                        )}
                      </Badge>
                    ) : null}
                  </div>
                  <p className='text-muted-foreground'>
                    {record.at.slice(0, 10)}
                    {record.competencyTitle
                      ? ` · ${record.competencyTitle}`
                      : ''}
                  </p>
                  {record.link ? (
                    <a
                      href={record.link}
                      target='_blank'
                      rel='noreferrer'
                      className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
                    >
                      {t('talent.insights.common.openRecord')}
                      <ExternalLinkIcon className='size-3.5' />
                    </a>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
