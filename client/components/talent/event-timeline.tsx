import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';

import type { JobEvent } from './types.js';

/**
 * Job events, newest first, each with where it came from: a personnel action,
 * a correction (with its reason) or an import. `linkActions` links an action's
 * event to the action; off for people who cannot open actions (my profile).
 */
export function EventTimeline({
  events,
  linkActions = false,
}: {
  events: readonly JobEvent[];
  linkActions?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  if (!events.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('talent.events.empty')}
      </p>
    );
  return (
    <ol className='relative space-y-4 border-l pl-5'>
      {events.map((event) => (
        <li key={event.id} className='relative'>
          <span
            className='absolute top-1.5 -left-[25px] size-2.5 rounded-full bg-primary'
            aria-hidden='true'
          />
          <p className='flex flex-wrap items-center gap-2 text-sm font-medium'>
            <span>
              {t(`talent.actionType.${event.eventType}`)}{' '}
              <span className='font-normal text-muted-foreground tabular-nums'>
                · {event.effectiveDate}
              </span>
            </span>
            {event.source ? (
              <Badge variant='outline'>
                {t(`talent.events.source.${event.source}`)}
              </Badge>
            ) : null}
            {linkActions && event.source === 'action' && event.actionId ? (
              <Link
                className='text-sm font-normal text-primary underline-offset-4 hover:underline'
                to={`/talent/actions/${encodeURIComponent(event.actionId)}`}
              >
                {t('talent.events.openAction')}
              </Link>
            ) : null}
          </p>
          <p className='text-sm text-muted-foreground'>
            {event.fromDepartment || event.fromPosition
              ? t('talent.events.change', {
                  from: [event.fromDepartment, event.fromPosition]
                    .filter(Boolean)
                    .join(' / '),
                  to: [event.toDepartment, event.toPosition]
                    .filter(Boolean)
                    .join(' / '),
                })
              : [event.toDepartment, event.toPosition]
                  .filter(Boolean)
                  .join(' / ')}
          </p>
          {event.source === 'manual' && event.note ? (
            <p className='text-sm whitespace-pre-line'>
              {t('talent.events.note', { note: event.note })}
            </p>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
