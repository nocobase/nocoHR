import { resolveAppUrl, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  FileIcon,
  MoreHorizontalIcon,
  PlusIcon,
  RefreshCcwIcon,
  UploadIcon,
  XCircleIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { ContractTable } from '@/components/talent/contract-table';
import { errorMessage } from '@/components/talent/errors';
import { uploadHrFile } from '@/components/talent/hr-file-upload';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import type { Contract, EmployeeListItem } from '@/components/talent/types';
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
import { Alert, AlertDescription } from '@/components/ui/alert';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

const CONTRACT_TYPES = [
  'fixedTerm',
  'openEnded',
  'internship',
  'labor',
] as const;
const QUICK = ['', 'expiring', 'overdue'] as const;

/** 合同管理 — employment contracts: sign, renew, terminate, and archive the scan. */
export default function ContractsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const quick = (QUICK as readonly string[]).includes(params.get('quick') ?? '')
    ? (params.get('quick') ?? '')
    : '';
  const list = useRemote<{
    items: Contract[];
    reminderDays: number;
    can: { manage: boolean };
  }>('talent/contracts', { quick: quick || undefined });
  const [editing, setEditing] = useState<{
    mode: 'create' | 'renew' | 'edit';
    contract: Contract | null;
  } | null>(null);
  const [terminating, setTerminating] = useState<Contract | null>(null);
  // The HR assistant's renewal preparation links here with ?renew=<contract id>: open that renewal once.
  const renewId = params.get('renew');
  const [handledRenew, setHandledRenew] = useState<string | null>(null);
  const [renewMissing, setRenewMissing] = useState(false);
  if (renewId && list.data && handledRenew !== renewId) {
    setHandledRenew(renewId);
    const target = list.data.items.find(
      (c) => c.id === renewId && c.status === 'active',
    );
    if (target && list.data.can.manage)
      setEditing({ mode: 'renew', contract: target });
    else setRenewMissing(true);
  }
  useEffect(() => {
    if (renewId && handledRenew === renewId)
      setParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('renew');
          return next;
        },
        { replace: true },
      );
  }, [renewId, handledRenew, setParams]);
  const uploadTargetRef = useRef<Contract | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File): Promise<void> {
    const contract = uploadTargetRef.current;
    if (!contract) return;
    try {
      const record = await uploadHrFile(api, file, 'contract');
      await api.request({
        path: `talent/contracts/${encodeURIComponent(contract.id)}/file`,
        method: 'POST',
        json: { fileId: String(record.id) },
      });
      toast.add({ type: 'success', title: t('talent.contracts.uploaded') });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.contracts.title')}
        description={t('talent.contracts.description')}
        actions={
          list.data?.can.manage ? (
            <Button
              onClick={() => setEditing({ mode: 'create', contract: null })}
            >
              <PlusIcon data-icon='inline-start' />
              {t('talent.contracts.create')}
            </Button>
          ) : null
        }
      />
      {renewMissing ? (
        <Alert>
          <AlertDescription>
            {t('talent.contracts.renewMissing')}
          </AlertDescription>
        </Alert>
      ) : null}
      <Tabs
        value={quick}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          if (value) next.set('quick', String(value));
          else next.delete('quick');
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          {QUICK.map((q) => (
            <TabsTrigger key={q || 'all'} value={q}>
              {q === 'expiring' && !list.data
                ? t('talent.contracts.quick.expiringLoading')
                : t(`talent.contracts.quick.${q || 'all'}`, {
                    days: list.data?.reminderDays,
                  })}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={5} />
      ) : (
        <ContractTable
          rows={list.data.items}
          showEmployee
          action={(row) => (
            <div className='flex items-center justify-end gap-1'>
              {row.filePath ? (
                <Button
                  variant='ghost'
                  size='icon-sm'
                  aria-label={t('talent.contracts.viewScan')}
                  nativeButton={false}
                  render={
                    <a
                      href={resolveAppUrl(row.filePath)}
                      target='_blank'
                      rel='noreferrer'
                    />
                  }
                >
                  <FileIcon />
                </Button>
              ) : null}
              {list.data?.can.manage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant='ghost'
                        size='icon-sm'
                        aria-label={t('talent.contracts.more', {
                          no: row.contractNo,
                        })}
                      />
                    }
                  >
                    <MoreHorizontalIcon />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end'>
                    <DropdownMenuGroup>
                      {row.status === 'active' || row.status === 'expired' ? (
                        <DropdownMenuItem
                          onClick={() =>
                            setEditing({ mode: 'renew', contract: row })
                          }
                        >
                          <RefreshCcwIcon />
                          {t('talent.contracts.renew')}
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem
                        onClick={() =>
                          setEditing({ mode: 'edit', contract: row })
                        }
                      >
                        {t('talent.common.edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => {
                          uploadTargetRef.current = row;
                          fileInputRef.current?.click();
                        }}
                      >
                        <UploadIcon />
                        {t('talent.contracts.uploadScan')}
                      </DropdownMenuItem>
                      {row.status === 'active' ? (
                        <DropdownMenuItem
                          variant='destructive'
                          onClick={() => setTerminating(row)}
                        >
                          <XCircleIcon />
                          {t('talent.contracts.terminate')}
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          )}
        />
      )}
      <input
        ref={fileInputRef}
        type='file'
        accept='.pdf,.jpg,.jpeg,.png'
        className='hidden'
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = '';
        }}
      />
      {editing ? (
        <ContractDialog
          mode={editing.mode}
          contract={editing.contract}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            list.reload();
          }}
        />
      ) : null}
      <AlertDialog
        open={terminating !== null}
        onOpenChange={(open) => !open && setTerminating(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.contracts.terminateTitle', {
                no: terminating?.contractNo ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.contracts.terminateDescription', {
                name: terminating?.employeeName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => {
                const target = terminating;
                setTerminating(null);
                if (!target) return;
                api
                  .request({
                    path: `talent/contracts/${encodeURIComponent(target.id)}/terminate`,
                    method: 'POST',
                    json: {},
                  })
                  .then(() => {
                    toast.add({
                      type: 'success',
                      title: t('talent.contracts.terminated'),
                    });
                    list.reload();
                  })
                  .catch((cause: unknown) =>
                    toast.add({ type: 'error', title: errorMessage(cause, t) }),
                  );
              }}
            >
              {t('talent.contracts.terminate')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}

function ContractDialog({
  mode,
  contract,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'renew' | 'edit';
  contract: Contract | null;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const employees = useRemote<{ items: EmployeeListItem[] }>(
    mode === 'create' ? 'talent/employees' : null,
  );
  const [draft, setDraft] = useState<Record<string, string>>(
    (): Record<string, string> => {
      if (mode === 'renew' && contract) {
        // Renewal starts the day after the previous contract ends and keeps its type.
        const start = contract.endDate
          ? new Date(
              new Date(`${contract.endDate}T00:00:00Z`).getTime() + 86_400_000,
            )
              .toISOString()
              .slice(0, 10)
          : new Date().toISOString().slice(0, 10);
        return {
          contractNo: '',
          type: contract.type,
          startDate: start,
          endDate: '',
          signedAt: new Date().toISOString().slice(0, 10),
          note: '',
        };
      }
      return {
        employeeId: contract?.employeeId ?? '',
        contractNo: contract?.contractNo ?? '',
        type: contract?.type ?? 'fixedTerm',
        startDate: contract?.startDate ?? '',
        endDate: contract?.endDate ?? '',
        signedAt: contract?.signedAt ?? '',
        note: contract?.note ?? '',
      };
    },
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const set = (key: string, value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  async function save(): Promise<void> {
    if (
      (mode === 'create' && !draft.employeeId) ||
      !draft.contractNo.trim() ||
      !draft.startDate
    ) {
      setError(t('talent.form.required'));
      return;
    }
    setPending(true);
    setError(undefined);
    const json = Object.fromEntries(
      Object.entries(draft).map(([k, v]) => [k, v.trim() || null]),
    );
    try {
      await api.request({
        path:
          mode === 'create'
            ? 'talent/contracts'
            : mode === 'renew'
              ? `talent/contracts/${encodeURIComponent(contract!.id)}/renew`
              : `talent/contracts/${encodeURIComponent(contract!.id)}`,
        method: mode === 'edit' ? 'PATCH' : 'POST',
        json,
      });
      toast.add({
        type: 'success',
        title:
          mode === 'renew'
            ? t('talent.contracts.renewed')
            : t('talent.contracts.saved'),
      });
      onSaved();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create'
              ? t('talent.contracts.create')
              : mode === 'renew'
                ? t('talent.contracts.renewTitle', {
                    no: contract?.contractNo ?? '',
                  })
                : t('talent.contracts.editTitle', {
                    no: contract?.contractNo ?? '',
                  })}
          </DialogTitle>
          {mode === 'renew' ? (
            <DialogDescription>
              {t('talent.contracts.renewDescription', {
                name: contract?.employeeName ?? '',
              })}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        <form
          id='contract-form'
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <FieldGroup>
            {mode === 'create' ? (
              <Field>
                <FieldLabel htmlFor='contract-employee'>
                  {t('talent.actions.employee')}
                </FieldLabel>
                <NativeSelect
                  id='contract-employee'
                  value={draft.employeeId}
                  onChange={(e) => set('employeeId', e.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.choose')}
                  </NativeSelectOption>
                  {(employees.data?.items ?? [])
                    .filter((e) => e.status !== 'leave')
                    .map((e) => (
                      <NativeSelectOption key={e.id} value={e.id}>
                        {e.name} ({e.employeeNo})
                      </NativeSelectOption>
                    ))}
                </NativeSelect>
              </Field>
            ) : null}
            <div className='grid gap-4 sm:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='contract-no'>
                  {t('talent.contracts.contractNo')}
                </FieldLabel>
                <Input
                  id='contract-no'
                  value={draft.contractNo}
                  onChange={(e) => set('contractNo', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='contract-type'>
                  {t('talent.contracts.type')}
                </FieldLabel>
                <NativeSelect
                  id='contract-type'
                  value={draft.type}
                  onChange={(e) => set('type', e.target.value)}
                >
                  {CONTRACT_TYPES.map((v) => (
                    <NativeSelectOption key={v} value={v}>
                      {t(`talent.contractType.${v}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='contract-start'>
                  {t('talent.contracts.startDate')}
                </FieldLabel>
                <Input
                  id='contract-start'
                  type='date'
                  value={draft.startDate}
                  onChange={(e) => set('startDate', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='contract-end'>
                  {t('talent.contracts.endDate')}
                </FieldLabel>
                <Input
                  id='contract-end'
                  type='date'
                  value={draft.endDate}
                  disabled={draft.type === 'openEnded'}
                  onChange={(e) => set('endDate', e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='contract-signed'>
                  {t('talent.contracts.signedAt')}
                </FieldLabel>
                <Input
                  id='contract-signed'
                  type='date'
                  value={draft.signedAt}
                  onChange={(e) => set('signedAt', e.target.value)}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor='contract-note'>
                {t('talent.fields.note')}
              </FieldLabel>
              <Textarea
                id='contract-note'
                value={draft.note}
                onChange={(e) => set('note', e.target.value)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={onClose}>
            {t('actions.cancel')}
          </Button>
          <Button type='submit' form='contract-form' disabled={pending}>
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {mode === 'renew' ? t('talent.contracts.renew') : t('actions.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
