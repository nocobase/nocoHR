/**
 * （公开）职位列表 `/jobs`: the published postings, when 招聘设置 opens the
 * careers page. No sign-in; usable at 375px.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { useRecruitingError } from '@/components/talent/recruiting-lib';
import { useRemote } from '@/components/talent/use-remote';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export default function PublicJobsPage(): ReactElement {
  const { t } = useTranslation();
  const failure = useRecruitingError();
  const jobs = useRemote<{
    items: { slug: string; title: string; location: string }[];
  }>('public/recruiting/jobs');
  return (
    <main className='mx-auto w-full max-w-2xl space-y-4 px-4 py-10'>
      <header className='space-y-1'>
        <h1 className='text-2xl font-semibold'>
          {t('recruiting.public.jobsTitle')}
        </h1>
        <p className='text-muted-foreground'>
          {t('recruiting.public.jobsDescription')}
        </p>
      </header>
      {jobs.error ? (
        <p className='text-sm text-muted-foreground'>{failure(jobs.error)}</p>
      ) : !jobs.data ? (
        <Skeleton className='h-24 w-full' />
      ) : !jobs.data.items.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('recruiting.public.noJobs')}
        </p>
      ) : (
        jobs.data.items.map((job) => (
          <Link key={job.slug} to={job.slug} className='block'>
            <Card className='hover:bg-accent'>
              <CardHeader>
                <CardTitle>{job.title}</CardTitle>
                <CardDescription>{job.location}</CardDescription>
              </CardHeader>
            </Card>
          </Link>
        ))
      )}
    </main>
  );
}
