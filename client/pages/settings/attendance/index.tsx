import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { Link, Outlet } from 'react-router';
import { useMemo, useState } from 'react';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import { ConfigCard } from './config-card.js';
import { SettingsError } from './feedback.js';
import {
  SETTINGS_API,
  type SettingsData,
  type Shift,
  type Rule,
} from './types.js';

export default function AttendanceSettingsPage() {
  const { t } = useTranslation();
  const access = useCan({
    resource: { type: 'composite', id: 'talent.attendanceSettings' },
    action: 'manage',
  });
  const [saved, setSaved] = useState<{
    kind: 'shifts' | 'rules';
    record?: Shift | Rule;
    gone?: string;
    epoch: number;
  }>();
  const context = useMemo(
    () => ({
      saved: (kind: 'shifts' | 'rules', record: Shift | Rule) =>
        setSaved((last) => ({ kind, record, epoch: (last?.epoch ?? 0) + 1 })),
      gone: (kind: 'shifts' | 'rules', id: string) =>
        setSaved((last) => ({ kind, gone: id, epoch: (last?.epoch ?? 0) + 1 })),
    }),
    [],
  );
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('attendance.settings.title')}
        description={t('attendance.settings.description')}
      />
      {access.isPending ? (
        <BlockSkeleton rows={4} />
      ) : access.error ? (
        <SettingsError error={access.error} retry={access.retry} />
      ) : !access.can ? (
        <p>{t('attendance.leave.errors.forbidden')}</p>
      ) : (
        <>
          <CatalogCard
            kind='shifts'
            epoch={saved?.epoch ?? 0}
            saved={saved?.kind === 'shifts' ? saved.record : undefined}
            gone={saved?.kind === 'shifts' ? saved.gone : undefined}
          />
          <CatalogCard
            kind='rules'
            epoch={saved?.epoch ?? 0}
            saved={saved?.kind === 'rules' ? saved.record : undefined}
            gone={saved?.kind === 'rules' ? saved.gone : undefined}
          />
          <ConfigCard section='calendar' />
          <ConfigCard section='annualLeave' />
          <ConfigCard section='limits' />
          <p className='text-sm text-muted-foreground'>
            {t('attendance.settings.pendingScope')}
          </p>
        </>
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}

function CatalogCard({
  kind,
  saved,
  epoch,
  gone,
}: {
  kind: 'shifts' | 'rules';
  saved?: Shift | Rule;
  epoch: number;
  gone?: string;
}) {
  const { t } = useTranslation();
  const remote = useRemote<SettingsData>(SETTINGS_API, { refresh: epoch });
  const rows = remote.data?.[kind];
  const data = (rows?.data ?? []).filter((row) => row.id !== gone);
  if (saved) {
    const index = data.findIndex((row) => row.id === saved.id);
    if (index === -1) data.unshift(saved);
    else if (data[index].updatedAt < saved.updatedAt) data[index] = saved;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t(`attendance.settings.${kind}`)}</CardTitle>
        <CardDescription>
          {t(`attendance.settings.${kind}Description`)}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-3'>
        {remote.error ? (
          <SettingsError error={remote.error} retry={remote.reload} />
        ) : !rows && !saved ? (
          <BlockSkeleton rows={3} />
        ) : (
          <>
            {remote.loading ? <Spinner /> : null}
            {rows?.meta.truncated ? (
              <p className='text-sm text-muted-foreground'>
                {t('attendance.leave.cap')}
              </p>
            ) : null}
            {!data.length ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>{t('attendance.settings.empty')}</EmptyTitle>
                  <EmptyDescription>
                    {t('attendance.settings.emptyDescription')}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className='divide-y'>
                {data.map((row) => (
                  <li
                    key={row.id}
                    className='flex flex-wrap items-center justify-between gap-2 py-3'
                  >
                    <Link
                      className='font-medium underline underline-offset-4'
                      to={`${kind}/${encodeURIComponent(row.id)}/edit`}
                    >
                      {row.title}
                    </Link>
                    <Badge variant='secondary'>
                      {t(
                        `attendance.leave.${row.active ? 'active' : 'inactive'}`,
                      )}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
      <CardFooter className='justify-end gap-2'>
        <Button
          variant='outline'
          disabled={remote.loading}
          onClick={remote.reload}
        >
          {t('attendance.settings.refresh')}
        </Button>
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to={`${kind}/new`} />}
        >
          {t(`attendance.settings.new${kind === 'shifts' ? 'Shift' : 'Rule'}`)}
        </Button>
      </CardFooter>
    </Card>
  );
}
