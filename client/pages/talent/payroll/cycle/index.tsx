/**
 * V2-06 算薪周期 (covering child page of 算薪): progress and the prerequisite
 * check, imports (template, upload, preview, confirm), 计算, the payroll sheet
 * (by department, exportable, manual items with a reason), the HR assistant's
 * anomaly list, submit / approve / publish, and the export files. Every
 * action is authorized again by the server; the buttons follow the answers of
 * the detail endpoint (`can`).
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { CalculatorIcon, SendIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Outlet, useParams, useSearchParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import {
  ApprovalSteps,
  PayrollStatus,
} from '@/components/talent/payroll-shared';
import { usePayrollError } from '@/components/talent/payroll-hooks';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import type { CycleDetail } from '../types.js';
import { AnomaliesTab } from './anomalies.js';
import { ExportsTab } from './exports.js';
import { ImportsTab } from './imports.js';
import { OverviewTab } from './overview.js';
import { SheetTab } from './sheet.js';

const TABS = ['overview', 'imports', 'sheet', 'anomalies', 'exports'] as const;
const EDITABLE = ['draft', 'calculated', 'reviewing'];

export default function PayrollCyclePage(): ReactElement {
  const { t } = useTranslation();
  const { cycleId = '' } = useParams();
  const api = useApiClient();
  const failure = usePayrollError();
  const [params, setParams] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as (typeof TABS)[number])
    : 'overview';
  const detail = useRemote<CycleDetail>(
    `talent/payroll/cycles/${encodeURIComponent(cycleId)}`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState('');
  const [epoch, setEpoch] = useState(0);

  async function act(action: string, json?: unknown): Promise<void> {
    setBusy(action);
    try {
      await api.request({
        path: `talent/payroll/cycles/${encodeURIComponent(cycleId)}/${action}`,
        method: 'POST',
        ...(json === undefined ? {} : { json }),
      });
      toast.add({ type: 'success', title: t(`payroll.cycle.done.${action}`) });
      detail.reload();
      setEpoch((n) => n + 1);
    } catch (cause) {
      toast.add({ type: 'error', title: failure(cause) });
    } finally {
      setBusy(null);
    }
  }

  const data = detail.data;
  const cycle = data?.cycle;
  const refresh = () => {
    detail.reload();
    setEpoch((n) => n + 1);
  };
  return (
    <>
      <RouteChildPage>
        <PageContainer>
          <Breadcrumbs />
          {detail.error ? (
            <LoadError error={detail.error} onRetry={detail.reload} />
          ) : !data || !cycle ? (
            <BlockSkeleton rows={6} />
          ) : (
            <>
              <PageHeader
                title={t('payroll.cycle.title', { month: cycle.month })}
                description={<PayrollStatus value={cycle.status} />}
                actions={
                  <div className='flex flex-wrap justify-end gap-2'>
                    {data.can.calculate && EDITABLE.includes(cycle.status) ? (
                      <Button
                        variant='outline'
                        disabled={busy !== null}
                        onClick={() => void act('calculate')}
                      >
                        <CalculatorIcon data-icon='inline-start' />
                        {t('payroll.cycle.calculate')}
                      </Button>
                    ) : null}
                    {data.can.submit &&
                    (cycle.status === 'calculated' ||
                      cycle.status === 'reviewing') ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => void act('submit')}
                      >
                        <SendIcon data-icon='inline-start' />
                        {t('payroll.cycle.submit')}
                      </Button>
                    ) : null}
                    {data.can.approve ? (
                      <>
                        <Button
                          variant='outline'
                          disabled={busy !== null}
                          onClick={() => setRejecting(true)}
                        >
                          {t('payroll.cycle.reject')}
                        </Button>
                        <Button
                          disabled={busy !== null}
                          onClick={() =>
                            void act('decide', { decision: 'approve' })
                          }
                        >
                          {t('payroll.cycle.approve')}
                        </Button>
                      </>
                    ) : null}
                    {data.can.publish && cycle.status === 'approved' ? (
                      <Button
                        disabled={busy !== null}
                        onClick={() => void act('publish')}
                      >
                        {t('payroll.cycle.publish')}
                      </Button>
                    ) : null}
                  </div>
                }
              />
              <ApprovalSteps steps={cycle.approvals} />
              <Tabs
                value={tab}
                onValueChange={(value) => {
                  const next = new URLSearchParams(params);
                  next.set('tab', String(value));
                  setParams(next, { replace: true });
                }}
              >
                <TabsList className='flex-wrap'>
                  {TABS.filter(
                    (name) =>
                      data.can.calculate ||
                      name === 'overview' ||
                      name === 'sheet',
                  ).map((name) => (
                    <TabsTrigger key={name} value={name}>
                      {t(`payroll.cycle.tabs.${name}`)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <TabsContent value='overview' className='pt-4'>
                  <OverviewTab detail={data} />
                </TabsContent>
                <TabsContent value='imports' className='pt-4'>
                  <ImportsTab detail={data} onImported={refresh} />
                </TabsContent>
                <TabsContent value='sheet' className='pt-4'>
                  <SheetTab
                    cycleId={cycle.id}
                    month={cycle.month}
                    editable={
                      data.can.calculate && EDITABLE.includes(cycle.status)
                    }
                    epoch={epoch}
                    onChanged={refresh}
                  />
                </TabsContent>
                <TabsContent value='anomalies' className='pt-4'>
                  <AnomaliesTab cycle={cycle} epoch={epoch} />
                </TabsContent>
                <TabsContent value='exports' className='pt-4'>
                  <ExportsTab detail={data} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </PageContainer>
      </RouteChildPage>
      <Outlet />
      <Dialog open={rejecting} onOpenChange={(open) => setRejecting(open)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('payroll.cycle.reject')}</DialogTitle>
          </DialogHeader>
          <Field>
            <FieldLabel htmlFor='reject-comment'>
              {t('payroll.common.comment')}
            </FieldLabel>
            <Textarea
              id='reject-comment'
              value={comment}
              onChange={(event) => setComment(event.target.value)}
            />
          </Field>
          <DialogFooter>
            <Button variant='outline' onClick={() => setRejecting(false)}>
              {t('payroll.common.cancel')}
            </Button>
            <Button
              disabled={!comment.trim() || busy !== null}
              onClick={() => {
                setRejecting(false);
                void act('decide', {
                  decision: 'reject',
                  comment: comment.trim(),
                });
              }}
            >
              {t('payroll.cycle.reject')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
