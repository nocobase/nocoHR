import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { JobEventLearningBlock } from '@/components/talent/job-event-learning';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

import { ProcessingBadge, SourceLink } from './parts.js';
import type { JobEventsOutletContext, JobEventsResponse } from './types.js';

/** Route `/talent/job-events/:eventId`: one event with its source and processing result. */
export default function JobEventDetail(): ReactElement {
  const { t } = useTranslation();
  return (
    <RouteDrawer
      title={t('jobEvents.detailTitle')}
      description={t('jobEvents.detailDescription')}
    >
      <Body />
    </RouteDrawer>
  );
}

function Body(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const { eventId = '' } = useParams();
  const { canViewRuns } = useOutletContext<JobEventsOutletContext>();
  // No single-event endpoint: the unfiltered list, freshly loaded, holds it.
  const list = useRemote<JobEventsResponse>('talent/job-events');
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={6} />;
  const event = list.data.items.find((e) => e.id === eventId);
  if (!event)
    return (
      <Alert>
        <AlertDescription>{t('jobEvents.notFound')}</AlertDescription>
      </Alert>
    );
  const place = (department: string | null, position: string | null) =>
    [department, position].filter(Boolean).join(' / ') || '—';
  const rows: [string, ReactElement | string][] = [
    [
      t('jobEvents.employee'),
      <Link
        key='employee'
        className='text-primary underline-offset-4 hover:underline'
        to={`/talent/employees/${encodeURIComponent(event.employeeId)}/events`}
      >
        {event.employeeName ?? '—'}
      </Link>,
    ],
    [t('jobEvents.type'), t(`talent.actionType.${event.eventType}`)],
    [t('jobEvents.effectiveDate'), event.effectiveDate ?? '—'],
    [t('jobEvents.before'), place(event.fromDepartment, event.fromPosition)],
    [t('jobEvents.after'), place(event.toDepartment, event.toPosition)],
    [
      t('jobEvents.source'),
      <span key='source' className='flex flex-wrap items-center gap-2'>
        <Badge variant='outline'>
          {t(`talent.events.source.${event.source}`)}
        </Badge>
        <SourceLink event={event} canViewRuns={canViewRuns} />
      </span>,
    ],
    [t('jobEvents.processing'), <ProcessingBadge key='p' event={event} />],
    [
      t('jobEvents.processedAt'),
      event.processedAt
        ? new Intl.DateTimeFormat(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          }).format(new Date(event.processedAt))
        : '—',
    ],
  ];
  return (
    <div className='space-y-4'>
      <dl className='grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm'>
        {rows.map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='break-words'>{value}</dd>
          </div>
        ))}
        {event.note ? (
          <>
            <dt className='text-muted-foreground'>{t('jobEvents.note')}</dt>
            <dd className='whitespace-pre-line'>{event.note}</dd>
          </>
        ) : null}
      </dl>
      {event.processError && !event.processedAt ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('jobEvents.failedReason', { reason: event.processError })}
          </AlertDescription>
        </Alert>
      ) : null}
      {/* V3-09 学习处理: what the event did to learning; hidden from a viewer without access to it. */}
      <JobEventLearningBlock eventId={event.id} />
    </div>
  );
}
