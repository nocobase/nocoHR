import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react';
import { useState, type ReactElement } from 'react';

import { errorMessage } from '@/components/talent/errors';
import { BlockSkeleton, LoadError } from '@/components/talent/states';
import { useRemote } from '@/components/talent/use-remote';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/components/ui/toast';
import {
  SERVICES,
  type SelfServiceCardsConfig,
} from '@/pages/talent/self-service/services';

interface Snapshot {
  readonly value: SelfServiceCardsConfig;
  readonly revision: number;
}
type Row = { key: string; visible: boolean };

/** Every known card in the stored order; cards the setting does not name follow, visible. */
function rowsOf(config: SelfServiceCardsConfig | undefined): Row[] {
  const known = new Set(SERVICES.map((s) => s.key));
  const named = (config?.cards ?? []).filter((row) => known.has(row.key));
  const mentioned = new Set(named.map((row) => row.key));
  return [
    ...named.map((row) => ({ ...row })),
    ...SERVICES.filter((s) => !mentioned.has(s.key)).map((s) => ({
      key: s.key,
      visible: true,
    })),
  ];
}

/**
 * 自助页卡片 (V1-04): the order and visibility of the 自助 page's cards, an
 * application setting (`talent/ai-entry/self-service`). A card hidden here is
 * hidden for everyone; a visible card still shows only to users who may open
 * its page.
 */
export function SelfServiceCardsCard(): ReactElement {
  const { t } = useTranslation();
  const remote = useRemote<Snapshot>('talent/ai-entry/self-service');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('aiEntry.selfService.title')}</CardTitle>
        <CardDescription>
          {t('aiEntry.selfService.description')}
        </CardDescription>
      </CardHeader>
      {remote.error ? (
        <CardContent>
          <LoadError error={remote.error} onRetry={remote.reload} />
        </CardContent>
      ) : remote.loading && !remote.data ? (
        <CardContent>
          <BlockSkeleton rows={3} />
        </CardContent>
      ) : (
        <Editor
          key={remote.data?.revision ?? 0}
          snapshot={remote.data ?? { value: { cards: [] }, revision: 0 }}
          onSaved={remote.reload}
        />
      )}
    </Card>
  );
}

function Editor({
  snapshot,
  onSaved,
}: {
  snapshot: Snapshot;
  onSaved: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const api = useApiClient();
  const [rows, setRows] = useState<Row[]>(() => rowsOf(snapshot.value));
  const [saving, setSaving] = useState(false);

  function move(index: number, by: -1 | 1): void {
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(index + by, 0, row);
      return next;
    });
  }

  async function save(): Promise<void> {
    setSaving(true);
    try {
      await api.request({
        path: 'talent/ai-entry/self-service',
        method: 'PUT',
        json: { revision: snapshot.revision, value: { cards: rows } },
      });
      toast.add({
        type: 'success',
        title: t('aiEntry.settings.saved', {
          section: t('aiEntry.selfService.title'),
        }),
      });
      onSaved();
    } catch (failure) {
      toast.add({
        type: 'error',
        title:
          failure instanceof ApiClientError && failure.status === 409
            ? t('aiEntry.selfService.conflict')
            : errorMessage(failure, t),
      });
      if (failure instanceof ApiClientError && failure.status === 409)
        onSaved();
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <CardContent>
        <ul className='divide-y rounded-md border'>
          {rows.map((row, index) => {
            const name = t(`selfServicePage.cards.${row.key}.title`);
            return (
              <li
                key={row.key}
                className='flex min-h-11 items-center justify-between gap-2 px-4 py-2'
              >
                <span className='min-w-0 flex-1 truncate text-sm font-medium'>
                  {name}
                </span>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('aiEntry.selfService.up', { name })}
                  disabled={saving || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUpIcon />
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={t('aiEntry.selfService.down', { name })}
                  disabled={saving || index === rows.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDownIcon />
                </Button>
                <Switch
                  aria-label={t('aiEntry.selfService.show', { name })}
                  checked={row.visible}
                  disabled={saving}
                  onCheckedChange={(visible) =>
                    setRows((current) =>
                      current.map((r) =>
                        r.key === row.key ? { ...r, visible } : r,
                      ),
                    )
                  }
                />
              </li>
            );
          })}
        </ul>
      </CardContent>
      <CardFooter className='justify-end'>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? <Spinner data-icon='inline-start' /> : null}
          {t('aiEntry.selfService.save')}
        </Button>
      </CardFooter>
    </>
  );
}
