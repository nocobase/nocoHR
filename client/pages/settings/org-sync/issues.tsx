import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { SparklesIcon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type { EmployeeListItem } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

import { ASSIGNABLE_TYPES, issueSubject, text } from './helpers.js';
import { IssueDetails } from './issue-details.js';
import { AccountDialog, AssignDialog } from './resolve-dialogs.js';
import {
  ISSUE_TYPES,
  type IssuesResponse,
  type OrgSyncOutletContext,
  type SyncIssue,
} from './types.js';

type Lookups = ReturnType<typeof useLookups>;

/** The departments an item concerns, for the department filter. */
function departmentsOf(
  issue: SyncIssue,
  employeeDepartment: (id: string) => string | undefined,
): string[] {
  const d = issue.detail;
  const ids = [
    issue.departmentId,
    text(d.departmentId),
    text((d.from as Record<string, unknown> | undefined)?.departmentId),
    text((d.to as Record<string, unknown> | undefined)?.departmentId),
    text((d.want as Record<string, unknown> | undefined)?.departmentId),
    issue.employeeId ? employeeDepartment(issue.employeeId) : undefined,
  ];
  return ids.filter((id): id is string => Boolean(id));
}

/**
 * Tab 待处理: every open and in-progress item of the latest run, grouped by
 * type, with both sides' values, the HR assistant's note and the handling
 * buttons of its type. Filters live in the URL.
 */
export default function OrgSyncIssuesTab(): ReactElement {
  const { t } = useTranslation();
  const context = useOutletContext<OrgSyncOutletContext>();
  const lookups = useLookups();
  const employees = useRemote<{ items: EmployeeListItem[] }>(
    'talent/employees',
  );
  const remote = useRemote<IssuesResponse>('talent/org-sync/issues', {
    refresh: context.epoch,
  });
  const [params, setParams] = useSearchParams();
  const typeFilter = params.get('type') ?? '';
  const statusFilter = params.get('status') ?? '';
  const departmentFilter = params.get('department') ?? '';
  const [ignoring, setIgnoring] = useState<SyncIssue | null>(null);
  const [assigning, setAssigning] = useState<SyncIssue | null>(null);
  const [accountFor, setAccountFor] = useState<SyncIssue | null>(null);
  const resolve = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'resolveIssues',
  });
  const configure = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'configure',
  });
  const provider = t(
    `orgSync.provider.${context.status?.settings.value.provider ?? 'feishu'}`,
  );

  const setFilter = (name: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(name, value);
        else next.delete(name);
        return next;
      },
      { replace: true },
    );

  const scope = useMemo(() => {
    if (!departmentFilter) return null;
    const set = new Set([departmentFilter]);
    // Sub-departments: lookups are ordered parent before child.
    for (const d of lookups.departments)
      if (d.parentId && set.has(d.parentId)) set.add(d.id);
    return set;
  }, [departmentFilter, lookups.departments]);

  const employeeDepartment = useMemo(() => {
    const map = new Map(
      (employees.data?.items ?? []).map((e) => [e.id, e.departmentId]),
    );
    return (id: string) => map.get(id);
  }, [employees.data]);
  const employeeName = useMemo(() => {
    const map = new Map(
      (employees.data?.items ?? []).map((e) => [e.id, e.name]),
    );
    return (id: string) => map.get(id);
  }, [employees.data]);

  const all = remote.data?.issues ?? [];
  const filtered = all.filter(
    (i) =>
      (!typeFilter || i.type === typeFilter) &&
      (!statusFilter || i.status === statusFilter) &&
      (!scope ||
        departmentsOf(i, employeeDepartment).some((id) => scope.has(id))),
  );
  const groups = ISSUE_TYPES.map((type) => ({
    type,
    items: filtered.filter((i) => i.type === type),
  })).filter((g) => g.items.length);
  const filtering = Boolean(typeFilter || statusFilter || departmentFilter);

  if (remote.error && !remote.data)
    return <LoadError error={remote.error} onRetry={remote.reload} />;
  if (!remote.data) return <BlockSkeleton rows={5} />;
  if (!all.length)
    return (
      <EmptyState
        title={t('orgSync.issues.empty')}
        description={t('orgSync.issues.emptyDescription')}
      />
    );
  return (
    <div className='space-y-6'>
      <div className='flex flex-wrap items-end gap-2'>
        <Field className='w-full sm:w-56'>
          <FieldLabel htmlFor='issue-type'>
            {t('orgSync.issues.type')}
          </FieldLabel>
          <NativeSelect
            id='issue-type'
            value={typeFilter}
            onChange={(e) => setFilter('type', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('orgSync.issues.allTypes')}
            </NativeSelectOption>
            {ISSUE_TYPES.map((type) => (
              <NativeSelectOption key={type} value={type}>
                {t(`orgSync.issueType.${type}.title`)} (
                {all.filter((i) => i.type === type).length})
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-full sm:w-40'>
          <FieldLabel htmlFor='issue-status'>
            {t('orgSync.issues.status')}
          </FieldLabel>
          <NativeSelect
            id='issue-status'
            value={statusFilter}
            onChange={(e) => setFilter('status', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('orgSync.issues.allStatuses')}
            </NativeSelectOption>
            <NativeSelectOption value='open'>
              {t('orgSync.issueStatus.open')}
            </NativeSelectOption>
            <NativeSelectOption value='inProgress'>
              {t('orgSync.issueStatus.inProgress')}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field className='w-full sm:w-56'>
          <FieldLabel htmlFor='issue-department'>
            {t('orgSync.issues.department')}
          </FieldLabel>
          <NativeSelect
            id='issue-department'
            value={departmentFilter}
            onChange={(e) => setFilter('department', e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('orgSync.issues.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'  '.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {filtering ? (
          <Button
            variant='ghost'
            onClick={() =>
              setParams(
                (current) => {
                  const next = new URLSearchParams(current);
                  next.delete('type');
                  next.delete('status');
                  next.delete('department');
                  return next;
                },
                { replace: true },
              )
            }
          >
            {t('orgSync.issues.clearFilters')}
          </Button>
        ) : null}
        {remote.loading ? <Spinner aria-label={t('status.loading')} /> : null}
      </div>
      {!groups.length ? (
        <EmptyState
          title={t('orgSync.issues.noMatch')}
          action={
            <Button
              variant='outline'
              onClick={() =>
                setParams(
                  (current) => {
                    const next = new URLSearchParams(current);
                    next.delete('type');
                    next.delete('status');
                    next.delete('department');
                    return next;
                  },
                  { replace: true },
                )
              }
            >
              {t('orgSync.issues.clearFilters')}
            </Button>
          }
        />
      ) : (
        groups.map((group) => (
          <section key={group.type} className='space-y-3'>
            <div>
              <h3 className='flex items-center gap-2 text-base font-medium'>
                {t(`orgSync.issueType.${group.type}.title`)}
                <Badge variant='secondary'>{group.items.length}</Badge>
              </h3>
              <p className='text-sm text-muted-foreground'>
                {t(`orgSync.issueType.${group.type}.description`)}
              </p>
            </div>
            <ul className='space-y-3'>
              {group.items.map((issue) => (
                <IssueItem
                  key={issue.key}
                  issue={issue}
                  lookups={lookups}
                  provider={provider}
                  employeeName={employeeName}
                  canResolve={resolve.can}
                  canConfigure={configure.can}
                  onChanged={() => {
                    remote.reload();
                    context.reloadStatus();
                  }}
                  onIgnore={() => setIgnoring(issue)}
                  onAssign={() => setAssigning(issue)}
                  onAccount={() => setAccountFor(issue)}
                  onAsk={
                    context.askAssistant
                      ? () => context.askAssistant?.(issue)
                      : undefined
                  }
                />
              ))}
            </ul>
          </section>
        ))
      )}
      <IgnoreDialog
        issue={ignoring}
        subject={ignoring ? issueSubject(ignoring, lookups) : ''}
        onClose={() => setIgnoring(null)}
        onIgnored={() => {
          setIgnoring(null);
          remote.reload();
        }}
      />
      <AssignDialog
        issue={assigning}
        subject={assigning ? issueSubject(assigning, lookups) : ''}
        lookups={lookups}
        employeeName={employeeName}
        onClose={() => setAssigning(null)}
        onAssigned={() => {
          setAssigning(null);
          remote.reload();
          context.reloadStatus();
        }}
      />
      <AccountDialog
        issue={accountFor}
        subject={accountFor ? issueSubject(accountFor, lookups) : ''}
        provider={provider}
        onClose={() => setAccountFor(null)}
        onCreated={() => {
          setAccountFor(null);
          remote.reload();
          employees.reload();
        }}
      />
    </div>
  );
}

function actionLink(key: string, type?: string): string {
  const search = new URLSearchParams({ fromIssue: key });
  if (type) search.set('type', type);
  return `/talent/actions/new?${search.toString()}`;
}

function IssueItem({
  issue,
  lookups,
  provider,
  employeeName,
  canResolve,
  canConfigure,
  onChanged,
  onIgnore,
  onAssign,
  onAccount,
  onAsk,
}: {
  issue: SyncIssue;
  lookups: Lookups;
  provider: string;
  employeeName: (id: string) => string | undefined;
  canResolve: boolean;
  canConfigure: boolean;
  onChanged: () => void;
  onIgnore: () => void;
  onAssign: () => void;
  onAccount: () => void;
  onAsk?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState(false);
  const open = issue.status === 'open';
  const subject = issueSubject(issue, lookups);

  async function post(
    path: string,
    json: Record<string, unknown>,
    done: string,
  ): Promise<void> {
    setBusy(true);
    try {
      await api.request({ path, method: 'POST', json });
      toast.add({ type: 'success', title: done });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  const buttons: ReactElement[] = [];
  if (open && canResolve) {
    if (issue.type === 'newMember')
      buttons.push(
        <Button
          key='onboard'
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link to={actionLink(issue.key)} />}
        >
          {t('orgSync.issues.onboard')}
        </Button>,
      );
    if (issue.type === 'orgMismatch') {
      const suggested =
        issue.detail.suggestedAction === 'promote' ? 'promote' : 'transfer';
      const order =
        suggested === 'promote'
          ? (['promote', 'transfer'] as const)
          : (['transfer', 'promote'] as const);
      for (const kind of order)
        buttons.push(
          <Button
            key={kind}
            variant='outline'
            size='sm'
            nativeButton={false}
            render={
              <Link
                to={actionLink(
                  issue.key,
                  kind === suggested ? undefined : kind,
                )}
              />
            }
          >
            {t(`orgSync.issues.${kind}`)}
            {kind === suggested ? (
              <Badge variant='secondary'>{t('orgSync.issues.suggested')}</Badge>
            ) : null}
          </Button>,
        );
    }
    if (issue.type === 'deactivatedMember')
      buttons.push(
        <Button
          key='offboard'
          variant='outline'
          size='sm'
          nativeButton={false}
          render={<Link to={actionLink(issue.key)} />}
        >
          {t('orgSync.issues.offboard')}
        </Button>,
      );
    if (issue.type === 'managerMismatch')
      buttons.push(
        <Button
          key='adopt'
          variant='outline'
          size='sm'
          disabled={busy}
          onClick={() =>
            void post(
              'talent/org-sync/issues/adopt-manager',
              { key: issue.key },
              t('orgSync.issues.adopted', { name: subject }),
            )
          }
        >
          {busy ? <Spinner data-icon='inline-start' /> : null}
          {t('orgSync.issues.adoptManager', { provider })}
        </Button>,
      );
  }
  if (open && issue.type === 'lockedChange' && canConfigure && issue.employeeId)
    buttons.push(
      <Button
        key='unlock'
        variant='outline'
        size='sm'
        disabled={busy}
        onClick={() =>
          void post(
            `talent/org-sync/employees/${encodeURIComponent(issue.employeeId!)}/lock`,
            { locked: false },
            t('orgSync.issues.unlocked', { name: subject }),
          )
        }
      >
        {busy ? <Spinner data-icon='inline-start' /> : null}
        {t('orgSync.issues.unlock')}
      </Button>,
    );
  if (open && issue.type === 'unmappedTitle' && text(issue.detail.title))
    buttons.push(
      <Button
        key='alias'
        variant='outline'
        size='sm'
        nativeButton={false}
        render={
          <Link
            to={`../aliases/new?${new URLSearchParams({ title: text(issue.detail.title) }).toString()}`}
          />
        }
      >
        {t('orgSync.issues.addAlias')}
      </Button>,
    );
  if (
    open &&
    canResolve &&
    (ASSIGNABLE_TYPES as readonly string[]).includes(issue.type)
  )
    buttons.push(
      <Button key='assign' variant='outline' size='sm' onClick={onAssign}>
        {t(`orgSync.assign.${issue.type}.action`)}
      </Button>,
    );
  if (open && canResolve && issue.type === 'noAccount' && issue.employeeId)
    buttons.push(
      <Button key='account' variant='outline' size='sm' onClick={onAccount}>
        {t('orgSync.account.action')}
      </Button>,
    );
  if (open && issue.type === 'noAccount' && issue.employeeId)
    buttons.push(
      <Button
        key='link'
        variant='outline'
        size='sm'
        nativeButton={false}
        render={
          <Link
            to={`/talent/employees/${encodeURIComponent(issue.employeeId)}/profile`}
          />
        }
      >
        {t('orgSync.issues.openEmployee')}
      </Button>,
    );
  if (open && issue.type === 'contractPending')
    buttons.push(
      <Button
        key='contracts'
        variant='outline'
        size='sm'
        nativeButton={false}
        render={<Link to='/talent/contracts' />}
      >
        {t('orgSync.issues.openContracts')}
      </Button>,
    );
  if (
    open &&
    (issue.type === 'departmentRemoved' ||
      issue.type === 'departmentAmbiguous' ||
      issue.type === 'unknownParentDepartment' ||
      issue.type === 'departmentManagerMismatch')
  )
    buttons.push(
      <Button
        key='departments'
        variant='outline'
        size='sm'
        nativeButton={false}
        render={<Link to='/settings/departments' />}
      >
        {t('orgSync.issues.openDepartments')}
      </Button>,
    );
  if (open && canResolve)
    buttons.push(
      <Button key='ignore' variant='ghost' size='sm' onClick={onIgnore}>
        {t('orgSync.issues.ignore')}
      </Button>,
    );
  if (onAsk)
    buttons.push(
      <Button key='ask' variant='ghost' size='sm' onClick={onAsk}>
        <SparklesIcon data-icon='inline-start' />
        {t('orgSync.assistant.askItem')}
      </Button>,
    );

  return (
    <li className='space-y-3 rounded-md border bg-card p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='font-medium'>{subject}</span>
        <Badge variant={open ? 'outline' : 'secondary'}>
          {t(`orgSync.issueStatus.${issue.status}`)}
        </Badge>
        {issue.status === 'inProgress' && issue.actionId ? (
          <Link
            className='text-sm text-primary underline-offset-4 hover:underline'
            to={`/talent/actions/${encodeURIComponent(issue.actionId)}`}
          >
            {t('orgSync.issues.viewAction')}
          </Link>
        ) : null}
      </div>
      <IssueDetails
        issue={issue}
        lookups={lookups}
        provider={provider}
        employeeName={employeeName}
      />
      {issue.aiExplanation ? (
        <div className='space-y-1 rounded-md bg-muted p-3 text-sm'>
          <p className='flex items-center gap-1 font-medium'>
            <SparklesIcon className='size-4' aria-hidden='true' />
            {t('orgSync.issues.aiTitle')}
          </p>
          <p className='whitespace-pre-line'>{issue.aiExplanation}</p>
          {issue.aiSuggestedAction ? (
            <p className='text-muted-foreground'>
              {t('orgSync.issues.aiSuggestion', {
                text: issue.aiSuggestedAction,
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {buttons.length ? (
        <div className='flex flex-wrap gap-2'>{buttons}</div>
      ) : null}
    </li>
  );
}

function IgnoreDialog({
  issue,
  subject,
  onClose,
  onIgnored,
}: {
  issue: SyncIssue | null;
  subject: string;
  onClose: () => void;
  onIgnored: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  async function submit(): Promise<void> {
    if (!issue) return;
    if (!reason.trim()) {
      setReasonError(t('orgSync.issues.reasonRequired'));
      fieldRef.current?.focus();
      return;
    }
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: 'talent/org-sync/issues/ignore',
        method: 'POST',
        json: { key: issue.key, reason: reason.trim() },
      });
      toast.add({
        type: 'success',
        title: t('orgSync.issues.ignored', { name: subject }),
      });
      setReason('');
      onIgnored();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={Boolean(issue)}
      onOpenChange={(next) => {
        if (pending || next) return;
        setReason('');
        setReasonError(undefined);
        setError(undefined);
        onClose();
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('orgSync.issues.ignoreTitle', { name: subject })}
          </DialogTitle>
          <DialogDescription>
            {issue ? t(`orgSync.issueType.${issue.type}.title`) : null}
          </DialogDescription>
        </DialogHeader>
        <form
          id='ignore-issue-form'
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <Field data-invalid={Boolean(reasonError)}>
              <FieldLabel htmlFor='ignore-reason'>
                {t('orgSync.issues.reason')} *
              </FieldLabel>
              <Textarea
                id='ignore-reason'
                ref={fieldRef}
                value={reason}
                maxLength={500}
                aria-invalid={Boolean(reasonError)}
                onBlur={() =>
                  setReasonError(
                    reason.trim()
                      ? undefined
                      : t('orgSync.issues.reasonRequired'),
                  )
                }
                onChange={(e) => {
                  setReason(e.target.value);
                  if (e.target.value.trim()) setReasonError(undefined);
                }}
              />
              {reasonError ? <FieldError>{reasonError}</FieldError> : null}
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() => {
              setReason('');
              setReasonError(undefined);
              setError(undefined);
              onClose();
            }}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='ignore-issue-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('orgSync.issues.ignoreConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
