import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactNode } from 'react';
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
import { CardContent, CardFooter } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { SettingsError } from './feedback.js';

/** The body and footer every configuration card shares: 重新加载 (with a confirmation) and 保存. */
export function CardForm({
  children,
  submit,
  pending,
  reload,
  error,
}: {
  children: ReactNode;
  submit: () => Promise<void>;
  pending: boolean;
  reload: () => void;
  error: unknown;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void submit();
        }}
      >
        <CardContent className='space-y-4'>
          {error ? <SettingsError error={error} /> : null}
          <fieldset disabled={pending} className='space-y-4'>
            {children}
          </fieldset>
        </CardContent>
        <CardFooter className='justify-end gap-2 pt-4'>
          <Button
            type='button'
            variant='outline'
            disabled={pending}
            onClick={() => setConfirm(true)}
          >
            {t('attendance.settings.reload')}
          </Button>
          <Button type='submit' variant='outline' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </CardFooter>
      </form>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('attendance.settings.reloadTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('attendance.settings.reloadDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant='destructive' onClick={reload}>
              {t('attendance.settings.reload')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
