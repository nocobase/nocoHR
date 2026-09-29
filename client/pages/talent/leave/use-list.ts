import { useApiClient } from '@nocobase/app-client';
import { useCallback, useEffect, useReducer, useState } from 'react';

/** This endpoint returns list metadata alongside data, unlike useRemote's envelope. */
export function useLeaveList<T extends { id: string }>(path: string) {
  const api = useApiClient();
  const [revision, reload] = useReducer((n: number) => n + 1, 0);
  const key = `${path}:${revision}`;
  const [state, setState] = useState<{
    key: string;
    path: string;
    rows?: T[];
    truncated?: boolean;
    error?: unknown;
  }>();
  useEffect(() => {
    const controller = new AbortController();
    api
      .request<{ data: T[]; meta: { truncated: boolean } }>({
        path,
        signal: controller.signal,
      })
      .then(
        (result) => {
          if (!controller.signal.aborted)
            setState({
              key,
              path,
              rows: result.data,
              truncated: result.meta.truncated,
            });
        },
        (error: unknown) => {
          if (!controller.signal.aborted)
            setState((previous) => ({
              ...(previous?.path === path ? previous : {}),
              key,
              path,
              error,
            }));
        },
      );
    return () => controller.abort();
  }, [api, key, path]);
  const saved = useCallback((row: T) => {
    setState((previous) =>
      previous?.rows
        ? {
            ...previous,
            rows: previous.rows.some((r) => r.id === row.id)
              ? previous.rows.map((r) =>
                  r.id === row.id ? { ...r, ...row } : r,
                )
              : [row, ...previous.rows],
          }
        : previous,
    );
    reload();
  }, []);
  return {
    rows: state?.path === path ? state.rows : undefined,
    truncated: state?.path === path ? state.truncated : false,
    error: state?.key === key ? state.error : undefined,
    loading: state?.key !== key,
    reload,
    saved,
  };
}
