/**
 * 离职证明模板 (V1-02 V2 增补 · 已离职员工的邮件往来): the separation
 * certificate mailed from the 人事邮箱 when a 离职单 takes effect is made from
 * this template, and nothing is mailed until an HR administrator has confirmed
 * it once. `GET/PUT talent/departed/template` require the personnel settings
 * permission; anyone else gets 403 and the card is not shown.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage, isForbidden } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** As `server/providers/hr/departed/service.ts` `template()` answers. */
interface DepartedTemplate {
  separationTemplate: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** The facts the template may name (server/providers/hr/departed/documents.ts `PersonFacts`). */
const PLACEHOLDERS = [
  'name',
  'employeeNo',
  'department',
  'position',
  'hireDate',
  'leaveDate',
  'company',
  'today',
] as const;

export function SeparationTemplateCard(): ReactElement | null {
  const remote = useRemote<DepartedTemplate>('talent/departed/template');
  if (remote.error && isForbidden(remote.error)) return null;
  if (remote.error)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={4} />;
  return (
    <TemplateForm
      // Mounted again after each confirmation, so the text starts from what was saved.
      key={remote.data.confirmedAt ?? 'unconfirmed'}
      loaded={remote.data}
      onSaved={remote.reload}
    />
  );
}

function TemplateForm({
  loaded,
  onSaved,
}: {
  loaded: DepartedTemplate;
  onSaved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [text, setText] = useState(loaded.separationTemplate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const users = useRemote<{ id: string; name: string }[]>(
    loaded.confirmedBy ? 'talent/users' : null,
  );
  const confirmedBy = loaded.confirmedBy
    ? (users.data?.find((u) => u.id === loaded.confirmedBy)?.name ??
      loaded.confirmedBy)
    : '';
  const changed = text !== loaded.separationTemplate;
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function confirm(): Promise<void> {
    if (!text.trim()) {
      setError(t('departedTemplate.required'));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/departed/template',
        method: 'PUT',
        json: { separationTemplate: text },
      });
      toast.add({ type: 'success', title: t('departedTemplate.confirmed') });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('departedTemplate.title')}</CardTitle>
        <CardDescription>{t('departedTemplate.description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          {loaded.confirmedAt && !changed ? (
            <p className='flex items-center gap-2 text-sm text-muted-foreground'>
              <CheckIcon className='size-4 shrink-0' />
              {t('departedTemplate.confirmedBy', {
                name: confirmedBy,
                at: format.format(new Date(loaded.confirmedAt)),
              })}
            </p>
          ) : (
            <Alert>
              <TriangleAlertIcon />
              <AlertDescription>
                {loaded.confirmedAt
                  ? t('departedTemplate.changedWarning')
                  : t('departedTemplate.unconfirmedWarning')}
              </AlertDescription>
            </Alert>
          )}
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor='departed-template'>
              {t('departedTemplate.text')}
            </FieldLabel>
            <Textarea
              id='departed-template'
              rows={8}
              maxLength={4000}
              value={text}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setError(undefined);
                setText(e.target.value);
              }}
            />
            <FieldDescription>
              {t('departedTemplate.placeholders', {
                list: PLACEHOLDERS.map(
                  (p) => `{{${p}}} ${t(`departedTemplate.placeholder.${p}`)}`,
                ).join('；'),
                interpolation: { escapeValue: false },
              })}
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
          <div>
            <Button
              disabled={saving || (Boolean(loaded.confirmedAt) && !changed)}
              onClick={() => void confirm()}
            >
              {saving ? <Spinner data-icon='inline-start' /> : null}
              {t('departedTemplate.confirm')}
            </Button>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
