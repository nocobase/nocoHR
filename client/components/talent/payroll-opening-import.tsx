/**
 * 上线准备 · 薪酬期初导入: the button and side sheet the four payroll importers
 * share (薪资档案, 参保, 专项附加扣除, 本年个税累计期初). Download the template →
 * upload → a row-by-row preview naming each problem's column, written
 * nowhere → confirm, which uploads the same file again; the server re-checks
 * it and writes everything in one transaction. The button shows only to
 * holders of the importer's action.
 */
import { useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, UploadIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';

import { downloadFile } from '@/components/talent/download';
import { errorCode } from '@/components/talent/errors';
import { usePayrollError } from '@/components/talent/payroll-hooks';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export type OpeningImportKind =
  'salaryFiles' | 'enrolments' | 'deductions' | 'taxOpenings';

/** The URL segment, template file name and authorization of each importer. */
const KINDS: Record<
  OpeningImportKind,
  { segment: string; file: string; resource: string; action: string }
> = {
  salaryFiles: {
    segment: 'salary-files',
    file: 'salary-files-opening.xlsx',
    resource: 'talent.salary',
    action: 'import',
  },
  enrolments: {
    segment: 'enrolments',
    file: 'social-insurance-enrolments.xlsx',
    resource: 'talent.socialInsurance',
    action: 'import',
  },
  deductions: {
    segment: 'deductions',
    file: 'special-deductions.xlsx',
    resource: 'talent.socialInsurance',
    action: 'import',
  },
  taxOpenings: {
    segment: 'tax-openings',
    file: 'tax-opening.xlsx',
    resource: 'talent.payroll',
    action: 'importOpening',
  },
};

interface RowProblem {
  column: string | null;
  code: string;
  params?: Record<string, string | number>;
}

interface Preview {
  columns: string[];
  unknownColumns: string[];
  rows: {
    row: number;
    employeeNo: string;
    name: string;
    action: 'create' | 'update' | null;
    values: Record<string, string | number | null>;
    errors: RowProblem[];
    warnings: RowProblem[];
  }[];
  validRows: number;
  errorRows: number;
  createRows: number;
  updateRows: number;
}

export function OpeningImportButton({
  kind,
  variant = 'outline',
  onImported,
}: {
  kind: OpeningImportKind;
  variant?: 'default' | 'outline';
  onImported?: () => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const config = KINDS[kind];
  const allowed = useCan({
    resource: { type: 'composite', id: config.resource },
    action: config.action,
  });
  const [open, setOpen] = useState(false);
  if (!allowed.can) return null;
  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <UploadIcon data-icon='inline-start' />
        {t(`payroll.opening.entry.${kind}`)}
      </Button>
      {open ? (
        <OpeningImportSheet
          kind={kind}
          onClose={() => setOpen(false)}
          onImported={onImported}
        />
      ) : null}
    </>
  );
}

function OpeningImportSheet({
  kind,
  onClose,
  onImported,
}: {
  kind: OpeningImportKind;
  onClose: () => void;
  onImported?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const toaster = useToaster();
  const failure = usePayrollError();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const config = KINDS[kind];
  const base = `talent/payroll-imports/${config.segment}`;

  /** The importer's own wording for an import failure, else the payroll one. */
  function describe(cause: unknown): string {
    const code = errorCode(cause);
    return code
      ? t(`payroll.opening.failures.${code}`, { defaultValue: failure(cause) })
      : failure(cause);
  }
  function problem(p: RowProblem, group: 'errors' | 'warnings'): string {
    const message = t(`payroll.opening.${group}.${p.code}`, {
      ...p.params,
      defaultValue: p.code,
    });
    return p.column
      ? t('payroll.opening.rowProblem', { column: p.column, message })
      : message;
  }
  async function send(path: string, selected: File) {
    const body = new FormData();
    body.append('file', selected);
    return api.request<{ data: unknown }>({ path, method: 'POST', body });
  }
  async function check(selected: File): Promise<void> {
    setBusy(true);
    setError(undefined);
    setPreview(null);
    try {
      const { data } = await send(`${base}/preview`, selected);
      setFile(selected);
      setPreview(data as Preview);
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await send(`${base}/commit`, file);
      const result = data as { rows: number; created: number; updated: number };
      toaster.show({
        type: 'success',
        title: t('payroll.opening.done', result),
      });
      onImported?.();
      onClose();
    } catch (cause) {
      setError(describe(cause));
    } finally {
      setBusy(false);
    }
  }
  const valueColumns = preview
    ? preview.columns.filter((c) => c !== '工号' && c !== '姓名')
    : [];

  return (
    <Sheet open onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <SheetContent className='w-full overflow-y-auto sm:max-w-3xl'>
        <SheetHeader>
          <SheetTitle>{t(`payroll.opening.title.${kind}`)}</SheetTitle>
          <SheetDescription>
            {t(`payroll.opening.description.${kind}`)}
          </SheetDescription>
        </SheetHeader>
        <div className='space-y-4 px-4 pb-4 text-sm'>
          <p className='text-muted-foreground'>
            {t('payroll.opening.steps.template')}
          </p>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              onClick={() =>
                void downloadFile(api, `${base}/template`, config.file).catch(
                  (cause: unknown) =>
                    toaster.show({ type: 'error', title: describe(cause) }),
                )
              }
            >
              <DownloadIcon data-icon='inline-start' />
              {t('payroll.opening.template')}
            </Button>
            <input
              ref={inputRef}
              type='file'
              accept='.xlsx,.xls'
              className='hidden'
              onChange={(event) => {
                const selected = event.target.files?.[0];
                event.target.value = '';
                if (selected) void check(selected);
              }}
            />
            <Button disabled={busy} onClick={() => inputRef.current?.click()}>
              <UploadIcon data-icon='inline-start' />
              {preview
                ? t('payroll.opening.uploadAgain')
                : t('payroll.opening.upload')}
            </Button>
          </div>
          {busy && !preview ? (
            <p className='text-muted-foreground'>
              {t('payroll.opening.checking')}
            </p>
          ) : null}
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {preview ? (
            <div className='space-y-3'>
              <p>
                {t('payroll.opening.summary', {
                  valid: preview.validRows,
                  create: preview.createRows,
                  update: preview.updateRows,
                  errors: preview.errorRows,
                })}
              </p>
              {preview.unknownColumns.length ? (
                <p className='text-muted-foreground'>
                  {t('payroll.opening.unknownColumns', {
                    columns: preview.unknownColumns.join('、'),
                  })}
                </p>
              ) : null}
              {preview.errorRows ? (
                <Alert variant='destructive'>
                  <AlertDescription>
                    {t('payroll.opening.fixFirst')}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('payroll.opening.table.row')}</TableHead>
                      <TableHead>
                        {t('payroll.opening.table.employeeNo')}
                      </TableHead>
                      <TableHead>{t('payroll.opening.table.name')}</TableHead>
                      <TableHead>{t('payroll.opening.table.action')}</TableHead>
                      <TableHead>{t('payroll.opening.table.values')}</TableHead>
                      <TableHead>
                        {t('payroll.opening.table.problems')}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.rows.map((row) => (
                      <TableRow key={row.row}>
                        <TableCell className='tabular-nums'>
                          {row.row}
                        </TableCell>
                        <TableCell>{row.employeeNo}</TableCell>
                        <TableCell>{row.name}</TableCell>
                        <TableCell>
                          {row.action ? (
                            <Badge variant='outline'>
                              {t(`payroll.opening.actions.${row.action}`)}
                            </Badge>
                          ) : null}
                        </TableCell>
                        <TableCell className='min-w-48 text-muted-foreground'>
                          {valueColumns
                            .concat(
                              Object.keys(row.values).filter(
                                (c) => !valueColumns.includes(c),
                              ),
                            )
                            .filter(
                              (c) =>
                                row.values[c] !== null &&
                                row.values[c] !== undefined &&
                                row.values[c] !== '',
                            )
                            .map((c) => `${c} ${row.values[c]}`)
                            .join('，')}
                        </TableCell>
                        <TableCell className='min-w-48'>
                          {row.errors.map((p) => (
                            <p
                              key={`e-${p.column ?? ''}-${p.code}`}
                              className='text-destructive'
                            >
                              {problem(p, 'errors')}
                            </p>
                          ))}
                          {row.warnings.map((p) => (
                            <p
                              key={`w-${p.column ?? ''}-${p.code}`}
                              className='text-muted-foreground'
                            >
                              {problem(p, 'warnings')}
                            </p>
                          ))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}
        </div>
        <SheetFooter className='flex-row justify-end gap-2'>
          <Button variant='outline' onClick={onClose}>
            {t('payroll.opening.cancel')}
          </Button>
          <Button
            disabled={
              busy || !preview || preview.errorRows > 0 || !preview.validRows
            }
            onClick={() => void confirm()}
          >
            {t('payroll.opening.confirm', { count: preview?.validRows ?? 0 })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
