import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  MessageCircleQuestionIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { AssignmentStatusBadge } from '@/components/talent/badges';
import { errorMessage } from '@/components/talent/errors';
import type { LearnerCourse } from '@/components/talent/learning-types';
import { Markdown } from '@/components/talent/markdown';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

import type { LearningOutletContext } from './types.js';
import { VideoLesson } from './video-lesson.js';

/** Route `/talent/learning/:courseId`: lessons with completion marks, the lesson body, and "complete this lesson". */
export default function LearnCoursePage(): ReactElement {
  const { courseId = '' } = useParams();
  const course = useRemote<LearnerCourse>(
    `talent/learning/courses/${encodeURIComponent(courseId)}`,
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {course.error ? (
          <LoadError error={course.error} onRetry={course.reload} />
        ) : !course.data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <CourseBody
            key={courseId}
            data={course.data}
            onChanged={course.reload}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function CourseBody({
  data,
  onChanged,
}: {
  data: LearnerCourse;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const outlet = useOutletContext<LearningOutletContext | undefined>();
  const canAsk = useCan({
    resource: { type: 'composite', id: 'talent.knowledgeAssistant' },
    action: 'use',
  });
  const firstOpen = Math.max(
    0,
    data.lessons.findIndex((lesson) => !lesson.completed),
  );
  const [index, setIndex] = useState(firstOpen);
  const [busy, setBusy] = useState(false);
  // Whether the server says the current video lesson has been watched enough.
  const [videoReady, setVideoReady] = useState<Record<string, boolean>>({});
  const offline = data.course.deliveryMode === 'offline';
  // When the current lesson was opened; set by the effect below whenever the lesson changes.
  const openedAt = useRef(0);
  const lesson = data.lessons[index];
  const done = data.lessons.filter((l) => l.completed).length;
  const progress = data.lessons.length
    ? Math.round((done / data.lessons.length) * 100)
    : 0;

  useEffect(() => {
    openedAt.current = Date.now();
  }, [index]);

  async function complete(): Promise<void> {
    if (!lesson) return;
    setBusy(true);
    try {
      const result = await api.request<{ data: LearnerCourse }>({
        path: 'talent/learning/progress',
        method: 'POST',
        json: {
          courseId: data.course.id,
          lessonId: lesson.id,
          assignmentId: data.assignment?.id ?? null,
          durationSeconds: Math.round((Date.now() - openedAt.current) / 1000),
        },
      });
      const finished = result.data.lessons.every((l) => l.completed);
      toast.add({
        type: 'success',
        title: finished
          ? t('talent.learning.courseCompleted')
          : t('talent.learning.lessonCompleted'),
      });
      onChanged();
      outlet?.reload();
      if (!finished && index < data.lessons.length - 1) setIndex(index + 1);
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={data.course.title}
        description={data.course.description ?? undefined}
        actions={
          canAsk.can ? (
            <AssistantLauncher
              employee='knowledgeAssistant'
              chatId={`learning-${data.course.id}`}
              label={t('talent.learning.ask')}
              icon={<MessageCircleQuestionIcon data-icon='inline-start' />}
              task={() => ({
                title: t('talent.learning.askTitle', {
                  title: data.course.title,
                }),
                system: `The learner is studying course "${data.course.title}" (courseId ${data.course.id}), currently on lesson "${lesson?.title ?? ''}". Call getCourseContext with this courseId if the question relates to the course, and answer factual questions from searchKnowledge.`,
                user: '',
              })}
            />
          ) : null
        }
      />
      <div className='flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
        {data.assignment ? (
          <AssignmentStatusBadge status={data.assignment.status} />
        ) : null}
        <span className='tabular-nums'>
          {t('talent.learning.lessonsDone', {
            done,
            total: data.lessons.length,
          })}
        </span>
        {data.assignment?.dueDate ? (
          <span>
            {t('talent.learning.due', {
              date: new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
              }).format(new Date(`${data.assignment.dueDate}T00:00:00`)),
            })}
          </span>
        ) : null}
        <Progress
          value={progress}
          className='w-40'
          aria-label={t('talent.learning.progress')}
        />
      </div>

      {/* On narrow screens the lesson list collapses into a picker above the lesson. */}
      <div className='md:hidden'>
        <NativeSelect
          className='w-full'
          value={String(index)}
          onChange={(event) => setIndex(Number(event.target.value))}
          aria-label={t('talent.learning.lessons')}
        >
          {data.lessons.map((item, i) => (
            <NativeSelectOption key={item.id} value={String(i)}>
              {`${item.completed ? '✓ ' : ''}${i + 1}. ${item.title}`}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <div className='grid gap-4 md:grid-cols-[16rem_minmax(0,1fr)]'>
        <Card className='hidden self-start md:block'>
          <CardHeader>
            <CardTitle>{t('talent.learning.lessons')}</CardTitle>
          </CardHeader>
          <CardContent className='px-2'>
            <ol className='space-y-1'>
              {data.lessons.map((item, i) => (
                <li key={item.id}>
                  <button
                    type='button'
                    onClick={() => setIndex(i)}
                    aria-current={i === index ? 'step' : undefined}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted',
                      i === index && 'bg-muted font-medium',
                    )}
                  >
                    {item.completed ? (
                      <CheckCircle2Icon className='mt-0.5 size-4 shrink-0 text-primary' />
                    ) : (
                      <CircleIcon className='mt-0.5 size-4 shrink-0 text-muted-foreground' />
                    )}
                    <span className='min-w-0 flex-1'>
                      {i + 1}. {item.title}
                      {item.estimatedMinutes ? (
                        <span className='block text-xs font-normal text-muted-foreground'>
                          {t('talent.learning.minutes', {
                            count: item.estimatedMinutes,
                          })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>

        {lesson ? (
          <Card>
            <CardHeader>
              <CardTitle className='text-lg'>
                {index + 1}. {lesson.title}
              </CardTitle>
            </CardHeader>
            <CardContent className='space-y-6'>
              {lesson.contentType === 'video' ? (
                <VideoLesson
                  key={lesson.id}
                  courseId={data.course.id}
                  lesson={lesson}
                  onProgress={(state) =>
                    setVideoReady((previous) => ({
                      ...previous,
                      [lesson.id]: state.canComplete,
                    }))
                  }
                />
              ) : null}
              {lesson.content ? <Markdown>{lesson.content}</Markdown> : null}
              <div className='flex flex-wrap items-center justify-between gap-2 border-t pt-4'>
                <Button
                  variant='outline'
                  disabled={index === 0}
                  onClick={() => setIndex(index - 1)}
                >
                  <ChevronLeftIcon data-icon='inline-start' />
                  {t('talent.learning.previous')}
                </Button>
                {offline ? (
                  // An offline course completes by attending a session; its lessons are handouts.
                  <span className='text-sm text-muted-foreground'>
                    {t('talent.learning.offlineHint')}
                  </span>
                ) : lesson.completed ? (
                  <span className='inline-flex items-center gap-1.5 text-sm text-muted-foreground'>
                    <CheckCircle2Icon className='size-4 text-primary' />
                    {t('talent.learning.lessonDone')}
                  </span>
                ) : (
                  <Button
                    disabled={
                      busy ||
                      (lesson.contentType === 'video' &&
                        !(
                          videoReady[lesson.id] ??
                          (lesson.videoSeconds
                            ? (lesson.watchedSeconds / lesson.videoSeconds) *
                                100 >=
                              lesson.minWatchPercent
                            : true)
                        ))
                    }
                    onClick={() => void complete()}
                  >
                    <CheckCircle2Icon data-icon='inline-start' />
                    {t('talent.learning.completeLesson')}
                  </Button>
                )}
                <Button
                  variant='outline'
                  disabled={index >= data.lessons.length - 1}
                  onClick={() => setIndex(index + 1)}
                >
                  {t('talent.learning.next')}
                  <ChevronRightIcon data-icon='inline-end' />
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className='text-sm text-muted-foreground'>
            {t('talent.learning.noLessons')}
          </p>
        )}
      </div>
    </>
  );
}
