import { ApiClientError, useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useState } from 'react';

import { errorCode, errorMessage } from '@/components/talent/errors';
import { toast } from '@/components/ui/toast';

import type { Section, Settings, Snapshot } from './types.js';

/**
 * Saving one Card of 人事设置: PATCH its section at the revision it was
 * loaded with. A 409 means someone else saved first; the Card then offers to
 * reload, which discards the local edits after a confirmation. Other failures
 * keep the edits and show a message in the Card.
 */
export function useSection<K extends Section>(
  section: K,
  initial: Snapshot<Settings[K]>,
) {
  const { t } = useTranslation();
  const api = useApiClient();
  const [snapshot, setSnapshot] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(
    value: Settings[K],
  ): Promise<Snapshot<Settings[K]> | null> {
    setSaving(true);
    setError(null);
    try {
      const result = await api.request<{ data: Snapshot<Settings[K]> }>({
        path: `talent/personnel-settings/${section}`,
        method: 'PATCH',
        json: { revision: snapshot.revision, value },
      });
      setSnapshot(result.data);
      toast.add({
        type: 'success',
        title: t('personnelSettings.saved', {
          section: t(`personnelSettings.${section}.title`),
        }),
      });
      return result.data;
    } catch (failure) {
      const status =
        failure instanceof ApiClientError ? failure.status : undefined;
      const code = errorCode(failure);
      setConflict(status === 409);
      setError(
        status === 409
          ? t('personnelSettings.conflict')
          : status === 403
            ? t('personnelSettings.forbidden')
            : code && code !== 'INVALID_INPUT'
              ? errorMessage(failure, t)
              : t('personnelSettings.failed'),
      );
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function reload(): Promise<Snapshot<Settings[K]> | null> {
    setReloading(true);
    try {
      const { data } = await api.request<{
        data: Settings & Record<string, unknown>;
      }>({
        path: 'talent/personnel-settings',
      });
      const next = (data as unknown as Record<K, Snapshot<Settings[K]>>)[
        section
      ];
      setSnapshot(next);
      setConflict(false);
      setError(null);
      return next;
    } catch (failure) {
      setError(
        failure instanceof ApiClientError && failure.status === 403
          ? t('personnelSettings.forbidden')
          : t('personnelSettings.failed'),
      );
      return null;
    } finally {
      setReloading(false);
    }
  }

  return {
    snapshot,
    save,
    reload,
    saving,
    reloading,
    busy: saving || reloading,
    conflict,
    error,
  };
}
