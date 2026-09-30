/**
 * V4-13 我的档案 · 连接 AI 助手 (for client/pages/talent/me, owned by another
 * session: mount as `<AgentConnectCard />`). Each user makes a personal
 * access token for an active client (at most 90 days), sees it once, copies
 * the MCP address, and revokes it at any time. Usable at 375 px.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { formatDate, useTrAction } from './talent-review-lib.js';
import { TrStatusBadge } from './talent-review-shared.js';
import { useRemote } from './use-remote.js';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

interface Mine {
  clients: { id: string; name: string }[];
  tokens: {
    id: string;
    clientName: string;
    prefix: string;
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }[];
  maxDays: number;
}

export function AgentConnectCard(): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const mine = useRemote<Mine>('talent/agent-clients/mine');
  const action = useTrAction();
  const [clientId, setClientId] = useState('');
  const [days, setDays] = useState('30');
  const [secret, setSecret] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  if (!mine.data) return null;
  const endpoint = `${globalThis.location?.origin ?? ''}${(globalThis.location?.pathname ?? '').replace(/\/talent\/.*$/u, '')}/api/talent/agent/mcp`;
  const active = (token: Mine['tokens'][number]) =>
    !token.revokedAt && token.expiresAt !== null && new Date(token.expiresAt).getTime() > now;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talentReview.connect.title')}</CardTitle>
        <CardDescription>{t('talentReview.connect.description')}</CardDescription>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <div className='grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end'>
          <Field>
            <FieldLabel htmlFor='connect-client'>{t('talentReview.connect.client')}</FieldLabel>
            <NativeSelect id='connect-client' value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {mine.data.clients.map((c) => (
                <NativeSelectOption key={c.id} value={c.id}>
                  {c.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='connect-days'>{t('talentReview.connect.days', { max: mine.data.maxDays })}</FieldLabel>
            <Input
              id='connect-days'
              type='number'
              min={1}
              max={mine.data.maxDays}
              value={days}
              onChange={(e) => setDays(e.target.value)}
            />
          </Field>
          <Button
            disabled={action.busy || !clientId}
            onClick={() => { void (async () => {
              const issued = await action.run<{ secret: string }>({
                method: 'POST',
                path: 'talent/agent-clients/tokens',
                json: { clientId, days: Number(days) || mine.data!.maxDays },
              });
              if (issued) {
                setSecret(issued.secret);
                mine.reload();
              }
            })(); }}
          >
            {t('talentReview.connect.issue')}
          </Button>
        </div>
        {secret ? (
          <Alert>
            <AlertDescription className='flex flex-col gap-1 break-all'>
              <span className='font-medium'>{t('talentReview.connect.once')}</span>
              <code className='font-mono text-xs'>{secret}</code>
              <span className='text-xs'>{t('talentReview.connect.endpoint', { url: endpoint })}</span>
            </AlertDescription>
          </Alert>
        ) : null}
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        {mine.data.tokens.map((token) => (
          <div key={token.id} className='flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm'>
            <span className='flex flex-col'>
              <span className='font-medium'>
                {token.clientName} · <span className='font-mono text-xs'>{token.prefix}…</span>
              </span>
              <span className='text-muted-foreground text-xs'>
                {t('talentReview.connect.tokenLine', {
                  expires: formatDate(locale, token.expiresAt),
                  used: formatDate(locale, token.lastUsedAt),
                })}
              </span>
            </span>
            {active(token) ? (
              <Button
                size='sm'
                variant='outline'
                disabled={action.busy}
                onClick={() => { void (async () => {
                  const done = await action.run(
                    { method: 'POST', path: `talent/agent-clients/tokens/${encodeURIComponent(token.id)}/revoke` },
                    t('talentReview.agents.revoked'),
                  );
                  if (done) mine.reload();
                })(); }}
              >
                {t('talentReview.agents.revoke')}
              </Button>
            ) : (
              <TrStatusBadge status={token.revokedAt ? 'revoked' : 'expired'} />
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
