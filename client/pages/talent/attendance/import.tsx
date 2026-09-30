import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import { RouteDialog } from '@/components/route-dialog';
import { useAppTimeZone } from '@/components/talent/attendance/app-time';
import { dateTimeLabel } from '@/components/talent/attendance/dates';
import { attendanceErrorMessage } from '@/components/talent/attendance/errors';
import { downloadFile } from '@/components/talent/download';
import { useRouteOverlay } from '@/components/use-route-overlay';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import type { AttendanceOutletContext } from './index.js';

interface PreviewRow {
  row: number;
  employeeNo: string;
  name: string | null;
  at: string | null;
  employeeId: string | null;
  errors: string[];
}
interface Preview {
  rows: PreviewRow[];
  valid: number;
  invalid: number;
}

/**
 * 导入打卡数据 (`/talent/attendance/import`): a device export (工号, 姓名,
 * 打卡时间) is previewed row by row first; importing sends the same file
 * again, all rows or only the valid ones, and the days are computed.
 */
export default function AttendanceImportPage(): ReactElement {
  const { t } = useTranslation();
  const context = useOutletContext<AttendanceOutletContext | undefined>();
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const busyRef = useRef(false);
  const [error, setError] = useState<unknown>();
  return (
    <RouteDialog
      title={t('attendance.import.title')}
      description={t('attendance.import.description')}
      className='sm:max-w-3xl'
      beforeClose={() => !busyRef.current}
      footer={
        <ImportFooter
          file={file}
          preview={preview}
          busy={busy}
          onBusy={(value) => {
            busyRef.current = value !== null;
            setBusy(value);
          }}
          onError={setError}
          onImported={() => context?.reload()}
        />
      }
    >
      <ImportBody
        busy={busy}
        preview={preview}
        error={error}
        onFile={(next) => {
          setFile(next);
          setPreview(undefined);
          setError(undefined);
        }}
        onBusy={(value) => {
          busyRef.current = value !== null;
          setBusy(value);
        }}
        onPreview={setPreview}
        onError={setError}
      />
    </RouteDialog>
  );
}

function ImportBody({
  busy,
  preview,
  error,
  onFile,
  onBusy,
  onPreview,
  onError,
}: {
  busy: 'preview' | 'import' | null;
  preview: Preview | undefined;
  error: unknown;
  onFile: (file: File) => void;
  onBusy: (value: 'preview' | null) => void;
  onPreview: (preview: Preview) => void;
  onError: (error: unknown) => void;
}): ReactElement {
  const { t, i18n } = useTranslation();
  const zone = useAppTimeZone();
  const api = useApiClient();
  const choose = async (file: File) => {
    onFile(file);
    onBusy('preview');
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await api.request<{ data: Preview }>({
        method: 'POST',
        path: 'talent/attendance/import/preview',
        body,
      });
      onPreview(response.data);
    } catch (cause) {
      onError(cause);
    } finally {
      onBusy(null);
    }
  };
  return (
    <div className='grid gap-4'>
      <div className='flex flex-wrap items-center gap-3'>
        <Input
          type='file'
          accept='.xlsx,.xls'
          className='max-w-sm'
          aria-label={t('attendance.import.file')}
          disabled={busy !== null}
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (next) void choose(next);
            event.target.value = '';
          }}
        />
        {busy === 'preview' ? (
          <Spinner aria-label={t('status.loading')} />
        ) : null}
        {import.meta.env.DEV ? (
          <Button
            variant='link'
            onClick={() =>
              void downloadFile(
                api,
                'talent/attendance/import/demo-file',
                'device-punches-demo.xlsx',
              ).catch((cause: unknown) =>
                toast.add({
                  type: 'error',
                  title: attendanceErrorMessage(cause, t),
                }),
              )
            }
          >
            <DownloadIcon data-icon='inline-start' />
            {t('attendance.import.demoFile')}
          </Button>
        ) : null}
      </div>
      <p className='text-sm text-muted-foreground'>
        {t('attendance.import.columns')}
      </p>
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>
            {attendanceErrorMessage(error, t)}
          </AlertDescription>
        </Alert>
      ) : null}
      {preview ? (
        <>
          <p className='text-sm font-medium'>
            {t('attendance.import.counts', {
              valid: preview.valid,
              invalid: preview.invalid,
            })}
          </p>
          <div className='max-h-80 overflow-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('attendance.import.row')}</TableHead>
                  <TableHead>{t('attendance.import.employeeNo')}</TableHead>
                  <TableHead>{t('attendance.import.name')}</TableHead>
                  <TableHead>{t('attendance.import.at')}</TableHead>
                  <TableHead>{t('attendance.import.result')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow
                    key={row.row}
                    data-invalid={row.errors.length ? true : undefined}
                    className={row.errors.length ? 'bg-destructive/5' : ''}
                  >
                    <TableCell>{row.row}</TableCell>
                    <TableCell>{row.employeeNo || '—'}</TableCell>
                    <TableCell>{row.name ?? '—'}</TableCell>
                    <TableCell>
                      {row.at
                        ? dateTimeLabel(row.at, i18n.language, zone)
                        : '—'}
                    </TableCell>
                    <TableCell>
                      {row.errors.length ? (
                        <div className='flex flex-wrap gap-1'>
                          {row.errors.map((code) => (
                            <Badge key={code} variant='destructive'>
                              {t(`attendance.import.errors.${code}`)}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge variant='secondary'>
                          {t('attendance.import.ok')}
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

function ImportFooter({
  file,
  preview,
  busy,
  onBusy,
  onError,
  onImported,
}: {
  file: File | undefined;
  preview: Preview | undefined;
  busy: 'preview' | 'import' | null;
  onBusy: (value: 'import' | null) => void;
  onError: (error: unknown) => void;
  onImported: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const { close } = useRouteOverlay();
  const submit = async (skipInvalid: boolean) => {
    if (!file || busy) return;
    onBusy('import');
    onError(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      body.append('skipInvalid', skipInvalid ? 'true' : 'false');
      const response = await api.request<{
        data: { imported: number; computed: number; skippedLocked: number };
      }>({ method: 'POST', path: 'talent/attendance/import', body });
      toast.add({
        type: 'success',
        title: t('attendance.import.done', response.data),
      });
      onImported();
      onBusy(null);
      await close();
    } catch (cause) {
      onError(cause);
      onBusy(null);
    }
  };
  const ready = Boolean(file && preview && preview.valid > 0);
  return (
    <>
      <Button
        variant='outline'
        disabled={busy !== null}
        onClick={() => void close()}
      >
        {t('actions.cancel')}
      </Button>
      {preview?.invalid ? (
        <Button
          variant='outline'
          disabled={busy !== null || !ready}
          onClick={() => void submit(true)}
        >
          {t('attendance.import.skipInvalid', { count: preview.invalid })}
        </Button>
      ) : null}
      <Button
        disabled={busy !== null || !ready || Boolean(preview?.invalid)}
        onClick={() => void submit(false)}
      >
        {busy === 'import' ? <Spinner data-icon='inline-start' /> : null}
        {t('attendance.import.submit')}
      </Button>
    </>
  );
}
