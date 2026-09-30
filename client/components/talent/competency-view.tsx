import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement, ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import {
  useCompetencyView,
  type CompetencyTarget,
  type GapSummary,
} from './competency-types.js';
import { GapTable, type GapTableRow } from './gap-table.js';
import { BlockSkeleton, LoadError } from './states.js';

/** "必备差距 2 项 · 总差距 5" with the unassessed count when there is one. */
export function GapSummaryText({
  summary,
}: {
  summary: GapSummary;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <span className='text-sm text-muted-foreground'>
      {t('talent.competencyExt.summary', {
        mandatory: summary.mandatoryGaps,
        total: summary.totalGap,
      })}
      {summary.unassessedMandatory
        ? ` · ${t('talent.competencyExt.summaryUnassessed', {
            count: summary.unassessedMandatory,
          })}`
        : null}
    </span>
  );
}

/**
 * 目标岗位对标: one card per active development target, with the same gap
 * table computed against the target position's confirmed requirements.
 */
export function TargetGapCards({
  targets,
  action,
}: {
  targets: readonly CompetencyTarget[];
  /** A trailing row action, such as "Assess". */
  action?: (row: GapTableRow) => ReactNode;
}): ReactElement | null {
  const { t } = useTranslation();
  if (!targets.length) return null;
  return (
    <>
      {targets.map((target) => (
        <Card key={target.id}>
          <CardHeader>
            <CardTitle className='flex flex-wrap items-center gap-2'>
              {t('talent.competencyExt.targets.title')}
              <Badge variant='outline'>{target.targetPositionTitle}</Badge>
            </CardTitle>
            <CardDescription className='flex flex-wrap gap-x-3 gap-y-1'>
              <span>
                {target.reason
                  ? t('talent.competencyExt.targets.descriptionReason', {
                      position: target.targetPositionTitle,
                      reason: target.reason,
                    })
                  : t('talent.competencyExt.targets.description', {
                      position: target.targetPositionTitle,
                    })}
              </span>
              <GapSummaryText summary={target.summary} />
            </CardDescription>
          </CardHeader>
          <CardContent>
            {target.rows.length ? (
              <GapTable rows={target.rows} action={action} />
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('talent.competencyExt.targets.noRequirements')}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/**
 * The 目标岗位对标 block, loading its own data; renders nothing without an
 * active target. For pages that already show the position's gap table
 * (我的档案 · 能力).
 */
export function EmployeeTargetGaps({
  employeeId,
}: {
  employeeId: string;
}): ReactElement | null {
  const view = useCompetencyView(employeeId);
  if (view.error) return <LoadError error={view.error} onRetry={view.reload} />;
  if (!view.data) return view.loading ? <BlockSkeleton rows={2} /> : null;
  return <TargetGapCards targets={view.data.targets} />;
}
