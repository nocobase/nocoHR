import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { FileUpIcon, RefreshCwIcon } from 'lucide-react';
import { useReducer, useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import {
  addDays,
  currentMonth,
  isDate,
  isMonth,
  today,
} from '@/components/talent/attendance/dates';
import { DepartmentSelect } from '@/components/talent/attendance/department-select';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { DailyTab } from './daily.js';
import { IssuesTab } from './issues.js';
import { MonthlyTab } from './monthly.js';
import { RecomputeDialog } from './recompute-dialog.js';
import { TasksMenu } from './tasks-menu.js';

const TABS = ['daily', 'monthly', 'issues'] as const;
type Tab = (typeof TABS)[number];

export interface AttendanceOutletContext {
  reload: () => void;
}

const permission = (action: string) => ({
  resource: { type: 'composite', id: 'talent.attendanceRecord' },
  action,
});

/**
 * 考勤 (V2-05): 日报 / 月报 / 异常 as `?tab=daily|monthly|issues`, with
 * `month`, `from`, `to`, `department` and `status` in the query so the HR
 * assistant's month-end links open the right view. hr.manager reads their
 * scope; importing, recomputing, locking and running tasks are hr.admin's.
 */
export default function AttendancePage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.includes(params.get('tab') as Tab)
    ? (params.get('tab') as Tab)
    : 'daily';
  const month = isMonth(params.get('month'))
    ? params.get('month')!
    : currentMonth(zone);
  const to = isDate(params.get('to')) ? params.get('to')! : today(zone);
  const from =
    isDate(params.get('from')) && params.get('from')! <= to
      ? params.get('from')!
      : addDays(to, -6);
  const departmentId = params.get('department') ?? '';
  const status = params.get('status') ?? '';
  const [revision, bump] = useReducer((n: number) => n + 1, 0);
  const [recomputeOpen, setRecomputeOpen] = useState(false);
  const canImport = useCan(permission('import'));
  const canRecompute = useCan(permission('recompute'));
  const canLock = useCan(permission('lock'));
  const canUnlock = useCan(permission('unlock'));
  const set = (entries: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [name, value] of Object.entries(entries))
      if (value) next.set(name, value);
      else next.delete(name);
    setParams(next, { replace: true });
  };
  const refresh = `${revision}|${location.key}`;
  return (
    <PageContainer>
      <PageHeader
        title={t('attendance.board.title')}
        description={t('attendance.board.description')}
        actions={
          <div className='flex flex-wrap gap-2'>
            {canImport.can ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'import', search: location.search }} />
                }
              >
                <FileUpIcon data-icon='inline-start' />
                {t('attendance.board.import')}
              </Button>
            ) : null}
            {canRecompute.can ? (
              <Button variant='outline' onClick={() => setRecomputeOpen(true)}>
                <RefreshCwIcon data-icon='inline-start' />
                {t('attendance.board.recompute')}
              </Button>
            ) : null}
            {canLock.can ? <TasksMenu onDone={bump} /> : null}
          </div>
        }
      />
      <Tabs
        value={tab}
        onValueChange={(value) => set({ tab: String(value), status: '' })}
      >
        <TabsList>
          {TABS.map((value) => (
            <TabsTrigger key={value} value={value}>
              {t(`attendance.board.tabs.${value}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className='grid gap-3 sm:flex sm:flex-wrap sm:items-end'>
        <Field className='sm:w-64'>
          <FieldLabel htmlFor='attendance-department'>
            {t('attendance.filters.department')}
          </FieldLabel>
          <DepartmentSelect
            id='attendance-department'
            className='w-full'
            value={departmentId}
            emptyLabel={t('attendance.filters.allDepartments')}
            onChange={(value) => set({ department: value })}
          />
        </Field>
        {tab === 'daily' ? (
          <>
            <Field className='sm:w-44'>
              <FieldLabel htmlFor='attendance-from'>
                {t('attendance.filters.from')}
              </FieldLabel>
              <Input
                id='attendance-from'
                type='date'
                value={from}
                max={to}
                onChange={(event) =>
                  isDate(event.target.value) &&
                  set({ from: event.target.value })
                }
              />
            </Field>
            <Field className='sm:w-44'>
              <FieldLabel htmlFor='attendance-to'>
                {t('attendance.filters.to')}
              </FieldLabel>
              <Input
                id='attendance-to'
                type='date'
                value={to}
                min={from}
                onChange={(event) =>
                  isDate(event.target.value) && set({ to: event.target.value })
                }
              />
            </Field>
          </>
        ) : (
          <Field className='sm:w-44'>
            <FieldLabel htmlFor='attendance-month'>
              {t('attendance.filters.month')}
            </FieldLabel>
            <Input
              id='attendance-month'
              type='month'
              value={month}
              onChange={(event) =>
                isMonth(event.target.value) &&
                set({ month: event.target.value })
              }
            />
          </Field>
        )}
      </div>
      {tab === 'daily' ? (
        <DailyTab
          from={from}
          to={to}
          departmentId={departmentId}
          status={status}
          onStatus={(value) => set({ status: value })}
          refresh={refresh}
        />
      ) : tab === 'monthly' ? (
        <MonthlyTab
          month={month}
          departmentId={departmentId}
          status={status}
          onStatus={(value) => set({ status: value })}
          refresh={refresh}
          canLock={Boolean(canLock.can)}
          canUnlock={Boolean(canUnlock.can)}
        />
      ) : (
        <IssuesTab
          month={month}
          departmentId={departmentId}
          refresh={refresh}
        />
      )}
      {recomputeOpen ? (
        <RecomputeDialog
          open={recomputeOpen}
          onOpenChange={setRecomputeOpen}
          initialFrom={tab === 'daily' ? from : `${month}-01`}
          initialTo={tab === 'daily' ? to : today(zone)}
          departmentId={departmentId}
          onDone={bump}
        />
      ) : null}
      <Outlet context={{ reload: bump } satisfies AttendanceOutletContext} />
    </PageContainer>
  );
}
