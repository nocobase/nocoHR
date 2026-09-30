/**
 * V4-13 继任计划 (`/talent/succession`, hr.admin; the incumbent's superior
 * reads, the incumbent never sees their own position's plan). The key
 * positions with the incumbent, candidates, best readiness and risk; hr.admin
 * marks a position as key, which drafts a plan per department and asks the
 * talent analyst for candidates. A plan opens as the child page `:planId`.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { KeyRoundIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface PlanRow {
  id: string;
  positionTitle: string;
  departmentTitle: string;
  incumbentName: string | null;
  candidateCount: number;
  bestReadiness: string | null;
  status: string;
  risk: string | null;
}
interface PositionRow {
  id: string;
  title: string;
  isKey: boolean;
  keyReason: string | null;
}

export default function SuccessionPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ plans: PlanRow[]; positions: PositionRow[]; can: { manage: boolean } }>(
    'talent/succession',
  );
  const [marking, setMarking] = useState(false);
  return (
    <PageContainer>
      <PageHeader
        title={t('talentReview.succession.title')}
        description={t('talentReview.succession.description')}
        actions={
          list.data?.can.manage ? (
            <Button onClick={() => setMarking(true)}>
              <KeyRoundIcon data-icon='inline-start' />
              {t('talentReview.succession.markKey')}
            </Button>
          ) : null
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.plans.length ? (
        <EmptyState title={t('talentReview.succession.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.succession.position')}</TableHead>
                <TableHead>{t('talentReview.succession.incumbent')}</TableHead>
                <TableHead className='text-end'>{t('talentReview.succession.candidates')}</TableHead>
                <TableHead>{t('talentReview.succession.bestReadiness')}</TableHead>
                <TableHead>{t('talentReview.succession.risk')}</TableHead>
                <TableHead>{t('talentReview.common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <Link className='font-medium underline-offset-4 hover:underline' to={encodeURIComponent(plan.id)}>
                      {plan.departmentTitle} · {plan.positionTitle}
                    </Link>
                  </TableCell>
                  <TableCell>{plan.incumbentName ?? '—'}</TableCell>
                  <TableCell className='text-end tabular-nums'>{plan.candidateCount}</TableCell>
                  <TableCell>
                    {plan.bestReadiness ? t(`talentReview.readiness.${plan.bestReadiness}`) : '—'}
                  </TableCell>
                  <TableCell>
                    {plan.risk ? (
                      <Badge variant='destructive'>{t(`talentReview.succession.riskType.${plan.risk}`)}</Badge>
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>
                    <TrStatusBadge status={plan.status} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {marking && list.data ? (
        <KeyDialog positions={list.data.positions} onClose={() => setMarking(false)} onDone={list.reload} />
      ) : null}
      <Outlet context={{ reload: list.reload }} />
    </PageContainer>
  );
}

function KeyDialog({
  positions,
  onClose,
  onDone,
}: {
  positions: PositionRow[];
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const [reasons, setReasons] = useState<Record<string, string>>(() =>
    Object.fromEntries(positions.map((p) => [p.id, p.keyReason ?? ''])),
  );
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-xl'>
        <DialogHeader>
          <DialogTitle>{t('talentReview.succession.markKey')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          {positions.map((p) => (
            <div key={p.id} className='grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end'>
              <Field>
                <FieldLabel htmlFor={`key-${p.id}`}>{p.title}</FieldLabel>
                <Input
                  id={`key-${p.id}`}
                  placeholder={t('talentReview.succession.keyReason')}
                  value={reasons[p.id] ?? ''}
                  onChange={(e) => setReasons((r) => ({ ...r, [p.id]: e.target.value }))}
                />
              </Field>
              <Switch
                aria-label={t('talentReview.succession.isKey', { title: p.title })}
                checked={p.isKey}
                disabled={action.busy}
                onCheckedChange={(value) => { void (async () => {
                  const done = await action.run(
                    {
                      method: 'PUT',
                      path: `talent/succession/positions/${encodeURIComponent(p.id)}/key`,
                      json: { isKey: value, keyReason: reasons[p.id] || undefined },
                    },
                    t('talentReview.succession.keySaved'),
                  );
                  if (done) onDone();
                })(); }}
              />
            </div>
          ))}
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
