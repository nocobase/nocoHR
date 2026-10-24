import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { useTranslation } from '@nocobase/i18n/client';
import { Check, Copy, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';

import { useAuthenticationClient } from '@nocobase/app-plugin-authentication/client';

import type { ApiKeySummary } from '@nocobase/app-plugin-api-keys/client';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '#components/ui/dialog';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  API_KEY_EXPIRY_CHOICES,
  expiryChoiceToSeconds,
  formatKeyHint,
  isExpired,
  type ApiKeyExpiryChoice,
} from '@nocobase/app-plugin-api-keys/client';

export default function ApiKeysPage(): ReactElement {
  const { t, i18n } = useTranslation();
  const auth = useAuthenticationClient();
  const [keys, setKeys] = useState<readonly ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeySummary>();
  // Held only until the reveal dialog closes. The server never returns it again.
  const [issued, setIssued] = useState<{ name: string; key: string }>();

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const { data, error: reason } = await auth.apiKey.list();
      if (reason) throw new Error(reason.message);
      setKeys(data?.apiKeys ?? []);
    } catch (reason) {
      setError(readError(reason, t('apiKeys.errors.loadFailed')));
    } finally {
      setLoading(false);
    }
  }, [auth, t]);

  useEffect(() => {
    // Loading the list is what this page mounts to do; `load` sets its
    // pending flag before the first await, which the rule cannot see past.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const create = async (
    name: string,
    expiry: ApiKeyExpiryChoice,
  ): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const expiresIn = expiryChoiceToSeconds(expiry);
      const { data, error: reason } = await auth.apiKey.create({
        name,
        ...(expiresIn === undefined ? {} : { expiresIn }),
      });
      if (reason) throw new Error(reason.message);
      if (!data?.key) throw new Error(t('apiKeys.errors.createFailed'));
      setCreating(false);
      setIssued({ name, key: data.key });
      await load();
    } catch (reason) {
      setError(readError(reason, t('apiKeys.errors.createFailed')));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (key: ApiKeySummary): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      const { error: reason } = await auth.apiKey.delete({ keyId: key.id });
      if (reason) throw new Error(reason.message);
      setRevoking(undefined);
      await load();
    } catch (reason) {
      setError(readError(reason, t('apiKeys.errors.revokeFailed')));
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (value: Date | string | null): string =>
    value
      ? new Date(value).toLocaleString(i18n.language)
      : t('apiKeys.page.never');

  return (
    <PageContainer>
      <PageHeader
        title={t('apiKeys.page.title')}
        description={t('apiKeys.page.description')}
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus /> {t('apiKeys.page.add')}
          </Button>
        }
      />

      {error ? (
        <div className='rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive'>
          {error}
        </div>
      ) : null}

      <div className='overflow-hidden rounded-xl border bg-card'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('apiKeys.page.columns.name')}</TableHead>
              <TableHead>{t('apiKeys.page.columns.key')}</TableHead>
              <TableHead>{t('apiKeys.page.columns.status')}</TableHead>
              <TableHead>{t('apiKeys.page.columns.lastUsed')}</TableHead>
              <TableHead>{t('apiKeys.page.columns.expires')}</TableHead>
              <TableHead className='w-14'>
                <span className='sr-only'>
                  {t('apiKeys.page.columns.actions')}
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='h-32 text-center text-muted-foreground'
                >
                  <LoaderCircle className='mx-auto size-5 animate-spin' />
                </TableCell>
              </TableRow>
            ) : keys.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='h-32 text-center text-muted-foreground'
                >
                  {t('apiKeys.page.empty')}
                </TableCell>
              </TableRow>
            ) : (
              keys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className='font-medium'>
                    {key.name ?? t('apiKeys.page.unnamed')}
                  </TableCell>
                  <TableCell className='font-mono text-xs text-muted-foreground'>
                    {formatKeyHint(key)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        key.enabled && !isExpired(key.expiresAt)
                          ? 'default'
                          : 'secondary'
                      }
                    >
                      {!key.enabled
                        ? t('apiKeys.page.disabled')
                        : isExpired(key.expiresAt)
                          ? t('apiKeys.page.expired')
                          : t('apiKeys.page.active')}
                    </Badge>
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>
                    {key.lastRequest
                      ? formatDate(key.lastRequest)
                      : t('apiKeys.page.unused')}
                  </TableCell>
                  <TableCell className='text-sm text-muted-foreground'>
                    {formatDate(key.expiresAt)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      aria-label={t('apiKeys.page.actions.revoke')}
                      onClick={() => setRevoking(key)}
                    >
                      <Trash2 />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <CreateKeyDialog
        open={creating}
        busy={busy}
        onOpenChange={setCreating}
        onSubmit={create}
      />
      <RevealKeyDialog issued={issued} onClose={() => setIssued(undefined)} />
      <RevokeKeyDialog
        target={revoking}
        busy={busy}
        onCancel={() => setRevoking(undefined)}
        onConfirm={revoke}
      />
    </PageContainer>
  );
}

function CreateKeyDialog({
  open,
  busy,
  onOpenChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly busy: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSubmit: (
    name: string,
    expiry: ApiKeyExpiryChoice,
  ) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [expiry, setExpiry] = useState<ApiKeyExpiryChoice>('90');

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    void onSubmit(name.trim(), expiry);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setName('');
          setExpiry('90');
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <form onSubmit={submit} className='space-y-4'>
          <DialogHeader>
            <DialogTitle>{t('apiKeys.form.title')}</DialogTitle>
            <DialogDescription>
              {t('apiKeys.form.description')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-2'>
            <Label htmlFor='api-key-name'>{t('apiKeys.form.name')}</Label>
            <Input
              id='api-key-name'
              value={name}
              required
              maxLength={32}
              placeholder={t('apiKeys.form.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className='space-y-2'>
            <Label>{t('apiKeys.form.expiry')}</Label>
            <Select
              items={API_KEY_EXPIRY_CHOICES.map((choice) => ({
                value: choice,
                label: t(`apiKeys.form.expiryChoices.${choice}`),
              }))}
              value={expiry}
              onValueChange={(value) => setExpiry(value as ApiKeyExpiryChoice)}
            >
              <SelectTrigger className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {API_KEY_EXPIRY_CHOICES.map((choice) => (
                  <SelectItem key={choice} value={choice}>
                    {t(`apiKeys.form.expiryChoices.${choice}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              {t('apiKeys.form.cancel')}
            </Button>
            <Button type='submit' disabled={busy || name.trim().length === 0}>
              {busy ? <LoaderCircle className='animate-spin' /> : null}
              {t('apiKeys.form.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RevealKeyDialog({
  issued,
  onClose,
}: {
  readonly issued: { readonly name: string; readonly key: string } | undefined;
  readonly onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <Dialog
      open={issued !== undefined}
      onOpenChange={(next) => {
        if (!next) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('apiKeys.reveal.title')}</DialogTitle>
          <DialogDescription>
            {t('apiKeys.reveal.description', { name: issued?.name ?? '' })}
          </DialogDescription>
        </DialogHeader>
        <div className='mt-4 flex items-center gap-2 rounded-lg border bg-muted/40 p-3'>
          <code className='flex-1 font-mono text-xs break-all'>
            {issued?.key}
          </code>
          <Button
            variant='outline'
            size='icon-sm'
            aria-label={t('apiKeys.reveal.copy')}
            onClick={() => {
              if (!issued) return;
              void navigator.clipboard
                .writeText(issued.key)
                .then(() => setCopied(true));
            }}
          >
            {copied ? <Check /> : <Copy />}
          </Button>
        </div>
        <p className='mt-3 text-sm text-muted-foreground'>
          {t('apiKeys.reveal.usage')}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t('apiKeys.reveal.done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({
  target,
  busy,
  onCancel,
  onConfirm,
}: {
  readonly target: ApiKeySummary | undefined;
  readonly busy: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: (key: ApiKeySummary) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog
      open={target !== undefined}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('apiKeys.revoke.title')}</DialogTitle>
          <DialogDescription>
            {t('apiKeys.revoke.description', {
              name: target?.name ?? t('apiKeys.page.unnamed'),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant='outline' onClick={onCancel}>
            {t('apiKeys.revoke.cancel')}
          </Button>
          <Button
            variant='destructive'
            disabled={busy}
            onClick={() => {
              if (target) void onConfirm(target);
            }}
          >
            {busy ? <LoaderCircle className='animate-spin' /> : null}
            {t('apiKeys.revoke.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function readError(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message;
  return fallback;
}
