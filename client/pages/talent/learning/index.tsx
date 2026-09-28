import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CalendarIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ClipboardCheckIcon,
  LockIcon,
  MapPinIcon,
  MessagesSquareIcon,
  RouteIcon,
  SparklesIcon,
  UsersIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssignmentStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type { Assignment } from '@/components/talent/learning-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type {
  Practice,
  PracticeSummary,
  PathTimeline,
  TrainingSession,
} from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import type { LearningOutletContext } from './types.js';

const GROUPS = ['inProgress', 'notStarted', 'overdue', 'completed'] as const;

function useDate(): (value: string | null) => string {
  const { locale } = useLocale();
  return (value) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
          new Date(value.length === 10 ? `${value}T00:00:00` : value),
        )
      : '';
}

function useDateTime(): (value: string) => string {
  const { locale } = useLocale();
  return (value) =>
    new Intl.DateTimeFormat(locale, {
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
}

/**
 * 我的学习 — learning paths as step timelines, then the other tasks grouped by
 * status. An offline course lists the sessions to enroll in; a practice task
 * starts a conversation with the practice coach; recommendations can be ignored.
 */
export default function MyLearningPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<Assignment[]>('talent/learning/assignments');
  const paths = useRemote<PathTimeline[]>('talent/learning/paths');
  const offerings = useRemote<Record<string, TrainingSession[]>>(
    'talent/learning/offerings',
  );
  const practice = useRemote<Record<string, PracticeSummary>>(
    'talent/learning/practice-summary',
  );
  const reload = useMemo(
    () => () => {
      list.reload();
      paths.reload();
      offerings.reload();
      practice.reload();
    },
    [list, paths, offerings, practice],
  );
  const context = useMemo<LearningOutletContext>(() => ({ reload }), [reload]);
  const byId = useMemo(
    () => new Map((list.data ?? []).map((a) => [a.id, a])),
    [list.data],
  );
  // Path steps show in their timeline, recommendations in their own section.
  const standalone = (list.data ?? []).filter(
    (a) => !a.parentAssignmentId && a.kind !== 'path' && !a.optional,
  );
  const recommended = (list.data ?? []).filter(
    (a) => a.optional && a.status !== 'completed' && !a.parentAssignmentId,
  );
  const grouped = useMemo(() => {
    const map = new Map<string, Assignment[]>();
    for (const item of standalone)
      map.set(item.status, [...(map.get(item.status) ?? []), item]);
    return map;
  }, [standalone]);
  const openPaths = (paths.data ?? []).filter((p) => p.status !== 'cancelled');
  const helpers: CardHelpers = {
    offerings: offerings.data ?? {},
    practice: practice.data ?? {},
    reload,
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentMyLearning')}
        description={t('talent.learning.description')}
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.length ? (
        <EmptyState
          title={t('talent.learning.empty')}
          description={t('talent.learning.emptyDescription')}
        />
      ) : (
        <div className='space-y-6'>
          {openPaths.length ? (
            <section className='space-y-3' aria-labelledby='learning-paths'>
              <h2
                id='learning-paths'
                className='flex items-center gap-2 font-heading text-base font-semibold'
              >
                {t('talent.learning.paths')}
                <span className='text-sm font-normal text-muted-foreground'>
                  {openPaths.length}
                </span>
              </h2>
              <div className='grid gap-3 lg:grid-cols-2'>
                {openPaths.map((timeline) => (
                  <PathCard
                    key={timeline.assignmentId}
                    timeline={timeline}
                    byId={byId}
                    helpers={helpers}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {GROUPS.map((group) => {
            const items = grouped.get(group) ?? [];
            if (!items.length) return null;
            return (
              <section
                key={group}
                className='space-y-3'
                aria-labelledby={`learning-${group}`}
              >
                <h2
                  id={`learning-${group}`}
                  className='flex items-center gap-2 font-heading text-base font-semibold'
                >
                  {t(`talent.learning.groups.${group}`)}
                  <span className='text-sm font-normal text-muted-foreground'>
                    {items.length}
                  </span>
                </h2>
                <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                  {items.map((item) => (
                    <AssignmentCard
                      key={item.id}
                      item={item}
                      helpers={helpers}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {recommended.length ? (
            <section
              className='space-y-3'
              aria-labelledby='learning-recommended'
            >
              <h2
                id='learning-recommended'
                className='flex items-center gap-2 font-heading text-base font-semibold'
              >
                <SparklesIcon className='size-4 text-primary' />
                {t('talent.learning.recommended')}
              </h2>
              <p className='text-sm text-muted-foreground'>
                {t('talent.learning.recommendedHint')}
              </p>
              <div className='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
                {recommended.map((item) => (
                  <AssignmentCard key={item.id} item={item} helpers={helpers} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

interface CardHelpers {
  readonly offerings: Record<string, TrainingSession[]>;
  readonly practice: Record<string, PracticeSummary>;
  readonly reload: () => void;
}

function PathCard({
  timeline,
  byId,
  helpers,
}: {
  timeline: PathTimeline;
  byId: Map<string, Assignment>;
  helpers: CardHelpers;
}): ReactElement {
  const { t } = useTranslation();
  const formatDate = useDate();
  const next = timeline.steps.find(
    (s) => s.status !== 'completed' && s.status !== 'locked',
  );
  const [open, setOpen] = useState(timeline.status !== 'completed');
  return (
    <Card>
      <CardHeader className='space-y-2'>
        <div className='flex items-start justify-between gap-2'>
          <CardTitle className='flex items-center gap-2'>
            <RouteIcon className='size-4 text-primary' />
            {timeline.title}
          </CardTitle>
          <AssignmentStatusBadge status={timeline.status} />
        </div>
        <div className='space-y-1'>
          <Progress
            value={timeline.progress}
            aria-label={t('talent.learning.progress')}
          />
          <p className='flex flex-wrap justify-between gap-2 text-xs text-muted-foreground tabular-nums'>
            <span>
              {t('talent.learning.progressValue', { value: timeline.progress })}
            </span>
            {timeline.dueDate ? (
              <span>
                {t('talent.learning.due', {
                  date: formatDate(timeline.dueDate),
                })}
              </span>
            ) : null}
          </p>
        </div>
        {next ? (
          <p className='text-sm'>
            {t('talent.learning.nextStep', { title: next.step.targetTitle })}
          </p>
        ) : null}
      </CardHeader>
      <CardContent>
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger
            render={
              <Button variant='ghost' size='sm' className='-ml-2'>
                <ChevronDownIcon
                  data-icon='inline-start'
                  className={cn('transition-transform', !open && '-rotate-90')}
                />
                {t('talent.learning.steps')}
              </Button>
            }
          />
          <CollapsibleContent>
            <ol className='mt-2 space-y-3 border-l pl-4'>
              {timeline.steps.map((entry, index) => {
                const assignment = entry.assignmentId
                  ? byId.get(entry.assignmentId)
                  : undefined;
                const locked = entry.status === 'locked';
                return (
                  <li key={entry.step.id} className='relative space-y-1.5'>
                    <span
                      className={cn(
                        'absolute top-1 -left-[1.4rem] flex size-3 items-center justify-center rounded-full border bg-background',
                        entry.status === 'completed' &&
                          'border-primary bg-primary',
                      )}
                      aria-hidden
                    />
                    <div className='flex flex-wrap items-center justify-between gap-2'>
                      <span className='flex items-center gap-1.5 text-sm font-medium'>
                        {entry.status === 'completed' ? (
                          <CheckCircle2Icon className='size-4 text-primary' />
                        ) : locked ? (
                          <LockIcon className='size-4 text-muted-foreground' />
                        ) : null}
                        {index + 1}. {entry.step.targetTitle}
                        <Badge variant='outline'>
                          {t(
                            `talent.paths.stepTypes.${stepKind(entry.step.stepType, entry.step.deliveryMode)}`,
                          )}
                        </Badge>
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {entry.dueDate
                          ? t('talent.learning.due', {
                              date: formatDate(entry.dueDate),
                            })
                          : null}
                      </span>
                    </div>
                    {locked ? (
                      <p className='text-xs text-muted-foreground'>
                        {t('talent.learning.lockedHint')}
                      </p>
                    ) : entry.status === 'completed' ||
                      entry.status === 'cancelled' ||
                      !assignment ? null : (
                      <StepAction assignment={assignment} helpers={helpers} />
                    )}
                  </li>
                );
              })}
            </ol>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function stepKind(
  type: string,
  deliveryMode: 'online' | 'offline' | null,
): string {
  return type === 'course' && deliveryMode === 'offline' ? 'offline' : type;
}

/** What to do next for one open task: open the course, enroll in a session, start the practice, take the exam. */
function StepAction({
  assignment,
  helpers,
}: {
  assignment: Assignment;
  helpers: CardHelpers;
}): ReactElement {
  const { t } = useTranslation();
  if (assignment.kind === 'course' && assignment.deliveryMode === 'offline')
    return (
      <SessionPicker
        courseId={assignment.courseId ?? ''}
        sessions={helpers.offerings[assignment.courseId ?? ''] ?? []}
        onChanged={helpers.reload}
      />
    );
  if (assignment.kind === 'practice')
    return (
      <PracticeAction
        assignment={assignment}
        summary={helpers.practice[assignment.practiceScenarioId ?? '']}
      />
    );
  return (
    <Button
      size='sm'
      variant='outline'
      render={
        <Link
          to={
            assignment.kind === 'exam'
              ? '/talent/my-exams'
              : `/talent/learning/${encodeURIComponent(assignment.courseId ?? '')}`
          }
        />
      }
    >
      {assignment.kind === 'exam'
        ? t('talent.learning.takeExam')
        : t('talent.learning.openCourse')}
    </Button>
  );
}

function SessionPicker({
  courseId,
  sessions,
  onChanged,
}: {
  courseId: string;
  sessions: TrainingSession[];
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const formatDateTime = useDateTime();
  const [busy, setBusy] = useState<string | null>(null);
  const enrolled = sessions.find((s) => s.myEnrollment?.status === 'enrolled');

  async function act(session: TrainingSession, action: 'enroll' | 'unenroll') {
    setBusy(session.id);
    try {
      await api.request({
        path: `talent/sessions/${encodeURIComponent(session.id)}/${action}`,
        method: 'POST',
        json: {},
      });
      toast.add({
        type: 'success',
        title:
          action === 'enroll'
            ? t('talent.sessions.enrolled', { title: session.title })
            : t('talent.sessions.unenrolled'),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  if (!sessions.length)
    return (
      <p className='text-xs text-muted-foreground' data-course={courseId}>
        {t('talent.sessions.noneOpen')}
      </p>
    );
  return (
    <div className='space-y-2'>
      {enrolled ? (
        <p className='text-xs text-muted-foreground'>
          {t('talent.sessions.checkInHint')}
        </p>
      ) : null}
      <ul className='space-y-2'>
        {sessions.map((session) => {
          const mine = session.myEnrollment?.status === 'enrolled';
          return (
            <li
              key={session.id}
              className={cn(
                'flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm',
                mine && 'border-primary/50 bg-primary/5',
              )}
            >
              <span className='space-y-0.5'>
                <span className='block font-medium'>
                  {formatDateTime(session.startAt)}
                </span>
                <span className='flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground'>
                  <span className='inline-flex items-center gap-1'>
                    <MapPinIcon className='size-3' />
                    {session.location}
                  </span>
                  <span className='inline-flex items-center gap-1'>
                    <UsersIcon className='size-3' />
                    {t('talent.sessions.remaining', {
                      count: session.remaining,
                    })}
                  </span>
                </span>
              </span>
              {mine ? (
                <Button
                  size='sm'
                  variant='ghost'
                  disabled={busy !== null}
                  onClick={() => void act(session, 'unenroll')}
                >
                  {t('talent.sessions.unenroll')}
                </Button>
              ) : (
                <Button
                  size='sm'
                  variant={enrolled ? 'outline' : 'default'}
                  disabled={busy !== null || session.remaining <= 0}
                  onClick={() => void act(session, 'enroll')}
                >
                  {enrolled
                    ? t('talent.sessions.reschedule')
                    : t('talent.sessions.enroll')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function PracticeAction({
  assignment,
  summary,
}: {
  assignment: Assignment;
  summary: PracticeSummary | undefined;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function start(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.request<{ data: Practice }>({
        path: 'talent/practice',
        method: 'POST',
        json: {
          scenarioId: assignment.practiceScenarioId,
          assignmentId: assignment.id,
        },
      });
      await navigate(`/talent/practice/${encodeURIComponent(result.data.id)}`);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-1.5'>
      {summary?.best !== null && summary?.best !== undefined ? (
        <p className='text-xs text-muted-foreground'>
          {t('talent.practice.best', { score: summary.best })}
          {summary.lastFeedback
            ? ` · ${summary.lastFeedback.slice(0, 60)}…`
            : ''}
        </p>
      ) : null}
      <Button size='sm' disabled={busy} onClick={() => void start()}>
        <MessagesSquareIcon data-icon='inline-start' />
        {summary?.openPracticeId
          ? t('talent.practice.continue')
          : summary?.count
            ? t('talent.practice.again')
            : t('talent.practice.start')}
      </Button>
    </div>
  );
}

function AssignmentCard({
  item,
  helpers,
}: {
  item: Assignment;
  helpers: CardHelpers;
}): ReactElement {
  const { t } = useTranslation();
  const formatDate = useDate();
  const overdue = item.status === 'overdue';
  const interactive =
    (item.kind === 'course' && item.deliveryMode === 'offline') ||
    item.kind === 'practice';
  const icon =
    item.kind === 'exam' ? (
      <ClipboardCheckIcon className='size-4 text-primary' />
    ) : item.kind === 'practice' ? (
      <MessagesSquareIcon className='size-4 text-primary' />
    ) : item.deliveryMode === 'offline' ? (
      <UsersIcon className='size-4 text-primary' />
    ) : (
      <BookOpenIcon className='size-4 text-primary' />
    );
  const body = (
    <Card
      className={cn(
        'h-full',
        !interactive && 'transition-colors group-hover:bg-muted/40',
        overdue && 'border-destructive/50',
      )}
    >
      <CardContent className='space-y-3'>
        <div className='flex items-start justify-between gap-2'>
          <span className='flex items-center gap-2 font-medium'>
            {icon}
            {item.targetTitle}
          </span>
          {item.optional ? (
            <Badge variant='outline'>{t('talent.learning.optional')}</Badge>
          ) : (
            <AssignmentStatusBadge status={item.status} />
          )}
        </div>
        {item.kind === 'course' && item.deliveryMode !== 'offline' ? (
          <div className='space-y-1'>
            <Progress
              value={item.progress}
              aria-label={t('talent.learning.progress')}
            />
            <p className='text-xs text-muted-foreground tabular-nums'>
              {t('talent.learning.progressValue', { value: item.progress })}
            </p>
          </div>
        ) : null}
        {interactive && item.status !== 'completed' ? (
          <StepAction assignment={item} helpers={helpers} />
        ) : null}
        <p
          className={cn(
            'flex items-center gap-1.5 text-xs text-muted-foreground',
            overdue && 'font-medium text-destructive',
          )}
        >
          {overdue ? (
            <AlertTriangleIcon className='size-3.5' />
          ) : (
            <CalendarIcon className='size-3.5' />
          )}
          {item.dueDate
            ? t('talent.learning.due', { date: formatDate(item.dueDate) })
            : t('talent.learning.noDue')}
        </p>
      </CardContent>
    </Card>
  );
  if (interactive) return body;
  const to =
    item.kind === 'exam'
      ? '/talent/my-exams'
      : `/talent/learning/${encodeURIComponent(item.courseId ?? '')}`;
  return (
    <Link
      to={to}
      className='group block rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
    >
      {body}
    </Link>
  );
}
