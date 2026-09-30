import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent, type ReactElement } from 'react';

import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import type {
  RotationTemplate,
  ScheduleBoard,
} from '@/components/talent/attendance/types';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';

/**
 * The demo templates' keys. The configured list lives in the attendance
 * settings, which only hr.admin may read; a department manager who schedules
 * picks one of these or types the key HR gave them.
 */
const FALLBACK_KEYS = ['three-shift-weekly', 'two-shift-weekly'] as const;
const OTHER = '__other';

export interface RotationCell {
  employeeId: string;
  date: string;
  shiftId: string | null;
}

/** 套用轮班模板: the server computes the cells; they fill the grid as unsaved edits. */
export function RotationDialog({
  open,
  onOpenChange,
  board,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  board: ScheduleBoard;
  onApply: (cells: RotationCell[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const settings = useCan({
    resource: { type: 'composite', id: 'talent.attendanceSettings' },
    action: 'manage',
  });
  const configured = useRemote<{
    config: { rotations: { value: { templates: RotationTemplate[] } } };
  }>(open && settings.can ? 'talent/attendance-settings' : null);
  const templates = configured.data?.config.rotations.value.templates;
  const options: { key: string; label: string }[] = templates
    ? templates.map((tpl) => ({ key: tpl.key, label: tpl.title }))
    : FALLBACK_KEYS.map((key) => ({
        key,
        label: t(`attendance.scheduling.rotation.templates.${key}`),
      }));
  const [choice, setChoice] = useState('');
  const [customKey, setCustomKey] = useState('');
  const [employeeIds, setEmployeeIds] = useState<string[]>(() =>
    board.employees.filter((e) => e.status !== 'leave').map((e) => e.id),
  );
  const [from, setFrom] = useState(board.from);
  const [to, setTo] = useState(board.to);
  const [stagger, setStagger] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const selected = choice || options[0]?.key || '';
  const templateKey = selected === OTHER ? customKey.trim() : selected;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !templateKey || !employeeIds.length || !from || !to) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{
        data: { template: RotationTemplate; cells: RotationCell[] };
      }>({
        method: 'POST',
        path: 'talent/schedules/rotation',
        json: { templateKey, employeeIds, from, to, stagger },
      });
      onApply(response.data.cells);
      onOpenChange(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('attendance.scheduling.rotation.title')}</DialogTitle>
          <DialogDescription>
            {t('attendance.scheduling.rotation.description')}
          </DialogDescription>
        </DialogHeader>
        <form
          id='rotation-form'
          className='grid gap-4'
          onSubmit={(event) => void submit(event)}
        >
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>
                {attendanceErrorMessage(error, t)}
              </AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor='rotation-template'>
              {t('attendance.scheduling.rotation.template')}
            </FieldLabel>
            <NativeSelect
              id='rotation-template'
              className='w-full'
              value={selected}
              onChange={(event) => setChoice(event.target.value)}
            >
              {options.map((option) => (
                <NativeSelectOption key={option.key} value={option.key}>
                  {option.label}
                </NativeSelectOption>
              ))}
              <NativeSelectOption value={OTHER}>
                {t('attendance.scheduling.rotation.other')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          {selected === OTHER ? (
            <Field>
              <FieldLabel htmlFor='rotation-key'>
                {t('attendance.scheduling.rotation.key')}
              </FieldLabel>
              <Input
                id='rotation-key'
                value={customKey}
                maxLength={40}
                onChange={(event) => setCustomKey(event.target.value)}
              />
            </Field>
          ) : null}
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='rotation-from'>
                {t('attendance.filters.from')}
              </FieldLabel>
              <Input
                id='rotation-from'
                type='date'
                value={from}
                min={board.from}
                max={board.to}
                onChange={(event) => setFrom(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='rotation-to'>
                {t('attendance.filters.to')}
              </FieldLabel>
              <Input
                id='rotation-to'
                type='date'
                value={to}
                min={board.from}
                max={board.to}
                onChange={(event) => setTo(event.target.value)}
              />
            </Field>
          </div>
          <fieldset className='grid gap-2'>
            <legend className='mb-1 text-sm font-medium'>
              {t('attendance.scheduling.rotation.employees', {
                count: employeeIds.length,
              })}
            </legend>
            <div className='grid max-h-48 gap-2 overflow-y-auto rounded-lg border p-3 sm:grid-cols-2'>
              {board.employees.map((employee) => (
                <Label
                  key={employee.id}
                  className='flex items-center gap-2 font-normal'
                >
                  <Checkbox
                    checked={employeeIds.includes(employee.id)}
                    onCheckedChange={(checked) =>
                      setEmployeeIds((ids) =>
                        checked
                          ? [...ids, employee.id]
                          : ids.filter((id) => id !== employee.id),
                      )
                    }
                  />
                  {employee.name}
                </Label>
              ))}
            </div>
          </fieldset>
          <Label className='flex items-center gap-2 font-normal'>
            <Checkbox
              checked={stagger}
              onCheckedChange={(checked) => setStagger(Boolean(checked))}
            />
            {t('attendance.scheduling.rotation.stagger')}
          </Label>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            type='submit'
            form='rotation-form'
            disabled={
              busy ||
              !templateKey ||
              !employeeIds.length ||
              !from ||
              !to ||
              to < from
            }
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('attendance.scheduling.rotation.apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
