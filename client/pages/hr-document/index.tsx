/**
 * （公开）人事文件 `/hr-document/:token` (V1-02 V2 增补 · 已离职员工的邮件往来):
 * the link mailed to a departed employee's personal address (离职证明, 工资条,
 * 收入证明, 工作经历证明). It shows only the document's title and expiry; the
 * PDF downloads after the one-time code sent to that address is entered. An
 * expired link shows nothing else. Usable at 375px.
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

interface SharedDocument {
  title: string;
  company: string;
  recipient: string;
  expiresAt: string | null;
  fileName: string;
}

export default function HrDocumentPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const { token = '' } = useParams();
  const path = `public/hr-document/${encodeURIComponent(token)}`;
  const pack = useRemote<SharedDocument>(path);
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
      anchor.download = pack.data?.fileName ?? 'document.pdf';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setCode('');
      setSent(null);
      setNotice(t('hrDocument.downloaded'));
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
          {t('hrDocument.invalid')}
        </p>
      ) : !data ? (
        <Skeleton className='h-40 w-full' />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{data.title}</CardTitle>
            <CardDescription>
              {t('hrDocument.description', {
                company: data.company,
                title: data.title,
              })}
            </CardDescription>
          </CardHeader>
          <CardContent className='space-y-4'>
            {data.expiresAt ? (
              <p className='text-sm'>
                {t('hrDocument.expires', {
                  at: format.format(new Date(data.expiresAt)),
                })}
              </p>
            ) : null}
            <Field>
              <FieldLabel htmlFor='document-code'>
                {t('hrDocument.code')}
              </FieldLabel>
              <div className='flex gap-2'>
                <Input
                  id='document-code'
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
                  {t('hrDocument.sendCode')}
                </Button>
              </div>
              <FieldDescription>
                {sent
                  ? t('hrDocument.codeSent', { address: sent })
                  : t('hrDocument.codeHint', { address: data.recipient })}
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
              {t('hrDocument.download')}
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
