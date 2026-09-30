import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, FileSpreadsheetIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useNavigate, useOutletContext } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
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
import { cn } from '@/lib/utils';

import type { EmployeesOutletContext } from './types.js';

interface ImportRow {
  line: number;
  employeeNo: string;
  name: string;
  departmentCode: string;
  /** A position code or title as the file has it. */
  position: string;
  managerEmployeeNo: string;
  hireDate: string;
  email: string;
  mobile: string;
  errors: string[];
  action: 'create' | 'update' | 'skip';
  newPosition: string | null;
  /** V1-03: the employee follows the office suite; department, position and manager columns are skipped. */
  syncManaged?: boolean;
  /** 界面追加字段 columns of the file, sent back unchanged on confirm. */
  customFields?: Record<string, string>;
  /** Which added field failed on this row. */
  customFieldErrors?: { key: string; label: string; code: string }[];
}

interface ImportPreview {
  rows: ImportRow[];
  created: number;
  updated: number;
  newPositions: string[];
  jobFamilies: { id: string; title: string }[];
}

/**
 * Route `/talent/employees/import`: upload, preview with per-row errors, then
 * import in one transaction. Position titles that match no enabled position
 * are created by the import; each needs a job family before confirming. After
 * the import the HR assistant checks the data in the background.
 */
export default function ImportEmployeesPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const { reload } = useOutletContext<EmployeesOutletContext>();
  const [preview, setPreview] = useState<ImportPreview>();
  const rows = preview?.rows;
  const [families, setFamilies] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string>();
  const errorCount = rows?.filter((r) => r.errors.length).length ?? 0;
  const missingFamilies =
    preview?.newPositions.filter((title) => !families[title]).length ?? 0;

  async function previewFile(file: File): Promise<void> {
    setBusy('preview');
    setError(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.request<{ data: ImportPreview }>({
        path: 'talent/employees/import/preview',
        method: 'POST',
        body,
      });
      setPreview(data);
      setFamilies({});
    } catch (cause) {
      setError(errorMessage(cause, t));
      setPreview(undefined);
    } finally {
      setBusy(null);
    }
  }

  async function commit(): Promise<void> {
    if (!rows) return;
    setBusy('commit');
    setError(undefined);
    try {
      const { data } = await api.request<{
        data: {
          batchId: string;
          created: number;
          updated: number;
          createdPositions: number;
        };
      }>({
        path: 'talent/employees/import/commit',
        method: 'POST',
        json: { rows, newPositionFamilies: families },
      });
      toast.add({
        type: 'success',
        title: t('talent.import.done', {
          created: data.created,
          updated: data.updated,
        }),
        description: t('talent.import.doneDetail', {
          batch: data.batchId,
          positions: data.createdPositions,
        }),
      });
      reload();
      void navigate(
        `/talent/employees?batch=${encodeURIComponent(data.batchId)}`,
      );
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        <PageHeader
          title={t('talent.import.title')}
          description={t('talent.import.description')}
          actions={
            <Button
              variant='outline'
              onClick={() =>
                void downloadFile(
                  api,
                  'talent/employees/import-template',
                  'employee-import-template.xlsx',
                ).catch((e: unknown) =>
                  toast.add({ type: 'error', title: errorMessage(e, t) }),
                )
              }
            >
              <DownloadIcon data-icon='inline-start' />
              {t('talent.import.template')}
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.import.upload')}</CardTitle>
            <CardDescription>{t('talent.import.columns')}</CardDescription>
          </CardHeader>
          <CardContent className='flex flex-wrap items-center gap-3'>
            <Input
              type='file'
              accept='.xlsx,.xls,.csv'
              className='max-w-sm'
              aria-label={t('talent.import.upload')}
              disabled={busy !== null}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void previewFile(file);
                event.target.value = '';
              }}
            />
            {busy === 'preview' ? (
              <Spinner aria-label={t('status.loading')} />
            ) : null}
          </CardContent>
        </Card>
        {error ? (
          <Alert variant='destructive'>
            <FileSpreadsheetIcon />
            <AlertTitle>{t('talent.import.failed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {rows ? (
          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
              <div>
                <CardTitle>{t('talent.import.preview')}</CardTitle>
                <CardDescription>
                  {errorCount
                    ? t('talent.import.hasErrors', {
                        count: errorCount,
                        total: rows.length,
                      })
                    : t('talent.import.readyCounts', {
                        created: preview.created,
                        updated: preview.updated,
                      })}
                </CardDescription>
              </div>
              <Button
                disabled={
                  busy !== null ||
                  errorCount > 0 ||
                  missingFamilies > 0 ||
                  !rows.length
                }
                onClick={() => void commit()}
              >
                {busy === 'commit' ? (
                  <Spinner data-icon='inline-start' />
                ) : null}
                {t('talent.import.confirm')}
              </Button>
            </CardHeader>
            <CardContent className='space-y-4'>
              {preview.newPositions.length ? (
                <Alert>
                  <FileSpreadsheetIcon />
                  <AlertTitle>
                    {t('talent.import.newPositions', {
                      titles: preview.newPositions.join('、'),
                    })}
                  </AlertTitle>
                  <AlertDescription className='space-y-2'>
                    <p>{t('talent.import.newPositionsHint')}</p>
                    {preview.newPositions.map((title) => (
                      <div
                        key={title}
                        className='flex flex-wrap items-center gap-2'
                      >
                        <span className='min-w-24 font-medium text-foreground'>
                          {title}
                        </span>
                        <NativeSelect
                          aria-label={t('talent.import.familyFor', { title })}
                          value={families[title] ?? ''}
                          onChange={(e) =>
                            setFamilies((current) => ({
                              ...current,
                              [title]: e.target.value,
                            }))
                          }
                        >
                          <NativeSelectOption value=''>
                            {t('talent.import.chooseFamily')}
                          </NativeSelectOption>
                          {preview.jobFamilies.map((family) => (
                            <NativeSelectOption
                              key={family.id}
                              value={family.id}
                            >
                              {family.title}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </div>
                    ))}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('talent.import.line')}</TableHead>
                      <TableHead>{t('talent.fields.employeeNo')}</TableHead>
                      <TableHead>{t('talent.fields.name')}</TableHead>
                      <TableHead>{t('talent.import.departmentCode')}</TableHead>
                      <TableHead>{t('talent.import.position')}</TableHead>
                      <TableHead>{t('talent.import.managerNo')}</TableHead>
                      <TableHead>{t('talent.fields.hireDate')}</TableHead>
                      <TableHead>{t('talent.import.result')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.line}
                        className={cn(row.errors.length && 'bg-destructive/5')}
                      >
                        <TableCell className='tabular-nums'>
                          {row.line}
                        </TableCell>
                        <TableCell>{row.employeeNo}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>{row.departmentCode}</TableCell>
                        <TableCell>
                          {row.position || '—'}
                          {row.newPosition ? (
                            <Badge variant='outline' className='ml-1'>
                              {t('talent.import.willCreate')}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell>{row.managerEmployeeNo || '—'}</TableCell>
                        <TableCell className='tabular-nums'>
                          {row.hireDate || '—'}
                        </TableCell>
                        <TableCell className='whitespace-normal'>
                          {row.errors.length ? (
                            <span className='text-destructive'>
                              {row.errors
                                .map((code) =>
                                  code === 'CUSTOM_FIELD_INVALID' &&
                                  row.customFieldErrors?.length
                                    ? row.customFieldErrors
                                        .map(
                                          (e) =>
                                            `${e.label}：${t(`talent.errors.${e.code}`)}`,
                                        )
                                        .join('；')
                                    : t(`talent.errors.${code}`),
                                )
                                .join('；')}
                            </span>
                          ) : (
                            <Badge
                              variant={
                                row.action === 'update'
                                  ? 'outline'
                                  : 'secondary'
                              }
                            >
                              {t(`talent.import.action.${row.action}`)}
                            </Badge>
                          )}
                          {row.syncManaged ? (
                            <p className='mt-1 text-xs text-muted-foreground'>
                              {t('talent.import.syncManaged')}
                            </p>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </PageContainer>
    </RouteChildPage>
  );
}
