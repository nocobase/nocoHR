import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import type { AntiCheat } from '@/components/talent/exam-types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';

/** V3-10 防作弊 and 简答题 AI 建议分: the settings an exam carries into every attempt. */
export function AntiCheatCard({
  value,
  aiGrading,
  disabled,
  onChange,
  onAiGradingChange,
}: {
  value: AntiCheat;
  aiGrading: boolean;
  disabled: boolean;
  onChange: (value: AntiCheat) => void;
  onAiGradingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const toggle = (key: 'shuffleOptions' | 'disableCopy' | 'singleDevice') => (
    <Field orientation='horizontal' className='justify-between'>
      <div>
        <FieldLabel htmlFor={`anti-${key}`}>
          {t(`talent.examIntegrity.settings.${key}`)}
        </FieldLabel>
        <FieldDescription>
          {t(`talent.examIntegrity.settings.${key}Hint`)}
        </FieldDescription>
      </div>
      <Switch
        id={`anti-${key}`}
        checked={value[key]}
        disabled={disabled}
        onCheckedChange={(checked) => onChange({ ...value, [key]: checked })}
      />
    </Field>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.examIntegrity.settings.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {toggle('shuffleOptions')}
          {toggle('disableCopy')}
          {toggle('singleDevice')}
          <div className='grid gap-4 sm:grid-cols-2'>
            <Field>
              <FieldLabel htmlFor='anti-max-blur'>
                {t('talent.examIntegrity.settings.maxBlurCount')}
              </FieldLabel>
              <Input
                id='anti-max-blur'
                type='number'
                min={0}
                max={100}
                value={String(value.maxBlurCount)}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    maxBlurCount: Math.max(
                      0,
                      Math.min(100, Math.round(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='anti-blur-action'>
                {t('talent.examIntegrity.settings.blurAction')}
              </FieldLabel>
              <NativeSelect
                id='anti-blur-action'
                className='w-full'
                value={value.blurAction}
                disabled={disabled}
                onChange={(e) =>
                  onChange({
                    ...value,
                    blurAction: e.target.value === 'submit' ? 'submit' : 'flag',
                  })
                }
              >
                <NativeSelectOption value='flag'>
                  {t('talent.examIntegrity.settings.blurActions.flag')}
                </NativeSelectOption>
                <NativeSelectOption value='submit'>
                  {t('talent.examIntegrity.settings.blurActions.submit')}
                </NativeSelectOption>
              </NativeSelect>
            </Field>
          </div>
          <Field orientation='horizontal' className='justify-between'>
            <div>
              <FieldLabel htmlFor='exam-ai-grading'>
                {t('talent.examIntegrity.settings.aiGrading')}
              </FieldLabel>
              <FieldDescription>
                {t('talent.examIntegrity.settings.aiGradingHint')}
              </FieldDescription>
            </div>
            <Switch
              id='exam-ai-grading'
              checked={aiGrading}
              disabled={disabled}
              onCheckedChange={(checked) => onAiGradingChange(checked)}
            />
          </Field>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
