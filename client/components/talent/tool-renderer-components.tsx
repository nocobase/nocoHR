import { useTranslation } from '@nocobase/i18n/client';
import { BookOpenIcon, FileTextIcon } from 'lucide-react';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import type { AIToolRendererProps } from '@/extensions/nocobase-ai';

/** The tool result the chat stores, whether it arrives as the envelope, its content, or JSON text. */
function toolContent<T>(part: AIToolRendererProps['part']): T | undefined {
  if (part.state !== 'output-available') return undefined;
  let value: unknown = (part as { output?: unknown }).output;
  for (let depth = 0; depth < 2 && typeof value === 'string'; depth += 1) {
    try {
      value = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (
    value &&
    typeof value === 'object' &&
    'content' in value &&
    'status' in value
  )
    value = (value as { content: unknown }).content;
  return value as T;
}

export function SourcesRenderer({
  part,
}: AIToolRendererProps): ReactElement | null {
  const { t } = useTranslation();
  const content = toolContent<{
    found: boolean;
    passages: { path: string; citation: string; excerpt: string }[];
  }>(part);
  if (!content)
    return (
      <p className='text-xs text-muted-foreground'>
        {t('talent.ask.searching')}
      </p>
    );
  if (!content.found)
    return (
      <p className='text-xs text-muted-foreground'>
        {t('talent.ask.noSources')}
      </p>
    );
  return (
    <div className='space-y-1.5'>
      <p className='text-xs font-medium text-muted-foreground'>
        {t('talent.ask.sources')}
      </p>
      <ul className='space-y-1'>
        {content.passages.map((passage) => (
          <li key={passage.path}>
            <Link
              to={passage.path}
              className='inline-flex items-center gap-1.5 text-sm text-primary underline-offset-4 hover:underline'
            >
              <FileTextIcon className='size-3.5 shrink-0' />
              {passage.citation}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoursesRenderer({
  part,
}: AIToolRendererProps): ReactElement | null {
  const { t } = useTranslation();
  const content = toolContent<{
    courses: {
      id: string;
      title: string;
      description: string | null;
      path: string;
    }[];
  }>(part);
  if (!content?.courses.length) return null;
  return (
    <div className='space-y-2'>
      <p className='text-xs font-medium text-muted-foreground'>
        {t('talent.ask.relatedCourses')}
      </p>
      <div className='grid gap-2 sm:grid-cols-2'>
        {content.courses.map((course) => (
          <Link
            key={course.id}
            to={course.path}
            className='rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50'
          >
            <span className='flex items-center gap-2 text-sm font-medium'>
              <BookOpenIcon className='size-4 text-primary' />
              {course.title}
            </span>
            {course.description ? (
              <span className='mt-1 line-clamp-2 block text-xs text-muted-foreground'>
                {course.description}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
    </div>
  );
}
