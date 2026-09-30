import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';

import { LearningRulesCard, type LearningSettings } from './rules-card.js';

/**
 * 设置 · 学习规则 (V3-09): the learning rules an HR administrator adjusts —
 * due-soon reminder days, plan expiry, the check-in window and the default
 * watch share of a video lesson. The AI employees' switches, owners and
 * thresholds stay on 设置 · AI 员工任务.
 */
export default function LearningSettingsPage(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<LearningSettings>('talent/learning-settings');
  return (
    <PageContainer className='max-w-3xl'>
      <PageHeader
        title={t('learningSettings.title')}
        description={t('learningSettings.description')}
      />
      {remote.error ? (
        <LoadError error={remote.error} onRetry={remote.reload} />
      ) : remote.data ? (
        <LearningRulesCard
          key={`learning-rules-${remote.data.revision}`}
          initial={remote.data}
          onReload={remote.reload}
        />
      ) : (
        <BlockSkeleton rows={4} />
      )}
    </PageContainer>
  );
}
