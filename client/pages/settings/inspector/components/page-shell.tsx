import type { ReactNode } from 'react';
import { PageContainer } from '#components/page-container';
import { PageHeader } from '#components/page-header';
import { Button } from '#components/ui/button';
import { SettingsLoading } from '../../shared.js';
import { ErrorBox } from './feedback.js';
import { useAuthorizationTranslation } from '../i18n.js';
export function PermissionsPage({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <PageContainer>
      <PageHeader title={title} description={description} />
      {children}
    </PageContainer>
  );
}
export const PageLoading = SettingsLoading;
export function PageForbidden({ message }: { message: string }) {
  return <ErrorBox value={message} />;
}
export function PageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const t = useAuthorizationTranslation();
  return (
    <>
      <ErrorBox value={message} />
      <Button onClick={onRetry}>
        {t('authorizationInspector.common.retry')}
      </Button>
    </>
  );
}
