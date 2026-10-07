import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  DownloadIcon,
  ExternalLinkIcon,
  FileSpreadsheetIcon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import { useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import type {
  RecommendationView,
  RuleView,
  SignalList,
  SignalView,
} from '@/components/talent/profile/types';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';

const TABS = ['all', 'unmatched', 'rules'] as const;
type Tab = (typeof TABS)[number];
const SOURCES = ['qms', 'ticket', 'project', 'other'] as const;
const TYPES = [
  'qualityIssue',
  'correctiveAction',
  'ticketResolved',
  'ticketReopened',
  'ticketEscalated',
  'taskDelivered',
  'taskDelayed',
] as const;
const STATUSES = [
  'matched',
  'unmatchedPerson',
  'unmatchedCompetency',
  'ignored',
] as const;

/** An added field's stored value as text: scalars as they are, lists joined. */
function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map((v) => fieldText(v)).join('、');
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean')
    return `${value}`;
  return JSON.stringify(value);
}

/**
 * 业务数据 (V3-11): records pushed or imported from other systems, matched by
 * rule; 待匹配 for HR to assign people and confirm the analyst's rule drafts;
 * 匹配规则; and the notice of failed corrective-action write-backs with a retry. Heads read
 * their departments' records only.
 */
export default function SignalsPage(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as Tab)
    : 'all';
  const [filters, setFilters] = useState({
    sourceSystem: '',
    signalType: '',
    matchStatus: '',
    from: '',
    to: '',
    q: '',
  });
  const query = {
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
    ...(tab === 'unmatched' ? { matchStatus: 'unmatched' } : {}),
  };
  const list = useRemote<SignalList>(
    tab === 'rules' ? null : 'talent/signals',
    query,
  );
  const rules = useRemote<RuleView[]>(
    tab === 'rules' ? 'talent/signal-rules' : null,
  );
  const failures = useRemote<RecommendationView[]>(
    'talent/signals/writeback-failures',
  );
  const [detail, setDetail] = useState<SignalView | null>(null);
  const [assigning, setAssigning] = useState<SignalView | null>(null);
  const [ruleOpen, setRuleOpen] = useState<Partial<RuleView> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const can = list.data?.can;
  const manageRules = useCan({
    resource: { type: 'composite', id: 'talent.signal' },
    action: 'manageRules',
  }).can;

  async function importFile(file: File): Promise<void> {
    try {
      const body = new FormData();
      body.append('file', file);
      const response = await api.request<{
        data: {
          created: number;
          updated: number;
          results: { status: string }[];
        };
      }>({ method: 'POST', path: 'talent/signals/import', body });
      toast.add({
        type: 'success',
        title: t('talent.insights.signals.importDone', {
          created: response.data.created,
          updated: response.data.updated,
          failed: response.data.results.filter((r) => r.status === 'error')
            .length,
        }),
      });
      list.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function retry(id: string): Promise<void> {
    try {
      await api.request({
        method: 'POST',
        path: `talent/training-recommendations/${encodeURIComponent(id)}/retry-writeback`,
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.signals.retried'),
      });
      failures.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  async function confirmRule(rule: RuleView): Promise<void> {
    try {
      await api.request({
        method: 'POST',
        path: `talent/signal-rules/${encodeURIComponent(rule.id)}/confirm`,
        json: {},
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.signals.ruleConfirmed'),
      });
      list.reload();
      rules.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('talent.insights.signals.title')}
        description={t('talent.insights.signals.description')}
        actions={
          <div className='flex flex-wrap gap-2'>
            {can?.import ? (
              <>
                <Button
                  variant='outline'
                  onClick={() =>
                    void downloadFile(
                      api,
                      'talent/signals/import/template',
                      'business-signals-template.xlsx',
                    )
                  }
                >
                  <FileSpreadsheetIcon data-icon='inline-start' />
                  {t('talent.insights.signals.template')}
                </Button>
                <Button
                  variant='outline'
                  onClick={() => fileRef.current?.click()}
                >
                  <UploadIcon data-icon='inline-start' />
                  {t('talent.insights.signals.import')}
                </Button>
                <input
                  ref={fileRef}
                  type='file'
                  accept='.xlsx,.xls'
                  className='hidden'
                  aria-label={t('talent.insights.signals.import')}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void importFile(file);
                  }}
                />
              </>
            ) : null}
            {tab !== 'rules' ? (
              <Button
                variant='outline'
                onClick={() =>
                  void downloadFile(
                    api,
                    'talent/signals/export',
                    'business-signals.xlsx',
                    query,
                  )
                }
              >
                <DownloadIcon data-icon='inline-start' />
                {t('talent.insights.common.export')}
              </Button>
            ) : null}
          </div>
        }
      />
      {failures.data?.length ? (
        <Alert variant='destructive'>
          <TriangleAlertIcon />
          <AlertTitle>
            {t('talent.insights.signals.writebackBanner', {
              count: failures.data.length,
            })}
          </AlertTitle>
          <AlertDescription>
            {failures.data
              .map(
                (f) =>
                  `${f.departmentTitle} · ${f.competencyTitle} · ${f.correctiveActionRefs.join('、')}${f.writebackError ? ` (${f.writebackError})` : ''}`,
              )
              .join('；')}
          </AlertDescription>
          <AlertAction>
            {failures.data.map((f) => (
              <Button
                key={f.id}
                size='sm'
                variant='outline'
                onClick={() => void retry(f.id)}
              >
                {t('talent.insights.signals.retry')}
              </Button>
            ))}
          </AlertAction>
        </Alert>
      ) : null}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(params);
          next.set('tab', String(value));
          setParams(next, { replace: true });
        }}
      >
        <TabsList>
          {TABS.map((name) => (
            <TabsTrigger key={name} value={name}>
              {t(`talent.insights.signals.tabs.${name}`)}
              {name === 'unmatched' && list.data
                ? ` (${(list.data.counts.unmatchedPerson ?? 0) + (list.data.counts.unmatchedCompetency ?? 0)})`
                : ''}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      {tab === 'rules' ? (
        <RulesTab
          rules={rules}
          canManage={manageRules}
          onEdit={(rule) => setRuleOpen(rule)}
          onConfirm={(rule) => void confirmRule(rule)}
        />
      ) : (
        <>
          <div className='flex flex-wrap items-end gap-3'>
            <Field className='w-56'>
              <FieldLabel htmlFor='signals-q'>
                {t('talent.insights.signals.search')}
              </FieldLabel>
              <Input
                id='signals-q'
                value={filters.q}
                onChange={(e) => setFilters({ ...filters, q: e.target.value })}
              />
            </Field>
            <Field className='w-40'>
              <FieldLabel htmlFor='signals-source'>
                {t('talent.insights.signals.columns.source')}
              </FieldLabel>
              <NativeSelect
                id='signals-source'
                value={filters.sourceSystem}
                onChange={(e) =>
                  setFilters({ ...filters, sourceSystem: e.target.value })
                }
              >
                <NativeSelectOption value=''>
                  {t('talent.insights.signals.allSources')}
                </NativeSelectOption>
                {SOURCES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t(`talent.insights.signals.sources.${s}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className='w-44'>
              <FieldLabel htmlFor='signals-type'>
                {t('talent.insights.signals.columns.type')}
              </FieldLabel>
              <NativeSelect
                id='signals-type'
                value={filters.signalType}
                onChange={(e) =>
                  setFilters({ ...filters, signalType: e.target.value })
                }
              >
                <NativeSelectOption value=''>
                  {t('talent.insights.signals.allTypes')}
                </NativeSelectOption>
                {TYPES.map((s) => (
                  <NativeSelectOption key={s} value={s}>
                    {t(`talent.insights.signals.types.${s}`)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {tab === 'all' ? (
              <Field className='w-40'>
                <FieldLabel htmlFor='signals-status'>
                  {t('talent.insights.signals.columns.match')}
                </FieldLabel>
                <NativeSelect
                  id='signals-status'
                  value={filters.matchStatus}
                  onChange={(e) =>
                    setFilters({ ...filters, matchStatus: e.target.value })
                  }
                >
                  <NativeSelectOption value=''>
                    {t('talent.insights.signals.allStatuses')}
                  </NativeSelectOption>
                  {STATUSES.map((s) => (
                    <NativeSelectOption key={s} value={s}>
                      {t(`talent.insights.signals.matchStatuses.${s}`)}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
            ) : null}
            <Field className='w-40'>
              <FieldLabel htmlFor='signals-from'>
                {t('talent.insights.common.date')}
              </FieldLabel>
              <Input
                id='signals-from'
                type='date'
                value={filters.from}
                onChange={(e) =>
                  setFilters({ ...filters, from: e.target.value })
                }
              />
            </Field>
            <Field className='w-40'>
              <FieldLabel htmlFor='signals-to' className='sr-only'>
                {t('talent.insights.common.date')}
              </FieldLabel>
              <Input
                id='signals-to'
                type='date'
                value={filters.to}
                onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              />
            </Field>
          </div>
          {list.error ? (
            <LoadError error={list.error} onRetry={list.reload} />
          ) : !list.data ? (
            <BlockSkeleton rows={6} />
          ) : !list.data.items.length ? (
            <EmptyState title={t('talent.insights.signals.empty')} />
          ) : (
            <Card>
              <CardContent className='overflow-x-auto'>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        {t('talent.insights.signals.columns.source')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.externalId')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.type')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.person')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.department')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.competency')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.severity')}
                      </TableHead>
                      <TableHead>
                        {t('talent.insights.signals.columns.occurredAt')}
                      </TableHead>
                      {list.data.fields.map((f) => (
                        <TableHead key={f.key}>{f.label}</TableHead>
                      ))}
                      <TableHead>
                        {t('talent.insights.signals.columns.match')}
                      </TableHead>
                      {tab === 'unmatched' ? <TableHead /> : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.data.items.map((item) => (
                      <SignalRow
                        key={item.id}
                        item={item}
                        fields={list.data?.fields ?? []}
                        unmatchedTab={tab === 'unmatched'}
                        can={can}
                        onOpen={() => setDetail(item)}
                        onAssign={() => setAssigning(item)}
                        onConfirmRule={(rule) => void confirmRule(rule)}
                        onEditRule={(rule) => setRuleOpen(rule)}
                        onNewRule={() =>
                          setRuleOpen({
                            sourceSystem: item.sourceSystem,
                            category: item.category ?? '',
                          })
                        }
                      />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
      <SignalSheet
        value={detail}
        fields={list.data?.fields ?? []}
        onClose={() => setDetail(null)}
      />
      <AssignDialog
        value={assigning}
        onClose={() => setAssigning(null)}
        onDone={list.reload}
      />
      <RuleDialog
        value={ruleOpen}
        onClose={() => setRuleOpen(null)}
        onDone={() => {
          list.reload();
          rules.reload();
        }}
      />
    </PageContainer>
  );
}

function SignalRow({
  item,
  fields,
  unmatchedTab,
  can,
  onOpen,
  onAssign,
  onConfirmRule,
  onEditRule,
  onNewRule,
}: {
  item: SignalView;
  fields: SignalList['fields'];
  unmatchedTab: boolean;
  can: SignalList['can'] | undefined;
  onOpen: () => void;
  onAssign: () => void;
  onConfirmRule: (rule: RuleView) => void;
  onEditRule: (rule: RuleView) => void;
  onNewRule: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const lookups = useLookups();
  return (
    <TableRow>
      <TableCell>
        {t(`talent.insights.signals.sources.${item.sourceSystem}`)}
      </TableCell>
      <TableCell>
        <Button
          variant='link'
          size='sm'
          className='h-auto px-0'
          onClick={onOpen}
        >
          {item.externalId}
        </Button>
      </TableCell>
      <TableCell>
        {t(`talent.insights.signals.types.${item.signalType}`)}
      </TableCell>
      <TableCell>{item.employeeName ?? item.personKey}</TableCell>
      <TableCell>
        {item.departmentId
          ? lookups.departmentTitle(item.departmentId) || item.departmentTitle
          : ''}
      </TableCell>
      <TableCell>{item.competencyTitle ?? item.category ?? ''}</TableCell>
      <TableCell>
        {item.severity
          ? t(`talent.insights.signals.severities.${item.severity}`)
          : ''}
      </TableCell>
      <TableCell>{item.occurredAt.slice(0, 10)}</TableCell>
      {fields.map((f) => (
        <TableCell key={f.key}>{fieldText(item.customFields[f.key])}</TableCell>
      ))}
      <TableCell>
        <Badge
          variant={item.matchStatus === 'matched' ? 'secondary' : 'outline'}
        >
          {t(`talent.insights.signals.matchStatuses.${item.matchStatus}`)}
        </Badge>
      </TableCell>
      {unmatchedTab ? (
        <TableCell className='min-w-56'>
          {item.matchStatus === 'unmatchedPerson' && can?.match ? (
            <Button size='sm' variant='outline' onClick={onAssign}>
              {t('talent.insights.signals.assign')}
            </Button>
          ) : item.matchStatus === 'unmatchedCompetency' ? (
            item.draftRule ? (
              <div className='space-y-1 text-sm'>
                <p>
                  {t('talent.insights.signals.draftRule', {
                    category: item.draftRule.category,
                    competency: item.draftRule.competencyTitle,
                  })}
                </p>
                {can?.manageRules ? (
                  <div className='flex gap-2'>
                    <Button
                      size='sm'
                      onClick={() => onConfirmRule(item.draftRule!)}
                    >
                      {t('talent.insights.signals.confirmRule')}
                    </Button>
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() => onEditRule(item.draftRule!)}
                    >
                      {t('talent.insights.revisions.acceptModified')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : can?.manageRules ? (
              <Button size='sm' variant='outline' onClick={onNewRule}>
                {t('talent.insights.signals.newRule')}
              </Button>
            ) : (
              <span className='text-muted-foreground'>
                {t('talent.insights.signals.noDraftRule')}
              </span>
            )
          ) : null}
        </TableCell>
      ) : null}
    </TableRow>
  );
}

function SignalSheet({
  value,
  fields,
  onClose,
}: {
  value: SignalView | null;
  fields: SignalList['fields'];
  onClose: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const detail = useRemote<SignalView>(
    value ? `talent/signals/${encodeURIComponent(value.id)}` : null,
  );
  const data = detail.data ?? value;
  return (
    <Sheet
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent className='w-full sm:max-w-lg'>
        <SheetHeader>
          <SheetTitle>
            {t('talent.insights.signals.detailTitle', {
              externalId: data?.externalId ?? '',
            })}
          </SheetTitle>
          <SheetDescription>{data?.title}</SheetDescription>
        </SheetHeader>
        {data ? (
          <div className='space-y-3 overflow-y-auto px-4 pb-4 text-sm'>
            <dl className='grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 gap-y-1'>
              <dt className='text-muted-foreground'>
                {t('talent.insights.signals.columns.type')}
              </dt>
              <dd>{t(`talent.insights.signals.types.${data.signalType}`)}</dd>
              <dt className='text-muted-foreground'>
                {t('talent.insights.signals.columns.category')}
              </dt>
              <dd>{data.category ?? ''}</dd>
              <dt className='text-muted-foreground'>
                {t('talent.insights.signals.columns.person')}
              </dt>
              <dd>{data.employeeName ?? data.personKey}</dd>
              <dt className='text-muted-foreground'>
                {t('talent.insights.signals.columns.competency')}
              </dt>
              <dd>{data.competencyTitle ?? ''}</dd>
              <dt className='text-muted-foreground'>
                {t('talent.insights.decisions.recommendation.refs')}
              </dt>
              <dd>{data.correctiveActionRef ?? ''}</dd>
              {fields.map((f) => (
                <FieldRow
                  key={f.key}
                  label={f.label}
                  value={fieldText(data.customFields[f.key])}
                />
              ))}
            </dl>
            {data.summary ? (
              <div>
                <p className='text-muted-foreground'>
                  {t('talent.insights.signals.summary')}
                </p>
                <p className='whitespace-pre-line'>{data.summary}</p>
              </div>
            ) : null}
            {data.link ? (
              <a
                href={data.link}
                target='_blank'
                rel='noreferrer'
                className='inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline'
              >
                {t('talent.insights.signals.link')}
                <ExternalLinkIcon className='size-3.5' />
              </a>
            ) : null}
            {data.rawPayload !== undefined ? (
              <div>
                <p className='text-muted-foreground'>
                  {t('talent.insights.signals.rawPayload')}
                </p>
                <pre className='max-h-64 overflow-auto rounded-lg bg-muted p-2 text-xs'>
                  {JSON.stringify(data.rawPayload, null, 2)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function FieldRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function AssignDialog({
  value,
  onClose,
  onDone,
}: {
  value: SignalView | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const people = useRemote<{
    items: { id: string; name: string; employeeNo: string; status: string }[];
  }>(value ? 'talent/employees' : null);
  const [employeeId, setEmployeeId] = useState('');
  const [error, setError] = useState<string>();

  async function submit(): Promise<void> {
    if (!value) return;
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: `talent/signals/${encodeURIComponent(value.id)}/match`,
        json: { employeeId },
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.signals.assigned'),
      });
      setEmployeeId('');
      onDone();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {t('talent.insights.signals.assignTitle', {
              externalId: value?.externalId ?? '',
            })}
          </DialogTitle>
          <DialogDescription>
            {value ? `${value.personKey} · ${value.title}` : ''}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='signal-employee'>
            {t('talent.insights.common.employee')}
          </FieldLabel>
          <NativeSelect
            id='signal-employee'
            className='w-full'
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
          >
            <NativeSelectOption value=''>—</NativeSelectOption>
            {(people.data?.items ?? [])
              .filter((p) => p.status !== 'leave')
              .map((p) => (
                <NativeSelectOption key={p.id} value={p.id}>
                  {p.employeeNo} {p.name}
                </NativeSelectOption>
              ))}
          </NativeSelect>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talent.insights.common.cancel')}
          </Button>
          <Button disabled={!employeeId} onClick={() => void submit()}>
            {t('talent.insights.common.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RulesTab({
  rules,
  canManage,
  onEdit,
  onConfirm,
}: {
  rules: ReturnType<typeof useRemote<RuleView[]>>;
  canManage: boolean;
  onEdit: (rule: Partial<RuleView>) => void;
  onConfirm: (rule: RuleView) => void;
}): ReactElement {
  const { t } = useTranslation();
  if (rules.error)
    return <LoadError error={rules.error} onRetry={rules.reload} />;
  if (!rules.data) return <BlockSkeleton rows={4} />;
  return (
    <div className='space-y-3'>
      {canManage ? (
        <div className='flex justify-end'>
          <Button onClick={() => onEdit({ sourceSystem: 'qms', category: '' })}>
            {t('talent.insights.signals.newRule')}
          </Button>
        </div>
      ) : null}
      {!rules.data.length ? (
        <EmptyState title={t('talent.insights.signals.empty')} />
      ) : (
        <Card>
          <CardContent className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    {t('talent.insights.signals.columns.source')}
                  </TableHead>
                  <TableHead>
                    {t('talent.insights.signals.columns.category')}
                  </TableHead>
                  <TableHead>
                    {t('talent.insights.signals.columns.competency')}
                  </TableHead>
                  <TableHead>{t('talent.insights.common.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rules.data.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      {t(
                        `talent.insights.signals.sources.${rule.sourceSystem}`,
                      )}
                    </TableCell>
                    <TableCell>{rule.category}</TableCell>
                    <TableCell>{rule.competencyTitle}</TableCell>
                    <TableCell className='space-x-1'>
                      <Badge
                        variant={
                          rule.reviewStatus === 'confirmed'
                            ? 'secondary'
                            : 'outline'
                        }
                      >
                        {t(
                          `talent.insights.signals.ruleStatuses.${rule.reviewStatus}`,
                        )}
                      </Badge>
                      <Badge variant='outline'>
                        {t(
                          `talent.insights.signals.ruleSources.${rule.source}`,
                        )}
                      </Badge>
                      {rule.unmatchedCount ? (
                        <span className='text-muted-foreground'>
                          {t('talent.insights.signals.unmatchedCount', {
                            count: rule.unmatchedCount,
                          })}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className='space-x-2 text-right'>
                      {canManage && rule.reviewStatus === 'draft' ? (
                        <Button size='sm' onClick={() => onConfirm(rule)}>
                          {t('talent.insights.signals.confirmRule')}
                        </Button>
                      ) : null}
                      {canManage ? (
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => onEdit(rule)}
                        >
                          {t('talent.insights.knowledge.editNote')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function RuleDialog({
  value,
  onClose,
  onDone,
}: {
  value: Partial<RuleView> | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const competencies = useRemote<{
    competencies: { id: string; title: string }[];
  }>(value ? 'talent/find-people/lookups' : null);
  const [draft, setDraft] = useState<{
    sourceSystem: string;
    category: string;
    competencyId: string;
  } | null>(null);
  const current = draft ?? {
    sourceSystem: value?.sourceSystem ?? 'qms',
    category: value?.category ?? '',
    competencyId: value?.competencyId ?? '',
  };
  const [error, setError] = useState<string>();

  async function submit(): Promise<void> {
    setError(undefined);
    try {
      await api.request({
        method: 'POST',
        path: 'talent/signal-rules',
        json: current,
      });
      toast.add({
        type: 'success',
        title: t('talent.insights.signals.ruleConfirmed'),
      });
      setDraft(null);
      onDone();
      onClose();
    } catch (cause) {
      setError(errorMessage(cause, t));
    }
  }

  return (
    <Dialog
      open={Boolean(value)}
      onOpenChange={(open) => {
        if (!open) {
          setDraft(null);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talent.insights.signals.ruleTitle')}</DialogTitle>
          <DialogDescription>
            {t('talent.insights.signals.description')}
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='rule-source'>
            {t('talent.insights.signals.columns.source')}
          </FieldLabel>
          <NativeSelect
            id='rule-source'
            className='w-full'
            value={current.sourceSystem}
            onChange={(e) =>
              setDraft({ ...current, sourceSystem: e.target.value })
            }
          >
            {SOURCES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {t(`talent.insights.signals.sources.${s}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor='rule-category'>
            {t('talent.insights.signals.columns.category')}
          </FieldLabel>
          <Input
            id='rule-category'
            value={current.category}
            onChange={(e) => setDraft({ ...current, category: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor='rule-competency'>
            {t('talent.insights.signals.columns.competency')}
          </FieldLabel>
          <NativeSelect
            id='rule-competency'
            className='w-full'
            value={current.competencyId}
            onChange={(e) =>
              setDraft({ ...current, competencyId: e.target.value })
            }
          >
            <NativeSelectOption value=''>—</NativeSelectOption>
            {(competencies.data?.competencies ?? []).map((c) => (
              <NativeSelectOption key={c.id} value={c.id}>
                {c.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {error ? <FieldError>{error}</FieldError> : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talent.insights.common.cancel')}
          </Button>
          <Button
            disabled={!current.category.trim() || !current.competencyId}
            onClick={() => void submit()}
          >
            {t('talent.insights.signals.saveRule')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
