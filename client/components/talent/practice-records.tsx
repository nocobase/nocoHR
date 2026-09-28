import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import { BlockSkeleton, LoadError } from './states.js';
import type { Practice } from './training-types.js';
import { useRemote } from './use-remote.js';

/**
 * 陪练记录 on a profile: each practice's score and when. The conversation
 * opens only for those who may read it (the person, the scenario's instructor,
 * HR administrators); a manager sees the score alone. Practice scores never
 * change competency levels.
 */
export function PracticeRecordsCard({
  employeeId,
}: {
  employeeId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const full = useCan({
    resource: { type: 'composite', id: 'talent.practice' },
    action: 'view',
  });
  const scores = useCan({
    resource: { type: 'composite', id: 'talent.practice' },
    action: 'viewScores',
  });
  const allowed = full.can || scores.can;
  const records = useRemote<Practice[]>(
    allowed ? `talent/people/${encodeURIComponent(employeeId)}/practice` : null,
  );
  if (!allowed) return null;
  if (records.data && !records.data.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.practice.records')}</CardTitle>
        <CardDescription>{t('talent.practice.recordsHint')}</CardDescription>
      </CardHeader>
      <CardContent>
        {records.error ? (
          <LoadError error={records.error} onRetry={records.reload} />
        ) : !records.data ? (
          <BlockSkeleton rows={2} />
        ) : (
          <ul className='divide-y'>
            {records.data.map((record) => (
              <li
                key={record.id}
                className='flex flex-wrap items-center justify-between gap-2 py-2 text-sm'
              >
                <span className='min-w-0'>
                  {record.fullAccess ? (
                    <Link
                      to={`/talent/practice/${encodeURIComponent(record.id)}`}
                      className='font-medium hover:underline'
                    >
                      {record.scenarioTitle}
                    </Link>
                  ) : (
                    <span className='font-medium'>{record.scenarioTitle}</span>
                  )}
                  <span className='block text-xs text-muted-foreground'>
                    {(record.completedAt ?? record.startedAt)
                      ? new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                        }).format(
                          new Date((record.completedAt ?? record.startedAt)!),
                        )
                      : ''}
                  </span>
                </span>
                <span className='flex items-center gap-2'>
                  {record.score !== null ? (
                    <span className='font-semibold tabular-nums'>
                      {record.score}
                    </span>
                  ) : null}
                  <Badge variant={record.passed ? 'secondary' : 'outline'}>
                    {record.status === 'completed'
                      ? record.passed
                        ? t('talent.practice.passed')
                        : t('talent.practice.notPassed')
                      : t(`talent.practice.status.${record.status}`)}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
