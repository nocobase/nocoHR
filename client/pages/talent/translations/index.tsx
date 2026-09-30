/**
 * V4-13 译文审核 (`/talent/translations`, instructors their own content,
 * hr.admin all): the English versions the content writer drafted (待我审核
 * first), the ones marked 待更新 after the original changed, and the
 * confirmed ones. A translation opens as the child page `:type/:id`, the
 * original beside the draft.
 */
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link, Outlet } from 'react-router';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, EmptyState, LoadError } from '@/components/talent/states';
import { TrStatusBadge } from '@/components/talent/talent-review-shared';
import { useRemote } from '@/components/talent/use-remote';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Item {
  type: string;
  id: string;
  originalTitle: string;
  title: string;
  reviewStatus: string;
  translationStatus: string;
}

export default function TranslationsPage(): ReactElement {
  const { t } = useTranslation();
  const list = useRemote<{ items: Item[] }>('talent/translations');
  return (
    <PageContainer>
      <PageHeader title={t('talentReview.translations.title')} description={t('talentReview.translations.description')} />
      {list.error ? (
        <LoadError error={list.error} onRetry={list.reload} />
      ) : !list.data ? (
        <BlockSkeleton rows={3} />
      ) : !list.data.items.length ? (
        <EmptyState title={t('talentReview.translations.empty')} />
      ) : (
        <div className='overflow-x-auto rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('talentReview.translations.original')}</TableHead>
                <TableHead>{t('talentReview.translations.type')}</TableHead>
                <TableHead>{t('talentReview.translations.english')}</TableHead>
                <TableHead>{t('talentReview.common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Link
                      className='font-medium underline-offset-4 hover:underline'
                      to={`${item.type}/${encodeURIComponent(item.id)}`}
                    >
                      {item.originalTitle}
                    </Link>
                  </TableCell>
                  <TableCell>{t(`talentReview.translations.types.${item.type}`)}</TableCell>
                  <TableCell className='max-w-72 truncate'>{item.title}</TableCell>
                  <TableCell className='flex gap-1'>
                    <TrStatusBadge status={item.reviewStatus} />
                    {item.translationStatus === 'outdated' ? <TrStatusBadge status='outdated' /> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Outlet context={{ reload: list.reload }} />
    </PageContainer>
  );
}
