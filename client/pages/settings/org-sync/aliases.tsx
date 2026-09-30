import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { MoreHorizontalIcon, PlusIcon, RefreshCwIcon } from 'lucide-react';
import { useMemo, useState, type ReactElement } from 'react';
import { Link, Outlet, useOutletContext } from 'react-router';

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
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FieldError } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from '@/components/ui/toast';

import { runToast } from './helpers.js';
import type { OrgSyncOutletContext, PositionAlias, SyncRun } from './types.js';

export interface AliasesOutletContext {
  readonly aliases: PositionAlias[] | undefined;
  readonly reload: () => void;
  /** The configured provider, the default for a new mapping. */
  readonly provider: string | undefined;
}

/**
 * Tab 职务映射: office-suite job titles mapped to NocoHR positions. Drafts the
 * HR assistant wrote wait for confirmation; confirming one or several, fixing
 * the position first, or discarding them are the page's actions. 按新映射重新处理
 * runs a full sync so affected members are compared again.
 */
export default function OrgSyncAliasesTab(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const sync = useOutletContext<OrgSyncOutletContext>();
  const remote = useRemote<PositionAlias[]>('talent/position-aliases', {
    refresh: sync.epoch,
  });
  const manage = useCan({
    resource: { type: 'composite', id: 'talent.positionAlias' },
    action: 'manage',
  });
  const confirmGrant = useCan({
    resource: { type: 'composite', id: 'talent.positionAlias' },
    action: 'confirm',
  });
  const runGrant = useCan({
    resource: { type: 'composite', id: 'talent.orgSync' },
    action: 'run',
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [reprocessing, setReprocessing] = useState(false);
  const [removing, setRemoving] = useState<PositionAlias[] | null>(null);
  const rows = remote.data;
  const number = new Intl.NumberFormat(locale);
  const context = useMemo<AliasesOutletContext>(
    () => ({
      aliases: rows,
      reload: remote.reload,
      provider: sync.status?.settings.value.provider,
    }),
    [rows, remote.reload, sync.status],
  );
  const selectedRows = (rows ?? []).filter((r) => selected.includes(r.id));
  const selectedDrafts = selectedRows.filter((r) => r.reviewStatus === 'draft');

  async function confirm(ids: string[]): Promise<void> {
    setBusy(true);
    try {
      await api.request({
        path: 'talent/position-aliases/confirm',
        method: 'POST',
        json: { ids },
      });
      toast.add({
        type: 'success',
        title: t('orgSync.aliases.confirmed', { count: ids.length }),
      });
      setSelected([]);
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  async function reprocess(): Promise<void> {
    setReprocessing(true);
    try {
      const { data } = await api.request<{ data: SyncRun }>({
        path: 'talent/position-aliases/reprocess',
        method: 'POST',
      });
      toast.add(runToast(data, t));
      sync.reloadStatus();
      sync.bump();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setReprocessing(false);
    }
  }

  const toolbar = (
    <div className='flex flex-wrap items-center gap-2'>
      {manage.can ? (
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to='new' />}
        >
          <PlusIcon data-icon='inline-start' />
          {t('orgSync.aliases.create')}
        </Button>
      ) : null}
      {runGrant.can ? (
        <Button
          variant='outline'
          disabled={reprocessing}
          onClick={() => void reprocess()}
        >
          {reprocessing ? (
            <Spinner data-icon='inline-start' />
          ) : (
            <RefreshCwIcon data-icon='inline-start' />
          )}
          {t('orgSync.aliases.reprocess')}
        </Button>
      ) : null}
      {selectedRows.length ? (
        <>
          <span className='text-sm text-muted-foreground'>
            {t('orgSync.aliases.selected', { count: selectedRows.length })}
          </span>
          {confirmGrant.can && selectedDrafts.length ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void confirm(selectedDrafts.map((r) => r.id))}
            >
              {t('orgSync.aliases.confirmSelected', {
                count: selectedDrafts.length,
              })}
            </Button>
          ) : null}
          {manage.can ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => setRemoving(selectedRows)}
            >
              {t('orgSync.aliases.removeSelected', {
                count: selectedRows.length,
              })}
            </Button>
          ) : null}
        </>
      ) : null}
      {remote.loading && rows ? (
        <Spinner aria-label={t('status.loading')} />
      ) : null}
    </div>
  );

  return (
    <div className='space-y-4'>
      <p className='text-sm text-muted-foreground'>
        {t('orgSync.aliases.description')}
      </p>
      {toolbar}
      {remote.error && !rows ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : !rows ? (
        <BlockSkeleton rows={5} />
      ) : !rows.length ? (
        <EmptyState
          title={t('orgSync.aliases.empty')}
          description={t('orgSync.aliases.emptyDescription')}
        />
      ) : (
        <div className='overflow-x-auto rounded-md border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className='w-10'>
                  <Checkbox
                    aria-label={t('orgSync.aliases.selectAll')}
                    checked={
                      selected.length > 0 && selected.length === rows.length
                    }
                    onCheckedChange={(checked) =>
                      setSelected(checked ? rows.map((r) => r.id) : [])
                    }
                  />
                </TableHead>
                <TableHead>{t('orgSync.aliases.externalTitle')}</TableHead>
                <TableHead>{t('orgSync.aliases.provider')}</TableHead>
                <TableHead>{t('orgSync.aliases.position')}</TableHead>
                <TableHead>{t('orgSync.aliases.source')}</TableHead>
                <TableHead>{t('orgSync.aliases.status')}</TableHead>
                <TableHead className='text-right'>
                  {t('orgSync.aliases.headcount')}
                </TableHead>
                <TableHead className='w-24'>
                  <span className='sr-only'>{t('talent.common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const draft = row.reviewStatus === 'draft';
                return (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Checkbox
                        aria-label={t('orgSync.aliases.select', {
                          title: row.externalTitle,
                        })}
                        checked={selected.includes(row.id)}
                        onCheckedChange={(checked) =>
                          setSelected((current) =>
                            checked
                              ? [...current, row.id]
                              : current.filter((id) => id !== row.id),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className='whitespace-normal'>
                      <p className='font-medium'>{row.externalTitle}</p>
                      {draft && row.draftReason ? (
                        <p className='text-xs text-muted-foreground'>
                          {t('orgSync.aliases.draftReason', {
                            reason: row.draftReason,
                          })}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {t(`orgSync.provider.${row.provider}`, {
                        defaultValue: row.provider,
                      })}
                    </TableCell>
                    <TableCell>{row.positionTitle ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant='outline'>
                        {t(`orgSync.aliasSource.${row.source}`)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={draft ? 'outline' : 'secondary'}>
                        {t(`orgSync.aliasStatus.${row.reviewStatus}`)}
                      </Badge>
                    </TableCell>
                    <TableCell className='text-right tabular-nums'>
                      {number.format(row.headcount)}
                    </TableCell>
                    <TableCell>
                      <div className='flex items-center justify-end gap-1'>
                        {draft && confirmGrant.can ? (
                          <Button
                            variant='outline'
                            size='sm'
                            disabled={busy}
                            onClick={() => void confirm([row.id])}
                          >
                            {t('orgSync.aliases.confirm')}
                          </Button>
                        ) : null}
                        {manage.can ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              render={
                                <Button
                                  size='icon-sm'
                                  variant='ghost'
                                  aria-label={t('talent.common.actions')}
                                />
                              }
                            >
                              <MoreHorizontalIcon />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align='end'>
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  render={
                                    <Link
                                      to={`${encodeURIComponent(row.id)}/edit${draft && confirmGrant.can ? '?confirm=1' : ''}`}
                                    />
                                  }
                                >
                                  {t(
                                    draft && confirmGrant.can
                                      ? 'orgSync.aliases.editConfirm'
                                      : 'orgSync.aliases.edit',
                                  )}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                              <DropdownMenuSeparator />
                              <DropdownMenuGroup>
                                <DropdownMenuItem
                                  variant='destructive'
                                  onClick={() => setRemoving([row])}
                                >
                                  {t(
                                    draft
                                      ? 'orgSync.aliases.discard'
                                      : 'orgSync.aliases.remove',
                                  )}
                                </DropdownMenuItem>
                              </DropdownMenuGroup>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <RemoveDialog
        rows={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          setSelected([]);
          remote.reload();
        }}
      />
      <Outlet context={context} />
    </div>
  );
}

function RemoveDialog({
  rows,
  onClose,
  onRemoved,
}: {
  rows: PositionAlias[] | null;
  onClose: () => void;
  onRemoved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const single = rows?.length === 1 ? rows[0] : undefined;
  const allDrafts = Boolean(rows?.every((r) => r.reviewStatus === 'draft'));
  return (
    <AlertDialog
      open={Boolean(rows)}
      onOpenChange={(next) => {
        if (pending || next) return;
        setError(undefined);
        onClose();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {single
              ? t(
                  allDrafts
                    ? 'orgSync.aliases.discardTitle'
                    : 'orgSync.aliases.removeTitle',
                  { title: single.externalTitle },
                )
              : t('orgSync.aliases.removeManyTitle', {
                  count: rows?.length ?? 0,
                })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t('orgSync.aliases.removeDescription')}
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
              if (!rows) return;
              setPending(true);
              setError(undefined);
              api
                .request({
                  path: 'talent/position-aliases/remove',
                  method: 'POST',
                  json: { ids: rows.map((r) => r.id) },
                })
                .then(() => {
                  toast.add({
                    type: 'success',
                    title: t('orgSync.aliases.removed', { count: rows.length }),
                  });
                  onRemoved();
                })
                .catch((cause: unknown) => setError(errorMessage(cause, t)))
                .finally(() => setPending(false));
            }}
          >
            {pending ? <Spinner data-icon='inline-start' /> : null}
            {t(
              allDrafts ? 'orgSync.aliases.discard' : 'orgSync.aliases.remove',
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
