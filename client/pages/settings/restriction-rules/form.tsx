import { ApiClientError, useApiClient, useToaster } from '@nocobase/app-client';
import {
  useAuthorizationClient,
  useCan,
  type LocalizedText,
  type SubjectOption,
} from '@nocobase/app-plugin-authorization/client';
import type { RecordSelection } from '@nocobase/authorization/core';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import {
  Link,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
} from 'react-router';
import { LoaderCircle, PlusIcon, XIcon } from 'lucide-react';
import { BackButton } from '#components/back-button';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { RouteChildPage } from '#components/route-child-page';
import {
  PermissionFilter,
  type PermissionFilterLabels,
} from '#components/permission-filter';
import { Alert, AlertDescription } from '#components/ui/alert';
import { Badge } from '#components/ui/badge';
import { Button } from '#components/ui/button';
import { Checkbox } from '#components/ui/checkbox';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#components/ui/select';
import { Textarea } from '#components/ui/textarea';
import { useSettingsLeave } from '../hooks.js';
import { ConfirmAction, SettingsError, SettingsLoading } from '../shared.js';
import { titleText } from '../inspector/i18n.js';
import {
  subjectKey,
  useSubjectNames,
} from '../inspector/components/use-subject-names.js';
import {
  createRestrictionRule,
  emptyRestrictionFilter,
  listRestrictionRuleRecords,
  listRestrictionRules,
  patchRestrictionRule,
  recordAccessFilter,
  isReservedRestrictionRuleKey,
  sameValue,
  RESTRICTION_RULES_SETTINGS,
  restrictionRuleName,
  subjectIdentity,
  type AuthorizationOptionsResponse as OptionsResponse,
  type AuthorizationSubject,
  type RecordSelection as RestrictionSelection,
  type RestrictionRule,
  type RestrictionRuleAction,
  type RestrictionRulePatch,
  type RestrictionRulesOutletContext,
} from './model.js';

type RuleResource = {
  readonly type: string;
  readonly id: string;
  readonly label: string;
  readonly actions: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly dataScopes: Readonly<Record<string, readonly RuleScope[]>>;
};
type RuleScope = {
  readonly key: string;
  readonly label: string;
  readonly collection: string;
  readonly fields: readonly string[];
};
type ActionTarget = {
  readonly action: string;
  readonly actionLabel: string;
  readonly scopeKey?: string;
  readonly scopeLabel?: string;
  readonly collection: string;
};
type FormDraft = {
  readonly key: string;
  readonly title: string;
  readonly resource: { readonly type: string; readonly id: string };
  readonly subjects: readonly AuthorizationSubject[];
  readonly actions: readonly RestrictionRuleAction[];
  readonly reason: string;
};
type FieldErrors = Partial<
  Record<'key' | 'resource' | 'subjects' | 'actions' | 'form', string>
>;

const PAGE_SIZE = 20;

export default function RestrictionRuleFormPage(): ReactElement {
  const { key } = useParams();
  const creating = key === undefined;
  const canCreate = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'create',
  });
  const canUpdate = useCan({
    resource: RESTRICTION_RULES_SETTINGS,
    action: 'update',
  });
  const permission = creating ? canCreate : canUpdate;
  const title = creating
    ? 'restrictionRules.actions.new'
    : 'restrictionRules.actions.edit';
  const { t } = useTranslation();

  if (permission.isPending) {
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader title={t(title)} />
          <SettingsLoading />
        </PageContainer>
      </RouteChildPage>
    );
  }

  if (!permission.can) {
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader title={t(title)} />
          <SettingsError error={permission.error ?? { status: 403 }} />
        </PageContainer>
      </RouteChildPage>
    );
  }

  return (
    <RestrictionRuleEditor
      key={key ?? 'new'}
      ruleKey={key}
      allowed={permission.can}
    />
  );
}

function RestrictionRuleEditor({
  ruleKey,
  allowed,
}: {
  readonly ruleKey?: string;
  readonly allowed: boolean;
}): ReactElement {
  const creating = ruleKey === undefined;
  const api = useApiClient();
  const authz = useAuthorizationClient();
  const toaster = useToaster();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const parent = useOutletContext<RestrictionRulesOutletContext>();
  const [options, setOptions] = useState<OptionsResponse>();
  const [baseline, setBaseline] = useState<RestrictionRule>();
  const [draft, setDraft] = useState<FormDraft>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveError, setSaveError] = useState<unknown>();
  const [formMessage, setFormMessage] = useState<string>();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [mutationApplied, setMutationApplied] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);
  const [reasonTouched, setReasonTouched] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [focusInvalidAttempt, setFocusInvalidAttempt] = useState(0);
  const [pendingResource, setPendingResource] = useState<string>();
  const requestRef = useRef(0);
  const formRef = useRef<HTMLFormElement>(null);

  const notifyForbidden = parent.onForbidden;
  const onForbidden = useCallback(() => {
    requestRef.current += 1;
    setOptions(undefined);
    setBaseline(undefined);
    setDraft(undefined);
    setLoadError({ status: 403 });
    setSaveError(undefined);
    notifyForbidden();
  }, [notifyForbidden]);

  useEffect(() => {
    let active = true;
    const requestId = ++requestRef.current;
    void Promise.all([
      authz.loadOptions('restrictionRules'),
      creating ? Promise.resolve(undefined) : listRestrictionRules(api),
    ]).then(
      ([nextOptions, list]) => {
        if (!active || requestId !== requestRef.current) return;
        setOptions(nextOptions);
        if (!creating && list) {
          const rule = list.data.find((item) => item.key === ruleKey);
          if (!rule) {
            setLoadError({ status: 404 });
            setBaseline(undefined);
            setDraft(undefined);
          } else {
            setBaseline(rule);
            setDraft(draftFromRule(rule, t));
          }
        } else {
          setBaseline(undefined);
          setDraft(emptyDraft());
        }
        setLoading(false);
      },
      (cause: unknown) => {
        if (!active || requestId !== requestRef.current) return;
        setLoadError(cause);
        setLoading(false);
        if (isStatus(cause, 403)) onForbidden();
      },
    );
    return () => {
      active = false;
      requestRef.current += 1;
    };
  }, [api, authz, creating, loadAttempt, ruleKey, t, onForbidden]);

  const resources = useMemo(
    () => (options ? flattenResources(options, t) : []),
    [options, t],
  );
  const subjects = useMemo(
    () =>
      (options?.subjectTypes ?? []).map((subjectType) => ({
        type: subjectType.type,
        label: titleText(subjectType.title, t),
        selection: subjectType.selection,
      })),
    [options?.subjectTypes, t],
  );
  const subjectNames = useSubjectNames(
    'restrictionRules',
    subjects.map((item) => ({
      value: item.type,
      label: item.label,
      selection: item.selection,
    })),
    draft?.subjects ?? [],
  );
  const resourceValue = draft
    ? JSON.stringify([draft.resource.type, draft.resource.id])
    : '';
  const selectedResource = resources.find((resource) =>
    sameValue({ type: resource.type, id: resource.id }, draft?.resource),
  );
  const changedTitle = Boolean(
    baseline &&
    titleTouched &&
    draft &&
    draft.title !== titleTextValue(baseline.title, t),
  );
  const changedReason = Boolean(
    baseline &&
    reasonTouched &&
    draft &&
    draft.reason !== (baseline.reason ?? ''),
  );
  const changedKey = Boolean(
    baseline && draft && draft.key.trim() !== baseline.key,
  );
  const dirty = Boolean(
    draft &&
    (creating
      ? draft.key ||
        draft.title ||
        draft.resource.id ||
        draft.subjects.length ||
        draft.actions.length ||
        draft.reason
      : baseline &&
        (changedKey ||
          changedTitle ||
          changedReason ||
          !sameValue(draft.resource, baseline.resource) ||
          !sameValue(draft.subjects, baseline.subjects) ||
          !sameValue(draft.actions, baseline.actions))),
  );
  const leave = useSettingsLeave(dirty, busy);
  const retryLoad = () => {
    setLoadError(undefined);
    setSaveError(undefined);
    setLoading(true);
    setLoadAttempt((value) => value + 1);
  };

  useEffect(() => {
    if (!focusInvalidAttempt) return;
    const target =
      formRef.current?.querySelector<HTMLElement>(
        '[aria-invalid="true"]:not(section)',
      ) ??
      formRef.current?.querySelector<HTMLElement>(
        'section[aria-invalid="true"]',
      );
    target?.focus();
  }, [focusInvalidAttempt]);

  if (loading) {
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader
            title={t(
              creating
                ? 'restrictionRules.actions.new'
                : 'restrictionRules.actions.edit',
            )}
          />
          {loadError ? (
            <SettingsError
              error={loadError}
              retry={isRetryable(loadError) ? retryLoad : undefined}
            />
          ) : (
            <SettingsLoading />
          )}
          {loadError && isStatus(loadError, 404) ? (
            <Button
              nativeButton={false}
              render={<Link to={{ pathname: '..', search: location.search }} />}
            >
              {t('restrictionRules.actions.cancel')}
            </Button>
          ) : null}
        </PageContainer>
      </RouteChildPage>
    );
  }

  if (loadError || !draft || !options) {
    return (
      <RouteChildPage>
        <PageContainer>
          <BackButton />
          <PageHeader
            title={t(
              creating
                ? 'restrictionRules.actions.new'
                : 'restrictionRules.actions.edit',
            )}
          />
          <SettingsError
            error={loadError ?? { status: 403 }}
            retry={isRetryable(loadError) ? retryLoad : undefined}
          />
          {isStatus(loadError, 404) ? (
            <Button
              nativeButton={false}
              render={<Link to={{ pathname: '..', search: location.search }} />}
            >
              {t('restrictionRules.actions.cancel')}
            </Button>
          ) : null}
        </PageContainer>
      </RouteChildPage>
    );
  }

  const keyName = restrictionRuleName(
    baseline ?? { key: draft.key, title: draft.title },
    (value) => titleText(value, t),
  );
  const update = (change: Partial<FormDraft>) => {
    setDraft((current) => (current ? { ...current, ...change } : current));
    setFieldErrors({});
    setFormMessage(undefined);
    setSaveError(undefined);
  };
  const chooseResource = (value: string) => {
    if (value === resourceValue) return;
    if (baseline && draft.actions.length) {
      setPendingResource(value);
      return;
    }
    applyResource(value);
  };
  const applyResource = (value: string) => {
    const [type, id] = value
      ? (JSON.parse(value) as [string, string])
      : ['', ''];
    update({ resource: { type, id }, actions: [] });
    setPendingResource(undefined);
  };

  const addSubject = (subject: AuthorizationSubject) => {
    if (
      draft.subjects.some(
        (item) => subjectIdentity(item) === subjectIdentity(subject),
      )
    ) {
      setFormMessage(t('restrictionRules.errors.duplicateSubject'));
      return;
    }
    update({ subjects: [...draft.subjects, subject] });
  };
  const removeSubject = (subject: AuthorizationSubject) =>
    update({
      subjects: draft.subjects.filter(
        (item) => subjectIdentity(item) !== subjectIdentity(subject),
      ),
    });

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!allowed || busy || mutationApplied) return;
    setSubmitted(true);
    setFieldErrors({});
    setFormMessage(undefined);
    setSaveError(undefined);
    const errors = validateDraft(draft, resources, t, baseline);
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      if (errors.form) setFormMessage(errors.form);
      setFocusInvalidAttempt((attempt) => attempt + 1);
      return;
    }

    setBusy(true);
    let applied = false;
    try {
      if (creating) {
        const created = await createRestrictionRule(api, {
          key: draft.key.trim(),
          resource: draft.resource,
          actions: draft.actions,
          subjects: draft.subjects,
          ...(draft.title.trim() ? { title: draft.title.trim() } : {}),
          ...(draft.reason.trim() ? { reason: draft.reason.trim() } : {}),
        });
        applied = true;
        setMutationApplied(true);
        await parent.reload();
        toaster.show({
          type: 'success',
          title: t('restrictionRules.feedback.created', {
            name: restrictionRuleName(created, (value) => titleText(value, t)),
          }),
        });
        leave.allow();
        await navigate(
          { pathname: '..', search: location.search },
          { replace: true },
        );
        return;
      }

      if (!baseline) return;
      const patch = makePatch(
        baseline,
        draft,
        changedKey,
        changedTitle,
        changedReason,
      );
      if (Object.keys(patch).length === 0) {
        leave.allow();
        await navigate(
          { pathname: '..', search: location.search },
          { replace: true },
        );
        return;
      }
      const currentList = await listRestrictionRules(api);
      const latest = currentList.data.find((item) => item.key === baseline.key);
      if (!latest) throw Object.assign(new Error('missing'), { status: 404 });
      if (patchConflicts(patch, baseline, latest)) {
        setFormMessage(t('restrictionRules.errors.changedElsewhere'));
        return;
      }
      const saved = await patchRestrictionRule(api, baseline.key, patch);
      applied = true;
      setMutationApplied(true);
      await parent.reload();
      toaster.show({
        type: 'success',
        title: t('restrictionRules.feedback.saved', {
          name: restrictionRuleName(saved, (value) => titleText(value, t)),
        }),
      });
      leave.allow();
      await navigate(
        { pathname: '..', search: location.search },
        { replace: true },
      );
    } catch (cause) {
      if (isStatus(cause, 403)) onForbidden();
      else if (isReason(cause, 'RULE_ALREADY_EXISTS')) {
        setFieldErrors({ key: t('restrictionRules.errors.keyExists') });
      } else if (isStatus(cause, 404)) {
        setLoadError(cause);
      } else if (isReason(cause, 'INVALID_AUTHORIZATION_INPUT')) {
        const violations = fieldViolations(cause);
        const field = violationTarget(violations[0]?.field);
        if (field) {
          setFieldErrors({
            [field]: t('restrictionRules.errors.invalidRecordSelection'),
          });
          setFocusInvalidAttempt((attempt) => attempt + 1);
        } else setSaveError(cause);
      } else if (isStatus(cause, 401)) {
        setSaveError(cause);
      } else if (applied) {
        setFormMessage(t('restrictionRules.errors.savedUnconfirmed'));
      } else {
        setSaveError(cause);
      }
    } finally {
      setBusy(false);
    }
  };

  const title = creating
    ? t('restrictionRules.actions.new')
    : t('restrictionRules.actions.edit');
  const closeTo = { pathname: '..', search: location.search };

  return (
    <RouteChildPage>
      <PageContainer>
        <BackButton to={closeTo} />
        <PageHeader
          title={title}
          description={t('restrictionRules.labels.restrictionSemantics')}
          actions={
            <>
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to={closeTo} />}
                disabled={busy}
              >
                {t('restrictionRules.actions.cancel')}
              </Button>
              <Button
                type='submit'
                form='restriction-rule-form'
                disabled={!allowed || busy || mutationApplied}
              >
                {busy ? <LoaderCircle className='animate-spin' /> : null}
                {t(
                  busy
                    ? 'restrictionRules.actions.saving'
                    : 'restrictionRules.actions.save',
                )}
              </Button>
            </>
          }
        />
        {saveError ? <SettingsError error={saveError} /> : null}
        {formMessage ? (
          <Alert variant='destructive'>
            <AlertDescription>{formMessage}</AlertDescription>
          </Alert>
        ) : null}
        <form
          ref={formRef}
          id='restriction-rule-form'
          className='space-y-5'
          onSubmit={(event) => void save(event)}
          noValidate
        >
          <p className='text-sm text-muted-foreground'>
            {t('restrictionRules.labels.restrictionSemantics')}
          </p>
          <section className='space-y-4 rounded-xl border bg-card p-4'>
            <h2 className='font-heading text-lg font-medium'>
              {t('restrictionRules.labels.ruleKey')}
            </h2>
            <div className='grid gap-4 md:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='restriction-rule-key'>
                  {t('restrictionRules.labels.ruleKey')} *
                </Label>
                <Input
                  id='restriction-rule-key'
                  value={draft.key}
                  disabled={busy}
                  aria-invalid={Boolean(
                    fieldErrors.key || (submitted && !draft.key.trim()),
                  )}
                  onChange={(event) => update({ key: event.target.value })}
                />
                {fieldErrors.key ? (
                  <FieldError message={fieldErrors.key} />
                ) : null}
              </div>
              <div className='space-y-2'>
                <Label htmlFor='restriction-rule-title'>
                  {t('restrictionRules.labels.title')}
                </Label>
                <Input
                  id='restriction-rule-title'
                  value={draft.title}
                  disabled={busy}
                  onChange={(event) => {
                    setTitleTouched(true);
                    update({ title: event.target.value });
                  }}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='restriction-rule-reason'>
                {t('restrictionRules.labels.reason')}
              </Label>
              <Textarea
                id='restriction-rule-reason'
                value={draft.reason}
                disabled={busy}
                onChange={(event) => {
                  setReasonTouched(true);
                  update({ reason: event.target.value });
                }}
              />
            </div>
          </section>

          <section
            className='space-y-4 rounded-xl border bg-card p-4'
            tabIndex={-1}
            aria-invalid={Boolean(
              fieldErrors.resource || (submitted && !draft.resource.id),
            )}
          >
            <h2 className='font-heading text-lg font-medium'>
              {t('restrictionRules.labels.resource')}
            </h2>
            <div className='space-y-2'>
              <Label htmlFor='restriction-rule-resource'>
                {t('restrictionRules.labels.resource')} *
              </Label>
              <Select
                value={resourceValue}
                onValueChange={(value) => {
                  if (value !== null) chooseResource(value);
                }}
                disabled={busy}
                items={resources.map((resource) => ({
                  value: JSON.stringify([resource.type, resource.id]),
                  label: `${resource.label} · ${resource.type}:${resource.id}`,
                }))}
              >
                <SelectTrigger
                  id='restriction-rule-resource'
                  aria-label={t('restrictionRules.labels.resource')}
                  aria-invalid={Boolean(
                    fieldErrors.resource || (submitted && !draft.resource.id),
                  )}
                >
                  <SelectValue
                    placeholder={t('restrictionRules.labels.selectResource')}
                  />
                </SelectTrigger>
                <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
                  {resources.map((resource) => {
                    const value = JSON.stringify([resource.type, resource.id]);
                    return (
                      <SelectItem key={value} value={value}>
                        {resource.label} · {resource.type}:{resource.id}
                      </SelectItem>
                    );
                  })}
                  {baseline &&
                  !resources.some(
                    (resource) =>
                      resource.type === baseline.resource.type &&
                      resource.id === baseline.resource.id,
                  ) ? (
                    <SelectItem value={resourceValue} disabled>
                      {`${baseline.resource.type}:${baseline.resource.id} · ${t('restrictionRules.labels.unknownAction')}`}
                    </SelectItem>
                  ) : null}
                </SelectContent>
              </Select>
              {fieldErrors.resource ? (
                <FieldError message={fieldErrors.resource} />
              ) : null}
              {selectedResource ? (
                <p className='text-xs text-muted-foreground'>
                  {selectedResource.type}:{selectedResource.id}
                </p>
              ) : baseline ? (
                <p className='text-xs text-muted-foreground'>
                  {baseline.resource.type}:{baseline.resource.id}
                </p>
              ) : null}
            </div>
          </section>

          <section
            className='space-y-4 rounded-xl border bg-card p-4'
            tabIndex={-1}
            aria-invalid={Boolean(
              fieldErrors.subjects || (submitted && !draft.subjects.length),
            )}
          >
            <div className='flex flex-wrap items-center justify-between gap-3'>
              <div>
                <h2 className='font-heading text-lg font-medium'>
                  {t('restrictionRules.labels.subjects')} *
                </h2>
                <p className='text-sm text-muted-foreground'>
                  {t('restrictionRules.labels.subjectHelp')}
                </p>
              </div>
            </div>
            <SubjectChooser
              types={subjects}
              disabled={busy}
              onAdd={addSubject}
              onForbidden={onForbidden}
            />
            <div
              className='flex flex-wrap gap-2'
              aria-label={t('restrictionRules.labels.selectedSubjects')}
            >
              {draft.subjects.map((subject) => {
                const typeLabel =
                  subjects.find((item) => item.type === subject.type)?.label ??
                  subject.type;
                const subjectLabel =
                  subjectNames[subjectKey(subject)] ?? subject.id;
                return (
                  <Badge
                    key={subjectIdentity(subject)}
                    variant='secondary'
                    className='gap-2'
                  >
                    {typeLabel}: {subjectLabel}
                    <button
                      type='button'
                      aria-label={t('restrictionRules.actions.removeSubject', {
                        name: subject.id,
                      })}
                      className='rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
                      disabled={busy}
                      onClick={() => removeSubject(subject)}
                    >
                      <XIcon className='size-3' />
                    </button>
                  </Badge>
                );
              })}
            </div>
            {fieldErrors.subjects || (submitted && !draft.subjects.length) ? (
              <FieldError
                message={
                  fieldErrors.subjects ??
                  t('restrictionRules.errors.atLeastOneSubject')
                }
              />
            ) : null}
          </section>

          <section
            className='space-y-4 rounded-xl border bg-card p-4'
            tabIndex={-1}
            aria-invalid={Boolean(
              fieldErrors.actions || (submitted && !draft.actions.length),
            )}
          >
            <div className='flex flex-wrap items-start justify-between gap-3'>
              <div>
                <h2 className='font-heading text-lg font-medium'>
                  {t('restrictionRules.labels.actions')} *
                </h2>
                <p className='text-sm text-muted-foreground'>
                  {t('restrictionRules.labels.actionHelp')}
                </p>
              </div>
              {selectedResource ? (
                <AddActionButton
                  resource={selectedResource}
                  actions={draft.actions}
                  disabled={busy}
                  onAdd={(action) =>
                    update({ actions: [...draft.actions, action] })
                  }
                  t={t}
                />
              ) : null}
            </div>
            <ActionEditor
              resource={selectedResource}
              options={options}
              actions={draft.actions}
              disabled={busy}
              onChange={(actions) => update({ actions })}
              onForbidden={onForbidden}
              t={t}
            />
            {fieldErrors.actions || (submitted && !draft.actions.length) ? (
              <FieldError
                message={
                  fieldErrors.actions ??
                  t('restrictionRules.errors.atLeastOneAction')
                }
              />
            ) : null}
          </section>
        </form>
        {leave.dialog}
        <ConfirmAction
          open={Boolean(pendingResource)}
          title={t('restrictionRules.confirm.changeResourceTitle', {
            name: keyName,
          })}
          description={t('restrictionRules.confirm.changeResourceDescription')}
          confirmLabel={t('restrictionRules.confirm.changeResource')}
          busy={false}
          onCancel={() => setPendingResource(undefined)}
          onConfirm={() => pendingResource && applyResource(pendingResource)}
        />
      </PageContainer>
    </RouteChildPage>
  );
}

function SubjectChooser({
  types,
  disabled,
  onAdd,
  onForbidden,
}: {
  readonly types: readonly {
    readonly type: string;
    readonly label: string;
    readonly selection?:
      | { readonly type: 'fixed'; readonly id: string }
      | { readonly type: 'collection' };
  }[];
  readonly disabled: boolean;
  readonly onAdd: (subject: AuthorizationSubject) => void;
  readonly onForbidden: () => void;
}): ReactElement {
  const authz = useAuthorizationClient();
  const { t } = useTranslation();
  const [activeType, setActiveType] = useState(types[0]?.type ?? '');
  const [search, setSearch] = useState('');
  const [requestSearch, setRequestSearch] = useState('');
  const [composing, setComposing] = useState(false);
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly data: {
      readonly items: readonly SubjectOption[];
      readonly total: number;
    };
  }>();
  const [error, setError] = useState<unknown>();
  const current = types.find((item) => item.type === activeType) ?? types[0];
  const queryKey = JSON.stringify([current?.type, requestSearch, page]);
  useEffect(() => {
    if (composing || search === requestSearch) return;
    const timer = window.setTimeout(() => setRequestSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [composing, requestSearch, search]);
  useEffect(() => {
    if (!current || current.selection?.type !== 'collection') return;
    let active = true;
    void authz
      .listSubjects('restrictionRules', current.type, {
        search: requestSearch,
        page,
        pageSize: PAGE_SIZE,
      })
      .then(
        (data) => {
          if (active) {
            setResult({ key: queryKey, data });
            setError(undefined);
          }
        },
        (cause: unknown) => {
          if (active) {
            setError(cause);
            if (isStatus(cause, 403)) onForbidden();
          }
        },
      );
    return () => {
      active = false;
    };
  }, [attempt, authz, current, onForbidden, page, queryKey, requestSearch]);

  const directory = result?.key === queryKey ? result.data : undefined;
  const pages = Math.max(1, Math.ceil((directory?.total ?? 0) / PAGE_SIZE));
  const addFixed = () => {
    if (current?.selection?.type === 'fixed')
      onAdd({ type: current.type, id: current.selection.id });
  };
  return (
    <div className='space-y-3'>
      {types.length ? (
        <Select
          value={current?.type ?? ''}
          onValueChange={(value) => {
            if (value === null) return;
            setActiveType(value);
            setSearch('');
            setRequestSearch('');
            setPage(1);
            setError(undefined);
          }}
          items={types.map((item) => ({ value: item.type, label: item.label }))}
          disabled={disabled}
        >
          <SelectTrigger
            aria-label={t('restrictionRules.labels.subjectType')}
            className='w-full sm:max-w-80'
          >
            <SelectValue
              placeholder={t('restrictionRules.labels.selectSubject')}
            />
          </SelectTrigger>
          <SelectContent className='w-auto min-w-40'>
            {types.map((item) => (
              <SelectItem key={item.type} value={item.type}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className='text-sm text-muted-foreground'>
          {t('restrictionRules.labels.noSubjectTypes')}
        </p>
      )}
      {current?.selection?.type === 'fixed' ? (
        <Button
          type='button'
          variant='outline'
          onClick={addFixed}
          disabled={disabled}
        >
          <PlusIcon /> {t('restrictionRules.actions.addSubject')}:{' '}
          {current.label}
        </Button>
      ) : current?.selection?.type === 'collection' ? (
        <>
          <Input
            aria-label={t('restrictionRules.labels.subjectSearch')}
            placeholder={t('restrictionRules.labels.subjectSearch')}
            value={search}
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={(event) => {
              setComposing(false);
              setSearch(event.currentTarget.value);
              setPage(1);
            }}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            disabled={disabled}
          />
          {error ? (
            <SettingsError
              error={error}
              retry={() => setAttempt((value) => value + 1)}
            />
          ) : null}
          <ul className='divide-y rounded-lg border'>
            {directory?.items.map((item) => (
              <li
                key={item.id}
                className='flex items-center justify-between gap-3 p-2'
              >
                <span
                  className='min-w-0 truncate'
                  title={`${titleText(item.title, t)} · ${item.id}`}
                >
                  {titleText(item.title, t)}{' '}
                  <span className='text-muted-foreground'>· {item.id}</span>
                </span>
                <Button
                  type='button'
                  size='sm'
                  variant='outline'
                  onClick={() => onAdd({ type: current.type, id: item.id })}
                  disabled={disabled}
                >
                  <PlusIcon /> {t('restrictionRules.actions.addSubject')}
                </Button>
              </li>
            ))}
            {!directory?.items.length && result?.key === queryKey ? (
              <li className='p-3 text-sm text-muted-foreground'>
                {t('restrictionRules.labels.noSubjects')}
              </li>
            ) : null}
          </ul>
          <div className='flex items-center justify-between gap-2'>
            <span className='text-sm text-muted-foreground'>
              {t('restrictionRules.labels.pageOf', { page, pages })}
            </span>
            <div className='flex gap-2'>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled || page <= 1}
                onClick={() => setPage((value) => value - 1)}
              >
                {t('restrictionRules.labels.previousPage')}
              </Button>
              <Button
                type='button'
                variant='outline'
                size='sm'
                disabled={disabled || !directory || page >= pages}
                onClick={() => setPage((value) => value + 1)}
              >
                {t('restrictionRules.labels.nextPage')}
              </Button>
            </div>
          </div>
        </>
      ) : null}
      {error && isStatus(error, 401) ? (
        <p className='text-sm text-destructive'>{t('settings.sessionEnded')}</p>
      ) : null}
    </div>
  );
}

function AddActionButton({
  resource,
  actions,
  disabled,
  onAdd,
  t,
}: {
  readonly resource: RuleResource;
  readonly actions: readonly RestrictionRuleAction[];
  readonly disabled: boolean;
  readonly onAdd: (action: RestrictionRuleAction) => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const targets = actionTargets(resource).filter(
    (target) => !actions.some((action) => sameActionTarget(action, target)),
  );
  const [value, setValue] = useState('');
  const available = targets.find((target) => targetValue(target) === value);
  return (
    <div className='flex min-w-0 flex-wrap gap-2'>
      <Select
        value={value}
        onValueChange={(next) => {
          if (next !== null) setValue(next);
        }}
        disabled={disabled || !targets.length}
        items={targets.map((target) => ({
          value: targetValue(target),
          label: targetLabel(target),
        }))}
      >
        <SelectTrigger
          aria-label={t('restrictionRules.labels.selectAction')}
          className='w-full sm:w-72'
        >
          <SelectValue
            placeholder={t('restrictionRules.labels.selectAction')}
          />
        </SelectTrigger>
        <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
          {targets.map((target) => (
            <SelectItem key={targetValue(target)} value={targetValue(target)}>
              {targetLabel(target)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type='button'
        variant='outline'
        disabled={disabled || !available}
        onClick={() => {
          if (!available) return;
          onAdd({
            action: available.action,
            ...(available.scopeKey ? { scopeKey: available.scopeKey } : {}),
            selection: { type: 'records', ids: [] },
          });
          setValue('');
        }}
      >
        <PlusIcon /> {t('restrictionRules.actions.addAction')}
      </Button>
    </div>
  );
}

function ActionEditor({
  resource,
  options,
  actions,
  disabled,
  onChange,
  onForbidden,
  t,
}: {
  readonly resource?: RuleResource;
  readonly options: OptionsResponse;
  readonly actions: readonly RestrictionRuleAction[];
  readonly disabled: boolean;
  readonly onChange: (actions: readonly RestrictionRuleAction[]) => void;
  readonly onForbidden: () => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  return (
    <div className='space-y-4'>
      {actions.map((action, index) => (
        <ActionSelectionEditor
          key={JSON.stringify([
            resource?.type ?? '',
            resource?.id ?? '',
            action.action,
            action.scopeKey ?? '',
          ])}
          index={index}
          action={action}
          target={
            resource
              ? actionTargets(resource).find((item) =>
                  sameActionTarget(action, item),
                )
              : undefined
          }
          options={options}
          disabled={disabled}
          onChange={(next) =>
            onChange(actions.map((item, i) => (i === index ? next : item)))
          }
          onRemove={() => onChange(actions.filter((_, i) => i !== index))}
          onForbidden={onForbidden}
          t={t}
        />
      ))}
      {actions.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {resource
            ? t('restrictionRules.labels.noActions')
            : t('restrictionRules.labels.selectResource')}
        </p>
      ) : null}
    </div>
  );
}

function ActionSelectionEditor({
  index,
  action,
  target,
  options,
  disabled,
  onChange,
  onRemove,
  onForbidden,
  t,
}: {
  readonly index: number;
  readonly action: RestrictionRuleAction;
  readonly target?: ActionTarget;
  readonly options: OptionsResponse;
  readonly disabled: boolean;
  readonly onChange: (action: RestrictionRuleAction) => void;
  readonly onRemove: () => void;
  readonly onForbidden: () => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const selection = action.selection;
  const policies = target ? compatiblePolicies(options, target.collection) : [];
  const hasCurrentPolicy =
    selection.type === 'recordAccess' &&
    policies.some((item) => item.key === selection.key);
  return (
    <div
      className='space-y-3 rounded-lg border p-3'
      data-testid={`restriction-action-${index}`}
    >
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <p className='font-medium'>
            {target
              ? targetLabel(target)
              : `${action.action}${action.scopeKey ? ` · ${action.scopeKey}` : ''}`}
          </p>
          {target ? (
            <p className='text-xs text-muted-foreground'>{target.collection}</p>
          ) : (
            <p className='text-sm text-muted-foreground'>
              {t('restrictionRules.labels.unknownAction')}
            </p>
          )}
        </div>
        <Button
          type='button'
          variant='ghost'
          size='icon-sm'
          aria-label={t('restrictionRules.actions.removeAction')}
          onClick={onRemove}
          disabled={disabled}
        >
          <XIcon />
        </Button>
      </div>
      {!target ? (
        <pre className='overflow-x-auto rounded-md bg-muted p-2 text-xs'>
          {JSON.stringify(action.selection, null, 2)}
        </pre>
      ) : (
        <>
          <Select
            value={
              selection.type === 'all'
                ? 'all'
                : selection.type === 'records'
                  ? 'records'
                  : `policy:${selection.key}`
            }
            onValueChange={(value) => {
              if (value === null) return;
              if (value === 'all') {
                if (selection.type !== 'all')
                  onChange({ ...action, selection: { type: 'all' } });
                return;
              }
              if (value === 'records') {
                onChange({
                  ...action,
                  selection:
                    selection.type === 'records'
                      ? selection
                      : { type: 'records', ids: [] },
                });
                return;
              }
              const key = value.slice('policy:'.length);
              if (selection.type === 'recordAccess' && selection.key === key)
                return;
              onChange({
                ...action,
                selection: {
                  type: 'recordAccess',
                  key,
                  ...(key === 'customFilter'
                    ? { params: { filter: emptyRestrictionFilter() } }
                    : {}),
                },
              });
            }}
            disabled={disabled}
            items={[
              {
                value: 'all',
                label: t('restrictionRules.labels.allRecords'),
              },
              {
                value: 'records',
                label: t('restrictionRules.labels.selectRecords'),
              },
              ...policies.map((policy) => ({
                value: `policy:${policy.key}`,
                label: titleText(policy.title, t),
              })),
              ...(selection.type === 'recordAccess' && !hasCurrentPolicy
                ? [{ value: `policy:${selection.key}`, label: selection.key }]
                : []),
            ]}
          >
            <SelectTrigger aria-label={t('restrictionRules.labels.selection')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className='w-auto max-w-[min(var(--container-sm),var(--available-width))] min-w-(--anchor-width) [&_[data-slot=select-item]>:first-child]:whitespace-normal'>
              <SelectItem value='all'>
                {t('restrictionRules.labels.allRecords')}
              </SelectItem>
              <SelectItem value='records'>
                {t('restrictionRules.labels.selectRecords')}
              </SelectItem>
              {policies.map((policy) => (
                <SelectItem key={policy.key} value={`policy:${policy.key}`}>
                  {titleText(policy.title, t)}
                </SelectItem>
              ))}
              {selection.type === 'recordAccess' && !hasCurrentPolicy ? (
                <SelectItem
                  value={`policy:${selection.key}`}
                  disabled
                >{`${selection.key} · ${t('restrictionRules.labels.unsupportedSelection')}`}</SelectItem>
              ) : null}
            </SelectContent>
          </Select>
          {selection.type === 'all' ? (
            <Alert>
              <AlertDescription>
                {t('restrictionRules.labels.allSelectionDescription')}
              </AlertDescription>
            </Alert>
          ) : selection.type === 'records' ? (
            <RecordSelectionPicker
              collection={target.collection}
              ids={selection.ids}
              disabled={disabled}
              onChange={(ids) =>
                onChange({ ...action, selection: { type: 'records', ids } })
              }
              onForbidden={onForbidden}
              t={t}
            />
          ) : (
            <RecordAccessDetails
              selection={selection}
              options={options}
              target={target}
              disabled={disabled}
              onChange={(next) => onChange({ ...action, selection: next })}
              t={t}
            />
          )}
        </>
      )}
    </div>
  );
}

function RecordSelectionPicker({
  collection,
  ids,
  disabled,
  onChange,
  onForbidden,
  t,
}: {
  readonly collection: string;
  readonly ids: readonly string[];
  readonly disabled: boolean;
  readonly onChange: (ids: readonly string[]) => void;
  readonly onForbidden: () => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const api = useApiClient();
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    readonly key: string;
    readonly items: readonly {
      readonly id: string;
      readonly label: string;
      readonly description?: string;
    }[];
    readonly total: number;
  }>();
  const [error, setError] = useState<unknown>();
  const requestKey = JSON.stringify([collection, page]);
  useEffect(() => {
    let active = true;
    void listRestrictionRuleRecords(api, collection, page).then(
      (response) => {
        if (active) {
          setResult({
            key: requestKey,
            items: response.data,
            total: response.meta.total,
          });
          setError(undefined);
        }
      },
      (cause: unknown) => {
        if (active) {
          setError(cause);
          if (isStatus(cause, 403)) onForbidden();
        }
      },
    );
    return () => {
      active = false;
    };
  }, [api, attempt, collection, onForbidden, page, requestKey]);
  const rows = result?.key === requestKey ? result.items : [];
  const pageCount = Math.max(
    1,
    Math.ceil((result?.key === requestKey ? result.total : 0) / PAGE_SIZE),
  );
  const toggle = (id: string, checked: boolean) => {
    onChange(
      checked
        ? [...new Set([...ids, id])]
        : ids.filter((value) => value !== id),
    );
  };
  return (
    <div className='space-y-2'>
      <p className='text-sm font-medium'>
        {t('restrictionRules.labels.selectedRecords')}
      </p>
      <div className='flex flex-wrap gap-1'>
        {ids.map((id) => (
          <Badge key={id} variant='secondary' className='gap-1'>
            {id}
            <button
              type='button'
              className='rounded-sm focus-visible:ring-2 focus-visible:ring-ring'
              aria-label={t('restrictionRules.actions.removeRecord', { id })}
              onClick={() => toggle(id, false)}
              disabled={disabled}
            >
              <XIcon className='size-3' />
            </button>
          </Badge>
        ))}
        {!ids.length ? (
          <span className='text-sm text-muted-foreground'>
            {t('restrictionRules.labels.noRecordsSelected')}
          </span>
        ) : null}
      </div>
      {error ? (
        <SettingsError
          error={error}
          retry={() => setAttempt((value) => value + 1)}
        />
      ) : null}
      <ul className='divide-y rounded-lg border'>
        {rows.map((record) => (
          <li key={record.id} className='flex items-center gap-3 p-2'>
            <Checkbox
              checked={ids.includes(record.id)}
              onCheckedChange={(checked) => toggle(record.id, checked === true)}
              disabled={disabled}
              aria-label={record.label}
            />
            <span
              className='min-w-0 flex-1 truncate'
              title={
                record.description
                  ? `${record.label} · ${record.description}`
                  : record.label
              }
            >
              {record.label}
            </span>
            <span className='font-mono text-xs text-muted-foreground'>
              {record.id}
            </span>
          </li>
        ))}
        {!rows.length && result?.key !== requestKey && !error ? (
          <li className='p-3 text-sm text-muted-foreground'>
            <LoaderCircle className='size-4 animate-spin' />
          </li>
        ) : null}
        {!rows.length && result?.key === requestKey ? (
          <li className='p-3 text-sm text-muted-foreground'>
            {t('restrictionRules.labels.noRecords')}
          </li>
        ) : null}
      </ul>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-sm text-muted-foreground'>
          {t('restrictionRules.labels.pageOf', { page, pages: pageCount })}
        </span>
        <div className='flex gap-2'>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled || page <= 1}
            onClick={() => setPage((value) => value - 1)}
          >
            {t('restrictionRules.labels.previousPage')}
          </Button>
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={disabled || !result || page >= pageCount}
            onClick={() => setPage((value) => value + 1)}
          >
            {t('restrictionRules.labels.nextPage')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RecordAccessDetails({
  selection,
  options,
  target,
  disabled,
  onChange,
  t,
}: {
  readonly selection: Extract<
    RecordSelection,
    { readonly type: 'recordAccess' }
  >;
  readonly options: OptionsResponse;
  readonly target: ActionTarget;
  readonly disabled: boolean;
  readonly onChange: (selection: RestrictionSelection) => void;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const policy = options.recordAccess.find(
    (item) => item.key === selection.key,
  );
  const policyIsCompatible = compatiblePolicies(
    options,
    target.collection,
  ).some((item) => item.key === selection.key);
  const [filterOpen, setFilterOpen] = useState(false);
  const labels = permissionFilterLabels(t);
  const filter = recordAccessFilter(selection);
  return (
    <div className='space-y-2'>
      <p className='text-sm text-muted-foreground'>
        {policy?.description
          ? titleText(policy.description, t)
          : policy
            ? titleText(policy.title, t)
            : selection.key}
      </p>
      {!policyIsCompatible ? (
        <Alert>
          <AlertDescription>
            {t('restrictionRules.labels.unsupportedSelection')}
          </AlertDescription>
        </Alert>
      ) : selection.key === 'customFilter' ? (
        <>
          {filter ? <FilterSummary value={filter} t={t} /> : null}
          <Button
            type='button'
            variant='outline'
            onClick={() => setFilterOpen(true)}
            disabled={disabled}
          >
            {t('restrictionRules.actions.configureFilter')}
          </Button>
          <PermissionFilter
            open={filterOpen}
            onOpenChange={setFilterOpen}
            value={filter}
            fields={targetFields(options, target.collection).map((field) => ({
              value: field,
              label: field,
            }))}
            labels={labels}
            disabled={disabled}
            onApply={(next) =>
              onChange({
                type: 'recordAccess',
                key: 'customFilter',
                params: { filter: next },
              })
            }
          />
        </>
      ) : null}
      {policyIsCompatible &&
      selection.key !== 'customFilter' &&
      selection.params !== undefined ? (
        <>
          <Alert>
            <AlertDescription>
              {t('restrictionRules.labels.unsupportedSelection')}
            </AlertDescription>
          </Alert>
        </>
      ) : null}
    </div>
  );
}

function FilterSummary({
  value,
  t,
}: {
  readonly value: unknown;
  readonly t: (key: string, options?: Record<string, unknown>) => string;
}): ReactElement {
  const items =
    value && typeof value === 'object' && 'items' in value
      ? value.items
      : undefined;
  const count = Array.isArray(items) ? items.length : 0;
  return (
    <p className='text-xs text-muted-foreground'>
      {t('restrictionRules.labels.filterSummary', { count })}
    </p>
  );
}

function permissionFilterLabels(
  t: (key: string, options?: Record<string, unknown>) => string,
): PermissionFilterLabels {
  return {
    configure: t('settings.permissionFilter.configure'),
    title: t('settings.permissionFilter.title'),
    description: t('settings.permissionFilter.description'),
    all: t('settings.permissionFilter.all'),
    any: t('settings.permissionFilter.any'),
    field: t('settings.permissionFilter.field'),
    operator: t('settings.permissionFilter.operator'),
    valueType: t('settings.permissionFilter.valueType'),
    value: t('settings.permissionFilter.value'),
    text: t('settings.permissionFilter.text'),
    number: t('settings.permissionFilter.number'),
    boolean: t('settings.permissionFilter.boolean'),
    true: t('settings.permissionFilter.true'),
    false: t('settings.permissionFilter.false'),
    add: t('settings.permissionFilter.add'),
    limit: t('settings.permissionFilter.limit'),
    remove: t('settings.permissionFilter.remove'),
    cancel: t('settings.permissionFilter.cancel'),
    apply: t('settings.permissionFilter.apply'),
    invalid: t('settings.permissionFilter.invalid'),
    advanced: t('settings.permissionFilter.advanced'),
    reconfigure: t('settings.permissionFilter.reconfigure'),
    operators: Object.fromEntries(
      [
        '$eq',
        '$ne',
        '$includes',
        '$gt',
        '$gte',
        '$lt',
        '$lte',
        '$empty',
        '$notEmpty',
      ].map((key) => [key, t(`settings.permissionFilter.operators.${key}`)]),
    ),
  };
}

function FieldError({ message }: { readonly message: string }): ReactElement {
  return <p className='text-sm text-destructive'>{message}</p>;
}

function emptyDraft(): FormDraft {
  return {
    key: '',
    title: '',
    resource: { type: '', id: '' },
    subjects: [],
    actions: [],
    reason: '',
  };
}

function draftFromRule(
  rule: RestrictionRule,
  t: (key: string, options?: Record<string, unknown>) => string,
): FormDraft {
  return {
    key: rule.key,
    title: titleTextValue(rule.title, t),
    resource: { ...rule.resource },
    subjects: rule.subjects.map((subject) => ({ ...subject })),
    actions: rule.actions.map((action) => structuredClone(action)),
    reason: rule.reason ?? '',
  };
}

function titleTextValue(
  value: LocalizedText | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (value === undefined) return '';
  return titleText(value, t);
}

function flattenResources(
  options: OptionsResponse,
  t: (key: string, options?: Record<string, unknown>) => string,
): readonly RuleResource[] {
  return options.sections
    .flatMap((section) =>
      section.subsections.flatMap((subsection) =>
        subsection.resources.map((resource) => ({
          type: resource.type,
          id: resource.id,
          label: titleText(resource.title, t),
          actions: resource.actions.map((action) => ({
            value: action.name,
            label: titleText(action.title, t),
          })),
          dataScopes: Object.fromEntries(
            Object.entries(resource.dataScopes ?? {}).map(
              ([action, scopes]) => [
                action,
                scopes.map((scope) => ({
                  key: scope.key,
                  label: titleText(scope.title, t),
                  collection: scope.collection,
                  fields: scope.fields,
                })),
              ],
            ),
          ),
        })),
      ),
    )
    .filter(
      (resource) =>
        resource.type === 'database.collection' ||
        Object.values(resource.dataScopes).some((scopes) => scopes.length),
    );
}

function actionTargets(resource: RuleResource): readonly ActionTarget[] {
  return resource.actions.flatMap((action) => {
    const scopes = resource.dataScopes[action.value] ?? [];
    if (scopes.length)
      return scopes.map((scope) => ({
        action: action.value,
        actionLabel: action.label,
        scopeKey: scope.key,
        scopeLabel: scope.label,
        collection: scope.collection,
      }));
    if (resource.type === 'database.collection')
      return [
        {
          action: action.value,
          actionLabel: action.label,
          collection: resource.id,
        },
      ];
    return [];
  });
}

function sameActionTarget(
  action: RestrictionRuleAction,
  target: ActionTarget,
): boolean {
  return (
    action.action === target.action &&
    (action.scopeKey ?? '') === (target.scopeKey ?? '')
  );
}

function targetValue(target: ActionTarget): string {
  return JSON.stringify([target.action, target.scopeKey ?? '']);
}

function targetLabel(target: ActionTarget): string {
  return `${target.actionLabel}${target.scopeLabel ? ` · ${target.scopeLabel}` : ''}`;
}

function compatiblePolicies(options: OptionsResponse, collection: string) {
  return options.recordAccess.filter(
    (item) => !item.collections || item.collections.includes(collection),
  );
}

function targetFields(
  options: OptionsResponse,
  collection: string,
): readonly string[] {
  return (
    options.collections.find((item) => item.name === collection)?.fields ?? []
  );
}

function validateDraft(
  draft: FormDraft,
  resources: readonly RuleResource[],
  t: (key: string, options?: Record<string, unknown>) => string,
  baseline?: RestrictionRule,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!draft.key.trim()) errors.key = t('restrictionRules.errors.required');
  if (isReservedRestrictionRuleKey(draft.key.trim()))
    errors.key = t('restrictionRules.errors.keyExists');
  if (!draft.resource.id)
    errors.resource = t('restrictionRules.errors.required');
  else if (
    !resources.some(
      (item) =>
        item.type === draft.resource.type && item.id === draft.resource.id,
    ) &&
    (!baseline || !sameValue(baseline.resource, draft.resource))
  )
    errors.resource = t('restrictionRules.errors.unsupportedResource');
  if (!draft.subjects.length)
    errors.subjects = t('restrictionRules.errors.atLeastOneSubject');
  if (!draft.actions.length)
    errors.actions = t('restrictionRules.errors.atLeastOneAction');
  else if (
    draft.actions.some(
      (item) =>
        item.selection.type === 'records' && item.selection.ids.length === 0,
    )
  )
    errors.actions = t('restrictionRules.errors.invalidRecordSelection');
  return errors;
}

function makePatch(
  baseline: RestrictionRule,
  draft: FormDraft,
  keyChanged: boolean,
  titleChanged: boolean,
  reasonChanged: boolean,
): RestrictionRulePatch {
  const patch: {
    key?: string;
    resource?: FormDraft['resource'];
    actions?: readonly RestrictionRuleAction[];
    subjects?: readonly AuthorizationSubject[];
    title?: string | null;
    reason?: string | null;
  } = {};
  if (keyChanged) patch.key = draft.key.trim();
  if (!sameValue(baseline.resource, draft.resource))
    patch.resource = draft.resource;
  if (!sameValue(baseline.actions, draft.actions))
    patch.actions = draft.actions;
  if (!sameValue(baseline.subjects, draft.subjects))
    patch.subjects = draft.subjects;
  if (titleChanged) patch.title = draft.title.trim() || null;
  if (reasonChanged) patch.reason = draft.reason.trim() || null;
  return patch;
}

function patchConflicts(
  patch: RestrictionRulePatch,
  baseline: RestrictionRule,
  latest: RestrictionRule,
): boolean {
  return Object.keys(patch).some((key) => {
    const field = key as keyof RestrictionRule;
    return !sameValue(baseline[field], latest[field]);
  });
}

function fieldViolations(
  error: unknown,
): readonly { readonly field?: unknown }[] {
  if (
    !(error instanceof ApiClientError) ||
    !error.payload ||
    typeof error.payload !== 'object'
  )
    return [];
  const payload = error.payload as {
    readonly error?: {
      readonly fieldViolations?: readonly { readonly field?: unknown }[];
    };
    readonly fieldViolations?: readonly { readonly field?: unknown }[];
  };
  return payload.error?.fieldViolations ?? payload.fieldViolations ?? [];
}

function violationTarget(value: unknown): keyof FieldErrors | undefined {
  if (typeof value !== 'string') return undefined;
  if (value.startsWith('key')) return 'key';
  if (value.startsWith('resource')) return 'resource';
  if (value.startsWith('subjects')) return 'subjects';
  if (value.startsWith('actions')) return 'actions';
  return undefined;
}

function isReason(error: unknown, reason: string): boolean {
  if (
    !(error instanceof ApiClientError) ||
    !error.payload ||
    typeof error.payload !== 'object'
  )
    return false;
  const payload = error.payload as {
    readonly error?: { readonly reason?: unknown };
    readonly reason?: unknown;
  };
  return payload.error?.reason === reason || payload.reason === reason;
}

function isStatus(error: unknown, status: number): boolean {
  return error instanceof ApiClientError
    ? error.status === status
    : Boolean(
        error &&
        typeof error === 'object' &&
        Reflect.get(error, 'status') === status,
      );
}

function isRetryable(error: unknown): boolean {
  return ![401, 403, 404].some((status) => isStatus(error, status));
}
