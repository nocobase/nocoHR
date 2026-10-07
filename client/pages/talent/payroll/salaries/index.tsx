/**
 * V2-06 人事 / 薪资档案 (`talent.salaries`): every employee's file in force,
 * 调薪申请 with their approvals, and 待建档 (on the books without a file).
 * hr.payrollApprover sees only the adjustments tab (the server answers 403 for
 * the files list). A file history opens in a drawer; a new adjustment in a
 * dialog, pre-filled from a personnel action (`?actionId=`).
 */
import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
// V4-12
import { ReviewResultLabel } from '@/components/talent/performance-payroll';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { OpeningImportButton } from '@/components/talent/payroll-opening-import';
import {
  ApprovalSteps,
  PayrollStatus,
} from '@/components/talent/payroll-shared';
import { useMoney, usePayrollError } from '@/components/talent/payroll-hooks';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
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
import { toast } from '@/components/ui/toast';

// V2-07: 待建档 · 按 Offer 预填.
import { RecruitingSalaryPrefill } from '@/components/talent/recruiting-salary-prefill';
import type { Adjustment, SalaryList } from '../types.js';

const TABS = ['files', 'adjustments', 'pending'] as const;

export default function SalariesPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const view = useCan({
    resource: { type: 'composite', id: 'talent.salary' },
    action: 'view',
  });
  const adjust = useCan({
    resource: { type: 'composite', id: 'talent.salary' },
    action: 'adjust',
  });
  const tabs = view.can ? TABS : (['adjustments'] as const);
  const requested = params.get('tab') ?? '';
  const tab = (tabs as readonly string[]).includes(requested)
    ? requested
    : tabs[0];
  return (
    <>
      <PageContainer>
        <PageHeader
          title={t('payroll.salaries.title')}
          description={t('payroll.salaries.description')}
          actions={
            <>
              {/* 上线准备: 导入期初档案 (talent.salary import). */}
              <OpeningImportButton kind='salaryFiles' />
              {adjust.can ? (
                <Button
                  nativeButton={false}
                  render={
                    <Link
                      to={{
                        pathname: 'adjustments/new',
                        search: location.search,
                      }}
                    />
                  }
                >
                  <PlusIcon data-icon='inline-start' />
                  {t('payroll.salaries.newAdjustment')}
                </Button>
              ) : null}
            </>
          }
        />
        {view.isPending ? (
          <BlockSkeleton rows={4} />
        ) : (
          <Tabs
            value={tab}
            onValueChange={(value) => {
              const next = new URLSearchParams(params);
              next.set('tab', String(value));
              setParams(next, { replace: true });
            }}
          >
            <TabsList>
              {tabs.map((name) => (
                <TabsTrigger key={name} value={name}>
                  {t(`payroll.salaries.tabs.${name}`)}
                </TabsTrigger>
              ))}
            </TabsList>
            {view.can ? (
              <>
                <TabsContent value='files' className='pt-4'>
                  <FilesTab />
                </TabsContent>
                <TabsContent value='pending' className='pt-4'>
                  <PendingTab />
                </TabsContent>
              </>
            ) : null}
            <TabsContent value='adjustments' className='pt-4'>
              <AdjustmentsTab />
            </TabsContent>
          </Tabs>
        )}
      </PageContainer>
      <Outlet />
    </>
  );
}

function FilesTab(): ReactElement {
  const { t } = useTranslation();
  const money = useMoney();
  const lookups = useLookups();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const list = useRemote<SalaryList>('talent/salaries');
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={6} />;
  const keyword = search.trim();
  const rows = list.data.rows.filter(
    (r) =>
      !keyword || r.name.includes(keyword) || r.employeeNo.includes(keyword),
  );
  return (
    <div className='space-y-3'>
      <Input
        className='max-w-xs'
        placeholder={t('payroll.common.search')}
        aria-label={t('payroll.common.search')}
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('payroll.common.employeeNo')}</TableHead>
              <TableHead>{t('payroll.common.name')}</TableHead>
              <TableHead>{t('payroll.common.department')}</TableHead>
              <TableHead className='text-right'>
                {t('payroll.salaries.base')}
              </TableHead>
              <TableHead className='text-right'>
                {t('payroll.salaries.allowances')}
              </TableHead>
              <TableHead>{t('payroll.salaries.structure')}</TableHead>
              <TableHead>{t('payroll.salaries.effectiveMonth')}</TableHead>
              <TableHead>{t('payroll.salaries.bank')}</TableHead>
              <TableHead>{t('payroll.salaries.lastAdjustment')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell>{row.employeeNo}</TableCell>
                <TableCell>
                  <Link
                    className='font-medium underline underline-offset-4'
                    to={{ pathname: row.employeeId, search: location.search }}
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell>
                  {lookups.departmentTitle(row.departmentId)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {money(row.baseSalary)}
                </TableCell>
                <TableCell className='text-right tabular-nums'>
                  {money(row.fixedAllowances.reduce((s, a) => s + a.amount, 0))}
                </TableCell>
                <TableCell>{row.structureTitle ?? '—'}</TableCell>
                <TableCell>{row.effectiveMonth ?? '—'}</TableCell>
                <TableCell className='font-mono text-xs'>
                  {row.bankAccount ?? '—'}
                </TableCell>
                <TableCell>
                  {row.lastAdjustment ? (
                    <PayrollStatus value={row.lastAdjustment.status} />
                  ) : (
                    '—'
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function PendingTab(): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  const location = useLocation();
  const list = useRemote<SalaryList>('talent/salaries');
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={4} />;
  if (!list.data.pendingFiles.length)
    return <EmptyState title={t('payroll.salaries.noPending')} />;
  return (
    <ul className='divide-y rounded-lg border'>
      {list.data.pendingFiles.map((p) => (
        <li
          key={p.employeeId}
          className='flex flex-wrap items-center justify-between gap-2 p-3 text-sm'
        >
          <span>
            {p.name}（{p.employeeNo}） ·{' '}
            {lookups.departmentTitle(p.departmentId)} ·{' '}
            {t('payroll.salaries.hired', { date: p.hireDate ?? '—' })}
          </span>
          {list.data?.can.manage ? (
            <RecruitingSalaryPrefill employeeId={p.employeeId} onDone={list.reload} />
          ) : null}
          {list.data?.can.manage ? (
            <Button
              size='sm'
              variant='outline'
              nativeButton={false}
              render={
                <Link
                  to={{ pathname: p.employeeId, search: location.search }}
                />
              }
            >
              {t('payroll.salaries.createFile')}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function AdjustmentsTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const money = useMoney();
  const failure = usePayrollError();
  const list = useRemote<Adjustment[]>('talent/salaries/adjustments');
  const [busy, setBusy] = useState<string | null>(null);
  async function decide(
    id: string,
    decision: 'approve' | 'reject',
  ): Promise<void> {
    const comment =
      decision === 'reject' ? window.prompt(t('payroll.common.comment')) : null;
    if (decision === 'reject' && !comment) return;
    setBusy(id);
    try {
      await api.request({
        path: `talent/salaries/adjustments/${encodeURIComponent(id)}/decide`,
        method: 'POST',
        json: { decision, comment },
      });
      toast.add({
        type: 'success',
        title: t(`payroll.salaries.decided.${decision}`),
      });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    } finally {
      setBusy(null);
    }
  }
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={4} />;
  if (!list.data.length)
    return <EmptyState title={t('payroll.salaries.noAdjustments')} />;
  return (
    <ul className='space-y-3'>
      {list.data.map((a) => (
        <li key={a.id} className='space-y-2 rounded-lg border p-3 text-sm'>
          <div className='flex flex-wrap items-center gap-2'>
            <span className='font-medium'>
              {a.employeeName}（{a.employeeNo}）
            </span>
            <PayrollStatus value={a.status} />
            <span className='text-muted-foreground'>
              {t('payroll.salaries.effectiveFrom', { month: a.effectiveMonth })}
            </span>
          </div>
          <p>
            {t('payroll.salaries.change', {
              before: money(a.changes.before?.baseSalary),
              after: money(a.changes.after?.baseSalary),
            })}
            {a.changes.payRange?.outOfRange ? (
              <span className='ml-2 text-destructive'>
                {t('payroll.salaries.outOfRange', {
                  min: money(a.changes.payRange.min),
                  max: money(a.changes.payRange.max),
                })}
              </span>
            ) : null}
          </p>
          <p className='text-muted-foreground'>{a.reason}</p>
          {/* V4-12: the linked review result as “周期名称 · 最终等级” only. */}
          <ReviewResultLabel
            value={
              (
                a as {
                  reviewResult?: {
                    cycleTitle: string;
                    finalRating: string | null;
                  } | null;
                }
              ).reviewResult
            }
          />
          <ApprovalSteps steps={a.approvals} />
          {a.canDecide ? (
            <div className='flex gap-2'>
              <Button
                size='sm'
                disabled={busy === a.id}
                onClick={() => void decide(a.id, 'approve')}
              >
                {t('payroll.cycle.approve')}
              </Button>
              <Button
                size='sm'
                variant='outline'
                disabled={busy === a.id}
                onClick={() => void decide(a.id, 'reject')}
              >
                {t('payroll.cycle.reject')}
              </Button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
