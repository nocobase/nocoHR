/**
 * V4-12 结果 in other pages:
 *
 * - `MyPerformanceResultsCard` — 我的档案 · 我的考核结果: one's published
 *   final ratings (mount on the 我的档案 page).
 * - `EmployeePerformanceTab` — 员工详情 · 绩效: published final ratings and the
 *   manager's comments, for hr.admin and heads within their scope (the server
 *   answers only those). Renders a notice when the viewer may not see them.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { isForbidden } from './errors.js';
import { useDateText } from './performance-hooks.js';
import { RatingBadge } from './performance-shared.js';
import { BlockSkeleton, LoadError } from './states.js';
import { useRemote } from './use-remote.js';

export function MyPerformanceResultsCard(): ReactElement | null {
  const { t } = useTranslation();
  const date = useDateText();
  const results = useRemote<
    {
      resultId: string;
      cycleTitle: string;
      finalRating: string | null;
      publishedAt: string | null;
    }[]
  >('talent/performance/me/results');
  if (results.error && isForbidden(results.error)) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('performance.results.mineTitle')}</CardTitle>
        <CardDescription>
          {t('performance.results.mineDescription')}
        </CardDescription>
        <CardAction>
          <Button
            size='sm'
            variant='outline'
            nativeButton={false}
            render={<Link to='/talent/my-review?tab=result' />}
          >
            {t('performance.results.open')}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {results.error ? (
          <LoadError error={results.error} onRetry={results.reload} />
        ) : !results.data ? (
          <BlockSkeleton rows={2} />
        ) : !results.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('performance.results.none')}
          </p>
        ) : (
          <ul className='divide-y text-sm'>
            {results.data.map((r) => (
              <li
                key={r.resultId}
                className='flex items-center justify-between gap-2 py-2'
              >
                <span>
                  {r.cycleTitle}
                  <span className='ms-2 text-xs text-muted-foreground'>
                    {date(r.publishedAt)}
                  </span>
                </span>
                <RatingBadge rating={r.finalRating} />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function EmployeePerformanceTab({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const date = useDateText();
  const history = useRemote<
    {
      resultId: string;
      cycleTitle: string;
      finalRating: string | null;
      managerComment: string | null;
      publishedAt: string | null;
    }[]
  >(`talent/performance/employees/${encodeURIComponent(employeeId)}/history`);
  if (history.error && isForbidden(history.error))
    return (
      <p className='text-sm text-muted-foreground'>
        {t('performance.results.forbidden')}
      </p>
    );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('performance.results.historyTitle')}</CardTitle>
        <CardDescription>
          {t('performance.results.historyDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {history.error ? (
          <LoadError error={history.error} onRetry={history.reload} />
        ) : !history.data ? (
          <BlockSkeleton rows={2} />
        ) : !history.data.length ? (
          <p className='text-sm text-muted-foreground'>
            {t('performance.results.none')}
          </p>
        ) : (
          <ul className='space-y-3 text-sm'>
            {history.data.map((r) => (
              <li key={r.resultId} className='rounded-md border p-3'>
                <div className='flex items-center justify-between gap-2'>
                  <span className='font-medium'>{r.cycleTitle}</span>
                  <RatingBadge rating={r.finalRating} />
                </div>
                <p className='text-xs text-muted-foreground'>
                  {date(r.publishedAt)}
                </p>
                <p className='mt-1 break-words whitespace-pre-wrap'>
                  {r.managerComment ?? '—'}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
