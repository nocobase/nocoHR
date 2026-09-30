import { useApiClient } from '@nocobase/app-client';
import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import {
  CalendarCheckIcon,
  DownloadIcon,
  PencilIcon,
  PowerIcon,
  SparklesIcon,
  TriangleAlertIcon,
  UploadIcon,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  Link,
  Outlet,
  useOutletContext,
  useParams,
  useSearchParams,
} from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { AssistantLauncher } from '@/components/talent/ai-chat';
import { ParseStatusBadge } from '@/components/talent/badges';
import { downloadFile } from '@/components/talent/download';
import { errorMessage } from '@/components/talent/errors';
import type { KbDocumentDetail } from '@/components/talent/learning-types';
import { Markdown } from '@/components/talent/markdown';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';

import { DocumentDialog } from './document-dialog.js';
import { ChangesCard, MarkReviewedDialog, VersionsCard } from './versions.js';
// V3-11
import { DocumentRevisionPanel } from '@/components/talent/profile/document-revision-panel';
import { ReviewDate } from './review-date.js';
import type { DocumentOutletContext, KnowledgeOutletContext } from './types.js';

/** Route `/talent/knowledge/:documentId`: metadata, the extracted text by section, the original file. */
export default function DocumentDetailPage(): ReactElement {
  const { documentId = '' } = useParams();
  const document = useRemote<KbDocumentDetail>(
    `talent/kb/documents/${encodeURIComponent(documentId)}`,
  );
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {document.error ? (
          <LoadError error={document.error} onRetry={document.reload} />
        ) : !document.data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <DocumentBody
            key={documentId}
            document={document.data}
            onChanged={document.reload}
          />
        )}
      </PageContainer>
    </RouteChildPage>
  );
}

function DocumentBody({
  document,
  onChanged,
}: {
  document: KbDocumentDetail;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const { locale } = useLocale();
  const api = useApiClient();
  const outlet = useOutletContext<KnowledgeOutletContext | undefined>();
  const [params] = useSearchParams();
  const canWrite = useCan({
    resource: { type: 'composite', id: 'talent.contentWriter' },
    action: 'use',
  });
  const canDraftQuestions = useCan({
    resource: { type: 'composite', id: 'talent.question' },
    action: 'manage',
  });
  const requested = params.get('section');
  const [open, setOpen] = useState<string[]>(() =>
    requested !== null
      ? [`section-${requested}`]
      : document.sections.slice(0, 1).map((s) => `section-${s.index}`),
  );
  const [editOpen, setEditOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const superseded = Boolean(document.supersededById);
  const canUploadVersion =
    Boolean(document.can?.uploadVersion) && !superseded && document.active;
  const canMarkReviewed = Boolean(document.can?.markReviewed) && !superseded;
  const reloadList = outlet?.reload;
  const childContext = useMemo<DocumentOutletContext>(
    () => ({
      document,
      reload: () => {
        onChanged();
        reloadList?.();
      },
    }),
    [document, onChanged, reloadList],
  );

  // A citation opens the document at its section: expand it, then bring it into view.
  const [expandedFor, setExpandedFor] = useState(requested);
  if (requested !== expandedFor) {
    setExpandedFor(requested);
    if (requested !== null && !open.includes(`section-${requested}`))
      setOpen([...open, `section-${requested}`]);
  }
  useEffect(() => {
    if (requested === null) return;
    const timer = window.setTimeout(
      () =>
        window.document
          .getElementById(`section-${requested}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      80,
    );
    return () => window.clearTimeout(timer);
  }, [requested]);

  async function toggleActive(): Promise<void> {
    try {
      await api.request({
        path: `talent/kb/documents/${encodeURIComponent(document.id)}/active`,
        method: 'POST',
        json: { active: !document.active },
      });
      toast.add({
        type: 'success',
        title: document.active
          ? t('talent.knowledge.disabled')
          : t('talent.knowledge.enabled'),
      });
      onChanged();
      outlet?.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    }
  }

  const meta: [string, React.ReactNode][] = [
    [t('knowledgeService.fields.docNo'), document.docNo ?? '—'],
    [t('knowledgeService.fields.version'), document.version ?? '—'],
    [
      t('knowledgeService.fields.effectiveDate'),
      document.effectiveDate
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(`${document.effectiveDate}T00:00:00`),
          )
        : '—',
    ],
    [
      t('talent.knowledge.fields.category'),
      t(`talent.docCategory.${document.category}`),
    ],
    [t('talent.knowledge.fields.owner'), document.ownerName ?? '—'],
    [
      t('talent.knowledge.fields.visibility'),
      document.visibility === 'all'
        ? t('talent.visibility.all')
        : [...document.departments, ...document.positions]
            .map((x) => x.title)
            .join('、'),
    ],
    [
      t('talent.knowledge.fields.reviewDate'),
      <ReviewDate key='review' date={document.reviewDate} />,
    ],
    [
      t('knowledgeService.fields.lastReviewedAt'),
      document.lastReviewedAt
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
            new Date(document.lastReviewedAt),
          )
        : '—',
    ],
    [
      t('talent.knowledge.fields.competencies'),
      document.competencies.length ? (
        <span key='competencies' className='flex flex-wrap gap-1'>
          {document.competencies.map((c) => (
            <Badge key={c.id} variant='outline'>
              {c.title}
            </Badge>
          ))}
        </span>
      ) : (
        '—'
      ),
    ],
  ];

  return (
    <>
      <PageHeader
        title={
          <span className='flex flex-wrap items-center gap-3'>
            {document.title}
            <ParseStatusBadge status={document.parseStatus} />
            {!document.active ? (
              <Badge variant='outline'>{t('talent.common.disabled')}</Badge>
            ) : null}
          </span>
        }
        description={document.file?.filename}
        actions={
          <>
            {document.file ? (
              <Button
                variant='outline'
                onClick={() =>
                  void downloadFile(
                    api,
                    `talent/kb/documents/${encodeURIComponent(document.id)}/download`,
                    document.file!.filename,
                  ).catch((cause: unknown) =>
                    toast.add({ type: 'error', title: errorMessage(cause, t) }),
                  )
                }
              >
                <DownloadIcon data-icon='inline-start' />
                {t('talent.knowledge.download')}
              </Button>
            ) : null}
            {canWrite.can && document.canManage ? (
              <AssistantLauncher
                employee='contentWriter'
                chatId={`writer-${document.id}`}
                label={t('talent.knowledge.generateCourse')}
                icon={<SparklesIcon data-icon='inline-start' />}
                disabled={document.parseStatus !== 'ready' || !document.active}
                task={() => ({
                  title: t('talent.knowledge.generateCourseTitle', {
                    title: document.title,
                  }),
                  system: `The user is on knowledge document "${document.title}" (documentId ${document.id}). Call getDocument with this documentId first, then propose a course outline.`,
                  user: t('talent.knowledge.generateCoursePrompt', {
                    title: document.title,
                  }),
                })}
              />
            ) : null}
            {canWrite.can && canDraftQuestions.can ? (
              <AssistantLauncher
                employee='contentWriter'
                chatId={`writer-questions-${document.id}`}
                label={t('talent.knowledge.generateQuestions')}
                icon={<SparklesIcon data-icon='inline-start' />}
                disabled={document.parseStatus !== 'ready' || !document.active}
                task={() => ({
                  title: t('talent.knowledge.generateQuestionsTitle', {
                    title: document.title,
                  }),
                  system: `The user is on knowledge document "${document.title}" (documentId ${document.id}). Call getDocument with this documentId first, then propose exam questions citing the source passages.`,
                  user: t('talent.knowledge.generateQuestionsPrompt', {
                    title: document.title,
                  }),
                })}
              />
            ) : null}
            {canMarkReviewed ? (
              <Button variant='outline' onClick={() => setReviewOpen(true)}>
                <CalendarCheckIcon data-icon='inline-start' />
                {t('knowledgeService.review.mark')}
              </Button>
            ) : null}
            {canUploadVersion ? (
              <Button
                variant='outline'
                nativeButton={false}
                render={<Link to='versions/new' />}
              >
                <UploadIcon data-icon='inline-start' />
                {t('knowledgeService.version.upload')}
              </Button>
            ) : null}
            {document.canManage ? (
              <>
                <Button variant='outline' onClick={() => void toggleActive()}>
                  <PowerIcon data-icon='inline-start' />
                  {document.active
                    ? t('talent.common.disable')
                    : t('talent.common.enable')}
                </Button>
                <Button onClick={() => setEditOpen(true)}>
                  <PencilIcon data-icon='inline-start' />
                  {t('talent.common.edit')}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      {superseded ? (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>
            {t('knowledgeService.version.supersededBy', {
              version: document.supersededByVersion ?? '',
            })}
          </AlertTitle>
          <AlertDescription>
            <span>{t('knowledgeService.version.supersededHint')}</span>
            <Link
              to={`/talent/knowledge/${encodeURIComponent(document.supersededById ?? '')}`}
              className='text-primary underline-offset-4 hover:underline'
            >
              {t('knowledgeService.version.openCurrent')}
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className='grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]'>
        <div className='space-y-4 self-start'>
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.knowledge.meta')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className='space-y-3 text-sm'>
                {meta.map(([label, value]) => (
                  <div key={label}>
                    <dt className='text-muted-foreground'>{label}</dt>
                    <dd className='mt-0.5'>{value}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <VersionsCard document={document} />
          {document.canManage ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('talent.knowledge.courses')}</CardTitle>
              </CardHeader>
              <CardContent>
                {document.courses.length ? (
                  <ul className='space-y-2 text-sm'>
                    {document.courses.map((course) => (
                      <li
                        key={course.id}
                        className='flex flex-wrap items-center justify-between gap-2'
                      >
                        <Link
                          to={`/talent/courses/${encodeURIComponent(course.id)}`}
                          className='text-primary underline-offset-4 hover:underline'
                        >
                          {course.title}
                        </Link>
                        {course.reviewStatus === 'draft' ? (
                          <Badge
                            variant={
                              course.source === 'ai' ? 'default' : 'outline'
                            }
                          >
                            {course.source === 'ai'
                              ? t('talent.courses.pendingReview')
                              : t('talent.courseStatus.draft')}
                          </Badge>
                        ) : (
                          <Badge variant='secondary'>
                            {course.published
                              ? t('talent.courseStatus.published')
                              : t('talent.courseStatus.confirmed')}
                          </Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className='text-sm text-muted-foreground'>
                    {t('talent.knowledge.noCourses')}
                  </p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
        <div className='min-w-0 space-y-4'>
          <ChangesCard document={document} />
          {/* V3-11: the content writer's change note, the change brief and the revision suggestions of this version. */}
          <DocumentRevisionPanel documentId={document.id} />
          <Card>
            <CardHeader>
              <CardTitle>{t('talent.knowledge.content')}</CardTitle>
            </CardHeader>
            <CardContent>
              {document.parseStatus === 'failed' ? (
                <p className='text-sm text-destructive'>
                  {t('talent.knowledge.parseFailed', {
                    reason: document.parseError ?? '',
                  })}
                </p>
              ) : document.parseStatus === 'pending' ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.knowledge.parsing')}
                </p>
              ) : !document.sections.length ? (
                <p className='text-sm text-muted-foreground'>
                  {t('talent.knowledge.noContent')}
                </p>
              ) : (
                <Accordion
                  multiple
                  value={open}
                  onValueChange={(value) => setOpen(value as string[])}
                >
                  {document.sections.map((section) => (
                    <AccordionItem
                      key={section.index}
                      value={`section-${section.index}`}
                      id={`section-${section.index}`}
                      className='scroll-mt-24'
                    >
                      <AccordionTrigger>
                        {section.title || t('talent.knowledge.untitledSection')}
                      </AccordionTrigger>
                      <AccordionContent>
                        <Markdown>{section.text}</Markdown>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <MarkReviewedDialog
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        document={document}
        onReviewed={() => {
          onChanged();
          outlet?.reload();
        }}
      />
      <Outlet context={childContext} />
      <DocumentDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        document={document}
        onSaved={() => {
          onChanged();
          outlet?.reload();
        }}
      />
    </>
  );
}
