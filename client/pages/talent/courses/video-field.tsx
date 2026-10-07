import { resolveAppUrl, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { UploadIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { uploadHrFile } from '@/components/talent/hr-file-upload';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';

/** Reads a video file's duration in the browser; resolves null when it cannot. */
function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(
        Number.isFinite(probe.duration) ? Math.round(probe.duration) : null,
      );
    };
    probe.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    probe.src = url;
  });
}

/**
 * The video of a lesson: upload an MP4 (stored by the file plugin and played
 * by the browser as is), its length read automatically — or typed when the
 * browser cannot read it — and the share that must be watched.
 */
export function VideoLessonFields({
  lessonId,
  videoFileId,
  videoSeconds,
  minWatchPercent,
  onChange,
}: {
  lessonId: string | null;
  videoFileId: string | null;
  videoSeconds: string;
  minWatchPercent: string;
  onChange: (patch: {
    videoFileId?: string | null;
    videoSeconds?: string;
    minWatchPercent?: string;
  }) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [filename, setFilename] = useState<string | null>(null);

  async function upload(file: File): Promise<void> {
    if (file.type && file.type !== 'video/mp4') {
      setError(t('talent.video.mp4Only'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const [seconds, uploaded] = await Promise.all([
        readDuration(file),
        uploadHrFile(api, file, 'courseVideo'),
      ]);
      setFilename(file.name);
      onChange({
        videoFileId: String(uploaded.id),
        ...(seconds ? { videoSeconds: String(seconds) } : {}),
      });
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-4 rounded-md border p-3'>
      <Field>
        <FieldLabel htmlFor='lesson-video'>{t('talent.video.file')}</FieldLabel>
        <div className='flex flex-wrap items-center gap-2'>
          <Button
            variant='outline'
            disabled={busy}
            render={<label htmlFor='lesson-video' />}
          >
            {busy ? (
              <Spinner data-icon='inline-start' />
            ) : (
              <UploadIcon data-icon='inline-start' />
            )}
            {videoFileId ? t('talent.video.replace') : t('talent.video.upload')}
          </Button>
          <input
            id='lesson-video'
            type='file'
            accept='video/mp4'
            className='sr-only'
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = '';
            }}
          />
          <span className='text-sm text-muted-foreground'>
            {filename ??
              (videoFileId
                ? t('talent.video.uploaded')
                : t('talent.video.none'))}
          </span>
        </div>
        <FieldDescription>{t('talent.video.fileHint')}</FieldDescription>
        {error ? <FieldError>{error}</FieldError> : null}
      </Field>
      {videoFileId && lessonId && !filename ? (
        <video
          className='aspect-video w-full max-w-md rounded-md bg-muted'
          src={resolveAppUrl(
            `api/talent/learning/lessons/${encodeURIComponent(lessonId)}/video`,
          )}
          controls
          preload='metadata'
        />
      ) : null}
      <div className='grid gap-4 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='lesson-video-seconds'>
            {t('talent.video.seconds')}
          </FieldLabel>
          <Input
            id='lesson-video-seconds'
            type='number'
            min={1}
            value={videoSeconds}
            onChange={(e) => onChange({ videoSeconds: e.target.value })}
          />
          <FieldDescription>{t('talent.video.secondsHint')}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor='lesson-video-percent'>
            {t('talent.video.minWatchPercent')}
          </FieldLabel>
          <Input
            id='lesson-video-percent'
            type='number'
            min={10}
            max={100}
            value={minWatchPercent}
            onChange={(e) => onChange({ minWatchPercent: e.target.value })}
          />
        </Field>
      </div>
    </div>
  );
}
