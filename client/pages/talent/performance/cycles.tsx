/**
 * V4-12 考核周期 (`/talent/review-cycles`, hr.admin): the cycles, and a new
 * cycle with its participant preview — the matched scheme per person, and
 * everyone excluded with the reason (入职不满 N 天, 试用期, 上级评价人未设置,
 * 无适用方案). A cycle opens as the child page `:cycleId` (cycle-detail.tsx).
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlusIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { useAction, useDateText } from '@/components/talent/performance-hooks';
import { CycleStatusBadge } from '@/components/talent/performance-shared';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import { useLookups } from '@/components/talent/use-lookups';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface CycleRow {
  id: string;
  title: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  ownerName: string;
  participants: number;
}

interface PreviewRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  departmentTitle: string;
  positionTitle: string;
  schemeTitle: string | null;
  managerName: string;
  noAccount: boolean;
  reasons: string[];
}

const STAGES = [
  'goalSetting',
  'selfReview',
  'peerReview',
  'managerReview',
  'calibration',
] as const;

export default function ReviewCyclesPage(): ReactElement {
  const { t } = useTranslation();
  const date = useDateText();
  const list = useRemote<{ cycles: CycleRow[]; can: { manage: boolean } }>(
    'talent/performance/cycles',
  );
  const [creating, setCreating] = useState(false);
  return (
    <PageContainer>
      <PageHeader
        title={t('performance.cycles.title')}
        description={t('performance.cycles.description')}
        actions={
          list.data?.can.manage ? (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              {t('performance.cycles.create')}
            </Button>
          ) : null
        }
      />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={4} />
      ) : !list.data.cycles.length ? (
        <EmptyState title={t('performance.cycles.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('performance.cycles.cycleTitle')}</TableHead>
                <TableHead>{t('performance.cycles.period')}</TableHead>
                <TableHead>{t('performance.common.status')}</TableHead>
                <TableHead className='text-end'>
                  {t('performance.cycles.participants')}
                </TableHead>
                <TableHead>{t('performance.cycles.owner')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.cycles.map((cycle) => (
                <TableRow key={cycle.id}>
                  <TableCell>
                    <Link
                      className='font-medium underline-offset-4 hover:underline'
                      to={encodeURIComponent(cycle.id)}
                    >
                      {cycle.title}
                    </Link>
                  </TableCell>
                  <TableCell className='whitespace-nowrap'>
                    {date(cycle.periodStart)} – {date(cycle.periodEnd)}
                  </TableCell>
                  <TableCell>
                    <CycleStatusBadge status={cycle.status} />
                  </TableCell>
                  <TableCell className='text-end tabular-nums'>
                    {cycle.participants}
                  </TableCell>
                  <TableCell>{cycle.ownerName}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <CreateDialog
        open={creating}
        onClose={() => setCreating(false)}
        onDone={list.reload}
      />
      <Outlet context={{ reload: list.reload }} />
    </PageContainer>
  );
}

function CreateDialog({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const lookups = useLookups();
  const action = useAction();
  const [year] = useState(() => new Date().getFullYear());
  const [title, setTitle] = useState(() =>
    t('performance.cycles.defaultTitle', { year }),
  );
  const [periodStart, setPeriodStart] = useState(`${year}-01-01`);
  const [periodEnd, setPeriodEnd] = useState(`${year}-12-31`);
  const [departments, setDepartments] = useState<string[]>([]);
  const [minTenureDays, setMinTenureDays] = useState('90');
  const [excludeProbation, setExcludeProbation] = useState(true);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [deadlines, setDeadlines] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{
    participants: PreviewRow[];
    excluded: PreviewRow[];
  } | null>(null);
  const scope = () => ({
    departmentIds: departments,
    minTenureDays: Number(minTenureDays) || 0,
    excludeProbation,
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => (value ? undefined : onClose())}
    >
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{t('performance.cycles.create')}</DialogTitle>
          <DialogDescription>
            {t('performance.cycles.createHint')}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-3 sm:grid-cols-2'>
          <Field className='sm:col-span-2'>
            <FieldLabel htmlFor='cycle-title'>
              {t('performance.cycles.cycleTitle')}
            </FieldLabel>
            <Input
              id='cycle-title'
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='cycle-start'>
              {t('performance.cycles.periodStart')}
            </FieldLabel>
            <Input
              id='cycle-start'
              type='date'
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor='cycle-end'>
              {t('performance.cycles.periodEnd')}
            </FieldLabel>
            <Input
              id='cycle-end'
              type='date'
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
          </Field>
          <Field className='sm:col-span-2'>
            <FieldLabel htmlFor='cycle-departments'>
              {t('performance.cycles.scope')}
            </FieldLabel>
            <NativeSelect
              id='cycle-departments'
              className='w-full'
              value=''
              onChange={(e) => {
                const id = e.target.value;
                if (id && !departments.includes(id))
                  setDepartments([...departments, id]);
              }}
            >
              <NativeSelectOption value=''>
                {t('performance.cycles.addDepartment')}
              </NativeSelectOption>
              {lookups.departments.map((d) => (
                <NativeSelectOption key={d.id} value={d.id}>
                  {'　'.repeat(d.depth)}
                  {d.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <div className='flex flex-wrap gap-1.5'>
              {departments.map((id) => (
                <Badge key={id} variant='secondary'>
                  {lookups.departmentTitle(id)}
                  <button
                    type='button'
                    className='ms-1'
                    aria-label={t('performance.common.remove')}
                    onClick={() =>
                      setDepartments(departments.filter((x) => x !== id))
                    }
                  >
                    ×
                  </button>
                </Badge>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor='cycle-tenure'>
              {t('performance.cycles.minTenure')}
            </FieldLabel>
            <Input
              id='cycle-tenure'
              type='number'
              min={0}
              value={minTenureDays}
              onChange={(e) => setMinTenureDays(e.target.value)}
            />
          </Field>
          <div className='flex flex-col justify-end gap-2 text-sm'>
            <label className='flex items-center gap-2'>
              <Checkbox
                checked={excludeProbation}
                onCheckedChange={(v) => setExcludeProbation(Boolean(v))}
              />
              {t('performance.cycles.excludeProbation')}
            </label>
            <label className='flex items-center gap-2'>
              <Switch checked={autoAdvance} onCheckedChange={setAutoAdvance} />
              {t('performance.cycles.autoAdvance')}
            </label>
          </div>
          {STAGES.map((stage) => (
            <Field key={stage}>
              <FieldLabel htmlFor={`deadline-${stage}`}>
                {t('performance.cycles.deadlineOf', {
                  stage: t(`performance.cycleStatus.${stage}`),
                })}
              </FieldLabel>
              <Input
                id={`deadline-${stage}`}
                type='date'
                value={deadlines[stage] ?? ''}
                onChange={(e) =>
                  setDeadlines({ ...deadlines, [stage]: e.target.value })
                }
              />
            </Field>
          ))}
        </div>
        <div className='flex justify-end'>
          <Button
            variant='outline'
            disabled={!departments.length || action.busy}
            onClick={() => {
              void (async () => {
                const data = await action.run<{
                  participants: PreviewRow[];
                  excluded: PreviewRow[];
                }>({
                  method: 'POST',
                  path: 'talent/performance/cycles/preview',
                  json: scope(),
                });
                if (data) setPreview(data);
              })();
            }}
          >
            {t('performance.cycles.preview')}
          </Button>
        </div>
        {preview ? <PreviewTables preview={preview} /> : null}
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('performance.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !departments.length || !title.trim()}
            onClick={() => {
              void (async () => {
                const data = await action.run<{ cycle: { id: string } }>(
                  {
                    method: 'POST',
                    path: 'talent/performance/cycles',
                    json: {
                      title,
                      periodStart,
                      periodEnd,
                      scope: scope(),
                      stageDeadlines: Object.fromEntries(
                        Object.entries(deadlines).filter(([, v]) => v),
                      ),
                      autoAdvance,
                    },
                  },
                  t('performance.cycles.created'),
                );
                if (data) {
                  onDone();
                  onClose();
                  void navigate(encodeURIComponent(data.cycle.id));
                }
              })();
            }}
          >
            {t('performance.cycles.createSubmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PreviewTables({
  preview,
}: {
  preview: { participants: PreviewRow[]; excluded: PreviewRow[] };
}): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='space-y-3'>
      <p className='text-sm font-medium'>
        {t('performance.cycles.previewCount', {
          participants: preview.participants.length,
          excluded: preview.excluded.length,
        })}
      </p>
      <div className='overflow-x-auto rounded-lg border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('performance.common.employee')}</TableHead>
              <TableHead>{t('performance.common.department')}</TableHead>
              <TableHead>{t('performance.cycles.scheme')}</TableHead>
              <TableHead>{t('performance.cycles.manager')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {preview.participants.map((row) => (
              <TableRow key={row.employeeId}>
                <TableCell>
                  {row.name}
                  {row.noAccount ? (
                    <Badge variant='outline' className='ms-2'>
                      {t('performance.cycles.noAccount')}
                    </Badge>
                  ) : null}
                </TableCell>
                <TableCell>{row.departmentTitle}</TableCell>
                <TableCell>{row.schemeTitle}</TableCell>
                <TableCell>{row.managerName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {preview.excluded.length ? (
        <div className='rounded-lg border p-3 text-sm'>
          <p className='mb-2 font-medium'>{t('performance.cycles.excluded')}</p>
          <ul className='space-y-1'>
            {preview.excluded.map((row) => (
              <li key={row.employeeId}>
                {row.name}（{row.departmentTitle}）：
                {row.reasons
                  .map((reason) => t(`performance.exclusion.${reason}`))
                  .join('、')}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
