import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowLeftRightIcon,
  CalendarPlusIcon,
  ClockIcon,
  FingerprintIcon,
  MessageSquareTextIcon,
} from 'lucide-react';
import {
  useEffect,
  useReducer,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { currentMonth, isMonth } from '@/components/talent/attendance/dates';
import type {
  Adjustment,
  MyAttendance,
} from '@/components/talent/attendance/types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { MyLeaveBalances } from '../leave-balances.js';
import { MyLeaveRequests, type OwnLeaveRequest } from '../leave-requests.js';
import { ScheduleCalendar } from './calendar.js';
import { MyRecords } from './records.js';
import { MyAdjustments, SwapConsents } from './requests.js';
import { MySummary } from './summary.js';

/** Where `?action=` (the 自助 cards) opens each request dialog. */
const ACTIONS: Record<string, string> = {
  leave: 'leave/new',
  missingPunch: 'attendance/missing-punch',
  overtime: 'attendance/overtime',
  shiftSwap: 'attendance/shift-swap',
  exception: 'attendance/exception',
};

const can = (id: string, action: string) => ({
  resource: { type: 'composite', id },
  action,
});

function Block({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className='grid min-w-0 gap-3'>
      <h3 className='text-sm font-semibold'>{title}</h3>
      {children}
    </section>
  );
}

/**
 * 我的档案 · 考勤与假期 (`/talent/me#attendance`): the month picked in
 * `?month=`, my published schedule, my computed days, the monthly summary to
 * confirm or object to, my leave, and 补卡 / 加班 / 调班 / 考勤异常说明
 * requests (with the HR assistant's drafts to submit). The
 * request dialogs are child routes under `/talent/me/`; `?action=` opens one
 * directly.
 */
export function MyAttendanceSection({
  employeeId,
  leaveRevision,
}: {
  employeeId: string;
  leaveRevision: number;
}): ReactElement | null {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const month = isMonth(params.get('month'))
    ? params.get('month')!
    : currentMonth(zone);
  const canView = useCan(can('talent.attendanceRecord', 'view'));
  const canRequest = useCan(can('talent.adjustment', 'request'));
  const canLeave = useCan(can('talent.leaveRequest', 'request'));
  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  const refresh = `${location.key}|${revision}`;
  const viewAllowed = canView.can && !canView.isPending;
  const requestAllowed = canRequest.can && !canRequest.isPending;
  const leaveAllowed = canLeave.can && !canLeave.isPending && !canLeave.error;
  const mine = useRemote<MyAttendance>(
    viewAllowed ? 'talent/attendance/me' : null,
    { month, refresh },
  );
  const requests = useRemote<Adjustment[]>(
    requestAllowed ? 'talent/adjustments' : null,
    { view: 'mine', refresh },
  );
  const consents = useRemote<Adjustment[]>(
    requestAllowed ? 'talent/adjustments' : null,
    { view: 'todo', type: 'shiftSwap', refresh },
  );
  // Closing a child request form keeps this section mounted: reload on navigation.
  const leaveRequests = useRemote<OwnLeaveRequest[]>(
    leaveAllowed ? 'talent/leave/requests' : null,
    { employeeId, refresh: location.key, revision: leaveRevision },
  );

  const action = params.get('action');
  useEffect(() => {
    const target = action ? ACTIONS[action] : undefined;
    if (!target) return;
    const next = new URLSearchParams(location.search);
    next.delete('action');
    const search = next.toString();
    // The dialog closes back to `/talent/me`, so `action` must not survive the redirect.
    void navigate(
      { pathname: target, search: search ? `?${search}` : '' },
      { replace: true },
    );
  }, [action, location.search, navigate]);

  const ready = !viewAllowed || Boolean(mine.data || mine.error);
  useEffect(() => {
    if (location.hash !== '#attendance' || !ready) return;
    window.document
      .getElementById('attendance')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [location.hash, ready]);

  if (
    canView.isPending ||
    canRequest.isPending ||
    canLeave.isPending ||
    (!viewAllowed && !requestAllowed && !leaveAllowed)
  )
    return null;

  const setMonth = (value: string) => {
    const next = new URLSearchParams(location.search);
    next.set('month', value);
    void navigate(
      { search: `?${next.toString()}`, hash: '#attendance' },
      { replace: true },
    );
  };
  const reload = () => bump();
  const used = mine.data?.missingPunchUsed;
  const limit = mine.data?.missingPunchLimit;

  return (
    <Card id='attendance' className='min-w-0 scroll-mt-4'>
      <CardHeader className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
        <div className='min-w-0'>
          <CardTitle>{t('attendance.mine.title')}</CardTitle>
          <CardDescription>{t('attendance.my.description')}</CardDescription>
        </div>
        <div className='grid gap-1'>
          <Label htmlFor='my-attendance-month' className='sr-only'>
            {t('attendance.filters.month')}
          </Label>
          <Input
            id='my-attendance-month'
            type='month'
            className='w-40'
            value={month}
            onChange={(event) =>
              isMonth(event.target.value) && setMonth(event.target.value)
            }
          />
        </div>
      </CardHeader>
      {/* min-w-0 on each child: wide tables scroll inside themselves instead of widening the card on phones. */}
      <CardContent className='grid min-w-0 gap-6 [&>*]:min-w-0'>
        <div className='grid grid-cols-2 gap-2 sm:flex sm:flex-wrap'>
          {leaveAllowed ? (
            <Button nativeButton={false} render={<Link to='leave/new' />}>
              <CalendarPlusIcon data-icon='inline-start' />
              {t('attendance.leave.request')}
            </Button>
          ) : null}
          {requestAllowed ? (
            <>
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='attendance/missing-punch' />}
              >
                <FingerprintIcon data-icon='inline-start' />
                {t('attendance.adjustments.types.missingPunch')}
              </Button>
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='attendance/overtime' />}
              >
                <ClockIcon data-icon='inline-start' />
                {t('attendance.adjustments.types.overtime')}
              </Button>
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='attendance/shift-swap' />}
              >
                <ArrowLeftRightIcon data-icon='inline-start' />
                {t('attendance.adjustments.types.shiftSwap')}
              </Button>
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to={`attendance/exception?month=${month}`} />}
              >
                <MessageSquareTextIcon data-icon='inline-start' />
                {t('attendanceV2.exception.open')}
              </Button>
            </>
          ) : null}
        </div>
        {requestAllowed && used !== undefined && limit !== undefined ? (
          <p className='text-sm text-muted-foreground'>
            {t('attendance.my.missingPunchUsage', { used, limit })}
          </p>
        ) : null}
        {requestAllowed && consents.data?.length ? (
          <Block title={t('attendance.my.consents')}>
            <SwapConsents rows={consents.data} onChanged={reload} />
          </Block>
        ) : null}
        {viewAllowed ? (
          mine.error ? (
            <LoadError error={mine.error} onRetry={mine.reload} />
          ) : !mine.data ? (
            <BlockSkeleton rows={4} />
          ) : (
            <>
              <Block title={t('attendance.my.summary.title', { month })}>
                <MySummary
                  summary={mine.data.summary}
                  confirmationDays={mine.data.confirmationDays}
                  onChanged={reload}
                />
              </Block>
              <Block title={t('attendance.my.schedule')}>
                <ScheduleCalendar
                  month={month}
                  schedules={mine.data.schedules}
                />
              </Block>
              <Block title={t('attendance.my.records')}>
                <MyRecords records={mine.data.records} />
              </Block>
            </>
          )
        ) : null}
        {requestAllowed ? (
          <Block title={t('attendance.my.requests')}>
            {requests.error ? (
              <LoadError error={requests.error} onRetry={requests.reload} />
            ) : !requests.data ? (
              <BlockSkeleton rows={2} />
            ) : (
              <MyAdjustments rows={requests.data} onChanged={reload} />
            )}
          </Block>
        ) : null}
        {leaveAllowed ? (
          <Block title={t('attendance.my.leave')}>
            <MyLeaveBalances revision={leaveRevision} />
            {leaveRequests.error ? (
              <LoadError
                error={leaveRequests.error}
                onRetry={leaveRequests.reload}
              />
            ) : leaveRequests.loading || !leaveRequests.data ? (
              <BlockSkeleton rows={2} />
            ) : (
              <MyLeaveRequests rows={leaveRequests.data} />
            )}
          </Block>
        ) : null}
      </CardContent>
    </Card>
  );
}
