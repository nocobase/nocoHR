import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import {
  ExcusedBadge,
  RecordStatusBadge,
} from '@/components/talent/attendance/badges';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { clock } from '@/components/talent/attendance/dates';
import type { AttendanceRecord } from '@/components/talent/attendance/types';

/** 我的考勤: each computed day, newest first, with its status and punches. */
export function MyRecords({
  records,
}: {
  records: AttendanceRecord[];
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  if (!records.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('attendance.my.noRecords')}
      </p>
    );
  const rows = [...records].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ul className='divide-y rounded-lg border'>
      {rows.map((row) => (
        <li
          key={row.id}
          className='flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm'
        >
          <span className='flex items-center gap-2'>
            <span className='font-medium tabular-nums'>{row.date}</span>
            <RecordStatusBadge status={row.status} />
            {row.excusedByAdjustmentId ? <ExcusedBadge /> : null}
          </span>
          <span className='text-muted-foreground tabular-nums'>
            {t('attendance.my.punches', {
              in: clock(row.checkIn, i18n.language, zone),
              out: clock(row.checkOut, i18n.language, zone),
            })}
            {row.lateMinutes
              ? ` · ${t('attendance.my.lateBy', { minutes: row.lateMinutes })}`
              : ''}
            {row.earlyMinutes
              ? ` · ${t('attendance.my.earlyBy', { minutes: row.earlyMinutes })}`
              : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
