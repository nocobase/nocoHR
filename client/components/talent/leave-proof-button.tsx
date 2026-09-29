import { useState, type ReactElement } from 'react';
import { useTranslation } from '@nocobase/i18n/client';
import { ApiClientError } from '@nocobase/app-client';
import {
  FilePreviewDialog,
  type FileRecord,
} from '@/extensions/nocobase-file-component-ui';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useRemote } from './use-remote.js';

/** Transient native file preview, not a second leave-record detail page. */
export function LeaveProofButton({
  requestId,
  disabled = false,
}: {
  requestId: string;
  disabled?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <div className='grid gap-2'>
      <Button
        type='button'
        variant='outline'
        disabled={disabled || open}
        onClick={() => setOpen(true)}
      >
        {t('attendance.leave.viewProof')}
      </Button>
      {open ? (
        <ProofPreview requestId={requestId} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}

function ProofPreview({
  requestId,
  onClose,
}: {
  requestId: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  // Mount afresh on each open: recheck access, abort on close, never display
  // metadata cached from a different request or a previous permission state.
  const proof = useRemote<FileRecord | null>(
    `talent/leave/requests/${encodeURIComponent(requestId)}/proof`,
  );
  const [previewFailed, setPreviewFailed] = useState(false);
  if (proof.loading)
    return (
      <div className='flex items-center gap-2' role='status'>
        <Spinner />
        {t('attendance.leave.proofLoading')}
        <Button type='button' variant='outline' onClick={onClose}>
          {t('actions.cancel')}
        </Button>
      </div>
    );
  if (proof.error || !proof.data) {
    const status =
      proof.error instanceof ApiClientError ? proof.error.status : undefined;
    return (
      <Alert variant='destructive'>
        <AlertDescription className='grid gap-2'>
          <p>{t('attendance.leave.proofUnavailable')}</p>
          <div className='flex gap-2'>
            {proof.error && status !== 403 && status !== 404 ? (
              <Button type='button' variant='outline' onClick={proof.reload}>
                {t('attendance.leave.retry')}
              </Button>
            ) : null}
            <Button type='button' variant='outline' onClick={onClose}>
              {t('actions.cancel')}
            </Button>
          </div>
        </AlertDescription>
      </Alert>
    );
  }
  return (
    <>
      {previewFailed ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {t('attendance.leave.proofUnavailable')}
          </AlertDescription>
        </Alert>
      ) : null}
      <FilePreviewDialog
        files={[proof.data]}
        open
        onOpenChange={(value) => {
          if (!value) onClose();
        }}
        onError={() => setPreviewFailed(true)}
      />
    </>
  );
}
