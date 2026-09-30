import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { EventTimeline } from '@/components/talent/event-timeline';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { JobEvent } from '@/components/talent/types';
import { useRemote } from '@/components/talent/use-remote';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import type { DetailOutletContext } from './types.js';

/** Tab "异动记录": job events, newest first. */
export default function EmployeeEventsTab(): ReactElement {
  const { t } = useTranslation();
  const { detail } = useOutletContext<DetailOutletContext>();
  // Link an event to its action only for people who can open the actions page.
  const actionsPage = useCan({
    resource: { type: 'page', id: 'talent.actions' },
    action: 'access',
  });
  const events = useRemote<JobEvent[]>(
    `talent/employees/${encodeURIComponent(detail.employee.id)}/events`,
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.detail.tabs.events')}</CardTitle>
      </CardHeader>
      <CardContent>
        {events.error ? (
          <LoadError error={events.error} onRetry={events.reload} />
        ) : !events.data ? (
          <BlockSkeleton rows={2} />
        ) : (
          <EventTimeline
            events={events.data}
            linkActions={actionsPage.can === true}
          />
        )}
      </CardContent>
    </Card>
  );
}
