import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useLocation } from 'react-router';

import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { currentMonth, isMonth } from '@/components/talent/attendance/dates';
import type { MyAttendance } from '@/components/talent/attendance/types';
import { LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

import { AdjustmentRequestDialog } from './request-dialog.js';

/**
 * 考勤异常说明 (`/talent/me/attendance/exception`): why I was late or left
 * early on a day of the month. Only such a day, not yet explained, can be
 * chosen; the server checks it again. Approved, the day shows 已说明.
 */
export default function ExceptionPage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const location = useLocation();
  const [month, setMonth] = useState(() => {
    const initial = new URLSearchParams(location.search).get('month');
    return isMonth(initial) ? initial : currentMonth(zone);
  });
  const [date, setDate] = useState('');
  const mine = useRemote<MyAttendance>(
    isMonth(month) ? 'talent/attendance/me' : null,
    { month },
  );
  const days = (mine.data?.records ?? []).filter(
    (r) =>
      (r.status === 'late' || r.status === 'earlyLeave') &&
      !r.excusedByAdjustmentId,
  );
  const picked = days.find((r) => r.date === date);
  return (
    <AdjustmentRequestDialog
      type='exception'
      build={() =>
        picked ? { type: 'exception', date: picked.date, details: {} } : null
      }
    >
      <div className='grid gap-4 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='exception-month'>
            {t('attendance.filters.month')}
          </FieldLabel>
          <Input
            id='exception-month'
            type='month'
            value={month}
            onChange={(event) => {
              if (!isMonth(event.target.value)) return;
              setMonth(event.target.value);
              setDate('');
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='exception-day'>
            {t('attendanceV2.exception.day')} *
          </FieldLabel>
          {mine.error ? (
            <LoadError error={mine.error} onRetry={mine.reload} />
          ) : (
            <NativeSelect
              id='exception-day'
              className='w-full'
              aria-required='true'
              disabled={!mine.data || !days.length}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            >
              <NativeSelectOption value=''>
                {mine.data && !days.length
                  ? t('attendanceV2.exception.none')
                  : t('attendanceV2.exception.pick')}
              </NativeSelectOption>
              {days.map((record) => (
                <NativeSelectOption key={record.id} value={record.date}>
                  {t('attendanceV2.exception.anomaly', {
                    date: record.date,
                    status: t(`attendance.recordStatus.${record.status}`),
                    minutes:
                      record.status === 'late'
                        ? (record.lateMinutes ?? '—')
                        : (record.earlyMinutes ?? '—'),
                  })}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
    </AdjustmentRequestDialog>
  );
}
