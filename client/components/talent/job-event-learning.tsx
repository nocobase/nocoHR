import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';

import { isForbidden } from './errors.js';
import { BlockSkeleton, LoadError } from './states.js';
import { useRemote } from './use-remote.js';

/** `GET talent/learning-job-events/:id` (server/providers/hr/learning-job-events.ts). */
export interface JobEventLearning {
  eventId: string;
  eventType: string;
  processed: boolean;
  assignedPath: {
    assignmentId: string;
    title: string;
    dueDate: string | null;
    completedSteps: string[];
    attachedSteps: string[];
  } | null;
  cancelled: {
    assignmentId: string;
    title: string;
    kind: string;
    status: string;
    cancelReason: string | null;
  }[];
  plans: { id: string; status: string; items: number }[];
}

/**
 * V3-09 学习处理: what a job event did to learning — the onboarding path it
 * assigned (with steps counted as completed and tasks attached), the tasks it
 * cancelled, and the learning coach's plan. Placed in the 岗位变动 event
 * detail; a viewer without the event's view sees nothing. A failed event is
 * retried from that page, as for every handler.
 */
export function JobEventLearningBlock({
  eventId,
}: {
  readonly eventId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const remote = useRemote<JobEventLearning>(
    `talent/learning-job-events/${encodeURIComponent(eventId)}`,
  );
  if (remote.error)
    return isForbidden(remote.error) ? null : (
      <LoadError error={remote.error} onRetry={remote.reload} />
    );
  if (!remote.data) return <BlockSkeleton rows={2} />;
  const data = remote.data;
  const empty =
    !data.assignedPath && !data.cancelled.length && !data.plans.length;
  return (
    <section
      aria-labelledby={`learning-${eventId}`}
      className='space-y-2 text-sm'
    >
      <h3 id={`learning-${eventId}`} className='font-medium'>
        {t('jobEventLearning.title')}
      </h3>
      {!data.processed ? (
        <p className='text-muted-foreground'>{t('jobEventLearning.pending')}</p>
      ) : empty ? (
        <p className='text-muted-foreground'>{t('jobEventLearning.none')}</p>
      ) : (
        <ul className='space-y-2'>
          {data.assignedPath ? (
            <li className='space-y-1'>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant='secondary'>
                  {t('jobEventLearning.assigned')}
                </Badge>
                <Link
                  className='text-primary underline-offset-4 hover:underline'
                  to='/talent/assignments'
                >
                  {data.assignedPath.title}
                </Link>
                {data.assignedPath.dueDate ? (
                  <span className='text-muted-foreground'>
                    {t('jobEventLearning.due', {
                      date: data.assignedPath.dueDate,
                    })}
                  </span>
                ) : null}
              </div>
              {data.assignedPath.completedSteps.length ? (
                <p className='text-muted-foreground'>
                  {t('jobEventLearning.completedSteps', {
                    titles: data.assignedPath.completedSteps.join('、'),
                  })}
                </p>
              ) : null}
              {data.assignedPath.attachedSteps.length ? (
                <p className='text-muted-foreground'>
                  {t('jobEventLearning.attachedSteps', {
                    titles: data.assignedPath.attachedSteps.join('、'),
                  })}
                </p>
              ) : null}
            </li>
          ) : null}
          {data.cancelled.map((task) => (
            <li
              key={task.assignmentId}
              className='flex flex-wrap items-center gap-2'
            >
              <Badge variant='outline'>{t('jobEventLearning.cancelled')}</Badge>
              <span>{task.title}</span>
              {task.cancelReason ? (
                <span className='text-muted-foreground'>
                  {t(`jobEventLearning.reason.${task.cancelReason}`)}
                </span>
              ) : null}
            </li>
          ))}
          {data.plans.map((plan) => (
            <li key={plan.id} className='flex flex-wrap items-center gap-2'>
              <Badge variant='outline'>{t('jobEventLearning.plan')}</Badge>
              <Link
                className='text-primary underline-offset-4 hover:underline'
                to={`/talent/learning-plans?plan=${encodeURIComponent(plan.id)}`}
              >
                {t('jobEventLearning.planItems', { count: plan.items })}
              </Link>
              <span className='text-muted-foreground'>
                {t(`jobEventLearning.planStatus.${plan.status}`)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
