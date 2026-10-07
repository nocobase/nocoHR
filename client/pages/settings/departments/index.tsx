import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { BanIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, RotateCcwIcon, SearchIcon, StarIcon, Trash2Icon, UploadIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { compactValues, customFieldErrors, useCustomFieldDefinitions, type CustomValues } from '@/components/talent/custom-field-model';
import { CustomFieldInputs, CustomFieldValues } from '@/components/talent/custom-fields';
import { errorCode, errorDetails, errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { titleText } from '@/components/talent/titles';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface Department {
  id: string;
  code: string | null;
  title: string;
  parentId: string | null;
  managerId: string | null;
  managerName: string | null;
  active: boolean;
  sortOrder: number;
  /** 界面追加字段 (e.g. a store's number or a ward's bed count). */
  customFields?: CustomValues;
}

interface Member {
  userId: string;
  primary: boolean;
  name: string;
  email: string | null;
}

interface UserOption {
  id: string;
  name: string;
  email: string;
  username: string | null;
}

/**
 * 组织管理 — the department tree, heads and memberships. Permission sets are
 * assigned to departments in Settings → Authorization, not here.
 */
export default function DepartmentsSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const canUpdate = useCan({ resource: { type: 'settings', id: 'talent.departments' }, action: 'update' }).can;
  // 初始数据导入: the department tree from Excel, a child page (./import.tsx).
  const canImport = useCan({ resource: { type: 'settings', id: 'talent.departments' }, action: 'import' }).can;
  const tree = useRemote<Department[]>('talent/org/departments');
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<{ mode: 'create' | 'edit'; parentId: string | null; department: Department | null } | null>(null);
  const departments = useMemo(() => tree.data ?? [], [tree.data]);
  const selectedId = params.get('department') ?? departments.find((d) => !d.parentId)?.id ?? null;
  const selected = departments.find((d) => d.id === selectedId);
  const label = (d: Department) => titleText(d.title, t);

  async function toggle(department: Department): Promise<void> {
    try {
      await api.request({ path: `talent/org/departments/${encodeURIComponent(department.id)}/active`, method: 'POST', json: { active: !department.active } });
      toast.add({ type: 'success', title: department.active ? t('talent.org.disabled', { title: label(department) }) : t('talent.org.enabled', { title: label(department) }) });
      tree.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.org.title')}
        description={t('talent.org.description')}
        actions={
          <>
            {canImport ? (
              <Button variant='outline' nativeButton={false} render={<Link to='import' />}>
                <UploadIcon data-icon='inline-start' />
                {t('dataImport.open')}
              </Button>
            ) : null}
            {canUpdate ? (
              <Button onClick={() => setDialog({ mode: 'create', parentId: selected?.id ?? null, department: null })}>
                <PlusIcon data-icon='inline-start' />
                {selected ? t('talent.org.createChild') : t('talent.org.create')}
              </Button>
            ) : null}
          </>
        }
      />
      {tree.error ? (
        <LoadError error={tree.error} onRetry={tree.reload} />
      ) : !tree.data ? (
        <BlockSkeleton rows={6} />
      ) : !departments.length ? (
        <EmptyState title={t('talent.org.empty')} />
      ) : (
        <div className='grid gap-4 lg:grid-cols-[20rem_1fr]'>
          <Card className='h-fit'>
            <CardHeader>
              <InputGroup>
                <InputGroupAddon>
                  <SearchIcon />
                </InputGroupAddon>
                <InputGroupInput aria-label={t('talent.org.search')} placeholder={t('talent.org.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </InputGroup>
            </CardHeader>
            <CardContent>
              <ul className='space-y-0.5'>
                {departments
                  .filter((d) => !d.parentId || !departments.some((p) => p.id === d.parentId))
                  .map((root) => (
                    <DepartmentNode
                      key={root.id}
                      department={root}
                      all={departments}
                      depth={0}
                      search={search.trim().toLowerCase()}
                      selectedId={selectedId}
                      label={label}
                      onSelect={(id) => {
                        const next = new URLSearchParams(params);
                        next.set('department', id);
                        setParams(next, { replace: true });
                      }}
                    />
                  ))}
              </ul>
            </CardContent>
          </Card>
          {selected ? (
            <DepartmentPanel
              key={selected.id}
              department={selected}
              departments={departments}
              label={label}
              canUpdate={canUpdate}
              onEdit={() => setDialog({ mode: 'edit', parentId: selected.parentId, department: selected })}
              onToggle={() => void toggle(selected)}
            />
          ) : (
            <EmptyState title={t('talent.org.pick')} />
          )}
        </div>
      )}
      {dialog ? (
        <DepartmentDialog
          mode={dialog.mode}
          parentId={dialog.parentId}
          department={dialog.department}
          departments={departments}
          label={label}
          onClose={() => setDialog(null)}
          onSaved={(id) => {
            setDialog(null);
            tree.reload();
            const next = new URLSearchParams(params);
            next.set('department', id);
            setParams(next, { replace: true });
          }}
        />
      ) : null}
      <Outlet context={{ reload: tree.reload }} />
    </PageContainer>
  );
}

function DepartmentNode({ department, all, depth, search, selectedId, label, onSelect }: { department: Department; all: Department[]; depth: number; search: string; selectedId: string | null; label: (d: Department) => string; onSelect: (id: string) => void }): ReactElement | null {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const children = all.filter((d) => d.parentId === department.id).sort((a, b) => a.sortOrder - b.sortOrder);
  const matches = (d: Department): boolean => label(d).toLowerCase().includes(search) || (d.code ?? '').toLowerCase().includes(search) || all.filter((c) => c.parentId === d.id).some(matches);
  if (search && !matches(department)) return null;
  return (
    <li>
      <div className={cn('flex items-center rounded-md hover:bg-muted', selectedId === department.id && 'bg-muted')} style={{ paddingLeft: `${depth}rem` }}>
        <button type='button' className='flex size-7 shrink-0 items-center justify-center text-muted-foreground' aria-label={open ? t('talent.common.collapse') : t('talent.common.expand')} disabled={!children.length} onClick={() => setOpen(!open)}>
          {children.length ? open ? <ChevronDownIcon className='size-4' /> : <ChevronRightIcon className='size-4' /> : null}
        </button>
        <button type='button' className={cn('min-w-0 flex-1 truncate py-1.5 pr-2 text-left text-sm', selectedId === department.id && 'font-medium', !department.active && 'text-muted-foreground line-through')} onClick={() => onSelect(department.id)}>
          {label(department)}
        </button>
      </div>
      {open && children.length ? (
        <ul className='space-y-0.5'>
          {children.map((child) => (
            <DepartmentNode key={child.id} department={child} all={all} depth={depth + 1} search={search} selectedId={selectedId} label={label} onSelect={onSelect} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DepartmentPanel({ department, departments, label, canUpdate, onEdit, onToggle }: { department: Department; departments: Department[]; label: (d: Department) => string; canUpdate: boolean; onEdit: () => void; onToggle: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const members = useRemote<Member[]>(`talent/org/departments/${encodeURIComponent(department.id)}/members`);
  const { definitions } = useCustomFieldDefinitions('departments', 'detail', true);
  const [adding, setAdding] = useState(false);
  const parent = departments.find((d) => d.id === department.parentId);
  const inactiveAncestor = (() => {
    let cursor = parent;
    while (cursor) {
      if (!cursor.active) return cursor;
      cursor = departments.find((d) => d.id === cursor!.parentId);
    }
    return undefined;
  })();

  async function memberAction(path: string, method: 'POST' | 'DELETE', success: string): Promise<void> {
    try {
      await api.request({ path, method });
      toast.add({ type: 'success', title: success });
      members.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader className='flex flex-row flex-wrap items-start justify-between gap-3'>
          <div>
            <CardTitle className='flex items-center gap-2'>
              {label(department)}
              {!department.active ? <Badge variant='outline'>{t('talent.common.disabled')}</Badge> : inactiveAncestor ? <Badge variant='outline'>{t('talent.org.inactiveAncestor', { title: label(inactiveAncestor) })}</Badge> : null}
            </CardTitle>
            <CardDescription>{[department.code, parent ? label(parent) : t('talent.org.root')].filter(Boolean).join(' · ')}</CardDescription>
          </div>
          {canUpdate ? (
            <div className='flex gap-2'>
              <Button variant='outline' size='sm' onClick={onEdit}>
                {t('talent.common.edit')}
              </Button>
              <Button variant='outline' size='sm' onClick={onToggle}>
                {department.active ? <BanIcon data-icon='inline-start' /> : <RotateCcwIcon data-icon='inline-start' />}
                {department.active ? t('talent.common.disable') : t('talent.common.enable')}
              </Button>
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <dl className='grid grid-cols-2 gap-4 text-sm sm:grid-cols-3'>
            <div>
              <dt className='text-xs text-muted-foreground'>{t('talent.org.head')}</dt>
              <dd>{department.managerName ?? '—'}</dd>
            </div>
            <div>
              <dt className='text-xs text-muted-foreground'>{t('talent.framework.code')}</dt>
              <dd>{department.code ?? '—'}</dd>
            </div>
            <div>
              <dt className='text-xs text-muted-foreground'>{t('talent.org.parent')}</dt>
              <dd>{parent ? label(parent) : '—'}</dd>
            </div>
          </dl>
          {definitions.length ? (
            <div className='mt-4 border-t pt-4'>
              <CustomFieldValues definitions={definitions} values={department.customFields} />
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className='flex flex-row items-center justify-between gap-3'>
          <div>
            <CardTitle>{t('talent.org.members')}</CardTitle>
            <CardDescription>{t('talent.org.membersDescription')}</CardDescription>
          </div>
          {canUpdate ? (
            <Button size='sm' variant='outline' onClick={() => setAdding(true)}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.org.addMember')}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {members.error ? (
            <LoadError error={members.error} onRetry={members.reload} />
          ) : !members.data ? (
            <BlockSkeleton rows={3} />
          ) : !members.data.length ? (
            <p className='text-sm text-muted-foreground'>{t('talent.org.noMembers')}</p>
          ) : (
            <div className='overflow-x-auto rounded-md border'>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('talent.fields.name')}</TableHead>
                    <TableHead>{t('talent.fields.email')}</TableHead>
                    <TableHead>{t('talent.org.primary')}</TableHead>
                    {canUpdate ? <TableHead className='text-right'>{t('talent.common.actions')}</TableHead> : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {members.data.map((m) => (
                    <TableRow key={m.userId}>
                      <TableCell className='font-medium'>{m.name}</TableCell>
                      <TableCell className='text-muted-foreground'>{m.email ?? '—'}</TableCell>
                      <TableCell>{m.primary ? <Badge variant='secondary'>{t('talent.org.primary')}</Badge> : null}</TableCell>
                      {canUpdate ? (
                        <TableCell className='text-right'>
                          <div className='flex justify-end gap-1'>
                            {!m.primary ? (
                              <Button variant='ghost' size='icon-sm' aria-label={t('talent.org.setPrimary')} onClick={() => void memberAction(`talent/org/departments/${encodeURIComponent(department.id)}/members/${encodeURIComponent(m.userId)}/primary`, 'POST', t('talent.org.primarySet'))}>
                                <StarIcon />
                              </Button>
                            ) : null}
                            <Button variant='ghost' size='icon-sm' aria-label={t('talent.common.remove')} onClick={() => void memberAction(`talent/org/departments/${encodeURIComponent(department.id)}/members/${encodeURIComponent(m.userId)}`, 'DELETE', t('talent.org.memberRemoved'))}>
                              <Trash2Icon />
                            </Button>
                          </div>
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      {adding ? <AddMemberDialog departmentId={department.id} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); members.reload(); }} /> : null}
    </div>
  );
}

function UserPicker({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }): ReactElement {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const users = useRemote<UserOption[]>('talent/users', { search: search || undefined });
  return (
    <div className='grid gap-2 sm:grid-cols-2'>
      <Input aria-label={t('talent.detail.searchUser')} placeholder={t('talent.detail.searchUserPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
      <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <NativeSelectOption value=''>{t('talent.common.none')}</NativeSelectOption>
        {(users.data ?? []).map((u) => (
          <NativeSelectOption key={u.id} value={u.id}>
            {u.name} · {u.username ?? u.email}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}

function AddMemberDialog({ departmentId, onClose, onSaved }: { departmentId: string; onClose: () => void; onSaved: () => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [userId, setUserId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{t('talent.org.addMember')}</DialogTitle>
          <DialogDescription>{t('talent.org.addMemberDescription')}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor='member-user'>{t('talent.detail.user')}</FieldLabel>
            <UserPicker id='member-user' value={userId} onChange={setUserId} />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={pending || !userId}
            onClick={() => {
              setPending(true);
              api
                .request({ path: `talent/org/departments/${encodeURIComponent(departmentId)}/members`, method: 'POST', json: { userId } })
                .then(() => {
                  toast.add({ type: 'success', title: t('talent.org.memberAdded') });
                  onSaved();
                })
                .catch((cause: unknown) => setError(errorMessage(cause, t)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('talent.common.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DepartmentDialog({ mode, parentId, department, departments, label, onClose, onSaved }: { mode: 'create' | 'edit'; parentId: string | null; department: Department | null; departments: Department[]; label: (d: Department) => string; onClose: () => void; onSaved: (id: string) => void }): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [draft, setDraft] = useState({
    title: department ? label(department) : '',
    code: department?.code ?? '',
    parentId: department ? (department.parentId ?? '') : (parentId ?? ''),
    managerId: department?.managerId ?? '',
  });
  const { definitions } = useCustomFieldDefinitions('departments', 'form');
  const [custom, setCustom] = useState<CustomValues>(() => department?.customFields ?? {});
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  async function save(): Promise<void> {
    if (!draft.title.trim()) {
      setError(t('talent.form.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    setCustomErrors({});
    try {
      // A seeded title is a translation descriptor; keep it unless the text was actually changed.
      const titleChanged = !department || draft.title.trim() !== label(department);
      const { data } = await api.request<{ data: { id: string } }>({
        path: department ? `talent/org/departments/${encodeURIComponent(department.id)}` : 'talent/org/departments',
        method: department ? 'PATCH' : 'POST',
        json: { ...(titleChanged ? { title: draft.title.trim() } : {}), code: draft.code.trim() || null, parentId: draft.parentId || null, managerId: draft.managerId || null, ...(definitions.length ? { customFields: compactValues(custom) } : {}) },
      });
      toast.add({ type: 'success', title: t('talent.org.saved') });
      onSaved(data.id);
    } catch (cause) {
      setError(errorMessage(cause, t));
      if (errorCode(cause) === 'CUSTOM_FIELD_INVALID') setCustomErrors(customFieldErrors(errorDetails(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? t('talent.org.create') : t('talent.org.edit')}</DialogTitle>
        </DialogHeader>
        <form
          id='department-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='dept-title'>{t('talent.framework.titleField')}</FieldLabel>
                <Input id='dept-title' value={draft.title} maxLength={200} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor='dept-code'>{t('talent.framework.code')}</FieldLabel>
                <Input id='dept-code' value={draft.code} maxLength={64} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor='dept-parent'>{t('talent.org.parent')}</FieldLabel>
              <NativeSelect id='dept-parent' value={draft.parentId} onChange={(e) => setDraft((d) => ({ ...d, parentId: e.target.value }))}>
                <NativeSelectOption value=''>{t('talent.org.root')}</NativeSelectOption>
                {departments.filter((d) => d.id !== department?.id).map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {label(d)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor='dept-head'>{t('talent.org.head')}</FieldLabel>
              <UserPicker id='dept-head' value={draft.managerId} onChange={(value) => setDraft((d) => ({ ...d, managerId: value }))} />
            </Field>
            <CustomFieldInputs definitions={definitions} values={custom} onChange={setCustom} errors={customErrors} disabled={pending} idPrefix='dept-custom' />
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='department-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
