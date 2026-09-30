import { useApiClient } from '@nocobase/app-client';
import { useEffect, useSyncExternalStore } from 'react';

import { appTimeZone, setAppTimeZone, subscribeAppTimeZone } from './dates.js';

interface AppTime {
  readonly timeZone: string;
  readonly today: string;
}

/** One request per page load; a failure is forgotten so the next mount retries. */
let pending: Promise<void> | null = null;

/**
 * The application's business time zone (`talent.timeZone`). The first caller
 * loads `GET /api/talent/app-time` and every caller re-renders when it
 * arrives; until then — and if it fails — the module default (Asia/Shanghai)
 * applies. The `dates.ts` helpers default to the same value. `enabled: false`
 * defers the request, for a block still waiting on its permission check.
 */
export function useAppTimeZone(enabled = true): string {
  const api = useApiClient();
  useEffect(() => {
    if (!enabled || pending) return;
    pending = api.request<{ data: AppTime }>({ path: 'talent/app-time' }).then(
      (response) => setAppTimeZone(response?.data?.timeZone),
      () => {
        pending = null;
      },
    );
  }, [api, enabled]);
  return useSyncExternalStore(subscribeAppTimeZone, appTimeZone, appTimeZone);
}
