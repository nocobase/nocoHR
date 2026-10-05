/**
 * （公开）客户审核包 `/audit-pack/:token` (V3-11 客户审核问询): the customer's
 * share link from the reply. It shows only the customer and the expiry; the
 * pack downloads after the one-time code sent to the requester's address is
 * entered. A revoked or expired link shows nothing else. Usable at 375px.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, MailIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import { useRemote } from '@/components/talent/use-remote';
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
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

interface SharedPack {
  customerName: string;
  company: string;
  requester: string;
  expiresAt: string | null;
  fileName: string;
}

export default function AuditPackPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const { token = '' } = useParams();
  const path = `public/audit-pack/${encodeURIComponent(token)}`;
  const pack = useRemote<SharedPack>(path);
  const [code, setCode] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'code' | 'download' | null>(null);
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  async function sendCode(): Promise<void> {
    setBusy('code');
    setError(null);
    try {
      const response = await api.request<{ data: { sentTo: string } }>({
        path: `${path}/code`,
        method: 'POST',
        json: {},
      });
      setSent(response.data.sentTo);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(null);
    }
  }

  async function download(): Promise<void> {
    setBusy('download');
    setError(null);
    try {
      const stream = await api.stream({
        path: `${path}/download`,
        method: 'POST',
        json: { code },
      });
      const blob = await new Response(stream).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = pack.data?.fileName ?? 'audit-pack.zip';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCode('');
      setSent(null);
      setNotice(t('auditPack.downloaded'));
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(null);
    }
  }

  const data = pack.data;
  return (
    <main className='mx-auto w-full max-w-xl space-y-4 px-4 py-8'>
      {pack.error ? (
        <p className='text-sm text-muted-foreground'>
          {t('auditPack.invalid')}
        </p>
      ) : !data ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('auditPack.title')}</CardTitle>
            <CardDescription>
              {t('auditPack.description', {
                company: data.company,
                customer: data.customerName,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {data.expiresAt ? (
              <p className='text-sm'>
                {t('auditPack.expires', {
                  at: format.format(new Date(data.expiresAt)),
                })}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor='audit-code'>
                {t('auditPack.code')}
              </FieldLabel>
              <div className='flex gap-2'>
                <Input
                  id='audit-code'
                  inputMode='numeric'
                  autoComplete='one-time-code'
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/gu, ''))}
                />
                <Button
                  variant='outline'
                  disabled={busy !== null}
                  onClick={() => void sendCode()}
                >
                  {busy === 'code' ? (
                    <Spinner data-icon='inline-start' />
                  ) : (
                    <MailIcon data-icon='inline-start' />
                  )}
                  {t('auditPack.sendCode')}
                </Button>
              </div>
              <FieldDescription>
                {sent
                  ? t('auditPack.codeSent', { address: sent })
                  : t('auditPack.codeHint', { address: data.requester })}
              </FieldDescription>
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
            <Button
              className='w-full'
              disabled={busy !== null || code.length !== 6}
              onClick={() => void download()}
            >
              {busy === 'download' ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <DownloadIcon data-icon='inline-start' />
              )}
              {t('auditPack.download')}
            </Button>
            {notice ? (
              <p className='text-sm text-muted-foreground'>{notice}</p>
            ) : null}
          </CardContent>
        </Card>
      )}
    </main>
  );
}
