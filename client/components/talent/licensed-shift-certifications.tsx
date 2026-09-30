import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { errorMessage } from './errors.js';
import { BlockSkeleton, LoadError } from './states.js';
import { useRemote } from './use-remote.js';

/** `GET talent/licensed/shifts` (server/providers/hr/licensed/index.ts). */
export interface ShiftRequirements {
  checking: boolean;
  shifts: {
    id: string;
    code: string;
    title: string;
    requiredCertificationIds: string[];
  }[];
  certifications: { id: string; title: string; kind: string }[];
}

const PATH = 'talent/licensed/shifts';
const PERMISSION = {
  resource: { type: 'composite', id: 'talent.shift' },
  action: 'manageRequiredCertifications',
} as const;

function useSave() {
  const api = useApiClient();
  return (shiftId: string, certificationIds: string[]) =>
    api.request({
      path: `${PATH}/${encodeURIComponent(shiftId)}/required-certifications`,
      method: 'PUT',
      json: { certificationIds },
    });
}

function CertificationChoices({
  idPrefix,
  certifications,
  value,
  onChange,
  disabled,
}: {
  idPrefix: string;
  certifications: ShiftRequirements['certifications'];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='flex flex-col gap-2'>
      {certifications.map((certification) => {
        const id = `${idPrefix}-${certification.id}`;
        const checked = value.includes(certification.id);
        return (
          <label
            key={certification.id}
            htmlFor={id}
            className='flex items-center gap-2 text-sm'
          >
            <Checkbox
              id={id}
              checked={checked}
              disabled={disabled}
              onCheckedChange={(next) =>
                onChange(
                  next
                    ? [...value, certification.id]
                    : value.filter((v) => v !== certification.id),
                )
              }
            />
            <span>{certification.title}</span>
            {certification.kind === 'external' ? (
              <Badge variant='outline'>{t('licensed.shifts.external')}</Badge>
            ) : null}
          </label>
        );
      })}
    </div>
  );
}

/**
 * V4-14 班次 · 要求的认证 (settings page): every shift with the
 * certifications it requires, edited one at a time. hr.admin only
 * (`talent.shift` · manageRequiredCertifications).
 */
export function LicensedShiftRequirementsCard(): ReactElement | null {
  const { t } = useTranslation();
  const permission = useCan(PERMISSION);
  const remote = useRemote<ShiftRequirements>(permission.can ? PATH : null);
  const save = useSave();
  const [editing, setEditing] = useState<{ id: string; ids: string[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  if (!permission.can) return null;
  const titleOf = (id: string) =>
    remote.data?.certifications.find((c) => c.id === id)?.title ?? id;

  async function submit(shiftTitle: string): Promise<void> {
    if (!editing) return;
    setBusy(true);
    try {
      await save(editing.id, editing.ids);
      toast.add({
        type: 'success',
        title: t('licensed.shifts.saved', { shift: shiftTitle }),
      });
      setEditing(null);
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.shifts.title')}</CardTitle>
        <CardDescription>{t('licensed.shifts.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {remote.error ? (
          <LoadError error={remote.error} onRetry={remote.reload} />
        ) : !remote.data ? (
          <BlockSkeleton rows={3} />
        ) : (
          <>
            {!remote.data.checking ? (
              <Alert>
                <AlertDescription>
                  {t('licensed.shifts.checkingOff')}
                </AlertDescription>
              </Alert>
            ) : null}
            <ul className='divide-y'>
              {remote.data.shifts.map((shift) => (
                <li
                  key={shift.id}
                  className='flex flex-wrap items-start justify-between gap-3 py-3'
                >
                  <div className='min-w-0 space-y-1'>
                    <p className='font-medium'>{shift.title}</p>
                    {editing?.id === shift.id ? (
                      <CertificationChoices
                        idPrefix={`shift-${shift.id}`}
                        certifications={remote.data!.certifications}
                        value={editing.ids}
                        disabled={busy}
                        onChange={(ids) => setEditing({ id: shift.id, ids })}
                      />
                    ) : (
                      <div className='flex flex-wrap gap-1.5'>
                        {shift.requiredCertificationIds.length ? (
                          shift.requiredCertificationIds.map((id) => (
                            <Badge key={id} variant='secondary'>
                              {titleOf(id)}
                            </Badge>
                          ))
                        ) : (
                          <span className='text-sm text-muted-foreground'>
                            {t('licensed.shifts.noRequirement')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {editing?.id === shift.id ? (
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={busy}
                        onClick={() => setEditing(null)}
                      >
                        {t('licensed.shifts.cancel')}
                      </Button>
                      <Button
                        size='sm'
                        disabled={busy}
                        onClick={() => void submit(shift.title)}
                      >
                        {busy ? <Spinner data-icon='inline-start' /> : null}
                        {t('licensed.shifts.save')}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      size='sm'
                      variant='outline'
                      disabled={Boolean(editing)}
                      onClick={() =>
                        setEditing({
                          id: shift.id,
                          ids: [...shift.requiredCertificationIds],
                        })
                      }
                    >
                      {t('licensed.shifts.edit')}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * V4-14 班次维护表单 · 要求的认证: the requirement of one existing shift, saved
 * on its own (a shift already in use keeps its times but may gain or lose a
 * requirement). Mounted in the V2-05 shift editor; nothing without the
 * permission.
 */
export function LicensedShiftRequirementField({
  shiftId,
}: {
  shiftId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const permission = useCan(PERMISSION);
  const remote = useRemote<ShiftRequirements>(permission.can ? PATH : null);
  const save = useSave();
  const [value, setValue] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  // Anything but the expected answer (an older server, a failed load) leaves the shift editor untouched.
  if (
    !permission.can ||
    !Array.isArray(remote.data?.shifts) ||
    !Array.isArray(remote.data.certifications)
  )
    return null;
  const shift = remote.data.shifts.find((s) => s.id === shiftId);
  if (!shift) return null;
  const current = value ?? shift.requiredCertificationIds;
  const dirty =
    value !== null &&
    JSON.stringify([...value].sort()) !==
      JSON.stringify([...shift.requiredCertificationIds].sort());

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await save(shiftId, current);
      toast.add({
        type: 'success',
        title: t('licensed.shifts.saved', { shift: shift!.title }),
      });
      setValue(null);
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Field>
      <FieldLabel>{t('licensed.shifts.field')}</FieldLabel>
      <CertificationChoices
        idPrefix={`shift-field-${shiftId}`}
        certifications={remote.data.certifications}
        value={current}
        disabled={busy}
        onChange={setValue}
      />
      <FieldDescription>{t('licensed.shifts.fieldHint')}</FieldDescription>
      <div>
        <Button
          type='button'
          size='sm'
          variant='outline'
          disabled={!dirty || busy}
          onClick={() => void submit()}
        >
          {busy ? <Spinner data-icon='inline-start' /> : null}
          {t('licensed.shifts.save')}
        </Button>
      </div>
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : null}
    </Field>
  );
}
