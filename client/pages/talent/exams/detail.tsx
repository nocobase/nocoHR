import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  EyeIcon,
  LockIcon,
  PlusIcon,
  SaveIcon,
  SendIcon,
  Trash2Icon,
  UndoIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  useNavigate,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { AnswerText } from '@/components/talent/answer-text';
import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
import type {
  ExamDetail,
  PaperItem,
  Question,
  QuestionType,
  RandomRule,
} from '@/components/talent/exam-types';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

import { DIFFICULTIES, QUESTION_TYPES } from '../questions/options.js';
import { DEFAULT_ANTI_CHEAT } from './anti-cheat.js';
import { AntiCheatCard } from './anti-cheat-card.js';
import { CandidatesPanel, GradingPanel } from './grading.js';
import { IntegrityPanel } from './integrity.js';
import type { ExamsOutletContext } from './types.js';

/** Routes `/talent/exams/new` and `/talent/exams/:examId`. */
export default function ExamDetailPage(): ReactElement {
  const { examId } = useParams();
  const exam = useRemote<ExamDetail>(
    examId ? `talent/exams/${encodeURIComponent(examId)}` : null,
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {examId && exam.error ? (
          <LoadError error={exam.error} onRetry={exam.reload} />
        ) : examId && !exam.data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <ExamBody
            key={examId ?? 'new'}
            exam={exam.data ?? null}
            onChanged={exam.reload}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

interface PaperRow {
  questionId: string;
  score: number;
  question: Question | null;
}

function ExamBody({
  exam,
  onChanged,
}: {
  exam: ExamDetail | null;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const outlet = useOutletContext<ExamsOutletContext | undefined>();
  const [params, setParams] = useSearchParams();
  const tab = exam ? (params.get('tab') ?? 'paper') : 'paper';
  const competencies = useRemote<{
    competencies: {
      id: string;
      title: string;
      active: boolean;
      reviewStatus: string;
    }[];
  }>('talent/competencies');
  const [settings, setSettings] = useState({
    title: exam?.title ?? '',
    description: exam?.description ?? '',
    paperMode: exam?.paperMode ?? 'random',
    durationMinutes: String(exam?.durationMinutes ?? 30),
    maxAttempts: String(exam?.maxAttempts ?? 3),
    passScore: String(exam?.passScore ?? 80),
    showAnswersAfter: exam?.showAnswersAfter ?? 'afterPass',
  });
  // V3-10 10B: 防作弊 and 简答题 AI 建议分.
  const [antiCheat, setAntiCheat] = useState(
    exam?.antiCheat ?? DEFAULT_ANTI_CHEAT,
  );
  const [aiGrading, setAiGrading] = useState(exam?.aiGrading ?? true);
  const [paper, setPaper] = useState<PaperRow[]>(
    () =>
      exam?.questions.map((q) => ({
        questionId: q.questionId,
        score: q.score,
        question: q.question,
      })) ?? [],
  );
  const [rules, setRules] = useState<RandomRule[]>(
    () =>
      exam?.randomRules.map((r) => ({ ...r })) ?? [
        {
          questionType: 'single',
          count: 5,
          scoreEach: 10,
          difficulty: null,
          competencyId: null,
        },
      ],
  );
  const [availability, setAvailability] = useState<number[]>(
    () => exam?.randomRules.map((r) => r.available) ?? [],
  );
  const [dirty, setDirty] = useState(!exam);
  const [picking, setPicking] = useState(false);
  const [preview, setPreview] = useState<{
    items: (PaperItem & { answer: unknown })[];
    totalScore: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const locked = Boolean(exam?.published);
  const canEdit = !exam || (exam.can.manage && !locked);
  const totalScore =
    settings.paperMode === 'fixed'
      ? paper.reduce((s, p) => s + p.score, 0)
      : rules.reduce((s, r) => s + r.count * r.scoreEach, 0);

  // Show how many questions each random rule can draw from, as the rules change.
  const rulesKey = JSON.stringify(rules);
  useEffect(() => {
    if (settings.paperMode !== 'random' || !canEdit) return;
    const timer = window.setTimeout(() => {
      api
        .request<{ data: number[] }>({
          path: 'talent/exams/rule-availability',
          method: 'POST',
          json: { rules },
        })
        .then((result) => setAvailability(result.data))
        .catch(() => undefined);
    }, 300);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps, @eslint-react/exhaustive-deps -- rulesKey stands for rules.
  }, [rulesKey, settings.paperMode, canEdit, api]);

  const setField = (key: keyof typeof settings, value: string) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };

  async function save(): Promise<void> {
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        ...settings,
        durationMinutes: Number(settings.durationMinutes),
        maxAttempts: Number(settings.maxAttempts),
        passScore: Number(settings.passScore),
        antiCheat,
        aiGrading,
        questions:
          settings.paperMode === 'fixed'
            ? paper.map((p) => ({ questionId: p.questionId, score: p.score }))
            : undefined,
        randomRules: settings.paperMode === 'random' ? rules : undefined,
      };
      const result = exam
        ? await api.request<{ data: ExamDetail }>({
            path: `talent/exams/${encodeURIComponent(exam.id)}`,
            method: 'PATCH',
            json,
          })
        : await api.request<{ data: ExamDetail }>({
            path: 'talent/exams',
            method: 'POST',
            json,
          });
      toast.add({ type: 'success', title: t('talent.exams.saved') });
      setDirty(false);
      outlet?.reload();
      if (exam) onChanged();
      else
        void navigate(`../${encodeURIComponent(result.data.id)}`, {
          replace: true,
          relative: 'path',
        });
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function publish(published: boolean): Promise<void> {
    if (!exam) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/exams/${encodeURIComponent(exam.id)}/publish`,
        method: 'POST',
        json: { published },
      });
      toast.add({
        type: 'success',
        title: published
          ? t('talent.exams.publishedToast')
          : t('talent.exams.unpublishedToast'),
      });
      onChanged();
      outlet?.reload();
    } catch (cause) {
      if (errorCode(cause) === 'EXAM_RULE_SHORTAGE') {
        const details = errorDetails(cause) as {
          rules?: { index: number; available: number; count: number }[];
        } | null;
        setError(
          t('talent.errors.EXAM_RULE_SHORTAGE') +
            ' ' +
            (details?.rules ?? [])
              .map((r) =>
                t('talent.exams.ruleShortage', {
                  index: r.index + 1,
                  available: r.available,
                  count: r.count,
                }),
              )
              .join('；'),
        );
      } else setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  async function openPreview(): Promise<void> {
    if (!exam) return;
    try {
      const result = await api.request<{
        data: {
          items: (PaperItem & { answer: unknown })[];
          totalScore: number;
        };
      }>({ path: `talent/exams/${encodeURIComponent(exam.id)}/preview` });
      setPreview(result.data);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  const competencyOptions = (competencies.data?.competencies ?? []).filter(
    (c) => c.active && c.reviewStatus === 'confirmed',
  );

  return (
    <>
      <PageHeader
        title={
          <span className='flex flex-wrap items-center gap-3'>
            {exam ? exam.title : t('talent.exams.create')}
            {exam ? (
              <Badge variant={exam.published ? 'secondary' : 'outline'}>
                {exam.published
                  ? t('talent.exams.published')
                  : t('talent.exams.unpublished')}
              </Badge>
            ) : null}
          </span>
        }
        description={
          exam
            ? t('talent.exams.summary', {
                count: exam.questionCount,
                score: exam.totalScore,
                minutes: exam.durationMinutes,
                pass: exam.passScore,
              })
            : t('talent.exams.createDescription')
        }
        actions={
          <>
            {exam?.can.manage ? (
              <Button variant='outline' onClick={() => void openPreview()}>
                <EyeIcon data-icon='inline-start' />
                {t('talent.exams.previewPaper')}
              </Button>
            ) : null}
            {exam?.can.publish && exam.active ? (
              locked ? (
                <Button
                  variant='outline'
                  disabled={busy}
                  onClick={() => void publish(false)}
                >
                  <UndoIcon data-icon='inline-start' />
                  {t('talent.courses.unpublish')}
                </Button>
              ) : (
                <Button
                  variant='outline'
                  disabled={busy || dirty}
                  onClick={() => void publish(true)}
                >
                  <SendIcon data-icon='inline-start' />
                  {t('talent.courses.publish')}
                </Button>
              )
            ) : null}
            {canEdit ? (
              <Button disabled={busy || !dirty} onClick={() => void save()}>
                <SaveIcon data-icon='inline-start' />
                {t('actions.save')}
              </Button>
            ) : null}
          </>
        }
      />
      {exam ? (
        <Tabs
          value={tab}
          onValueChange={(value) =>
            setParams(value === 'paper' ? {} : { tab: String(value) }, {
              replace: true,
            })
          }
        >
          <TabsList>
            <TabsTrigger value='paper'>
              {t('talent.exams.tabs.paper')}
            </TabsTrigger>
            {exam.can.grade ? (
              <TabsTrigger value='grading'>
                {t('talent.exams.tabs.grading')}
                {exam.grading ? (
                  <Badge className='ml-1'>{exam.grading}</Badge>
                ) : null}
              </TabsTrigger>
            ) : null}
            {exam.can.reviewIntegrity ? (
              <TabsTrigger value='integrity'>
                {t('talent.examIntegrity.tab')}
                {exam.flagged ? (
                  <Badge variant='destructive' className='ml-1'>
                    {exam.flagged}
                  </Badge>
                ) : null}
              </TabsTrigger>
            ) : null}
            {exam.can.grade ? (
              <TabsTrigger value='candidates'>
                {t('talent.exams.tabs.candidates')}
              </TabsTrigger>
            ) : null}
          </TabsList>
        </Tabs>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}

      {tab === 'grading' && exam ? (
        <GradingPanel examId={exam.id} onGraded={onChanged} />
      ) : tab === 'integrity' && exam ? (
        <IntegrityPanel
          examId={exam.id}
          canVoid={exam.can.voidAttempt}
          onChanged={onChanged}
        />
      ) : tab === 'candidates' && exam ? (
        <CandidatesPanel examId={exam.id} canReset={exam.can.resetAttempts} />
      ) : (
        <>
          {locked ? (
            <Alert>
              <LockIcon />
              <AlertTitle>{t('talent.exams.lockedTitle')}</AlertTitle>
              <AlertDescription>
                {t('talent.exams.lockedDescription')}
              </AlertDescription>
            </Alert>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.exams.settings')}</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <div className='grid gap-4 md:grid-cols-2'>
                  <Field>
                    <FieldLabel htmlFor='exam-title'>
                      {t('talent.exams.fields.title')}
                    </FieldLabel>
                    <Input
                      id='exam-title'
                      value={settings.title}
                      disabled={!canEdit}
                      onChange={(e) => setField('title', e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='exam-mode'>
                      {t('talent.exams.fields.paperMode')}
                    </FieldLabel>
                    <NativeSelect
                      id='exam-mode'
                      className='w-full'
                      value={settings.paperMode}
                      disabled={!canEdit}
                      onChange={(e) => setField('paperMode', e.target.value)}
                    >
                      <NativeSelectOption value='random'>
                        {t('talent.exams.paperModes.random')}
                      </NativeSelectOption>
                      <NativeSelectOption value='fixed'>
                        {t('talent.exams.paperModes.fixed')}
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor='exam-description'>
                    {t('talent.exams.fields.description')}
                  </FieldLabel>
                  <Textarea
                    id='exam-description'
                    rows={2}
                    value={settings.description}
                    disabled={!canEdit}
                    onChange={(e) => setField('description', e.target.value)}
                  />
                </Field>
                <div className='grid gap-4 sm:grid-cols-4'>
                  <Field>
                    <FieldLabel htmlFor='exam-duration'>
                      {t('talent.exams.fields.durationMinutes')}
                    </FieldLabel>
                    <Input
                      id='exam-duration'
                      type='number'
                      min={1}
                      value={settings.durationMinutes}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setField('durationMinutes', e.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='exam-attempts'>
                      {t('talent.exams.fields.maxAttempts')}
                    </FieldLabel>
                    <Input
                      id='exam-attempts'
                      type='number'
                      min={1}
                      value={settings.maxAttempts}
                      disabled={!canEdit}
                      onChange={(e) => setField('maxAttempts', e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='exam-pass'>
                      {t('talent.exams.fields.passScore')}
                    </FieldLabel>
                    <Input
                      id='exam-pass'
                      type='number'
                      min={0}
                      max={100}
                      value={settings.passScore}
                      disabled={!canEdit}
                      onChange={(e) => setField('passScore', e.target.value)}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor='exam-answers'>
                      {t('talent.exams.fields.showAnswersAfter')}
                    </FieldLabel>
                    <NativeSelect
                      id='exam-answers'
                      className='w-full'
                      value={settings.showAnswersAfter}
                      disabled={!canEdit}
                      onChange={(e) =>
                        setField('showAnswersAfter', e.target.value)
                      }
                    >
                      {(['afterPass', 'afterSubmit', 'never'] as const).map(
                        (v) => (
                          <NativeSelectOption key={v} value={v}>
                            {t(`talent.exams.showAnswers.${v}`)}
                          </NativeSelectOption>
                        ),
                      )}
                    </NativeSelect>
                  </Field>
                </div>
              </FieldGroup>
            </CardContent>
          </Card>

          <AntiCheatCard
            value={antiCheat}
            aiGrading={aiGrading}
            disabled={!canEdit}
            onChange={(value) => {
              setAntiCheat(value);
              setDirty(true);
            }}
            onAiGradingChange={(value) => {
              setAiGrading(value);
              setDirty(true);
            }}
          />

          <Card>
            <CardHeader className='flex flex-row items-center justify-between gap-2'>
              <CardTitle>
                {settings.paperMode === 'fixed'
                  ? t('talent.exams.fixedPaper')
                  : t('talent.exams.randomRules')}{' '}
                · {t('talent.exams.totalScore', { score: totalScore })}
              </CardTitle>
              {canEdit ? (
                settings.paperMode === 'fixed' ? (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => setPicking(true)}
                  >
                    <PlusIcon data-icon='inline-start' />
                    {t('talent.exams.addQuestions')}
                  </Button>
                ) : (
                  <Button
                    size='sm'
                    variant='outline'
                    onClick={() => {
                      setRules((r) => [
                        ...r,
                        {
                          questionType: 'single',
                          count: 1,
                          scoreEach: 10,
                          difficulty: null,
                          competencyId: null,
                        },
                      ]);
                      setDirty(true);
                    }}
                  >
                    <PlusIcon data-icon='inline-start' />
                    {t('talent.exams.addRule')}
                  </Button>
                )
              ) : null}
            </CardHeader>
            <CardContent>
              {settings.paperMode === 'fixed' ? (
                paper.length ? (
                  <ol className='divide-y rounded-md border'>
                    {paper.map((row, index) => (
                      <li
                        key={row.questionId}
                        className='flex flex-wrap items-center gap-3 p-3 text-sm'
                      >
                        <span className='w-6 text-muted-foreground tabular-nums'>
                          {index + 1}.
                        </span>
                        <span className='min-w-0 flex-1'>
                          <Badge variant='outline' className='mr-2'>
                            {row.question
                              ? t(`talent.questionType.${row.question.type}`)
                              : '—'}
                          </Badge>
                          {row.question?.stem ?? row.questionId}
                        </span>
                        <Input
                          type='number'
                          min={1}
                          className='w-20'
                          aria-label={t('talent.exams.questionScore')}
                          value={row.score}
                          disabled={!canEdit}
                          onChange={(e) => {
                            setPaper((p) =>
                              p.map((r, i) =>
                                i === index
                                  ? { ...r, score: Number(e.target.value) || 0 }
                                  : r,
                              ),
                            );
                            setDirty(true);
                          }}
                        />
                        {canEdit ? (
                          <span className='flex'>
                            <Button
                              size='icon-xs'
                              variant='ghost'
                              aria-label={t('talent.courses.moveUp')}
                              disabled={index === 0}
                              onClick={() => {
                                setPaper((p) => {
                                  const n = [...p];
                                  [n[index - 1], n[index]] = [
                                    n[index],
                                    n[index - 1],
                                  ];
                                  return n;
                                });
                                setDirty(true);
                              }}
                            >
                              <ArrowUpIcon />
                            </Button>
                            <Button
                              size='icon-xs'
                              variant='ghost'
                              aria-label={t('talent.courses.moveDown')}
                              disabled={index === paper.length - 1}
                              onClick={() => {
                                setPaper((p) => {
                                  const n = [...p];
                                  [n[index + 1], n[index]] = [
                                    n[index],
                                    n[index + 1],
                                  ];
                                  return n;
                                });
                                setDirty(true);
                              }}
                            >
                              <ArrowDownIcon />
                            </Button>
                            <Button
                              size='icon-xs'
                              variant='ghost'
                              aria-label={t('talent.common.remove')}
                              onClick={() => {
                                setPaper((p) =>
                                  p.filter((_, i) => i !== index),
                                );
                                setDirty(true);
                              }}
                            >
                              <Trash2Icon />
                            </Button>
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('talent.exams.noQuestions')}
                  </p>
                )
              ) : (
                <div className='overflow-x-auto'>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>
                          {t('talent.questions.fields.type')}
                        </TableHead>
                        <TableHead>
                          {t('talent.questions.fields.difficulty')}
                        </TableHead>
                        <TableHead>
                          {t('talent.questions.fields.competencies')}
                        </TableHead>
                        <TableHead className='text-right'>
                          {t('talent.exams.ruleCount')}
                        </TableHead>
                        <TableHead className='text-right'>
                          {t('talent.exams.scoreEach')}
                        </TableHead>
                        <TableHead className='text-right'>
                          {t('talent.exams.available')}
                        </TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rules.map((rule, index) => {
                        const available = availability[index];
                        const update = (patch: Partial<RandomRule>) => {
                          setRules((r) =>
                            r.map((x, i) =>
                              i === index ? { ...x, ...patch } : x,
                            ),
                          );
                          setDirty(true);
                        };
                        return (
                          // eslint-disable-next-line @eslint-react/no-array-index-key -- rules have no id; their position is their identity.
                          <TableRow key={index}>
                            <TableCell>
                              <NativeSelect
                                value={rule.questionType}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  update({
                                    questionType: e.target
                                      .value as QuestionType,
                                  })
                                }
                                aria-label={t('talent.questions.fields.type')}
                              >
                                {QUESTION_TYPES.map((type) => (
                                  <NativeSelectOption key={type} value={type}>
                                    {t(`talent.questionType.${type}`)}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </TableCell>
                            <TableCell>
                              <NativeSelect
                                value={rule.difficulty ?? ''}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  update({ difficulty: e.target.value || null })
                                }
                                aria-label={t(
                                  'talent.questions.fields.difficulty',
                                )}
                              >
                                <NativeSelectOption value=''>
                                  {t('talent.exams.any')}
                                </NativeSelectOption>
                                {DIFFICULTIES.map((d) => (
                                  <NativeSelectOption key={d} value={d}>
                                    {t(`talent.difficulty.${d}`)}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </TableCell>
                            <TableCell>
                              <NativeSelect
                                value={rule.competencyId ?? ''}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  update({
                                    competencyId: e.target.value || null,
                                  })
                                }
                                aria-label={t(
                                  'talent.questions.fields.competencies',
                                )}
                              >
                                <NativeSelectOption value=''>
                                  {t('talent.exams.any')}
                                </NativeSelectOption>
                                {competencyOptions.map((c) => (
                                  <NativeSelectOption key={c.id} value={c.id}>
                                    {c.title}
                                  </NativeSelectOption>
                                ))}
                              </NativeSelect>
                            </TableCell>
                            <TableCell className='text-right'>
                              <Input
                                type='number'
                                min={1}
                                className='ml-auto w-20'
                                value={rule.count}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  update({ count: Number(e.target.value) || 0 })
                                }
                                aria-label={t('talent.exams.ruleCount')}
                              />
                            </TableCell>
                            <TableCell className='text-right'>
                              <Input
                                type='number'
                                min={1}
                                className='ml-auto w-20'
                                value={rule.scoreEach}
                                disabled={!canEdit}
                                onChange={(e) =>
                                  update({
                                    scoreEach: Number(e.target.value) || 0,
                                  })
                                }
                                aria-label={t('talent.exams.scoreEach')}
                              />
                            </TableCell>
                            <TableCell
                              className={
                                available !== undefined &&
                                available < rule.count
                                  ? 'text-right font-medium text-destructive tabular-nums'
                                  : 'text-right tabular-nums'
                              }
                            >
                              {available ?? '—'}
                            </TableCell>
                            <TableCell className='text-right'>
                              {canEdit ? (
                                <Button
                                  size='icon-sm'
                                  variant='ghost'
                                  aria-label={t('talent.common.remove')}
                                  disabled={rules.length <= 1}
                                  onClick={() => {
                                    setRules((r) =>
                                      r.filter((_, i) => i !== index),
                                    );
                                    setDirty(true);
                                  }}
                                >
                                  <Trash2Icon />
                                </Button>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <QuestionPicker
        open={picking}
        onOpenChange={setPicking}
        exclude={paper.map((p) => p.questionId)}
        onPick={(questions) => {
          setPaper((p) => [
            ...p,
            ...questions.map((q) => ({
              questionId: q.id,
              score: 10,
              question: q,
            })),
          ]);
          setDirty(true);
        }}
      />
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => (!open ? setPreview(null) : undefined)}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>{t('talent.exams.previewPaper')}</DialogTitle>
            <DialogDescription>
              {t('talent.exams.previewDescription', {
                score: preview?.totalScore ?? 0,
              })}
            </DialogDescription>
          </DialogHeader>
          <ol className='max-h-[60svh] space-y-3 overflow-y-auto pr-1 text-sm'>
            {preview?.items.map((item, index) => (
              <li key={item.questionId} className='rounded-md border p-3'>
                <p className='font-medium'>
                  {index + 1}. {item.stem}{' '}
                  <span className='text-muted-foreground'>
                    （{t('talent.exams.points', { score: item.score })}）
                  </span>
                </p>
                {item.options.length ? (
                  <ul className='mt-1 space-y-0.5 text-muted-foreground'>
                    {item.options.map((o) => (
                      <li key={o.key}>
                        {o.key}. {o.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className='mt-1 text-xs'>
                  {t('talent.questions.fields.answer')}：
                  <AnswerText
                    type={item.type}
                    value={item.answer}
                    options={item.options}
                  />
                </p>
              </li>
            ))}
          </ol>
        </DialogContent>
      </Dialog>
    </>
  );
}

function QuestionPicker({
  open,
  onOpenChange,
  exclude,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  exclude: readonly string[];
  onPick: (questions: Question[]) => void;
}): ReactElement {
  const { t } = useTranslation();
  const [type, setType] = useState('');
  const list = useRemote<{ items: Question[] }>(
    open ? 'talent/questions' : null,
    { status: 'confirmed', type: type || undefined },
  );
  const [selected, setSelected] = useState<string[]>([]);
  const items = useMemo(
    () =>
      (list.data?.items ?? []).filter(
        (q) => q.active && !exclude.includes(q.id),
      ),
    [list.data, exclude],
  );
  // Each opening starts with nothing selected.
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setSelected([]);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{t('talent.exams.addQuestions')}</DialogTitle>
          <DialogDescription>
            {t('talent.exams.pickerDescription')}
          </DialogDescription>
        </DialogHeader>
        <NativeSelect
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label={t('talent.questions.fields.type')}
        >
          <NativeSelectOption value=''>
            {t('talent.questions.allTypes')}
          </NativeSelectOption>
          {QUESTION_TYPES.map((qt) => (
            <NativeSelectOption key={qt} value={qt}>
              {t(`talent.questionType.${qt}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ul className='max-h-[50svh] space-y-1 overflow-y-auto rounded-md border p-1'>
          {items.map((q) => (
            <li key={q.id}>
              <label className='flex cursor-pointer items-start gap-2 rounded px-2 py-2 text-sm hover:bg-muted'>
                <Checkbox
                  checked={selected.includes(q.id)}
                  onCheckedChange={(checked) =>
                    setSelected((s) =>
                      checked === true
                        ? [...s, q.id]
                        : s.filter((id) => id !== q.id),
                    )
                  }
                />
                <Badge variant='outline'>
                  {t(`talent.questionType.${q.type}`)}
                </Badge>
                <span className='min-w-0 flex-1'>{q.stem}</span>
              </label>
            </li>
          ))}
          {!items.length ? (
            <li className='p-3 text-center text-sm text-muted-foreground'>
              {t('talent.exams.noConfirmedQuestions')}
            </li>
          ) : null}
        </ul>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button
            disabled={!selected.length}
            onClick={() => {
              onPick(items.filter((q) => selected.includes(q.id)));
              onOpenChange(false);
            }}
          >
            {t('talent.exams.addCount', { count: selected.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
