import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Navigate } from 'react-router';

import { Skeleton } from '../components/ui/skeleton';

const page = (id: string) =>
  ({ resource: { type: 'page', id }, action: 'access' }) as const;

/**
 * The landing page after sign-in. It has no menu entry of its own: it forwards to the first talent page in menu
 * order that the signed-in user may open, so every role lands on something useful.
 */
export default function HomePage(): ReactElement {
  const { t } = useTranslation();
  // One hook per candidate, in menu order; the list is fixed, so the hook order never changes.
  const candidates = [
    { path: '/talent/me', check: useCan(page('talent.me')) },
    { path: '/talent/employees', check: useCan(page('talent.employees')) },
    { path: '/talent/framework', check: useCan(page('talent.framework')) },
    {
      path: '/talent/competencies',
      check: useCan(page('talent.competencies')),
    },
    { path: '/talent/actions', check: useCan(page('talent.actions')) },
    { path: '/talent/contracts', check: useCan(page('talent.contracts')) },
    { path: '/talent/hr-reports', check: useCan(page('talent.hrReports')) },
    { path: '/talent/org-chart', check: useCan(page('talent.orgChart')) },
  ];

  // Wait for earlier candidates before choosing a later one, so the preferred page wins.
  for (const candidate of candidates) {
    if (candidate.check.isPending) {
      return (
        <section className='mx-auto w-full max-w-5xl space-y-4 px-6 py-10'>
          <Skeleton className='h-8 w-48' />
          <Skeleton className='h-40 w-full' />
        </section>
      );
    }
    if (candidate.check.can) return <Navigate to={candidate.path} replace />;
  }

  return (
    <section className='mx-auto grid min-h-[calc(100svh-4rem)] w-full max-w-5xl place-items-center px-6 py-10'>
      <div className='max-w-xl space-y-3 text-center'>
        <h1 className='font-heading text-2xl font-semibold tracking-tight'>
          {t('home.title')}
        </h1>
        <p className='text-muted-foreground'>{t('home.description')}</p>
      </div>
    </section>
  );
}
