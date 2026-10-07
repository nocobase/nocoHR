import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CopyIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/** `POST talent/account-activation/bulk` (server/providers/hr/go-live/activation.ts). */
export interface ActivationResult {
  employeeId: string;
  name: string;
  login: string | null;
  accountCreated: boolean;
  expiresAt: string | null;
  outcome:
    | { status: 'sent'; channel: 'feishu' | 'email'; sentTo: string }
    | {
        status: 'manual';
        link: string;
        reason: 'noChannel' | 'deliveryFailed';
      }
    | { status: 'skipped'; reason: string };
}

/** Copies a link and confirms it; the link itself is never put in a toast. */
export function CopyLinkButton({ link }: { link: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <Button
      variant='outline'
      size='icon'
      aria-label={t('goLive.activation.copy')}
      onClick={() => {
        void navigator.clipboard?.writeText(link).then(() =>
          toast.add({
            type: 'success',
            title: t('goLive.activation.copied'),
          }),
        );
      }}
    >
      <CopyIcon />
    </Button>
  );
}

/** A link HR hands over, shown once, labelled with whose it is. */
export function HandOverLink({
  name,
  link,
  expiresAt,
}: {
  name: string;
  link: string;
  expiresAt: string | null;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const id = `activation-link-${name}`;
  return (
    <div className='flex flex-col gap-1.5'>
      <Label htmlFor={id}>{t('goLive.activation.linkLabel', { name })}</Label>
      <div className='flex gap-2'>
        <Input
          id={id}
          readOnly
          value={link}
          className='font-mono text-xs'
          onFocus={(event) => event.currentTarget.select()}
        />
        <CopyLinkButton link={link} />
      </div>
      {expiresAt ? (
        <p className='text-xs text-muted-foreground'>
          {t('goLive.activation.expires', {
            at: new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }).format(new Date(expiresAt)),
          })}
        </p>
      ) : null}
    </div>
  );
}

/** What happened to each employee, the hand-over links first. */
export function ActivationResults({
  results,
}: {
  results: readonly ActivationResult[];
}): ReactElement {
  const { t } = useTranslation();
  const manual = results.filter((r) => r.outcome.status === 'manual');
  const sent = results.filter((r) => r.outcome.status === 'sent');
  const skipped = results.filter((r) => r.outcome.status === 'skipped');
  return (
    <div className='flex flex-col gap-4'>
      <p className='text-sm'>
        {t('goLive.activation.resultSummary', {
          sent: sent.length,
          manual: manual.length,
          skipped: skipped.length,
        })}
      </p>
      {manual.length ? (
        <Alert>
          <AlertTitle>{t('goLive.activation.handOverTitle')}</AlertTitle>
          <AlertDescription>
            <p>{t('goLive.activation.handOverDescription')}</p>
            <div className='mt-3 flex flex-col gap-4'>
              {manual.map((r) =>
                r.outcome.status === 'manual' ? (
                  <HandOverLink
                    key={r.employeeId}
                    name={r.name}
                    link={r.outcome.link}
                    expiresAt={r.expiresAt}
                  />
                ) : null,
              )}
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <ul className='flex max-h-64 flex-col divide-y overflow-y-auto rounded-lg border text-sm'>
        {results.map((r) => (
          <li
            key={r.employeeId}
            className='flex flex-wrap items-center justify-between gap-2 px-3 py-2'
          >
            <span className='font-medium'>
              {r.name}
              {r.login ? (
                <span className='ml-2 font-mono text-xs text-muted-foreground'>
                  {r.login}
                </span>
              ) : null}
            </span>
            {r.outcome.status === 'sent' ? (
              <Badge variant='secondary'>
                {r.outcome.channel === 'feishu'
                  ? t('goLive.activation.sentBy.feishu')
                  : t('goLive.activation.sentBy.email', {
                      to: r.outcome.sentTo,
                    })}
              </Badge>
            ) : r.outcome.status === 'manual' ? (
              <Badge variant='outline'>
                {t(`goLive.activation.manualReason.${r.outcome.reason}`)}
              </Badge>
            ) : (
              <span className='text-muted-foreground'>
                {t(`goLive.activation.skippedReason.${r.outcome.reason}`, {
                  defaultValue: r.outcome.reason,
                })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 开通账号并发送激活链接 from 人事 › 员工: the selected employees, or every
 * employee in service without an account in the caller's scope.
 */
export function ActivationDialog({
  open,
  onOpenChange,
  selectedIds,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: readonly string[];
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [scope, setScope] = useState<'selected' | 'all'>(
    selectedIds.length ? 'selected' : 'all',
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [results, setResults] = useState<ActivationResult[]>();
  const effectiveScope = selectedIds.length ? scope : 'all';
  const close = () => {
    if (pending) return;
    onOpenChange(false);
    if (results) onDone();
    setResults(undefined);
    setError(undefined);
  };
  async function submit(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: ActivationResult[] }>({
        path: 'talent/account-activation/bulk',
        method: 'POST',
        json:
          effectiveScope === 'all'
            ? { allWithoutAccount: true }
            : { employeeIds: selectedIds },
      });
      setResults(response.data);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
      <DialogContent className='sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>
            {results
              ? t('goLive.activation.resultTitle')
              : t('goLive.activation.dialogTitle')}
          </DialogTitle>
          {results ? null : (
            <DialogDescription>
              {t('goLive.activation.dialogDescription')}
            </DialogDescription>
          )}
        </DialogHeader>
        {results ? (
          <ActivationResults results={results} />
        ) : (
          <div className='flex flex-col gap-4'>
            <RadioGroup
              value={effectiveScope}
              onValueChange={(value) => setScope(value as 'selected' | 'all')}
            >
              <div className='flex items-center gap-2'>
                <RadioGroupItem
                  value='selected'
                  id='activation-scope-selected'
                  disabled={!selectedIds.length}
                />
                <Label htmlFor='activation-scope-selected'>
                  {t('goLive.activation.scopeSelected', {
                    count: selectedIds.length,
                  })}
                </Label>
              </div>
              <div className='flex items-center gap-2'>
                <RadioGroupItem value='all' id='activation-scope-all' />
                <Label htmlFor='activation-scope-all'>
                  {t('goLive.activation.scopeAll')}
                </Label>
              </div>
            </RadioGroup>
            <p className='text-sm text-muted-foreground'>
              {t('goLive.activation.privileged')}
            </p>
            {error ? <FieldError>{error}</FieldError> : null}
          </div>
        )}
        <DialogFooter>
          {results ? (
            <Button onClick={close}>{t('goLive.activation.close')}</Button>
          ) : (
            <>
              <Button variant='outline' disabled={pending} onClick={close}>
                {t('goLive.activation.cancel')}
              </Button>
              <Button disabled={pending} onClick={() => void submit()}>
                {pending ? <Spinner data-icon='inline-start' /> : null}
                {pending
                  ? t('goLive.activation.submitting')
                  : t('goLive.activation.submit')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
