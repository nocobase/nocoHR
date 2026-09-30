import { zodResolver } from '@hookform/resolvers/zod';
import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** `GET talent/learning-settings` (server/providers/hr/learning-settings.ts). */
export interface LearningRules {
  dueSoonDays: number;
  planExpiryDays: number;
  checkInOpensMinutes: number;
  minWatchPercent: number;
  onboardingBackfillDays: number;
}
export interface LearningSettings {
  value: LearningRules;
  defaults: LearningRules;
  revision: number;
  updatedAt: string | null;
}

type RuleKey = keyof LearningRules;
/** Each rule with the range the server accepts. */
const RULES: readonly { key: RuleKey; min: number; max: number }[] = [
  { key: 'dueSoonDays', min: 0, max: 30 },
  { key: 'planExpiryDays', min: 1, max: 90 },
  { key: 'checkInOpensMinutes', min: 0, max: 240 },
  { key: 'minWatchPercent', min: 10, max: 100 },
  { key: 'onboardingBackfillDays', min: 1, max: 3650 },
];

function toForm(value: LearningRules): Record<RuleKey, string> {
  return {
    dueSoonDays: String(value.dueSoonDays),
    planExpiryDays: String(value.planExpiryDays),
    checkInOpensMinutes: String(value.checkInOpensMinutes),
    minWatchPercent: String(value.minWatchPercent),
    onboardingBackfillDays: String(value.onboardingBackfillDays),
  };
}

/** One Card: the four rules, saved together at the revision they were loaded with. */
export function LearningRulesCard({
  initial,
  onReload,
}: {
  readonly initial: LearningSettings;
  readonly onReload: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [snapshot, setSnapshot] = useState(initial);
  const [conflict, setConflict] = useState(false);
  const schema = useMemo(
    () =>
      z.object(
        Object.fromEntries(
          RULES.map(({ key, min, max }) => [
            key,
            z
              .string()
              .refine(
                (v) =>
                  /^\d+$/u.test(v.trim()) &&
                  Number(v) >= min &&
                  Number(v) <= max,
                t('learningSettings.invalidRange', { min, max }),
              ),
          ]),
        ) as Record<RuleKey, z.ZodString>,
      ),
    [t],
  );
  const form = useForm({
    resolver: zodResolver(schema),
    mode: 'onTouched',
    defaultValues: toForm(initial.value),
  });
  const busy = form.formState.isSubmitting;
  const handleSave = form.handleSubmit(async (values) => {
    if (conflict || busy) return;
    try {
      const result = await api.request<{ data: LearningSettings }>({
        path: 'talent/learning-settings',
        method: 'PUT',
        json: {
          revision: snapshot.revision,
          value: Object.fromEntries(
            RULES.map(({ key }) => [key, Number(values[key])]),
          ),
        },
      });
      setSnapshot(result.data);
      form.reset(toForm(result.data.value));
      toast.add({ type: 'success', title: t('learningSettings.saved') });
    } catch (error) {
      const status = error instanceof ApiClientError ? error.status : undefined;
      setConflict(status === 409);
      form.setError('root', {
        message: t(
          status === 409
            ? 'learningSettings.conflict'
            : status === 403
              ? 'learningSettings.forbidden'
              : 'learningSettings.failed',
        ),
      });
    }
  });
  return (
    <form noValidate onSubmit={(event) => void handleSave(event)}>
      <Card>
        <CardHeader>
          <CardTitle>{t('learningSettings.rules.title')}</CardTitle>
          <CardDescription>
            {t('learningSettings.rules.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {form.formState.errors.root ? (
              <Alert variant='destructive'>
                <AlertDescription>
                  {form.formState.errors.root.message}
                </AlertDescription>
              </Alert>
            ) : null}
            {RULES.map(({ key }) => {
              const id = `learning-rule-${key}`;
              const error = form.formState.errors[key];
              return (
                <Field key={key} data-invalid={Boolean(error)}>
                  <FieldLabel htmlFor={id}>
                    {t(`learningSettings.rules.${key}`)} *
                  </FieldLabel>
                  <Input
                    {...form.register(key)}
                    id={id}
                    inputMode='numeric'
                    disabled={busy}
                    aria-required='true'
                    aria-invalid={Boolean(error)}
                  />
                  <FieldDescription>
                    {t(`learningSettings.rules.${key}Hint`, {
                      value: snapshot.defaults[key],
                    })}
                  </FieldDescription>
                  <FieldError errors={[error]} />
                </Field>
              );
            })}
          </FieldGroup>
        </CardContent>
        <CardFooter className='justify-end gap-2'>
          {conflict ? (
            <Button type='button' variant='outline' onClick={onReload}>
              {t('learningSettings.reload')}
            </Button>
          ) : null}
          <Button
            type='submit'
            variant='outline'
            disabled={busy || conflict || !form.formState.isDirty}
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t(busy ? 'learningSettings.saving' : 'actions.save')}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
