import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import type { RecordSelection } from '@nocobase/authorization/core';
import { useTranslation } from '@nocobase/i18n/client';
import { Search, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useSearchParams } from 'react-router';
import {
  PermissionFilter,
  type PermissionFilterLabels,
} from '@/components/permission-filter';
import { Button } from '#components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#components/ui/card';
import { Checkbox } from '#components/ui/checkbox';
import { Input } from '#components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '#components/ui/table';
import { ConfirmAction } from '../shared.js';
import type {
  AuthorizationOptions,
  ResourceGroupOption,
  ResourceOption,
  SubsectionOption,
} from '../inspector/model.js';
import { ErrorBox, errorMessage } from '../inspector/components/feedback.js';
import { RuleDrawer } from '../inspector/components/rule-drawer.js';
import { SelectField } from '../inspector/components/select-field.js';
import { useAuthorizationTranslation } from '../inspector/i18n.js';
import {
  DEFAULT_ACCESS_SETTINGS,
  defaultAccessRuleKey,
  deleteDefaultAccess,
  isReservedRuleKey,
  listDefaultAccessRecords,
  saveDefaultAccess,
} from './api.js';
import type { DefaultAccessRecordOption, DefaultAccessRule } from './model.js';

const PAGE_SIZE = 20;
const COMPOSITE = 'composite';
type RuleAction = DefaultAccessRule['actions'][number];
type RuleRow = {
  readonly key: string;
  readonly ruleKey?: string;
  readonly resource: { readonly type: string; readonly id: string };
  readonly label: string;
  readonly section: string;
  readonly sectionLabel: string;
  readonly groupPath: string;
  readonly groupLabel: string;
  readonly actions: readonly RuleAction[];
  readonly registered?: ResourceOption;
  readonly subsection?: SubsectionOption;
};
type Draft = {
  readonly row: RuleRow;
  readonly baseline: readonly RuleAction[];
  readonly actions: readonly RuleAction[];
};
type FieldFailure = {
  readonly action?: string;
  readonly scopeKey?: string;
  readonly message: string;
};

export function DefaultAccessPanel({
  initialRules,
  options,
  refreshRules,
  onForbidden,
}: {
  initialRules: readonly DefaultAccessRule[];
  options: AuthorizationOptions;
  refreshRules: () => Promise<readonly DefaultAccessRule[]>;
  onForbidden: () => void;
}): ReactElement {
  const api = useApiClient();
  const toaster = useToaster();
  const { t } = useTranslation();
  const text = useAuthorizationTranslation();
  const [rules, setRules] =
    useState<readonly DefaultAccessRule[]>(initialRules);
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft>();
  const [clearOpen, setClearOpen] = useState(false);
  const [clearTarget, setClearTarget] = useState<RuleRow>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [fieldError, setFieldError] = useState<FieldFailure>();
  const [savedUnconfirmed, setSavedUnconfirmed] = useState(false);
  const [searchText, setSearchText] = useState(params.get('search') ?? '');
  const [lastActiveSearch, setLastActiveSearch] = useState(
    params.get('search') ?? '',
  );
  const [composing, setComposing] = useState(false);
  const generationRef = useRef(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const canRead = useCan({ resource: DEFAULT_ACCESS_SETTINGS, action: 'read' });
  const canCreate = useCan({
    resource: DEFAULT_ACCESS_SETTINGS,
    action: 'create',
  });
  const canUpdate = useCan({
    resource: DEFAULT_ACCESS_SETTINGS,
    action: 'update',
  });
  const canDelete = useCan({
    resource: DEFAULT_ACCESS_SETTINGS,
    action: 'delete',
  });
  const permissionsReady =
    !canRead.isPending &&
    !canCreate.isPending &&
    !canUpdate.isPending &&
    !canDelete.isPending;

  const rows = useMemo(() => makeRows(options, rules), [options, rules]);
  const subsections = useMemo(
    () =>
      options.sections.flatMap((section) =>
        section.subsections
          .filter((item) => item.resources.length > 0)
          .map((item) => ({ ...item, sectionLabel: section.label })),
      ),
    [options],
  );
  const selectedSection =
    subsections.find((item) => item.value === params.get('section')) ??
    subsections[0];
  const groupPaths = useMemo(() => {
    const unique = new Map<string, string>();
    for (const row of rows) {
      if (row.section === selectedSection?.value && row.groupPath)
        unique.set(row.groupPath, row.groupLabel);
    }
    return [...unique.entries()].map(([value, label]) => ({ value, label }));
  }, [rows, selectedSection]);
  const groupFilter = params.get('group') ?? '';
  const configured = params.get('configured') === '1';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const activeSearch = params.get('search') ?? '';

  if (activeSearch !== lastActiveSearch) {
    setLastActiveSearch(activeSearch);
    setSearchText(activeSearch);
  }

  const updateParam = useCallback(
    (name: string, value: string): void => {
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) next.set(name, value);
          else next.delete(name);
          if (name !== 'page') next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  useEffect(() => {
    if (composing || searchText === activeSearch) return;
    const timer = window.setTimeout(
      () => updateParam('search', searchText),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [searchText, composing, activeSearch, updateParam]);

  const onAccessLost = useCallback(() => {
    generationRef.current += 1;
    setRules([]);
    setDraft(undefined);
    setError(undefined);
    setFieldError(undefined);
    onForbidden();
  }, [onForbidden]);

  useEffect(
    () => () => {
      generationRef.current += 1;
    },
    [],
  );

  const refresh = useCallback(async () => {
    const request = ++generationRef.current;
    try {
      const next = await refreshRules();
      if (request === generationRef.current) {
        setRules(next);
        setError(undefined);
        return next;
      }
      return undefined;
    } catch (cause) {
      if (request === generationRef.current) {
        if (isStatus(cause, 403)) onAccessLost();
        else setError(cause);
      }
      throw cause;
    }
  }, [refreshRules, onAccessLost]);

  const visibleRows = useMemo(
    () =>
      rows.filter((row) => {
        const query = activeSearch.trim().toLocaleLowerCase();
        return (
          row.section === (selectedSection?.value ?? '') &&
          (!configured || row.actions.length > 0) &&
          (!groupFilter || row.groupPath === groupFilter) &&
          (!query ||
            `${row.label} ${row.resource.id} ${row.groupLabel}`
              .toLocaleLowerCase()
              .includes(query))
        );
      }),
    [rows, activeSearch, selectedSection, configured, groupFilter],
  );
  const pageCount = Math.max(1, Math.ceil(visibleRows.length / PAGE_SIZE));
  const pagedRows = visibleRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const cardGroups = useMemo(() => {
    const groups = new Map<string, { label: string; rows: RuleRow[] }>();
    for (const row of pagedRows) {
      const key = row.groupPath || '__ungrouped__';
      const current = groups.get(key) ?? {
        label: row.groupLabel || text('defaultAccess.ungrouped'),
        rows: [],
      };
      current.rows.push(row);
      groups.set(key, current);
    }
    return [...groups.entries()].map(([key, value]) => ({ key, ...value }));
  }, [pagedRows, text]);

  function canWrite(row: RuleRow, next: readonly RuleAction[]): boolean {
    if (row.ruleKey && isReservedRuleKey(row.ruleKey)) return false;
    if (row.ruleKey) return next.length ? canUpdate.can : canDelete.can;
    return next.length > 0 && canCreate.can;
  }

  async function openEditor(row: RuleRow): Promise<void> {
    if (busy || !canRead.can || (row.ruleKey && isReservedRuleKey(row.ruleKey)))
      return;
    setError(undefined);
    setFieldError(undefined);
    try {
      const request = ++generationRef.current;
      const latest = await refreshRules();
      if (request !== generationRef.current) return;
      const current = latest.find((rule) =>
        sameResource(rule.resource, row.resource),
      );
      if (!canRead.can || canRead.isPending) return onAccessLost();
      setRules(latest);
      setDraft({
        row: current
          ? { ...row, ruleKey: current.key, actions: current.actions }
          : { ...row, ruleKey: undefined, actions: [] },
        baseline: current?.actions ?? [],
        actions: current?.actions ?? [],
      });
    } catch (cause) {
      if (isStatus(cause, 403)) onAccessLost();
      else setError(cause);
    }
  }

  function setRuleAction(
    source: readonly RuleAction[],
    action: string,
    selection: RecordSelection | undefined,
    scopeKey?: string,
  ): readonly RuleAction[] {
    const matches = (item: RuleAction) =>
      item.action === action && item.scopeKey === scopeKey;
    return [
      ...source.filter((item) => !matches(item)),
      ...(selection
        ? [{ action, ...(scopeKey ? { scopeKey } : {}), selection }]
        : []),
    ];
  }

  function updateDraftAction(
    action: string,
    selection: RecordSelection | undefined,
    scopeKey?: string,
  ): void {
    setDraft((current) =>
      current
        ? {
            ...current,
            actions: setRuleAction(
              current.actions,
              action,
              selection,
              scopeKey,
            ),
          }
        : current,
    );
    setFieldError(undefined);
  }

  function scopeToken(item: RuleAction): string {
    return JSON.stringify([item.action, item.scopeKey ?? null]);
  }

  async function quickChange(
    row: RuleRow,
    action: string,
    nextSelection: RecordSelection | undefined,
  ): Promise<void> {
    if (busy || !permissionsReady || !canRead.can) return;
    setError(undefined);
    setBusy(true);
    const request = ++generationRef.current;
    let attemptedActions: readonly RuleAction[] = [];
    const baseline = row.actions;
    const token = JSON.stringify([action, null]);
    try {
      const latestRules = await refreshRules();
      if (request !== generationRef.current) return;
      const latest = latestRules.find((rule) =>
        sameResource(rule.resource, row.resource),
      );
      const latestActions = latest?.actions ?? [];
      const before = baseline.find((item) => scopeToken(item) === token);
      const current = latestActions.find((item) => scopeToken(item) === token);
      if (!sameAction(before, current)) {
        setRules(latestRules);
        setError(new Error(t('defaultAccess.errors.conflict')));
        return;
      }
      const actions = setRuleAction(latestActions, action, nextSelection);
      attemptedActions = actions;
      const currentRow = { ...row, ruleKey: latest?.key };
      if (!actions.length && latest?.key) {
        setRules(latestRules);
        setClearTarget({
          ...row,
          ruleKey: latest.key,
          actions: latest.actions,
        });
        return;
      }
      if (!canWrite(currentRow, actions)) return;
      await persist(row.resource, latest?.key, actions);
      if (request !== generationRef.current) return;
      const reread = await refreshRules();
      if (request !== generationRef.current) return;
      setRules(reread);
      toaster.show({
        type: 'success',
        title: t('defaultAccess.savedResource', { resource: row.label }),
      });
    } catch (cause) {
      if (request === generationRef.current)
        handleMutationError(cause, row, attemptedActions);
    } finally {
      setBusy(false);
    }
  }

  async function clearRow(row: RuleRow): Promise<void> {
    if (
      !row.ruleKey ||
      isReservedRuleKey(row.ruleKey) ||
      !canDelete.can ||
      busy
    )
      return;
    setBusy(true);
    setError(undefined);
    const request = ++generationRef.current;
    try {
      const latestRules = await refreshRules();
      if (request !== generationRef.current) return;
      const latest = latestRules.find((rule) =>
        sameResource(rule.resource, row.resource),
      );
      if (!latest) {
        setRules(latestRules);
        setClearTarget(undefined);
        setError(
          new Error(
            t('defaultAccess.errors.ruleRemoved', { resource: row.label }),
          ),
        );
        return;
      }
      if (!sameActions(row.actions, latest.actions)) {
        setRules(latestRules);
        setClearTarget(undefined);
        setError(new Error(t('defaultAccess.errors.conflict')));
        return;
      }
      await deleteDefaultAccess(api, latest.key);
      if (request !== generationRef.current) return;
      const reread = await refreshRules();
      if (request !== generationRef.current) return;
      setRules(reread);
      setClearTarget(undefined);
      toaster.show({
        type: 'success',
        title: t('defaultAccess.clearedResource', { resource: row.label }),
      });
    } catch (cause) {
      if (request === generationRef.current) handleMutationError(cause, row);
    } finally {
      setBusy(false);
    }
  }

  async function persist(
    resource: RuleRow['resource'],
    existingKey: string | undefined,
    actions: readonly RuleAction[],
  ): Promise<void> {
    if (!actions.length) {
      if (existingKey) await deleteDefaultAccess(api, existingKey);
      return;
    }
    const key = existingKey ?? defaultAccessRuleKey(resource);
    const rule: DefaultAccessRule = { key, resource, actions };
    await saveDefaultAccess(api, rule, existingKey);
  }

  function handleMutationError(
    cause: unknown,
    row: RuleRow,
    attemptedActions: readonly RuleAction[] = [],
  ): void {
    if (isStatus(cause, 403)) {
      onAccessLost();
      return;
    }
    if (
      cause instanceof ApiClientError &&
      cause.status === 404 &&
      cause.reason === 'RULE_NOT_FOUND'
    ) {
      setDraft(undefined);
      setError(
        new Error(
          t('defaultAccess.errors.ruleRemoved', { resource: row.label }),
        ),
      );
      void refresh().catch(() => undefined);
      return;
    }
    if (cause instanceof ApiClientError && cause.status === 409) {
      setError(new Error(t('defaultAccess.errors.conflict')));
      void refresh().catch(() => undefined);
      return;
    }
    const violation = fieldViolation(cause);
    if (violation) {
      const match =
        /^actions(?:\[(\d+)\]|\.(\d+))\.(?:selection|scopeKey)/u.exec(
          violation,
        );
      const index = Number(match?.[1] ?? match?.[2]);
      const action = Number.isInteger(index)
        ? attemptedActions[index]
        : undefined;
      setFieldError({
        ...(action ? { action: action.action } : {}),
        ...(action?.scopeKey ? { scopeKey: action.scopeKey } : {}),
        message: t('defaultAccess.errors.invalidScope'),
      });
      if (!draft) setError(new Error(t('defaultAccess.errors.invalidScope')));
      return;
    }
    setError(cause);
  }

  async function saveDraft(clear = false): Promise<void> {
    if (!draft || busy || savedUnconfirmed) return;
    const intended = clear ? [] : draft.actions;
    if (!canWrite(draft.row, intended)) return;
    setBusy(true);
    setError(undefined);
    setFieldError(undefined);
    const request = ++generationRef.current;
    let attemptedActions: readonly RuleAction[] = [];
    try {
      const latestRules = await refreshRules();
      if (request !== generationRef.current) return;
      const latest = latestRules.find((rule) =>
        sameResource(rule.resource, draft.row.resource),
      );
      const latestActions = latest?.actions ?? [];
      const changedTokens = new Set<string>();
      const baselineMap = new Map(
        draft.baseline.map((item) => [scopeToken(item), item]),
      );
      const draftMap = new Map(
        draft.actions.map((item) => [scopeToken(item), item]),
      );
      for (const token of new Set([
        ...baselineMap.keys(),
        ...draftMap.keys(),
      ])) {
        if (!sameAction(baselineMap.get(token), draftMap.get(token)))
          changedTokens.add(token);
      }
      const latestMap = new Map(
        latestActions.map((item) => [scopeToken(item), item]),
      );
      const comparedTokens = new Set([
        ...baselineMap.keys(),
        ...latestMap.keys(),
        ...changedTokens,
      ]);
      const conflict = [...comparedTokens].some(
        (token) => !sameAction(baselineMap.get(token), latestMap.get(token)),
      );
      if (conflict) {
        setRules(latestRules);
        setError(new Error(t('defaultAccess.errors.conflict')));
        return;
      }
      const merged = clear
        ? []
        : [
            ...latestActions.filter(
              (item) => !changedTokens.has(scopeToken(item)),
            ),
            ...draft.actions.filter((item) =>
              changedTokens.has(scopeToken(item)),
            ),
          ];
      attemptedActions = merged;
      const currentRow = { ...draft.row, ruleKey: latest?.key };
      if (!canWrite(currentRow, merged)) return;
      if (!clear && latest?.key && !merged.length) {
        setClearOpen(true);
        return;
      }
      await persist(draft.row.resource, latest?.key, merged);
      if (request !== generationRef.current) return;
      let confirmed: readonly DefaultAccessRule[];
      try {
        confirmed = await refreshRules();
      } catch (cause) {
        if (isStatus(cause, 403)) {
          onAccessLost();
          return;
        }
        setSavedUnconfirmed(true);
        setError(new Error(t('defaultAccess.errors.savedUnconfirmed')));
        return;
      }
      if (request !== generationRef.current) return;
      setRules(confirmed);
      setDraft(undefined);
      setClearOpen(false);
      setSavedUnconfirmed(false);
      toaster.show({
        type: 'success',
        title: clear
          ? t('defaultAccess.clearedResource', { resource: draft.row.label })
          : t('defaultAccess.savedResource', { resource: draft.row.label }),
      });
    } catch (cause) {
      if (request === generationRef.current)
        handleMutationError(cause, draft.row, attemptedActions);
    } finally {
      setBusy(false);
    }
  }

  async function reloadAfterUnconfirmed(): Promise<void> {
    setBusy(true);
    try {
      const latest = await refreshRules();
      setRules(latest);
      setDraft(undefined);
      setError(undefined);
      setSavedUnconfirmed(false);
    } catch (cause) {
      if (isStatus(cause, 403)) onAccessLost();
      else setError(cause);
    } finally {
      setBusy(false);
    }
  }

  function clearFilters(): void {
    setSearchText('');
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('search');
        next.delete('group');
        next.delete('configured');
        next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  const hasResources = rows.length > 0;
  const hasFilters = Boolean(activeSearch || groupFilter || configured);

  return (
    <div className='space-y-4'>
      {error ? <ErrorBox value={errorMessage(text, error)} /> : null}
      {error &&
      ![401, 403].includes(status(error) ?? 0) &&
      !savedUnconfirmed ? (
        <Button
          variant='outline'
          size='sm'
          onClick={() => void refresh().catch(() => undefined)}
        >
          {t('defaultAccess.errors.retry')}
        </Button>
      ) : null}
      {savedUnconfirmed ? (
        <Button
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() => void reloadAfterUnconfirmed()}
        >
          {t('defaultAccess.errors.reload')}
        </Button>
      ) : null}
      {subsections.length > 1 ? (
        <nav
          aria-label={t('defaultAccess.sections')}
          className='flex flex-wrap gap-2'
        >
          {subsections.map((item) => (
            <Button
              key={item.value}
              variant={
                item.value === selectedSection?.value ? 'secondary' : 'outline'
              }
              size='sm'
              aria-current={
                item.value === selectedSection?.value ? 'page' : undefined
              }
              onClick={() => {
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.set('section', item.value);
                    next.delete('group');
                    next.delete('page');
                    return next;
                  },
                  { replace: true },
                );
              }}
            >
              {item.label}
            </Button>
          ))}
        </nav>
      ) : null}
      <div className='flex flex-wrap items-center gap-3'>
        <div className='relative min-w-52 flex-1 sm:max-w-80'>
          <Search className='pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input
            ref={searchInputRef}
            aria-label={t('defaultAccess.search')}
            placeholder={t('defaultAccess.search')}
            className='h-9 pl-8 pr-8'
            value={searchText}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setSearchText(event.currentTarget.value);
            }}
            onChange={(event) => setSearchText(event.target.value)}
          />
          {searchText ? (
            <button
              type='button'
              aria-label={t('defaultAccess.clearSearch')}
              className='absolute right-1 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted'
              onClick={() => {
                setSearchText('');
                searchInputRef.current?.focus();
              }}
            >
              <X className='size-3.5' />
            </button>
          ) : null}
        </div>
        {groupPaths.length ? (
          <SelectField
            aria-label={t('defaultAccess.groupFilter')}
            className='h-9 max-w-64 rounded-lg border bg-background px-3 text-sm'
            value={groupFilter}
            onValueChange={(value) => updateParam('group', value)}
            options={[
              { value: '', label: t('defaultAccess.allGroups') },
              ...groupPaths,
            ]}
          />
        ) : null}
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox
            checked={configured}
            onCheckedChange={(checked) =>
              updateParam('configured', checked ? '1' : '')
            }
          />
          {t('defaultAccess.configuredOnly')}
        </label>
        {hasFilters ? (
          <Button variant='ghost' size='sm' onClick={clearFilters}>
            {t('defaultAccess.clearFilters')}
          </Button>
        ) : null}
      </div>

      {!hasResources ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('defaultAccess.noResources')}</CardTitle>
            <CardDescription>
              {t('defaultAccess.noResourcesDescription')}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : !visibleRows.length ? (
        <Card>
          <CardContent className='flex flex-col items-start gap-3 py-6'>
            <p className='text-sm text-muted-foreground'>
              {t('defaultAccess.noResults')}
            </p>
            <Button variant='outline' size='sm' onClick={clearFilters}>
              {t('defaultAccess.clearFilters')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className='space-y-4'>
          {cardGroups.map((group) => (
            <Card key={group.key}>
              <CardHeader>
                <CardTitle className='truncate' title={group.label}>
                  {group.label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Table className='min-w-[36rem]'>
                  <TableHeader>
                    <TableRow>
                      <TableHead className='w-[32%]'>
                        {t('defaultAccess.resource')}
                      </TableHead>
                      <TableHead>{t('defaultAccess.actions')}</TableHead>
                      <TableHead>{t('defaultAccess.recordScope')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.rows.map((row) => (
                      <ResourceRow
                        key={row.key}
                        row={row}
                        options={options}
                        busy={busy || !permissionsReady}
                        canCreate={canCreate.can}
                        canUpdate={canUpdate.can}
                        canDelete={canDelete.can}
                        onQuickChange={(action, selection) =>
                          void quickChange(row, action, selection)
                        }
                        onEdit={() => void openEditor(row)}
                        onClear={() => setClearTarget(row)}
                        t={t}
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          <div className='flex items-center justify-between text-sm text-muted-foreground'>
            <span>
              {t('defaultAccess.pager', {
                page,
                pages: pageCount,
                total: visibleRows.length,
              })}
            </span>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={page <= 1}
                onClick={() => updateParam('page', String(page - 1))}
              >
                {t('defaultAccess.previousPage')}
              </Button>
              <Button
                variant='outline'
                size='sm'
                disabled={page >= pageCount}
                onClick={() => updateParam('page', String(page + 1))}
              >
                {t('defaultAccess.nextPage')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {draft ? (
        <RuleDrawer
          title={draft.row.label}
          description={t('defaultAccess.editorDescription')}
          onClose={() => {
            if (!busy) {
              setDraft(undefined);
              setFieldError(undefined);
            }
          }}
        >
          <div className='min-h-0 flex-1 space-y-5 overflow-auto py-3'>
            <p
              className='truncate text-xs text-muted-foreground'
              title={`${draft.row.resource.type}.${draft.row.resource.id}`}
            >
              {draft.row.resource.type}.{draft.row.resource.id}
            </p>
            {error ? <ErrorBox value={errorMessage(text, error)} /> : null}
            {fieldError && !fieldError.action ? (
              <p className='text-sm text-destructive'>{fieldError.message}</p>
            ) : null}
            {draft.row.resource.type === COMPOSITE ? (
              <CompositeEditor
                row={draft.row}
                options={options}
                value={draft.actions}
                busy={
                  busy ||
                  (!canUpdate.can && Boolean(draft.row.ruleKey)) ||
                  (!canCreate.can && !draft.row.ruleKey)
                }
                fieldError={fieldError}
                onChange={updateDraftAction}
                onForbidden={onAccessLost}
              />
            ) : (
              <SimpleEditor
                row={draft.row}
                options={options}
                value={draft.actions}
                busy={
                  busy ||
                  (!canUpdate.can && Boolean(draft.row.ruleKey)) ||
                  (!canCreate.can && !draft.row.ruleKey)
                }
                fieldError={fieldError}
                onChange={updateDraftAction}
                onForbidden={onAccessLost}
              />
            )}
            {draft.row.ruleKey &&
            !canDelete.can &&
            draft.actions.length === 0 ? (
              <p className='text-sm text-muted-foreground'>
                {t('defaultAccess.errors.deletePermissionRequired')}
              </p>
            ) : null}
          </div>
          <div className='flex flex-wrap justify-end gap-2 border-t pt-3'>
            {draft.row.ruleKey && canDelete.can ? (
              <Button
                className='mr-auto'
                variant='ghost'
                disabled={busy}
                onClick={() => setClearOpen(true)}
              >
                {t('defaultAccess.clear')}
              </Button>
            ) : null}
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => setDraft(undefined)}
            >
              {t('defaultAccess.cancel')}
            </Button>
            {(draft.row.ruleKey ? canUpdate.can : canCreate.can) ? (
              <Button
                disabled={
                  busy ||
                  savedUnconfirmed ||
                  sameActions(draft.baseline, draft.actions) ||
                  (!draft.actions.length && !canDelete.can)
                }
                onClick={() => void saveDraft()}
              >
                {busy ? t('settings.saving') : t('defaultAccess.save')}
              </Button>
            ) : null}
          </div>
          <ConfirmAction
            open={clearOpen}
            title={t('defaultAccess.clearTitle', { resource: draft.row.label })}
            description={t('defaultAccess.clearDescription', {
              resource: draft.row.label,
            })}
            confirmLabel={t('defaultAccess.confirm')}
            busy={busy}
            onCancel={() => setClearOpen(false)}
            onConfirm={() => void saveDraft(true)}
          />
        </RuleDrawer>
      ) : null}
      <ConfirmAction
        open={Boolean(clearTarget)}
        title={t('defaultAccess.clearTitle', {
          resource: clearTarget?.label ?? '',
        })}
        description={t('defaultAccess.clearDescription', {
          resource: clearTarget?.label ?? '',
        })}
        confirmLabel={t('defaultAccess.confirm')}
        busy={busy}
        onCancel={() => setClearTarget(undefined)}
        onConfirm={() => {
          if (clearTarget) void clearRow(clearTarget);
        }}
      />
    </div>
  );
}

function ResourceRow({
  row,
  options,
  busy,
  canCreate,
  canUpdate,
  canDelete,
  onQuickChange,
  onEdit,
  onClear,
  t,
}: {
  row: RuleRow;
  options: AuthorizationOptions;
  busy: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onQuickChange: (action: string, selection?: RecordSelection) => void;
  onEdit: () => void;
  onClear: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const mutableKey = !row.ruleKey || !isReservedRuleKey(row.ruleKey);
  const registeredActions = row.registered?.actions ?? [];
  const knownActions = registeredActions.filter(
    (action) => action.value !== 'create',
  );
  const unknownActions = row.actions
    .filter(
      (entry) => !knownActions.some((action) => action.value === entry.action),
    )
    .map((entry) => ({ value: entry.action, label: entry.action }));
  const actions = [...knownActions, ...unknownActions];
  if (row.resource.type === COMPOSITE) {
    const scopes = row.actions.length;
    const total = Object.values(row.registered?.dataScopes ?? {}).reduce(
      (sum, items) => sum + items.length,
      0,
    );
    return (
      <TableRow>
        <TableCell>
          <ResourceLabel row={row} />
        </TableCell>
        <TableCell colSpan={2}>
          <div className='flex items-center justify-between gap-3'>
            <span className='text-sm text-muted-foreground'>
              {t('defaultAccess.compositeConfigured', {
                configured: scopes,
                total,
              })}
            </span>
            {row.ruleKey && mutableKey && canDelete ? (
              <Button
                variant='ghost'
                size='sm'
                disabled={busy}
                onClick={onClear}
              >
                {t('defaultAccess.clear')}
              </Button>
            ) : null}
            {mutableKey && (row.ruleKey ? canUpdate : canCreate) ? (
              <Button
                variant='outline'
                size='sm'
                disabled={busy}
                onClick={onEdit}
              >
                {t('defaultAccess.edit')}
              </Button>
            ) : null}
          </div>
        </TableCell>
      </TableRow>
    );
  }
  return (
    <TableRow>
      <TableCell>
        <ResourceLabel row={row} />
      </TableCell>
      <TableCell>
        <div className='flex flex-wrap gap-2'>
          {actions.map((action) => (
            <span
              key={action.value}
              className='rounded-md bg-muted px-2 py-1 text-xs'
              title={action.label}
            >
              {action.label}
            </span>
          ))}
          {!actions.length ? (
            <span className='text-sm text-muted-foreground'>—</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className='flex min-w-52 flex-col gap-2'>
          {knownActions.length ? (
            knownActions.map((action) => {
              const current = row.actions.find(
                (item) => item.action === action.value && !item.scopeKey,
              );
              const mode = !current
                ? 'unset'
                : current.selection.type === 'all'
                  ? 'all'
                  : 'custom';
              return (
                <div
                  key={action.value}
                  className='flex items-center justify-between gap-2'
                >
                  <span
                    className='truncate text-xs text-muted-foreground'
                    title={action.label}
                  >
                    {action.label}
                  </span>
                  {mutableKey && (row.ruleKey ? canUpdate : canCreate) ? (
                    <SelectField
                      aria-label={`${row.label}: ${action.label}`}
                      className='h-8 min-w-40 rounded-md border bg-background px-2 text-xs'
                      disabled={busy}
                      value={mode}
                      onValueChange={(next) => {
                        if (next === 'custom') onEdit();
                        else
                          onQuickChange(
                            action.value,
                            next === 'all' ? { type: 'all' } : undefined,
                          );
                      }}
                      options={[
                        ...(mode === 'unset' ||
                        row.actions.length > 1 ||
                        canDelete
                          ? [
                              {
                                value: 'unset',
                                label: t('defaultAccess.noDefault'),
                              },
                            ]
                          : []),
                        { value: 'all', label: t('defaultAccess.allRecords') },
                        {
                          value: 'custom',
                          label: t('defaultAccess.customScope'),
                        },
                      ]}
                    />
                  ) : (
                    <span className='text-xs text-muted-foreground'>
                      {!current
                        ? t('defaultAccess.noDefault')
                        : selectionLabel(current.selection, options, t)}
                    </span>
                  )}
                </div>
              );
            })
          ) : (
            <span className='text-sm text-muted-foreground'>
              {t('defaultAccess.noDefault')}
            </span>
          )}
          {row.ruleKey && mutableKey && canDelete ? (
            <Button
              variant='ghost'
              size='xs'
              className='self-start'
              disabled={busy}
              onClick={onClear}
            >
              {t('defaultAccess.clear')}
            </Button>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );
}

function ResourceLabel({ row }: { row: RuleRow }): ReactElement {
  return (
    <div className='min-w-0'>
      <span className='block max-w-full truncate font-medium' title={row.label}>
        {row.label}
      </span>
      <p
        className='max-w-64 truncate text-xs text-muted-foreground'
        title={row.resource.id}
      >
        {row.resource.id}
      </p>
    </div>
  );
}

function SimpleEditor({
  row,
  options,
  value,
  busy,
  fieldError,
  onChange,
  onForbidden,
}: {
  row: RuleRow;
  options: AuthorizationOptions;
  value: readonly RuleAction[];
  busy: boolean;
  fieldError?: FieldFailure;
  onChange: (
    action: string,
    selection: RecordSelection | undefined,
    scopeKey?: string,
  ) => void;
  onForbidden: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const actions =
    row.registered?.actions?.filter((item) => item.value !== 'create') ?? [];
  const known = new Set(actions.map((item) => item.value));
  const display = [
    ...actions,
    ...value
      .filter((item) => !known.has(item.action))
      .map((item) => ({ value: item.action, label: item.action })),
  ];
  const collection = options.collections.find(
    (item) => item.name === row.resource.id,
  );
  return (
    <div className='space-y-4'>
      {display.map((action) => {
        const current = value.find(
          (item) => item.action === action.value && !item.scopeKey,
        );
        return (
          <section
            key={action.value}
            className='space-y-3 rounded-lg border p-4'
          >
            <h3 className='font-medium'>{action.label}</h3>
            <SelectionControl
              ariaLabel={t('defaultAccess.recordScopeFor', {
                action: action.label,
              })}
              value={current?.selection}
              options={options}
              collection={row.resource.id}
              fields={collection?.fields ?? []}
              busy={busy || !known.has(action.value)}
              onChange={(selection) => onChange(action.value, selection)}
              onForbidden={onForbidden}
              t={t}
            />
            {fieldError?.action === action.value && !fieldError.scopeKey ? (
              <p className='text-sm text-destructive'>{fieldError.message}</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function CompositeEditor({
  row,
  options,
  value,
  busy,
  fieldError,
  onChange,
  onForbidden,
}: {
  row: RuleRow;
  options: AuthorizationOptions;
  value: readonly RuleAction[];
  busy: boolean;
  fieldError?: FieldFailure;
  onChange: (
    action: string,
    selection: RecordSelection | undefined,
    scopeKey?: string,
  ) => void;
  onForbidden: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const scopes = row.registered?.dataScopes ?? {};
  const actions = row.registered?.actions ?? [];
  return (
    <div className='space-y-4'>
      {actions.map((action) => {
        const targets = scopes[action.value] ?? [];
        return (
          <section
            key={action.value}
            className='space-y-3 rounded-lg border p-4'
          >
            <h3 className='font-medium'>{action.label}</h3>
            {!targets.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('defaultAccess.noScopes')}
              </p>
            ) : null}
            {targets.map((target) => {
              const current = value.find(
                (item) =>
                  item.action === action.value && item.scopeKey === target.key,
              );
              const policyKeys = target.options
                .map((item) => item.value)
                .filter(Boolean);
              const scopedOptions = {
                ...options,
                recordAccess: options.recordAccess.filter((item) =>
                  policyKeys.includes(item.value),
                ),
              };
              return (
                <div
                  key={JSON.stringify([action.value, target.key])}
                  className='space-y-2 border-l pl-3'
                >
                  <label className='flex items-center gap-2 text-sm font-medium'>
                    <Checkbox
                      checked={Boolean(current)}
                      disabled={busy}
                      onCheckedChange={(checked) =>
                        onChange(
                          action.value,
                          checked ? { type: 'all' } : undefined,
                          target.key,
                        )
                      }
                    />
                    <span>{target.label}</span>
                    <span
                      className='truncate text-xs font-normal text-muted-foreground'
                      title={target.key}
                    >
                      ({target.key})
                    </span>
                  </label>
                  {current ? (
                    <SelectionControl
                      ariaLabel={t('defaultAccess.recordScopeFor', {
                        action: target.label,
                      })}
                      value={current.selection}
                      options={scopedOptions}
                      collection={target.collection}
                      fields={target.collectionFields}
                      busy={busy}
                      onChange={(selection) =>
                        onChange(action.value, selection, target.key)
                      }
                      onForbidden={onForbidden}
                      t={t}
                    />
                  ) : null}
                  {fieldError?.action === action.value &&
                  fieldError.scopeKey === target.key ? (
                    <p className='text-sm text-destructive'>
                      {fieldError.message}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </section>
        );
      })}
      {Object.keys(scopes).length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {t('defaultAccess.noScopes')}
        </p>
      ) : null}
    </div>
  );
}

function SelectionControl({
  ariaLabel,
  value,
  options,
  collection,
  fields,
  busy,
  onChange,
  onForbidden,
  t,
}: {
  ariaLabel: string;
  value?: RecordSelection;
  options: AuthorizationOptions;
  collection: string;
  fields: readonly string[];
  busy: boolean;
  onChange: (value: RecordSelection | undefined) => void;
  onForbidden: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const [filterOpen, setFilterOpen] = useState(false);
  const mode =
    value?.type === 'all'
      ? 'all'
      : value?.type === 'records'
        ? 'records'
        : value
          ? `policy:${value.key}`
          : 'unset';
  const recordAccess = options.recordAccess.filter(
    (item) => !item.collections || item.collections.includes(collection),
  );
  const selectedPolicy =
    value?.type === 'recordAccess' &&
    !recordAccess.some((item) => item.value === value.key)
      ? [{ value: value.key, label: value.key }]
      : [];
  const fieldLabels = fieldLabelsFor(t);
  return (
    <div className='space-y-3'>
      <SelectField
        aria-label={ariaLabel}
        className='h-9 w-full rounded-md border bg-background px-3 text-sm'
        disabled={busy}
        value={mode}
        onValueChange={(selected) => {
          if (selected === 'unset') return onChange(undefined);
          if (selected === 'all') return onChange({ type: 'all' });
          if (selected === 'records')
            return onChange({
              type: 'records',
              ids: value?.type === 'records' ? value.ids : [],
            });
          const key = selected.slice('policy:'.length);
          const existing =
            value?.type === 'recordAccess' && value.key === key
              ? value
              : undefined;
          onChange(
            existing ??
              (key === 'customFilter'
                ? {
                    type: 'recordAccess',
                    key,
                    params: { filter: emptyFilter() },
                  }
                : { type: 'recordAccess', key }),
          );
        }}
        options={[
          { value: 'unset', label: t('defaultAccess.noDefault') },
          { value: 'all', label: t('defaultAccess.allRecords') },
          { value: 'records', label: t('defaultAccess.specificRecords') },
          ...recordAccess.concat(selectedPolicy).map((item) => ({
            value: `policy:${item.value}`,
            label: item.label,
          })),
        ]}
      />
      {value?.type === 'records' ? (
        <RecordPicker
          collection={collection}
          selected={value.ids}
          disabled={busy}
          onChange={(ids) => onChange({ type: 'records', ids })}
          onForbidden={onForbidden}
          t={t}
        />
      ) : null}
      {value?.type === 'recordAccess' && value.key === 'customFilter' ? (
        <PermissionFilter
          open={filterOpen}
          onOpenChange={setFilterOpen}
          value={readFilter(value.params)}
          fields={fields.map((name) => ({ value: name, label: name }))}
          labels={fieldLabels}
          disabled={busy}
          onApply={(filter) => {
            onChange({
              type: 'recordAccess',
              key: 'customFilter',
              params: { filter },
            });
            setFilterOpen(false);
          }}
        />
      ) : null}
      {value?.type === 'recordAccess' ? (
        <p className='text-xs text-muted-foreground'>
          {recordAccess.find((item) => item.value === value.key)?.description ??
            recordAccess.find((item) => item.value === value.key)?.label ??
            value.key}
        </p>
      ) : null}
    </div>
  );
}

function RecordPicker({
  collection,
  selected,
  disabled,
  onChange,
  onForbidden,
  t,
}: {
  collection: string;
  selected: readonly string[];
  disabled: boolean;
  onChange: (ids: readonly string[]) => void;
  onForbidden: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const api = useApiClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [records, setRecords] = useState<readonly DefaultAccessRecordOption[]>(
    [],
  );
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void listDefaultAccessRecords(api, collection, {
      search,
      page,
      pageSize: PAGE_SIZE,
    }).then(
      (result) => {
        if (active) {
          setRecords(result.items);
          setTotal(result.total);
          setError(false);
        }
      },
      (cause: unknown) => {
        if (!active) return;
        if (isStatus(cause, 403)) onForbidden();
        else setError(true);
      },
    );
    return () => {
      active = false;
    };
  }, [api, collection, search, page, onForbidden]);
  return (
    <div className='space-y-2 rounded-md border p-3'>
      <Input
        aria-label={t('defaultAccess.searchRecords')}
        placeholder={t('defaultAccess.searchRecords')}
        value={search}
        disabled={disabled}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      {error ? (
        <p className='text-sm text-destructive'>
          {t('defaultAccess.recordsUnavailable')}
        </p>
      ) : null}
      {!error && !records.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('defaultAccess.noRecords')}
        </p>
      ) : null}
      <div className='max-h-56 space-y-1 overflow-auto'>
        {records.map((record) => (
          <label
            key={record.id}
            className='flex items-start gap-2 rounded-md px-2 py-1 text-sm hover:bg-muted'
          >
            <Checkbox
              checked={selected.includes(record.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? [...new Set([...selected, record.id])]
                    : selected.filter((id) => id !== record.id),
                )
              }
            />
            <span
              className='min-w-0 truncate'
              title={`${record.label} (${record.id})`}
            >
              {record.label}{' '}
              <span className='text-muted-foreground'>({record.id})</span>
            </span>
          </label>
        ))}
      </div>
      <div className='flex items-center justify-between text-xs text-muted-foreground'>
        <span>
          {t('defaultAccess.recordsSelected', { count: selected.length })}
        </span>
        <div className='flex items-center gap-2'>
          <Button
            variant='outline'
            size='xs'
            disabled={page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('defaultAccess.previousPage')}
          </Button>
          <span>
            {page}/{Math.max(1, Math.ceil(total / PAGE_SIZE))}
          </span>
          <Button
            variant='outline'
            size='xs'
            disabled={page * PAGE_SIZE >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('defaultAccess.nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function makeRows(
  options: AuthorizationOptions,
  rules: readonly DefaultAccessRule[],
): RuleRow[] {
  const result: RuleRow[] = [];
  const seen = new Set<string>();
  for (const section of options.sections) {
    for (const subsection of section.subsections) {
      for (const resource of subsection.resources) {
        const id = JSON.stringify([resource.type, resource.value]);
        if (seen.has(id)) continue;
        seen.add(id);
        const rule = rules.find(
          (item) =>
            item.resource.type === resource.type &&
            item.resource.id === resource.value,
        );
        const path = groupPath(subsection.groups, resource.group);
        result.push({
          key: id,
          ...(rule ? { ruleKey: rule.key } : {}),
          resource: { type: resource.type, id: resource.value },
          label: resource.label,
          section: subsection.value,
          sectionLabel: section.label,
          groupPath: resource.group ?? '',
          groupLabel: path,
          actions: rule?.actions ?? [],
          registered: resource,
          subsection,
        });
      }
    }
  }
  for (const rule of rules) {
    const id = JSON.stringify([rule.resource.type, rule.resource.id]);
    if (seen.has(id)) continue;
    const key = isReservedRuleKey(rule.key) ? `orphan:${id}` : id;
    result.push({
      key,
      ruleKey: rule.key,
      resource: rule.resource,
      label: rule.resource.id,
      section: options.sections[0]?.subsections[0]?.value ?? '',
      sectionLabel: options.sections[0]?.label ?? '',
      groupPath: '',
      groupLabel: '',
      actions: rule.actions,
    });
  }
  return result;
}

function groupPath(
  groups: readonly ResourceGroupOption[],
  name?: string,
): string {
  if (!name) return '';
  const visit = (
    items: readonly ResourceGroupOption[],
    parents: readonly string[],
  ): string | undefined => {
    for (const item of items) {
      const current = [...parents, item.label];
      if (item.value === name) return current.join(' / ');
      const found = visit(item.children ?? [], current);
      if (found) return found;
    }
    return undefined;
  };
  return visit(groups, []) ?? name;
}

function sameResource(
  left: RuleRow['resource'],
  right: RuleRow['resource'],
): boolean {
  return left.type === right.type && left.id === right.id;
}

function sameAction(left?: RuleAction, right?: RuleAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameActions(
  left: readonly RuleAction[],
  right: readonly RuleAction[],
): boolean {
  const normalize = (items: readonly RuleAction[]) =>
    [...items].sort((a, b) => scopeTokenCompare(a, b));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function scopeTokenCompare(left: RuleAction, right: RuleAction): number {
  return JSON.stringify([left.action, left.scopeKey ?? null]).localeCompare(
    JSON.stringify([right.action, right.scopeKey ?? null]),
  );
}

function selectionLabel(
  selection: RecordSelection,
  options: AuthorizationOptions,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (selection.type === 'all') return t('defaultAccess.allRecords');
  if (selection.type === 'records')
    return t('defaultAccess.recordsSelected', { count: selection.ids.length });
  return (
    options.recordAccess.find((item) => item.value === selection.key)?.label ??
    selection.key
  );
}

function fieldLabelsFor(t: (key: string) => string): PermissionFilterLabels {
  const operators = [
    '$eq',
    '$ne',
    '$includes',
    '$gt',
    '$gte',
    '$lt',
    '$lte',
    '$empty',
    '$notEmpty',
  ];
  return {
    configure: t('defaultAccess.filter.configure'),
    title: t('defaultAccess.filter.title'),
    description: t('defaultAccess.filter.description'),
    all: t('defaultAccess.filter.all'),
    any: t('defaultAccess.filter.any'),
    field: t('defaultAccess.filter.field'),
    operator: t('defaultAccess.filter.operator'),
    valueType: t('defaultAccess.filter.valueType'),
    value: t('defaultAccess.filter.value'),
    text: t('defaultAccess.filter.text'),
    number: t('defaultAccess.filter.number'),
    boolean: t('defaultAccess.filter.boolean'),
    true: t('defaultAccess.filter.true'),
    false: t('defaultAccess.filter.false'),
    add: t('defaultAccess.filter.add'),
    limit: t('defaultAccess.filter.limit'),
    remove: t('defaultAccess.filter.remove'),
    cancel: t('defaultAccess.filter.cancel'),
    apply: t('defaultAccess.filter.apply'),
    invalid: t('defaultAccess.filter.invalid'),
    advanced: t('defaultAccess.filter.advanced'),
    reconfigure: t('defaultAccess.filter.reconfigure'),
    operators: Object.fromEntries(
      operators.map((operator) => [
        operator,
        t(`defaultAccess.filter.operators.${operator}`),
      ]),
    ),
  };
}

function emptyFilter(): unknown {
  return {
    kind: 'group',
    logic: 'and',
    items: [{ kind: 'condition', path: ['id'], operator: '$eq', value: '' }],
  };
}

function readFilter(params: unknown): unknown {
  if (!params || typeof params !== 'object') return undefined;
  const filter = (params as Record<string, unknown>)['filter'];
  return filter;
}

function fieldViolation(value: unknown): string | undefined {
  if (
    !(value instanceof ApiClientError) ||
    !value.payload ||
    typeof value.payload !== 'object'
  )
    return undefined;
  const payload = value.payload as {
    error?: { fieldViolations?: readonly { field?: unknown }[] };
    fieldViolations?: readonly { field?: unknown }[];
  };
  const violation =
    payload.error?.fieldViolations?.[0] ?? payload.fieldViolations?.[0];
  return typeof violation?.field === 'string' ? violation.field : undefined;
}

function isStatus(value: unknown, expected: number): boolean {
  return value instanceof ApiClientError && value.status === expected;
}

function status(value: unknown): number | undefined {
  return value instanceof ApiClientError ? value.status : undefined;
}
