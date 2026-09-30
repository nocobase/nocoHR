/**
 * V4-13 设置 · 外部 AI 助手 (`/settings/agent-clients`, hr.admin): the
 * external clients (name, owner, allowed tools, active / revoked), every
 * user's personal access tokens (revoke any), the audit log by client, and
 * the per-minute call limit. Tokens are issued by each user for themselves
 * in 我的档案 · 连接 AI 助手; the MCP endpoint is `/api/talent/agent/mcp`.
 */
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { formatDate, useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Client {
  id: string;
  name: string;
  ownerName: string;
  allowedTools: string[];
  status: string;
  activeTokens: number;
}
interface Token {
  id: string;
  clientId: string;
  userName: string;
  prefix: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}
interface Log {
  id: string;
  userName: string;
  tool: string;
  status: string;
  summary: string;
  calledAt: string | null;
}

export default function AgentClientsSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const clients = useRemote<{ clients: Client[]; tools: { name: string; audience: string }[] }>(
    'talent/agent-clients/clients',
  );
  const tokens = useRemote<Token[]>('talent/agent-clients/tokens');
  const [clientId, setClientId] = useState('');
  const logs = useRemote<Log[]>('talent/agent-clients/logs', { clientId: clientId || undefined });
  const settings = useRemote<{ value: { agentRateLimitPerMinute: number; agentTokenMaxDays: number } }>(
    'talent/talent-reviews/settings',
  );
  const action = useTrAction();
  const [editing, setEditing] = useState<Client | 'new' | null>(null);
  const [limit, setLimit] = useState('');
  return (
    <PageContainer>
      <PageHeader
        title={t('talentReview.agents.title')}
        description={t('talentReview.agents.description')}
        actions={
          <Button onClick={() => setEditing('new')}>
            <PlusIcon data-icon='inline-start' />
            {t('talentReview.agents.create')}
          </Button>
        }
      />
      {action.error ? (
        <Alert variant='destructive'>
          <AlertDescription>{action.error}</AlertDescription>
        </Alert>
      ) : null}
      {clients.error ? (
        <LoadError error={clients.error} onRetry={clients.reload} />
      ) : !clients.data ? (
        <BlockSkeleton rows={3} />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('talentReview.agents.clients')}</CardTitle>
          </CardHeader>
          <CardContent className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talentReview.agents.name')}</TableHead>
                  <TableHead>{t('talentReview.agents.owner')}</TableHead>
                  <TableHead>{t('talentReview.agents.tools')}</TableHead>
                  <TableHead className='text-end'>{t('talentReview.agents.activeTokens')}</TableHead>
                  <TableHead>{t('talentReview.common.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.data.clients.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className='font-medium'>{c.name}</TableCell>
                    <TableCell>{c.ownerName}</TableCell>
                    <TableCell className='max-w-80 text-xs'>
                      {c.allowedTools.map((tool) => t(`talentReview.agents.tool.${tool}`)).join('、')}
                    </TableCell>
                    <TableCell className='text-end tabular-nums'>{c.activeTokens}</TableCell>
                    <TableCell>
                      <TrStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell className='text-end'>
                      <Button size='sm' variant='outline' onClick={() => setEditing(c)}>
                        {t('talentReview.common.edit')}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>{t('talentReview.agents.tokens')}</CardTitle>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.agents.user')}</TableHead>
                <TableHead>{t('talentReview.agents.prefix')}</TableHead>
                <TableHead>{t('talentReview.agents.expiresAt')}</TableHead>
                <TableHead>{t('talentReview.agents.lastUsed')}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tokens.data ?? []).map((token) => (
                <TableRow key={token.id}>
                  <TableCell>{token.userName}</TableCell>
                  <TableCell className='font-mono text-xs'>{token.prefix}…</TableCell>
                  <TableCell>{formatDate(locale, token.expiresAt)}</TableCell>
                  <TableCell>{formatDate(locale, token.lastUsedAt)}</TableCell>
                  <TableCell className='text-end'>
                    {token.revokedAt ? (
                      <TrStatusBadge status='revoked' />
                    ) : (
                      <Button
                        size='sm'
                        variant='outline'
                        disabled={action.busy}
                        onClick={() => { void (async () => {
                          const done = await action.run(
                            { method: 'POST', path: `talent/agent-clients/tokens/${encodeURIComponent(token.id)}/revoke` },
                            t('talentReview.agents.revoked'),
                          );
                          if (done) tokens.reload();
                        })(); }}
                      >
                        {t('talentReview.agents.revoke')}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-2'>
          <CardTitle>{t('talentReview.agents.logs')}</CardTitle>
          <NativeSelect aria-label={t('talentReview.agents.client')} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <NativeSelectOption value=''>{t('talentReview.agents.allClients')}</NativeSelectOption>
            {(clients.data?.clients ?? []).map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </CardHeader>
        <CardContent className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.agents.calledAt')}</TableHead>
                <TableHead>{t('talentReview.agents.user')}</TableHead>
                <TableHead>{t('talentReview.agents.toolName')}</TableHead>
                <TableHead>{t('talentReview.common.status')}</TableHead>
                <TableHead>{t('talentReview.agents.summary')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(logs.data ?? []).map((log) => (
                <TableRow key={log.id}>
                  <TableCell className='whitespace-nowrap'>
                    {log.calledAt ? new Date(log.calledAt).toLocaleString(locale) : '—'}
                  </TableCell>
                  <TableCell>{log.userName}</TableCell>
                  <TableCell>{log.tool}</TableCell>
                  <TableCell>{t(`talentReview.agents.callStatus.${log.status}`)}</TableCell>
                  <TableCell className='text-xs'>{log.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      {settings.data ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talentReview.agents.limits')}</CardTitle>
          </CardHeader>
          <CardContent className='flex flex-wrap items-end gap-2'>
            <Field className='w-56'>
              <FieldLabel htmlFor='agent-limit'>{t('talentReview.agents.ratePerMinute')}</FieldLabel>
              <Input
                id='agent-limit'
                type='number'
                min={1}
                value={limit || String(settings.data.value.agentRateLimitPerMinute)}
                onChange={(e) => setLimit(e.target.value)}
              />
            </Field>
            <Button
              disabled={action.busy || !limit}
              onClick={() => { void (async () => {
                const done = await action.run(
                  { method: 'PUT', path: 'talent/talent-reviews/settings/agent', json: { agentRateLimitPerMinute: Number(limit) } },
                  t('talentReview.agents.limitSaved'),
                );
                if (done) {
                  setLimit('');
                  settings.reload();
                }
              })(); }}
            >
              {t('talentReview.common.save')}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      {editing && clients.data ? (
        <ClientDialog
          client={editing === 'new' ? null : editing}
          tools={clients.data.tools.map((tool) => tool.name)}
          onClose={() => setEditing(null)}
          onDone={clients.reload}
        />
      ) : null}
    </PageContainer>
  );
}

function ClientDialog({
  client,
  tools,
  onClose,
  onDone,
}: {
  client: Client | null;
  tools: string[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const [name, setName] = useState(client?.name ?? '');
  const [allowed, setAllowed] = useState<string[]>(client?.allowedTools ?? tools);
  const [status, setStatus] = useState(client?.status ?? 'active');
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{client ? client.name : t('talentReview.agents.create')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <Field>
            <FieldLabel htmlFor='ac-name'>{t('talentReview.agents.name')}</FieldLabel>
            <Input id='ac-name' value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset className='flex flex-col gap-1.5'>
            <legend className='mb-1 text-sm font-medium'>{t('talentReview.agents.tools')}</legend>
            {tools.map((tool) => (
              <label key={tool} className='flex items-center gap-2 text-sm'>
                <Checkbox
                  checked={allowed.includes(tool)}
                  onCheckedChange={(value) =>
                    setAllowed((list) => (value === true ? [...list, tool] : list.filter((x) => x !== tool)))
                  }
                />
                {t(`talentReview.agents.tool.${tool}`)}
              </label>
            ))}
          </fieldset>
          <Field>
            <FieldLabel htmlFor='ac-status'>{t('talentReview.common.status')}</FieldLabel>
            <NativeSelect id='ac-status' value={status} onChange={(e) => setStatus(e.target.value)}>
              <NativeSelectOption value='active'>{t('talentReview.status.active')}</NativeSelectOption>
              <NativeSelectOption value='revoked'>{t('talentReview.status.revoked')}</NativeSelectOption>
            </NativeSelect>
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !name.trim() || !allowed.length}
            onClick={() => { void (async () => {
              const json = { name, allowedTools: allowed, status };
              const done = await action.run(
                client
                  ? { method: 'PUT', path: `talent/agent-clients/clients/${encodeURIComponent(client.id)}`, json }
                  : { method: 'POST', path: 'talent/agent-clients/clients', json },
                t('talentReview.agents.saved'),
              );
              if (done) {
                onDone();
                onClose();
              }
            })(); }}
          >
            {t('talentReview.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
