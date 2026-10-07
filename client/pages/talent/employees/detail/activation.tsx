import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { SendIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { EmployeeDetail } from '@/components/talent/types';
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
import { FieldError } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import { ActivationResults, type ActivationResult } from '../activation.js';

/** `GET talent/account-activation/employees/:id`. */
interface ActivationState {
  activatedAt: string | null;
  open: {
    expiresAt: string;
    channel: string;
    deliveryStatus: string;
    sentTo: string | null;
    createdAt: string;
  } | null;
  links: number;
}

/**
 * 账号激活 on the employee detail page (上线准备): whether the linked account
 * was activated, the open link, and 重新发送 / 作废. For HR who may link
 * employee accounts; an activated account gets no new link (重置密码 is the
 * way then).
 */
export function ActivationButton({
  detail,
}: {
  detail: EmployeeDetail;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const employee = detail.employee;
  const state = useRemote<ActivationState>(
    open ? `talent/account-activation/employees/${employee.id}` : null,
  );
  const [pending, setPending] = useState<'resend' | 'revoke' | null>(null);
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<ActivationResult>();
  if (!detail.can.linkUser || !employee.userId || employee.status === 'leave')
    return null;
  const format = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(undefined);
    setResult(undefined);
  };
  async function act(kind: 'resend' | 'revoke'): Promise<void> {
    setPending(kind);
    setError(undefined);
    try {
      const response = await api.request<{ data: ActivationResult }>({
        path: `talent/account-activation/employees/${employee.id}/${kind}`,
        method: 'POST',
        json: {},
      });
      if (kind === 'resend') {
        setResult(response.data);
        toast.add({ type: 'success', title: t('goLive.activation.resent') });
      } else
        toast.add({ type: 'success', title: t('goLive.activation.revoked') });
      state.reload();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(null);
    }
  }
  const data = state.data;
  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        <SendIcon data-icon='inline-start' />
        {t('goLive.activation.detailTitle')}
      </Button>
      <Dialog open={open} onOpenChange={(next) => (next ? null : close())}>
        <DialogContent className='sm:max-w-lg'>
          <DialogHeader>
            <DialogTitle>{t('goLive.activation.detailTitle')}</DialogTitle>
            <DialogDescription>
              {!data
                ? null
                : data.activatedAt
                  ? t('goLive.activation.detailActivated', {
                      at: format(data.activatedAt),
                    })
                  : data.open
                    ? t('goLive.activation.detailOpen', {
                        at: format(data.open.createdAt),
                        expires: format(data.open.expiresAt),
                      })
                    : t('goLive.activation.detailNone')}
            </DialogDescription>
          </DialogHeader>
          {!data && !state.error ? <Skeleton className='h-10 w-full' /> : null}
          {result ? <ActivationResults results={[result]} /> : null}
          {error || state.error ? (
            <FieldError>{error ?? errorMessage(state.error, t)}</FieldError>
          ) : null}
          <DialogFooter>
            {data?.open ? (
              <Button
                variant='outline'
                disabled={pending !== null}
                onClick={() => void act('revoke')}
              >
                {pending === 'revoke' ? (
                  <Spinner data-icon='inline-start' />
                ) : null}
                {t('goLive.activation.revoke')}
              </Button>
            ) : null}
            {data && !data.activatedAt ? (
              <Button
                disabled={pending !== null}
                onClick={() => void act('resend')}
              >
                {pending === 'resend' ? (
                  <Spinner data-icon='inline-start' />
                ) : null}
                {data.links
                  ? t('goLive.activation.resendAgain')
                  : t('goLive.activation.resend')}
              </Button>
            ) : null}
            <Button variant='ghost' disabled={pending !== null} onClick={close}>
              {t('goLive.activation.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
