import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  CheckIcon,
  MessagesSquareIcon,
  PlayIcon,
  PlusIcon,
  SparklesIcon,
  Trash2Icon,
} from 'lucide-react';
import { useState, type ReactElement } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { errorMessage } from '@/components/talent/errors';
import {
  BlockSkeleton,
  EmptyState,
  LoadError,
} from '@/components/talent/states';
import type {
  Practice,
  PracticeScenario,
} from '@/components/talent/training-types';
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
import { Card, CardContent } from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
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
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';

interface RubricDraft {
  key: string;
  point: string;
  weight: string;
  competencyId: string;
  sourceExcerpt: string;
}

let seed = 0;
const rowKey = () => `rubric-${(seed += 1)}`;

/**
 * 陪练场景 — what the practice coach plays and how it scores. A scenario the
 * coach drafted carries "待审核" until its instructor confirms it; only
 * confirmed scenarios can be practised, added to a path or recommended.
 */
export default function PracticeScenariosPage(): ReactElement {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const review = params.get('review') === 'mine' ? 'mine' : 'all';
  const scenarios = useRemote<PracticeScenario[]>(
    'talent/practice-scenarios',
    review === 'mine' ? { review: 'mine' } : {},
  );
  const canManage = useCan({
    resource: { type: 'composite', id: 'talent.practiceScenario' },
    action: 'manage',
  });
  const openId = params.get('scenario');

  function setParam(key: string, value: string | null): void {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  }

  return (
    <PageContainer>
      <PageHeader
        title={t('navigation.talentPracticeScenarios')}
        description={t('talent.scenarios.description')}
        actions={
          canManage.can ? (
            <Button onClick={() => setParam('scenario', 'new')}>
              <PlusIcon data-icon='inline-start' />
              {t('talent.scenarios.create')}
            </Button>
          ) : null
        }
      />
      <Tabs
        value={review}
        onValueChange={(value) =>
          setParam('review', value === 'mine' ? 'mine' : null)
        }
      >
        <TabsList>
          <TabsTrigger value='all'>{t('talent.scenarios.all')}</TabsTrigger>
          <TabsTrigger value='mine'>
            {t('talent.scenarios.toReview')}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {scenarios.error ? (
        <LoadError error={scenarios.error} onRetry={scenarios.reload} />
      ) : !scenarios.data ? (
        <BlockSkeleton rows={4} />
      ) : !scenarios.data.length ? (
        <EmptyState
          title={t('talent.scenarios.empty')}
          description={t('talent.scenarios.emptyDescription')}
        />
      ) : (
        <Card>
          <CardContent className='px-0'>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('talent.scenarios.fields.title')}</TableHead>
                  <TableHead className='hidden lg:table-cell'>
                    {t('talent.scenarios.fields.document')}
                  </TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('talent.scenarios.fields.competencies')}
                  </TableHead>
                  <TableHead className='hidden md:table-cell'>
                    {t('talent.scenarios.fields.owner')}
                  </TableHead>
                  <TableHead className='hidden sm:table-cell'>
                    {t('talent.scenarios.fields.usage')}
                  </TableHead>
                  <TableHead className='hidden sm:table-cell'>
                    {t('talent.scenarios.fields.average')}
                  </TableHead>
                  <TableHead>{t('talent.scenarios.fields.status')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenarios.data.map((scenario) => (
                  <TableRow
                    key={scenario.id}
                    className='cursor-pointer'
                    onClick={() => setParam('scenario', scenario.id)}
                  >
                    <TableCell>
                      <button
                        type='button'
                        className='flex items-center gap-2 text-left font-medium hover:underline'
                        onClick={(event) => {
                          event.stopPropagation();
                          setParam('scenario', scenario.id);
                        }}
                      >
                        <MessagesSquareIcon className='size-4 text-primary' />
                        {scenario.title}
                        {scenario.source === 'ai' ? (
                          <SparklesIcon
                            className='size-3.5 text-muted-foreground'
                            aria-label={t('talent.scenarios.fromAi')}
                          />
                        ) : null}
                      </button>
                    </TableCell>
                    <TableCell className='hidden lg:table-cell'>
                      {scenario.sourceDocumentTitle}
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      <div className='flex flex-wrap gap-1'>
                        {scenario.competencies.map((c) => (
                          <Badge key={c.id} variant='outline'>
                            {c.title}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className='hidden md:table-cell'>
                      {scenario.ownerName}
                    </TableCell>
                    <TableCell className='hidden tabular-nums sm:table-cell'>
                      {scenario.usageCount}
                    </TableCell>
                    <TableCell className='hidden tabular-nums sm:table-cell'>
                      {scenario.averageScore ?? '—'}
                    </TableCell>
                    <TableCell>
                      {scenario.reviewStatus === 'draft' ? (
                        <Badge>{t('talent.scenarios.pendingReview')}</Badge>
                      ) : (
                        <Badge
                          variant={scenario.active ? 'secondary' : 'outline'}
                        >
                          {scenario.active
                            ? t('talent.scenarios.confirmed')
                            : t('talent.scenarios.inactive')}
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <ScenarioSheet
        id={openId}
        onClose={() => setParam('scenario', null)}
        onChanged={(id) => {
          scenarios.reload();
          setParam('scenario', id);
        }}
      />
    </PageContainer>
  );
}

function ScenarioSheet({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: (id: string | null) => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const competencies = useRemote<{
    competencies: {
      id: string;
      title: string;
      reviewStatus: string;
      active: boolean;
    }[];
  }>(id ? 'talent/competencies' : null);
  const scenario = useRemote<PracticeScenario>(
    id && !isNew ? `talent/practice-scenarios/${encodeURIComponent(id)}` : null,
  );
  const documents = useRemote<{ items: { id: string; title: string }[] }>(
    id ? 'talent/kb/documents' : null,
  );
  const [form, setForm] = useState({
    title: '',
    persona: '',
    situation: '',
    openingLine: '',
    sourceDocumentId: '',
    maxTurns: '12',
    passScore: '70',
  });
  const [rubric, setRubric] = useState<RubricDraft[]>([]);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const source = isNew ? null : scenario.data;
  const syncKey = isNew
    ? 'new'
    : source
      ? `${source.id}:${source.reviewStatus}`
      : null;
  if (id && syncKey && loadedFor !== syncKey) {
    setLoadedFor(syncKey);
    setError(undefined);
    setForm({
      title: source?.title ?? '',
      persona: source?.persona ?? '',
      situation: source?.situation ?? '',
      openingLine: source?.openingLine ?? '',
      sourceDocumentId: source?.sourceDocumentId ?? '',
      maxTurns: String(source?.maxTurns ?? 12),
      passScore: String(source?.passScore ?? 70),
    });
    setRubric(
      (
        source?.rubric ?? [
          { point: '', weight: 100, competencyId: null, sourceExcerpt: '' },
        ]
      ).map((r) => ({
        key: rowKey(),
        point: r.point,
        weight: String(r.weight),
        competencyId: r.competencyId ?? '',
        sourceExcerpt: r.sourceExcerpt ?? '',
      })),
    );
  }
  const editable = isNew || Boolean(source?.can.manage);
  const total = rubric.reduce((sum, r) => sum + (Number(r.weight) || 0), 0);

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        ...form,
        maxTurns: Number(form.maxTurns),
        passScore: Number(form.passScore),
        rubric: rubric.map((r) => ({
          point: r.point.trim(),
          weight: Number(r.weight),
          competencyId: r.competencyId || null,
          sourceExcerpt: r.sourceExcerpt.trim() || null,
        })),
      };
      const result = isNew
        ? await api.request<{ data: PracticeScenario }>({
            path: 'talent/practice-scenarios',
            method: 'POST',
            json,
          })
        : await api.request<{ data: PracticeScenario }>({
            path: `talent/practice-scenarios/${encodeURIComponent(id ?? '')}`,
            method: 'PATCH',
            json,
          });
      toast.add({ type: 'success', title: t('talent.scenarios.saved') });
      if (!isNew) scenario.reload();
      onChanged(result.data.id);
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function act(
    action: 'confirm' | 'discard' | 'rehearse' | 'activate' | 'deactivate',
  ): Promise<void> {
    if (!source) return;
    setBusy(true);
    setError(undefined);
    try {
      if (action === 'confirm') {
        await api.request({
          path: `talent/practice-scenarios/${encodeURIComponent(source.id)}/confirm`,
          method: 'POST',
        });
        toast.add({
          type: 'success',
          title: t('talent.scenarios.confirmedToast'),
        });
        scenario.reload();
        onChanged(source.id);
      } else if (action === 'discard') {
        await api.request({
          path: `talent/practice-scenarios/${encodeURIComponent(source.id)}`,
          method: 'DELETE',
        });
        toast.add({ type: 'success', title: t('talent.scenarios.discarded') });
        onChanged(null);
      } else if (action === 'rehearse') {
        const result = await api.request<{ data: Practice }>({
          path: 'talent/practice',
          method: 'POST',
          json: { scenarioId: source.id, rehearsal: true },
        });
        await navigate(
          `/talent/practice/${encodeURIComponent(result.data.id)}`,
        );
      } else {
        await api.request({
          path: `talent/practice-scenarios/${encodeURIComponent(source.id)}/active`,
          method: 'POST',
          json: { active: action === 'activate' },
        });
        scenario.reload();
        onChanged(source.id);
      }
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
      setDiscarding(false);
    }
  }

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  return (
    <Sheet
      open={Boolean(id)}
      onOpenChange={(next) => (!next ? onClose() : undefined)}
    >
      <SheetContent className='w-full overflow-y-auto sm:max-w-3xl'>
        <SheetHeader>
          <SheetTitle className='flex items-center gap-2'>
            {isNew
              ? t('talent.scenarios.create')
              : (source?.title ?? t('talent.scenarios.detail'))}
            {source?.reviewStatus === 'draft' ? (
              <Badge>{t('talent.scenarios.pendingReview')}</Badge>
            ) : null}
          </SheetTitle>
          <SheetDescription>{t('talent.scenarios.editHint')}</SheetDescription>
        </SheetHeader>
        <div className='px-4'>
          {scenario.error ? (
            <LoadError error={scenario.error} onRetry={scenario.reload} />
          ) : !isNew && !source ? (
            <BlockSkeleton rows={6} />
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor='scenario-title'>
                  {t('talent.scenarios.fields.title')}
                </FieldLabel>
                <Input
                  id='scenario-title'
                  disabled={!editable}
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => set('title')(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='scenario-persona'>
                  {t('talent.scenarios.fields.persona')}
                </FieldLabel>
                <Textarea
                  id='scenario-persona'
                  disabled={!editable}
                  value={form.persona}
                  maxLength={4000}
                  onChange={(e) => set('persona')(e.target.value)}
                />
                <FieldDescription>
                  {t('talent.scenarios.personaHint')}
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor='scenario-situation'>
                  {t('talent.scenarios.fields.situation')}
                </FieldLabel>
                <Textarea
                  id='scenario-situation'
                  disabled={!editable}
                  value={form.situation}
                  maxLength={4000}
                  onChange={(e) => set('situation')(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='scenario-opening'>
                  {t('talent.scenarios.fields.openingLine')}
                </FieldLabel>
                <Input
                  id='scenario-opening'
                  disabled={!editable}
                  value={form.openingLine}
                  maxLength={1000}
                  onChange={(e) => set('openingLine')(e.target.value)}
                />
              </Field>
              <div className='grid gap-4 sm:grid-cols-3'>
                <Field className='sm:col-span-3'>
                  <FieldLabel htmlFor='scenario-document'>
                    {t('talent.scenarios.fields.document')}
                  </FieldLabel>
                  <NativeSelect
                    id='scenario-document'
                    className='w-full'
                    disabled={!editable}
                    value={form.sourceDocumentId}
                    onChange={(e) => set('sourceDocumentId')(e.target.value)}
                  >
                    <NativeSelectOption value=''>
                      {t('talent.common.choose')}
                    </NativeSelectOption>
                    {(documents.data?.items ?? []).map((d) => (
                      <NativeSelectOption key={d.id} value={d.id}>
                        {d.title}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <FieldDescription>
                    {t('talent.scenarios.documentHint')}
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor='scenario-turns'>
                    {t('talent.scenarios.fields.maxTurns')}
                  </FieldLabel>
                  <Input
                    id='scenario-turns'
                    type='number'
                    min={2}
                    max={40}
                    disabled={!editable}
                    value={form.maxTurns}
                    onChange={(e) => set('maxTurns')(e.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor='scenario-pass'>
                    {t('talent.scenarios.fields.passScore')}
                  </FieldLabel>
                  <Input
                    id='scenario-pass'
                    type='number'
                    min={1}
                    max={100}
                    disabled={!editable}
                    value={form.passScore}
                    onChange={(e) => set('passScore')(e.target.value)}
                  />
                </Field>
              </div>
              <div className='space-y-3'>
                <div className='flex items-center justify-between'>
                  <p className='font-medium'>
                    {t('talent.scenarios.fields.rubric')}
                    <span
                      className={
                        total === 100
                          ? 'ml-2 text-sm text-muted-foreground'
                          : 'ml-2 text-sm text-destructive'
                      }
                    >
                      {t('talent.scenarios.weightTotal', { total })}
                    </span>
                  </p>
                  {editable ? (
                    <Button
                      size='sm'
                      variant='outline'
                      onClick={() =>
                        setRubric([
                          ...rubric,
                          {
                            key: rowKey(),
                            point: '',
                            weight: '10',
                            competencyId: '',
                            sourceExcerpt: '',
                          },
                        ])
                      }
                    >
                      <PlusIcon data-icon='inline-start' />
                      {t('talent.scenarios.addPoint')}
                    </Button>
                  ) : null}
                </div>
                <ul className='space-y-3'>
                  {rubric.map((row) => (
                    <li
                      key={row.key}
                      className='grid gap-2 rounded-md border p-3 md:grid-cols-2'
                    >
                      <div className='space-y-2'>
                        <Input
                          aria-label={t('talent.scenarios.fields.point')}
                          placeholder={t('talent.scenarios.fields.point')}
                          disabled={!editable}
                          value={row.point}
                          maxLength={500}
                          onChange={(e) =>
                            setRubric(
                              rubric.map((r) =>
                                r.key === row.key
                                  ? { ...r, point: e.target.value }
                                  : r,
                              ),
                            )
                          }
                        />
                        <div className='flex gap-2'>
                          <Input
                            type='number'
                            min={1}
                            max={100}
                            className='w-20'
                            aria-label={t('talent.scenarios.fields.weight')}
                            disabled={!editable}
                            value={row.weight}
                            onChange={(e) =>
                              setRubric(
                                rubric.map((r) =>
                                  r.key === row.key
                                    ? { ...r, weight: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          />
                          <NativeSelect
                            aria-label={t('talent.scenarios.fields.competency')}
                            className='min-w-0 flex-1'
                            disabled={!editable}
                            value={row.competencyId}
                            onChange={(e) =>
                              setRubric(
                                rubric.map((r) =>
                                  r.key === row.key
                                    ? { ...r, competencyId: e.target.value }
                                    : r,
                                ),
                              )
                            }
                          >
                            <NativeSelectOption value=''>
                              {t('talent.scenarios.noCompetency')}
                            </NativeSelectOption>
                            {(competencies.data?.competencies ?? [])
                              .filter(
                                (c) =>
                                  c.active && c.reviewStatus === 'confirmed',
                              )
                              .map((c) => (
                                <NativeSelectOption key={c.id} value={c.id}>
                                  {c.title}
                                </NativeSelectOption>
                              ))}
                          </NativeSelect>
                          {editable ? (
                            <Button
                              size='icon'
                              variant='ghost'
                              aria-label={t('talent.scenarios.removePoint')}
                              onClick={() =>
                                setRubric(
                                  rubric.filter((r) => r.key !== row.key),
                                )
                              }
                            >
                              <Trash2Icon />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      {/* The source passage beside each point, so a reviewer checks it against the source document. */}
                      <Textarea
                        aria-label={t('talent.scenarios.fields.excerpt')}
                        placeholder={t('talent.scenarios.fields.excerpt')}
                        disabled={!editable}
                        value={row.sourceExcerpt}
                        maxLength={4000}
                        className='min-h-20 bg-muted/40 text-sm'
                        onChange={(e) =>
                          setRubric(
                            rubric.map((r) =>
                              r.key === row.key
                                ? { ...r, sourceExcerpt: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </li>
                  ))}
                </ul>
              </div>
              {error ? <FieldError>{error}</FieldError> : null}
            </FieldGroup>
          )}
        </div>
        <SheetFooter className='flex-row flex-wrap justify-end gap-2'>
          {source?.can.manage ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => void act('rehearse')}
            >
              <PlayIcon data-icon='inline-start' />
              {t('talent.scenarios.rehearse')}
            </Button>
          ) : null}
          {source?.can.discard ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() => setDiscarding(true)}
            >
              <Trash2Icon data-icon='inline-start' />
              {t('talent.scenarios.discard')}
            </Button>
          ) : null}
          {source?.can.manage && source.reviewStatus === 'confirmed' ? (
            <Button
              variant='outline'
              disabled={busy}
              onClick={() =>
                void act(source.active ? 'deactivate' : 'activate')
              }
            >
              {source.active
                ? t('talent.scenarios.deactivate')
                : t('talent.scenarios.activate')}
            </Button>
          ) : null}
          {editable ? (
            <Button
              variant={source?.reviewStatus === 'draft' ? 'outline' : 'default'}
              disabled={busy}
              onClick={() => void save()}
            >
              {t('actions.save')}
            </Button>
          ) : null}
          {source?.can.confirm && source.reviewStatus === 'draft' ? (
            <Button disabled={busy} onClick={() => void act('confirm')}>
              <CheckIcon data-icon='inline-start' />
              {t('talent.scenarios.confirm')}
            </Button>
          ) : null}
        </SheetFooter>
        <AlertDialog open={discarding} onOpenChange={setDiscarding}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('talent.scenarios.discardTitle')}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('talent.scenarios.discardDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant='destructive'
                onClick={() => void act('discard')}
              >
                {t('talent.scenarios.discard')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}
