import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';
import { Link } from 'react-router';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';

/** The HR assistant's attendance work, in the order it happens in a month. */
const KEYS = [
  'hrAssistant.replacementSuggest',
  'hrAssistant.attendanceAnomaly',
  'hrAssistant.monthEndCheck',
] as const;

interface Automation {
  key: string;
  enabled: boolean;
  ownerUserId: string | null;
  ownerName: string | null;
}

/**
 * 人事助理 · 考勤工作: the switches of 顶班推荐, 考勤异常提醒 and 月底考勤核对.
 * The owner, run time and run records stay on the AI automations page, which
 * this card links to; the switch here is the same setting.
 */
export function AttendanceAutomationCard(): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const remote = useRemote<Automation[]>('talent/automations');
  const [saving, setSaving] = useState<string | null>(null);
  const rows = KEYS.map((key) =>
    remote.data?.find((a) => a.key === key),
  ).filter((row): row is Automation => Boolean(row));
  const toggle = async (row: Automation, enabled: boolean) => {
    if (saving) return;
    setSaving(row.key);
    try {
      await api.request({
        method: 'PATCH',
        path: `talent/automations/${encodeURIComponent(row.key)}`,
        json: { enabled },
      });
      toast.add({
        type: 'success',
        title: t(
          enabled
            ? 'attendance.settings.automations.enabled'
            : 'attendance.settings.automations.disabled',
          { name: t(`attendance.settings.automations.items.${row.key}.title`) },
        ),
      });
      remote.reload();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setSaving(null);
    }
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('attendance.settings.automations.title')}</CardTitle>
        <CardDescription>
          {t('attendance.settings.automations.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {remote.error && !remote.data ? (
          <LoadError error={remote.error} onRetry={remote.reload} />
        ) : !remote.data ? (
          <BlockSkeleton rows={3} />
        ) : (
          <ul className='divide-y'>
            {rows.map((row) => (
              <li
                key={row.key}
                className='flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0'
              >
                <div className='min-w-0 space-y-1'>
                  <p className='font-medium'>
                    {t(
                      `attendance.settings.automations.items.${row.key}.title`,
                    )}
                  </p>
                  <p className='text-sm text-muted-foreground'>
                    {t(
                      `attendance.settings.automations.items.${row.key}.description`,
                    )}
                  </p>
                  {!row.ownerUserId ? (
                    <Alert className='mt-2'>
                      <AlertDescription>
                        {t('attendance.settings.automations.noOwner')}
                      </AlertDescription>
                    </Alert>
                  ) : null}
                </div>
                <Switch
                  aria-label={t(
                    `attendance.settings.automations.items.${row.key}.title`,
                  )}
                  checked={row.enabled}
                  disabled={saving !== null}
                  onCheckedChange={(checked) => void toggle(row, checked)}
                />
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <CardFooter className='justify-end'>
        <Button
          variant='outline'
          nativeButton={false}
          render={<Link to='/settings/ai-automations' />}
        >
          {t('attendance.settings.automations.runs')}
        </Button>
      </CardFooter>
    </Card>
  );
}
