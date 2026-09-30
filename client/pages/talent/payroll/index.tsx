/**
 * V2-06 人事 / 算薪 (`talent.payroll`): the payroll cycles, and the 派遣账单 tab.
 * hr.payroll sees and creates every cycle; hr.payrollApprover sees only the
 * cycles waiting for, or decided by, them (the server filters). A cycle opens
 * as a covering child page; a bill in a drawer.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { PayrollStatus } from '@/components/talent/payroll-shared';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

import { MONTH_PATTERN, type CycleListItem } from './types.js';
import { VendorBillsTab } from './vendor-bills.js';

const TABS = ['cycles', 'vendorBills'] as const;

export default function PayrollPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as (typeof TABS)[number])
    : 'cycles';
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('payroll.cycles.title')}
          description={t('payroll.cycles.description')}
        />
        <Tabs
          value={tab}
          onValueChange={(value) => {
            const next = new URLSearchParams(params);
            next.set('tab', String(value));
            setParams(next, { replace: true });
          }}
        >
          <TabsList>
            {TABS.map((name) => (
              <TabsTrigger key={name} value={name}>
                {t(`payroll.cycles.tabs.${name}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value='cycles' className='pt-4'>
            <CyclesTab />
          </TabsContent>
          <TabsContent value='vendorBills' className='pt-4'>
            <VendorBillsTab />
          </TabsContent>
        </Tabs>
      </PageContainer>
      <Outlet />
    </>
  );
}

function CyclesTab(): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const list = useRemote<{
    cycles: CycleListItem[];
    can: { create: boolean; suggestedMonth: string };
  }>('talent/payroll/cycles');
  const [creating, setCreating] = useState(false);
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={4} />;
  return (
    <div className='space-y-4'>
      {list.data.can.create ? (
        <div className='flex justify-end'>
          <Button onClick={() => setCreating(true)}>
            <PlusIcon data-icon='inline-start' />
            {t('payroll.cycles.create')}
          </Button>
        </div>
      ) : null}
      {!list.data.cycles.length ? (
        <EmptyState
          title={t('payroll.cycles.empty')}
          description={t('payroll.cycles.emptyDescription')}
        />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('payroll.cycles.month')}</TableHead>
                <TableHead>{t('payroll.cycles.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('payroll.cycles.payslips')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.cycles.issues')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('payroll.cycles.totalNet')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.cycles.map((cycle) => (
                <TableRow key={cycle.id}>
                  <TableCell>
                    <Link
                      className='font-medium underline underline-offset-4'
                      to={cycle.id}
                    >
                      {cycle.month}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <PayrollStatus value={cycle.status} />
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {cycle.payslips}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {cycle.issues}
                  </TableCell>
                  <TableCell className='text-right tabular-nums'>
                    {money(cycle.totalNet)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CreateCycleDialog
        open={creating}
        suggested={list.data.can.suggestedMonth}
        onClose={() => setCreating(false)}
      />
    </div>
  );
}

function CreateCycleDialog({
  open,
  suggested,
  onClose,
}: {
  open: boolean;
  suggested: string;
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const failure = usePayrollError();
  const [month, setMonth] = useState(suggested);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function create(): Promise<void> {
    if (!MONTH_PATTERN.test(month)) {
      setError(t('payroll.errors.PAYROLL_MONTH_INVALID'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const { data } = await api.request<{ data: { id: string } }>({
        path: 'talent/payroll/cycles',
        method: 'POST',
        json: { month },
      });
      onClose();
      await navigate(data.id);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('payroll.cycles.create')}</DialogTitle>
          <DialogDescription>
            {t('payroll.cycles.createDescription')}
          </DialogDescription>
        </DialogHeader>
        <Field data-invalid={Boolean(error)}>
          <FieldLabel htmlFor='payroll-month'>
            {t('payroll.cycles.month')}
          </FieldLabel>
          <Input
            id='payroll-month'
            type='month'
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('payroll.common.cancel')}
          </Button>
          <Button disabled={busy} onClick={() => void create()}>
            {t('payroll.common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
