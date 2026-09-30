import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckCircle2Icon, ForkliftIcon, PackageCheckIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { CertificateStatusBadge } from '@/components/talent/certificate-card';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

/** `GET demo/forklift-dispatch` (server/providers/hr/demo-batch.ts). */
interface ForkliftView {
  orderNo: string;
  forkliftNo: string;
  warehouse: string;
  items: { code: string; quantity: number }[];
  dispatches: {
    id: string;
    employeeName: string;
    signedAt: string;
    certificateNo: string | null;
    certificateStatusAtSigning: string | null;
  }[];
  canDispatch: boolean;
}

/**
 * 叉车出库登记 (V4-14): stands in for a warehouse system in which only holders
 * of a verified 叉车证 may register a dispatch. Reaching the page and
 * registering both come from equip.forkliftOperator, which is assigned to the
 * forklift certification; the server also looks up the registrant's own
 * valid certificate and records its number. No menu entry: the certificate
 * links here. It exists only where the demo seed ran.
 */
export default function ForkliftDispatchPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const view = useRemote<ForkliftView>('demo/forklift-dispatch');
  const [busy, setBusy] = useState(false);
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  async function dispatch(): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: 'demo/forklift-dispatch/dispatch',
        method: 'POST',
      });
      toast.add({ type: 'success', title: t('licensed.forklift.dispatched') });
      view.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  const data = view.data;
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.demoForkliftDispatch')}
        description={t('licensed.forklift.description')}
      />
      <Alert>
        <ForkliftIcon />
        <AlertTitle>{t('licensed.forklift.noticeTitle')}</AlertTitle>
        <AlertDescription>{t('licensed.forklift.notice')}</AlertDescription>
      </Alert>
      {view.error ? (
        <LoadError error={view.error} onRetry={view.reload} />
      ) : !data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <Card>
          <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <CardTitle>
                {t('licensed.forklift.order', { no: data.orderNo })}
              </CardTitle>
              <CardDescription>
                {t('licensed.forklift.forklift', { no: data.forkliftNo })}
                {' · '}
                {t('licensed.forklift.warehouse')} {data.warehouse}
              </CardDescription>
            </div>
            <Button
              disabled={busy || !data.canDispatch}
              onClick={() => void dispatch()}
            >
              <PackageCheckIcon data-icon='inline-start' />
              {t('licensed.forklift.dispatch')}
            </Button>
          </CardHeader>
          <CardContent className='space-y-4'>
            {!data.canDispatch ? (
              <p className='text-sm text-muted-foreground'>
                {t('licensed.forklift.cannotDispatch')}
              </p>
            ) : null}
            <div className='space-y-2'>
              <p className='text-sm font-medium'>
                {t('licensed.forklift.items')}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('licensed.forklift.code')}</TableHead>
                    <TableHead className='text-right'>
                      {t('licensed.forklift.quantity')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.items.map((item) => (
                    <TableRow key={item.code}>
                      <TableCell className='font-mono text-xs'>
                        {item.code}
                      </TableCell>
                      <TableCell className='text-right tabular-nums'>
                        {item.quantity}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className='space-y-2'>
              <p className='text-sm font-medium'>
                {t('licensed.forklift.history')}
              </p>
              {data.dispatches.length ? (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t('licensed.forklift.registrant')}
                        </TableHead>
                        <TableHead>{t('licensed.forklift.at')}</TableHead>
                        <TableHead>
                          {t('licensed.forklift.certificateNo')}
                        </TableHead>
                        <TableHead className='hidden sm:table-cell'>
                          {t('licensed.forklift.statusAtRegister')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.dispatches.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className='font-medium'>
                            <span className='inline-flex items-center gap-1.5'>
                              <CheckCircle2Icon className='size-4 text-primary' />
                              {entry.employeeName}
                            </span>
                          </TableCell>
                          <TableCell className='tabular-nums'>
                            {format(entry.signedAt)}
                          </TableCell>
                          <TableCell className='font-mono text-xs'>
                            {entry.certificateNo ?? '—'}
                          </TableCell>
                          <TableCell className='hidden sm:table-cell'>
                            {entry.certificateStatusAtSigning ? (
                              <CertificateStatusBadge
                                status={entry.certificateStatusAtSigning}
                              />
                            ) : (
                              '—'
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <p className='text-sm text-muted-foreground'>
                  {t('licensed.forklift.none')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </PageContainer>
  );
}
