import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import type { JobEvent } from './types.js';

/** Job events, newest first. */
export function EventTimeline({
  events,
}: {
  events: readonly JobEvent[];
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
          <p className='text-sm font-medium'>
            {t(`talent.actionType.${event.eventType}`)}{' '}
            <span className='font-normal text-muted-foreground tabular-nums'>
              · {event.effectiveDate}
            </span>
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
        </li>
      ))}
    </ol>
  );
}
