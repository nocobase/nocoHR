import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';

import {
  asText,
  displayValue,
  fieldLabel,
  type CustomFieldDefinition,
  type CustomValues,
} from './custom-field-model.js';

/**
 * 界面追加字段 (总纲 可定制约定). Definitions come from
 * `GET talent/custom-fields/definitions`; values arrive already filtered by
 * the record endpoints (sensitive fields only for those who may read them),
 * so these components render what they are given.
 */
/** Read-only label → value rows; fields without a value show a dash. */
export function CustomFieldValues({
  definitions,
  values,
}: {
  readonly definitions: readonly CustomFieldDefinition[];
  readonly values: CustomValues | undefined;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const shown = definitions.filter((d) => d.active || values?.[d.key] != null);
  if (!shown.length) return null;
  return (
    <dl className='grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2'>
      {shown.map((definition) => (
        <div key={definition.key} className='flex flex-col gap-1'>
          <dt className='text-muted-foreground'>
            {fieldLabel(definition, i18n.language)}
            {definition.active ? null : (
              <span className='ml-1 text-xs'>
                {t('customFields.inactiveSuffix')}
              </span>
            )}
          </dt>
          <dd className='break-words'>
            {displayValue(
              definition,
              values?.[definition.key],
              t('customFields.yes'),
              t('customFields.no'),
            ) || '—'}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Inputs for the given definitions. The value object is keyed by internal
 * key; `errors` carries the server's per-field codes from a failed save.
 */
export function CustomFieldInputs({
  definitions,
  values,
  onChange,
  errors,
  disabled,
  idPrefix,
}: {
  readonly definitions: readonly CustomFieldDefinition[];
  readonly values: CustomValues;
  readonly onChange: (next: CustomValues) => void;
  readonly errors?: Record<string, string>;
  readonly disabled?: boolean;
  readonly idPrefix: string;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const active = definitions.filter((d) => d.active);
  if (!active.length) return null;
  const set = (key: string, value: unknown) =>
    onChange({ ...values, [key]: value });
  return (
    <>
      {active.map((definition) => {
        const id = `${idPrefix}-${definition.key}`;
        const error = errors?.[definition.key];
        const label = `${fieldLabel(definition, i18n.language)}${
          definition.required ? ' *' : ''
        }`;
        const value = values[definition.key];
        const options = definition.options.filter(
          (o) => o.active || o.value === value,
        );
        let control: ReactElement;
        switch (definition.type) {
          case 'textarea':
            control = (
              <Textarea
                id={id}
                value={value == null ? '' : asText(value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => set(definition.key, event.target.value)}
              />
            );
            break;
          case 'number':
            control = (
              <Input
                id={id}
                inputMode='decimal'
                value={value == null ? '' : asText(value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => set(definition.key, event.target.value)}
              />
            );
            break;
          case 'date':
            control = (
              <Input
                id={id}
                type='date'
                value={value == null ? '' : asText(value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => set(definition.key, event.target.value)}
              />
            );
            break;
          case 'select':
            control = (
              <NativeSelect
                id={id}
                value={value == null ? '' : asText(value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => set(definition.key, event.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('customFields.choose')}
                </NativeSelectOption>
                {options.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            );
            break;
          case 'multiSelect': {
            const chosen = Array.isArray(value)
              ? value.map((v) => asText(v))
              : [];
            control = (
              <div className='flex flex-wrap gap-x-4 gap-y-2' id={id}>
                {options.map((option) => (
                  <label
                    key={option.value}
                    className='flex min-h-11 items-center gap-2 text-sm sm:min-h-0'
                  >
                    <Checkbox
                      checked={chosen.includes(option.value)}
                      disabled={disabled}
                      onCheckedChange={(checked) =>
                        set(
                          definition.key,
                          checked
                            ? [...chosen, option.value]
                            : chosen.filter((v) => v !== option.value),
                        )
                      }
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            );
            break;
          }
          case 'boolean':
            control = (
              <Switch
                id={id}
                checked={value === true}
                disabled={disabled}
                onCheckedChange={(checked) => set(definition.key, checked)}
              />
            );
            break;
          default:
            control = (
              <Input
                id={id}
                value={value == null ? '' : asText(value)}
                disabled={disabled}
                aria-invalid={Boolean(error)}
                onChange={(event) => set(definition.key, event.target.value)}
              />
            );
        }
        return (
          <Field key={definition.key} data-invalid={Boolean(error)}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {control}
            <FieldError
              errors={
                error ? [{ message: t(`talent.errors.${error}`) }] : undefined
              }
            />
          </Field>
        );
      })}
    </>
  );
}
