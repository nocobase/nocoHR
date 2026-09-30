import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { CertificateScanButton } from '@/components/talent/certificate-scan-button';
import { errorMessage } from '@/components/talent/errors';
import type { Certificate } from '@/components/talent/exam-types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

const STATUSES = ['pending', 'verified', 'rejected'] as const;

/** 外部证书核验 (V3-10 10B, hr.admin): registrations waiting for HR, with the scan and the details the holder entered. */
export default function ExternalCertificatesPage(): ReactElement {
  const { t } = useTranslation();
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('pending');
  const list = useRemote<{ items: Certificate[]; canVerify: boolean }>(
    'talent/external-certificates',
    { verifyStatus: status },
  );
  const [deciding, setDeciding] = useState<{
    certificate: Certificate;
    decision: 'verified' | 'rejected';
  } | null>(null);
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentExternalCerts')}
        description={t('talent.externalCerts.pageDescription')}
      />
      <Tabs
        value={status}
        onValueChange={(value) => setStatus(value as (typeof STATUSES)[number])}
      >
        <TabsList>
          {STATUSES.map((s) => (
            <TabsTrigger key={s} value={s}>
              {t(`talent.externalCerts.verifyStatus.${s}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.items.length ? (
        <EmptyState title={t('talent.externalCerts.empty')} />
      ) : (
        <div className='grid gap-3 md:grid-cols-2'>
          {list.data.items.map((item) => (
            <Card key={item.id}>
              <CardContent className='space-y-2 text-sm'>
                <div className='flex flex-wrap items-start justify-between gap-2'>
                  <div>
                    <p className='font-medium'>{item.employeeName}</p>
                    <p className='text-muted-foreground'>
                      {item.certificationTitle}
                      {item.issuingAuthority
                        ? ` · ${item.issuingAuthority}`
                        : ''}
                    </p>
                  </div>
                  <Badge variant='outline'>
                    {t(
                      `talent.externalCerts.verifyStatus.${item.verifyStatus ?? 'pending'}`,
                    )}
                  </Badge>
                </div>
                <dl className='grid grid-cols-[6rem_minmax(0,1fr)] gap-x-2 gap-y-1'>
                  <dt className='text-muted-foreground'>
                    {t('talent.externalCerts.fields.externalNo')}
                  </dt>
                  <dd className='break-all'>{item.externalNo}</dd>
                  <dt className='text-muted-foreground'>
                    {t('talent.externalCerts.fields.issuedAt')}
                  </dt>
                  <dd>{item.issuedAt}</dd>
                  <dt className='text-muted-foreground'>
                    {t('talent.externalCerts.fields.expiresAt')}
                  </dt>
                  <dd>
                    {item.expiresAt ?? t('talent.certifications.noExpiry')}
                  </dd>
                </dl>
                {item.verifyNote ? (
                  <p className='text-muted-foreground'>
                    {t('talent.externalCerts.note', { note: item.verifyNote })}
                  </p>
                ) : null}
                <div className='flex flex-wrap justify-end gap-2'>
                  {item.attachmentFileId ? (
                    <CertificateScanButton certificateId={item.id} />
                  ) : (
                    <span className='text-muted-foreground'>
                      {t('talent.externalCerts.noScan')}
                    </span>
                  )}
                  {list.data?.canVerify &&
                  item.status === 'pending' &&
                  item.verifyStatus === 'pending' ? (
                    <>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() =>
                          setDeciding({
                            certificate: item,
                            decision: 'rejected',
                          })
                        }
                      >
                        {t('talent.externalCerts.reject')}
                      </Button>
                      <Button
                        size='sm'
                        onClick={() =>
                          setDeciding({
                            certificate: item,
                            decision: 'verified',
                          })
                        }
                      >
                        {t('talent.externalCerts.verify')}
                      </Button>
                    </>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <DecisionDialog
        value={deciding}
        onClose={() => setDeciding(null)}
        onDone={list.reload}
      />
    </PageContainer>
  );
}

function DecisionDialog({
  value,
  onClose,
  onDone,
}: {
  value: {
    certificate: Certificate;
    decision: 'verified' | 'rejected';
  } | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const reject = value?.decision === 'rejected';

  async function submit(): Promise<void> {
    if (!value) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/external-certificates/${encodeURIComponent(value.certificate.id)}/verify`,
        method: 'POST',
        json: { decision: value.decision, note: note || null },
      });
      toast.add({
        type: 'success',
        title: reject
          ? t('talent.externalCerts.rejected')
          : t('talent.externalCerts.verified'),
      });
      setNote('');
      onDone();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {reject
              ? t('talent.externalCerts.rejectTitle')
              : t('talent.externalCerts.verifyTitle')}
          </DialogTitle>
          <DialogDescription>
            {value
              ? `${value.certificate.employeeName} · ${value.certificate.certificationTitle}`
              : ''}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='verify-note'>
            {reject
              ? t('talent.externalCerts.rejectReason')
              : t('talent.externalCerts.verifyNote')}
          </FieldLabel>
          <Textarea
            id='verify-note'
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            variant={reject ? 'destructive' : 'default'}
            disabled={busy || (reject && !note.trim())}
            onClick={() => void submit()}
          >
            {reject
              ? t('talent.externalCerts.reject')
              : t('talent.externalCerts.verify')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
