import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
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
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

interface ExamSettings {
  examRules: {
    value: { minWeight: number; fullRate: number; partialRate: number };
    revision: number;
  };
}

const percent = (value: number) => String(Math.round(value * 100));

/** V3-10 考试 → 能力等级规则: the administrator adjusts the score share and the two rates; the next scoring uses them. */
export function ExamRulesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const settings = useRemote<ExamSettings>(
    open ? 'talent/exam-settings' : null,
  );
  const [form, setForm] = useState<{
    minWeight: string;
    fullRate: string;
    partialRate: string;
  } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const current = settings.data?.examRules;
  const values =
    form ??
    (current
      ? {
          minWeight: percent(current.value.minWeight),
          fullRate: percent(current.value.fullRate),
          partialRate: percent(current.value.partialRate),
        }
      : null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!values || !current) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/exam-settings/examRules',
        method: 'PUT',
        json: {
          revision: current.revision,
          value: {
            minWeight: Number(values.minWeight) / 100,
            fullRate: Number(values.fullRate) / 100,
            partialRate: Number(values.partialRate) / 100,
          },
        },
      });
      toast.add({ type: 'success', title: t('talent.examRules.saved') });
      setForm(null);
      settings.reload();
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const field = (key: 'minWeight' | 'fullRate' | 'partialRate') => (
    <Field>
      <FieldLabel htmlFor={`exam-rule-${key}`}>
        {t(`talent.examRules.${key}`)}
      </FieldLabel>
      <Input
        id={`exam-rule-${key}`}
        type='number'
        min={0}
        max={100}
        value={values?.[key] ?? ''}
        onChange={(e) =>
          values && setForm({ ...values, [key]: e.target.value })
        }
      />
      <FieldDescription>{t(`talent.examRules.${key}Hint`)}</FieldDescription>
    </Field>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setForm(null);
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talent.examRules.title')}</DialogTitle>
          <DialogDescription>
            {t('talent.examRules.description')}
          </DialogDescription>
        </DialogHeader>
        {!values ? (
          <Spinner />
        ) : (
          <form id='exam-rules-form' onSubmit={(e) => void submit(e)}>
            <FieldGroup>
              {field('minWeight')}
              {field('fullRate')}
              {field('partialRate')}
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          </form>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            type='submit'
            form='exam-rules-form'
            disabled={busy || !values}
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
