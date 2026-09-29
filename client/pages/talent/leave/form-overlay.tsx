import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { RouteDialog } from '@/components/route-dialog';
import { useLocation, useNavigate } from 'react-router';
import { RouteChildPage } from '@/components/route-child-page';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useRouteOverlay } from '@/components/use-route-overlay';
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
import { Spinner } from '@/components/ui/spinner';
import { LEAVE_FORM_ID, LeaveFormContext } from './form-context.js';
export function LeaveFormOverlay({
  title,
  description,
  page = false,
  children,
  enabled = true,
}: {
  title: string;
  description: string;
  page?: boolean;
  children: ReactNode;
  enabled?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const dirtyRef = useRef(false);
  const confirmationRef = useRef<((allow: boolean) => void) | null>(null);
  const [confirm, setConfirm] = useState(false);
  const context = useMemo(
    () => ({
      pending,
      markDirty: () => {
        dirtyRef.current = true;
      },
      start: () => {
        pendingRef.current = true;
        setPending(true);
      },
      end: () => {
        pendingRef.current = false;
        setPending(false);
      },
      saved: () => {
        pendingRef.current = false;
        dirtyRef.current = false;
        setPending(false);
      },
    }),
    [pending],
  );
  const beforeClose = () => {
    if (pendingRef.current) return false;
    if (!dirtyRef.current) return true;
    return new Promise<boolean>((resolve) => {
      confirmationRef.current = resolve;
      setConfirm(true);
    });
  };
  const confirmation = (
    <AlertDialog
      open={confirm}
      onOpenChange={(open) => {
        if (!open) {
          confirmationRef.current?.(false);
          setConfirm(false);
        }
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('attendance.leave.discardTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('attendance.leave.discardDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>
            {t('attendance.leave.keepEditing')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            onClick={() => {
              dirtyRef.current = false;
              confirmationRef.current?.(true);
              confirmationRef.current = null;
              setConfirm(false);
            }}
          >
            {t('attendance.leave.discard')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
  const closePage = async () => {
    if (await beforeClose())
      await navigate(
        { pathname: '..', search: location.search },
        { relative: 'route', replace: true },
      );
  };
  return (
    <LeaveFormContext.Provider value={context}>
      {page ? (
        <RouteChildPage>
          <PageContainer className='max-w-4xl'>
            <PageHeader title={title} description={description} />
            {children}
            <div className='flex justify-end gap-2'>
              <FormButtons
                pending={pending}
                enabled={enabled}
                close={closePage}
              />
            </div>
            {confirmation}
          </PageContainer>
        </RouteChildPage>
      ) : (
        <RouteDialog
          title={title}
          description={description}
          beforeClose={beforeClose}
          footer={<Footer pending={pending} enabled={enabled} />}
        >
          {children}
          {confirmation}
        </RouteDialog>
      )}
    </LeaveFormContext.Provider>
  );
}
function Footer({ pending, enabled }: { pending: boolean; enabled: boolean }) {
  const { close } = useRouteOverlay();
  return <FormButtons pending={pending} enabled={enabled} close={close} />;
}
function FormButtons({
  pending,
  enabled,
  close,
}: {
  pending: boolean;
  enabled: boolean;
  close: () => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <>
      <Button variant='outline' disabled={pending} onClick={() => void close()}>
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={LEAVE_FORM_ID} disabled={pending || !enabled}>
        {pending ? <Spinner data-icon='inline-start' /> : null}
        {t('actions.save')}
      </Button>
    </>
  );
}
