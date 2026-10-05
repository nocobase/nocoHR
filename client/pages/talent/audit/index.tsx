import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { BotIcon, DownloadIcon, ShieldAlertIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { AuditRequestsTab } from '@/components/talent/audit-requests';
import { downloadFile } from '@/components/talent/download';
// V4-14
import { LicensedAuditExports } from '@/components/talent/licensed-audit-exports';
import { errorMessage } from '@/components/talent/errors';
import type { AuditRisk } from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

// V4-14: 'licensed' — 工单人员追溯 and 权限变化记录 (licensed-audit-exports.tsx).
// V3-11 客户审核问询: 'requests' — the customers' requests from the audit mailbox (audit-requests.tsx).
const TABS = [
  'requests',
  'pack',
  'trainingFile',
  'ledger',
  'proofs',
  'licensed',
  'log',
] as const;
type Tab = (typeof TABS)[number];

interface Options {
  employees: { id: string; name: string; employeeNo: string }[];
  departments: { id: string; title: string }[];
  positions: { id: string; title: string }[];
}

/**
 * 审计导出 (V3-11, hr.admin and hr.auditor): the customer audit pack for a
 * scope said in one sentence (risks first), 个人培训档案, 培训与资格台账,
 * 专项培训证明 and the log of every export. Read-only; nothing here carries
 * mobile numbers, ID numbers or pay.
 */
export default function AuditPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : params.get('request')
      ? 'requests'
      : 'pack';
  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.audit.title')}
        description={t('talent.insights.audit.description')}
        actions={
          <AssistantLauncher
            employee='certificationSteward'
            chatId='steward-audit-pack'
            label={t('talent.certifications.askSteward')}
            icon={<BotIcon data-icon='inline-start' />}
            variant='outline'
            task={() => ({
              title: t('talent.insights.audit.tabs.pack'),
              system:
                'The user is on the audit export page and may ask for a customer audit pack.',
              user: '',
            })}
          />
        }
      />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', String(value));
          setParams(next, { replace: true });
        }}
      >
        <TabsList className='flex-wrap'>
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {name === 'licensed'
                ? t('licensed.audit.tab')
                : name === 'requests'
                  ? t('auditRequests.tab')
                  : t(`talent.insights.audit.tabs.${name}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'requests' ? (
        <AuditRequestsTab />
      ) : tab === 'pack' ? (
        <PackTab />
      ) : tab === 'trainingFile' ? (
        <TrainingFileTab />
      ) : tab === 'ledger' ? (
        <LedgerTab />
      ) : tab === 'licensed' ? (
        <LicensedAuditExports />
      ) : tab === 'proofs' ? (
        <ProofsTab />
      ) : (
        <LogTab />
      )}
    </PageContainer>
  );
}

function PackTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const [text, setText] = useState('');
  const [result, setResult] = useState<{
    scope: { departmentIds: string[]; positionIds: string[] };
    risks: AuditRisk[];
  } | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function check(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const response = await api.request<{ data: NonNullable<typeof result> }>({
        method: 'POST',
        path: 'talent/audit/risks',
        json: { text },
      });
      setResult(response.data);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function build(): Promise<void> {
    setBusy(true);
    try {
      const stream = await api.stream({
        method: 'POST',
        path: 'talent/audit/pack',
        json: { text },
      });
      const blob = await new Response(stream).blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `audit-pack-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.add({
        type: 'success',
        title: t('talent.insights.audit.packDone'),
      });
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className='space-y-4'>
      <Card>
        <CardContent className='space-y-3'>
          <Field>
            <FieldLabel htmlFor='audit-scope'>
              {t('talent.insights.audit.scope')}
            </FieldLabel>
            <Textarea
              id='audit-scope'
              rows={2}
              placeholder={t('talent.insights.audit.scopePlaceholder')}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className='flex flex-wrap justify-end gap-2'>
            <Button
              variant='outline'
              disabled={busy || !text.trim()}
              onClick={() => void check()}
            >
              <ShieldAlertIcon data-icon='inline-start' />
              {t('talent.insights.audit.checkRisks')}
            </Button>
            <Button disabled={busy || !result} onClick={() => void build()}>
              <DownloadIcon data-icon='inline-start' />
              {t('talent.insights.audit.buildPack')}
            </Button>
          </div>
        </CardContent>
      </Card>
      {result ? (
        <Card>
          <CardHeader>
            <CardTitle>{t('talent.insights.audit.risks')}</CardTitle>
            <CardDescription>
              {t('talent.insights.audit.scopeResolved', {
                departments:
                  result.scope.departmentIds
                    .map((id) => lookups.departmentTitle(id))
                    .join('、') || t('talent.insights.common.allDepartments'),
                positions:
                  result.scope.positionIds
                    .map((id) => lookups.positionTitle(id))
                    .join('、') || t('talent.insights.common.allPositions'),
              })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result.risks.length ? (
              <p className='text-sm text-muted-foreground'>
                {t('talent.insights.audit.noRisks')}
              </p>
            ) : (
              <ol className='space-y-3 text-sm'>
                {result.risks.map((risk) => (
                  <li
                    key={`${risk.employeeId}-${risk.kind}-${risk.text}`}
                    className='space-y-1'
                  >
                    <p className='flex flex-wrap items-center gap-2'>
                      <Badge
                        variant={
                          risk.urgency === 'high' ? 'destructive' : 'default'
                        }
                      >
                        {t(`talent.insights.audit.urgency.${risk.urgency}`)}
                      </Badge>
                      <span className='font-medium'>{risk.text}</span>
                    </p>
                    <ul className='list-disc ps-5 text-muted-foreground'>
                      {risk.evidence.map((e) => (
                        <li key={`${e.type}-${e.id}`}>{e.label}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function TrainingFileTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const options = useRemote<Options>('talent/audit/options');
  const [employeeId, setEmployeeId] = useState('');
  if (options.error)
    return <LoadError error={options.error} onRetry={options.reload} />;
  if (!options.data) return <BlockSkeleton rows={2} />;
  return (
    <Card>
      <CardContent className='flex flex-wrap items-end gap-3'>
        <Field className='w-72 max-w-full'>
          <FieldLabel htmlFor='audit-employee'>
            {t('talent.insights.audit.pickEmployee')}
          </FieldLabel>
          <NativeSelect
            id='audit-employee'
            className='w-full'
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <NativeSelectOption value=''>—</NativeSelectOption>
            {options.data.employees.map((e) => (
              <NativeSelectOption key={e.id} value={e.id}>
                {e.employeeNo} {e.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button
          disabled={!employeeId}
          onClick={() =>
            void downloadFile(
              api,
              `talent/audit/employees/${encodeURIComponent(employeeId)}/training-file`,
              'training-file.pdf',
            ).catch((cause: unknown) =>
              toast.add({ type: 'error', title: errorMessage(cause, t) }),
            )
          }
        >
          <DownloadIcon data-icon='inline-start' />
          {t('talent.insights.audit.downloadFile')}
        </Button>
      </CardContent>
    </Card>
  );
}

function LedgerTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const lookups = useLookups();
  const [departmentId, setDepartmentId] = useState('');
  const [positionId, setPositionId] = useState('');
  return (
    <Card>
      <CardContent className='flex flex-wrap items-end gap-3'>
        <Field className='w-56'>
          <FieldLabel htmlFor='ledger-department'>
            {t('talent.insights.common.department')}
          </FieldLabel>
          <NativeSelect
            id='ledger-department'
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.insights.common.allDepartments')}
            </NativeSelectOption>
            {lookups.departments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {'  '.repeat(d.depth)}
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field className='w-48'>
          <FieldLabel htmlFor='ledger-position'>
            {t('talent.insights.common.position')}
          </FieldLabel>
          <NativeSelect
            id='ledger-position'
            value={positionId}
            onChange={(e) => setPositionId(e.target.value)}
          >
            <NativeSelectOption value=''>
              {t('talent.insights.common.allPositions')}
            </NativeSelectOption>
            {lookups.positions.map((p) => (
              <NativeSelectOption key={p.id} value={p.id}>
                {p.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Button
          onClick={() =>
            void downloadFile(
              api,
              'talent/audit/ledger',
              'qualification-ledger.xlsx',
              {
                departmentId: departmentId || undefined,
                positionId: positionId || undefined,
              },
            ).catch((cause: unknown) =>
              toast.add({ type: 'error', title: errorMessage(cause, t) }),
            )
          }
        >
          <DownloadIcon data-icon='inline-start' />
          {t('talent.insights.audit.downloadLedger')}
        </Button>
      </CardContent>
    </Card>
  );
}

function ProofsTab(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const proofs = useRemote<
    {
      id: string;
      departmentTitle: string;
      competencyTitle: string;
      completedAt: string | null;
      hasProof: boolean;
    }[]
  >('talent/audit/proofs');
  if (proofs.error)
    return <LoadError error={proofs.error} onRetry={proofs.reload} />;
  if (!proofs.data) return <BlockSkeleton rows={3} />;
  if (!proofs.data.length)
    return <EmptyState title={t('talent.insights.audit.noProofs')} />;
  return (
    <Card>
      <CardContent className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('talent.insights.common.department')}</TableHead>
              <TableHead>
                {t('talent.insights.signals.columns.competency')}
              </TableHead>
              <TableHead>{t('talent.insights.common.date')}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {proofs.data.map((proof) => (
              <TableRow key={proof.id}>
                <TableCell>{proof.departmentTitle}</TableCell>
                <TableCell>{proof.competencyTitle}</TableCell>
                <TableCell>{(proof.completedAt ?? '').slice(0, 10)}</TableCell>
                <TableCell className='text-right'>
                  {proof.hasProof ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        void downloadFile(
                          api,
                          `talent/audit/proofs/${encodeURIComponent(proof.id)}`,
                          'training-proof.pdf',
                        )
                      }
                    >
                      <DownloadIcon data-icon='inline-start' />
                      {t('talent.insights.common.download')}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function LogTab(): ReactElement {
  const { t } = useTranslation();
  const log = useRemote<
    {
      id: string;
      kind: string;
      actorName: string;
      fileName: string | null;
      summary: string | null;
      via: string;
      createdAt: string;
    }[]
  >('talent/audit/log');
  if (log.error) return <LoadError error={log.error} onRetry={log.reload} />;
  if (!log.data) return <BlockSkeleton rows={3} />;
  if (!log.data.length)
    return <EmptyState title={t('talent.insights.audit.noLog')} />;
  return (
    <Card>
      <CardContent className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('talent.insights.audit.columns.time')}</TableHead>
              <TableHead>{t('talent.insights.audit.columns.actor')}</TableHead>
              <TableHead>{t('talent.insights.audit.columns.kind')}</TableHead>
              <TableHead>
                {t('talent.insights.audit.columns.summary')}
              </TableHead>
              <TableHead>{t('talent.insights.audit.columns.file')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {log.data.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className='whitespace-nowrap'>
                  {entry.createdAt.replace('T', ' ').slice(0, 16)}
                </TableCell>
                <TableCell>{entry.actorName}</TableCell>
                <TableCell>
                  {t(`talent.insights.audit.kinds.${entry.kind}`)}
                  <span className='ms-1 text-muted-foreground'>
                    ({t(`talent.insights.audit.via.${entry.via}`)})
                  </span>
                </TableCell>
                <TableCell>{entry.summary ?? ''}</TableCell>
                <TableCell>{entry.fileName ?? ''}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
