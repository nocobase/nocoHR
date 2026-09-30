/**
 * V4-13 继任计划详情 (`/talent/succession/:planId`): the position's current
 * requirements, the incumbent, each candidate's gaps against them, the
 * readiness people choose (AI candidates come without one), notes and the
 * development plan link; hr.admin adds people from the server's match and
 * confirms once every candidate has a readiness.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, useOutletContext, useParams } from 'react-router';

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const READINESS = ['readyNow', 'oneToTwoYears', 'threePlusYears'] as const;

interface Gap {
  competencyId: string;
  title: string;
  required: number;
  current: number;
}
interface Candidate {
  employeeId: string;
  name: string;
  departmentTitle: string;
  readiness: string | null;
  source: string;
  note: string;
  left: boolean;
  currentGaps: Gap[];
  latestRating: string | null;
  developmentPlanId: string | null;
}
interface Plan {
  id: string;
  positionTitle: string;
  departmentTitle: string;
  incumbent: { name: string; left: boolean } | null;
  status: string;
  reviewedByName: string | null;
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
                {plan.requirements.map((r) => (
                  <Badge key={r.competencyId} variant={r.mandatory ? 'default' : 'outline'}>
                    {r.title} {r.requiredLevel}
                  </Badge>
                ))}
              </CardContent>
            </Card>
            <div className='overflow-x-auto rounded-lg border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('talentReview.succession.candidate')}</TableHead>
                    <TableHead>{t('talentReview.succession.gaps')}</TableHead>
                    <TableHead>{t('talentReview.detail.rating')}</TableHead>
                    <TableHead>{t('talentReview.succession.readiness')}</TableHead>
                    <TableHead>{t('talentReview.succession.note')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plan.candidates.map((c) => (
                    <TableRow key={c.employeeId} className={c.left ? 'opacity-60' : undefined}>
                      <TableCell>
                        <div className='flex items-center gap-1 font-medium'>
                          {c.name}
                          {c.source === 'ai' ? <SparklesIcon className='size-3.5' aria-label={t('talentReview.succession.aiCandidate')} /> : null}
                          {c.left ? <Badge variant='secondary'>{t('talentReview.succession.left')}</Badge> : null}
                        </div>
                        <div className='text-muted-foreground text-xs'>{c.departmentTitle}</div>
                      </TableCell>
                      <TableCell>
                        {c.currentGaps.length
                          ? c.currentGaps.map((g) => `${g.title} ${g.current}/${g.required}`).join('、')
                          : t('talentReview.succession.noGap')}
                      </TableCell>
                      <TableCell>{c.latestRating ?? '—'}</TableCell>
                      <TableCell>
                        <NativeSelect
                          aria-label={t('talentReview.succession.readiness')}
                          disabled={!plan.can.manage || c.left}
                          value={(edits[c.employeeId]?.readiness !== undefined ? edits[c.employeeId].readiness : c.readiness) ?? ''}
                          onChange={(e) =>
                            setEdits((x) => ({
                              ...x,
                              [c.employeeId]: { ...x[c.employeeId], readiness: e.target.value || null },
                            }))
                          }
                        >
                          <NativeSelectOption value=''>{t('talentReview.succession.readinessEmpty')}</NativeSelectOption>
                          {READINESS.map((r) => (
                            <NativeSelectOption key={r} value={r}>
                              {t(`talentReview.readiness.${r}`)}
                            </NativeSelectOption>
                          ))}
                        </NativeSelect>
                      </TableCell>
                      <TableCell className='max-w-72 text-xs'>
                        {c.note}
                        {c.developmentPlanId ? (
                          <Link className='ms-1 underline' to={`/talent/learning-plans?plan=${encodeURIComponent(c.developmentPlanId)}`}>
                            {t('talentReview.succession.plan')}
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {plan.can.manage ? (
                          <Button size='sm' variant='ghost' onClick={() => void saveCandidates(undefined, c.employeeId)}>
                            {t('talentReview.common.remove')}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
                        {t('talentReview.succession.matchOption', { name: m.name, gap: m.totalGap })}
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
