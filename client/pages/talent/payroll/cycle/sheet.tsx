/** 算薪周期 · 工资表: by department, exportable as CSV, with manual items (a reason is required). */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import type { PayslipRowView } from '../types.js';

type Cell = string | number | null | undefined;

function csv(rows: readonly (readonly Cell[])[]): string {
  const cell = (value: Cell) => {
    const text = value === null || value === undefined ? '' : String(value);
    return /[",\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
  };
  return `${String.fromCharCode(0xfeff)}${rows.map((row) => row.map(cell).join(',')).join('\r\n')}`;
}

export function SheetTab({
  cycleId,
  month,
  editable,
  epoch,
  onChanged,
}: {
  cycleId: string;
  month: string;
  editable: boolean;
  epoch: number;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const location = useLocation();
  const lookups = useLookups();
  const [departmentId, setDepartmentId] = useState('');
  const rows = useRemote<PayslipRowView[]>(
    `talent/payroll/cycles/${encodeURIComponent(cycleId)}/payslips`,
    { departmentId: departmentId || undefined, epoch },
  );
  const [manual, setManual] = useState(false);
  const [form, setForm] = useState({ employeeId: '', amount: '', reason: '' });
  const [error, setError] = useState<string>();

  function exportSheet(): void {
    const data = rows.data ?? [];
    const content = csv([
      [
        t('payroll.common.employeeNo'),
        t('payroll.common.name'),
        t('payroll.common.department'),
        t('payroll.payslip.gross'),
        t('payroll.payslip.socialEmployee'),
        t('payroll.payslip.housingFundEmployee'),
        t('payroll.payslip.tax'),
        t('payroll.payslip.net'),
      ],
      ...data.map((r) => [
        r.employeeNo,
        r.name,
        lookups.departmentTitle(r.departmentId) || r.departmentTitle,
        r.gross,
        r.socialEmployee,
        r.housingFundEmployee,
        r.tax,
        r.net,
      ]),
    ]);
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${month}-payroll.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function addManual(): Promise<void> {
    const amount = Number(form.amount);
    if (
      !form.employeeId ||
      !Number.isFinite(amount) ||
      amount === 0 ||
      !form.reason.trim()
    ) {
      setError(t('payroll.sheet.manualInvalid'));
      return;
    }
    try {
      await api.request({
        path: `talent/payroll/cycles/${encodeURIComponent(cycleId)}/manual-items`,
        method: 'POST',
        json: {
          employeeId: form.employeeId,
          amount,
          reason: form.reason.trim(),
        },
      });
      toast.add({ type: 'success', title: t('payroll.sheet.manualAdded') });
      setManual(false);
      setForm({ employeeId: '', amount: '', reason: '' });
      onChanged();
    } catch (cause) {
      setError(failure(cause));
    }
  }

  return (
    <div className='space-y-4'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <Field className='w-full sm:w-64'>
          <FieldLabel htmlFor='sheet-department'>
            {t('payroll.common.department')}
          </FieldLabel>
          <NativeSelect
            id='sheet-department'
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
          >
            <NativeSelectOption value=''>
              {t('payroll.common.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'\u3000'.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className='flex gap-2'>
          {editable ? (
            <Button variant='outline' onClick={() => setManual(true)}>
              <PlusIcon data-icon='inline-start' />
              {t('payroll.sheet.addManual')}
            </Button>
          ) : null}
          <Button
            variant='outline'
            disabled={!rows.data?.length}
            onClick={exportSheet}
          >
            <DownloadIcon data-icon='inline-start' />
            {t('payroll.sheet.export')}
          </Button>
        </div>
      </div>
      {rows.error ? (
        <LoadError error={rows.error} onRetry={rows.reload} />
      ) : !rows.data ? (
        <BlockSkeleton rows={6} />
      ) : !rows.data.length ? (
        <EmptyState title={t('payroll.sheet.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.common.employeeNo')}</TableHead>
                <TableHead>{t('payroll.common.name')}</TableHead>
                <TableHead>{t('payroll.common.department')}</TableHead>
                <TableHead className='text-right'>
                  {t('payroll.payslip.gross')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.payslip.socialEmployee')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.payslip.housingFundEmployee')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.payslip.tax')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.payslip.net')}
                </TableHead>
                <TableHead>{t('payroll.sheet.flags')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.data.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{row.employeeNo}</TableCell>
                  <TableCell>
                    <Link
                      className='font-medium underline underline-offset-4'
                      to={{
                        pathname: `payslips/${row.id}`,
                        search: location.search,
                      }}
                    >
                      {row.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {lookups.departmentTitle(row.departmentId) ||
                      row.departmentTitle}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(row.gross)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(row.socialEmployee)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(row.housingFundEmployee)}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(row.tax)}
                  </TableCell>
                  <TableCell className='text-right font-medium tabular-nums'>
                    {money(row.net)}
                  </TableCell>
                  <TableCell className='space-x-1'>
                    {!row.calculated ? (
                      <Badge variant='outline'>
                        {t('payroll.sheet.notCalculated')}
                      </Badge>
                    ) : null}
                    {row.issues ? (
                      <Badge variant='destructive'>
                        {t('payroll.sheet.issues', { count: row.issues })}
                      </Badge>
                    ) : null}
                    {row.manualItems ? (
                      <Badge variant='secondary'>
                        {t('payroll.sheet.manual', { count: row.manualItems })}
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={manual} onOpenChange={(open) => setManual(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payroll.sheet.addManual')}</DialogTitle>
            <DialogDescription>
              {t('payroll.sheet.manualDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className='space-y-3'>
            <Field>
              <FieldLabel htmlFor='manual-employee'>
                {t('payroll.common.name')}
              </FieldLabel>
              <NativeSelect
                id='manual-employee'
                value={form.employeeId}
                onChange={(event) =>
                  setForm({ ...form, employeeId: event.target.value })
                }
              >
                <NativeSelectOption value=''>
                  {t('payroll.common.choose')}
                </NativeSelectOption>
                {(rows.data ?? []).map((row) => (
                  <NativeSelectOption
                    key={row.employeeId}
                    value={row.employeeId}
                  >
                    {row.name}（{row.employeeNo}）
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='manual-amount'>
                {t('payroll.sheet.amount')}
              </FieldLabel>
              <Input
                id='manual-amount'
                inputMode='decimal'
                value={form.amount}
                onChange={(event) =>
                  setForm({ ...form, amount: event.target.value })
                }
              />
            </Field>
            <Field data-invalid={Boolean(error)}>
              <FieldLabel htmlFor='manual-reason'>
                {t('payroll.sheet.reason')}
              </FieldLabel>
              <Input
                id='manual-reason'
                value={form.reason}
                onChange={(event) =>
                  setForm({ ...form, reason: event.target.value })
                }
              />
              {error ? <FieldError>{error}</FieldError> : null}
            </Field>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setManual(false)}>
              {t('payroll.common.cancel')}
            </Button>
            <Button onClick={() => void addManual()}>
              {t('payroll.common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
