import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { CheckCircle2Icon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

import type { LearningSummary } from './learning-types.js';
import { BlockSkeleton, LoadError } from './states.js';
import { useRemote } from './use-remote.js';

/** 学习记录: completed courses with their completion time, and total study time. */
export function LearningRecordsCard({
  employeeId,
}: {
  employeeId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const allowed = useCan({
    resource: { type: 'composite', id: 'talent.learningHistory' },
    action: 'view',
  });
  const summary = useRemote<LearningSummary>(
    allowed.can
      ? `talent/people/${encodeURIComponent(employeeId)}/learning`
      : null,
  );
  if (!allowed.can) return null;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('talent.learning.records')}</CardTitle>
        <CardDescription>
          {summary.data
            ? t('talent.learning.recordsDescription', {
                count: summary.data.completedCourses.length,
                minutes: summary.data.totalMinutes,
              })
            : ' '}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {summary.error ? (
          <LoadError error={summary.error} onRetry={summary.reload} />
        ) : !summary.data ? (
          <BlockSkeleton rows={2} />
        ) : summary.data.completedCourses.length ? (
          <ul className='divide-y'>
            {summary.data.completedCourses.map((course) => (
              <li
                key={course.courseId}
                className='flex items-center justify-between gap-3 py-2 text-sm'
              >
                <Link
                  to={`/talent/learning/${encodeURIComponent(course.courseId)}`}
                  className='inline-flex items-center gap-2 font-medium hover:underline'
                >
                  <CheckCircle2Icon className='size-4 text-primary' />
                  {course.title}
                </Link>
                <span className='text-muted-foreground tabular-nums'>
                  {format.format(new Date(course.completedAt))}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.learning.noRecords')}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
