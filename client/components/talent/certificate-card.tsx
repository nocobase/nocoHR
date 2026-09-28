import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { AwardIcon, PrinterIcon } from 'lucide-react';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { printCertificate } from './certificate-print.js';
import type { Certificate } from './exam-types.js';

type Variant = 'default' | 'secondary' | 'outline' | 'destructive';
const VARIANTS: Record<string, Variant> = {
  valid: 'secondary',
  expiring: 'default',
  expired: 'destructive',
  revoked: 'destructive',
  superseded: 'outline',
};

export function CertificateStatusBadge({
  status,
}: {
  status: string;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <Badge variant={VARIANTS[status] ?? 'outline'}>
      {t(`talent.certificateStatus.${status}`)}
    </Badge>
  );
}

/** 证书卡片: name, number, issue and expiry dates, status, and the printable certificate. */
export function CertificateCard({
  certificate,
  canPrint = true,
}: {
  certificate: Pick<
    Certificate,
    | 'id'
    | 'certificationTitle'
    | 'certificateNo'
    | 'issuedAt'
    | 'expiresAt'
    | 'status'
  >;
  canPrint?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const format = (date: string | null) =>
    date
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
          new Date(`${date}T00:00:00`),
        )
      : t('talent.certifications.noExpiry');
  const live =
    certificate.status === 'valid' || certificate.status === 'expiring';
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4',
        !live && 'opacity-70',
      )}
    >
      <div className='flex items-start justify-between gap-2'>
        <span className='flex items-center gap-2 font-medium'>
          <AwardIcon className='size-4 text-primary' />
          {certificate.certificationTitle}
        </span>
        <CertificateStatusBadge status={certificate.status} />
      </div>
      <dl className='grid grid-cols-2 gap-2 text-xs'>
        <div className='col-span-2'>
          <dt className='text-muted-foreground'>
            {t('talent.certifications.fields.certificateNo')}
          </dt>
          <dd className='font-mono'>{certificate.certificateNo}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>
            {t('talent.certifications.fields.issuedAt')}
          </dt>
          <dd>{format(certificate.issuedAt)}</dd>
        </div>
        <div>
          <dt className='text-muted-foreground'>
            {t('talent.certifications.fields.expiresAt')}
          </dt>
          <dd>{format(certificate.expiresAt)}</dd>
        </div>
      </dl>
      {canPrint && live ? (
        <Button
          size='sm'
          variant='outline'
          className='self-start'
          onClick={() => printCertificate(certificate.id)}
        >
          <PrinterIcon data-icon='inline-start' />
          {t('talent.certifications.print')}
        </Button>
      ) : null}
    </div>
  );
}
