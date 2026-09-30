import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  FilePreviewDialog,
  type FileRecord,
} from '@/extensions/nocobase-file-component-ui';

/** V3-10: the scan of an external certificate, loaded afresh on each open so access is checked again. */
export function CertificateScanButton({
  certificateId,
}: {
  certificateId: string;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
        {t('talent.externalCerts.viewScan')}
      </Button>
      {open ? (
        <ScanPreview
          certificateId={certificateId}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ScanPreview({
  certificateId,
  onClose,
}: {
  certificateId: string;
  onClose: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const scan = useRemote<FileRecord | null>(
    `talent/external-certificates/${encodeURIComponent(certificateId)}/scan`,
  );
  if (scan.loading) return <Spinner />;
  if (!scan.data)
    return (
      <span className='text-sm text-muted-foreground'>
        {t('talent.externalCerts.noScan')}
      </span>
    );
  return (
    <FilePreviewDialog
      files={[scan.data]}
      open
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    />
  );
}
