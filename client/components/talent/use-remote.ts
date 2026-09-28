import { useApiClient } from '@nocobase/app-client';
import { useCallback, useEffect, useReducer, useState } from 'react';

type QueryValue = string | number | boolean | null | undefined;

export interface RemoteState<T> {
  readonly data: T | undefined;
  readonly error: unknown;
  readonly loading: boolean;
  readonly reload: () => void;
}

/**
 * Loads one endpoint and reloads it on demand. The result is stored only from
 * the request callbacks, keyed by the request, so a stale response never
 * overwrites a newer one; a failed reload keeps the previous data.
 */
export function useRemote<T>(
  path: string | null,
  query?: Record<string, QueryValue>,
): RemoteState<T> {
  const api = useApiClient();
  const [count, bump] = useReducer((n: number) => n + 1, 0);
  const queryKey = JSON.stringify(query ?? {});
  const key = `${path ?? ''}|${queryKey}|${count}`;
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error?: unknown;
  }>();

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const requestKey = `${path}|${queryKey}|${count}`;
    api
      .request<{ data: T }>({
        path,
        query: JSON.parse(queryKey) as Record<string, QueryValue>,
        signal: controller.signal,
      })
      .then(
        (response) => {
          if (!controller.signal.aborted)
            setResult({ key: requestKey, data: response.data });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setResult((previous) => ({ ...previous, key: requestKey, error }));
        },
      );
    return () => controller.abort();
  }, [api, path, queryKey, count]);

  const reload = useCallback(() => bump(), []);
  const loading = Boolean(path) && result?.key !== key;
  return {
    data: result?.data,
    error: loading ? undefined : result?.error,
    loading,
    reload,
  };
}
