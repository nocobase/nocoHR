import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

interface ChannelSetting {
  readonly provider: 'feishu' | 'dingtalk' | 'wecom';
  readonly bound: boolean;
  readonly enabled: boolean;
}
interface Settings {
  readonly inbox: true;
  readonly channels: readonly ChannelSetting[];
}

/**
 * 我的档案 · 通知设置 (V1-04): the in-app inbox is always on; each office suite
 * the user is bound to can be switched off, after which only the inbox
 * receives HR notifications. Stored per user by `talent/notification-channels`
 * (server/providers/hr/im-cards/push.ts). Only bound channels are listed.
 */
export function NotificationSettingsCard(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<Settings>('talent/notification-channels');
  const [saving, setSaving] = useState(false);
  const [override, setOverride] = useState<Settings | null>(null);
  const data = override ?? remote.data;

  async function toggle(provider: string, enabled: boolean): Promise<void> {
    setSaving(true);
    try {
      const { data: next } = await api.request<{ data: Settings }>({
        path: 'talent/notification-channels',
        method: 'PUT',
        json: { channels: { [provider]: enabled } },
      });
      setOverride(next);
      toast.add({ type: 'success', title: t('notificationSettings.saved') });
    } catch (failure) {
      toast.add({ type: 'error', title: errorMessage(failure, t) });
    } finally {
      setSaving(false);
    }
  }

  const bound = data?.channels.filter((c) => c.bound) ?? [];
  return (
    <Card id='notifications' className='scroll-mt-4'>
      <CardHeader>
        <CardTitle>{t('notificationSettings.title')}</CardTitle>
        <CardDescription>
          {t('notificationSettings.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {remote.error && !data ? (
          <LoadError error={remote.error} onRetry={remote.reload} />
        ) : !data ? (
          <BlockSkeleton rows={2} />
        ) : (
          <ul className='divide-y rounded-md border'>
            <li className='flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2'>
              <span className='text-sm font-medium'>
                {t('notificationSettings.inbox')}
              </span>
              <Badge variant='secondary'>
                {t('notificationSettings.alwaysOn')}
              </Badge>
            </li>
            {bound.map((channel) => (
              <li
                key={channel.provider}
                className='flex min-h-11 flex-wrap items-center justify-between gap-2 px-4 py-2'
              >
                <span className='text-sm font-medium'>
                  {t(`notificationSettings.channels.${channel.provider}`)}
                </span>
                <Switch
                  aria-label={t('notificationSettings.toggle', {
                    name: t(
                      `notificationSettings.channels.${channel.provider}`,
                    ),
                  })}
                  checked={channel.enabled}
                  disabled={saving}
                  onCheckedChange={(enabled) =>
                    void toggle(channel.provider, enabled)
                  }
                />
              </li>
            ))}
            {!bound.length ? (
              <li className='px-4 py-3 text-sm text-muted-foreground'>
                {t('notificationSettings.noneBound')}
              </li>
            ) : null}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
