/**
 * V2-06 派遣账单 (a tab of 算薪): upload a vendor's monthly bill, preview the
 * parsed lines and the unmatched rows, confirm the upload; the server then
 * reconciles it against locked attendance and the configured AI employee
 * writes notes. The list opens each bill in a drawer.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { UploadIcon } from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { PayrollStatus } from '@/components/talent/payroll-shared';
import { usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import { MONTH_PATTERN, type VendorBill } from './types.js';

interface BillPreview {
  lines: {
    row: number;
    employeeNo: string;
    name: string;
    billedHours: number;
    matched: boolean;
  }[];
  unmatched: { row: number; employeeNo: string; name: string }[];
  errors: { row: number; code: string }[];
}

export function VendorBillsTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const location = useLocation();
  const failure = usePayrollError();
  const list = useRemote<VendorBill[]>('talent/payroll/vendor-bills');
  const [vendorName, setVendorName] = useState('');
  const [month, setMonth] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<BillPreview | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const form = (selected: File) => {
    const body = new FormData();
    body.append('file', selected);
    body.append('vendorName', vendorName.trim());
    body.append('month', month);
    return body;
  };
  async function previewFile(selected: File): Promise<void> {
    if (!vendorName.trim() || !MONTH_PATTERN.test(month)) {
      setError(t('payroll.bills.metaRequired'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await api.request<{ data: BillPreview }>({
        path: 'talent/payroll/vendor-bills/preview',
        method: 'POST',
        body: form(selected),
      });
      setFile(selected);
      setPreview(data);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  async function confirm(): Promise<void> {
    if (!file) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/payroll/vendor-bills',
        method: 'POST',
        body: form(file),
      });
      toast.add({ type: 'success', title: t('payroll.bills.uploaded') });
      setPreview(null);
      setFile(null);
      list.reload();
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('payroll.bills.upload')}</CardTitle>
          <CardDescription>
            {t('payroll.bills.uploadDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='grid gap-4 sm:grid-cols-3'>
            <Field>
              <FieldLabel htmlFor='bill-vendor'>
                {t('payroll.bills.vendor')}
              </FieldLabel>
              <Input
                id='bill-vendor'
                value={vendorName}
                onChange={(event) => setVendorName(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor='bill-month'>
                {t('payroll.cycles.month')}
              </FieldLabel>
              <Input
                id='bill-month'
                type='month'
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </Field>
            <div className='flex items-end'>
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
              <Button
                variant='outline'
                disabled={busy}
                onClick={() => inputRef.current?.click()}
              >
                <UploadIcon data-icon='inline-start' />
                {t('payroll.bills.choose')}
              </Button>
            </div>
          </div>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {preview ? (
            <div className='space-y-3'>
              {preview.unmatched.length ? (
                <Alert>
                  <AlertDescription>
                    {t('payroll.bills.unmatched', {
                      rows: preview.unmatched
                        .map((u) => `${u.row}（${u.employeeNo}）`)
                        .join('、'),
                    })}
                  </AlertDescription>
                </Alert>
              ) : null}
              <div className='overflow-x-auto rounded-lg border'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('payroll.common.row')}</TableHead>
                      <TableHead>{t('payroll.common.employeeNo')}</TableHead>
                      <TableHead>{t('payroll.common.name')}</TableHead>
                      <TableHead className='text-right'>
                        {t('payroll.bills.billedHours')}
                      </TableHead>
                      <TableHead>{t('payroll.bills.match')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.lines.map((line) => (
                      <TableRow key={line.row}>
                        <TableCell>{line.row}</TableCell>
                        <TableCell>{line.employeeNo}</TableCell>
                        <TableCell>{line.name}</TableCell>
                        <TableCell className='text-right tabular-nums'>
                          {line.billedHours}
                        </TableCell>
                        <TableCell>
                          {line.matched
                            ? t('payroll.bills.matched')
                            : t('payroll.bills.reasons.notMatched')}
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
                <Button disabled={busy} onClick={() => void confirm()}>
                  {t('payroll.bills.confirmUpload')}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.length ? (
        <EmptyState title={t('payroll.bills.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.bills.vendor')}</TableHead>
                <TableHead>{t('payroll.cycles.month')}</TableHead>
                <TableHead>{t('payroll.cycles.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('payroll.bills.billedHours')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.bills.attendanceHours')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.bills.diffHours')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.map((bill) => (
                <TableRow key={bill.id}>
                  <TableCell>
                    <Link
                      className='font-medium underline underline-offset-4'
                      to={{
                        pathname: `vendor-bills/${bill.id}`,
                        search: location.search,
                      }}
                    >
                      {bill.vendorName}
                    </Link>
                  </TableCell>
                  <TableCell>{bill.month}</TableCell>
                  <TableCell>
                    <PayrollStatus value={bill.status} />
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {bill.totals.billedHours}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {bill.totals.attendanceHours}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {bill.totals.diffHours}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
