import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { ActionStatusBadge } from '@/components/talent/badges';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type { PersonnelAction } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

import type { ActionsOutletContext } from './types.js';

const VIEWS = ['inbox', 'mine', 'all'] as const;

/** 人事异动 — personnel actions with their two-level approval. */
export default function ActionsPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const lookups = useLookups();
  const [params, setParams] = useSearchParams();
  const view = (VIEWS as readonly string[]).includes(params.get('view') ?? '')
    ? (params.get('view') as (typeof VIEWS)[number])
    : 'inbox';
  const list = useRemote<{
    items: PersonnelAction[];
    can: { create: boolean };
  }>('talent/actions', { view });
  const context = useMemo<ActionsOutletContext>(
    () => ({ reload: list.reload }),
    [list.reload],
  );
  const where = (departmentId: string | null, positionId: string | null) =>
    [lookups.departmentTitle(departmentId), lookups.positionTitle(positionId)]
      .filter(Boolean)
      .join(' / ') || '—';

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.actions.title')}
        description={t('talent.actions.description')}
        actions={
          list.data?.can.create ? (
            <Button
              nativeButton={false}
              render={
                <Link to={{ pathname: 'new', search: location.search }} />
              }
            >
              <PlusIcon data-icon='inline-start' />
              {t('talent.actions.create')}
            </Button>
          ) : null
        }
      />
      <Tabs
        value={view}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('view', String(value));
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          {VIEWS.map((v) => (
            <TabsTrigger key={v} value={v}>
              {t(`talent.actions.views.${v}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={5} />
      ) : !list.data.items.length ? (
        <EmptyState title={t(`talent.actions.empty.${view}`)} />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talent.actions.type')}</TableHead>
                <TableHead>{t('talent.actions.employee')}</TableHead>
                <TableHead>{t('talent.actions.change')}</TableHead>
                <TableHead>{t('talent.actions.effectiveDate')}</TableHead>
                <TableHead>{t('talent.fields.status')}</TableHead>
                <TableHead>{t('talent.actions.currentApprover')}</TableHead>
                <TableHead>{t('talent.actions.applicant')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((a) => {
                const step = a.approvals.find((s) => s.status === 'pending');
                return (
                  <TableRow key={a.id}>
                    <TableCell>
                      <Link
                        className='font-medium hover:underline'
                        to={{ pathname: a.id, search: location.search }}
                      >
                        {t(`talent.actionType.${a.actionType}`)}
                      </Link>
                    </TableCell>
                    <TableCell>{a.employeeName ?? '—'}</TableCell>
                    <TableCell className='whitespace-normal text-sm'>
                      {a.actionType === 'onboard'
                        ? where(a.toDepartmentId, a.toPositionId)
                        : a.toDepartmentId || a.toPositionId
                          ? `${where(a.fromDepartmentId, a.fromPositionId)} → ${where(a.toDepartmentId ?? a.fromDepartmentId, a.toPositionId ?? a.fromPositionId)}`
                          : where(a.fromDepartmentId, a.fromPositionId)}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {a.effectiveDate}
                    </TableCell>
                    <TableCell>
                      <ActionStatusBadge status={a.status} />
                    </TableCell>
                    <TableCell>
                      {a.status === 'pending' && step
                        ? step.kind === 'hrAdmin'
                          ? t('talent.actions.hrAdmin')
                          : t('talent.actions.levelHead', { level: step.level })
                        : '—'}
                    </TableCell>
                    <TableCell>{a.applicantName ?? '—'}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}
