import { useTranslation } from '@nocobase/i18n/client';
import { AlertCircleIcon, InboxIcon } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';

import { errorMessage, isForbidden } from './errors.js';

export function LoadError({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const forbidden = isForbidden(error);
  return (
    <Alert variant='destructive'>
      <AlertCircleIcon />
      <AlertTitle>{t('talent.common.loadFailed')}</AlertTitle>
      <AlertDescription>{errorMessage(error, t)}</AlertDescription>
      {forbidden || !onRetry ? null : (
        <AlertAction>
          <Button variant='outline' size='sm' onClick={onRetry}>
            {t('status.retry')}
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}

export function BlockSkeleton({ rows = 4 }: { rows?: number }): ReactElement {
  const { t } = useTranslation();
  return (
    <div className='space-y-2' role='status' aria-label={t('status.loading')}>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className='h-10 w-full' />
      ))}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): ReactElement {
  return (
    <Empty className='border'>
      <EmptyHeader>
        <EmptyMedia variant='icon'>
          <InboxIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action}
    </Empty>
  );
}
