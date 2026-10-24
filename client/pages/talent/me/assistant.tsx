import { useTranslation } from '@nocobase/i18n/client';
import { RouteDrawer } from '#components/route-drawer';
import { UnifiedAssistant } from '#components/talent/unified-assistant';

/** Existing employee route and grant; new chats use the official HR tool scope. */
export default function MyHrAssistantDrawer() {
  const { t } = useTranslation();
  return (
    <RouteDrawer
      title={t('talent.me.assistant.title')}
      description={t('talent.me.assistant.description')}
      className='sm:max-w-xl'
    >
      <UnifiedAssistant layout='panel' />
    </RouteDrawer>
  );
}
