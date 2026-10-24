import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import {
  useAuthorizationClient,
  useAuthorizationRevision,
  useCan,
  type AuthorizationOptionsResponse,
  type LocalizedText,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { MoreHorizontalIcon, PlusIcon, ShieldAlert } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { Link, Outlet, useLocation, useSearchParams } from 'react-router';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from '#components/ui/empty';
import { Input } from '#components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#components/ui/dropdown-menu';
import { SettingsError, SettingsLoading, ConfirmAction } from '../shared.js';
import {
  subjectKey,
  useSubjectNames,
} from '../inspector/components/use-subject-names.js';
import { titleText } from '../inspector/i18n.js';
import {
  deleteRestrictionRule,
  listRestrictionRules,
  RESTRICTION_RULES_SETTINGS,
  restrictionRuleName,
  stableValue,
  type RestrictionRule,
  type RestrictionRulesOutletContext,
} from './model.js';

interface LoadedRestrictionRules {
  readonly rules: readonly RestrictionRule[];
  readonly options: AuthorizationOptionsResponse;
}

export default function RestrictionRulesPage(): ReactElement {
  const revision = useAuthorizationRevision();
  const { t } = useTranslation();
  const permission = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'read',
  });

  return (
    <PageContainer>
      {permission.isPending ? (
        <>
          <PageHeader
            title={t('restrictionRules.page.title')}
            description={t('restrictionRules.page.description')}
          />
          <SettingsLoading />
        </>
      ) : !permission.can ? (
        <>
          <PageHeader
            title={t('restrictionRules.page.title')}
            description={t('restrictionRules.page.description')}
          />
          <SettingsError error={permission.error ?? statusError(403)} />
        </>
      ) : (
        <Workspace
          key={revision}
          title={t('restrictionRules.page.title')}
          description={t('restrictionRules.page.description')}
        />
      )}
    </PageContainer>
  );
}

function Workspace({
  title,
  description,
}: {
  readonly title: string;
  readonly description: string;
}): ReactElement {
  const api = useApiClient();
  const authz = useAuthorizationClient();
  const toaster = useToaster();
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [loaded, setLoaded] = useState<LoadedRestrictionRules>();
  const [loadError, setLoadError] = useState<unknown>();
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState<RestrictionRule>();
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [mutationError, setMutationError] = useState<unknown>();
  const generationRef = useRef(0);
  const headingRef = useRef<HTMLSpanElement>(null);
  const previousPathRef = useRef(location.pathname);

  useEffect(() => {
    const wasChildPage =
      previousPathRef.current.startsWith(
        '/settings/authorization/restriction-rules/',
      ) && location.pathname === '/settings/authorization/restriction-rules';
    previousPathRef.current = location.pathname;
    if (!wasChildPage) return;
    const frame = window.requestAnimationFrame(() =>
      headingRef.current?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  const canCreate = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'create',
  });
  const canUpdate = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'update',
  });
  const canDelete = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'delete',
  });
  const permissionReady =
    !canCreate.isPending && !canUpdate.isPending && !canDelete.isPending;

  const onForbidden = useCallback(() => {
    generationRef.current += 1;
    setLoaded(undefined);
    setLoadError(statusError(403));
    setMutationError(undefined);
    setDeleting(undefined);
    authz.invalidate();
  }, [authz]);

  const reload = useCallback(async (): Promise<readonly RestrictionRule[]> => {
    const requestId = ++generationRef.current;
    setRefreshing(true);
    setLoadError(undefined);
    try {
      const [list, options] = await Promise.all([
        listRestrictionRules(api),
        authz.loadOptions('restrictionRules'),
      ]);
      if (requestId !== generationRef.current) return list.data;
      setLoaded({ rules: list.data, options });
      return list.data;
    } catch (cause) {
      if (requestId === generationRef.current) {
        if (isStatus(cause, 403)) onForbidden();
        else setLoadError(cause);
      }
      throw cause;
    } finally {
      if (requestId === generationRef.current) setRefreshing(false);
    }
  }, [api, authz, onForbidden]);

  useEffect(() => {
    let active = true;
    const requestId = ++generationRef.current;
    // Keep the current table during background reloads; only the initial request uses a full skeleton.
    void Promise.all([
      listRestrictionRules(api),
      authz.loadOptions('restrictionRules'),
    ]).then(
      ([list, options]) => {
        if (active && requestId === generationRef.current) {
          setLoaded({ rules: list.data, options });
          setLoadError(undefined);
          setRefreshing(false);
        }
      },
      (cause: unknown) => {
        if (!active || requestId !== generationRef.current) return;
        if (isStatus(cause, 403)) onForbidden();
        else setLoadError(cause);
        setRefreshing(false);
      },
    );
    return () => {
      active = false;
      generationRef.current += 1;
    };
  }, [api, authz, onForbidden]);

  const rawSearch = params.get('q') ?? '';
  const [searchRevision, setSearchRevision] = useState(0);
  const [composing, setComposing] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = searchInputRef.current;
    if (composing || !input || input.value.trim() === rawSearch) return;
    const timer = window.setTimeout(() => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (input.value.trim()) next.set('q', input.value.trim());
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => window.clearTimeout(timer);
  }, [composing, rawSearch, searchRevision, setParams]);

  const text = useCallback((value: LocalizedText) => titleText(value, t), [t]);
  const resourceLabels = useMemo(() => {
    const result = new Map<string, string>();
    for (const section of loaded?.options.sections ?? [])
      for (const subsection of section.subsections)
        for (const resource of subsection.resources)
          result.set(
            JSON.stringify([resource.type, resource.id]),
            titleText(resource.title, t),
          );
    return result;
  }, [loaded?.options.sections, t]);
  const subjectTypes = useMemo(
    () =>
      (loaded?.options.subjectTypes ?? []).map((item) => ({
        value: item.type,
        label: titleText(item.title, t),
        selection: item.selection,
      })),
    [loaded?.options.subjectTypes, t],
  );
  const subjects = useMemo(
    () => loaded?.rules.flatMap((rule) => rule.subjects) ?? [],
    [loaded?.rules],
  );
  const names = useSubjectNames('restrictionRules', subjectTypes, subjects);
  const groupOptions = useMemo(() => {
    const raw = loaded?.options.resourceGroups ?? [];
    const labels = new Map(
      raw.map((item) => [item.name, titleText(item.title, t)]),
    );
    return [...new Set(raw.map((item) => item.name))].map((value) => ({
      value,
      label: labels.get(value) ?? value,
    }));
  }, [loaded?.options.resourceGroups, t]);
  const activeGroup = params.get('group') ?? '';
  const canCreateRule = permissionReady && canCreate.can;
  const canEditRule = permissionReady && canUpdate.can;
  const canDeleteRule = permissionReady && canDelete.can;
  const rows = useMemo(() => {
    const query = rawSearch.trim().toLocaleLowerCase(i18n.language);
    return (loaded?.rules ?? [])
      .map((rule) => ({
        rule,
        name: restrictionRuleName(rule, text),
        resource:
          resourceLabels.get(
            JSON.stringify([rule.resource.type, rule.resource.id]),
          ) ?? `${rule.resource.type}:${rule.resource.id}`,
        group:
          loaded?.options.sections
            .flatMap((section) => section.subsections)
            .flatMap((subsection) => subsection.resources)
            .find(
              (resource) =>
                resource.type === rule.resource.type &&
                resource.id === rule.resource.id,
            )?.group ?? '',
      }))
      .filter(({ rule, name, resource, group }) => {
        if (activeGroup && group !== activeGroup) return false;
        if (!query) return true;
        const appliesTo = rule.subjects
          .map((subject) => names[subjectKey(subject)] ?? subject.id)
          .join(' ');
        const actions = rule.actions
          .map((item) => `${item.action} ${item.scopeKey ?? ''}`)
          .join(' ');
        return `${name} ${rule.key} ${resource} ${appliesTo} ${actions}`
          .toLocaleLowerCase(i18n.language)
          .includes(query);
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name, i18n.language),
      );
  }, [
    activeGroup,
    i18n.language,
    loaded?.options,
    loaded?.rules,
    names,
    rawSearch,
    resourceLabels,
    text,
  ]);

  const doDelete = useCallback(async () => {
    if (!deleting || !canDeleteRule || deleteBusy) return;
    setDeleteBusy(true);
    setMutationError(undefined);
    let deleted = false;
    try {
      await deleteRestrictionRule(api, deleting.key);
      deleted = true;
      setDeleting(undefined);
      await reload();
      toaster.show({
        type: 'success',
        title: t('restrictionRules.feedback.deleted', {
          name: restrictionRuleName(deleting, text),
        }),
      });
    } catch (cause) {
      if (isStatus(cause, 403)) onForbidden();
      else setMutationError(cause);
    } finally {
      setDeleteBusy(false);
      if (deleted)
        window.requestAnimationFrame(() => headingRef.current?.focus());
    }
  }, [
    api,
    canDeleteRule,
    deleteBusy,
    deleting,
    onForbidden,
    reload,
    t,
    toaster,
    text,
  ]);
  const outletContext: RestrictionRulesOutletContext = {
    reload,
    onForbidden,
  };
  const createLink = canCreateRule ? (
    <Button
      nativeButton={false}
      render={<Link to={{ pathname: 'new', search: location.search }} />}
    >
      <PlusIcon /> {t('restrictionRules.actions.new')}
    </Button>
  ) : null;
  const clearFilters = () => {
    if (searchInputRef.current) searchInputRef.current.value = '';
    setSearchRevision((revision) => revision + 1);
    setParams({}, { replace: true });
  };
  const hasFilters = Boolean(rawSearch || activeGroup);
  const noRules = Boolean(loaded && loaded.rules.length === 0);
  const noRows = Boolean(loaded && rows.length === 0);
  const statusText = loadError
    ? t('restrictionRules.errors.listReloadFailed')
    : refreshing
      ? t('restrictionRules.page.refreshing')
      : '';

  return (
    <>
      <PageHeader
        title={
          <span ref={headingRef} tabIndex={-1}>
            {title}
          </span>
        }
        description={description}
        actions={loaded?.rules.length ? createLink : undefined}
      />
      <div className='flex flex-col gap-4'>
        {mutationError ? (
          <SettingsError
            error={mutationError}
            retry={() => {
              setMutationError(undefined);
              void reload();
            }}
          />
        ) : null}
        {!loaded && loadError ? (
          <SettingsError error={loadError} retry={() => void reload()} />
        ) : null}
        {loaded ? (
          <>
            {loadError ? (
              <SettingsError error={loadError} retry={() => void reload()} />
            ) : null}
            <div className='flex flex-wrap items-center gap-3'>
              <Input
                className='min-w-52 flex-1 sm:max-w-sm'
                aria-label={t('restrictionRules.search.label')}
                placeholder={t('restrictionRules.search.placeholder')}
                key={`${location.pathname}${location.search}`}
                ref={searchInputRef}
                defaultValue={rawSearch}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={() => {
                  setComposing(false);
                  setSearchRevision((revision) => revision + 1);
                }}
                onChange={() => setSearchRevision((revision) => revision + 1)}
              />
              {groupOptions.length ? (
                <Select
                  value={activeGroup}
                  onValueChange={(value) => {
                    const next = new URLSearchParams(params);
                    if (value) next.set('group', value);
                    else next.delete('group');
                    setParams(next, { replace: true });
                  }}
                  items={[
                    {
                      value: '',
                      label: t('restrictionRules.search.allGroups'),
                    },
                    ...groupOptions,
                  ]}
                >
                  <SelectTrigger
                    aria-label={t('restrictionRules.search.group')}
                    className='w-full sm:w-56'
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className='w-auto min-w-40'>
                    <SelectItem value=''>
                      {t('restrictionRules.search.allGroups')}
                    </SelectItem>
                    {groupOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {hasFilters ? (
                <Button variant='ghost' onClick={clearFilters}>
                  {t('restrictionRules.search.clear')}
                </Button>
              ) : null}
              {statusText ? (
                <span
                  aria-live='polite'
                  className='text-sm text-muted-foreground'
                >
                  {statusText}
                </span>
              ) : null}
            </div>
            {noRules ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyMedia variant='icon'>
                  <ShieldAlert />
                </EmptyMedia>
                <EmptyTitle>{t('restrictionRules.empty.title')}</EmptyTitle>
                <EmptyDescription>
                  {canCreateRule
                    ? t('restrictionRules.empty.description')
                    : t('restrictionRules.empty.readOnly')}
                </EmptyDescription>
                {canCreateRule ? (
                  <EmptyContent>{createLink}</EmptyContent>
                ) : null}
              </Empty>
            ) : noRows ? (
              <Empty className='min-h-48 border border-dashed'>
                <EmptyTitle>{t('restrictionRules.empty.noResults')}</EmptyTitle>
                <EmptyDescription>
                  {t('restrictionRules.empty.noResultsDescription')}
                </EmptyDescription>
                <EmptyContent>
                  <Button variant='outline' onClick={clearFilters}>
                    {t('restrictionRules.search.clear')}
                  </Button>
                </EmptyContent>
              </Empty>
            ) : (
              <div className='overflow-x-auto rounded-xl border bg-card'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('restrictionRules.columns.rule')}
                      </TableHead>
                      <TableHead>
                        {t('restrictionRules.columns.resource')}
                      </TableHead>
                      <TableHead>
                        {t('restrictionRules.columns.subjects')}
                      </TableHead>
                      <TableHead>
                        {t('restrictionRules.columns.actions')}
                      </TableHead>
                      <TableHead className='w-14 text-right'>
                        <span className='sr-only'>
                          {t('restrictionRules.columns.rowActions')}
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map(({ rule, name, resource }) => (
                      <TableRow key={rule.key}>
                        <TableCell className='max-w-56'>
                          <TruncatedText
                            className='block truncate font-medium'
                            text={name}
                          />
                          <TruncatedText
                            className='block truncate font-mono text-xs text-muted-foreground'
                            text={rule.key}
                          />
                        </TableCell>
                        <TableCell className='max-w-56'>
                          <TruncatedText
                            className='block truncate'
                            text={resource}
                          />
                          <span className='block truncate text-xs text-muted-foreground'>
                            {rule.resource.type}:{rule.resource.id}
                          </span>
                        </TableCell>
                        <TableCell className='max-w-64'>
                          <div className='flex flex-wrap gap-1'>
                            {rule.subjects.map((subject) => {
                              const value =
                                names[subjectKey(subject)] ?? subject.id;
                              return (
                                <Badge
                                  key={subjectKey(subject)}
                                  variant='secondary'
                                  className='max-w-56'
                                >
                                  <TruncatedText
                                    className='min-w-0 truncate'
                                    text={value}
                                    tooltip={`${value} (${subject.type})`}
                                  />
                                </Badge>
                              );
                            })}
                          </div>
                        </TableCell>
                        <TableCell className='max-w-80'>
                          <div className='flex flex-wrap gap-1'>
                            {rule.actions.length ? (
                              rule.actions.map((action) => (
                                <Badge
                                  key={`${action.action}:${action.scopeKey ?? ''}:${stableValue(action.selection)}`}
                                  variant='outline'
                                  className='max-w-72'
                                >
                                  <TruncatedText
                                    className='min-w-0 truncate'
                                    text={selectionLabel(rule, action)}
                                  />
                                </Badge>
                              ))
                            ) : (
                              <span className='text-sm text-muted-foreground'>
                                {t('restrictionRules.labels.noActions')}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className='text-right'>
                          {canEditRule || canDeleteRule ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    variant='ghost'
                                    size='icon-sm'
                                    aria-label={t(
                                      'restrictionRules.actions.forRule',
                                      {
                                        name,
                                      },
                                    )}
                                  />
                                }
                              >
                                <MoreHorizontalIcon />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align='end'
                                className='w-auto min-w-40'
                              >
                                {canEditRule ? (
                                  <DropdownMenuItem
                                    render={
                                      <Link
                                        to={{
                                          pathname: `edit/${encodeURIComponent(rule.key)}`,
                                          search: location.search,
                                        }}
                                      />
                                    }
                                  >
                                    {t('restrictionRules.actions.edit')}
                                  </DropdownMenuItem>
                                ) : null}
                                {canDeleteRule ? (
                                  <>
                                    {canEditRule ? (
                                      <DropdownMenuSeparator />
                                    ) : null}
                                    <DropdownMenuItem
                                      variant='destructive'
                                      onClick={() => {
                                        setMutationError(undefined);
                                        setDeleting(rule);
                                      }}
                                    >
                                      {t('restrictionRules.actions.delete')}
                                    </DropdownMenuItem>
                                  </>
                                ) : null}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        ) : !loadError ? (
          <SettingsLoading />
        ) : null}
      </div>
      <ConfirmAction
        open={Boolean(deleting && canDeleteRule)}
        title={t('restrictionRules.confirm.deleteTitle', {
          name: deleting ? restrictionRuleName(deleting, text) : '',
        })}
        description={t('restrictionRules.confirm.deleteDescription')}
        confirmLabel={t('restrictionRules.actions.delete')}
        busy={deleteBusy}
        onCancel={() => setDeleting(undefined)}
        onConfirm={() => void doDelete()}
      />
      <Outlet context={outletContext} />
    </>
  );

  function selectionLabel(
    rule: RestrictionRule,
    action: RestrictionRule['actions'][number],
  ): string {
    const resource = loaded?.options.sections
      .flatMap((section) => section.subsections)
      .flatMap((subsection) => subsection.resources)
      .find(
        (item) =>
          item.type === rule.resource.type && item.id === rule.resource.id,
      );
    const actionName = resource?.actions.find(
      (item) => item.name === action.action,
    );
    const actionLabel = actionName
      ? titleText(actionName.title, t)
      : action.action;
    const selection = action.selection;
    const value =
      selection.type === 'records'
        ? selection.ids.length
          ? t('restrictionRules.labels.recordCount', {
              count: selection.ids.length,
              records: selection.ids.join(', '),
            })
          : t('restrictionRules.labels.noRecordsSelected')
        : selection.type === 'recordAccess'
          ? selection.key === 'customFilter'
            ? t('restrictionRules.labels.customFilter')
            : titleText(
                loaded?.options.recordAccess.find(
                  (item) => item.key === selection.key,
                )?.title ?? selection.key,
                t,
              )
          : t('restrictionRules.labels.allRecords');
    const scope = action.scopeKey
      ? resource?.dataScopes?.[action.action]?.find(
          (item) => item.key === action.scopeKey,
        )
      : undefined;
    return `${actionLabel}${scope ? ` · ${titleText(scope.title, t)}` : action.scopeKey ? ` · ${action.scopeKey}` : ''} · ${value}`;
  }
}

function TruncatedText({
  text,
  tooltip = text,
  className,
}: {
  readonly text: string;
  readonly tooltip?: string;
  readonly className?: string;
}): ReactElement {
  return (
    <span
      className={className}
      onMouseEnter={(event) => {
        const element = event.currentTarget;
        if (element.scrollWidth > element.clientWidth) element.title = tooltip;
      }}
      onMouseLeave={(event) => event.currentTarget.removeAttribute('title')}
    >
      {text}
    </span>
  );
}

function isStatus(value: unknown, status: number): boolean {
  return value instanceof ApiClientError && value.status === status;
}

function statusError(status: number): Error & { status: number } {
  return Object.assign(new Error('request denied'), { status });
}
