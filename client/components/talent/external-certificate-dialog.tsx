import { useApiClient, useService } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useMemo, useState, type FormEvent, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import type {
  Certificate,
  CertificationSummary,
} from '@/components/talent/exam-types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import {
  clientFileRepositoryManagerToken,
  FileUploadField,
  type FileRecord,
} from '@/extensions/nocobase-file-component-ui';

/**
 * V3-10 外部证书登记: choose the certificate type (an external certification),
 * fill in its number and dates and upload the scan. `certificate` corrects a
 * registration HR rejected and submits it again. HR registering for someone
 * passes `employeeId`.
 */
export function ExternalCertificateDialog({
  open,
  onOpenChange,
  certificate,
  employeeId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certificate?: Certificate | null;
  employeeId?: string;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const types = useRemote<{ items: CertificationSummary[] }>(
    open ? 'talent/certifications' : null,
  );
  const fileManager = useService(clientFileRepositoryManagerToken);
  const repository = useMemo(
    () => fileManager.repository('certificateScanFiles'),
    [fileManager],
  );
  const [form, setForm] = useState({
    certificationId: '',
    externalNo: '',
    issuedAt: '',
    expiresAt: '',
  });
  const [files, setFiles] = useState<readonly FileRecord[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [synced, setSynced] = useState(false);
  if (open !== synced) {
    setSynced(open);
    if (open) {
      setForm({
        certificationId: certificate?.certificationId ?? '',
        externalNo: certificate?.externalNo ?? '',
        issuedAt: certificate?.issuedAt ?? '',
        expiresAt: certificate?.expiresAt ?? '',
      });
      setFiles([]);
      setError(undefined);
    }
  }
  const external = (types.data?.items ?? []).filter(
    (c) => c.kind === 'external' && c.active,
  );
  const attachmentFileId = files[0]?.id ?? certificate?.attachmentFileId;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        ...form,
        expiresAt: form.expiresAt || null,
        attachmentFileId: attachmentFileId ?? null,
        ...(employeeId ? { employeeId } : {}),
      };
      await api.request(
        certificate
          ? {
              path: `talent/external-certificates/${encodeURIComponent(certificate.id)}`,
              method: 'PATCH',
              json,
            }
          : { path: 'talent/external-certificates', method: 'POST', json },
      );
      toast.add({
        type: 'success',
        title: t('talent.externalCerts.submitted'),
      });
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {certificate
              ? t('talent.externalCerts.resubmitTitle')
              : t('talent.externalCerts.registerTitle')}
          </DialogTitle>
          <DialogDescription>
            {certificate?.verifyNote
              ? t('talent.externalCerts.rejectedBecause', {
                  note: certificate.verifyNote,
                })
              : t('talent.externalCerts.registerDescription')}
          </DialogDescription>
        </DialogHeader>
        <form id='external-certificate-form' onSubmit={(e) => void submit(e)}>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='ext-type'>
                {t('talent.externalCerts.fields.type')}
              </FieldLabel>
              <NativeSelect
                id='ext-type'
                className='w-full'
                value={form.certificationId}
                disabled={Boolean(certificate)}
                onChange={(e) => set('certificationId', e.target.value)}
              >
                <NativeSelectOption value=''>
                  {t('talent.externalCerts.chooseType')}
                </NativeSelectOption>
                {external.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.title}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='ext-no'>
                {t('talent.externalCerts.fields.externalNo')}
              </FieldLabel>
              <Input
                id='ext-no'
                value={form.externalNo}
                onChange={(e) => set('externalNo', e.target.value)}
              />
            </Field>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='ext-issued'>
                  {t('talent.externalCerts.fields.issuedAt')}
                </FieldLabel>
                <Input
                  id='ext-issued'
                  type='date'
                  value={form.issuedAt}
                  onChange={(e) => set('issuedAt', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='ext-expires'>
                  {t('talent.externalCerts.fields.expiresAt')}
                </FieldLabel>
                <Input
                  id='ext-expires'
                  type='date'
                  value={form.expiresAt}
                  onChange={(e) => set('expiresAt', e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel>{t('talent.externalCerts.fields.scan')}</FieldLabel>
              <FileUploadField
                repository={repository}
                value={files}
                onChange={setFiles}
                accept={['.pdf', '.png', '.jpg', '.jpeg']}
                maxSize={5 * 1024 * 1024}
                maxFiles={1}
                disabled={busy}
                removeOnDelete={false}
                labels={{ choose: t('talent.externalCerts.uploadScan') }}
              />
              <FieldDescription>
                {certificate?.attachmentFileId && !files.length
                  ? t('talent.externalCerts.scanKept')
                  : t('talent.externalCerts.scanHint')}
              </FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            type='submit'
            form='external-certificate-form'
            disabled={
              busy ||
              !form.certificationId ||
              !form.externalNo.trim() ||
              !form.issuedAt ||
              !attachmentFileId
            }
          >
            {busy ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.externalCerts.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
