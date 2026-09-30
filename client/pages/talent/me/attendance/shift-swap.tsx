import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { isDate, today } from '@/components/talent/attendance/dates';
import type {
  MyAttendance,
  SwapPeer,
} from '@/components/talent/attendance/types';
import { LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';

import { AdjustmentRequestDialog } from './request-dialog.js';
import { shiftLine } from './shift-line.js';

/**
 * 调班 (`/talent/me/attendance/shift-swap`): my day, the colleague and — when
 * the swap is across days — their day. The colleague agrees first, then the
 * approvers; the two published cells are exchanged on approval.
 */
export default function ShiftSwapPage(): ReactElement {
  const { t } = useTranslation();
  const zone = useAppTimeZone();
  const [date, setDate] = useState(() => today(zone));
  const [counterpart, setCounterpart] = useState('');
  const [otherDay, setOtherDay] = useState(false);
  const [counterpartDate, setCounterpartDate] = useState('');
  const peerDate = otherDay && isDate(counterpartDate) ? counterpartDate : date;
  const peers = useRemote<SwapPeer[]>(
    isDate(peerDate) ? 'talent/adjustments/swap-peers' : null,
    { date: peerDate },
  );
  const month = isDate(date) ? date.slice(0, 7) : undefined;
  const mine = useRemote<MyAttendance>(month ? 'talent/attendance/me' : null, {
    month,
  });
  const cell = mine.data?.schedules.find((s) => s.date === date);
  const peerLabel = (peer: SwapPeer) =>
    t('attendance.my.dialogs.peer', {
      name: peer.name,
      number: peer.employeeNo,
      shift: !peer.scheduled
        ? t('attendance.my.dialogs.peerUnscheduled')
        : (peer.shiftTitle ?? t('attendance.shifts.rest')),
    });
  return (
    <AdjustmentRequestDialog
      type='shiftSwap'
      build={() =>
        isDate(date) && counterpart && (!otherDay || isDate(counterpartDate))
          ? {
              type: 'shiftSwap',
              date,
              details: {
                counterpartEmployeeId: counterpart,
                ...(otherDay && counterpartDate !== date
                  ? { counterpartDate }
                  : {}),
              },
            }
          : null
      }
    >
      <Field>
        <FieldLabel htmlFor='swap-date'>
          {t('attendance.adjustments.fields.myDate')} *
        </FieldLabel>
        <Input
          id='swap-date'
          type='date'
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <FieldDescription>{shiftLine(cell, t)}</FieldDescription>
      </Field>
      <Label className='flex items-center gap-2 font-normal'>
        <Checkbox
          checked={otherDay}
          onCheckedChange={(checked) => setOtherDay(Boolean(checked))}
        />
        {t('attendance.my.dialogs.otherDay')}
      </Label>
      {otherDay ? (
        <Field>
          <FieldLabel htmlFor='swap-counterpart-date'>
            {t('attendance.adjustments.fields.counterpartDate')} *
          </FieldLabel>
          <Input
            id='swap-counterpart-date'
            type='date'
            value={counterpartDate}
            onChange={(event) => setCounterpartDate(event.target.value)}
          />
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor='swap-counterpart'>
          {t('attendance.adjustments.fields.counterpart')} *
        </FieldLabel>
        {peers.error ? (
          <LoadError error={peers.error} onRetry={peers.reload} />
        ) : (
          <NativeSelect
            id='swap-counterpart'
            className='w-full'
            aria-required='true'
            disabled={!peers.data}
            value={counterpart}
            onChange={(event) => setCounterpart(event.target.value)}
          >
            <NativeSelectOption value=''>
              {peers.data?.length
                ? t('attendance.my.dialogs.choosePeer')
                : t('attendance.my.dialogs.noPeers')}
            </NativeSelectOption>
            {(peers.data ?? []).map((peer) => (
              <NativeSelectOption key={peer.employeeId} value={peer.employeeId}>
                {peerLabel(peer)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
        <FieldDescription>
          {t('attendance.my.dialogs.peerHint', { date: peerDate })}
        </FieldDescription>
      </Field>
    </AdjustmentRequestDialog>
  );
}
