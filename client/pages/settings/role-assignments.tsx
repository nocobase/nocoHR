import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useTranslation } from '@nocobase/i18n/client';
import {
  useAuthorizationClient,
  type AuthorizationOptionsResponse,
  type LocalizedText,
  type SubjectOption,
} from '@nocobase/app-plugin-authorization/client';
import { RouteDrawer } from '#components/route-drawer';
import { Button } from '#components/ui/button';
import { Input } from '#components/ui/input';
import { Label } from '#components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '#components/ui/select';
import { useSettingsData, useRolePermission } from './hooks.js';
import { ConfirmAction, SettingsError, SettingsLoading } from './shared.js';
import type {
  PermissionSet,
  PermissionSetAssignment,
} from '@nocobase/app-plugin-authorization/client';

/** Keeps the old assignments URL on the target's public subject directories and assignment API. */
export default function RoleAssignments() {
  const { key } = useParams();
  return <AssignmentEditor key={key} />;
}
function AssignmentEditor() {
  const { key = '' } = useParams();
  const client = useAuthorizationClient();
  const { t } = useTranslation();
  const options = useSettingsData<{ data: AuthorizationOptionsResponse }>(
    'authorization/permissionSets/options',
  );
  const role = useSettingsData<{ data: PermissionSet }>(
    `authorization/permissionSets/${encodeURIComponent(key)}`,
  );
  const request = useSettingsData<{ data: readonly PermissionSetAssignment[] }>(
    `authorization/permissionSets/${encodeURIComponent(key)}/assignments`,
  );
  const canAssign = useRolePermission('assign');
  // Native assignment deletion requires assign; role protection separately names revoke.
  const canRevoke = canAssign;
  const [kind, setKind] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState('');
  const [directoryResult, setDirectoryResult] = useState<{
    key: string;
    data?: { items: readonly SubjectOption[]; total: number };
  }>();
  const [names, setNames] = useState<ReadonlyMap<string, LocalizedText>>(
    () => new Map(),
  );
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const [revoking, setRevoking] = useState<PermissionSetAssignment>();
  const text = (value: LocalizedText) =>
    typeof value === 'string'
      ? value
      : t(value.key, {
          ns: value.ns,
          defaultValue: value.defaultValue ?? value.key,
        });
  const types = options.data?.data.subjectTypes ?? [];
  const selected = types.find((item) => item.type === kind);
  const assignable =
    canAssign &&
    Boolean(role.data) &&
    !role.error &&
    !options.error &&
    (!role.data?.data.protection ||
      role.data.data.protection.allow.includes('assign'));
  const revocable =
    canRevoke &&
    Boolean(role.data) &&
    !role.error &&
    (!role.data?.data.protection ||
      role.data.data.protection.allow.includes('revoke'));
  useEffect(() => {
    let active = true;
    const records = request.data?.data ?? [];
    void Promise.all(
      [...new Set(records.map((row) => row.subject.type))].map(async (type) => {
        const resolved = await client.resolveSubjects(
          'permissionSets',
          type,
          records
            .filter((row) => row.subject.type === type)
            .map((row) => row.subject.id),
        );
        return resolved.map((row) => [`${type}:${row.id}`, row.title] as const);
      }),
    ).then(
      (rows) => {
        if (active) setNames(new Map(rows.flat()));
      },
      (next) => {
        if (active) setError(next);
      },
    );
    return () => {
      active = false;
    };
  }, [client, request.data]);
  const directoryKey = JSON.stringify([
    kind,
    search,
    page,
    selected?.selection.type,
    assignable,
  ]);
  const directory =
    directoryResult?.key === directoryKey ? directoryResult.data : undefined;
  const loading = Boolean(
    kind &&
    selected?.selection.type === 'collection' &&
    assignable &&
    directoryResult?.key !== directoryKey,
  );
  useEffect(() => {
    let active = true;
    if (!kind || selected?.selection.type !== 'collection' || !assignable)
      return;
    void client
      .listSubjects('permissionSets', kind, { search, page, pageSize: 25 })
      .then(
        (result) => {
          if (active) setDirectoryResult({ key: directoryKey, data: result });
        },
        (next) => {
          if (active) {
            setDirectoryResult({ key: directoryKey });
            setError(next);
          }
        },
      );
    return () => {
      active = false;
    };
  }, [
    client,
    kind,
    search,
    page,
    selected?.selection.type,
    assignable,
    directoryKey,
  ]);
  const mutate = async (assignment?: PermissionSetAssignment) => {
    if (assignment ? !revocable : !assignable) return;
    setBusy(true);
    setError(undefined);
    try {
      if (assignment) await client.revoke(key, assignment.id);
      else if (
        selected &&
        (!role.data?.data.protection?.assignableTo ||
          role.data.data.protection.assignableTo.includes(kind))
      )
        await client.assign(key, {
          subject: {
            type: kind,
            id:
              selected.selection.type === 'fixed'
                ? selected.selection.id
                : subject,
          },
        });
      setRevoking(undefined);
      request.reload();
      setSubject('');
    } catch (next) {
      setError(next);
    } finally {
      setBusy(false);
    }
  };
  return (
    <RouteDrawer title={t('settings.assignments')}>
      <ConfirmAction
        open={revocable && Boolean(revoking)}
        title={t('settings.revokeAssignmentFor', {
          name: revoking
            ? text(
                names.get(`${revoking.subject.type}:${revoking.subject.id}`) ??
                  revoking.subject.id,
              )
            : '',
        })}
        description={t('settings.revokeAssignment')}
        confirmLabel={t('settings.revoke')}
        busy={busy}
        onCancel={() => setRevoking(undefined)}
        onConfirm={() => void mutate(revoking)}
      />
      <SettingsError
        error={error ?? request.error ?? role.error ?? options.error}
        retry={request.reload}
      />
      {request.loading ? (
        <SettingsLoading />
      ) : (
        <ul className='space-y-3'>
          {request.data?.data.map((row) => (
            <li
              key={row.id}
              className='flex items-center justify-between gap-3'
            >
              <span>
                {text(
                  names.get(`${row.subject.type}:${row.subject.id}`) ??
                    row.subject.id,
                )}
              </span>
              {revocable && (
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => setRevoking(row)}
                >
                  {t('settings.revoke')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {assignable && (
        <div className='space-y-3'>
          <Label>{t('settings.subjectType')}</Label>
          <Select
            value={kind}
            onValueChange={(value) => {
              setKind(value ?? '');
              setSubject('');

              setPage(1);
              setSearch('');
            }}
          >
            <SelectTrigger aria-label={t('settings.subjectType')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {types
                .filter(
                  (item) =>
                    !role.data?.data.protection?.assignableTo ||
                    role.data.data.protection.assignableTo.includes(item.type),
                )
                .map((item) => (
                  <SelectItem key={item.type} value={item.type}>
                    {text(item.title)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          {selected?.selection.type === 'collection' && (
            <>
              <Input
                aria-label={t('settings.subjectSearch')}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                  setSubject('');
                }}
              />
              {loading ? (
                <SettingsLoading />
              ) : (
                <Select
                  value={subject}
                  onValueChange={(value) => setSubject(value ?? '')}
                >
                  <SelectTrigger aria-label={t('settings.subject')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {directory?.items.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {text(item.title)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className='flex gap-2'>
                <Button
                  variant='outline'
                  disabled={page === 1 || loading}
                  onClick={() => {
                    setPage(page - 1);
                    setSubject('');
                  }}
                >
                  {t('settings.previous')}
                </Button>
                <Button
                  variant='outline'
                  disabled={loading || page * 25 >= (directory?.total ?? 0)}
                  onClick={() => {
                    setPage(page + 1);
                    setSubject('');
                  }}
                >
                  {t('settings.next')}
                </Button>
              </div>
            </>
          )}
          <Button
            disabled={
              busy ||
              !selected ||
              (selected.selection.type === 'collection' &&
                (!subject || loading))
            }
            onClick={() => void mutate()}
          >
            {t('settings.assign')}
          </Button>
        </div>
      )}
    </RouteDrawer>
  );
}
