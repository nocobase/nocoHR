import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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

/** `GET talent/licensed/industry-packs` (server/providers/hr/industry-packs/service.ts). */
export interface IndustryPacksData {
  packs: {
    key: string;
    title: string;
    description: string;
    enabled: boolean;
    changedAt: string | null;
    operations: {
      kind: string;
      page: string;
      path: string;
      title: string;
      permissionSet: string;
      permissionSetExists: boolean;
      certifications: { id: string; title: string }[];
    }[];
  }[];
}

const PATH = 'talent/licensed/industry-packs';

/**
 * 行业内容包 on 设置 / 持证上岗: the industry content the mechanism works on
 * (the pages a certificate unlocks and their registrations). Turning one on
 * creates its missing permission sets; turning one off asks first and
 * deletes nothing — its pages and traces stop until it is on again.
 */
export function IndustryPacksCard(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<IndustryPacksData>(PATH);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licensed.industryPacks.title')}</CardTitle>
        <CardDescription>
          {t('licensed.industryPacks.description')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {remote.error ? (
          <LoadError error={remote.error} onRetry={remote.reload} />
        ) : remote.data ? (
          <IndustryPackList data={remote.data} onChanged={remote.reload} />
        ) : (
          <BlockSkeleton rows={2} />
        )}
      </CardContent>
    </Card>
  );
}

export function IndustryPackList({
  data,
  onChanged,
}: {
  data: IndustryPacksData;
  onChanged: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [busy, setBusy] = useState<string>();
  const [confirming, setConfirming] = useState<IndustryPacksData['packs'][0]>();

  async function save(key: string, enabled: boolean): Promise<void> {
    setBusy(key);
    try {
      await api.request({
        path: `${PATH}/${encodeURIComponent(key)}`,
        method: 'PUT',
        json: { enabled },
      });
      toast.add({
        type: 'success',
        title: t(
          enabled
            ? 'licensed.industryPacks.enabled'
            : 'licensed.industryPacks.disabled',
        ),
      });
      onChanged();
    } catch (cause) {
      toast.add({ type: 'error', title: errorMessage(cause, t) });
    } finally {
      setBusy(undefined);
      setConfirming(undefined);
    }
  }

  if (!data.packs.length)
    return (
      <p className='text-sm text-muted-foreground'>
        {t('licensed.industryPacks.none')}
      </p>
    );

  return (
    <>
      <ul className='flex flex-col gap-3'>
        {data.packs.map((pack) => {
          const id = `industry-pack-${pack.key}`;
          return (
            <li key={pack.key} className='space-y-3 rounded-lg border p-4'>
              <div className='flex items-start justify-between gap-3'>
                <div className='min-w-0 space-y-1'>
                  <label htmlFor={id} className='font-medium'>
                    {pack.title}
                  </label>
                  <p className='text-sm text-muted-foreground'>
                    {pack.description}
                  </p>
                </div>
                <Switch
                  id={id}
                  checked={pack.enabled}
                  disabled={Boolean(busy)}
                  onCheckedChange={(checked) =>
                    checked ? void save(pack.key, true) : setConfirming(pack)
                  }
                />
              </div>
              <ul className='flex flex-col gap-1.5 text-sm'>
                {pack.operations.map((operation) => (
                  <li
                    key={operation.kind}
                    className='flex flex-wrap items-center gap-2'
                  >
                    <span>{operation.title}</span>
                    <span className='font-mono text-xs text-muted-foreground'>
                      {operation.permissionSet}
                    </span>
                    {operation.certifications.length ? (
                      <Badge variant='secondary'>
                        {t('licensed.settings.grantedBy', {
                          names: operation.certifications
                            .map((c) => c.title)
                            .join('、'),
                        })}
                      </Badge>
                    ) : (
                      <Badge variant='outline'>
                        {t(
                          operation.permissionSetExists
                            ? 'licensed.industryPacks.noCertification'
                            : 'licensed.industryPacks.setCreatedOnEnable',
                        )}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      <AlertDialog
        open={Boolean(confirming)}
        onOpenChange={(next) => {
          if (!next && !busy) setConfirming(undefined);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('licensed.industryPacks.confirmTitle', {
                title: confirming?.title ?? '',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('licensed.industryPacks.confirmDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>
              {t('actions.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busy)}
              onClick={(event) => {
                event.preventDefault();
                if (confirming) void save(confirming.key, false);
              }}
            >
              {t('licensed.industryPacks.confirmDisable')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
