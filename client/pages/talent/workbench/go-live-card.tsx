import { useCan } from '@nocobase/app-plugin-authorization/client';
import { useTranslation } from '@nocobase/i18n/client';
import type { ReactElement } from 'react';
import { Link } from 'react-router';

import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * 工作台 · 上线准备: a small entry to 设置 · 上线准备 while go-live steps the
 * viewer can see remain unfinished; nothing once every step is done or marked
 * as not needed, or for whoever may not open the checklist.
 */
export function GoLiveCard(): ReactElement | null {
  const { t } = useTranslation();
  const access = useCan({
    resource: { type: 'page', id: 'talent.goLive' },
    action: 'access',
  });
  const status = useRemote<{ remaining: number }>(
    access.can ? 'talent/go-live/status' : null,
  );
  const remaining = status.data?.remaining ?? 0;
  if (!access.can || !remaining) return null;
  return (
    <Card size='sm'>
      <CardHeader>
        <CardTitle>{t('goLive.workbench.title')}</CardTitle>
        <CardDescription>
          {t('goLive.workbench.description', { count: remaining })}
        </CardDescription>
        <CardAction>
          <Button
            variant='outline'
            size='sm'
            nativeButton={false}
            render={<Link to='/settings/go-live' />}
          >
            {t('goLive.workbench.open')}
          </Button>
        </CardAction>
      </CardHeader>
    </Card>
  );
}
