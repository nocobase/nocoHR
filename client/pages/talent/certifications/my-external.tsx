import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { CertificateScanButton } from '@/components/talent/certificate-scan-button';
import type { Certificate } from '@/components/talent/exam-types';
import { ExternalCertificateDialog } from '@/components/talent/external-certificate-dialog';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/** V3-10 外部证书: the employee's own registrations and their verification state; register or resubmit here. */
export function MyExternalCertificates(): ReactElement | null {
  const { t } = useTranslation();
  const register = useCan({
    resource: { type: 'composite', id: 'talent.externalCertificate' },
    action: 'register',
  });
  const mine = useRemote<{ items: Certificate[] }>(
    register.can ? 'talent/external-certificates' : null,
    { mine: true },
  );
  const [editing, setEditing] = useState<Certificate | null | undefined>();
  if (!register.can) return null;
  return (
    <Card>
      <CardHeader className='flex flex-row items-start justify-between gap-2'>
        <div>
          <CardTitle>{t('talent.externalCerts.mineTitle')}</CardTitle>
          <CardDescription>
            {t('talent.externalCerts.mineDescription')}
          </CardDescription>
        </div>
        <Button size='sm' onClick={() => setEditing(null)}>
          <PlusIcon data-icon='inline-start' />
          {t('talent.externalCerts.register')}
        </Button>
      </CardHeader>
      <CardContent>
        {!mine.data?.items.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('talent.externalCerts.mineEmpty')}
          </p>
        ) : (
          <ul className='divide-y'>
            {mine.data.items.map((item) => (
              <li
                key={item.id}
                className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
              >
                <div className='min-w-0'>
                  <p className='font-medium'>{item.certificationTitle}</p>
                  <p className='text-muted-foreground'>
                    {item.externalNo} · {item.issuedAt} →{' '}
                    {item.expiresAt ?? t('talent.certifications.noExpiry')}
                  </p>
                  {item.verifyStatus === 'rejected' && item.verifyNote ? (
                    <p className='text-destructive'>
                      {t('talent.externalCerts.rejectedBecause', {
                        note: item.verifyNote,
                      })}
                    </p>
                  ) : null}
                </div>
                <div className='flex items-center gap-2'>
                  <Badge
                    variant={
                      item.status === 'valid' || item.status === 'expiring'
                        ? 'secondary'
                        : item.verifyStatus === 'rejected'
                          ? 'destructive'
                          : 'outline'
                    }
                  >
                    {item.status === 'pending'
                      ? t(
                          `talent.externalCerts.verifyStatus.${item.verifyStatus ?? 'pending'}`,
                        )
                      : t(`talent.externalCerts.status.${item.status}`)}
                  </Badge>
                  {item.attachmentFileId ? (
                    <CertificateScanButton certificateId={item.id} />
                  ) : null}
                  {item.status === 'pending' ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => setEditing(item)}
                    >
                      {t('talent.externalCerts.edit')}
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <ExternalCertificateDialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        certificate={editing ?? null}
        onSaved={mine.reload}
      />
    </Card>
  );
}
