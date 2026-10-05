import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, XIcon } from 'lucide-react';
import { useReducer, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import { MailThread } from '@/components/talent/mail-thread';
import type { AuditRisk } from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';

const MATERIALS = [
  'certificates',
  'trainingRecords',
  'competencyMatrix',
  'revisionTraining',
  'qualificationLedger',
] as const;

interface AuditRequest {
  id: string;
  customerName: string;
  requesterAddress: string;
  scope: {
    departmentIds: string[];
    positionIds: string[];
    materials: string[];
  };
  excludedRequests: string[];
  unmatchedNames: string[];
  dueDate: string | null;
  status: 'draft' | 'confirmed' | 'packReady' | 'replied' | 'closed';
  reviewStatus: 'draft' | 'confirmed';
  risks: AuditRisk[];
  packFileName: string | null;
  hasPack: boolean;
  share: {
    expiresAt: string | null;
    revokedAt: string | null;
    active: boolean;
  } | null;
  downloads: { at: string; ip: string }[];
  createdAt: string | null;
  scopeLabel?: string;
  can?: { confirm: boolean; share: boolean; revoke: boolean };
}

const STATUS_VARIANT: Record<
  AuditRequest['status'],
  'default' | 'outline' | 'secondary'
> = {
  draft: 'outline',
  confirmed: 'secondary',
  packReady: 'default',
  replied: 'secondary',
  closed: 'outline',
};

/**
 * 审计导出 · 审核请求 (V3-11 客户审核问询): a customer's request for audit
 * material from the audit mailbox. The detail shows the message, the scope
 * the certification steward read (edited and confirmed by a person), the
 * pre-audit risks, the pack, the reply draft and the share link with its
 * downloads: confirm the scope → build the pack → review the reply → send.
 */
export function AuditRequestsTab(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const list = useRemote<AuditRequest[]>('talent/audit-requests');
  const openId = params.get('request');
  const setOpen = (id: string | null) => {
    const next = new URLSearchParams(params);
    if (id) next.set('request', id);
    else next.delete('request');
    setParams(next, { replace: true });
  };
  if (list.error) return <LoadError error={list.error} onRetry={list.reload} />;
  if (!list.data) return <BlockSkeleton rows={3} />;
  return (
    <>
      {!list.data.length ? (
        <EmptyState title={t('auditRequests.empty')} />
      ) : (
        <ul className='space-y-3'>
          {list.data.map((r) => (
            <li key={r.id}>
              <Card
                className='cursor-pointer transition-colors hover:bg-muted/40'
                onClick={() => setOpen(r.id)}
              >
                <CardContent className='space-y-1'>
                  <p className='flex flex-wrap items-center justify-between gap-2'>
                    <span className='font-medium'>{r.customerName}</span>
                    <Badge variant={STATUS_VARIANT[r.status]}>
                      {t(`auditRequests.status.${r.status}`)}
                    </Badge>
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {t('auditRequests.summary', {
                      due: r.dueDate ?? t('auditRequests.noDue'),
                      risks: r.risks.length,
                    })}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Sheet
        open={Boolean(openId)}
        onOpenChange={(next) => !next && setOpen(null)}
      >
        <SheetContent className='w-full overflow-y-auto sm:max-w-2xl'>
          {openId ? (
            <AuditRequestDetail id={openId} onChanged={list.reload} />
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}

function AuditRequestDetail({
  id,
  onChanged,
}: {
  id: string;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<AuditRequest>(
    `talent/audit-requests/${encodeURIComponent(id)}`,
  );
  // Every action can change the thread (a new reply draft after the pack), so it reloads with them.
  const [version, bump] = useReducer((n: number) => n + 1, 0);
  const request = remote.data;
  return (
    <>
      <SheetHeader>
        <SheetTitle>
          {request?.customerName ?? t('auditRequests.title')}
        </SheetTitle>
        <SheetDescription>
          {request
            ? t('auditRequests.requester', {
                address: request.requesterAddress,
                due: request.dueDate ?? t('auditRequests.noDue'),
              })
            : null}
        </SheetDescription>
      </SheetHeader>
      <div className='space-y-5 px-4 pb-6'>
        {remote.error ? (
          <LoadError error={remote.error} onRetry={remote.reload} />
        ) : !request ? (
          <BlockSkeleton rows={4} />
        ) : (
          <>
            <ScopeSection
              key={`${request.status}-${request.scopeLabel ?? ''}`}
              request={request}
              onChanged={() => {
                remote.reload();
                bump();
                onChanged();
              }}
            />
            <RiskSection risks={request.risks} />
            <ShareSection
              request={request}
              onChanged={() => {
                remote.reload();
                bump();
                onChanged();
              }}
            />
            {/* Mounted again once the pack is built, so the drafted reply shows. */}
            <MailThread
              key={version}
              mailbox='audit'
              refType='auditRequest'
              refId={request.id}
              canSend={Boolean(request.can?.share) && request.hasPack}
            />
          </>
        )}
      </div>
    </>
  );
}

function ScopeSection({
  request,
  onChanged,
}: {
  request: AuditRequest;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const [scope, setScope] = useState(request.scope);
  const [customerName, setCustomerName] = useState(request.customerName);
  const [dueDate, setDueDate] = useState(request.dueDate ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  // A workshop named the same in several plants is shown with its plant (苏州工厂 · 机加工车间).
  const departmentLabel = (id: string): string => {
    const department = lookups.departments.find((d) => d.id === id);
    if (!department) return lookups.departmentTitle(id);
    const parent = lookups.departments.find(
      (d) => d.id === department.parentId,
    );
    if (!parent) return department.label;
    const prefix = parent.label.replace(/工厂$/u, '');
    return prefix &&
      prefix !== parent.label &&
      !department.label.startsWith(prefix)
      ? `${parent.label} · ${department.label}`
      : department.label;
  };
  const editable =
    Boolean(request.can?.confirm) &&
    ['draft', 'confirmed'].includes(request.status);
  const dirty =
    customerName !== request.customerName ||
    dueDate !== (request.dueDate ?? '') ||
    JSON.stringify(scope) !== JSON.stringify(request.scope);
  const path = `talent/audit-requests/${encodeURIComponent(request.id)}`;

  async function act(name: string, run: () => Promise<unknown>, done: string) {
    setBusy(name);
    try {
      await run();
      toast.add({ type: 'success', title: done });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    api.request({
      path,
      method: 'PATCH',
      json: { ...scope, customerName, dueDate: dueDate || null },
    });

  const list = (
    kind: 'departmentIds' | 'positionIds',
    options: { id: string; label: string }[],
    label: (id: string) => string,
  ) => (
    <Field>
      <FieldLabel>{t(`auditRequests.${kind}`)}</FieldLabel>
      <div className='flex flex-wrap gap-2'>
        {scope[kind].map((value) => (
          <Badge key={value} variant='secondary' className='gap-1'>
            {label(value)}
            {editable ? (
              <button
                type='button'
                aria-label={t('auditRequests.remove')}
                onClick={() =>
                  setScope({
                    ...scope,
                    [kind]: scope[kind].filter((v) => v !== value),
                  })
                }
              >
                <XIcon className='size-3' />
              </button>
            ) : null}
          </Badge>
        ))}
        {!scope[kind].length ? (
          <span className='text-sm text-muted-foreground'>
            {t('auditRequests.none')}
          </span>
        ) : null}
      </div>
      {editable ? (
        <NativeSelect
          value=''
          aria-label={t(`auditRequests.add.${kind}`)}
          onChange={(e) =>
            e.target.value &&
            setScope({ ...scope, [kind]: [...scope[kind], e.target.value] })
          }
        >
          <NativeSelectOption value=''>
            {t(`auditRequests.add.${kind}`)}
          </NativeSelectOption>
          {options
            .filter((o) => !scope[kind].includes(o.id))
            .map((o) => (
              <NativeSelectOption key={o.id} value={o.id}>
                {o.label}
              </NativeSelectOption>
            ))}
        </NativeSelect>
      ) : null}
    </Field>
  );

  return (
    <section className='space-y-3'>
      <h3 className='flex flex-wrap items-center gap-2 font-medium'>
        {t('auditRequests.scope')}
        <Badge variant={STATUS_VARIANT[request.status]}>
          {t(`auditRequests.status.${request.status}`)}
        </Badge>
      </h3>
      {request.unmatchedNames.length ? (
        <Alert>
          <AlertDescription>
            {t('auditRequests.unmatched', {
              names: request.unmatchedNames.join('、'),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='grid gap-3 sm:grid-cols-2'>
        <Field>
          <FieldLabel htmlFor='audit-customer'>
            {t('auditRequests.customer')}
          </FieldLabel>
          <Input
            id='audit-customer'
            value={customerName}
            disabled={!editable}
            onChange={(e) => setCustomerName(e.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='audit-due'>{t('auditRequests.due')}</FieldLabel>
          <Input
            id='audit-due'
            type='date'
            value={dueDate}
            disabled={!editable}
            onChange={(e) => setDueDate(e.target.value)}
          />
        </Field>
      </div>
      {list(
        'departmentIds',
        lookups.departments.map((d) => ({
          id: d.id,
          label: `${'　'.repeat(d.depth)}${d.label}`,
        })),
        departmentLabel,
      )}
      {list(
        'positionIds',
        lookups.positions.map((p) => ({ id: p.id, label: p.title })),
        lookups.positionTitle,
      )}
      <Field>
        <FieldLabel>{t('auditRequests.materials')}</FieldLabel>
        <div className='grid gap-2 sm:grid-cols-2'>
          {MATERIALS.map((m) => (
            <label key={m} className='flex items-center gap-2 text-sm'>
              <Checkbox
                checked={scope.materials.includes(m)}
                disabled={!editable}
                onCheckedChange={(checked) =>
                  setScope({
                    ...scope,
                    materials: checked
                      ? [...scope.materials, m]
                      : scope.materials.filter((x) => x !== m),
                  })
                }
              />
              {t(`auditRequests.material.${m}`)}
            </label>
          ))}
        </div>
      </Field>
      {request.excludedRequests.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('auditRequests.excluded', {
            items: request.excludedRequests.join('、'),
          })}
        </p>
      ) : null}
      <div className='flex flex-wrap gap-2'>
        {editable && dirty ? (
          <Button
            variant='outline'
            disabled={busy !== null}
            onClick={() => void act('save', save, t('auditRequests.saved'))}
          >
            {busy === 'save' ? <Spinner data-icon='inline-start' /> : null}
            {t('auditRequests.save')}
          </Button>
        ) : null}
        {request.can?.confirm && request.status === 'draft' ? (
          <Button
            disabled={busy !== null}
            onClick={() =>
              void act(
                'confirm',
                async () => {
                  if (dirty) await save();
                  await api.request({
                    path: `${path}/confirm`,
                    method: 'POST',
                  });
                },
                t('auditRequests.confirmed'),
              )
            }
          >
            {busy === 'confirm' ? <Spinner data-icon='inline-start' /> : null}
            {t('auditRequests.confirm')}
          </Button>
        ) : null}
        {request.can?.confirm &&
        request.reviewStatus === 'confirmed' &&
        ['confirmed', 'packReady'].includes(request.status) ? (
          <Button
            variant={request.hasPack ? 'outline' : 'default'}
            disabled={busy !== null}
            onClick={() =>
              void act(
                'pack',
                () => api.request({ path: `${path}/pack`, method: 'POST' }),
                t('auditRequests.packBuilt'),
              )
            }
          >
            {busy === 'pack' ? <Spinner data-icon='inline-start' /> : null}
            {request.hasPack
              ? t('auditRequests.rebuild')
              : t('auditRequests.build')}
          </Button>
        ) : null}
        {request.hasPack ? (
          <Button
            variant='outline'
            onClick={() =>
              void downloadFile(
                api,
                `${path}/pack`,
                request.packFileName ?? 'audit-pack.zip',
              ).catch((cause: unknown) =>
                toast.add({ type: 'error', title: errorMessage(cause, t) }),
              )
            }
          >
            <DownloadIcon data-icon='inline-start' />
            {t('auditRequests.download')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function RiskSection({ risks }: { risks: AuditRisk[] }): ReactElement {
  const { t } = useTranslation();
  return (
    <section className='space-y-2'>
      <h3 className='font-medium'>{t('talent.insights.audit.risks')}</h3>
      <p className='text-sm text-muted-foreground'>
        {t('auditRequests.risksHint')}
      </p>
      {!risks.length ? (
        <p className='text-sm text-muted-foreground'>
          {t('talent.insights.audit.noRisks')}
        </p>
      ) : (
        <ol className='space-y-2 text-sm'>
          {risks.map((risk) => (
            <li
              key={`${risk.employeeId}-${risk.kind}-${risk.text}`}
              className='flex flex-wrap gap-2'
            >
              <Badge
                variant={risk.urgency === 'high' ? 'destructive' : 'default'}
              >
                {t(`talent.insights.audit.urgency.${risk.urgency}`)}
              </Badge>
              <span>{risk.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ShareSection({
  request,
  onChanged,
}: {
  request: AuditRequest;
  onChanged: () => void;
}): ReactElement | null {
  const { t, i18n } = useTranslation();
  const api = useApiClient();
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  if (!request.share) return null;
  const share = request.share;
  return (
    <section className='space-y-2'>
      <h3 className='flex flex-wrap items-center gap-2 font-medium'>
        {t('auditRequests.share')}
        <Badge variant={share.active ? 'default' : 'outline'}>
          {share.active
            ? t('auditRequests.shareActive')
            : share.revokedAt
              ? t('auditRequests.shareRevoked')
              : t('auditRequests.shareExpired')}
        </Badge>
      </h3>
      {share.expiresAt ? (
        <p className='text-sm text-muted-foreground'>
          {t('auditRequests.shareUntil', {
            at: format.format(new Date(share.expiresAt)),
          })}
        </p>
      ) : null}
      <p className='text-sm'>
        {request.downloads.length
          ? t('auditRequests.downloads', { count: request.downloads.length })
          : t('auditRequests.noDownloads')}
      </p>
      {request.downloads.length ? (
        <ul className='text-sm text-muted-foreground'>
          {request.downloads.map((d) => (
            <li key={d.at}>
              {format.format(new Date(d.at))} · {d.ip}
            </li>
          ))}
        </ul>
      ) : null}
      {share.active && request.can?.revoke ? (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant='outline' />}>
            {t('auditRequests.revoke')}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('auditRequests.revokeTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('auditRequests.revokeDescription', {
                  customer: request.customerName,
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('auditRequests.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  void api
                    .request({
                      path: `talent/audit-requests/${encodeURIComponent(request.id)}/revoke`,
                      method: 'POST',
                    })
                    .then(() => {
                      toast.add({
                        type: 'success',
                        title: t('auditRequests.revoked'),
                      });
                      onChanged();
                    })
                    .catch((cause: unknown) =>
                      toast.add({
                        type: 'error',
                        title: errorMessage(cause, t),
                      }),
                    )
                }
              >
                {t('auditRequests.revoke')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </section>
  );
}
