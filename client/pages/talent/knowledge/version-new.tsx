import { useApiClient, useService } from '@nocobase/app-client';
import { clientFileRepositoryManagerToken } from '@nocobase/app-plugin-file/client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { errorCode, errorMessage } from '@/components/talent/errors';
import type { KbDocument } from '@/components/talent/learning-types';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { useRouteOverlay } from '@/components/use-route-overlay';

import { DOCUMENT_FILE_ACCEPT, type DocumentOutletContext } from './types.js';

const FORM_ID = 'kb-version-form';

/**
 * Route `/talent/knowledge/:documentId/versions/new` — 上传新版本 (V1-04). The
 * new version inherits the tags, visibility and owner; its text is extracted
 * in the background, and once ready it supersedes this version and lists the
 * changed sections. The dialog then opens the new version.
 */
export default function UploadVersionDialog(): ReactElement {
  const { t } = useTranslation();
  const context = useOutletContext<DocumentOutletContext | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const busyRef = useRef(false);
  return (
    <RouteDialog
      title={t('knowledgeService.version.uploadTitle')}
      description={
        context
          ? t('knowledgeService.version.uploadDescription', {
              title: context.document.title,
            })
          : undefined
      }
      className='sm:max-w-lg'
      beforeClose={() => !busyRef.current}
      footer={<Footer submitting={submitting} disabled={!context} />}
    >
      {context ? (
        <VersionForm
          context={context}
          onSubmittingChange={(value) => {
            busyRef.current = value;
            setSubmitting(value);
          }}
        />
      ) : (
        <Alert>
          <AlertDescription>
            {t('knowledgeService.version.unavailable')}
          </AlertDescription>
        </Alert>
      )}
    </RouteDialog>
  );
}

function VersionForm({
  context,
  onSubmittingChange,
}: {
  context: DocumentOutletContext;
  onSubmittingChange: (value: boolean) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const files = useService(clientFileRepositoryManagerToken);
  const navigate = useNavigate();
  const { document, reload } = context;
  const needsDocNo = !document.docNo;
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState('');
  const [title, setTitle] = useState(document.title);
  const [docNo, setDocNo] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reviewDate, setReviewDate] = useState(document.reviewDate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();

  async function submit(): Promise<void> {
    const next: Record<string, string> = {};
    if (!file) next.file = t('talent.errors.DOCUMENT_FILE_REQUIRED');
    if (!version.trim())
      next.version = t('talent.errors.DOCUMENT_VERSION_REQUIRED');
    if (needsDocNo && !docNo.trim())
      next.docNo = t('talent.errors.DOCUMENT_NO_REQUIRED');
    setErrors(next);
    const first = ['file', 'docNo', 'version'].find((key) => next[key]);
    if (first) {
      window.document.getElementById(`kb-version-${first}`)?.focus();
      return;
    }
    onSubmittingChange(true);
    setError(undefined);
    try {
      const fileId = String(
        (await files.repository('hrFiles').uploadOne({ file: file! })).record
          .id,
      );
      const { data } = await api.request<{ data: KbDocument }>({
        path: `talent/kb/documents/${encodeURIComponent(document.id)}/versions`,
        method: 'POST',
        json: {
          fileId,
          version: version.trim(),
          ...(title.trim() && title.trim() !== document.title
            ? { title: title.trim() }
            : {}),
          ...(effectiveDate ? { effectiveDate } : {}),
          ...(reviewDate ? { reviewDate } : {}),
          ...(needsDocNo ? { docNo: docNo.trim() } : {}),
        },
      });
      toast.add({
        type: 'success',
        title: t('knowledgeService.version.uploaded', {
          version: data.version ?? version.trim(),
        }),
      });
      onSubmittingChange(false);
      reload();
      void navigate(`/talent/knowledge/${encodeURIComponent(data.id)}`, {
        replace: true,
      });
    } catch (cause) {
      onSubmittingChange(false);
      const code = errorCode(cause);
      if (
        code === 'DOCUMENT_VERSION_REQUIRED' ||
        code === 'DOCUMENT_VERSION_EXISTS'
      )
        setErrors({ version: errorMessage(cause, t) });
      else if (code === 'DOCUMENT_NO_REQUIRED')
        setErrors({ docNo: errorMessage(cause, t) });
      else setError(errorMessage(cause, t));
    }
  }

  return (
    <form
      id={FORM_ID}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FieldGroup>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Field data-invalid={Boolean(errors.file)}>
          <FieldLabel htmlFor='kb-version-file'>
            {t('talent.knowledge.file')} *
          </FieldLabel>
          <Input
            id='kb-version-file'
            type='file'
            accept={DOCUMENT_FILE_ACCEPT}
            aria-invalid={Boolean(errors.file)}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <FieldDescription>{t('talent.knowledge.fileHint')}</FieldDescription>
          {errors.file ? <FieldError>{errors.file}</FieldError> : null}
        </Field>
        {needsDocNo ? (
          <Field data-invalid={Boolean(errors.docNo)}>
            <FieldLabel htmlFor='kb-version-docNo'>
              {t('knowledgeService.fields.docNo')} *
            </FieldLabel>
            <Input
              id='kb-version-docNo'
              value={docNo}
              maxLength={64}
              aria-invalid={Boolean(errors.docNo)}
              onChange={(e) => setDocNo(e.target.value)}
            />
            <FieldDescription>
              {t('knowledgeService.version.docNoHint')}
            </FieldDescription>
            {errors.docNo ? <FieldError>{errors.docNo}</FieldError> : null}
          </Field>
        ) : null}
        <div className='grid gap-4 sm:grid-cols-2'>
          <Field data-invalid={Boolean(errors.version)}>
            <FieldLabel htmlFor='kb-version-version'>
              {t('knowledgeService.fields.version')} *
            </FieldLabel>
            <Input
              id='kb-version-version'
              value={version}
              maxLength={32}
              placeholder={t('knowledgeService.version.versionPlaceholder')}
              aria-invalid={Boolean(errors.version)}
              onChange={(e) => setVersion(e.target.value)}
            />
            {errors.version ? <FieldError>{errors.version}</FieldError> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor='kb-version-effective'>
              {t('knowledgeService.fields.effectiveDate')}
            </FieldLabel>
            <Input
              id='kb-version-effective'
              type='date'
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </Field>
        </div>
        <Field>
          <FieldLabel htmlFor='kb-version-title'>
            {t('talent.knowledge.fields.title')}
          </FieldLabel>
          <Input
            id='kb-version-title'
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='kb-version-review'>
            {t('talent.knowledge.fields.reviewDate')}
          </FieldLabel>
          <Input
            id='kb-version-review'
            type='date'
            className='w-48'
            value={reviewDate}
            onChange={(e) => setReviewDate(e.target.value)}
          />
          <FieldDescription>
            {t('knowledgeService.version.inheritHint')}
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  );
}

function Footer({
  submitting,
  disabled,
}: {
  submitting: boolean;
  disabled: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const { close } = useRouteOverlay();
  return (
    <>
      <Button
        variant='outline'
        disabled={submitting}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button type='submit' form={FORM_ID} disabled={submitting || disabled}>
        {submitting ? <Spinner data-icon='inline-start' /> : null}
        {t('knowledgeService.version.submit')}
      </Button>
    </>
  );
}
