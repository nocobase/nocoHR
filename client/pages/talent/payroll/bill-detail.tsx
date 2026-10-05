/**
 * V2-06 派遣账单详情 (drawer): the reconciliation person by person, the AI
 * notes, and the payroll specialist's decision. The export carries hours and
 * the notes only; sending it to the vendor is up to the specialist.
 */
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useParams } from 'react-router';

import { RouteDrawer } from '@/components/route-drawer';
import { downloadFile } from '@/components/talent/download';
import { MailThread } from '@/components/talent/mail-thread';
import { PayrollStatus } from '@/components/talent/payroll-shared';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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

import type { VendorBill } from './types.js';

export default function VendorBillDrawer(): ReactElement {
  const { t } = useTranslation();
  const { billId = '' } = useParams();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const bill = useRemote<VendorBill>(
    `talent/payroll/vendor-bills/${encodeURIComponent(billId)}`,
  );
  const confirm = useCan({
    resource: { type: 'composite', id: 'talent.vendorBill' },
    action: 'confirm',
  });
  const exportable = useCan({
    resource: { type: 'composite', id: 'talent.vendorBill' },
    action: 'export',
  });
  // Sending a reply to the vendor needs the same permission as uploading its bill.
  const canUpload = useCan({
    resource: { type: 'composite', id: 'talent.vendorBill' },
    action: 'upload',
  });
  const [busy, setBusy] = useState(false);

  async function decide(decision: 'confirm' | 'dispute'): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: `talent/payroll/vendor-bills/${encodeURIComponent(billId)}/${decision}`,
        method: 'POST',
      });
      toast.add({ type: 'success', title: t(`payroll.bills.${decision}Done`) });
      bill.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    } finally {
      setBusy(false);
    }
  }

  const data = bill.data;
  return (
    <RouteDrawer
      title={
        data ? `${data.vendorName} · ${data.month}` : t('payroll.bills.title')
      }
      description={t('payroll.bills.detailDescription')}
      footer={
        data ? (
          <div className='flex flex-wrap justify-end gap-2'>
            {exportable.can ? (
              <Button
                variant='outline'
                onClick={() =>
                  void downloadFile(
                    api,
                    `talent/payroll/vendor-bills/${encodeURIComponent(billId)}/export`,
                    `${data.month}-${data.vendorName}.csv`,
                  ).catch((cause: unknown) =>
                    toast.add({ type: 'error', title: failure(cause) }),
                  )
                }
              >
                <DownloadIcon data-icon='inline-start' />
                {t('payroll.bills.export')}
              </Button>
            ) : null}
            {confirm.can && data.status !== 'confirmed' ? (
              <>
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void decide('dispute')}
                >
                  {t('payroll.bills.dispute')}
                </Button>
                <Button disabled={busy} onClick={() => void decide('confirm')}>
                  {t('payroll.bills.confirm')}
                </Button>
              </>
            ) : null}
          </div>
        ) : null
      }
    >
      {bill.error ? (
        <LoadError error={bill.error} onRetry={bill.reload} />
      ) : !data ? (
        <BlockSkeleton rows={5} />
      ) : (
        <div className='space-y-4'>
          <div className='flex flex-wrap items-center gap-3 text-sm'>
            <PayrollStatus value={data.status} />
            <span>
              {t('payroll.bills.totals', {
                billed: data.totals.billedHours,
                attendance: data.totals.attendanceHours,
                diff: data.totals.diffHours,
                people: data.totals.diffPeople,
              })}
            </span>
          </div>
          {data.aiNotes ? (
            <Alert>
              <AlertDescription className='whitespace-pre-wrap'>
                {data.aiNotes}
              </AlertDescription>
            </Alert>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('payroll.bills.noNotes')}
            </p>
          )}
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('payroll.common.employeeNo')}</TableHead>
                  <TableHead>{t('payroll.common.name')}</TableHead>
                  <TableHead className='text-right'>
                    {t('payroll.bills.billedHours')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('payroll.bills.attendanceHours')}
                  </TableHead>
                  <TableHead className='text-right'>
                    {t('payroll.bills.diffHours')}
                  </TableHead>
                  <TableHead>{t('payroll.bills.result')}</TableHead>
                  <TableHead className='text-right'>
                    {t('payroll.bills.amount')}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.reconciliation.map((line, index) => (
                  <TableRow
                    key={`${line.employeeNo}-${String(data.lines[index]?.row ?? line.billedHours)}`}
                  >
                    <TableCell>{line.employeeNo}</TableCell>
                    <TableCell>{line.name}</TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {line.billedHours}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {line.attendanceHours ?? '—'}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {line.diffHours ?? '—'}
                    </TableCell>
                    <TableCell>
                      {line.reason
                        ? t(`payroll.bills.reasons.${line.reason}`)
                        : t('payroll.bills.reasons.ok')}
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {money(data.lines[index]?.amount ?? null)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {/* V2-06 邮件往来: the vendor's mail and the reply draft, for a bill that came by mail. */}
          {data.sourceMailId ? (
            <MailThread
              mailbox='billing'
              refType='laborVendorBill'
              refId={data.id}
              canSend={canUpload.can}
            />
          ) : null}
        </div>
      )}
    </RouteDrawer>
  );
}
