import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DownloadIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  QrCodeIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type {
  Enrollment,
  TrainingSession,
  TrainingSessionDetail,
} from '@/components/talent/training-types';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { AttendanceDialog } from './attendance-dialog.js';
import { CheckInCodeDialog } from './check-in-code-dialog.js';
import { EnrollOthers } from './enroll-others.js';
import { SessionDialog } from './session-dialog.js';

const STATUS_VARIANT: Record<
  string,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  scheduled: 'default',
  completed: 'secondary',
  cancelled: 'outline',
  enrolled: 'outline',
  attended: 'secondary',
  absent: 'destructive',
};

function useSessionTime(): (value: string, withDate?: boolean) => string {
  const { locale } = useLocale();
  return (value, withDate = true) =>
    new Intl.DateTimeFormat(locale, {
      ...(withDate
        ? { month: 'numeric', day: 'numeric', weekday: 'short' }
        : {}),
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(value));
}

/**
 * 线下班次 — sessions of offline courses as a list or a month calendar. A
 * session opens in a side sheet with its enrollment list, the rotating
 * check-in QR code, manual attendance with a reason, and the attendance sheet.
 */
export default function SessionsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'calendar' ? 'calendar' : 'list';
  const sessions = useRemote<TrainingSession[]>('talent/sessions');
  const canManage = useCan({
    resource: { type: 'composite', id: 'talent.trainingSession' },
    action: 'manage',
  });
  const [creating, setCreating] = useState(false);
  const openId = params.get('session');

  function setParam(key: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentSessions')}
        description={t('talent.sessions.description')}
        actions={
          canManage.can ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.sessions.create')}
            </Button>
          ) : null
        }
      />
      <ToggleGroup
        variant='outline'
        size='sm'
        spacing={0}
        className='self-start'
        value={[view]}
        onValueChange={(value: string[]) => {
          const selected = value[0];
          if (selected)
            setParam('view', selected === 'calendar' ? 'calendar' : null);
        }}
        aria-label={t('talent.sessions.view')}
      >
        <ToggleGroupItem value='list'>
          <ListIcon data-icon='inline-start' />
          {t('talent.sessions.listView')}
        </ToggleGroupItem>
        <ToggleGroupItem value='calendar'>
          <CalendarDaysIcon data-icon='inline-start' />
          {t('talent.sessions.calendarView')}
        </ToggleGroupItem>
      </ToggleGroup>
      {sessions.error ? (
        <LoadError error={sessions.error} onRetry={sessions.reload} />
      ) : !sessions.data ? (
        <BlockSkeleton rows={5} />
      ) : !sessions.data.length ? (
        <EmptyState
          title={t('talent.sessions.empty')}
          description={t('talent.sessions.emptyDescription')}
        />
      ) : view === 'calendar' ? (
        <MonthCalendar
          sessions={sessions.data}
          onOpen={(id) => setParam('session', id)}
        />
      ) : (
        <SessionTable
          sessions={sessions.data}
          onOpen={(id) => setParam('session', id)}
        />
      )}
      <SessionSheet
        id={openId}
        onClose={() => setParam('session', null)}
        onChanged={sessions.reload}
      />
      <SessionDialog
        open={creating}
        onOpenChange={setCreating}
        onSaved={(session) => {
          sessions.reload();
          setParam('session', session.id);
        }}
      />
    </PageContainer>
  );
}

function SessionTable({
  sessions,
  onOpen,
}: {
  sessions: TrainingSession[];
  onOpen: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const time = useSessionTime();
  return (
    <Card>
      <CardContent className='px-0'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('talent.sessions.fields.course')}</TableHead>
              <TableHead>{t('talent.sessions.fields.time')}</TableHead>
              <TableHead className='hidden md:table-cell'>
                {t('talent.sessions.fields.location')}
              </TableHead>
              <TableHead className='hidden md:table-cell'>
                {t('talent.sessions.fields.instructor')}
              </TableHead>
              <TableHead>{t('talent.sessions.fields.enrolled')}</TableHead>
              <TableHead>{t('talent.sessions.fields.status')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessions.map((session) => (
              <TableRow
                key={session.id}
                className='cursor-pointer'
                onClick={() => onOpen(session.id)}
              >
                <TableCell>
                  <button
                    type='button'
                    className='text-left font-medium hover:underline'
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(session.id);
                    }}
                  >
                    {session.title}
                  </button>
                </TableCell>
                <TableCell className='tabular-nums'>
                  {time(session.startAt)} – {time(session.endAt, false)}
                </TableCell>
                <TableCell className='hidden md:table-cell'>
                  {session.location}
                </TableCell>
                <TableCell className='hidden md:table-cell'>
                  {session.instructorName}
                </TableCell>
                <TableCell className='tabular-nums'>
                  {session.enrolledCount} / {session.capacity}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[session.status] ?? 'outline'}>
                    {t(`talent.sessions.status.${session.status}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function MonthCalendar({
  sessions,
  onOpen,
}: {
  sessions: TrainingSession[];
  onOpen: (id: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const time = useSessionTime();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const days = useMemo(() => {
    // Weeks start on Monday.
    const start = new Date(month);
    start.setDate(1 - ((month.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }, [month]);
  const key = (date: Date) =>
    `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const byDay = useMemo(() => {
    const map = new Map<string, TrainingSession[]>();
    for (const session of sessions) {
      const k = key(new Date(session.startAt));
      map.set(k, [...(map.get(k) ?? []), session]);
    }
    return map;
  }, [sessions]);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  const today = key(new Date());
  return (
    <Card>
      <CardContent className='space-y-3'>
        <div className='flex items-center justify-between'>
          <Button
            variant='outline'
            size='icon'
            aria-label={t('talent.sessions.previousMonth')}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))
            }
          >
            <ChevronLeftIcon />
          </Button>
          <p className='font-heading font-semibold'>
            {new Intl.DateTimeFormat(locale, {
              year: 'numeric',
              month: 'long',
            }).format(month)}
          </p>
          <Button
            variant='outline'
            size='icon'
            aria-label={t('talent.sessions.nextMonth')}
            onClick={() =>
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))
            }
          >
            <ChevronRightIcon />
          </Button>
        </div>
        <div className='grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs'>
          {days.slice(0, 7).map((day) => (
            <div
              key={`h-${day.getDay()}`}
              className='bg-muted/50 px-2 py-1 text-center text-muted-foreground'
            >
              {weekday.format(day)}
            </div>
          ))}
          {days.map((day) => {
            const items = byDay.get(key(day)) ?? [];
            const inMonth = day.getMonth() === month.getMonth();
            return (
              <div
                key={key(day)}
                className={cn(
                  'min-h-20 space-y-1 bg-background p-1',
                  !inMonth && 'bg-muted/30 text-muted-foreground',
                )}
              >
                <span
                  className={cn(
                    'inline-flex size-5 items-center justify-center rounded-full tabular-nums',
                    key(day) === today && 'bg-primary text-primary-foreground',
                  )}
                >
                  {day.getDate()}
                </span>
                {items.map((session) => (
                  <button
                    key={session.id}
                    type='button'
                    onClick={() => onOpen(session.id)}
                    className={cn(
                      'block w-full truncate rounded bg-primary/10 px-1 py-0.5 text-left text-primary hover:bg-primary/20',
                      session.status === 'cancelled' &&
                        'bg-muted text-muted-foreground line-through',
                    )}
                    title={session.title}
                  >
                    {time(session.startAt, false)} {session.courseTitle}
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function SessionSheet({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const time = useSessionTime();
  const detail = useRemote<TrainingSessionDetail>(
    id ? `talent/sessions/${encodeURIComponent(id)}` : null,
  );
  const [showCode, setShowCode] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [marking, setMarking] = useState<Enrollment | null>(null);
  const session = detail.data;
  // The time the sheet was opened; enough to tell whether a session has started.
  const [openedAt] = useState(() => Date.now());
  const started = session
    ? openedAt >= new Date(session.startAt).getTime()
    : false;
  const refresh = () => {
    detail.reload();
    onChanged();
  };

  async function cancelSession(): Promise<void> {
    if (!session) return;
    try {
      await api.request({
        path: `talent/sessions/${encodeURIComponent(session.id)}/cancel`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('talent.sessions.cancelled') });
      refresh();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setCancelling(false);
    }
  }

  async function unenroll(enrollment: Enrollment): Promise<void> {
    if (!session) return;
    try {
      await api.request({
        path: `talent/sessions/${encodeURIComponent(session.id)}/unenroll`,
        method: 'POST',
        json: { employeeId: enrollment.employeeId },
      });
      refresh();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(open) => (!open ? onClose() : undefined)}
    >
      <SheetContent className='w-full overflow-y-auto sm:max-w-2xl'>
        <SheetHeader>
          <SheetTitle>
            {session?.title ?? t('talent.sessions.detail')}
          </SheetTitle>
          {session ? (
            <SheetDescription>
              {time(session.startAt)} – {time(session.endAt, false)} ·{' '}
              {session.location} · {session.instructorName}
            </SheetDescription>
          ) : null}
        </SheetHeader>
        <div className='space-y-4 px-4 pb-6'>
          {detail.error ? (
            <LoadError error={detail.error} onRetry={detail.reload} />
          ) : !session ? (
            <BlockSkeleton rows={4} />
          ) : (
            <>
              <div className='flex flex-wrap items-center gap-2'>
                <Badge variant={STATUS_VARIANT[session.status] ?? 'outline'}>
                  {t(`talent.sessions.status.${session.status}`)}
                </Badge>
                <span className='text-sm text-muted-foreground tabular-nums'>
                  {t('talent.sessions.enrolledOf', {
                    enrolled: session.enrolledCount,
                    capacity: session.capacity,
                  })}
                  {session.status === 'completed'
                    ? ` · ${t('talent.sessions.attendance', {
                        attended: session.attendedCount,
                        absent: session.absentCount,
                      })}`
                    : ''}
                </span>
              </div>
              <div className='flex flex-wrap gap-2'>
                {session.status === 'scheduled' &&
                session.can.markAttendance ? (
                  <Button onClick={() => setShowCode(true)}>
                    <QrCodeIcon data-icon='inline-start' />
                    {t('talent.sessions.checkInCode')}
                  </Button>
                ) : null}
                {session.can.export ? (
                  <Button
                    variant='outline'
                    onClick={() =>
                      void downloadFile(
                        api,
                        `talent/sessions/${encodeURIComponent(session.id)}/export`,
                        `${session.title}-签到表.xlsx`,
                      ).catch((cause: unknown) =>
                        toast.add({
                          type: 'error',
                          title: errorMessage(cause, t),
                        }),
                      )
                    }
                  >
                    <DownloadIcon data-icon='inline-start' />
                    {t('talent.sessions.export')}
                  </Button>
                ) : null}
                {session.status === 'scheduled' && session.can.manage ? (
                  <>
                    <Button variant='outline' onClick={() => setEditing(true)}>
                      <PencilIcon data-icon='inline-start' />
                      {t('talent.sessions.edit')}
                    </Button>
                    <Button
                      variant='outline'
                      onClick={() => setCancelling(true)}
                    >
                      {t('talent.sessions.cancel')}
                    </Button>
                  </>
                ) : null}
              </div>
              {session.status === 'scheduled' && session.can.enroll ? (
                <EnrollOthers session={session} onEnrolled={refresh} />
              ) : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('talent.sessions.fields.name')}</TableHead>
                    <TableHead className='hidden sm:table-cell'>
                      {t('talent.sessions.fields.department')}
                    </TableHead>
                    <TableHead>{t('talent.sessions.fields.status')}</TableHead>
                    <TableHead>
                      {t('talent.sessions.fields.checkedInAt')}
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {session.enrollments
                    .filter((e) => e.status !== 'cancelled')
                    .map((enrollment) => (
                      <TableRow key={enrollment.id}>
                        <TableCell>
                          {enrollment.name}
                          <span className='block text-xs text-muted-foreground'>
                            {enrollment.employeeNo}
                          </span>
                        </TableCell>
                        <TableCell className='hidden sm:table-cell'>
                          {enrollment.departmentTitle}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              STATUS_VARIANT[enrollment.status] ?? 'outline'
                            }
                          >
                            {t(
                              `talent.sessions.enrollmentStatus.${enrollment.status}`,
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell className='text-xs tabular-nums'>
                          {enrollment.checkedInAt
                            ? time(enrollment.checkedInAt, false)
                            : '—'}
                          {enrollment.checkInMethod ? (
                            <span className='block text-muted-foreground'>
                              {t(
                                `talent.sessions.method.${enrollment.checkInMethod}`,
                              )}
                              {enrollment.markReason
                                ? `：${enrollment.markReason}`
                                : ''}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className='text-right'>
                          {session.can.markAttendance &&
                          started &&
                          session.status !== 'cancelled' ? (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() => setMarking(enrollment)}
                            >
                              {t('talent.sessions.mark')}
                            </Button>
                          ) : session.status === 'scheduled' &&
                            session.can.enroll &&
                            enrollment.status === 'enrolled' ? (
                            <Button
                              size='sm'
                              variant='ghost'
                              onClick={() => void unenroll(enrollment)}
                            >
                              {t('talent.sessions.unenroll')}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
              {!session.enrollments.some((e) => e.status !== 'cancelled') ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.sessions.noEnrollments')}
                </p>
              ) : null}
              <CheckInCodeDialog
                session={session}
                open={showCode}
                onOpenChange={setShowCode}
                onClosed={refresh}
              />
              <SessionDialog
                open={editing}
                session={session}
                onOpenChange={setEditing}
                onSaved={refresh}
              />
              <AttendanceDialog
                session={session}
                enrollment={marking}
                onOpenChange={(open) => (!open ? setMarking(null) : undefined)}
                onSaved={refresh}
              />
              <AlertDialog open={cancelling} onOpenChange={setCancelling}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('talent.sessions.cancelTitle')}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('talent.sessions.cancelDescription', {
                        count: session.enrolledCount,
                      })}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      variant='destructive'
                      onClick={() => void cancelSession()}
                    >
                      {t('talent.sessions.cancel')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
