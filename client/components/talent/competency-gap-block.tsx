import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { CategoryBadge } from './badges.js';
import { BlockSkeleton, LoadError } from './states.js';
import { useRemote } from './use-remote.js';

/** `GET talent/competency/actions/:id/gap` and `GET talent/competency/gap`. */
export interface PositionGapBlockData {
  readonly positionId: string;
  readonly positionTitle: string;
  /** False when the viewer may not read the employee's assessments: only requirements are listed. */
  readonly levelsVisible: boolean;
  readonly rows: readonly {
    competencyId: string;
    title: string;
    category: string;
    requiredLevel: number;
    currentLevel: number | null;
    assessed: boolean | null;
    gap: number | null;
  }[];
}

/** The read-only table; shared by the transfer form and the approval page. */
export function PositionGapTable({
  data,
}: {
  data: PositionGapBlockData;
}): ReactElement {
  const { t } = useTranslation();
  if (!data.rows.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('talent.competencyExt.actionGap.none')}
      </p>
    );
  return (
    <div className='overflow-x-auto rounded-md border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talent.gap.competency')}</TableHead>
            <TableHead className='hidden sm:table-cell'>
              {t('talent.gap.category')}
            </TableHead>
            <TableHead className='text-right'>
              {t('talent.gap.required')}
            </TableHead>
            {data.levelsVisible ? (
              <>
                <TableHead className='text-right'>
                  {t('talent.gap.current')}
                </TableHead>
                <TableHead className='text-right'>
                  {t('talent.gap.gap')}
                </TableHead>
              </>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.rows.map((row) => (
            <TableRow
              key={row.competencyId}
              className={cn((row.gap ?? 0) > 0 && 'bg-destructive/5')}
            >
              <TableCell className='font-medium'>{row.title}</TableCell>
              <TableCell className='hidden sm:table-cell'>
                <CategoryBadge category={row.category} />
              </TableCell>
              <TableCell className='text-right tabular-nums'>
                {row.requiredLevel}
              </TableCell>
              {data.levelsVisible ? (
                <>
                  <TableCell className='text-right tabular-nums'>
                    {row.assessed === false ? (
                      <span className='text-muted-foreground'>
                        {t('talent.competencyExt.unassessed')}
                      </span>
                    ) : (
                      row.currentLevel
                    )}
                  </TableCell>
                  <TableCell
                    className={cn(
                      'text-right tabular-nums',
                      (row.gap ?? 0) > 0 && 'font-semibold text-destructive',
                    )}
                  >
                    {row.gap}
                  </TableCell>
                </>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * 新岗位的必备能力与当前差距 for a transfer or promotion, for the approver.
 * Reference only: it never blocks submitting or deciding. Renders nothing for
 * other action types or when the action has no target position.
 *
 * Mount on the approval page with `<ActionCompetencyGap actionId={action.id} />`.
 */
export function ActionCompetencyGap({
  actionId,
}: {
  actionId: string;
}): ReactElement | null {
  const block = useRemote<PositionGapBlockData | null>(
    `talent/competency/actions/${encodeURIComponent(actionId)}/gap`,
  );
  return <GapCard state={block} />;
}

/** The same block for an employee and a chosen position (the transfer / promotion form). */
export function PositionCompetencyGap({
  employeeId,
  positionId,
}: {
  employeeId: string | null;
  positionId: string | null;
}): ReactElement | null {
  const block = useRemote<PositionGapBlockData>(
    employeeId && positionId ? 'talent/competency/gap' : null,
    { employeeId, positionId },
  );
  if (!employeeId || !positionId) return null;
  return <GapCard state={block} />;
}

function GapCard({
  state,
}: {
  state: {
    data: PositionGapBlockData | null | undefined;
    error: unknown;
    reload: () => void;
  };
}): ReactElement | null {
  const { t } = useTranslation();
  if (state.error)
    return <LoadError error={state.error} onRetry={state.reload} />;
  if (state.data === null) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className='flex flex-wrap items-center gap-2'>
          {t('talent.competencyExt.actionGap.title')}
          {state.data ? (
            <Badge variant='outline'>{state.data.positionTitle}</Badge>
          ) : null}
        </CardTitle>
        <CardDescription>
          {state.data && !state.data.levelsVisible
            ? t('talent.competencyExt.actionGap.levelsHidden')
            : t('talent.competencyExt.actionGap.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.data ? (
          <PositionGapTable data={state.data} />
        ) : (
          <BlockSkeleton rows={2} />
        )}
      </CardContent>
    </Card>
  );
}
