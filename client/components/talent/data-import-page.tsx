import { useApiClient, useToaster } from '@nocobase/app-client';
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
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/** The importers `/api/talent/data-import/<segment>` serves, by their locale section. */
export type DataImportKind =
  'departments' | 'positions' | 'contracts' | 'leaveBalances';

const SEGMENT: Record<DataImportKind, string> = {
  departments: 'departments',
  positions: 'positions',
  contracts: 'contracts',
  leaveBalances: 'leave-balances',
};

interface PreviewRow {
  line: number;
  cells: Record<string, string>;
  errors: { column: string; code: string }[];
  action: 'create' | 'update' | 'unchanged';
}

interface Preview {
  rows: PreviewRow[];
  created: number;
  updated: number;
  unchanged: number;
  /** Positions: job family titles the import creates. */
  newFamilies?: string[];
}

export interface DataImportPageProps {
  readonly kind: DataImportKind;
  /** The template's columns in order; those marked required must be filled. */
  readonly columns: readonly { key: string; required?: boolean }[];
}

/**
 * 初始数据导入: download the template, upload it, read every row's problems
 * in the preview, then import in one transaction — the employee import's
 * flow (pages/talent/employees/import.tsx) for departments, positions,
 * contracts and opening leave balances. A child page of the list it fills;
 * the list's outlet context may pass `reload`.
 */
export function DataImportPage({
  kind,
  columns,
}: DataImportPageProps): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const navigate = useNavigate();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [error, setError] = useState<string>();
  const base = `talent/data-import/${SEGMENT[kind]}`;
  const rows = preview?.rows;
  const errorCount = rows?.filter((r) => r.errors.length).length ?? 0;
  const column = (key: string) => t(`dataImport.${kind}.columns.${key}`);

  async function previewFile(file: File): Promise<void> {
    setBusy('preview');
    setError(undefined);
    try {
      const body = new FormData();
      body.append('file', file);
      const { data } = await api.request<{ data: Preview }>({
        path: `${base}/preview`,
        method: 'POST',
        body,
      });
      setPreview(data);
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
          unchanged: number;
        };
      }>({
        path: `${base}/commit`,
        method: 'POST',
        json: { rows: rows.map(({ line, cells }) => ({ line, cells })) },
      });
      toaster.show({
        type: 'success',
        title: t('dataImport.done', {
          created: data.created,
          updated: data.updated,
          unchanged: data.unchanged,
        }),
        description: t('dataImport.doneDetail', { batch: data.batchId }),
      });
      outlet?.reload?.();
      void navigate('..');
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
          title={t(`dataImport.${kind}.title`)}
          description={t(`dataImport.${kind}.description`)}
          actions={
            <Button
              variant='outline'
              onClick={() =>
                void downloadFile(
                  api,
                  `${base}/template`,
                  `${SEGMENT[kind]}-import-template.xlsx`,
                ).catch((e: unknown) =>
                  toaster.show({ type: 'error', title: errorMessage(e, t) }),
                )
              }
            >
              <DownloadIcon data-icon='inline-start' />
              {t('dataImport.template')}
            </Button>
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>{t('dataImport.upload')}</CardTitle>
            <CardDescription>{t('dataImport.uploadHint')}</CardDescription>
          </CardHeader>
          <CardContent className='space-y-3'>
            <div className='flex flex-wrap items-center gap-1.5 text-sm'>
              <span className='text-muted-foreground'>
                {t('dataImport.columnsLabel')}
              </span>
              {columns.map((c) => (
                <Badge key={c.key} variant='outline'>
                  {column(c.key)}
                  {c.required ? ` · ${t('dataImport.required')}` : ''}
                </Badge>
              ))}
            </div>
            <div className='flex flex-wrap items-center gap-3'>
              <Input
                type='file'
                accept='.xlsx,.xls,.csv'
                className='max-w-sm'
                aria-label={t('dataImport.upload')}
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
            </div>
          </CardContent>
        </Card>
        {error ? (
          <Alert variant='destructive'>
            <FileSpreadsheetIcon />
            <AlertTitle>{t('dataImport.failed')}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {rows && preview ? (
          <Card>
            <CardHeader className='flex flex-row flex-wrap items-center justify-between gap-3'>
              <div>
                <CardTitle>{t('dataImport.preview')}</CardTitle>
                <CardDescription>
                  {errorCount
                    ? t('dataImport.hasErrors', {
                        count: errorCount,
                        total: rows.length,
                      })
                    : t('dataImport.ready', {
                        created: preview.created,
                        updated: preview.updated,
                        unchanged: preview.unchanged,
                      })}
                </CardDescription>
              </div>
              <Button
                disabled={busy !== null || errorCount > 0 || !rows.length}
                onClick={() => void commit()}
              >
                {busy === 'commit' ? (
                  <Spinner data-icon='inline-start' />
                ) : null}
                {t('dataImport.confirm')}
              </Button>
            </CardHeader>
            <CardContent className='space-y-4'>
              {preview.newFamilies?.length ? (
                <Alert>
                  <FileSpreadsheetIcon />
                  <AlertDescription>
                    {t('dataImport.newFamilies', {
                      titles: preview.newFamilies.join('、'),
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className='overflow-x-auto rounded-md border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('dataImport.line')}</TableHead>
                      {columns.map((c) => (
                        <TableHead key={c.key}>{column(c.key)}</TableHead>
                      ))}
                      <TableHead>{t('dataImport.result')}</TableHead>
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
                        {columns.map((c) => (
                          <TableCell
                            key={c.key}
                            className={cn(
                              row.errors.some((e) => e.column === c.key) &&
                                'text-destructive',
                            )}
                          >
                            {row.cells[c.key] || '—'}
                          </TableCell>
                        ))}
                        <TableCell className='whitespace-normal'>
                          {row.errors.length ? (
                            <span className='text-destructive'>
                              {row.errors
                                .map(
                                  (e) =>
                                    `${column(e.column)}：${t(`dataImport.errors.${e.code}`)}`,
                                )
                                .join('；')}
                            </span>
                          ) : (
                            <Badge
                              variant={
                                row.action === 'create'
                                  ? 'secondary'
                                  : 'outline'
                              }
                            >
                              {t(`dataImport.action.${row.action}`)}
                            </Badge>
                          )}
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
