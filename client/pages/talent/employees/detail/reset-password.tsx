import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CopyIcon, KeyRoundIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type { EmployeeDetail } from '@/components/talent/types';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

/**
 * 重置登录密码: a one-time temporary password for the employee's login, for
 * HR who may link accounts. A new hire from an offer gets an account whose
 * password nobody knows; HR hands this one over and the employee changes it.
 * It is shown once and not stored anywhere.
 */
export function ResetPasswordButton({
  detail,
}: {
  detail: EmployeeDetail;
}): ReactElement | null {
  const { t } = useTranslation();
  const api = useApiClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const [issued, setIssued] = useState<{ password: string; login: string }>();
  const employee = detail.employee;
  if (!detail.can.linkUser || !employee.userId || employee.status === 'leave')
    return null;
  const close = () => {
    if (pending) return;
    setOpen(false);
    setError(undefined);
    setIssued(undefined);
  };
  return (
    <>
      <Button variant='outline' onClick={() => setOpen(true)}>
        <KeyRoundIcon data-icon='inline-start' />
        {t('talent.detail.resetPassword')}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => (next ? null : close())}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {issued
                ? t('talent.detail.resetPasswordIssued')
                : t('talent.detail.resetPasswordTitle', {
                    name: employee.name,
                  })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {issued
                ? t('talent.detail.resetPasswordShownOnce')
                : t('talent.detail.resetPasswordDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {issued ? (
            <dl className='grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm'>
              <dt className='text-muted-foreground'>
                {t('talent.detail.resetPasswordLogin')}
              </dt>
              <dd className='font-mono'>{issued.login}</dd>
              <dt className='text-muted-foreground'>
                {t('talent.detail.resetPasswordValue')}
              </dt>
              <dd className='flex items-center gap-2'>
                <span className='font-mono'>{issued.password}</span>
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('talent.detail.resetPasswordCopy')}
                  onClick={() => {
                    void navigator.clipboard
                      ?.writeText(issued.password)
                      .then(() =>
                        toast.add({
                          type: 'success',
                          title: t('talent.detail.resetPasswordCopied'),
                        }),
                      );
                  }}
                >
                  <CopyIcon />
                </Button>
              </dd>
            </dl>
          ) : null}
          {error ? <FieldError>{error}</FieldError> : null}
          <AlertDialogFooter>
            {issued ? (
              <AlertDialogAction onClick={close}>
                {t('talent.detail.resetPasswordDone')}
              </AlertDialogAction>
            ) : (
              <>
                <AlertDialogCancel disabled={pending}>
                  {t('actions.cancel')}
                </AlertDialogCancel>
                <AlertDialogAction
                  disabled={pending}
                  onClick={(event) => {
                    event.preventDefault();
                    setPending(true);
                    setError(undefined);
                    api
                      .request<{ data: { password: string; login: string } }>({
                        method: 'POST',
                        path: `talent/employees/${encodeURIComponent(employee.id)}/reset-password`,
                        json: {},
                      })
                      .then((response) => setIssued(response.data))
                      .catch((cause: unknown) =>
                        setError(errorMessage(cause, t)),
                      )
                      .finally(() => setPending(false));
                  }}
                >
                  {pending ? <Spinner data-icon='inline-start' /> : null}
                  {t('talent.detail.resetPasswordConfirm')}
                </AlertDialogAction>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
