import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useRef, useState } from 'react';
import { toast } from '@/components/ui/toast';
import { SETTINGS_API, type Section, type Versioned } from './types.js';

/**
 * The saving contract every configuration card shares: the section's value
 * with the revision it was read at; a stale revision is refused
 * (SETTINGS_CONFLICT) and the card offers to reload.
 */
export function useSave<T>(section: Section, initial: Versioned<T>) {
  const api = useApiClient();
  const { t } = useTranslation();
  const revisionRef = useRef(initial.revision);
  const writingRef = useRef(false);
  const [error, setError] = useState<unknown>();
  const save = async (value: T): Promise<T | undefined> => {
    if (writingRef.current) return;
    writingRef.current = true;
    setError(undefined);
    try {
      const response = await api.request<{ data: Versioned<T> }>({
        path: `${SETTINGS_API}/config/${section}`,
        method: 'PATCH',
        json: { value, revision: revisionRef.current },
      });
      revisionRef.current = response.data.revision;
      toast.add({
        type: 'success',
        title: t('attendance.leave.saved', {
          name: t(`attendance.settings.${section}`),
        }),
      });
      return response.data.value;
    } catch (cause) {
      setError(cause);
    } finally {
      writingRef.current = false;
    }
  };
  return { save, error };
}
