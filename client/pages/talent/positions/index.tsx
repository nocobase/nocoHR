import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BanIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RotateCcwIcon,
  SearchIcon,
  UploadIcon,
  UsersIcon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useCustomFieldDefinitions } from '@/components/talent/custom-field-model';
import { CustomFieldValues } from '@/components/talent/custom-fields';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { EntityDialog, type EntityTarget } from '../framework/entity-dialog.js';
import type { JobFamily, Position } from '../framework/types.js';

interface PositionRow extends Position {
  readonly importBatchId: string | null;
  readonly headcount: number;
}

interface PositionsData {
  readonly jobFamilies: JobFamily[];
  readonly positions: PositionRow[];
  readonly canManage: boolean;
  readonly canViewEmployees: boolean;
}

/**
 * 人事 / 岗位 (V1 step 1): job families and positions on the left; the
 * selected position's details and headcount on the right. HR administrators
 * edit and disable here and see disabled items; everyone else reads the
 * enabled ones. `?position=` selects a position (the health-check report links
 * to it).
 */
export default function PositionsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<PositionsData>('talent/positions');
  // 初始数据导入: positions from Excel, a child page (./import.tsx).
  const canImport = useCan({
    resource: { type: 'composite', id: 'talent.framework' },
    action: 'import',
  }).can;
  const { departmentTitle } = useLookups();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState<EntityTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const { definitions: detailFields } = useCustomFieldDefinitions(
    'positions',
    'detail',
    true,
  );
  const data = remote.data;
  const first = data?.jobFamilies.flatMap((f) =>
    data.positions.filter((p) => p.jobFamilyId === f.id && p.active),
  )[0];
  const positionId = params.get('position') ?? first?.id ?? null;
  const position = data?.positions.find((p) => p.id === positionId);
  const needle = search.trim().toLowerCase();

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('position', id);
    setParams(next, { replace: true });
  };

  async function run(
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast.add({ type: 'success', title: success });
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  const header = (
    <PageHeader
      title={t('talent.positions.title')}
      description={t('talent.positions.description')}
      actions={
        data?.canManage || canImport ? (
          <>
            {canImport ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='import' />}
              >
                <UploadIcon data-icon='inline-start' />
                {t('dataImport.open')}
              </Button>
            ) : null}
            {data?.canManage ? (
              <>
                <Button
                  variant='outline'
                  onClick={() => setEntity({ kind: 'family', family: null })}
                >
                  <FolderIcon data-icon='inline-start' />
                  {t('talent.framework.newFamily')}
                </Button>
                <Button
                  onClick={() =>
                    setEntity({ kind: 'position', position: null })
                  }
                  disabled={!data.jobFamilies.length}
                >
                  <PlusIcon data-icon='inline-start' />
                  {t('talent.framework.newPosition')}
                </Button>
              </>
            ) : null}
          </>
        ) : null
      }
    />
  );

  if (remote.error)
    return (
      <PageContainer>
        {header}
        <LoadError error={remote.error} onRetry={remote.reload} />
      </PageContainer>
    );

  return (
    <PageContainer>
      {header}
      {!data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <div className='grid gap-4 lg:grid-cols-[18rem_1fr]'>
          <Card className='h-fit'>
            <CardHeader>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput
                  aria-label={t('talent.framework.search')}
                  placeholder={t('talent.framework.search')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </InputGroup>
            </CardHeader>
            <CardContent className='space-y-3'>
              {data.jobFamilies.map((family) => {
                const positions = data.positions.filter(
                  (p) =>
                    p.jobFamilyId === family.id &&
                    (!needle ||
                      p.title.toLowerCase().includes(needle) ||
                      p.code.toLowerCase().includes(needle)),
                );
                if (
                  needle &&
                  !positions.length &&
                  !family.title.toLowerCase().includes(needle)
                )
                  return null;
                return (
                  <div key={family.id} className='space-y-1'>
                    <div className='flex items-center justify-between gap-2'>
                      <p
                        className={cn(
                          'text-xs font-medium text-muted-foreground',
                          !family.active && 'line-through',
                        )}
                      >
                        {family.title}
                      </p>
                      {data.canManage ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant='ghost'
                                size='icon-xs'
                                aria-label={t(
                                  'talent.framework.familyActions',
                                  { title: family.title },
                                )}
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                onClick={() =>
                                  setEntity({
                                    kind: 'position',
                                    position: null,
                                    jobFamilyId: family.id,
                                  })
                                }
                              >
                                <PlusIcon />
                                {t('talent.framework.newPosition')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setEntity({ kind: 'family', family })
                                }
                              >
                                <PencilIcon />
                                {t('talent.common.edit')}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  void run(
                                    () =>
                                      api.request({
                                        path: `talent/framework/job-families/${encodeURIComponent(family.id)}/active`,
                                        method: 'POST',
                                        json: { active: !family.active },
                                      }),
                                    family.active
                                      ? t('talent.common.disabled')
                                      : t('talent.common.enabled'),
                                  )
                                }
                              >
                                {family.active ? (
                                  <BanIcon />
                                ) : (
                                  <RotateCcwIcon />
                                )}
                                {family.active
                                  ? t('talent.common.disable')
                                  : t('talent.common.enable')}
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                    {positions.map((p) => (
                      <button
                        key={p.id}
                        type='button'
                        onClick={() => select(p.id)}
                        aria-current={p.id === positionId ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                          p.id === positionId && 'bg-muted font-medium',
                          !p.active && 'text-muted-foreground line-through',
                        )}
                      >
                        <span className='truncate'>{p.title}</span>
                        <span className='flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'>
                          {p.importBatchId && data.canManage ? (
                            <Badge variant='outline'>
                              {t('talent.positions.imported')}
                            </Badge>
                          ) : null}
                          {p.grade}
                        </span>
                      </button>
                    ))}
                  </div>
                );
              })}
              {!data.jobFamilies.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.framework.noFamilies')}
                </p>
              ) : null}
            </CardContent>
          </Card>

          {!position ? (
            <EmptyState title={t('talent.framework.selectPosition')} />
          ) : (
            <Card>
              <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
                <div className='min-w-0'>
                  <CardTitle className='flex flex-wrap items-center gap-2'>
                    {position.title}
                    {!position.active ? (
                      <Badge variant='outline'>
                        {t('talent.common.disabled')}
                      </Badge>
                    ) : null}
                    {position.importBatchId && data.canManage ? (
                      <Badge variant='secondary'>
                        {t('talent.positions.importedFrom', {
                          batch: position.importBatchId,
                        })}
                      </Badge>
                    ) : null}
                  </CardTitle>
                  <CardDescription>
                    {[
                      position.code,
                      data.jobFamilies.find(
                        (f) => f.id === position.jobFamilyId,
                      )?.title,
                      position.grade,
                      // 初始数据导入: the department the position import assigned.
                      departmentTitle(position.departmentId),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </CardDescription>
                </div>
                {data.canManage ? (
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setEntity({ kind: 'position', position })}
                    >
                      <PencilIcon data-icon='inline-start' />
                      {t('talent.common.edit')}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={busy}
                      onClick={() =>
                        void run(
                          async () => {
                            const { data: result } = await api.request<{
                              data: { activeEmployees: number };
                            }>({
                              path: `talent/framework/positions/${encodeURIComponent(position.id)}/active`,
                              method: 'POST',
                              json: { active: !position.active },
                            });
                            if (position.active && result.activeEmployees > 0)
                              toast.add({
                                type: 'info',
                                title: t(
                                  'talent.framework.disabledWithEmployees',
                                  { count: result.activeEmployees },
                                ),
                              });
                          },
                          position.active
                            ? t('talent.common.disabled')
                            : t('talent.common.enabled'),
                        )
                      }
                    >
                      {position.active ? (
                        <BanIcon data-icon='inline-start' />
                      ) : (
                        <RotateCcwIcon data-icon='inline-start' />
                      )}
                      {position.active
                        ? t('talent.common.disable')
                        : t('talent.common.enable')}
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className='space-y-4'>
                <div>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('talent.positions.headcount')}
                  </p>
                  {data.canViewEmployees ? (
                    <Button
                      variant='link'
                      className='h-auto px-0'
                      nativeButton={false}
                      render={
                        <Link
                          to={`/talent/employees?position=${encodeURIComponent(position.id)}`}
                        />
                      }
                    >
                      <UsersIcon data-icon='inline-start' />
                      {t('talent.positions.people', {
                        count: position.headcount,
                      })}
                    </Button>
                  ) : (
                    <p className='mt-1 text-sm tabular-nums'>
                      {t('talent.positions.people', {
                        count: position.headcount,
                      })}
                    </p>
                  )}
                </div>
                <div>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('talent.framework.responsibilities')}
                  </p>
                  <p className='mt-1 text-sm whitespace-pre-line'>
                    {position.responsibilities ||
                      t('talent.framework.noResponsibilities')}
                  </p>
                </div>
                <CustomFieldValues
                  definitions={detailFields.filter(
                    (d) => data.canManage || (d.active && !d.sensitive),
                  )}
                  values={position.customFields}
                />
              </CardContent>
            </Card>
          )}
        </div>
      )}
      {entity ? (
        <EntityDialog
          target={entity}
          families={data?.jobFamilies ?? []}
          onClose={() => setEntity(null)}
          onSaved={(id) => {
            setEntity(null);
            remote.reload();
            if (entity.kind === 'position') select(id);
          }}
        />
      ) : null}
      <Outlet context={{ reload: remote.reload }} />
    </PageContainer>
  );
}
