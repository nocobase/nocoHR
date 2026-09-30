import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { EmptyState } from '@/components/talent/states';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { useRemote } from '@/components/talent/use-remote';
import { Skeleton } from '@/components/ui/skeleton';

import {
  arrange,
  SERVICES,
  type SelfServiceCardsConfig,
  type ServiceEntry,
} from './services.js';

const page = (id: string) => ({
  resource: { type: 'page' as const, id },
  action: 'access',
});

/** 自助 (V1-04): the employee's existing self-service features gathered as cards. */
export default function SelfServicePage(): ReactElement {
  const { t } = useTranslation();
  const config = useRemote<{ value: SelfServiceCardsConfig }>(
    'talent/ai-entry/self-service',
  );
  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentSelfService')}
        description={t('selfServicePage.description')}
      />
      {config.loading && !config.data ? (
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
          <Skeleton className='h-28 w-full rounded-xl' />
          <Skeleton className='h-28 w-full rounded-xl' />
          <Skeleton className='h-28 w-full rounded-xl' />
        </div>
      ) : (
        // Without the settings (not saved yet, or unreadable) the default order applies.
        <ServiceGrid entries={arrange(SERVICES, config.data?.value)} />
      )}
    </PageContainer>
  );
}

/** Renders the cards the user may open; says so when there are none. */
export function ServiceGrid({
  entries,
}: {
  readonly entries: readonly ServiceEntry[];
}): ReactElement {
  return (
    <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-3'>
      {entries.map((entry) => (
        <ServiceCard key={entry.key} entry={entry} />
      ))}
      <NoneVisible entries={entries} />
    </div>
  );
}

function ServiceCard({ entry }: { entry: ServiceEntry }): ReactElement | null {
  const { t } = useTranslation();
  const target = useCan(entry.page);
  const action = useCan(entry.action, { enabled: Boolean(entry.action) });
  if (target.isPending || action.isPending)
    return <Skeleton className='h-28 w-full rounded-xl' />;
  if (!target.can || (entry.action && !action.can)) return null;
  const Icon = entry.icon;
  return (
    <Link
      to={entry.to}
      className='rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
    >
      <Card className='h-full transition-colors hover:bg-muted/50'>
        <CardHeader>
          <CardTitle className='flex items-center gap-2'>
            <Icon className='size-4 text-muted-foreground' />
            {t(`selfServicePage.cards.${entry.key}.title`)}
          </CardTitle>
          <CardDescription>
            {t(`selfServicePage.cards.${entry.key}.description`)}
          </CardDescription>
        </CardHeader>
      </Card>
    </Link>
  );
}

/** The empty state, once every check has answered and none passed. */
function NoneVisible({
  entries,
}: {
  entries: readonly ServiceEntry[];
}): ReactElement | null {
  const { t } = useTranslation();
  const checks = useChecks(entries);
  if (checks.pending || checks.any) return null;
  return (
    <div className='sm:col-span-2 lg:col-span-3'>
      <EmptyState
        title={t('selfServicePage.empty')}
        description={t('selfServicePage.emptyDescription')}
      />
    </div>
  );
}

/**
 * Whether any card can be visible: every card needs `talent.me` or
 * `talent.orgChart`, so those two page checks decide the empty state.
 */
function useChecks(entries: readonly ServiceEntry[]): {
  pending: boolean;
  any: boolean;
} {
  // The requirement list is fixed per page, so the number of hooks is stable.
  const me = useCan(page('talent.me'));
  const orgChart = useCan(page('talent.orgChart'));
  const pending = me.isPending || orgChart.isPending;
  const pages = new Set(
    [me.can && 'talent.me', orgChart.can && 'talent.orgChart'].filter(Boolean),
  );
  return {
    pending,
    // A card whose page passes may still be hidden by its action check; the cards themselves decide.
    any: entries.some((e) => pages.has(e.page.resource.id)),
  };
}
