import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useEmployeeName } from '@/components/talent/employee-name';
import { errorCode, errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import { listOf, usePermissionSetName } from './helpers.js';
import { RouteDialog } from './route-dialog.js';
import { SelfServiceCardsCard } from './self-service-card.js';
import {
  DOC_CATEGORIES,
  KNOWLEDGE_EMPLOYEES,
  type AiEntryResponse,
  type AiEntrySnapshot,
  type AiEntryValue,
  type EntryRoute,
  type KnowledgeScope,
} from './types.js';

/**
 * Route `/settings/ai-entry` — AI 入口 (V1-04): the unified entry's routing
 * table, the knowledge scope of each employee that searches documents, and
 * the office-suite bots. The table and the scopes are one stored value with
 * one revision; each Card keeps its own draft and saves the whole value with
 * the other part as last saved.
 */
export default function AiEntrySettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<AiEntryResponse>('talent/ai-entry');
  return (
    <PageContainer className='max-w-4xl'>
      <PageHeader
        title={t('navigation.aiEntry')}
        description={t('aiEntry.settings.description')}
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !remote.data ? (
        <BlockSkeleton rows={6} />
      ) : (
        <Settings initial={remote.data} />
      )}
    </PageContainer>
  );
}

/** Saving the stored value at the revision it was loaded with; a 409 offers to reload. */
function useEntry(initial: AiEntryResponse) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [snapshot, setSnapshot] = useState<AiEntrySnapshot>({
    value: initial.value,
    revision: initial.revision,
  });
  const [saving, setSaving] = useState<'routes' | 'scopes' | null>(null);
  const [conflict, setConflict] = useState(false);

  async function save(
    part: 'routes' | 'scopes',
    value: AiEntryValue,
  ): Promise<string | null> {
    setSaving(part);
    try {
      const { data } = await api.request<{ data: AiEntrySnapshot }>({
        path: 'talent/ai-entry',
        method: 'PATCH',
        json: { revision: snapshot.revision, value },
      });
      setSnapshot(data);
      toast.add({
        type: 'success',
        title: t('aiEntry.settings.saved', {
          section: t(`aiEntry.${part}.title`),
        }),
      });
      return null;
    } catch (failure) {
      const status =
        failure instanceof ApiClientError ? failure.status : undefined;
      if (status === 409) setConflict(true);
      return status === 409
        ? t('personnelSettings.conflict')
        : errorCode(failure) === 'INVALID_INPUT'
          ? t('personnelSettings.failed')
          : errorMessage(failure, t);
    } finally {
      setSaving(null);
    }
  }

  async function reload(): Promise<AiEntrySnapshot | null> {
    try {
      const { data } = await api.request<{ data: AiEntryResponse }>({
        path: 'talent/ai-entry',
      });
      const next = { value: data.value, revision: data.revision };
      setSnapshot(next);
      setConflict(false);
      return next;
    } catch (failure) {
      toast.add({ type: 'error', title: errorMessage(failure, t) });
      return null;
    }
  }

  return { snapshot, save, reload, saving, conflict };
}

type Entry = ReturnType<typeof useEntry>;

function Settings({ initial }: { initial: AiEntryResponse }): ReactElement {
  const entry = useEntry(initial);
  return (
    <>
      <RoutesCard
        entry={entry}
        employees={initial.employees}
        permissionSets={initial.permissionSets}
      />
      <ScopesCard entry={entry} employees={initial.employees} />
      <SelfServiceCardsCard />
      <BotsCard />
    </>
  );
}

function ConflictReload({
  entry,
  onReloaded,
}: {
  entry: Entry;
  onReloaded: (next: AiEntrySnapshot) => void;
}): ReactElement | null {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  if (!entry.conflict) return null;
  return (
    <>
      <Button
        type='button'
        variant='outline'
        disabled={Boolean(entry.saving)}
        onClick={() => setConfirm(true)}
      >
        {t('personnelSettings.reload')}
      </Button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('personnelSettings.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('personnelSettings.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                setConfirm(false);
                void entry.reload().then((next) => next && onReloaded(next));
              }}
            >
              {t('personnelSettings.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/** 路由表: which AI employee a kind of question goes to, and who may be routed there. */
function RoutesCard({
  entry,
  employees,
  permissionSets,
}: {
  entry: Entry;
  employees: readonly string[];
  permissionSets: readonly string[];
}): ReactElement {
  const { t } = useTranslation();
  const employeeName = useEmployeeName();
  const setName = usePermissionSetName();
  const [draft, setDraft] = useState<EntryRoute[]>(entry.snapshot.value.routes);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    open: boolean;
    route: EntryRoute | null;
  }>({ open: false, route: null });
  const [removing, setRemoving] = useState<{
    open: boolean;
    route: EntryRoute | null;
  }>({ open: false, route: null });
  const busy = Boolean(entry.saving);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(entry.snapshot.value.routes);
  const move = (index: number, by: number) =>
    setDraft((rows) => {
      const next = [...rows];
      const [row] = next.splice(index, 1);
      if (row) next.splice(index + by, 0, row);
      return next;
    });

  async function save(): Promise<void> {
    setError(null);
    const failure = await entry.save('routes', {
      ...entry.snapshot.value,
      routes: draft,
    });
    setError(failure);
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>{t('aiEntry.routes.title')}</CardTitle>
          <CardDescription>
            {t('aiEntry.routes.cardDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          {error ? (
            <Alert variant='destructive'>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {draft.length ? (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className='w-12'>
                      {t('personnelSettings.ruleOrder')}
                    </TableHead>
                    <TableHead>{t('aiEntry.routes.description')}</TableHead>
                    <TableHead>{t('aiEntry.routes.employee')}</TableHead>
                    <TableHead>{t('aiEntry.routes.permissionSets')}</TableHead>
                    <TableHead className='hidden md:table-cell'>
                      {t('aiEntry.routes.keywords')}
                    </TableHead>
                    <TableHead>{t('aiEntry.routes.enabled')}</TableHead>
                    <TableHead className='w-12'>
                      <span className='sr-only'>
                        {t('talent.common.actions')}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {draft.map((route, index) => (
                    <TableRow key={route.key}>
                      <TableCell className='tabular-nums'>
                        {index + 1}
                      </TableCell>
                      <TableCell className='max-w-64 font-medium whitespace-normal'>
                        {route.description}
                      </TableCell>
                      <TableCell>{employeeName(route.employee)}</TableCell>
                      <TableCell>
                        {route.permissionSets.length ? (
                          <span className='flex flex-wrap gap-1'>
                            {route.permissionSets.map((key) => (
                              <Badge key={key} variant='secondary'>
                                {setName(key)}
                              </Badge>
                            ))}
                          </span>
                        ) : (
                          <Badge variant='outline'>
                            {t('aiEntry.routes.everyone')}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className='hidden max-w-48 text-muted-foreground whitespace-normal md:table-cell'>
                        {route.keywords.join('、') || '—'}
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={route.enabled}
                          disabled={busy}
                          aria-label={t('aiEntry.routes.enabledFor', {
                            name: route.description,
                          })}
                          onCheckedChange={(checked) =>
                            setDraft((rows) =>
                              rows.map((r) =>
                                r.key === route.key
                                  ? { ...r, enabled: checked }
                                  : r,
                              ),
                            )
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant='ghost'
                                size='icon-sm'
                                disabled={busy}
                                aria-label={t('aiEntry.routes.menu', {
                                  name: route.description,
                                })}
                              />
                            }
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end'>
                            <DropdownMenuItem
                              onClick={() => setEditing({ open: true, route })}
                            >
                              <PencilIcon />
                              {t('talent.common.edit')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={index === 0}
                              onClick={() => move(index, -1)}
                            >
                              <ArrowUpIcon />
                              {t('personnelSettings.moveUp')}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={index === draft.length - 1}
                              onClick={() => move(index, 1)}
                            >
                              <ArrowDownIcon />
                              {t('personnelSettings.moveDown')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant='destructive'
                              onClick={() => setRemoving({ open: true, route })}
                            >
                              <Trash2Icon />
                              {t('aiEntry.routes.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              title={t('aiEntry.routes.empty')}
              description={t('aiEntry.routes.emptyDescription')}
            />
          )}
          <p className='text-sm text-muted-foreground'>
            {t('aiEntry.routes.orderHint')}
          </p>
        </CardContent>
        <CardFooter className='justify-end gap-2'>
          <ConflictReload
            entry={entry}
            onReloaded={(next) => {
              setDraft(next.value.routes);
              setError(null);
            }}
          />
          <Button
            type='button'
            variant='outline'
            disabled={busy}
            onClick={() => setEditing({ open: true, route: null })}
          >
            <PlusIcon data-icon='inline-start' />
            {t('aiEntry.routes.add')}
          </Button>
          <Button
            type='button'
            variant='outline'
            disabled={busy || entry.conflict || !dirty || !draft.length}
            onClick={() => void save()}
          >
            {entry.saving === 'routes' ? (
              <Spinner data-icon='inline-start' />
            ) : null}
            {t(
              entry.saving === 'routes'
                ? 'personnelSettings.saving'
                : 'actions.save',
            )}
          </Button>
        </CardFooter>
      </Card>
      <RouteDialog
        open={editing.open}
        route={editing.route}
        employees={employees}
        permissionSets={permissionSets}
        onOpenChange={(open) => setEditing((e) => ({ ...e, open }))}
        onSubmit={(route) => {
          setDraft((rows) =>
            rows.some((r) => r.key === route.key)
              ? rows.map((r) => (r.key === route.key ? route : r))
              : [...rows, route],
          );
          setEditing((e) => ({ ...e, open: false }));
        }}
      />
      <AlertDialog
        open={removing.open}
        onOpenChange={(open) => setRemoving((r) => ({ ...r, open }))}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('aiEntry.routes.deleteTitle', {
                name: removing.route?.description ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('aiEntry.routes.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const key = removing.route?.key;
                setDraft((rows) => rows.filter((r) => r.key !== key));
                setRemoving((r) => ({ ...r, open: false }));
              }}
            >
              {t('aiEntry.routes.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ScopeDraft {
  docNos: string;
  categories: KnowledgeScope['categories'];
}

function draftOf(
  scopes: AiEntryValue['knowledgeScopes'],
  employees: readonly string[],
): Record<string, ScopeDraft> {
  return Object.fromEntries(
    employees.map((e) => [
      e,
      {
        docNos: (scopes[e]?.docNos ?? []).join(', '),
        categories: scopes[e]?.categories ?? [],
      },
    ]),
  );
}

/** A draft as stored: an employee with neither numbers nor categories has no limit and no entry. */
function scopesOf(
  draft: Record<string, ScopeDraft>,
): AiEntryValue['knowledgeScopes'] {
  return Object.fromEntries(
    Object.entries(draft)
      .map(
        ([employee, scope]) =>
          [
            employee,
            {
              docNos: listOf(scope.docNos),
              categories: DOC_CATEGORIES.filter((c) =>
                scope.categories.includes(c),
              ),
            },
          ] as const,
      )
      .filter(([, scope]) => scope.docNos.length || scope.categories.length),
  );
}

/** 知识范围: the documents each searching employee may use, before the user's own visibility applies. */
function ScopesCard({
  entry,
  employees,
}: {
  entry: Entry;
  employees: readonly string[];
}): ReactElement {
  const { t } = useTranslation();
  const employeeName = useEmployeeName();
  const saved = entry.snapshot.value.knowledgeScopes;
  // The employees that search documents, plus any that already have a scope stored.
  const listed = [
    ...new Set([
      ...KNOWLEDGE_EMPLOYEES.filter((e) => employees.includes(e)),
      ...Object.keys(saved),
    ]),
  ];
  const [draft, setDraft] = useState(() => draftOf(saved, listed));
  const [error, setError] = useState<string | null>(null);
  const busy = Boolean(entry.saving);
  const dirty =
    JSON.stringify(scopesOf(draft)) !==
    JSON.stringify(scopesOf(draftOf(saved, listed)));

  async function save(): Promise<void> {
    setError(null);
    setError(
      await entry.save('scopes', {
        ...entry.snapshot.value,
        knowledgeScopes: scopesOf(draft),
      }),
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiEntry.scopes.title')}</CardTitle>
        <CardDescription>{t('aiEntry.scopes.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-6'>
        {error ? (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {listed.length ? (
          listed.map((employee) => {
            const scope = draft[employee] ?? { docNos: '', categories: [] };
            const update = (next: Partial<ScopeDraft>) =>
              setDraft((d) => ({ ...d, [employee]: { ...scope, ...next } }));
            return (
              <FieldGroup key={employee}>
                <p className='text-base font-medium'>
                  {employeeName(employee)}
                </p>
                <Field>
                  <FieldLabel htmlFor={`scope-${employee}-docnos`}>
                    {t('aiEntry.scopes.docNos')}
                  </FieldLabel>
                  <Input
                    id={`scope-${employee}-docnos`}
                    value={scope.docNos}
                    disabled={busy}
                    placeholder={t('aiEntry.scopes.docNosPlaceholder')}
                    onChange={(e) => update({ docNos: e.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t('aiEntry.scopes.categories')}</FieldLabel>
                  <div className='flex flex-wrap gap-4'>
                    {DOC_CATEGORIES.map((category) => (
                      <div key={category} className='flex items-center gap-2'>
                        <Checkbox
                          id={`scope-${employee}-${category}`}
                          checked={scope.categories.includes(category)}
                          disabled={busy}
                          onCheckedChange={(checked) =>
                            update({
                              categories:
                                checked === true
                                  ? [...scope.categories, category]
                                  : scope.categories.filter(
                                      (c) => c !== category,
                                    ),
                            })
                          }
                        />
                        <Label htmlFor={`scope-${employee}-${category}`}>
                          {t(`talent.docCategory.${category}`)}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <FieldDescription>
                    {t('aiEntry.scopes.hint')}
                  </FieldDescription>
                </Field>
              </FieldGroup>
            );
          })
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('aiEntry.scopes.none')}
          </p>
        )}
      </CardContent>
      <CardFooter className='justify-end gap-2'>
        <ConflictReload
          entry={entry}
          onReloaded={(next) => {
            setDraft(draftOf(next.value.knowledgeScopes, listed));
            setError(null);
          }}
        />
        <Button
          type='button'
          variant='outline'
          disabled={busy || entry.conflict || !dirty}
          onClick={() => void save()}
        >
          {entry.saving === 'scopes' ? (
            <Spinner data-icon='inline-start' />
          ) : null}
          {t(
            entry.saving === 'scopes'
              ? 'personnelSettings.saving'
              : 'actions.save',
          )}
        </Button>
      </CardFooter>
    </Card>
  );
}

const CHANNELS = ['feishu', 'dingtalk', 'wecom'] as const;

/**
 * 办公软件机器人: which channels are connected. Credentials are configured by
 * an administrator in the channel's plugin settings and never reach this page,
 * so every channel reads as not configured here; the callback signature
 * secret is a deployment setting this page cannot read either.
 */
function BotsCard(): ReactElement {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiEntry.bots.title')}</CardTitle>
        <CardDescription>{t('aiEntry.bots.description')}</CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <ul className='divide-y rounded-md border'>
          {CHANNELS.map((channel) => (
            <li
              key={channel}
              className='flex flex-wrap items-center justify-between gap-2 px-4 py-3'
            >
              <span className='text-sm font-medium'>
                {t(`orgSync.provider.${channel}`)}
              </span>
              <Badge variant='outline'>{t('aiEntry.bots.notConfigured')}</Badge>
            </li>
          ))}
        </ul>
        <p className='text-sm text-muted-foreground'>
          {t('aiEntry.bots.credentials')}
        </p>
        <p className='text-sm text-muted-foreground'>
          {t('aiEntry.bots.signature')}
        </p>
        {import.meta.env.DEV ? (
          <Button
            variant='outline'
            nativeButton={false}
            render={<Link to='/dev/im-mock' />}
          >
            {t('aiEntry.bots.openMock')}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
