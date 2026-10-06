import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckCircle2Icon, CirclePlayIcon, FactoryIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { CertificateStatusBadge } from '@/components/talent/certificate-card';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
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

interface Signoff {
  id: string;
  step: string;
  employeeName: string;
  signedAt: string;
  certificateNo: string | null;
  certificateStatusAtSigning: string | null;
}

interface BatchView {
  /** The work order number (MO-24031). */
  batchNo: string;
  /** The work order's operations; `code` is op10, op20 or op30. */
  steps: {
    code: string;
    machine: string;
    signable: boolean;
    signoffs: Signoff[];
  }[];
  canSign: boolean;
}

/**
 * 设备开工登记（演示）: stands in for a MES in which only certified operators
 * may record a machine start on a work order operation. Reaching the page
 * and recording a start both come from the permission set (prod.cncOperator)
 * the CNC 岗位上岗证 grants; when the certificate expires or is revoked, the
 * server refuses the start without anyone changing permissions. The API
 * keeps the earlier batch record names (`demo/batch-record`, `sign-filling`).
 */
export default function DemoBatchRecordPage(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const batch = useRemote<BatchView>('demo/batch-record');
  const [busy, setBusy] = useState(false);
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));

  async function sign(): Promise<void> {
    setBusy(true);
    try {
      const result = await api.request<{
        data: { duplicate?: boolean; signedAt: string };
      }>({
        path: 'demo/batch-record/sign-filling',
        method: 'POST',
      });
      // A second press moments later returns the first registration instead of recording another.
      if (result.data.duplicate)
        toast.add({
          type: 'info',
          title: t('demo.batch.alreadySigned', {
            time: format(result.data.signedAt),
          }),
        });
      else toast.add({ type: 'success', title: t('demo.batch.signed') });
      batch.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.demoBatchRecord')}
        description={t('demo.batch.description')}
      />
      <Alert>
        <FactoryIcon />
        <AlertTitle>{t('demo.batch.noticeTitle')}</AlertTitle>
        <AlertDescription>{t('demo.batch.notice')}</AlertDescription>
      </Alert>
      {batch.error ? (
        <LoadError error={batch.error} onRetry={batch.reload} />
      ) : !batch.data ? (
        <BlockSkeleton rows={4} />
      ) : (
        <div className='space-y-4'>
          {batch.data.steps.map((step) => (
            <Card key={step.code}>
              <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
                <div>
                  <CardTitle>{t(`demo.batch.steps.${step.code}`)}</CardTitle>
                  <CardDescription>
                    {t('demo.batch.batch', { no: batch.data!.batchNo })}
                    {' · '}
                    {t('demo.batch.machine', { no: step.machine })}
                  </CardDescription>
                </div>
                {step.signable ? (
                  <Button
                    disabled={busy || !batch.data!.canSign}
                    onClick={() => void sign()}
                  >
                    <CirclePlayIcon data-icon='inline-start' />
                    {t('demo.batch.signFilling')}
                  </Button>
                ) : (
                  <Badge variant='outline'>{t('demo.batch.notSignable')}</Badge>
                )}
              </CardHeader>
              {step.signable ? (
                <CardContent className='space-y-3'>
                  {!batch.data!.canSign ? (
                    <p className='text-sm text-muted-foreground'>
                      {t('demo.batch.cannotSign')}
                    </p>
                  ) : null}
                  <p className='text-sm font-medium'>
                    {t('demo.batch.signoffs')}
                  </p>
                  {step.signoffs.length ? (
                    <div className='overflow-x-auto'>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('demo.batch.signer')}</TableHead>
                            <TableHead>{t('demo.batch.signedAt')}</TableHead>
                            <TableHead>
                              {t('demo.batch.certificateNo')}
                            </TableHead>
                            <TableHead className='hidden sm:table-cell'>
                              {t('demo.batch.statusAtSigning')}
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {step.signoffs.map((signoff) => (
                            <TableRow key={signoff.id}>
                              <TableCell className='font-medium'>
                                <span className='inline-flex items-center gap-1.5'>
                                  <CheckCircle2Icon className='size-4 text-primary' />
                                  {signoff.employeeName}
                                </span>
                              </TableCell>
                              <TableCell className='tabular-nums'>
                                {format(signoff.signedAt)}
                              </TableCell>
                              <TableCell className='font-mono text-xs'>
                                {signoff.certificateNo ?? '—'}
                              </TableCell>
                              <TableCell className='hidden sm:table-cell'>
                                {signoff.certificateStatusAtSigning ? (
                                  <CertificateStatusBadge
                                    status={signoff.certificateStatusAtSigning}
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
                      {t('demo.batch.noSignoffs')}
                    </p>
                  )}
                </CardContent>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </PageContainer>
  );
}
