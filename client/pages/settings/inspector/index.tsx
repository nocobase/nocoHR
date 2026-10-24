import {
  useCan,
  useAuthorizationRevision,
} from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import { SettingsError, SettingsLoading } from '../shared.js';
import InspectorPage from './pages/inspector-page.js';
export default function Inspector() {
  const revision = useAuthorizationRevision();
  const permission = useCan({
    resource: { type: 'settings', id: 'authorization.inspector' },
    action: 'inspect',
  });
  const { t } = useTranslation();
  if (permission.isPending) return <SettingsLoading />;
  if (!permission.can)
    return permission.error ? (
      <SettingsError error={permission.error} retry={permission.retry} />
    ) : (
      <p role='alert'>{t('settings.denied')}</p>
    );
  // A permission/session revision must discard data and open portals from the previous scope.
  return <InspectorPage key={revision} />;
}
