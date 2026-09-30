import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { DownloadIcon, SearchIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
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
import { toast } from '@/components/ui/toast';

import { downloadFile } from './download.js';
import { errorMessage } from './errors.js';
import { EmptyState } from './states.js';
import { useRemote } from './use-remote.js';

interface TraceEntry {
  id: string;
  step: string;
  employeeName: string;
  signedAt: string;
  certificateNo: string | null;
  certificateStatusAtSigning: string | null;
  certificateStatusNow: string | null;
  requiredCourses: {
    courseId: string;
    title: string;
    completedAt: string | null;
  }[];
  links: { certificate: string | null; employee: string };
}

interface ChangeRow {
  date: string;
  employeeName: string;
  employeeNo: string;
  certification: string;
  certificateNo: string;
  change: 'gained' | 'lost' | 'kept';
  permissionSets: string[];
  reason: string;
  link: string;
}

interface Options {
  employees: { id: string; name: string; employeeNo: string }[];
}

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
};

/**
 * V4-14 审计导出 · 持证上岗 (a tab of the V3-11 audit page; talent.audit,
 * hr.admin and hr.auditor): 工单人员追溯 (offered only where the start logs
 * exist) and 权限变化记录, each previewed on the page and downloaded as
 * Excel. Every download is written to the export log by the server.
 */
export function LicensedAuditExports(): ReactElement {
  const options = useRemote<{ startTraceAvailable: boolean }>(
    'talent/licensed/audit/options',
  );
  return (
    <div className='space-y-4'>
      {options.data?.startTraceAvailable ? <StartTraceCard /> : null}
      <PermissionChangesCard />
    </div>
  );
}

function StartTraceCard(): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const [workOrderNo, setWorkOrderNo] = useState('MO-24031');
  const [step, setStep] = useState('');
  const [rows, setRows] = useState<TraceEntry[] | null>(null);
  const query = { workOrderNo, step: step || undefined };
  const format = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  const status = (value: string | null) =>
    value ? t(`licensed.audit.status.${value}`, { defaultValue: value }) : '—';

  async function show(): Promise<void> {
    try {
      const result = await api.request<{ data: TraceEntry[] }>({
        path: 'talent/licensed/audit/start-trace',
        query,
      });
      setRows(result.data);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.audit.startTrace')}</CardTitle>
        <CardDescription>
          {t('licensed.audit.startTraceDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end'>
          <Field>
            <FieldLabel htmlFor='licensed-work-order'>
              {t('licensed.audit.workOrderNo')}
            </FieldLabel>
            <Input
              id='licensed-work-order'
              value={workOrderNo}
              maxLength={32}
              onChange={(event) => setWorkOrderNo(event.target.value.trim())}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='licensed-operation'>
              {t('licensed.audit.operationNo')}
            </FieldLabel>
            <Input
              id='licensed-operation'
              value={step}
              maxLength={8}
              onChange={(event) => setStep(event.target.value.trim())}
            />
          </Field>
          <div className='flex flex-wrap gap-2'>
            <Button
              variant='outline'
              disabled={!workOrderNo}
              onClick={() => void show()}
            >
              <SearchIcon data-icon='inline-start' />
              {t('licensed.audit.show')}
            </Button>
            <Button
              disabled={!workOrderNo}
              onClick={() =>
                void downloadFile(
                  api,
                  'talent/licensed/audit/start-trace/file',
                  `start-trace-${workOrderNo}.xlsx`,
                  query,
                ).catch((cause: unknown) =>
                  toast.add({ type: 'error', title: errorMessage(cause, t) }),
                )
              }
            >
              <DownloadIcon data-icon='inline-start' />
              {t('licensed.audit.download')}
            </Button>
          </div>
        </div>
        {rows === null ? null : rows.length ? (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('licensed.audit.registrant')}</TableHead>
                  <TableHead>{t('licensed.audit.at')}</TableHead>
                  <TableHead>{t('licensed.audit.certificateNo')}</TableHead>
                  <TableHead>{t('licensed.audit.statusThen')}</TableHead>
                  <TableHead>{t('licensed.audit.statusNow')}</TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('licensed.audit.courses')}
                  </TableHead>
                  <TableHead>{t('licensed.audit.open')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className='font-medium'>
                      {row.employeeName}
                    </TableCell>
                    <TableCell className='tabular-nums'>
                      {format(row.signedAt)}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {row.certificateNo ?? '—'}
                    </TableCell>
                    <TableCell>
                      {status(row.certificateStatusAtSigning)}
                    </TableCell>
                    <TableCell>{status(row.certificateStatusNow)}</TableCell>
                    <TableCell className='hidden text-xs md:table-cell'>
                      {row.requiredCourses
                        .map(
                          (c) =>
                            `${c.title}：${c.completedAt ? format(c.completedAt) : t('licensed.audit.notDone')}`,
                        )
                        .join('；')}
                    </TableCell>
                    <TableCell>
                      <Link
                        className='text-sm text-primary underline-offset-4 hover:underline'
                        to={row.links.certificate ?? row.links.employee}
                      >
                        {t('licensed.audit.open')}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title={t('licensed.audit.empty')} />
        )}
      </CardContent>
    </Card>
  );
}

function PermissionChangesCard(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const options = useRemote<Options>('talent/audit/options');
  const certifications = useRemote<{ items: { id: string; title: string }[] }>(
    'talent/certifications',
  );
  const [by, setBy] = useState<'person' | 'certification'>('person');
  const [target, setTarget] = useState('');
  const [from, setFrom] = useState(() => daysAgo(90));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<ChangeRow[] | null>(null);
  const query = {
    ...(by === 'person' ? { employeeId: target } : { certificationId: target }),
    from,
    to,
  };
  const ready = Boolean(target && from && to && from <= to);

  async function show(): Promise<void> {
    try {
      const result = await api.request<{ data: ChangeRow[] }>({
        path: 'talent/licensed/audit/permission-changes',
        query,
      });
      setRows(result.data);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.audit.permissionChanges')}</CardTitle>
        <CardDescription>
          {t('licensed.audit.permissionChangesDescription')}
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='grid gap-3 sm:grid-cols-2 lg:grid-cols-4'>
          <Field>
            <FieldLabel htmlFor='licensed-by'>
              {t('licensed.audit.by')}
            </FieldLabel>
            <NativeSelect
              id='licensed-by'
              value={by}
              onChange={(event) => {
                setBy(
                  event.target.value === 'certification'
                    ? 'certification'
                    : 'person',
                );
                setTarget('');
                setRows(null);
              }}
            >
              <NativeSelectOption value='person'>
                {t('licensed.audit.byPerson')}
              </NativeSelectOption>
              <NativeSelectOption value='certification'>
                {t('licensed.audit.byCertification')}
              </NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='licensed-target'>
              {by === 'person'
                ? t('licensed.audit.person')
                : t('licensed.audit.certification')}
            </FieldLabel>
            <NativeSelect
              id='licensed-target'
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <NativeSelectOption value=''>
                {t('licensed.audit.choose')}
              </NativeSelectOption>
              {by === 'person'
                ? (options.data?.employees ?? []).map((e) => (
                    <NativeSelectOption key={e.id} value={e.id}>
                      {e.name} · {e.employeeNo}
                    </NativeSelectOption>
                  ))
                : (certifications.data?.items ?? []).map((c) => (
                    <NativeSelectOption key={c.id} value={c.id}>
                      {c.title}
                    </NativeSelectOption>
                  ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='licensed-from'>
              {t('licensed.audit.from')}
            </FieldLabel>
            <Input
              id='licensed-from'
              type='date'
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='licensed-to'>
              {t('licensed.audit.to')}
            </FieldLabel>
            <Input
              id='licensed-to'
              type='date'
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button
            variant='outline'
            disabled={!ready}
            onClick={() => void show()}
          >
            <SearchIcon data-icon='inline-start' />
            {t('licensed.audit.show')}
          </Button>
          <Button
            disabled={!ready}
            onClick={() =>
              void downloadFile(
                api,
                'talent/licensed/audit/permission-changes/file',
                `permission-changes-${from}-${to}.xlsx`,
                query,
              ).catch((cause: unknown) =>
                toast.add({ type: 'error', title: errorMessage(cause, t) }),
              )
            }
          >
            <DownloadIcon data-icon='inline-start' />
            {t('licensed.audit.download')}
          </Button>
        </div>
        {rows === null ? null : rows.length ? (
          <div className='overflow-x-auto'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('licensed.audit.date')}</TableHead>
                  <TableHead>{t('licensed.audit.person')}</TableHead>
                  <TableHead>{t('licensed.audit.certification')}</TableHead>
                  <TableHead>{t('licensed.audit.change')}</TableHead>
                  <TableHead>{t('licensed.audit.sets')}</TableHead>
                  <TableHead>{t('licensed.audit.reason')}</TableHead>
                  <TableHead>{t('licensed.audit.open')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={`${row.date}-${row.certificateNo}-${row.reason}-${row.change}-${row.permissionSets.join(',')}-${row.link}`}
                  >
                    <TableCell className='tabular-nums'>{row.date}</TableCell>
                    <TableCell>{row.employeeName}</TableCell>
                    <TableCell>{row.certification}</TableCell>
                    <TableCell>
                      {t(`licensed.audit.changes.${row.change}`)}
                    </TableCell>
                    <TableCell>{row.permissionSets.join('、')}</TableCell>
                    <TableCell>
                      {t(`licensed.audit.reasons.${row.reason}`)}
                    </TableCell>
                    <TableCell>
                      <Link
                        className='text-sm text-primary underline-offset-4 hover:underline'
                        to={row.link}
                      >
                        {t('licensed.audit.open')}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState title={t('licensed.audit.empty')} />
        )}
      </CardContent>
    </Card>
  );
}
