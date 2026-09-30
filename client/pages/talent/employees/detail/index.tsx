import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  LinkIcon,
  PencilIcon,
  Trash2Icon,
  UserCogIcon,
  UserPlusIcon,
} from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
  Link,
  matchPath,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
  useParams,
  useResolvedPath,
} from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { EmployeeStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { EmployeeDetail } from '@/components/talent/types';
import { useLookups } from '@/components/talent/use-lookups';
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
import { Button, buttonVariants } from '@/components/ui/button';
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
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import { ResetPasswordButton } from './reset-password.js';
import { SyncLockSwitch } from './sync-lock.js';

import { EmployeeForm } from '../employee-form.js';
import type { EmployeesOutletContext } from '../types.js';
import type { DetailOutletContext } from './types.js';

/** Route `/talent/employees/:employeeId`: the employee record with its tabs as child routes. */
export default function EmployeeDetailPage(): ReactElement {
  const { employeeId = '' } = useParams();
  return <EmployeeDetailView key={employeeId} employeeId={employeeId} />;
}

function EmployeeDetailView({
  employeeId,
}: {
  employeeId: string;
}): ReactElement {
  const { t } = useTranslation();
  const location = useLocation();
  const parentPath = useResolvedPath('.');
  const list = useOutletContext<EmployeesOutletContext>();
  const lookups = useLookups();
  const detail = useRemote<EmployeeDetail>(
    `talent/employees/${encodeURIComponent(employeeId)}`,
  );
  const [editOpen, setEditOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  // V1-03 开通账号: the same action as the 组织同步 pending item, for a bound employee without a login.
  const resolveSync = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'resolveIssues',
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isParent =
    matchPath({ path: parentPath.pathname, end: true }, location.pathname) !==
    null;
  const reload = useMemo(
    () => () => {
      detail.reload();
      list.reload();
    },
    [detail, list],
  );
  const context = useMemo<DetailOutletContext | undefined>(
    () =>
      detail.data
        ? {
            detail: detail.data,
            departmentTitle:
              lookups.departmentTitle(detail.data.employee.departmentId) ||
              detail.data.departmentTitle,
            reload,
          }
        : undefined,
    [detail.data, lookups, reload],
  );

  if (isParent)
    return (
      <Navigate replace to={{ pathname: 'profile', search: location.search }} />
    );

  const tabs = [
    { path: 'profile', label: t('talent.detail.tabs.profile') },
    { path: 'abilities', label: t('talent.detail.tabs.abilities') },
    { path: 'performance', label: t('talent.detail.tabs.performance') },
    { path: 'portrait', label: t('talent.detail.tabs.portrait') },
    ...(detail.data?.can.viewContracts
      ? [{ path: 'contracts', label: t('talent.detail.tabs.contracts') }]
      : []),
    { path: 'events', label: t('talent.detail.tabs.events') },
  ];
  const data = detail.data;
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data || !context ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            <PageHeader
              title={
                <span className='flex flex-wrap items-center gap-3'>
                  {data.employee.name}
                  <EmployeeStatusBadge status={data.employee.status} />
                </span>
              }
              description={[
                data.employee.employeeNo,
                context.departmentTitle,
                data.positionTitle,
              ]
                .filter(Boolean)
                .join(' · ')}
              actions={
                <>
                  {data.can.linkUser ? (
                    <Button variant='outline' onClick={() => setLinkOpen(true)}>
                      <LinkIcon data-icon='inline-start' />
                      {data.employee.userId
                        ? t('talent.detail.relinkUser')
                        : t('talent.detail.linkUser')}
                    </Button>
                  ) : null}
                  <ResetPasswordButton detail={data} />
                  {resolveSync.can &&
                  !data.employee.userId &&
                  data.employee.externalUserId &&
                  data.employee.status !== 'leave' ? (
                    <Button
                      variant='outline'
                      onClick={() => setAccountOpen(true)}
                    >
                      <UserPlusIcon data-icon='inline-start' />
                      {t('talent.detail.accountFromProvider', {
                        provider: t(
                          `orgSync.provider.${data.employee.externalProvider ?? 'feishu'}`,
                        ),
                      })}
                    </Button>
                  ) : null}
                  {/* 更正任职信息 replaces step 1's "mark as left" (V1-02); it opens over the 档案 tab. */}
                  {data.can.correctJob ? (
                    <Button
                      variant='outline'
                      nativeButton={false}
                      render={
                        <Link
                          to={{
                            pathname: 'profile/correct-job',
                            search: location.search,
                          }}
                        />
                      }
                    >
                      <UserCogIcon data-icon='inline-start' />
                      {t('talent.detail.correctJob')}
                    </Button>
                  ) : null}
                  {data.can.delete ? (
                    <Button
                      variant='outline'
                      onClick={() => setDeleteOpen(true)}
                    >
                      <Trash2Icon data-icon='inline-start' />
                      {t('talent.detail.delete')}
                    </Button>
                  ) : null}
                  {data.can.update ? (
                    <Button onClick={() => setEditOpen(true)}>
                      <PencilIcon data-icon='inline-start' />
                      {t('talent.common.edit')}
                    </Button>
                  ) : null}
                </>
              }
            />
            <SyncLockSwitch detail={data} onChanged={detail.reload} />
            <nav
              aria-label={t('talent.detail.tabs.label')}
              className='flex flex-wrap gap-1 border-b pb-2'
            >
              {tabs.map((tab) => (
                <NavLink
                  key={tab.path}
                  className={cn(
                    buttonVariants({ variant: 'ghost', size: 'sm' }),
                    'text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground',
                  )}
                  to={{ pathname: tab.path, search: location.search }}
                >
                  {tab.label}
                </NavLink>
              ))}
            </nav>
            <Outlet context={context} />
            <EditDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              detail={data}
              onSaved={reload}
            />
            <DeleteDialog
              open={deleteOpen}
              onOpenChange={setDeleteOpen}
              detail={data}
              onDeleted={() => list.reload()}
            />
            <LinkUserDialog
              open={linkOpen}
              onOpenChange={setLinkOpen}
              detail={data}
              onSaved={reload}
            />
            <ProviderAccountDialog
              open={accountOpen}
              onOpenChange={setAccountOpen}
              detail={data}
              onCreated={reload}
            />
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function EditDialog({
  open,
  onOpenChange,
  detail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: EmployeeDetail;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (submittingRef.current) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className='max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>
            {t('talent.detail.editTitle', { name: detail.employee.name })}
          </DialogTitle>
          <DialogDescription>
            {detail.syncManaged
              ? t('talent.employees.syncManaged')
              : detail.coreFieldsLocked
                ? t('talent.employees.coreLocked')
                : t('talent.detail.editDescription')}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <EmployeeForm
            formId='employee-edit-form'
            employee={detail.employee}
            coreLocked={detail.coreFieldsLocked}
            syncManaged={detail.syncManaged === true}
            canEditSensitive={detail.can.viewSensitive && detail.can.viewNotes}
            onSubmittingChange={(value) => {
              submittingRef.current = value;
              setSubmitting(value);
            }}
            onSubmitted={() => {
              onOpenChange(false);
              onSaved();
            }}
          />
        ) : null}
        <DialogFooter>
          <Button
            variant='outline'
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='employee-edit-form' disabled={submitting}>
            {submitting ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({
  open,
  onOpenChange,
  detail,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: EmployeeDetail;
  onDeleted: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError(undefined);
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('talent.detail.deleteTitle', { name: detail.employee.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('talent.detail.deleteDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? <FieldError>{error}</FieldError> : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>
            {t('actions.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            variant='destructive'
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              setPending(true);
              api
                .request({
                  path: `talent/employees/${encodeURIComponent(detail.employee.id)}`,
                  method: 'DELETE',
                })
                .then(() => {
                  toast.add({
                    type: 'success',
                    title: t('talent.detail.deleteDone', {
                      name: detail.employee.name,
                    }),
                  });
                  onOpenChange(false);
                  onDeleted();
                  void navigate('/talent/employees');
                })
                .catch((cause: unknown) => setError(errorMessage(cause, t)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.detail.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function LinkUserDialog({
  open,
  onOpenChange,
  detail,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: EmployeeDetail;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [search, setSearch] = useState('');
  const users = useRemote<
    { id: string; name: string; email: string; username: string | null }[]
  >(open ? 'talent/users' : null, { search: search || undefined });
  const [userId, setUserId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function save(value: string | null): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/employees/${encodeURIComponent(detail.employee.id)}/link-user`,
        method: 'POST',
        json: { userId: value },
      });
      toast.add({
        type: 'success',
        title: value ? t('talent.detail.linked') : t('talent.detail.unlinked'),
      });
      onOpenChange(false);
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setUserId(detail.employee.userId ?? '');
          setSearch('');
          setError(undefined);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('talent.detail.linkTitle', { name: detail.employee.name })}
          </DialogTitle>
          <DialogDescription>
            {detail.userName
              ? t('talent.detail.currentUser', { name: detail.userName })
              : t('talent.detail.noUser')}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='link-search'>
              {t('talent.detail.searchUser')}
            </FieldLabel>
            <Input
              id='link-search'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('talent.detail.searchUserPlaceholder')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='link-user'>
              {t('talent.detail.user')}
            </FieldLabel>
            <NativeSelect
              id='link-user'
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
            >
              <NativeSelectOption value=''>
                {t('talent.common.choose')}
              </NativeSelectOption>
              {(users.data ?? []).map((u) => (
                <NativeSelectOption key={u.id} value={u.id}>
                  {u.name} · {u.username ?? u.email}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter>
          {detail.employee.userId ? (
            <Button
              variant='outline'
              disabled={pending}
              onClick={() => void save(null)}
            >
              {t('talent.detail.unlink')}
            </Button>
          ) : null}
          <Button
            disabled={pending || !userId}
            onClick={() => void save(userId)}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 使用飞书身份开通: creates a login for an employee bound to an office-suite
 * member and links it, through the 组织同步 endpoint. The email is sent only
 * when the member has none in the office suite.
 */
function ProviderAccountDialog({
  open,
  onOpenChange,
  detail,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  detail: EmployeeDetail;
  onCreated: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const provider = t(
    `orgSync.provider.${detail.employee.externalProvider ?? 'feishu'}`,
  );
  async function submit(): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/org-sync/employees/${encodeURIComponent(detail.employee.id)}/account`,
        method: 'POST',
        json: email.trim() ? { email: email.trim() } : {},
      });
      toast.add({
        type: 'success',
        title: t('orgSync.account.done', { name: detail.employee.name }),
      });
      onOpenChange(false);
      onCreated();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setEmail('');
          setError(undefined);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {t('orgSync.account.title', { name: detail.employee.name })}
          </DialogTitle>
          <DialogDescription>
            {t('orgSync.account.description', { provider })}
          </DialogDescription>
        </DialogHeader>
        <form
          id='provider-account-form'
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor='provider-account-email'>
                {t('orgSync.account.email')}
              </FieldLabel>
              <Input
                id='provider-account-email'
                type='email'
                autoComplete='off'
                value={email}
                maxLength={191}
                onChange={(e) => setEmail(e.target.value)}
              />
              <FieldDescription>
                {t('orgSync.account.emailHint', { provider })}
              </FieldDescription>
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            variant='outline'
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='provider-account-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('orgSync.account.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
