/**
 * 简历回执 (V2-07 招聘邮箱): a resume taken in by mail is answered with this
 * receipt, and nothing is sent until a recruiter has confirmed its wording
 * once. `GET/PUT talent/mail/recruiting/receipt-template` answer only those
 * who send the recruiting mailbox's mail; anyone else gets 403 and nothing is
 * shown. The page shows a reminder while it is unconfirmed and a button that
 * opens the template in a sheet.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CheckIcon, MailCheckIcon, TriangleAlertIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage, isForbidden } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

/** As `server/providers/hr/mail/recruiting.ts` `receiptTemplate()` answers. */
interface ReceiptTemplate {
  subject: string;
  body: string;
  confirmedAt: string | null;
  confirmedBy: string | null;
  confirmedByName: string | null;
}

const PLACEHOLDERS = [
  'name',
  'posting',
  'months',
  'sender',
  'deleteLink',
] as const;

/** The reminder and the button; rendered on the 招聘邮箱 only. */
export function ReceiptTemplateControl(): ReactElement | null {
  const { t } = useTranslation();
  const remote = useRemote<ReceiptTemplate>(
    'talent/mail/recruiting/receipt-template',
  );
  const [open, setOpen] = useState(false);
  if (!remote.data || (remote.error && isForbidden(remote.error))) return null;
  const data = remote.data;
  return (
    <>
      {data.confirmedAt ? (
        <Button variant='outline' size='sm' onClick={() => setOpen(true)}>
          <MailCheckIcon data-icon='inline-start' />
          {t('mail.receipt.open')}
        </Button>
      ) : (
        <Alert className='basis-full'>
          <TriangleAlertIcon />
          <AlertDescription>{t('mail.receipt.unconfirmed')}</AlertDescription>
          <AlertAction>
            <Button size='sm' onClick={() => setOpen(true)}>
              {t('mail.receipt.review')}
            </Button>
          </AlertAction>
        </Alert>
      )}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className='w-full gap-0 sm:max-w-lg'>
          <SheetHeader>
            <SheetTitle>{t('mail.receipt.title')}</SheetTitle>
            <SheetDescription>{t('mail.receipt.description')}</SheetDescription>
          </SheetHeader>
          {open ? (
            <ReceiptForm
              key={data.confirmedAt ?? 'unconfirmed'}
              loaded={data}
              onSaved={() => {
                setOpen(false);
                remote.reload();
              }}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function ReceiptForm({
  loaded,
  onSaved,
}: {
  loaded: ReceiptTemplate;
  onSaved: () => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [subject, setSubject] = useState(loaded.subject);
  const [body, setBody] = useState(loaded.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const confirmedBy = loaded.confirmedByName ?? '';
  const changed = subject !== loaded.subject || body !== loaded.body;
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function confirm(): Promise<void> {
    if (!subject.trim() || !body.trim()) {
      setError(t('mail.receipt.required'));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/mail/recruiting/receipt-template',
        method: 'PUT',
        json: { subject, body },
      });
      toast.add({ type: 'success', title: t('mail.receipt.confirmed') });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className='flex-1 overflow-y-auto px-4'>
        <FieldGroup>
          {loaded.confirmedAt && !changed ? (
            <p className='flex items-center gap-2 text-sm text-muted-foreground'>
              <CheckIcon className='size-4 shrink-0' />
              {t('mail.receipt.confirmedBy', {
                name: confirmedBy,
                at: format.format(new Date(loaded.confirmedAt)),
              })}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor='receipt-subject'>
              {t('mail.receipt.subject')}
            </FieldLabel>
            <Input
              id='receipt-subject'
              maxLength={200}
              value={subject}
              onChange={(e) => {
                setError(undefined);
                setSubject(e.target.value);
              }}
            />
          </Field>
          <Field data-invalid={Boolean(error)}>
            <FieldLabel htmlFor='receipt-body'>
              {t('mail.receipt.body')}
            </FieldLabel>
            <Textarea
              id='receipt-body'
              rows={10}
              maxLength={4000}
              value={body}
              aria-invalid={Boolean(error)}
              onChange={(e) => {
                setError(undefined);
                setBody(e.target.value);
              }}
            />
            <FieldDescription>
              {t('mail.receipt.placeholders', {
                list: PLACEHOLDERS.map(
                  (p) => `{{${p}}} ${t(`mail.receipt.placeholder.${p}`)}`,
                ).join('；'),
                interpolation: { escapeValue: false },
              })}
            </FieldDescription>
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
      </div>
      <SheetFooter>
        <Button
          disabled={saving || (Boolean(loaded.confirmedAt) && !changed)}
          onClick={() => void confirm()}
        >
          {saving ? <Spinner data-icon='inline-start' /> : null}
          {t('mail.receipt.confirm')}
        </Button>
      </SheetFooter>
    </>
  );
}
