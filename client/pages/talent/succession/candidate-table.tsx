/**
 * The candidate table of a succession plan (`/talent/succession/:planId`).
 *
 * The shared `TableCell` keeps its text on one line (`whitespace-nowrap`), so a long note ran past its cell and
 * under the 移除 button at 1160 px. The note and gap cells wrap here instead, and the action column is as narrow
 * as its button (`w-0`) and never shrinks it.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

const READINESS = ['readyNow', 'oneToTwoYears', 'threePlusYears'] as const;

export interface SuccessionGap {
  competencyId: string;
  title: string;
  required: number;
  current: number;
}

export interface SuccessionCandidate {
  employeeId: string;
  name: string;
  departmentTitle: string;
  readiness: string | null;
  source: string;
  note: string;
  left: boolean;
  currentGaps: SuccessionGap[];
  latestRating: string | null;
  developmentPlanId: string | null;
}

export function SuccessionCandidateTable({
  candidates,
  requirementsSet,
  canManage,
  readinessOf,
  onReadiness,
  onRemove,
}: {
  candidates: readonly SuccessionCandidate[];
  /** False when the position has no requirements: no gap can be measured, so nobody meets them. */
  requirementsSet: boolean;
  canManage: boolean;
  readinessOf: (candidate: SuccessionCandidate) => string | null;
  onReadiness: (employeeId: string, readiness: string | null) => void;
  onRemove: (employeeId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='overflow-x-auto rounded-lg border'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('talentReview.succession.candidate')}</TableHead>
            <TableHead>{t('talentReview.succession.gaps')}</TableHead>
            <TableHead>{t('talentReview.detail.rating')}</TableHead>
            <TableHead>{t('talentReview.succession.readiness')}</TableHead>
            <TableHead>{t('talentReview.succession.note')}</TableHead>
            <TableHead className='w-0' />
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => (
            <TableRow
              key={c.employeeId}
              className={c.left ? 'opacity-60' : undefined}
            >
              <TableCell>
                <div className='flex items-center gap-1 font-medium'>
                  {c.name}
                  {c.source === 'ai' ? (
                    <SparklesIcon
                      className='size-3.5'
                      aria-label={t('talentReview.succession.aiCandidate')}
                    />
                  ) : null}
                  {c.left ? (
                    <Badge variant='secondary'>
                      {t('talentReview.succession.left')}
                    </Badge>
                  ) : null}
                </div>
                <div className='text-xs text-muted-foreground'>
                  {c.departmentTitle}
                </div>
              </TableCell>
              <TableCell className='min-w-40 whitespace-normal break-words'>
                {!requirementsSet
                  ? t('talentReview.succession.noRequirements')
                  : c.currentGaps.length
                    ? c.currentGaps
                        .map((g) => `${g.title} ${g.current}/${g.required}`)
                        .join('、')
                    : t('talentReview.succession.noGap')}
              </TableCell>
              <TableCell>{c.latestRating ?? '—'}</TableCell>
              <TableCell>
                <NativeSelect
                  aria-label={t('talentReview.succession.readiness')}
                  disabled={!canManage || c.left}
                  value={readinessOf(c) ?? ''}
                  onChange={(e) =>
                    onReadiness(c.employeeId, e.target.value || null)
                  }
                >
                  <NativeSelectOption value=''>
                    {t('talentReview.succession.readinessEmpty')}
                  </NativeSelectOption>
                  {READINESS.map((r) => (
                    <NativeSelectOption key={r} value={r}>
                      {t(`talentReview.readiness.${r}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </TableCell>
              <TableCell
                data-column='note'
                className='min-w-48 max-w-80 text-xs whitespace-normal break-words'
              >
                {c.note}
                {c.developmentPlanId ? (
                  <Link
                    className='ms-1 underline'
                    to={`/talent/learning-plans?plan=${encodeURIComponent(c.developmentPlanId)}`}
                  >
                    {t('talentReview.succession.plan')}
                  </Link>
                ) : null}
              </TableCell>
              <TableCell data-column='actions' className='w-0 text-right'>
                {canManage ? (
                  <Button
                    size='sm'
                    variant='ghost'
                    className='shrink-0'
                    onClick={() => onRemove(c.employeeId)}
                  >
                    {t('talentReview.common.remove')}
                  </Button>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
