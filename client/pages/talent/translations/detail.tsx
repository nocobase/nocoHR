/**
 * V4-13 译文审核详情 (`/talent/translations/:type/:translationId`): the
 * original and the English draft side by side. The reviewer edits the texts
 * (a course's lessons with it) and confirms; numbers, units and document
 * codes should stay as in the original.
 */
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { useOutletContext, useParams } from 'react-router';

import { Breadcrumbs } from '@/components/breadcrumbs';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { RouteChildPage } from '@/components/route-child-page';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useTrAction } from '@/components/talent/talent-review-lib';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

type Texts = Record<string, unknown>;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
interface Detail {
  type: string;
  id: string;
  reviewStatus: string;
  translationStatus: string;
  original: Texts;
  translation: Texts;
}

/** The editable text fields of a type (lessons of a course are listed separately). */
const FIELDS: Record<string, string[]> = {
  course: ['title', 'description'],
  question: ['stem', 'explanation'],
  document: ['title', 'contentText'],
  scenario: ['title', 'persona', 'situation', 'openingLine'],
};

export default function TranslationDetailPage(): ReactElement {
  const { t } = useTranslation();
  const { type = '', translationId = '' } = useParams();
  const outlet = useOutletContext<{ reload?: () => void } | undefined>();
  const path = `talent/translations/${encodeURIComponent(type)}/${encodeURIComponent(translationId)}`;
  const detail = useRemote<Detail>(path);
  const action = useTrAction();
  const [fields, setFields] = useState<Texts>({});
  const data = detail.data;
  const reload = () => {
    setFields({});
    detail.reload();
    outlet?.reload?.();
  };
  const value = (key: string) => text(fields[key] ?? data?.translation[key]);
  const lessons = (data?.translation.lessons ?? []) as { id: string; title: string; content: string }[];
  const originalLessons = (data?.original.lessons ?? []) as { id: string; title: string; content: string }[];
  const editedLessons = (fields.lessons ?? lessons) as typeof lessons;
  const editable = data?.reviewStatus === 'draft';
  return (
    <RouteChildPage>
      <PageContainer>
        <Breadcrumbs />
        {detail.error ? (
          <LoadError error={detail.error} onRetry={detail.reload} />
        ) : !data ? (
          <BlockSkeleton rows={6} />
        ) : (
          <>
            <PageHeader
              title={text(data.original.title ?? data.original.stem)}
              description={t('talentReview.translations.detailDescription')}
              actions={
                <div className='flex items-center gap-2'>
                  <TrStatusBadge status={data.reviewStatus} />
                  {data.translationStatus === 'outdated' ? <TrStatusBadge status='outdated' /> : null}
                </div>
              }
            />
            {action.error ? (
              <Alert variant='destructive'>
                <AlertDescription>{action.error}</AlertDescription>
              </Alert>
            ) : null}
            {(FIELDS[data.type] ?? []).map((key) => (
              <div key={key} className='grid gap-2 md:grid-cols-2'>
                <div className='flex flex-col gap-1'>
                  <span className='text-muted-foreground text-xs'>{t(`talentReview.translations.fields.${key}`)} · {t('talentReview.translations.original')}</span>
                  <p className='bg-muted/40 rounded-md border p-2 text-sm whitespace-pre-wrap'>{text(data.original[key])}</p>
                </div>
                <div className='flex flex-col gap-1'>
                  <span className='text-muted-foreground text-xs'>{t(`talentReview.translations.fields.${key}`)} · {t('talentReview.translations.english')}</span>
                  <Textarea
                    aria-label={t(`talentReview.translations.fields.${key}`)}
                    disabled={!editable}
                    value={value(key)}
                    onChange={(e) => setFields((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              </div>
            ))}
            {editedLessons.map((lesson, index) => {
              const source = originalLessons.find((l) => l.id === lesson.id);
              return (
                <div key={lesson.id} className='grid gap-2 md:grid-cols-2'>
                  <div className='bg-muted/40 rounded-md border p-2 text-sm whitespace-pre-wrap'>
                    <div className='font-medium'>{source?.title}</div>
                    {source?.content}
                  </div>
                  <div className='flex flex-col gap-1'>
                    <Textarea
                      aria-label={t('talentReview.translations.lessonTitle', { no: index + 1 })}
                      disabled={!editable}
                      rows={1}
                      value={lesson.title}
                      onChange={(e) =>
                        setFields((f) => ({
                          ...f,
                          lessons: editedLessons.map((l, i) => (i === index ? { ...l, title: e.target.value } : l)),
                        }))
                      }
                    />
                    <Textarea
                      aria-label={t('talentReview.translations.lessonContent', { no: index + 1 })}
                      disabled={!editable}
                      rows={6}
                      value={lesson.content}
                      onChange={(e) =>
                        setFields((f) => ({
                          ...f,
                          lessons: editedLessons.map((l, i) => (i === index ? { ...l, content: e.target.value } : l)),
                        }))
                      }
                    />
                  </div>
                </div>
              );
            })}
            {editable ? (
              <div className='flex justify-end gap-2'>
                <Button
                  variant='outline'
                  disabled={action.busy || !Object.keys(fields).length}
                  onClick={() => { void (async () => {
                    const done = await action.run({ method: 'PUT', path, json: { fields } }, t('talentReview.translations.saved'));
                    if (done) reload();
                  })(); }}
                >
                  {t('talentReview.common.save')}
                </Button>
                <Button
                  disabled={action.busy}
                  onClick={() => { void (async () => {
                    if (Object.keys(fields).length) {
                      const saved = await action.run({ method: 'PUT', path, json: { fields } });
                      if (!saved) return;
                    }
                    const done = await action.run({ method: 'POST', path: `${path}/confirm` }, t('talentReview.translations.confirmed'));
                    if (done) reload();
                  })(); }}
                >
                  {t('talentReview.translations.confirm')}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </PageContainer>
    </RouteChildPage>
  );
}
