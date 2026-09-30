import { useTranslation } from '@nocobase/i18n/client';
import { MoonIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import {
  addDays,
  monthDates,
  today,
  weekdayIndex,
  weekdayLabel,
} from '@/components/talent/attendance/dates';
import type { MySchedule } from '@/components/talent/attendance/types';
import { cn } from '@/lib/utils';

/** A known Monday, for the weekday headers. */
const MONDAY = '2024-01-01';

/**
 * 我的排班: the month as a Monday-first calendar. Each day shows its
 * published shift (title, and the time from `sm` up), a night marker, or 休息.
 * Days without a published schedule stay empty. Seven columns fit 375px.
 */
export function ScheduleCalendar({
  month,
  schedules,
}: {
  month: string;
  schedules: MySchedule[];
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const dates = monthDates(month);
  const byDate = new Map(schedules.map((s) => [s.date, s]));
  const lead = weekdayIndex(dates[0]);
  const now = today(zone);
  return (
    <div className='grid gap-1'>
      <div className='grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground'>
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i}>{weekdayLabel(addDays(MONDAY, i), i18n.language)}</span>
        ))}
      </div>
      <ol className='grid grid-cols-7 gap-1'>
        {Array.from({ length: lead }, (_, i) => (
          <li key={`lead-${i}`} aria-hidden='true' />
        ))}
        {dates.map((date) => {
          const cell = byDate.get(date);
          const rest = cell && !cell.shiftId;
          return (
            <li
              key={date}
              aria-label={
                cell
                  ? rest
                    ? t('attendance.my.calendar.restOn', { date })
                    : t('attendance.my.calendar.shiftOn', {
                        date,
                        shift: cell.title ?? '',
                        time: `${cell.startTime ?? ''}–${cell.endTime ?? ''}`,
                      })
                  : t('attendance.my.calendar.noneOn', { date })
              }
              className={cn(
                'flex min-h-14 min-w-0 flex-col gap-0.5 rounded-md border p-1 text-xs sm:min-h-20 sm:p-1.5',
                rest && 'bg-muted/60 text-muted-foreground',
                date === now && 'ring-2 ring-ring/60',
              )}
            >
              <span className='flex items-center justify-between gap-1 font-medium tabular-nums'>
                {Number(date.slice(8))}
                {cell?.isNight ? (
                  <MoonIcon
                    className='size-3 text-muted-foreground'
                    aria-hidden='true'
                  />
                ) : null}
              </span>
              {cell ? (
                rest ? (
                  <span>{t('attendance.shifts.rest')}</span>
                ) : (
                  <>
                    <span className='truncate' title={cell.title ?? ''}>
                      {cell.title}
                    </span>
                    <span className='hidden text-muted-foreground sm:block'>
                      {cell.startTime}–{cell.endTime}
                    </span>
                  </>
                )
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
