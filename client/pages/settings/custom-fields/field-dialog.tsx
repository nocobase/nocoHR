import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, XIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import {
  placementsOf,
  type CustomFieldDefinition,
  type CustomFieldPlacement,
  type CustomFieldType,
} from '@/components/talent/custom-field-model';
import { errorMessage } from '@/components/talent/errors';
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
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

const TYPES: CustomFieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multiSelect',
  'boolean',
];

/**
 * Adds or edits one field. The type is fixed once created (stored values keep
 * their meaning); options can be added or switched off but not removed.
 */
export function FieldDialog({
  collection,
  definition,
  onClose,
  onSaved,
}: {
  readonly collection: string;
  readonly definition: CustomFieldDefinition | null;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [label, setLabel] = useState(definition?.label['zh-CN'] ?? '');
  const [labelEn, setLabelEn] = useState(definition?.label['en-US'] ?? '');
  const [type, setType] = useState<CustomFieldType>(definition?.type ?? 'text');
  const [options, setOptions] = useState(
    definition?.options ?? ([] as CustomFieldDefinition['options']),
  );
  const [newOption, setNewOption] = useState('');
  // Only the placements this table offers (the framework tables: 详情 and 列表; 请假单: 填写表单 and 详情).
  const available = placementsOf(collection);
  const [placements, setPlacements] = useState<CustomFieldPlacement[]>(
    definition?.placements ??
      available.filter((p) => p === 'detail' || p === 'list' || p === 'form'),
  );
  const [required, setRequired] = useState(definition?.required ?? false);
  const [sensitive, setSensitive] = useState(definition?.sensitive ?? false);
  const [aiReadable, setAiReadable] = useState(definition?.aiReadable ?? false);
  const [saving, setSaving] = useState(false);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const choice = type === 'select' || type === 'multiSelect';

  function addOption() {
    const text = newOption.trim();
    if (!text || options.some((o) => o.label === text)) return;
    let n = options.length + 1;
    while (options.some((o) => o.value === `o${n}`)) n += 1;
    setOptions([...options, { value: `o${n}`, label: text, active: true }]);
    setNewOption('');
  }

  async function save() {
    if (!label.trim()) {
      setLabelError(t('customFields.labelRequired'));
      return;
    }
    if (choice && !options.some((o) => o.active)) {
      setError(t('talent.errors.CUSTOM_FIELD_OPTIONS_REQUIRED'));
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      label: { 'zh-CN': label.trim(), 'en-US': labelEn.trim() || null },
      options: choice ? options : [],
      placements: sensitive
        ? placements.filter((p) => p !== 'selfService')
        : placements,
      required,
      sensitive,
      aiReadable,
    };
    try {
      if (definition)
        await api.request({
          path: `talent/custom-fields/${definition.id}`,
          method: 'PATCH',
          json: body,
        });
      else
        await api.request({
          path: 'talent/custom-fields',
          method: 'POST',
          json: { ...body, collection, type },
        });
      toast.add({
        type: 'success',
        title: t('customFields.saved', { label: label.trim() }),
      });
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90dvh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {t(definition ? 'customFields.editTitle' : 'customFields.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('customFields.dialogHint')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field data-invalid={Boolean(labelError)}>
            <FieldLabel htmlFor='cf-label'>
              {t('customFields.label')} *
            </FieldLabel>
            <Input
              id='cf-label'
              value={label}
              maxLength={40}
              aria-invalid={Boolean(labelError)}
              onChange={(event) => {
                setLabel(event.target.value);
                setLabelError(null);
              }}
            />
            <FieldError
              errors={labelError ? [{ message: labelError }] : undefined}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='cf-label-en'>
              {t('customFields.labelEn')}
            </FieldLabel>
            <Input
              id='cf-label-en'
              value={labelEn}
              maxLength={60}
              onChange={(event) => setLabelEn(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='cf-type'>{t('customFields.type')}</FieldLabel>
            <NativeSelect
              id='cf-type'
              value={type}
              disabled={Boolean(definition)}
              onChange={(event) =>
                setType(event.target.value as CustomFieldType)
              }
            >
              {TYPES.map((value) => (
                <NativeSelectOption key={value} value={value}>
                  {t(`customFields.types.${value}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            {definition ? (
              <FieldDescription>{t('customFields.typeFixed')}</FieldDescription>
            ) : null}
          </Field>
          {choice ? (
            <Field>
              <FieldLabel htmlFor='cf-option'>
                {t('customFields.options')}
              </FieldLabel>
              <ul className='flex flex-col gap-2'>
                {options.map((option, index) => (
                  <li
                    key={option.value}
                    className='flex items-center justify-between gap-2 text-sm'
                  >
                    <span
                      className={
                        option.active
                          ? ''
                          : 'text-muted-foreground line-through'
                      }
                    >
                      {option.label}
                    </span>
                    <Button
                      type='button'
                      size='sm'
                      variant='ghost'
                      onClick={() =>
                        setOptions(
                          options.map((o, i) =>
                            i === index ? { ...o, active: !o.active } : o,
                          ),
                        )
                      }
                    >
                      {t(
                        option.active
                          ? 'customFields.disableOption'
                          : 'customFields.enableOption',
                      )}
                    </Button>
                  </li>
                ))}
              </ul>
              <div className='flex gap-2'>
                <Input
                  id='cf-option'
                  value={newOption}
                  maxLength={64}
                  onChange={(event) => setNewOption(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      addOption();
                    }
                  }}
                />
                <Button type='button' variant='outline' onClick={addOption}>
                  <PlusIcon data-icon='inline-start' />
                  {t('customFields.addOption')}
                </Button>
              </div>
              <FieldDescription>
                {t('customFields.optionsHint')}
              </FieldDescription>
            </Field>
          ) : null}
          <Field>
            <FieldLabel>{t('customFields.placementsLabel')}</FieldLabel>
            <div className='grid grid-cols-1 gap-2 sm:grid-cols-2'>
              {available.map((placement) => {
                const blocked = placement === 'selfService' && sensitive;
                return (
                  <label
                    key={placement}
                    className='flex min-h-11 items-center gap-2 text-sm sm:min-h-0'
                  >
                    <Checkbox
                      checked={placements.includes(placement) && !blocked}
                      disabled={blocked}
                      onCheckedChange={(checked) =>
                        setPlacements(
                          checked
                            ? [...placements, placement]
                            : placements.filter((p) => p !== placement),
                        )
                      }
                    />
                    {t(`customFields.placements.${placement}`)}
                  </label>
                );
              })}
            </div>
          </Field>
          <Field orientation='horizontal'>
            <Switch
              id='cf-required'
              checked={required}
              onCheckedChange={setRequired}
            />
            <FieldLabel htmlFor='cf-required'>
              {t('customFields.required')}
            </FieldLabel>
          </Field>
          <Field orientation='horizontal'>
            <Switch
              id='cf-sensitive'
              checked={sensitive}
              onCheckedChange={setSensitive}
            />
            <FieldLabel htmlFor='cf-sensitive'>
              {t('customFields.sensitive')}
            </FieldLabel>
          </Field>
          <FieldDescription>{t('customFields.sensitiveHint')}</FieldDescription>
          <Field orientation='horizontal'>
            <Switch
              id='cf-ai'
              checked={aiReadable}
              onCheckedChange={setAiReadable}
            />
            <FieldLabel htmlFor='cf-ai'>
              {/* For candidates the flag is V2-07's 可用于初筛. */}
              {t(
                collection === 'candidates'
                  ? 'customFields.aiReadableCandidates'
                  : 'customFields.aiReadable',
              )}
            </FieldLabel>
          </Field>
          <FieldDescription>
            {t(
              collection === 'candidates'
                ? 'customFields.aiReadableCandidatesHint'
                : 'customFields.aiReadableHint',
            )}
          </FieldDescription>
        </FieldGroup>
        <DialogFooter>
          <Button variant='outline' onClick={onClose} disabled={saving}>
            <XIcon data-icon='inline-start' />
            {t('actions.cancel')}
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
