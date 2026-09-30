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
import { crossesMidnight, shiftLine } from './shift-line.js';

/** 补卡 (`/talent/me/attendance/missing-punch`): the day and the time I actually punched. */
export default function MissingPunchPage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const [date, setDate] = useState(() => today(zone));
  const [time, setTime] = useState('');
  const month = isDate(date) ? date.slice(0, 7) : undefined;
  const mine = useRemote<MyAttendance>(month ? 'talent/attendance/me' : null, {
    month,
  });
  const cell = mine.data?.schedules.find((s) => s.date === date);
  // A night shift's check-out falls on the next morning.
  const nextDay = Boolean(
    crossesMidnight(cell) && time && cell?.endTime && time <= cell.endTime,
  );
  const used = mine.data?.missingPunchUsed;
  const limit = mine.data?.missingPunchLimit;
  const full = used !== undefined && limit !== undefined && used >= limit;
  return (
    <AdjustmentRequestDialog
      type='missingPunch'
      blocked={
        full ? t('attendance.errors.MISSING_PUNCH_LIMIT', { limit }) : undefined
      }
      build={() =>
        isDate(date) && /^\d{2}:\d{2}$/u.test(time)
          ? {
              type: 'missingPunch',
              date,
              details: {
                at: localInstant(nextDay ? addDays(date, 1) : date, time, zone),
              },
            }
          : null
      }
    >
      <p className='text-sm text-muted-foreground'>
        {used !== undefined && limit !== undefined
          ? t('attendance.my.missingPunchUsage', { used, limit })
          : '…'}
      </p>
      <div className='grid gap-4 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='missing-punch-date'>
            {t('attendance.adjustments.fields.date')} *
          </FieldLabel>
          <Input
            id='missing-punch-date'
            type='date'
            value={date}
            max={today(zone)}
            onChange={(event) => setDate(event.target.value)}
          />
          <FieldDescription>{shiftLine(cell, t)}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='missing-punch-time'>
            {t('attendance.adjustments.fields.punchTime')} *
          </FieldLabel>
          <Input
            id='missing-punch-time'
            type='time'
            value={time}
            onChange={(event) => setTime(event.target.value)}
          />
          {nextDay ? (
            <FieldDescription>
              {t('attendance.my.dialogs.nextDay', { date: addDays(date, 1) })}
            </FieldDescription>
          ) : null}
        </Field>
      </div>
    </AdjustmentRequestDialog>
  );
}
