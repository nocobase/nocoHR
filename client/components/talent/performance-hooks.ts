/**
 * V4-12 绩效: the hooks the performance pages share — dates in the viewer's
 * locale, and the write helper that toasts on success and translates errors.
 */
import { useApiClient } from '@nocobase/app-client';
import { useLocale, useTranslation } from '@nocobase/i18n/client';
import { useCallback, useState } from 'react';

import { toast } from '@/components/ui/toast';

import { errorMessage } from './errors.js';

export function useDateText(): (value: string | null | undefined) => string {
  const { locale } = useLocale();
  return (value) =>
    value
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
          new Date(value.length === 10 ? `${value}T00:00:00` : value),
        )
      : '—';
}

/** POST / PUT / PATCH with a success toast and a translated error; answers the data or undefined. */
export function useAction(): {
  busy: boolean;
  run: <T>(
    request: { method: 'POST' | 'PUT' | 'PATCH'; path: string; json?: unknown },
    success?: string,
  ) => Promise<T | undefined>;
  error: string | undefined;
  clear: () => void;
} {
  const api = useApiClient();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async <T>(
      request: {
        method: 'POST' | 'PUT' | 'PATCH';
        path: string;
        json?: unknown;
      },
      success?: string,
    ): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        const response = await api.request<{ data: T }>({
          method: request.method,
          path: request.path,
          json: request.json ?? {},
        });
        if (success) toast.add({ type: 'success', title: success });
        return response.data;
      } catch (cause) {
        setError(errorMessage(cause, t));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [api, t],
  );
  return { busy, run, error, clear: () => setError(undefined) };
}
