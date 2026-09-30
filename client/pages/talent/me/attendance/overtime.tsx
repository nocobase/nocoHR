import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import {
  addDays,
  isDate,
  localInstant,
  today,
} from '@/components/talent/attendance/dates';
import type { MyAttendance } from '@/components/talent/attendance/types';
import { useRemote } from '@/components/talent/use-remote';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

import { AdjustmentRequestDialog } from './request-dialog.js';
import { shiftLine } from './shift-line.js';

const TIME = /^\d{2}:\d{2}$/u;

/**
 * 加班 (`/talent/me/attendance/overtime`): the day and the hours worked. An
 * end time at or before the start is the next morning. The server counts
 * the hours and decides 工作日 / 休息日 / 节假日 from the calendar.
 */
export default function OvertimePage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const [date, setDate] = useState(() => today(zone));
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const month = isDate(date) ? date.slice(0, 7) : undefined;
  const mine = useRemote<MyAttendance>(month ? 'talent/attendance/me' : null, {
    month,
  });
  const cell = mine.data?.schedules.find((s) => s.date === date);
  const complete = isDate(date) && TIME.test(start) && TIME.test(end);
  const overnight = complete && end <= start;
  const startAt = complete ? localInstant(date, start, zone) : '';
  const endAt = complete
    ? localInstant(overnight ? addDays(date, 1) : date, end, zone)
    : '';
  const hours = complete
    ? Math.round(
        ((Date.parse(endAt) - Date.parse(startAt)) / 3_600_000) * 100,
      ) / 100
    : null;
  return (
    <AdjustmentRequestDialog
      type='overtime'
      build={() =>
        complete && hours && hours > 0 && hours <= 24
          ? { type: 'overtime', date, details: { startAt, endAt } }
          : null
      }
    >
      <Field>
        <FieldLabel htmlFor='overtime-date'>
          {t('attendance.adjustments.fields.date')} *
        </FieldLabel>
        <Input
          id='overtime-date'
          type='date'
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <FieldDescription>{shiftLine(cell, t)}</FieldDescription>
      </Field>
      <div className='grid gap-4 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='overtime-start'>
            {t('attendance.adjustments.fields.startTime')} *
          </FieldLabel>
          <Input
            id='overtime-start'
            type='time'
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='overtime-end'>
            {t('attendance.adjustments.fields.endTime')} *
          </FieldLabel>
          <Input
            id='overtime-end'
            type='time'
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </Field>
      </div>
      {hours !== null ? (
        <p className='text-sm text-muted-foreground'>
          {overnight
            ? t('attendance.my.dialogs.overtimeOvernight', { hours })
            : t('attendance.my.dialogs.overtimeHours', { hours })}
        </p>
      ) : null}
    </AdjustmentRequestDialog>
  );
}
