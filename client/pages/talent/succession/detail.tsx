/**
 * V4-13 继任计划详情 (`/talent/succession/:planId`): the position's current
 * requirements, the incumbent, each candidate's gaps against them, the
 * readiness people choose (AI candidates come without one), notes and the
 * development plan link; hr.admin adds people from the server's match and
 * confirms once every candidate has a readiness.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';

import { SuccessionCandidateTable, type SuccessionCandidate as Candidate } from './candidate-table.js';
interface Plan {
  id: string;
  positionTitle: string;
  departmentTitle: string;
  incumbent: { name: string; left: boolean } | null;
  status: string;
  reviewedByName: string | null;
  /** False when the position has no requirements: gaps cannot be compared. */
  requirementsSet: boolean;
  requirements: { competencyId: string; title: string; requiredLevel: number; mandatory: boolean }[];
  candidates: Candidate[];
  risk: string | null;
  can: { manage: boolean; confirm: boolean };
}
interface Match {
  employeeId: string;
  name: string;
  departmentTitle: string;
  totalGap: number;
  latestRating: string | null;
}

export default function SuccessionDetailPage(): ReactElement {
  const { t } = useTranslation();
  const { planId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const detail = useRemote<Plan>(`talent/succession/${encodeURIComponent(planId)}`);
  const matches = useRemote<Match[]>(
    detail.data?.can.manage ? `talent/succession/${encodeURIComponent(planId)}/matches` : null,
  );
  const action = useTrAction();
  const [edits, setEdits] = useState<Record<string, { readiness?: string | null; note?: string }>>({});
  const plan = detail.data;
  const reload = () => {
    setEdits({});
    detail.reload();
    outlet?.reload?.();
  };
  const candidatesPayload = (extra?: string) =>
    (plan?.candidates ?? [])
      .map((c) => ({
        employeeId: c.employeeId,
        readiness: edits[c.employeeId]?.readiness !== undefined ? edits[c.employeeId].readiness : c.readiness,
        note: edits[c.employeeId]?.note ?? c.note,
      }))
      .concat(extra ? [{ employeeId: extra, readiness: null, note: '' }] : []);
  const saveCandidates = async (extra?: string, drop?: string) => {
    const done = await action.run(
      {
        method: 'PUT',
        path: `talent/succession/${encodeURIComponent(planId)}/candidates`,
        json: { candidates: candidatesPayload(extra).filter((c) => c.employeeId !== drop) },
      },
      t('talentReview.succession.saved'),
    );
    if (done) reload();
  };
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !plan ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            <PageHeader
              title={`${plan.departmentTitle} · ${plan.positionTitle}`}
              description={t('talentReview.succession.detailDescription', {
                incumbent: plan.incumbent?.name ?? '—',
              })}
              actions={
                <div className='flex items-center gap-2'>
                  {plan.risk ? (
                    <Badge variant='destructive'>{t(`talentReview.succession.riskType.${plan.risk}`)}</Badge>
                  ) : null}
                  <TrStatusBadge status={plan.status} />
                  {plan.can.confirm ? (
                    <Button
                      size='sm'
                      disabled={action.busy}
                      onClick={() => { void (async () => {
                        const done = await action.run(
                          { method: 'POST', path: `talent/succession/${encodeURIComponent(planId)}/confirm` },
                          t('talentReview.succession.confirmed'),
                        );
                        if (done) reload();
                      })(); }}
                    >
                      {t('talentReview.succession.confirm')}
                    </Button>
                  ) : null}
                </div>
              }
            />
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
            <Card>
              <CardHeader>
                <CardTitle>{t('talentReview.succession.requirements')}</CardTitle>
              </CardHeader>
              <CardContent className='flex flex-wrap gap-2'>
                {plan.requirementsSet ? null : (
                  <p className='text-sm text-muted-foreground'>{t('talentReview.succession.noRequirements')}</p>
                )}
                {plan.requirements.map((r) => (
                  <Badge key={r.competencyId} variant={r.mandatory ? 'default' : 'outline'}>
                    {r.title} {r.requiredLevel}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <SuccessionCandidateTable
              candidates={plan.candidates}
              requirementsSet={plan.requirementsSet}
              canManage={plan.can.manage}
              readinessOf={(c) =>
                edits[c.employeeId]?.readiness !== undefined ? (edits[c.employeeId].readiness ?? null) : c.readiness
              }
              onReadiness={(employeeId, readiness) =>
                setEdits((x) => ({ ...x, [employeeId]: { ...x[employeeId], readiness } }))
              }
              onRemove={(employeeId) => void saveCandidates(undefined, employeeId)}
            />
            {plan.can.manage ? (
              <div className='flex flex-wrap items-center justify-end gap-2'>
                <NativeSelect
                  aria-label={t('talentReview.succession.add')}
                  value=''
                  onChange={(e) => void (e.target.value ? saveCandidates(e.target.value) : undefined)}
                >
                  <NativeSelectOption value=''>{t('talentReview.succession.add')}</NativeSelectOption>
                  {(matches.data ?? [])
                    .filter((m) => !plan.candidates.some((c) => c.employeeId === m.employeeId))
                    .slice(0, 20)
                    .map((m) => (
                      <NativeSelectOption key={m.employeeId} value={m.employeeId}>
                        {plan.requirementsSet
                          ? t('talentReview.succession.matchOption', { name: m.name, gap: m.totalGap })
                          : m.name}
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
                <Button disabled={action.busy || !Object.keys(edits).length} onClick={() => void saveCandidates()}>
                  {t('talentReview.common.save')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
