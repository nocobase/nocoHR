import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { useOutletContext } from 'react-router';

import {
  AssessmentDialog,
  type AssessTarget,
} from '@/components/talent/assessment-dialog';
import { PracticeRecordsCard } from '@/components/talent/practice-records';
import { AssessmentHistory } from '@/components/talent/assessment-history';
import { useGapRecommendations } from '@/components/talent/gap-recommendations';
import { GapTable, RowActionButton } from '@/components/talent/gap-table';
import { AbilityRadarCard } from '@/components/talent/growth';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { AssessmentRow, GapRow } from '@/components/talent/types';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { DetailOutletContext } from './types.js';

interface CompetencyListItem {
  id: string;
  title: string;
  maxLevel: number;
  reviewStatus: string;
  active: boolean;
  levels: { level: number; title: string; behaviors: string }[];
}

/** Tab "能力": requirements against current levels, assessing, and the assessment history. */
export default function EmployeeAbilitiesTab(): ReactElement {
  const { t } = useTranslation();
  const { detail, reload } = useOutletContext<DetailOutletContext>();
  const id = encodeURIComponent(detail.employee.id);
  const gaps = useRemote<{ rows: GapRow[]; positionTitle: string | null }>(
    `talent/employees/${id}/gaps`,
  );
  const recommendations = useGapRecommendations(
    detail.employee.id,
    gaps.data?.rows,
    { self: false },
  );
  const history = useRemote<AssessmentRow[]>(
    detail.can.viewAssessments ? `talent/employees/${id}/assessments` : null,
  );
  const dictionary = useRemote<{ competencies: CompetencyListItem[] }>(
    detail.can.assess ? 'talent/competencies' : null,
  );
  const [target, setTarget] = useState<AssessTarget | null>(null);
  const [open, setOpen] = useState(false);
  const choices = useMemo<AssessTarget[]>(() => {
    const current = new Map(
      (gaps.data?.rows ?? []).map((r) => [r.competencyId, r.currentLevel]),
    );
    return (dictionary.data?.competencies ?? [])
      .filter((c) => c.active && c.reviewStatus === 'confirmed')
      .map((c) => ({
        competencyId: c.id,
        title: c.title,
        maxLevel: c.maxLevel,
        currentLevel: current.get(c.id) ?? 0,
        levels: c.levels,
      }));
  }, [dictionary.data, gaps.data]);

  const openFor = (row: GapRow | null) => {
    setTarget(
      row
        ? {
            competencyId: row.competencyId,
            title: row.title,
            maxLevel: row.maxLevel,
            currentLevel: row.currentLevel,
            levels: row.levels,
          }
        : null,
    );
    setOpen(true);
  };

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
          <div>
            <CardTitle>{t('talent.me.gaps')}</CardTitle>
            <CardDescription>
              {gaps.data?.positionTitle
                ? t('talent.me.gapsDescription', {
                    position: gaps.data.positionTitle,
                  })
                : t('talent.me.noPosition')}
            </CardDescription>
          </div>
          {detail.can.assess ? (
            <Button variant='outline' size='sm' onClick={() => openFor(null)}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.assess.other')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {gaps.error ? (
            <LoadError error={gaps.error} onRetry={gaps.reload} />
          ) : !gaps.data ? (
            <BlockSkeleton />
          ) : gaps.data.rows.length ? (
            <GapTable
              rows={gaps.data.rows}
              extra={recommendations.extra}
              action={
                detail.can.assess
                  ? (row) => (
                      <RowActionButton onClick={() => openFor(row)}>
                        {t('talent.assess.action')}
                      </RowActionButton>
                    )
                  : undefined
              }
            />
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('talent.me.noRequirements')}
            </p>
          )}
        </CardContent>
      </Card>
      <AbilityRadarCard rows={gaps.data?.rows} />
      {detail.can.viewAssessments ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.me.assessments')}</CardTitle>
          </CardHeader>
          <CardContent>
            {history.error ? (
              <LoadError error={history.error} onRetry={history.reload} />
            ) : !history.data ? (
              <BlockSkeleton rows={2} />
            ) : (
              <AssessmentHistory rows={history.data} />
            )}
          </CardContent>
        </Card>
      ) : null}
      <PracticeRecordsCard employeeId={detail.employee.id} />
      {recommendations.dialog}
      <AssessmentDialog
        employeeId={detail.employee.id}
        employeeName={detail.employee.name}
        target={target}
        choices={choices}
        open={open}
        onOpenChange={setOpen}
        onSaved={() => {
          gaps.reload();
          history.reload();
          reload();
        }}
      />
    </div>
  );
}
