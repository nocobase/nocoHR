import { useTranslation } from '@nocobase/i18n/client';
import {
  AwardIcon,
  BookOpenIcon,
  ClipboardCheckIcon,
  SendIcon,
} from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

import type { GapRow } from './types.js';

export interface Recommendation {
  readonly courses: readonly { id: string; title: string }[];
  readonly exams: readonly { id: string; title: string }[];
  readonly certifications: readonly { id: string; title: string }[];
}

/** Links under one gap row: the certification, courses and exams that close it, with 指派 for managers. */
export function GapLinks({
  row,
  item,
  self,
  onAssign,
}: {
  row: GapRow;
  item: Recommendation;
  self: boolean;
  onAssign?: (target: { courseId?: string; examId?: string }) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const qualification = row.category === 'qualification';
  const courses = qualification ? [] : item.courses;
  const exams = qualification ? [] : item.exams;
  if (!courses.length && !exams.length && !item.certifications.length)
    return null;
  const link =
    'inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline';
  return (
    <div className='mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 pl-5 text-xs text-muted-foreground'>
      <span>{t('talent.learning.gapCourses')}</span>
      {item.certifications.map((certification) => (
        <Link
          key={certification.id}
          to={`/talent/certifications/${encodeURIComponent(certification.id)}`}
          className={link}
        >
          <AwardIcon className='size-3' />
          {certification.title}
        </Link>
      ))}
      {courses.map((course) => (
        <span key={course.id} className='inline-flex items-center gap-1'>
          {self ? (
            <Link
              to={`/talent/learning/${encodeURIComponent(course.id)}`}
              className={link}
            >
              <BookOpenIcon className='size-3' />
              {course.title}
            </Link>
          ) : (
            <span className='inline-flex items-center gap-1 text-foreground'>
              <BookOpenIcon className='size-3' />
              {course.title}
            </span>
          )}
          {onAssign ? (
            <AssignButton onClick={() => onAssign({ courseId: course.id })} />
          ) : null}
        </span>
      ))}
      {exams.map((exam) => (
        <span key={exam.id} className='inline-flex items-center gap-1'>
          {self ? (
            <Link to='/talent/my-exams' className={link}>
              <ClipboardCheckIcon className='size-3' />
              {exam.title}
            </Link>
          ) : (
            <span className='inline-flex items-center gap-1 text-foreground'>
              <ClipboardCheckIcon className='size-3' />
              {exam.title}
            </span>
          )}
          {onAssign ? (
            <AssignButton onClick={() => onAssign({ examId: exam.id })} />
          ) : null}
        </span>
      ))}
    </div>
  );
}

function AssignButton({ onClick }: { onClick: () => void }): ReactElement {
  const { t } = useTranslation();
  return (
    <Button size='xs' variant='ghost' onClick={onClick}>
      <SendIcon data-icon='inline-start' />
      {t('talent.recommendations.assign')}
    </Button>
  );
}
