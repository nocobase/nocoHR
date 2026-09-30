import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent, type ReactElement } from 'react';

import { useEmployeeName } from '@/components/talent/employee-name';
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

import { listOf, usePermissionSetName } from './helpers.js';
import type { EntryRoute } from './types.js';

/**
 * Adds or edits one row of the routing-table draft. Like the approval-chain
 * rules in 人事设置, the dialog changes only the Card's draft and the Card's
 * "保存" sends it, so it opens from component state rather than a URL.
 */
export function RouteDialog({
  open,
  route,
  employees,
  permissionSets,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly route: EntryRoute | null;
  readonly employees: readonly string[];
  readonly permissionSets: readonly string[];
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (route: EntryRoute) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        {open ? (
          <RouteForm
            key={route?.key ?? 'new'}
            route={route}
            employees={employees}
            permissionSets={permissionSets}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>{t('aiEntry.routes.add')}</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RouteForm({
  route,
  employees,
  permissionSets,
  onCancel,
  onSubmit,
}: {
  readonly route: EntryRoute | null;
  readonly employees: readonly string[];
  readonly permissionSets: readonly string[];
  readonly onCancel: () => void;
  readonly onSubmit: (route: EntryRoute) => void;
}): ReactElement {
  const { t } = useTranslation();
  const employeeName = useEmployeeName();
  const setName = usePermissionSetName();
  const [description, setDescription] = useState(route?.description ?? '');
  const [employee, setEmployee] = useState(route?.employee ?? '');
  const [sets, setSets] = useState<string[]>(route?.permissionSets ?? []);
  const [keywords, setKeywords] = useState((route?.keywords ?? []).join('、'));
  const [enabled, setEnabled] = useState(route?.enabled ?? true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent): void {
    event.preventDefault();
    const next: Record<string, string> = {};
    const words = listOf(keywords);
    if (!description.trim())
      next.description = t('aiEntry.routes.descriptionRequired');
    else if (description.trim().length > 200)
      next.description = t('aiEntry.routes.descriptionTooLong');
    if (!employee) next.employee = t('aiEntry.routes.employeeRequired');
    if (words.length > 40 || words.some((w) => w.length > 20))
      next.keywords = t('aiEntry.routes.keywordsInvalid');
    setErrors(next);
    if (Object.keys(next).length) {
      document
        .getElementById(
          next.description
            ? 'entry-route-description'
            : next.employee
              ? 'entry-route-employee'
              : 'entry-route-keywords',
        )
        ?.focus();
      return;
    }
    onSubmit({
      key: route?.key ?? `r${Date.now().toString(36)}`,
      description: description.trim(),
      employee,
      // Keep the listed order whatever the click order was.
      permissionSets: permissionSets.filter((key) => sets.includes(key)),
      enabled,
      keywords: words,
    });
  }

  return (
    <form noValidate onSubmit={submit} className='grid gap-4'>
      <DialogHeader>
        <DialogTitle>
          {route ? t('aiEntry.routes.edit') : t('aiEntry.routes.add')}
        </DialogTitle>
        <DialogDescription>
          {t('aiEntry.routes.dialogDescription')}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <Field data-invalid={Boolean(errors.description)}>
          <FieldLabel htmlFor='entry-route-description'>
            {t('aiEntry.routes.description')} *
          </FieldLabel>
          <Input
            id='entry-route-description'
            value={description}
            maxLength={200}
            aria-invalid={Boolean(errors.description)}
            placeholder={t('aiEntry.routes.descriptionPlaceholder')}
            onChange={(e) => setDescription(e.target.value)}
          />
          {errors.description ? (
            <FieldError>{errors.description}</FieldError>
          ) : null}
        </Field>
        <Field data-invalid={Boolean(errors.employee)}>
          <FieldLabel htmlFor='entry-route-employee'>
            {t('aiEntry.routes.employee')} *
          </FieldLabel>
          <NativeSelect
            id='entry-route-employee'
            value={employee}
            aria-invalid={Boolean(errors.employee)}
            onChange={(e) => setEmployee(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.common.choose')}
            </NativeSelectOption>
            {[
              ...new Set([...employees, ...(route ? [route.employee] : [])]),
            ].map((username) => (
              <NativeSelectOption key={username} value={username}>
                {employeeName(username)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          {errors.employee ? <FieldError>{errors.employee}</FieldError> : null}
        </Field>
        <FieldSet>
          <FieldLegend variant='label'>
            {t('aiEntry.routes.permissionSets')}
          </FieldLegend>
          <FieldDescription>
            {t('aiEntry.routes.permissionSetsHint')}
          </FieldDescription>
          <div className='grid gap-2 sm:grid-cols-2'>
            {permissionSets.map((key) => (
              <div key={key} className='flex items-center gap-2'>
                <Checkbox
                  id={`entry-route-set-${key}`}
                  checked={sets.includes(key)}
                  onCheckedChange={(checked) =>
                    setSets((current) =>
                      checked === true
                        ? [...current, key]
                        : current.filter((k) => k !== key),
                    )
                  }
                />
                <Label htmlFor={`entry-route-set-${key}`}>{setName(key)}</Label>
              </div>
            ))}
          </div>
        </FieldSet>
        <Field data-invalid={Boolean(errors.keywords)}>
          <FieldLabel htmlFor='entry-route-keywords'>
            {t('aiEntry.routes.keywords')}
          </FieldLabel>
          <Input
            id='entry-route-keywords'
            value={keywords}
            aria-invalid={Boolean(errors.keywords)}
            placeholder={t('aiEntry.routes.keywordsPlaceholder')}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <FieldDescription>
            {t('aiEntry.routes.keywordsHint')}
          </FieldDescription>
          {errors.keywords ? <FieldError>{errors.keywords}</FieldError> : null}
        </Field>
        <Field orientation='horizontal'>
          <Switch
            id='entry-route-enabled'
            checked={enabled}
            onCheckedChange={setEnabled}
          />
          <FieldContent>
            <FieldLabel htmlFor='entry-route-enabled'>
              {t('aiEntry.routes.enabled')}
            </FieldLabel>
          </FieldContent>
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type='submit'>
          {route ? t('aiEntry.routes.apply') : t('aiEntry.routes.addSubmit')}
        </Button>
      </DialogFooter>
    </form>
  );
}
