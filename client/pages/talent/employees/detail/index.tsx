import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { LinkIcon, LogOutIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { useMemo, useRef, useState, type ReactElement } from 'react';
import {
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

import { EmployeeForm } from '../employee-form.js';
import { LEAVE_REASONS, type EmployeesOutletContext } from '../types.js';
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
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
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
                  {data.can.markLeave && data.employee.status !== 'leave' ? (
                    <Button
                      variant='outline'
                      onClick={() => setLeaveOpen(true)}
                    >
                      <LogOutIcon data-icon='inline-start' />
                      {t('talent.detail.markLeave')}
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
            <LeaveDialog
              open={leaveOpen}
              onOpenChange={setLeaveOpen}
              detail={data}
              onSaved={reload}
            />
            <LinkUserDialog
              open={linkOpen}
              onOpenChange={setLinkOpen}
              detail={data}
              onSaved={reload}
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
            {detail.coreFieldsLocked
              ? t('talent.employees.coreLocked')
              : t('talent.detail.editDescription')}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <EmployeeForm
            formId='employee-edit-form'
            employee={detail.employee}
            coreLocked={detail.coreFieldsLocked}
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

function LeaveDialog({
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
  const [leaveDate, setLeaveDate] = useState('');
  const [leaveReason, setLeaveReason] = useState('resign');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (next) {
          setLeaveDate(new Date().toISOString().slice(0, 10));
          setError(undefined);
        }
        onOpenChange(next);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('talent.detail.leaveTitle', { name: detail.employee.name })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('talent.detail.leaveDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='leave-date'>
              {t('talent.fields.leaveDate')}
            </FieldLabel>
            <Input
              id='leave-date'
              type='date'
              value={leaveDate}
              onChange={(e) => setLeaveDate(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='leave-reason'>
              {t('talent.fields.leaveReason')}
            </FieldLabel>
            <NativeSelect
              id='leave-reason'
              value={leaveReason}
              onChange={(e) => setLeaveReason(e.target.value)}
            >
              {LEAVE_REASONS.map((r) => (
                <NativeSelectOption key={r} value={r}>
                  {t(`talent.leaveReason.${r}`)}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
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
                  path: `talent/employees/${encodeURIComponent(detail.employee.id)}/mark-leave`,
                  method: 'POST',
                  json: { leaveDate, leaveReason },
                })
                .then(() => {
                  toast.add({
                    type: 'success',
                    title: t('talent.detail.leaveDone', {
                      name: detail.employee.name,
                    }),
                  });
                  onOpenChange(false);
                  onSaved();
                })
                .catch((cause: unknown) => setError(errorMessage(cause, t)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.detail.markLeave')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Deleting undoes a mistaken import: only without a login account and when nothing references the record. */
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
