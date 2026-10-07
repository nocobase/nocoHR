import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { FileTextIcon, UploadIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { uploadHrFile } from '@/components/talent/hr-file-upload';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

import type { Position } from './types.js';

/** Word, PDF, Markdown or text: the formats the extractor reads. */
const ACCEPT =
  '.pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain';
/** Characters of the extracted text shown before "show all". */
const PREVIEW_LENGTH = 400;

/**
 * 岗位说明书 (V3-08): upload or replace the job description, see the
 * extraction state and a preview of the text. The framework advisor reads the
 * extracted text as its primary source. Only framework managers upload.
 */
export function JobDescriptionCard({
  position,
  canManage,
  onChanged,
}: {
  position: Position;
  canManage: boolean;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const status = position.jdStatus ?? null;

  // Extraction runs in the background: poll briefly while it is pending.
  useEffect(() => {
    if (status !== 'pending') return;
    const timer = window.setTimeout(onChanged, 2000);
    return () => window.clearTimeout(timer);
  }, [status, onChanged]);

  async function upload(file: File): Promise<void> {
    setBusy(true);
    try {
      const fileId = String(
        (await uploadHrFile(api, file, 'jobDescription')).id,
      );
      await api.request({
        path: `talent/competency/positions/${encodeURIComponent(position.id)}/jd`,
        method: 'POST',
        json: { fileId },
      });
      toast.add({
        type: 'success',
        title: t('talent.competencyExt.jd.uploaded'),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  const text = position.jdText ?? '';
  const preview =
    expanded || text.length <= PREVIEW_LENGTH
      ? text
      : `${text.slice(0, PREVIEW_LENGTH)}…`;

  return (
    <Card>
      <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
        <div className='min-w-0'>
          <CardTitle>{t('talent.competencyExt.jd.title')}</CardTitle>
          <CardDescription>
            {t('talent.competencyExt.jd.description')}
          </CardDescription>
        </div>
        {canManage ? (
          <>
            <input
              ref={inputRef}
              type='file'
              accept={ACCEPT}
              className='hidden'
              aria-label={t('talent.competencyExt.jd.upload')}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
              }}
            />
            <Button
              variant='outline'
              size='sm'
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Spinner data-icon='inline-start' />
              ) : (
                <UploadIcon data-icon='inline-start' />
              )}
              {position.jdFileId
                ? t('talent.competencyExt.jd.replace')
                : t('talent.competencyExt.jd.upload')}
            </Button>
          </>
        ) : null}
      </CardHeader>
      <CardContent className='space-y-3'>
        {position.jdFileId ? (
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <FileTextIcon className='size-4 text-muted-foreground' />
            <span className='min-w-0 truncate'>{position.jdFilename}</span>
            <Badge
              variant={
                status === 'failed'
                  ? 'destructive'
                  : status === 'ready'
                    ? 'secondary'
                    : 'outline'
              }
            >
              {t(`talent.competencyExt.jd.status.${status ?? 'pending'}`)}
            </Badge>
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.competencyExt.jd.none')}
          </p>
        )}
        {status === 'failed' && position.jdError ? (
          <p className='text-sm text-destructive' role='alert'>
            {t(`talent.errors.${position.jdError}`, {
              defaultValue: t('talent.competencyExt.jd.failed'),
            })}
          </p>
        ) : null}
        {status === 'ready' && text ? (
          <div className='space-y-1'>
            <p className='text-xs font-medium text-muted-foreground'>
              {t('talent.competencyExt.jd.preview')}
            </p>
            <p className='rounded-md bg-muted/40 p-3 text-sm whitespace-pre-line'>
              {preview}
            </p>
            {text.length > PREVIEW_LENGTH ? (
              <Button
                variant='link'
                size='sm'
                className='px-0'
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded
                  ? t('talent.competencyExt.jd.collapse')
                  : t('talent.competencyExt.jd.expand')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
