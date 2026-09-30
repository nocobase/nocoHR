import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';

import { RouteDialog } from '@/components/route-dialog';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { cn } from '@/lib/utils';

interface ImportPreviewRow {
  readonly row: number;
  readonly employeeNo: string;
  readonly employeeName: string | null;
  readonly competencyCode: string;
  readonly competencyTitle: string | null;
  readonly level: number | null;
  readonly evidence: string | null;
  readonly assessedAt: string | null;
  readonly errors: readonly string[];
}

interface ImportPreview {
  readonly rows: readonly ImportPreviewRow[];
  readonly valid: number;
  readonly invalid: number;
}

/**
 * Route `/talent/competencies/assessments-import` (V3-08 导入能力评定, hr.admin):
 * the template's columns are 工号、能力项编码、等级、依据、评定日期. The preview
 * names every row's problems; a file with any problem is refused as a whole.
 * Importing adds `source=import` records and never changes existing ones.
 */
export default function AssessmentImportPage(): ReactElement {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview>();
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  return (
    <RouteDialog
      title={t('talent.competencyExt.import.title')}
      description={t('talent.competencyExt.import.description')}
      className='sm:max-w-4xl'
      beforeClose={() => busy === null}
      footer={
        <Footer file={file} preview={preview} busy={busy} setBusy={setBusy} />
      }
    >
      <Body
        file={file}
        setFile={setFile}
        preview={preview}
        setPreview={setPreview}
        busy={busy}
        setBusy={setBusy}
      />
    </RouteDialog>
  );
}

function Body({
  file,
  setFile,
  preview,
  setPreview,
  busy,
  setBusy,
}: {
  file: File | null;
  setFile: (file: File | null) => void;
  preview: ImportPreview | undefined;
  setPreview: (preview: ImportPreview | undefined) => void;
  busy: 'preview' | 'commit' | null;
  setBusy: (busy: 'preview' | 'commit' | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string>();

  async function previewFile(next: File): Promise<void> {
    setFile(next);
    setBusy('preview');
    setError(undefined);
    try {
      const body = new FormData();
      body.append('file', next);
      const { data } = await api.request<{ data: ImportPreview }>({
        path: 'talent/competency/assessments/import/preview',
        method: 'POST',
        body,
      });
      setPreview(data);
    } catch (cause) {
      setError(errorMessage(cause, t));
      setPreview(undefined);
    } finally {
      setBusy(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <input
          ref={inputRef}
          type='file'
          accept='.xlsx,.xls'
          className='hidden'
          aria-label={t('talent.competencyExt.import.choose')}
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) void previewFile(next);
          }}
        />
        <Button
          variant='outline'
          disabled={busy !== null}
          onClick={() => inputRef.current?.click()}
        >
          {busy === 'preview' ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <UploadIcon data-icon='inline-start' />
          )}
          {file
            ? t('talent.competencyExt.import.chooseAgain')
            : t('talent.competencyExt.import.choose')}
        </Button>
        <Button
          variant='ghost'
          onClick={() =>
            void downloadFile(
              api,
              'talent/competency/assessments/import/template',
              t('talent.competencyExt.import.templateName'),
            ).catch((cause: unknown) =>
              toast.add({ type: 'error', title: errorMessage(cause, t) }),
            )
          }
        >
          <DownloadIcon data-icon='inline-start' />
          {t('talent.competencyExt.import.template')}
        </Button>
        {file ? (
          <span className='min-w-0 truncate text-sm text-muted-foreground'>
            {file.name}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className='text-sm text-destructive' role='alert'>
          {error}
        </p>
      ) : null}
      {preview ? (
        <>
          <p className='text-sm'>
            {preview.invalid
              ? t('talent.competencyExt.import.summaryErrors', {
                  valid: preview.valid,
                  invalid: preview.invalid,
                })
              : t('talent.competencyExt.import.summaryValid', {
                  valid: preview.valid,
                })}
          </p>
          <div className='max-h-96 overflow-auto rounded-md border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className='w-14'>
                    {t('talent.competencyExt.import.row')}
                  </TableHead>
                  <TableHead>
                    {t('talent.competencyExt.import.employee')}
                  </TableHead>
                  <TableHead>{t('talent.gap.competency')}</TableHead>
                  <TableHead className='text-right'>
                    {t('talent.competencyExt.import.level')}
                  </TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('talent.assess.assessedAt')}
                  </TableHead>
                  <TableHead>
                    {t('talent.competencyExt.import.result')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow
                    key={row.row}
                    className={cn(row.errors.length && 'bg-destructive/5')}
                  >
                    <TableCell className='tabular-nums'>{row.row}</TableCell>
                    <TableCell>
                      {row.employeeName ?? '—'}
                      <div className='text-xs text-muted-foreground'>
                        {row.employeeNo}
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.competencyTitle ?? '—'}
                      <div className='text-xs text-muted-foreground'>
                        {row.competencyCode}
                      </div>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {row.level ?? '—'}
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {row.assessedAt ??
                        t('talent.competencyExt.import.importDay')}
                    </TableCell>
                    <TableCell>
                      {row.errors.length ? (
                        <ul className='space-y-0.5 text-sm text-destructive'>
                          {row.errors.map((code) => (
                            <li key={code}>
                              {t(`talent.competencyExt.import.errors.${code}`)}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Badge variant='secondary'>
                          {t('talent.competencyExt.import.ok')}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Footer({
  file,
  preview,
  busy,
  setBusy,
}: {
  file: File | null;
  preview: ImportPreview | undefined;
  busy: 'preview' | 'commit' | null;
  setBusy: (busy: 'preview' | 'commit' | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { close } = useRouteOverlay();
  const ready = Boolean(
    file && preview && !preview.invalid && preview.rows.length,
  );

  async function commit(): Promise<void> {
    if (!file) return;
    setBusy('commit');
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.request<{ data: { created: number } }>({
        path: 'talent/competency/assessments/import',
        method: 'POST',
        body,
      });
      toast.add({
        type: 'success',
        title: t('talent.competencyExt.import.done', { count: data.created }),
      });
      setBusy(null);
      await close();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
      setBusy(null);
    }
  }

  return (
    <>
      <Button
        variant='outline'
        disabled={busy !== null}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      <Button disabled={!ready || busy !== null} onClick={() => void commit()}>
        {busy === 'commit' ? <Spinner data-icon='inline-start' /> : null}
        {t('talent.competencyExt.import.commit')}
      </Button>
    </>
  );
}
