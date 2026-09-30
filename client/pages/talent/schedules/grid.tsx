import { useTranslation } from '@nocobase/i18n/client';
import { MoonIcon, OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import {
  dayLabel,
  weekdayIndex,
  weekdayLabel,
} from '@/components/talent/attendance/dates';
import { checkText, worstLevel } from '@/components/talent/attendance/errors';
import type {
  CheckMap,
  ScheduleBoard,
} from '@/components/talent/attendance/types';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { cn } from '@/lib/utils';

import { cellChecks, cellKey, REST, type Edits } from './grid-keys.js';

/**
 * 员工 × 日期: one native select per cell, so the grid works with a keyboard
 * and on a phone. The table scrolls sideways inside its card; the employee
 * column stays in view. Block cells are red, warnings are marked, unsaved
 * edits are outlined; the legend under the grid says which is which.
 */
export function ScheduleGrid({
  board,
  edits,
  checks,
  canEdit,
  onEdit,
}: {
  board: ScheduleBoard;
  edits: Edits;
  checks: CheckMap | undefined;
  canEdit: boolean;
  onEdit: (key: string, value: string | null) => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const cells = new Map(
    board.cells.map((cell) => [cellKey(cell.employeeId, cell.date), cell]),
  );
  const shiftById = new Map(board.shifts.map((s) => [s.id, s]));
  const active = board.shifts.filter((s) => s.active);
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <table className='w-full border-collapse text-sm'>
        <thead className='bg-muted/50'>
          <tr>
            <th
              scope='col'
              className='sticky left-0 z-10 min-w-28 border-b bg-muted px-2 py-2 text-left font-medium'
            >
              {t('attendance.scheduling.employee')}
            </th>
            {board.dates.map((date) => (
              <th
                key={date}
                scope='col'
                className={cn(
                  'min-w-28 border-b border-l px-2 py-2 text-left font-medium',
                  weekdayIndex(date) >= 5 && 'text-muted-foreground',
                )}
              >
                <span className='block'>{dayLabel(date, i18n.language)}</span>
                <span className='block text-xs font-normal text-muted-foreground'>
                  {weekdayLabel(date, i18n.language)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {board.employees.map((employee) => (
            <tr key={employee.id} className='border-b last:border-0'>
              <th
                scope='row'
                className='sticky left-0 z-10 bg-background px-2 py-2 text-left align-top font-medium'
              >
                <span className='block'>{employee.name}</span>
                <span className='block text-xs font-normal text-muted-foreground'>
                  {employee.employeeNo}
                </span>
              </th>
              {board.dates.map((date) => {
                const key = cellKey(employee.id, date);
                const cell = cells.get(key);
                const edited = key in edits;
                const value = edited ? edits[key] : cell?.shiftId;
                const exists = Boolean(cell) || edited;
                const list = cellChecks(key, cell, checks);
                const level = worstLevel(list);
                const shift = value ? shiftById.get(value) : undefined;
                const selectValue = !exists ? '' : value ? value : REST;
                return (
                  <td
                    key={date}
                    data-level={level ?? undefined}
                    data-edited={edited || undefined}
                    className={cn(
                      'border-l p-1 align-top',
                      level === 'block' && 'bg-destructive/10',
                      level === 'warn' && 'bg-accent',
                    )}
                  >
                    <div
                      className={cn(
                        'rounded-lg',
                        edited && 'ring-2 ring-ring/60',
                        level === 'block' && 'ring-2 ring-destructive',
                      )}
                    >
                      <NativeSelect
                        size='sm'
                        className='w-full'
                        aria-label={t('attendance.scheduling.cellLabel', {
                          name: employee.name,
                          date,
                        })}
                        aria-invalid={level === 'block' || undefined}
                        disabled={!canEdit}
                        value={selectValue}
                        onChange={(event) => {
                          const next = event.target.value;
                          if (!next) return;
                          onEdit(key, next === REST ? null : next);
                        }}
                      >
                        {!exists ? (
                          <NativeSelectOption value=''>—</NativeSelectOption>
                        ) : null}
                        <NativeSelectOption value={REST}>
                          {t('attendance.shifts.rest')}
                        </NativeSelectOption>
                        {shift && !shift.active ? (
                          <NativeSelectOption value={shift.id}>
                            {shift.title}
                          </NativeSelectOption>
                        ) : null}
                        {active.map((s) => (
                          <NativeSelectOption key={s.id} value={s.id}>
                            {s.title}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                    <div className='mt-1 flex min-h-4 flex-wrap items-center gap-1 text-xs text-muted-foreground'>
                      {shift?.isNight ? (
                        <MoonIcon
                          className='size-3'
                          aria-label={t('attendance.shifts.night')}
                        />
                      ) : null}
                      {shift ? (
                        <span className='hidden sm:inline'>
                          {shift.startTime.slice(0, 5)}–
                          {shift.endTime.slice(0, 5)}
                        </span>
                      ) : null}
                      {edited ? (
                        <span>{t('attendance.scheduling.unsaved')}</span>
                      ) : cell?.status === 'draft' ? (
                        <span>{t('attendance.scheduling.draft')}</span>
                      ) : null}
                      {level ? (
                        <span
                          className={cn(
                            'inline-flex items-center',
                            level === 'block'
                              ? 'text-destructive'
                              : 'text-foreground',
                          )}
                          title={list.map((c) => checkText(c, t)).join('\n')}
                        >
                          {level === 'block' ? (
                            <OctagonAlertIcon className='size-3' />
                          ) : (
                            <TriangleAlertIcon className='size-3' />
                          )}
                          <span className='sr-only'>
                            {list.map((c) => checkText(c, t)).join(' · ')}
                          </span>
                        </span>
                      ) : null}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** What the markers mean. */
export function GridLegend(): ReactElement {
  const { t } = useTranslation();
  return (
    <ul className='flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground'>
      <li className='flex items-center gap-1'>
        <span className='size-3 rounded-sm bg-destructive/10 ring-2 ring-destructive' />
        {t('attendance.scheduling.legend.block')}
      </li>
      <li className='flex items-center gap-1'>
        <span className='size-3 rounded-sm bg-accent ring-1 ring-border' />
        {t('attendance.scheduling.legend.warn')}
      </li>
      <li className='flex items-center gap-1'>
        <span className='size-3 rounded-sm ring-2 ring-ring/60' />
        {t('attendance.scheduling.legend.unsaved')}
      </li>
      <li className='flex items-center gap-1'>
        <MoonIcon className='size-3' />
        {t('attendance.scheduling.legend.night')}
      </li>
    </ul>
  );
}
