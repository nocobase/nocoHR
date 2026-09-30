/** 算薪周期 · 导入: a template per imported item, upload, a row-by-row preview, then confirm. */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';

import { downloadFile } from '@/components/talent/download';
import { usePayrollError } from '@/components/talent/payroll-hooks';
import { EmptyState } from '@/components/talent/states';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import type { CycleDetail, ImportPreview } from '../types.js';

const EDITABLE = ['draft', 'calculated', 'reviewing'];

export function ImportsTab({
  detail,
  onImported,
}: {
  detail: CycleDetail;
  onImported: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const failure = usePayrollError();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const cycle = detail.cycle;
  const base = `talent/payroll/cycles/${encodeURIComponent(cycle.id)}/imports`;
  const editable = detail.can.import && EDITABLE.includes(cycle.status);

  async function send(path: string, selected: File, skipInvalid = false) {
    const body = new FormData();
    body.append('file', selected);
    if (skipInvalid) body.append('skipInvalid', 'true');
    return api.request<{ data: ImportPreview }>({ path, method: 'POST', body });
  }
  async function previewFile(selected: File): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await send(`${base}/preview`, selected);
      setFile(selected);
      setPreview(data);
    } catch (cause) {
      setError(failure(cause));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(): Promise<void> {
    if (!file || !preview) return;
    setBusy(true);
    setError(undefined);
    try {
      await send(base, file, preview.errorRows > 0);
      toast.add({
        type: 'success',
        title: t('payroll.imports.done', { count: preview.validRows }),
      });
      setPreview(null);
      setFile(null);
      onImported();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-4'>
      {!detail.importableItems.length ? (
        <EmptyState title={t('payroll.imports.none')} />
      ) : (
        <ul className='divide-y rounded-lg border'>
          {detail.importableItems.map((item) => (
            <li
              key={item.code}
              className='flex flex-wrap items-center justify-between gap-2 p-3'
            >
              <span>
                {item.title}
                <span className='ml-2 font-mono text-xs text-muted-foreground'>
                  {item.code}
                </span>
              </span>
              <Button
                variant='outline'
                size='sm'
                onClick={() =>
                  void downloadFile(
                    api,
                    `${base}/template`,
                    `${cycle.month}-${item.code}.xlsx`,
                    {
                      item: item.code,
                    },
                  ).catch((cause: unknown) =>
                    toast.add({ type: 'error', title: failure(cause) }),
                  )
                }
              >
                <DownloadIcon data-icon='inline-start' />
                {t('payroll.imports.template')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <div>
          <input
            ref={inputRef}
            type='file'
            accept='.xlsx,.xls'
            className='hidden'
            onChange={(event) => {
              const selected = event.target.files?.[0];
              event.target.value = '';
              if (selected) void previewFile(selected);
            }}
          />
          <Button disabled={busy} onClick={() => inputRef.current?.click()}>
            <UploadIcon data-icon='inline-start' />
            {t('payroll.imports.upload')}
          </Button>
        </div>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('payroll.imports.locked')}
        </p>
      )}
      {error ? (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {preview ? (
        <div className='space-y-3'>
          <p className='text-sm'>
            {t('payroll.imports.summary', {
              items: preview.items.map((i) => i.title).join('、'),
              valid: preview.validRows,
              errors: preview.errorRows,
            })}
          </p>
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payroll.common.row')}</TableHead>
                  <TableHead>{t('payroll.common.employeeNo')}</TableHead>
                  <TableHead>{t('payroll.common.name')}</TableHead>
                  <TableHead>{t('payroll.imports.values')}</TableHead>
                  <TableHead>{t('payroll.imports.problems')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((row) => (
                  <TableRow key={row.row}>
                    <TableCell>{row.row}</TableCell>
                    <TableCell>{row.employeeNo}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell>
                      {Object.entries(row.values)
                        .map(([code, value]) => `${code} = ${value}`)
                        .join('，')}
                    </TableCell>
                    <TableCell className='text-destructive'>
                      {row.errors
                        .map((e) =>
                          t(`payroll.imports.errors.${e.code}`, {
                            defaultValue: e.code,
                          }),
                        )
                        .join('；')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className='flex justify-end gap-2'>
            <Button variant='outline' onClick={() => setPreview(null)}>
              {t('payroll.common.cancel')}
            </Button>
            <Button
              disabled={busy || !preview.validRows}
              onClick={() => void confirm()}
            >
              {preview.errorRows
                ? t('payroll.imports.confirmSkip')
                : t('payroll.imports.confirm')}
            </Button>
          </div>
        </div>
      ) : null}
      {cycle.imports.length ? (
        <section className='space-y-2'>
          <h3 className='text-sm font-medium'>
            {t('payroll.imports.history')}
          </h3>
          <ul className='space-y-1 text-sm text-muted-foreground'>
            {cycle.imports.map((record) => (
              <li key={record.id}>
                {t('payroll.imports.record', {
                  at: new Date(record.importedAt).toLocaleString(),
                  items: record.itemCodes.join('、'),
                  rows: record.rowCount,
                  errors: record.errorRows,
                  source: record.source,
                })}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
