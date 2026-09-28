import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  EyeIcon,
  GripVerticalIcon,
  LockIcon,
  PlusIcon,
  PowerIcon,
  QuoteIcon,
  SaveIcon,
  SendIcon,
  SparklesIcon,
  Trash2Icon,
  UndoIcon,
} from 'lucide-react';
import { useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate, useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { CourseStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type {
  CourseDetail,
  KbDocument,
} from '@/components/talent/learning-types';
import { Markdown } from '@/components/talent/markdown';
import { MultiCheckList } from '@/components/talent/multi-check';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import type { CoursesOutletContext } from './types.js';
import { VideoLessonFields } from './video-field.js';

interface LessonDraft {
  readonly key: string;
  readonly id: string | null;
  title: string;
  content: string;
  sourceExcerpt: string | null;
  estimatedMinutes: string;
  contentType: 'markdown' | 'video';
  videoFileId: string | null;
  videoSeconds: string;
  minWatchPercent: string;
}

let keySeed = 0;
const nextKey = () => `lesson-${(keySeed += 1)}`;

/** Routes `/talent/courses/new` and `/talent/courses/:courseId`. */
export default function CourseEditorPage(): ReactElement {
  const { courseId } = useParams();
  const course = useRemote<CourseDetail>(
    courseId ? `talent/courses/${encodeURIComponent(courseId)}` : null,
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {courseId && course.error ? (
          <LoadError error={course.error} onRetry={course.reload} />
        ) : courseId && !course.data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <Editor
            key={courseId ?? 'new'}
            course={course.data ?? null}
            onChanged={course.reload}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function Editor({
  course,
  onChanged,
}: {
  course: CourseDetail | null;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const navigate = useNavigate();
  const [discarding, setDiscarding] = useState(false);

  async function discard(): Promise<void> {
    if (!course) return;
    try {
      await api.request({
        path: `talent/courses/${encodeURIComponent(course.id)}`,
        method: 'DELETE',
      });
      toast.add({ type: 'success', title: t('talent.courses.discarded') });
      outlet?.reload();
      void navigate('..', { relative: 'path' });
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }
  const outlet = useOutletContext<CoursesOutletContext | undefined>();
  const documents = useRemote<{ items: KbDocument[] }>('talent/kb/documents');
  const competencies = useRemote<{
    competencies: {
      id: string;
      title: string;
      category: string;
      reviewStatus: string;
      active: boolean;
    }[];
  }>('talent/competencies');
  const canWrite = useCan({
    resource: { type: 'composite', id: 'talent.contentWriter' },
    action: 'use',
  });
  const canDraftQuestions = useCan({
    resource: { type: 'composite', id: 'talent.question' },
    action: 'manage',
  });
  const [title, setTitle] = useState(course?.title ?? '');
  const [description, setDescription] = useState(course?.description ?? '');
  const [sourceDocumentId, setSourceDocumentId] = useState(
    course?.sourceDocumentId ?? '',
  );
  const [competencyIds, setCompetencyIds] = useState<string[]>(
    course?.competencies.map((c) => c.id) ?? [],
  );
  const [lessons, setLessons] = useState<LessonDraft[]>(
    () =>
      course?.lessons.map((l) => ({
        key: nextKey(),
        id: l.id,
        title: l.title,
        content: l.content,
        sourceExcerpt: l.sourceExcerpt,
        estimatedMinutes:
          l.estimatedMinutes === null ? '' : String(l.estimatedMinutes),
        contentType: l.contentType,
        videoFileId: l.videoFileId,
        videoSeconds: l.videoSeconds === null ? '' : String(l.videoSeconds),
        minWatchPercent: String(l.minWatchPercent),
      })) ?? [],
  );
  const [deliveryMode, setDeliveryMode] = useState<'online' | 'offline'>(
    course?.deliveryMode ?? 'online',
  );
  const [selected, setSelected] = useState(0);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [dirty, setDirty] = useState(!course);
  const [dragging, setDragging] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const locked = Boolean(course?.published);
  const canEdit = !course || (course.can.manage && !locked);
  const lesson = lessons[selected];

  // Removing the last lesson moves the selection back onto one that exists.
  if (selected > 0 && selected >= lessons.length)
    setSelected(Math.max(0, lessons.length - 1));

  const touch =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setDirty(true);
    };
  const updateLesson = (patch: Partial<LessonDraft>) => {
    setLessons((current) =>
      current.map((l, i) => (i === selected ? { ...l, ...patch } : l)),
    );
    setDirty(true);
  };
  const move = (from: number, to: number) => {
    if (to < 0 || to >= lessons.length || from === to) return;
    setLessons((current) => {
      const next = [...current];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setSelected(to);
    setDirty(true);
  };

  async function save(): Promise<void> {
    if (!title.trim()) {
      setError(t('talent.form.required'));
      return;
    }
    if (
      lessons.some(
        (l) =>
          !l.title.trim() ||
          (l.contentType === 'video'
            ? !l.videoFileId || !Number(l.videoSeconds)
            : !l.content.trim()),
      )
    ) {
      setError(t('talent.courses.lessonIncomplete'));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const json = {
        title: title.trim(),
        description: description.trim() || null,
        sourceDocumentId: sourceDocumentId || null,
        competencyIds,
        deliveryMode,
        lessons: lessons.map((l) => ({
          id: l.id,
          title: l.title.trim(),
          content: l.content,
          sourceExcerpt: l.sourceExcerpt,
          estimatedMinutes:
            l.estimatedMinutes === '' ? null : Number(l.estimatedMinutes),
          contentType: l.contentType,
          videoFileId: l.contentType === 'video' ? l.videoFileId : null,
          videoSeconds:
            l.contentType === 'video' && l.videoSeconds !== ''
              ? Number(l.videoSeconds)
              : null,
          minWatchPercent:
            l.contentType === 'video' ? Number(l.minWatchPercent) || 90 : null,
        })),
      };
      const result = course
        ? await api.request<{ data: CourseDetail }>({
            path: `talent/courses/${encodeURIComponent(course.id)}`,
            method: 'PATCH',
            json,
          })
        : await api.request<{ data: CourseDetail }>({
            path: 'talent/courses',
            method: 'POST',
            json,
          });
      toast.add({ type: 'success', title: t('talent.courses.saved') });
      setDirty(false);
      outlet?.reload();
      if (course) onChanged();
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

  async function act(
    path: string,
    json: unknown,
    message: string,
  ): Promise<void> {
    if (!course) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.request({
        path: `talent/courses/${encodeURIComponent(course.id)}/${path}`,
        method: 'POST',
        json,
      });
      toast.add({ type: 'success', title: message });
      onChanged();
      outlet?.reload();
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(false);
    }
  }

  const actions: ReactNode[] = [];
  if (course && canWrite.can && canDraftQuestions.can) {
    actions.push(
      <AssistantLauncher
        key='questions'
        employee='contentWriter'
        chatId={`writer-questions-${course.id}`}
        label={t('talent.courses.generateQuestions')}
        icon={<SparklesIcon data-icon='inline-start' />}
        task={() => ({
          title: t('talent.courses.generateQuestionsTitle', {
            title: course.title,
          }),
          system: `The user is on course "${course.title}" (courseId ${course.id}). Call getCourse with this courseId first, then propose exam questions drawn from its lessons.`,
          user: t('talent.courses.generateQuestionsPrompt', {
            title: course.title,
          }),
        })}
      />,
    );
  }
  // A draft that was never published can be discarded outright; a published course is disabled instead.
  if (
    course?.can.discard &&
    course.reviewStatus === 'draft' &&
    !course.published &&
    !course.learnerCount
  ) {
    actions.push(
      <Button
        key='discard'
        variant='outline'
        disabled={busy}
        onClick={() => setDiscarding(true)}
      >
        <Trash2Icon data-icon='inline-start' />
        {t('talent.courses.discard')}
      </Button>,
    );
  }
  if (course?.can.publish) {
    actions.push(
      <Button
        key='active'
        variant='outline'
        disabled={busy}
        onClick={() =>
          void act(
            'active',
            { active: !course.active },
            course.active
              ? t('talent.courses.disabled')
              : t('talent.courses.enabled'),
          )
        }
      >
        <PowerIcon data-icon='inline-start' />
        {course.active ? t('talent.common.disable') : t('talent.common.enable')}
      </Button>,
    );
  }
  if (course?.can.confirm && course.reviewStatus === 'draft' && !locked) {
    actions.push(
      <Button
        key='confirm'
        variant='outline'
        disabled={busy || dirty}
        onClick={() => void act('confirm', {}, t('talent.courses.confirmed'))}
      >
        <CheckCircle2Icon data-icon='inline-start' />
        {t('talent.courses.confirm')}
      </Button>,
    );
  }
  if (course?.can.publish && course.active) {
    actions.push(
      locked ? (
        <Button
          key='unpublish'
          variant='outline'
          disabled={busy}
          onClick={() =>
            void act(
              'publish',
              { published: false },
              t('talent.courses.unpublished'),
            )
          }
        >
          <UndoIcon data-icon='inline-start' />
          {t('talent.courses.unpublish')}
        </Button>
      ) : (
        <Button
          key='publish'
          variant='outline'
          disabled={busy || dirty || course.reviewStatus !== 'confirmed'}
          onClick={() =>
            void act(
              'publish',
              { published: true },
              t('talent.courses.publishedToast'),
            )
          }
        >
          <SendIcon data-icon='inline-start' />
          {t('talent.courses.publish')}
        </Button>
      ),
    );
  }
  if (canEdit) {
    actions.push(
      <Button key='save' disabled={busy || !dirty} onClick={() => void save()}>
        <SaveIcon data-icon='inline-start' />
        {t('actions.save')}
      </Button>,
    );
  }

  const competencyOptions = (competencies.data?.competencies ?? [])
    .filter((c) => c.active && c.reviewStatus === 'confirmed')
    .map((c) => ({
      value: c.id,
      label: c.title,
      hint: t(`talent.category.${c.category}`),
    }));

  return (
    <>
      <PageHeader
        title={
          <span className='flex flex-wrap items-center gap-3'>
            {course ? course.title : t('talent.courses.create')}
            {course ? <CourseStatusBadge status={course.status} /> : null}
          </span>
        }
        description={
          course
            ? [
                course.ownerName,
                course.source === 'ai' ? t('talent.courses.aiDraft') : null,
              ]
                .filter(Boolean)
                .join(' · ')
            : t('talent.courses.createDescription')
        }
        actions={<>{actions}</>}
      />
      {locked ? (
        <Alert>
          <LockIcon />
          <AlertTitle>{t('talent.courses.lockedTitle')}</AlertTitle>
          <AlertDescription>
            {t('talent.courses.lockedDescription')}
          </AlertDescription>
        </Alert>
      ) : course && course.reviewStatus === 'draft' && course.can.confirm ? (
        <p className='text-sm text-muted-foreground'>
          {dirty
            ? t('talent.courses.saveBeforeConfirm')
            : t('talent.courses.draftHint')}
        </p>
      ) : null}
      {error ? <FieldError>{error}</FieldError> : null}

      <Card>
        <CardHeader>
          <CardTitle>{t('talent.courses.basic')}</CardTitle>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className='grid gap-4 md:grid-cols-2'>
              <Field>
                <FieldLabel htmlFor='course-title'>
                  {t('talent.courses.fields.title')}
                </FieldLabel>
                <Input
                  id='course-title'
                  value={title}
                  disabled={!canEdit}
                  maxLength={200}
                  onChange={(e) => touch(setTitle)(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor='course-source'>
                  {t('talent.courses.fields.sourceDocument')}
                </FieldLabel>
                <NativeSelect
                  id='course-source'
                  className='w-full'
                  value={sourceDocumentId}
                  disabled={!canEdit}
                  onChange={(e) => touch(setSourceDocumentId)(e.target.value)}
                >
                  <NativeSelectOption value=''>
                    {t('talent.common.none')}
                  </NativeSelectOption>
                  {(documents.data?.items ?? []).map((d) => (
                    <NativeSelectOption key={d.id} value={d.id}>
                      {d.title}
                    </NativeSelectOption>
                  ))}
                </NativeSelect>
              </Field>
              <Field>
                <FieldLabel htmlFor='course-delivery'>
                  {t('talent.courses.fields.deliveryMode')}
                </FieldLabel>
                <NativeSelect
                  id='course-delivery'
                  className='w-full'
                  value={deliveryMode}
                  disabled={!canEdit}
                  onChange={(e) =>
                    touch(setDeliveryMode)(
                      e.target.value as 'online' | 'offline',
                    )
                  }
                >
                  <NativeSelectOption value='online'>
                    {t('talent.courses.deliveryMode.online')}
                  </NativeSelectOption>
                  <NativeSelectOption value='offline'>
                    {t('talent.courses.deliveryMode.offline')}
                  </NativeSelectOption>
                </NativeSelect>
                {deliveryMode === 'offline' ? (
                  <FieldDescription>
                    {t('talent.courses.offlineHint')}
                  </FieldDescription>
                ) : null}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor='course-description'>
                {t('talent.courses.fields.description')}
              </FieldLabel>
              <Textarea
                id='course-description'
                rows={2}
                value={description}
                disabled={!canEdit}
                onChange={(e) => touch(setDescription)(e.target.value)}
              />
            </Field>
            {canEdit ? (
              <Field>
                <FieldLabel>
                  {t('talent.courses.fields.competencies')}
                </FieldLabel>
                <MultiCheckList
                  options={competencyOptions}
                  value={competencyIds}
                  onChange={touch(setCompetencyIds)}
                  label={t('talent.courses.fields.competencies')}
                  height='h-28'
                />
              </Field>
            ) : (
              <p className='text-sm text-muted-foreground'>
                {t('talent.courses.fields.competencies')}：
                {course?.competencies.map((c) => c.title).join('、') || '—'}
              </p>
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      <div className='grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]'>
        <Card className='self-start'>
          <CardHeader className='flex flex-row items-center justify-between'>
            <CardTitle>{t('talent.courses.lessons')}</CardTitle>
            {canEdit ? (
              <Button
                size='sm'
                variant='outline'
                onClick={() => {
                  setLessons((current) => [
                    ...current,
                    {
                      key: nextKey(),
                      id: null,
                      title: t('talent.courses.newLesson', {
                        index: current.length + 1,
                      }),
                      content: '',
                      sourceExcerpt: null,
                      estimatedMinutes: '',
                      contentType: 'markdown',
                      videoFileId: null,
                      videoSeconds: '',
                      minWatchPercent: '90',
                    },
                  ]);
                  setSelected(lessons.length);
                  setDirty(true);
                }}
              >
                <PlusIcon data-icon='inline-start' />
                {t('talent.courses.addLesson')}
              </Button>
            ) : null}
          </CardHeader>
          <CardContent className='px-2'>
            {!lessons.length ? (
              <p className='px-2 text-sm text-muted-foreground'>
                {t('talent.courses.noLessons')}
              </p>
            ) : (
              <ol className='space-y-1'>
                {lessons.map((item, i) => (
                  <li
                    key={item.key}
                    draggable={canEdit}
                    onDragStart={() => setDragging(i)}
                    onDragOver={(e) => {
                      if (dragging !== null) e.preventDefault();
                    }}
                    onDrop={() => {
                      if (dragging !== null) move(dragging, i);
                      setDragging(null);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={cn(
                      'flex items-center gap-1 rounded-md',
                      i === selected && 'bg-muted',
                      dragging === i && 'opacity-50',
                    )}
                  >
                    {canEdit ? (
                      <GripVerticalIcon
                        className='size-4 shrink-0 cursor-grab text-muted-foreground'
                        aria-hidden
                      />
                    ) : null}
                    <button
                      type='button'
                      className='min-w-0 flex-1 truncate px-1 py-2 text-left text-sm'
                      onClick={() => setSelected(i)}
                      aria-current={i === selected ? 'step' : undefined}
                    >
                      {i + 1}.{' '}
                      {item.title || t('talent.courses.untitledLesson')}
                    </button>
                    {canEdit ? (
                      <span className='flex shrink-0'>
                        <Button
                          size='icon-xs'
                          variant='ghost'
                          aria-label={t('talent.courses.moveUp')}
                          disabled={i === 0}
                          onClick={() => move(i, i - 1)}
                        >
                          <ArrowUpIcon />
                        </Button>
                        <Button
                          size='icon-xs'
                          variant='ghost'
                          aria-label={t('talent.courses.moveDown')}
                          disabled={i === lessons.length - 1}
                          onClick={() => move(i, i + 1)}
                        >
                          <ArrowDownIcon />
                        </Button>
                        <Button
                          size='icon-xs'
                          variant='ghost'
                          aria-label={t('talent.common.remove')}
                          onClick={() => {
                            setLessons((current) =>
                              current.filter((_, index) => index !== i),
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
            )}
          </CardContent>
        </Card>

        {lesson ? (
          <div
            className={cn(
              'grid gap-4',
              lesson.sourceExcerpt && 'xl:grid-cols-[minmax(0,1fr)_18rem]',
            )}
          >
            <Card>
              <CardHeader className='flex flex-row items-center justify-between gap-2'>
                <CardTitle>{t('talent.courses.lessonEditor')}</CardTitle>
                <Tabs
                  value={mode}
                  onValueChange={(value) =>
                    setMode(value as 'edit' | 'preview')
                  }
                >
                  <TabsList>
                    <TabsTrigger value='edit' disabled={!canEdit}>
                      {t('talent.common.edit')}
                    </TabsTrigger>
                    <TabsTrigger value='preview'>
                      <EyeIcon />
                      {t('talent.courses.preview')}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                {mode === 'edit' && canEdit ? (
                  <FieldGroup>
                    <div className='grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem_8rem]'>
                      <Field>
                        <FieldLabel htmlFor='lesson-title'>
                          {t('talent.courses.fields.lessonTitle')}
                        </FieldLabel>
                        <Input
                          id='lesson-title'
                          value={lesson.title}
                          maxLength={200}
                          onChange={(e) =>
                            updateLesson({ title: e.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor='lesson-minutes'>
                          {t('talent.courses.fields.lessonMinutes')}
                        </FieldLabel>
                        <Input
                          id='lesson-minutes'
                          type='number'
                          min={0}
                          max={600}
                          value={lesson.estimatedMinutes}
                          onChange={(e) =>
                            updateLesson({ estimatedMinutes: e.target.value })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor='lesson-type'>
                          {t('talent.courses.fields.lessonType')}
                        </FieldLabel>
                        <NativeSelect
                          id='lesson-type'
                          className='w-full'
                          value={lesson.contentType}
                          onChange={(e) =>
                            updateLesson({
                              contentType: e.target.value as
                                'markdown' | 'video',
                            })
                          }
                        >
                          <NativeSelectOption value='markdown'>
                            {t('talent.courses.lessonType.markdown')}
                          </NativeSelectOption>
                          <NativeSelectOption value='video'>
                            {t('talent.courses.lessonType.video')}
                          </NativeSelectOption>
                        </NativeSelect>
                      </Field>
                    </div>
                    {lesson.contentType === 'video' ? (
                      <VideoLessonFields
                        lessonId={lesson.id}
                        videoFileId={lesson.videoFileId}
                        videoSeconds={lesson.videoSeconds}
                        minWatchPercent={lesson.minWatchPercent}
                        onChange={(patch) => updateLesson(patch)}
                      />
                    ) : null}
                    <Field>
                      <FieldLabel htmlFor='lesson-content'>
                        {lesson.contentType === 'video'
                          ? t('talent.courses.fields.videoNote')
                          : t('talent.courses.fields.lessonContent')}
                      </FieldLabel>
                      <Textarea
                        id='lesson-content'
                        rows={16}
                        className='font-mono text-sm'
                        value={lesson.content}
                        onChange={(e) =>
                          updateLesson({ content: e.target.value })
                        }
                      />
                    </Field>
                  </FieldGroup>
                ) : (
                  <div className='space-y-3'>
                    <h3 className='font-heading text-lg font-semibold'>
                      {lesson.title}
                    </h3>
                    <Markdown>
                      {lesson.content || t('talent.courses.emptyLesson')}
                    </Markdown>
                  </div>
                )}
              </CardContent>
            </Card>
            {lesson.sourceExcerpt ? (
              <Card className='self-start'>
                <CardHeader>
                  <CardTitle className='flex items-center gap-2'>
                    <QuoteIcon className='size-4' />
                    {t('talent.courses.sourceExcerpt')}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className='text-sm whitespace-pre-wrap text-muted-foreground'>
                    {lesson.sourceExcerpt}
                  </p>
                </CardContent>
              </Card>
            ) : null}
          </div>
        ) : null}
      </div>
      <AlertDialog open={discarding} onOpenChange={setDiscarding}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('talent.courses.discardTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('talent.courses.discardDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              variant='destructive'
              onClick={() => void discard()}
            >
              {t('talent.courses.discard')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
