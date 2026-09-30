import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  BanIcon,
  CheckIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { CategoryBadge, ReviewStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
// V4-13
import { ModelVersionsPanel } from '@/components/talent/talent-review-model-versions';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { AdvisorLauncher } from './advisor-panel.js';
import { useCandidates } from './candidates-data.js';
import { CandidatesPanel } from './candidates.js';
import { JobDescriptionCard } from './jd-card.js';
import { EntityDialog, type EntityTarget } from './entity-dialog.js';
import { RequirementDialog } from './requirement-dialog.js';
import type { Competency, FrameworkData, Requirement } from './types.js';

/** 岗位体系 — job families and positions on the left; the selected position and its requirements on the right. */
export default function FrameworkPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const framework = useRemote<FrameworkData>('talent/framework');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [entity, setEntity] = useState<EntityTarget | null>(null);
  const [requirementEdit, setRequirementEdit] = useState<{
    requirement: Requirement | null;
  } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirming, setConfirming] = useState<{
    ids: string[];
    drafts: Competency[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const data = framework.data;
  // Default to the first active position of the first job family, in the order the list shows them.
  const firstPosition = data?.jobFamilies.flatMap((f) =>
    data.positions.filter((p) => p.jobFamilyId === f.id && p.active),
  )[0];
  const positionId = params.get('position') ?? firstPosition?.id ?? null;
  const position = data?.positions.find((p) => p.id === positionId);
  // V3-08 拟任人员: the tab shows only to callers who may read the position's development targets.
  const candidates = useCandidates(position ? position.id : null);
  const tab =
    params.get('tab') === 'candidates' && candidates.data
      ? 'candidates'
      : // V4-13 能力模型版本
        params.get('tab') === 'versions'
        ? 'versions'
        : 'requirements';
  const setTab = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'candidates' || value === 'versions') next.set('tab', value);
    else next.delete('tab');
    setParams(next, { replace: true });
  };
  const competencyById = useMemo(
    () => new Map((data?.competencies ?? []).map((c) => [c.id, c])),
    [data],
  );
  const requirements = useMemo(
    () =>
      (data?.requirements ?? [])
        .filter((r) => r.positionId === positionId)
        .sort(
          (a, b) =>
            Number(b.mandatory) - Number(a.mandatory) ||
            (competencyById.get(a.competencyId)?.title ?? '').localeCompare(
              competencyById.get(b.competencyId)?.title ?? '',
            ),
        ),
    [data, positionId, competencyById],
  );
  const drafts = requirements.filter((r) => r.reviewStatus === 'draft');
  const needle = search.trim().toLowerCase();

  const selectPosition = (id: string) => {
    const next = new URLSearchParams(params);
    next.set('position', id);
    setParams(next, { replace: true });
    setSelected([]);
  };

  async function run(
    action: () => Promise<unknown>,
    success: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await action();
      toast.add({ type: 'success', title: success });
      setSelected([]);
      framework.reload();
      candidates.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  function askConfirm(ids: string[]): void {
    const draftCompetencies = ids
      .map((id) => requirements.find((r) => r.id === id))
      .map((r) => (r ? competencyById.get(r.competencyId) : undefined))
      .filter(
        (c): c is Competency => Boolean(c) && c!.reviewStatus === 'draft',
      );
    if (draftCompetencies.length)
      setConfirming({
        ids,
        drafts: [...new Map(draftCompetencies.map((c) => [c.id, c])).values()],
      });
    else
      void run(
        () =>
          api.request({
            path: 'talent/framework/requirements/confirm',
            method: 'POST',
            json: { ids },
          }),
        t('talent.framework.confirmed'),
      );
  }

  if (framework.error) {
    return (
      <PageContainer>
        <PageHeader
          title={t('talent.framework.title')}
          description={t('talent.framework.description')}
        />
        <LoadError error={framework.error} onRetry={framework.reload} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.framework.title')}
        description={t('talent.framework.description')}
        actions={
          data?.canManage ? (
            <>
              <Button
                variant='outline'
                onClick={() => setEntity({ kind: 'family', family: null })}
              >
                <FolderIcon data-icon='inline-start' />
                {t('talent.framework.newFamily')}
              </Button>
              <Button
                onClick={() => setEntity({ kind: 'position', position: null })}
                disabled={!data.jobFamilies.length}
              >
                <PlusIcon data-icon='inline-start' />
                {t('talent.framework.newPosition')}
              </Button>
            </>
          ) : null
        }
      />
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
                        onClick={() => selectPosition(p.id)}
                        aria-current={p.id === positionId ? 'true' : undefined}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
                          p.id === positionId && 'bg-muted font-medium',
                          !p.active && 'text-muted-foreground line-through',
                        )}
                      >
                        <span className='truncate'>{p.title}</span>
                        <span className='flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground'>
                          {/* Draft requirements (from the advisor or by hand) wait for confirmation here. */}
                          {data.requirements.some(
                            (r) =>
                              r.positionId === p.id &&
                              r.reviewStatus === 'draft',
                          ) ? (
                            <Badge variant='default'>
                              {t('talent.framework.pendingReview')}
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
            <div className='space-y-4'>
              <Card>
                <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
                  <div className='min-w-0'>
                    <CardTitle className='flex items-center gap-2'>
                      {position.title}
                      {!position.active ? (
                        <Badge variant='outline'>
                          {t('talent.common.disabled')}
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
                        onClick={() =>
                          setEntity({ kind: 'position', position })
                        }
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
                <CardContent>
                  <p className='text-xs font-medium text-muted-foreground'>
                    {t('talent.framework.responsibilities')}
                  </p>
                  <p className='mt-1 text-sm whitespace-pre-line'>
                    {position.responsibilities ||
                      t('talent.framework.noResponsibilities')}
                  </p>
                  {position.aiDraftedAt ? (
                    <p className='mt-3 text-xs text-muted-foreground'>
                      {t('talent.framework.aiDrafted', {
                        date: position.aiDraftedAt.slice(0, 10),
                      })}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              <JobDescriptionCard
                position={position}
                canManage={data.canManage}
                onChanged={framework.reload}
              />

              {/* V4-13: the 版本 tab is always there; 拟任人员 only for callers who may read it. */}
              <Tabs
                value={tab}
                onValueChange={(value) => setTab(String(value))}
              >
                <TabsList>
                  <TabsTrigger value='requirements'>
                    {t('talent.framework.requirements')}
                  </TabsTrigger>
                  {candidates.data ? (
                    <TabsTrigger value='candidates'>
                      {t('talent.competencyExt.candidates.tab', {
                        count: candidates.data.items.length,
                      })}
                    </TabsTrigger>
                  ) : null}
                  <TabsTrigger value='versions'>
                    {t('talentReview.versions.tab')}
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {tab === 'versions' ? (
                <ModelVersionsPanel positionId={position.id} />
              ) : tab === 'candidates' && candidates.data ? (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {t('talent.competencyExt.candidates.title')}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CandidatesPanel position={position} list={candidates} />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
                    <div>
                      <CardTitle>
                        {t('talent.framework.requirements')}
                      </CardTitle>
                      <CardDescription>
                        {drafts.length
                          ? t('talent.framework.draftsPending', {
                              count: drafts.length,
                            })
                          : t('talent.framework.requirementsDescription')}
                      </CardDescription>
                    </div>
                    <div className='flex flex-wrap gap-2'>
                      {data.canUseAdvisor ? (
                        <AdvisorLauncher
                          position={position}
                          onClosed={framework.reload}
                        />
                      ) : null}
                      {data.canUseAdvisor ? (
                        <Button
                          variant='ghost'
                          size='icon'
                          aria-label={t('talent.common.refresh')}
                          onClick={framework.reload}
                        >
                          <RefreshCwIcon />
                        </Button>
                      ) : null}
                      {data.canManage ? (
                        <Button
                          size='sm'
                          onClick={() =>
                            setRequirementEdit({ requirement: null })
                          }
                        >
                          <PlusIcon data-icon='inline-start' />
                          {t('talent.framework.addRequirement')}
                        </Button>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className='space-y-3'>
                    {data.canConfirm && selected.length ? (
                      <div className='flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm'>
                        <span>
                          {t('talent.framework.selected', {
                            count: selected.length,
                          })}
                        </span>
                        <Button
                          size='sm'
                          disabled={busy}
                          onClick={() => askConfirm(selected)}
                        >
                          <CheckIcon data-icon='inline-start' />
                          {t('talent.framework.confirm')}
                        </Button>
                        <Button
                          size='sm'
                          variant='outline'
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () =>
                                api.request({
                                  path: 'talent/framework/requirements/discard',
                                  method: 'POST',
                                  json: { ids: selected },
                                }),
                              t('talent.framework.discarded'),
                            )
                          }
                        >
                          <XIcon data-icon='inline-start' />
                          {t('talent.framework.discard')}
                        </Button>
                      </div>
                    ) : null}
                    {requirements.length ? (
                      <div className='overflow-x-auto rounded-md border'>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {data.canConfirm ? (
                                <TableHead className='w-10'>
                                  <Checkbox
                                    aria-label={t(
                                      'talent.framework.selectDrafts',
                                    )}
                                    checked={
                                      drafts.length > 0 &&
                                      drafts.every((d) =>
                                        selected.includes(d.id),
                                      )
                                    }
                                    disabled={!drafts.length}
                                    onCheckedChange={(checked) =>
                                      setSelected(
                                        checked === true
                                          ? drafts.map((d) => d.id)
                                          : [],
                                      )
                                    }
                                  />
                                </TableHead>
                              ) : null}
                              <TableHead>
                                {t('talent.gap.competency')}
                              </TableHead>
                              <TableHead>{t('talent.gap.category')}</TableHead>
                              <TableHead className='text-right'>
                                {t('talent.gap.required')}
                              </TableHead>
                              <TableHead>{t('talent.gap.mandatory')}</TableHead>
                              <TableHead>{t('talent.fields.status')}</TableHead>
                              {data.canManage ? (
                                <TableHead className='text-right'>
                                  {t('talent.common.actions')}
                                </TableHead>
                              ) : null}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {requirements.map((r) => {
                              const competency = competencyById.get(
                                r.competencyId,
                              );
                              const draft = r.reviewStatus === 'draft';
                              return (
                                <TableRow
                                  key={r.id}
                                  className={cn(draft && 'bg-muted/40')}
                                >
                                  {data.canConfirm ? (
                                    <TableCell>
                                      {draft ? (
                                        <Checkbox
                                          aria-label={t(
                                            'talent.framework.selectRow',
                                            { title: competency?.title ?? '' },
                                          )}
                                          checked={selected.includes(r.id)}
                                          onCheckedChange={(checked) =>
                                            setSelected((s) =>
                                              checked === true
                                                ? [...s, r.id]
                                                : s.filter((id) => id !== r.id),
                                            )
                                          }
                                        />
                                      ) : null}
                                    </TableCell>
                                  ) : null}
                                  <TableCell className='font-medium'>
                                    {competency?.title ?? r.competencyId}
                                    {competency?.reviewStatus === 'draft' ? (
                                      <span className='ml-2 text-xs text-muted-foreground'>
                                        ({t('talent.framework.newCompetency')})
                                      </span>
                                    ) : null}
                                  </TableCell>
                                  <TableCell>
                                    {competency ? (
                                      <CategoryBadge
                                        category={competency.category}
                                      />
                                    ) : null}
                                  </TableCell>
                                  <TableCell className='text-right tabular-nums'>
                                    {r.requiredLevel}
                                  </TableCell>
                                  <TableCell>
                                    {r.mandatory ? (
                                      <Badge>
                                        {t('talent.gap.mandatoryYes')}
                                      </Badge>
                                    ) : (
                                      <span className='text-muted-foreground'>
                                        {t('talent.gap.mandatoryNo')}
                                      </span>
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <span className='flex items-center gap-1'>
                                      <ReviewStatusBadge
                                        status={r.reviewStatus}
                                      />
                                      {r.source === 'ai' ? (
                                        <Badge variant='outline'>AI</Badge>
                                      ) : null}
                                    </span>
                                  </TableCell>
                                  {data.canManage ? (
                                    <TableCell className='text-right'>
                                      <div className='flex justify-end gap-1'>
                                        {draft && data.canConfirm ? (
                                          <Button
                                            variant='ghost'
                                            size='icon-sm'
                                            aria-label={t(
                                              'talent.framework.confirm',
                                            )}
                                            onClick={() => askConfirm([r.id])}
                                          >
                                            <CheckIcon />
                                          </Button>
                                        ) : null}
                                        <Button
                                          variant='ghost'
                                          size='icon-sm'
                                          aria-label={t('talent.common.edit')}
                                          onClick={() =>
                                            setRequirementEdit({
                                              requirement: r,
                                            })
                                          }
                                        >
                                          <PencilIcon />
                                        </Button>
                                        <Button
                                          variant='ghost'
                                          size='icon-sm'
                                          aria-label={t('talent.common.remove')}
                                          onClick={() =>
                                            void run(
                                              () =>
                                                api.request({
                                                  path: `talent/framework/requirements/${encodeURIComponent(r.id)}`,
                                                  method: 'DELETE',
                                                }),
                                              t(
                                                'talent.framework.requirementRemoved',
                                              ),
                                            )
                                          }
                                        >
                                          <Trash2Icon />
                                        </Button>
                                      </div>
                                    </TableCell>
                                  ) : null}
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    ) : (
                      <p className='text-sm text-muted-foreground'>
                        {t('talent.framework.noRequirements')}
                      </p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {entity && data ? (
        <EntityDialog
          target={entity}
          families={data.jobFamilies}
          onClose={() => setEntity(null)}
          onSaved={(id) => {
            const wasPosition = entity.kind === 'position';
            setEntity(null);
            framework.reload();
            if (wasPosition) selectPosition(id);
          }}
        />
      ) : null}
      {requirementEdit && data && position ? (
        <RequirementDialog
          positionId={position.id}
          competencies={data.competencies}
          requirement={requirementEdit.requirement}
          existing={requirements.map((r) => r.competencyId)}
          onClose={() => setRequirementEdit(null)}
          onSaved={() => {
            setRequirementEdit(null);
            framework.reload();
          }}
        />
      ) : null}
      <AlertDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.framework.confirmDraftsTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.framework.confirmDraftsDescription', {
                titles: confirming?.drafts.map((c) => c.title).join('、') ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const ids = confirming?.ids ?? [];
                setConfirming(null);
                void run(
                  () =>
                    api.request({
                      path: 'talent/framework/requirements/confirm',
                      method: 'POST',
                      json: { ids },
                    }),
                  t('talent.framework.confirmed'),
                );
              }}
            >
              {t('talent.framework.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
