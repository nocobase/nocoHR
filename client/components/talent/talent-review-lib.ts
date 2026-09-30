/**
 * V4-13 人才盘点与其他: the helpers the step's pages share — the write helper
 * (toast on success, translated error), the nine-box order and dates.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, useState } from 'react';

import { toast } from '@/components/ui/toast';

import { errorMessage } from './errors.js';

export type Method = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A write with a success toast and a translated error; answers the data or undefined. */
export function useTrAction(): {
  busy: boolean;
  error: string | undefined;
  clear: () => void;
  run: <T>(
    request: { method: Method; path: string; json?: unknown; body?: FormData },
    success?: string,
  ) => Promise<T | undefined>;
} {
  const api = useApiClient();
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = useCallback(
    async <T,>(
      request: { method: Method; path: string; json?: unknown; body?: FormData },
      success?: string,
    ): Promise<T | undefined> => {
      setBusy(true);
      setError(undefined);
      try {
        const response = await api.request<{ data: T }>(
          request.body
            ? { method: request.method as 'POST', path: request.path, body: request.body }
            : {
                method: request.method as 'POST',
                path: request.path,
                json: request.json ?? {},
              },
        );
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
  return { busy, error, run, clear: () => setError(undefined) };
}

/** The nine boxes, top row first (potential 3 → 1), each row performance 1 → 3. */
export const BOX_ROWS: readonly (readonly number[])[] = [
  [7, 8, 9],
  [4, 5, 6],
  [1, 2, 3],
];

export function formatDate(locale: string, value: string | null | undefined): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(
    new Date(value.length === 10 ? `${value}T00:00:00` : value),
  );
}
