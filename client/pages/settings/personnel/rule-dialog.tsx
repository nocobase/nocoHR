import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { titleText } from '@/components/talent/titles';
import type { DepartmentOption } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';

import { ACTION_TYPES, type ChainRule, type SettingsOptions } from './types.js';

interface UserOption {
  id: string;
  name: string;
  username: string | null;
}

/**
 * Adds or edits one rule of the approval-chain draft. The dialog changes only
 * the Card's draft; the Card's "保存" sends it. It opens with open state
 * because the rule is not stored yet (design trade-off for I6).
 */
export function RuleDialog({
  open,
  rule,
  departments,
  options,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly rule: ChainRule | null;
  readonly departments: readonly DepartmentOption[];
  readonly options: SettingsOptions;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (rule: ChainRule) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-lg'>
        {open ? (
          <RuleForm
            key={rule?.id ?? 'new'}
            rule={rule}
            departments={departments}
            options={options}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>{t('personnelSettings.addRule')}</DialogTitle>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({
  rule,
  departments,
  options,
  onCancel,
  onSubmit,
}: {
  readonly rule: ChainRule | null;
  readonly departments: readonly DepartmentOption[];
  readonly options: SettingsOptions;
  readonly onCancel: () => void;
  readonly onSubmit: (rule: ChainRule) => void;
}): ReactElement {
  const { t } = useTranslation();
  const schema = useMemo(
    () =>
      z
        .object({
          departmentId: z
            .string()
            .min(1, t('personnelSettings.ruleDepartmentRequired')),
          actionTypes: z
            .array(z.enum(ACTION_TYPES))
            .min(1, t('personnelSettings.ruleTypesRequired')),
          name: z
            .string()
            .trim()
            .min(1, t('personnelSettings.ruleNameRequired'))
            .max(60, t('personnelSettings.ruleNameTooLong')),
          approverType: z.enum(['departmentHead', 'user', 'permissionSet']),
          approverDepartmentId: z.string(),
          approverUserId: z.string(),
          approverSet: z.string(),
          position: z.enum(['afterFirst', 'afterHr']),
          enabled: z.boolean(),
        })
        .superRefine((value, ctx) => {
          const missing = {
            departmentHead: [
              'approverDepartmentId',
              value.approverDepartmentId,
            ],
            user: ['approverUserId', value.approverUserId],
            permissionSet: ['approverSet', value.approverSet],
          }[value.approverType] as [string, string];
          if (!missing[1])
            ctx.addIssue({
              code: 'custom',
              path: [missing[0]],
              message: t('personnelSettings.ruleApproverRequired'),
            });
        }),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: {
      departmentId: rule?.departmentId ?? '',
      actionTypes:
        rule?.actionTypes ?? (['onboard'] as ChainRule['actionTypes']),
      name: rule?.name ?? '',
      approverType: rule?.approver.type ?? 'departmentHead',
      approverDepartmentId:
        rule?.approver.type === 'departmentHead'
          ? rule.approver.departmentId
          : '',
      approverUserId:
        rule?.approver.type === 'user' ? rule.approver.userId : '',
      approverSet:
        rule?.approver.type === 'permissionSet' ? rule.approver.key : '',
      position: rule?.position ?? 'afterFirst',
      enabled: rule?.enabled ?? true,
    },
  });
  const approverType = useWatch({
    control: form.control,
    name: 'approverType',
  });
  const users = useRemote<UserOption[]>(
    approverType === 'user' ? 'talent/users' : null,
  );
  const errors = form.formState.errors;
  // A new rule's id, fixed when the dialog opens.
  const [newId] = useState(() => `rule-${crypto.randomUUID()}`);
  const submit = form.handleSubmit((values) =>
    onSubmit({
      id: rule?.id ?? newId,
      departmentId: values.departmentId,
      actionTypes: values.actionTypes,
      name: values.name.trim(),
      approver:
        values.approverType === 'departmentHead'
          ? {
              type: 'departmentHead',
              departmentId: values.approverDepartmentId,
            }
          : values.approverType === 'user'
            ? { type: 'user', userId: values.approverUserId }
            : { type: 'permissionSet', key: values.approverSet },
      position: values.position,
      enabled: values.enabled,
    }),
  );
  const departmentOptions = departments.filter((d) => d.active);
  return (
    <form noValidate onSubmit={(event) => void submit(event)}>
      <DialogHeader>
        <DialogTitle>
          {t(rule ? 'personnelSettings.editRule' : 'personnelSettings.addRule')}
        </DialogTitle>
        <DialogDescription>
          {t('personnelSettings.ruleDialogDescription')}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup className='py-4'>
        <Field data-invalid={Boolean(errors.departmentId)}>
          <FieldLabel htmlFor='rule-department'>
            {t('personnelSettings.ruleDepartment')} *
          </FieldLabel>
          <NativeSelect
            id='rule-department'
            aria-required='true'
            aria-invalid={Boolean(errors.departmentId)}
            {...form.register('departmentId')}
          >
            <NativeSelectOption value=''>
              {t('talent.common.choose')}
            </NativeSelectOption>
            {departmentOptions.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'　'.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldError errors={[errors.departmentId]} />
        </Field>
        <Controller
          control={form.control}
          name='actionTypes'
          render={({ field }) => (
            <FieldSet data-invalid={Boolean(errors.actionTypes)}>
              <FieldLegend variant='label'>
                {t('personnelSettings.ruleTypes')} *
              </FieldLegend>
              <div className='flex flex-wrap gap-x-4 gap-y-2'>
                {ACTION_TYPES.map((type) => (
                  <div key={type} className='flex items-center gap-2'>
                    <Checkbox
                      id={`rule-type-${type}`}
                      checked={field.value.includes(type)}
                      onCheckedChange={(checked) =>
                        field.onChange(
                          checked === true
                            ? [...field.value, type]
                            : field.value.filter((v) => v !== type),
                        )
                      }
                    />
                    <Label htmlFor={`rule-type-${type}`}>
                      {t(`talent.actionType.${type}`)}
                    </Label>
                  </div>
                ))}
              </div>
              <FieldError errors={[errors.actionTypes]} />
            </FieldSet>
          )}
        />
        <Field data-invalid={Boolean(errors.name)}>
          <FieldLabel htmlFor='rule-name'>
            {t('personnelSettings.ruleName')} *
          </FieldLabel>
          <Input
            id='rule-name'
            placeholder={t('personnelSettings.ruleNamePlaceholder')}
            aria-required='true'
            aria-invalid={Boolean(errors.name)}
            {...form.register('name')}
          />
          <FieldError errors={[errors.name]} />
        </Field>
        <Controller
          control={form.control}
          name='approverType'
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant='label'>
                {t('personnelSettings.ruleApprover')} *
              </FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange}>
                {(['departmentHead', 'user', 'permissionSet'] as const).map(
                  (type) => (
                    <div key={type} className='flex items-center gap-2'>
                      <RadioGroupItem
                        value={type}
                        id={`rule-approver-${type}`}
                      />
                      <Label htmlFor={`rule-approver-${type}`}>
                        {t(`personnelSettings.approverType.${type}`)}
                      </Label>
                    </div>
                  ),
                )}
              </RadioGroup>
            </FieldSet>
          )}
        />
        {approverType === 'departmentHead' ? (
          <Field data-invalid={Boolean(errors.approverDepartmentId)}>
            <FieldLabel htmlFor='rule-approver-department'>
              {t('personnelSettings.approverDepartment')} *
            </FieldLabel>
            <NativeSelect
              id='rule-approver-department'
              aria-required='true'
              aria-invalid={Boolean(errors.approverDepartmentId)}
              {...form.register('approverDepartmentId')}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {departmentOptions.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {'　'.repeat(d.depth)}
                  {d.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[errors.approverDepartmentId]} />
          </Field>
        ) : approverType === 'user' ? (
          <Field data-invalid={Boolean(errors.approverUserId)}>
            <FieldLabel htmlFor='rule-approver-user'>
              {t('personnelSettings.approverUserLabel')} *
            </FieldLabel>
            <NativeSelect
              id='rule-approver-user'
              aria-required='true'
              aria-invalid={Boolean(errors.approverUserId)}
              disabled={!users.data}
              {...form.register('approverUserId')}
            >
              <NativeSelectOption value=''>
                {users.error
                  ? t('talent.common.loadFailed')
                  : t('talent.common.choose')}
              </NativeSelectOption>
              {(users.data ?? []).map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.username ? `${u.name}（${u.username}）` : u.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[errors.approverUserId]} />
          </Field>
        ) : (
          <Field data-invalid={Boolean(errors.approverSet)}>
            <FieldLabel htmlFor='rule-approver-set'>
              {t('personnelSettings.approverSetLabel')} *
            </FieldLabel>
            <NativeSelect
              id='rule-approver-set'
              aria-required='true'
              aria-invalid={Boolean(errors.approverSet)}
              {...form.register('approverSet')}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {options.permissionSets.map((set) => (
                <NativeSelectOption key={set.key} value={set.key}>
                  {typeof set.title === 'string'
                    ? titleText(set.title, t)
                    : set.title &&
                        typeof set.title === 'object' &&
                        'key' in set.title
                      ? t(String((set.title as { key: string }).key), {
                          ns: (set.title as { ns?: string }).ns,
                        })
                      : set.key}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldError errors={[errors.approverSet]} />
          </Field>
        )}
        <Controller
          control={form.control}
          name='position'
          render={({ field }) => (
            <FieldSet>
              <FieldLegend variant='label'>
                {t('personnelSettings.rulePosition')}
              </FieldLegend>
              <RadioGroup value={field.value} onValueChange={field.onChange}>
                {(['afterFirst', 'afterHr'] as const).map((value) => (
                  <div key={value} className='flex items-center gap-2'>
                    <RadioGroupItem
                      value={value}
                      id={`rule-position-${value}`}
                    />
                    <Label htmlFor={`rule-position-${value}`}>
                      {t(`personnelSettings.position.${value}`)}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </FieldSet>
          )}
        />
        <Controller
          control={form.control}
          name='enabled'
          render={({ field }) => (
            <div className='flex items-center gap-2'>
              <Switch
                id='rule-enabled'
                checked={field.value}
                onCheckedChange={field.onChange}
              />
              <Label htmlFor='rule-enabled'>
                {t('personnelSettings.ruleEnabled')}
              </Label>
            </div>
          )}
        />
      </FieldGroup>
      <DialogFooter>
        <Button type='button' variant='outline' onClick={onCancel}>
          {t('actions.cancel')}
        </Button>
        <Button type='submit'>
          {t(rule ? 'actions.save' : 'talent.common.add')}
        </Button>
      </DialogFooter>
    </form>
  );
}
