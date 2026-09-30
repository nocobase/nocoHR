/**
 * V4-13 实操考核 (`/talent/practicals`): hr.admin and hr.instructor maintain
 * the assessment forms (checklist, critical items, pass rule, the work
 * instruction, a witness requirement; the examiner drafts one from a work
 * instruction, which must be confirmed before use); assessors (the
 * permission set hr.practicalAssessor) start an assessment; everyone sees the
 * records they conduct or witness. A record opens as `records/:recordId`,
 * the page used on the phone during the assessment.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { PlayIcon, PlusIcon, SparklesIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
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

export interface ChecklistItem {
  key: string;
  item: string;
  critical: boolean;
  sourceExcerpt: string | null;
}
export interface Template {
  id: string;
  title: string;
  competencyIds: string[];
  checklist: ChecklistItem[];
  passRule: { allCriticalPass: boolean; minPassRate: number };
  sourceDocumentId: string | null;
  sourceDocumentTitle?: string | null;
  requiresWitness: boolean;
  reviewStatus: string;
  source: string;
  active: boolean;
}
interface RecordRow {
  id: string;
  assessmentTitle: string;
  employeeName: string;
  assessorName: string;
  witnessName: string | null;
  conductedAt: string | null;
  status: string;
  passed: boolean | null;
  waitingForMe: boolean;
}

export default function PracticalsPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const templates = useRemote<{ templates: Template[]; can: { manage: boolean; conduct: boolean } }>(
    'talent/practicals/templates',
  );
  const records = useRemote<RecordRow[]>('talent/practicals/records');
  const [editing, setEditing] = useState<Template | 'new' | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [starting, setStarting] = useState(false);
  const can = templates.data?.can;
  const tab = params.get('tab') ?? (can?.manage ? 'templates' : 'records');
  const reload = () => {
    templates.reload();
    records.reload();
  };
  return (
    <PageContainer>
      <PageHeader
        title={t('talentReview.practicals.title')}
        description={t('talentReview.practicals.description')}
        actions={
          <div className='flex flex-wrap gap-2'>
            {can?.conduct ? (
              <Button onClick={() => setStarting(true)}>
                <PlayIcon data-icon='inline-start' />
                {t('talentReview.practicals.start')}
              </Button>
            ) : null}
            {can?.manage ? (
              <>
                <Button variant='outline' onClick={() => setDrafting(true)}>
                  <SparklesIcon data-icon='inline-start' />
                  {t('talentReview.practicals.draftFromDocument')}
                </Button>
                <Button variant='outline' onClick={() => setEditing('new')}>
                  <PlusIcon data-icon='inline-start' />
                  {t('talentReview.practicals.newTemplate')}
                </Button>
              </>
            ) : null}
          </div>
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
        <TabsList>
          <TabsTrigger value='templates'>{t('talentReview.practicals.templates')}</TabsTrigger>
          <TabsTrigger value='records'>{t('talentReview.practicals.records')}</TabsTrigger>
        </TabsList>
      </Tabs>
      {tab === 'templates' ? (
        templates.error ? (
          <LoadError error={templates.error} onRetry={templates.reload} />
        ) : !templates.data ? (
          <BlockSkeleton rows={3} />
        ) : !templates.data.templates.length ? (
          <EmptyState title={t('talentReview.practicals.noTemplates')} />
        ) : (
          <div className='overflow-x-auto rounded-lg border'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talentReview.practicals.templateTitle')}</TableHead>
                  <TableHead>{t('talentReview.practicals.items')}</TableHead>
                  <TableHead>{t('talentReview.practicals.document')}</TableHead>
                  <TableHead>{t('talentReview.common.status')}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.data.templates.map((tpl) => (
                  <TableRow key={tpl.id}>
                    <TableCell className='font-medium'>
                      {tpl.title}
                      {tpl.source === 'ai' ? (
                        <Badge variant='outline' className='ms-2'>
                          {t('talentReview.card.source.ai')}
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {t('talentReview.practicals.itemCount', {
                        count: tpl.checklist.length,
                        critical: tpl.checklist.filter((c) => c.critical).length,
                      })}
                    </TableCell>
                    <TableCell>{tpl.sourceDocumentTitle ?? '—'}</TableCell>
                    <TableCell>
                      <TrStatusBadge status={tpl.reviewStatus} />
                    </TableCell>
                    <TableCell className='text-end'>
                      {can?.manage ? (
                        <Button size='sm' variant='outline' onClick={() => setEditing(tpl)}>
                          {tpl.reviewStatus === 'draft' ? t('talentReview.practicals.review') : t('talentReview.common.edit')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )
      ) : records.error ? (
        <LoadError error={records.error} onRetry={records.reload} />
      ) : !records.data ? (
        <BlockSkeleton rows={3} />
      ) : !records.data.length ? (
        <EmptyState title={t('talentReview.practicals.noRecords')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.practicals.person')}</TableHead>
                <TableHead>{t('talentReview.practicals.templateTitle')}</TableHead>
                <TableHead>{t('talentReview.practicals.assessor')}</TableHead>
                <TableHead>{t('talentReview.common.status')}</TableHead>
                <TableHead>{t('talentReview.practicals.result')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.data.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <Link className='font-medium underline-offset-4 hover:underline' to={`records/${encodeURIComponent(r.id)}`}>
                      {r.employeeName}
                    </Link>
                    {r.waitingForMe ? (
                      <Badge className='ms-2'>{t('talentReview.practicals.waitingForMe')}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{r.assessmentTitle}</TableCell>
                  <TableCell>{r.assessorName}</TableCell>
                  <TableCell>
                    <TrStatusBadge status={r.status} />
                  </TableCell>
                  <TableCell>
                    {r.passed === null ? '—' : r.passed ? t('talentReview.practicals.passed') : t('talentReview.practicals.failed')}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing ? (
        <TemplateDialog template={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDone={reload} />
      ) : null}
      {drafting ? <DraftDialog onClose={() => setDrafting(false)} onDone={reload} /> : null}
      {starting && templates.data ? (
        <StartDialog templates={templates.data.templates} onClose={() => setStarting(false)} />
      ) : null}
      <Outlet context={{ reload }} />
    </PageContainer>
  );
}

function TemplateDialog({
  template,
  onClose,
  onDone,
}: {
  template: Template | null;
  onClose: () => void;
  onDone: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const action = useTrAction();
  const [title, setTitle] = useState(template?.title ?? '');
  const [competencies, setCompetencies] = useState((template?.competencyIds ?? []).join(','));
  const [items, setItems] = useState<ChecklistItem[]>(
    template?.checklist ?? [{ key: 'item1', item: '', critical: true, sourceExcerpt: null }],
  );
  const [minPassRate, setMinPassRate] = useState(String(template?.passRule.minPassRate ?? 80));
  const [allCritical, setAllCritical] = useState(template?.passRule.allCriticalPass ?? true);
  const [witness, setWitness] = useState(template?.requiresWitness ?? false);
  const save = async () => {
    const json = {
      title,
      competencyIds: competencies.split(/[,，\s]+/u).filter(Boolean),
      checklist: items.map((c, i) => ({ ...c, key: c.key || `item${i + 1}` })),
      passRule: { allCriticalPass: allCritical, minPassRate: Number(minPassRate) || 0 },
      sourceDocumentId: template?.sourceDocumentId ?? null,
      requiresWitness: witness,
    };
    const done = await action.run(
      template
        ? { method: 'PUT', path: `talent/practicals/templates/${encodeURIComponent(template.id)}`, json }
        : { method: 'POST', path: 'talent/practicals/templates', json },
      t('talentReview.practicals.templateSaved'),
    );
    if (done) {
      onDone();
      onClose();
    }
  };
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{template ? template.title : t('talentReview.practicals.newTemplate')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          {template?.reviewStatus === 'draft' ? (
            <Alert>
              <AlertDescription>{t('talentReview.practicals.draftNotice')}</AlertDescription>
            </Alert>
          ) : null}
          <Field>
            <FieldLabel htmlFor='pt-title'>{t('talentReview.practicals.templateTitle')}</FieldLabel>
            <Input id='pt-title' value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor='pt-comp'>{t('talentReview.practicals.competencies')}</FieldLabel>
            <Input id='pt-comp' value={competencies} onChange={(e) => setCompetencies(e.target.value)} />
          </Field>
          {items.map((item, index) => (
            <div key={item.key} className='grid gap-2 rounded-md border p-2 sm:grid-cols-[1fr_auto_auto]'>
              <div className='flex flex-col gap-1'>
                <Input
                  aria-label={t('talentReview.practicals.item', { no: index + 1 })}
                  value={item.item}
                  onChange={(e) => setItems((list) => list.map((x, i) => (i === index ? { ...x, item: e.target.value } : x)))}
                />
                {item.sourceExcerpt ? (
                  <span className='text-muted-foreground text-xs'>
                    {t('talentReview.practicals.excerpt', { text: item.sourceExcerpt })}
                  </span>
                ) : null}
              </div>
              <label className='flex items-center gap-1 text-sm'>
                <Checkbox
                  checked={item.critical}
                  onCheckedChange={(value) =>
                    setItems((list) => list.map((x, i) => (i === index ? { ...x, critical: value === true } : x)))
                  }
                />
                {t('talentReview.practicals.critical')}
              </label>
              <Button size='sm' variant='ghost' onClick={() => setItems((list) => list.filter((_, i) => i !== index))}>
                {t('talentReview.common.remove')}
              </Button>
            </div>
          ))}
          <Button
            size='sm'
            variant='outline'
            className='self-start'
            onClick={() =>
              setItems((list) => [...list, { key: `item${Date.now()}`, item: '', critical: false, sourceExcerpt: null }])
            }
          >
            {t('talentReview.practicals.addItem')}
          </Button>
          <div className='grid gap-3 sm:grid-cols-3'>
            <Field>
              <FieldLabel htmlFor='pt-rate'>{t('talentReview.practicals.minPassRate')}</FieldLabel>
              <Input id='pt-rate' type='number' min={0} max={100} value={minPassRate} onChange={(e) => setMinPassRate(e.target.value)} />
            </Field>
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox checked={allCritical} onCheckedChange={(v) => setAllCritical(v === true)} />
              {t('talentReview.practicals.allCriticalPass')}
            </label>
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox checked={witness} onCheckedChange={(v) => setWitness(v === true)} />
              {t('talentReview.practicals.requiresWitness')}
            </label>
          </div>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          {template?.reviewStatus === 'draft' ? (
            <Button
              variant='outline'
              disabled={action.busy}
              onClick={() => { void (async () => {
                const done = await action.run(
                  { method: 'POST', path: `talent/practicals/templates/${encodeURIComponent(template.id)}/confirm` },
                  t('talentReview.practicals.confirmed'),
                );
                if (done) {
                  onDone();
                  onClose();
                }
              })(); }}
            >
              {t('talentReview.practicals.confirmTemplate')}
            </Button>
          ) : null}
          <Button disabled={action.busy || !title.trim() || !items.length} onClick={() => void save()}>
            {t('talentReview.common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DraftDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }): ReactElement {
  const { t } = useTranslation();
  const documents = useRemote<{ items: { id: string; title: string; docNo: string | null }[] }>('talent/kb/documents');
  const action = useTrAction();
  const [documentId, setDocumentId] = useState('');
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talentReview.practicals.draftFromDocument')}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor='pt-doc'>{t('talentReview.practicals.document')}</FieldLabel>
          <NativeSelect id='pt-doc' value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
            <NativeSelectOption value=''>—</NativeSelectOption>
            {(documents.data?.items ?? []).map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.docNo ? `${d.docNo} ` : ''}
                {d.title}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <p className='text-muted-foreground text-sm'>{t('talentReview.practicals.draftHint')}</p>
        {action.error ? (
          <Alert variant='destructive'>
            <AlertDescription>{action.error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !documentId}
            onClick={() => { void (async () => {
              const done = await action.run(
                { method: 'POST', path: 'talent/practicals/templates/draft', json: { documentId, competencyIds: [] } },
                t('talentReview.practicals.drafted'),
              );
              if (done) {
                onDone();
                onClose();
              }
            })(); }}
          >
            {t('talentReview.practicals.draft')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StartDialog({ templates, onClose }: { templates: Template[]; onClose: () => void }): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const employees = useRemote<{ id: string; name: string; departmentTitle: string }[]>('talent/practicals/employees');
  const witnesses = useRemote<{ userId: string; name: string }[]>('talent/practicals/witnesses');
  const action = useTrAction();
  const usable = templates.filter((tpl) => tpl.reviewStatus === 'confirmed' && tpl.active);
  const [assessmentId, setAssessmentId] = useState(usable[0]?.id ?? '');
  const [employeeId, setEmployeeId] = useState('');
  const [witnessUserId, setWitnessUserId] = useState('');
  const [location, setLocation] = useState('');
  const chosen = usable.find((tpl) => tpl.id === assessmentId);
  return (
    <Dialog open onOpenChange={(value) => (value ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('talentReview.practicals.start')}</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-3'>
          <Field>
            <FieldLabel htmlFor='ps-tpl'>{t('talentReview.practicals.templateTitle')}</FieldLabel>
            <NativeSelect id='ps-tpl' value={assessmentId} onChange={(e) => setAssessmentId(e.target.value)}>
              {usable.map((tpl) => (
                <NativeSelectOption key={tpl.id} value={tpl.id}>
                  {tpl.title}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='ps-emp'>{t('talentReview.practicals.person')}</FieldLabel>
            <NativeSelect id='ps-emp' value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {(employees.data ?? []).map((e) => (
                <NativeSelectOption key={e.id} value={e.id}>
                  {e.departmentTitle} · {e.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='ps-wit'>
              {t('talentReview.practicals.witness')}
              {chosen?.requiresWitness ? ` *` : ''}
            </FieldLabel>
            <NativeSelect id='ps-wit' value={witnessUserId} onChange={(e) => setWitnessUserId(e.target.value)}>
              <NativeSelectOption value=''>—</NativeSelectOption>
              {(witnesses.data ?? []).map((w) => (
                <NativeSelectOption key={w.userId} value={w.userId}>
                  {w.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor='ps-loc'>{t('talentReview.practicals.location')}</FieldLabel>
            <Textarea id='ps-loc' rows={1} value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          {action.error ? (
            <Alert variant='destructive'>
              <AlertDescription>{action.error}</AlertDescription>
            </Alert>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>
            {t('talentReview.common.cancel')}
          </Button>
          <Button
            disabled={action.busy || !assessmentId || !employeeId || (chosen?.requiresWitness && !witnessUserId)}
            onClick={() => { void (async () => {
              const created = await action.run<{ id: string }>({
                method: 'POST',
                path: 'talent/practicals/records',
                json: { assessmentId, employeeId, witnessUserId: witnessUserId || null, location: location || null },
              });
              if (created) void navigate(`records/${encodeURIComponent(created.id)}`);
            })(); }}
          >
            {t('talentReview.practicals.begin')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
