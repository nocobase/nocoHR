import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon, UploadIcon } from 'lucide-react';
import { useMemo, type ReactElement } from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { ReviewStatusBadge } from '@/components/talent/badges';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import {
  CATEGORIES,
  type CompetenciesOutletContext,
  type CompetencyItem,
} from './types.js';

/** 能力词典 — the competency dictionary grouped by category. */
export default function CompetenciesPage(): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const draftOnly = params.get('drafts') === '1';
  // V3-08: 已停用 filter.
  const inactiveOnly = params.get('inactive') === '1';
  const list = useRemote<{
    competencies: CompetencyItem[];
    canManage: boolean;
    canConfirm: boolean;
  }>('talent/competencies', {
    draftOnly: draftOnly || undefined,
    includeInactive: true,
  });
  const context = useMemo<CompetenciesOutletContext>(
    () => ({
      reload: list.reload,
      canManage: list.data?.canManage ?? false,
      canConfirm: list.data?.canConfirm ?? false,
    }),
    [list.reload, list.data],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.competencies.title')}
        description={t('talent.competencies.description')}
        actions={
          list.data?.canManage ? (
            <>
              <Button
                variant='outline'
                nativeButton={false}
                render={
                  <Link
                    to={{
                      pathname: 'assessments-import',
                      search: location.search,
                    }}
                  />
                }
              >
                <UploadIcon data-icon='inline-start' />
                {t('talent.competencyExt.import.open')}
              </Button>
              <Button
                nativeButton={false}
                render={
                  <Link to={{ pathname: 'new', search: location.search }} />
                }
              >
                <PlusIcon data-icon='inline-start' />
                {t('talent.competencies.create')}
              </Button>
            </>
          ) : null
        }
      />
      <div className='flex items-center gap-2'>
        <Switch
          id='drafts-only'
          checked={draftOnly}
          onCheckedChange={(checked) => {
            const next = new URLSearchParams(params);
            if (checked) next.set('drafts', '1');
            else next.delete('drafts');
            setParams(next, { replace: true });
          }}
        />
        <Label htmlFor='drafts-only'>
          {t('talent.competencies.draftsOnly')}
        </Label>
        <Switch
          id='inactive-only'
          className='ml-4'
          checked={inactiveOnly}
          onCheckedChange={(checked) => {
            const next = new URLSearchParams(params);
            if (checked) next.set('inactive', '1');
            else next.delete('inactive');
            setParams(next, { replace: true });
          }}
        />
        <Label htmlFor='inactive-only'>
          {t('talent.competencyExt.inactiveOnly')}
        </Label>
      </div>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={6} />
      ) : !list.data.competencies.length ? (
        <EmptyState
          title={
            draftOnly
              ? t('talent.competencies.noDrafts')
              : t('talent.competencies.empty')
          }
        />
      ) : (
        CATEGORIES.map((category) => {
          const rows = list.data!.competencies.filter(
            (c) => c.category === category && (!inactiveOnly || !c.active),
          );
          if (!rows.length) return null;
          return (
            <Card key={category}>
              <CardHeader>
                <CardTitle>
                  {t(`talent.category.${category}`)}{' '}
                  <span className='text-sm font-normal text-muted-foreground'>
                    · {rows.length}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className='overflow-x-auto rounded-md border'>
                  <Table className='table-fixed'>
                    <TableHeader>
                      <TableRow>
                        <TableHead className='w-[22%]'>
                          {t('talent.framework.code')}
                        </TableHead>
                        <TableHead className='w-[26%]'>
                          {t('talent.framework.titleField')}
                        </TableHead>
                        <TableHead className='w-[12%] text-right'>
                          {t('talent.competencies.maxLevel')}
                        </TableHead>
                        <TableHead className='w-[12%]'>
                          {t('talent.competencies.source')}
                        </TableHead>
                        <TableHead className='w-[14%]'>
                          {t('talent.fields.status')}
                        </TableHead>
                        <TableHead className='w-[14%] text-right'>
                          {t('talent.competencies.positionCount')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((c) => (
                        <TableRow
                          key={c.id}
                          className={cn(!c.active && 'text-muted-foreground')}
                        >
                          <TableCell className='font-mono text-xs'>
                            {c.code}
                          </TableCell>
                          <TableCell>
                            <Link
                              className='font-medium hover:underline'
                              to={{ pathname: c.id, search: location.search }}
                            >
                              {c.title}
                            </Link>
                            {!c.active ? (
                              <Badge variant='outline' className='ml-2'>
                                {t('talent.common.disabled')}
                              </Badge>
                            ) : null}
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {c.maxLevel}
                          </TableCell>
                          <TableCell>
                            {t(`talent.source.${c.source}`)}
                          </TableCell>
                          <TableCell>
                            <ReviewStatusBadge status={c.reviewStatus} />
                          </TableCell>
                          <TableCell className='text-right tabular-nums'>
                            {c.positionCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
      <Outlet context={context} />
    </PageContainer>
  );
}
