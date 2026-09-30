import {
  NotificationInAppInbox,
  NotificationInAppProvider,
} from '@nocobase/app-plugin-notification-in-app/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';

import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';

/**
 * 通知 (站内信): the signed-in user's in-app inbox — reminders, approvals and
 * what the AI employees prepared (转正准备, 续签准备, …). The in-app plugin
 * only ships a development page; this is the production surface its Skill
 * asks for, an authenticated App route reached from the header bell.
 */
export default function InboxPage(): ReactElement {
  const { t } = useTranslation();
  return (
    <PageContainer>
      <PageHeader
        title={t('inbox.title')}
        description={t('inbox.description')}
      />
      <NotificationInAppProvider>
        <NotificationInAppInbox />
      </NotificationInAppProvider>
    </PageContainer>
  );
}
