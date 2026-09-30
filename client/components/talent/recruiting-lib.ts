/**
 * V2-07 招聘: the non-component pieces the recruiting pages share — the
 * base record shapes, translated failures, a mutation helper with toasts and
 * a few formatters. Components live in recruiting-shared.tsx.
 */
import { useApiClient } from '@nocobase/app-client';
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback, useState } from 'react';

import {
  errorCode,
  errorDetails,
  errorMessage,
} from '@/components/talent/errors';
import { toast } from '@/components/ui/toast';

export const REQUIREMENT_TYPES = [
  'education',
  'experience',
  'certificate',
  'skill',
  'other',
] as const;

export interface Requirement {
  key: string;
  type: string;
  text: string;
  mustHave: boolean;
  origin: string;
  competencyId?: string | null;
  level?: number | null;
}

export interface Suggestion {
  matchLevel: 'high' | 'medium' | 'low';
  met: string[];
  missing: string[];
  toVerify: string[];
  reasons: { key: string; text: string }[];
}

export interface Step {
  level: number;
  kind: string;
  name?: string | null;
  approverNames?: string[];
  status: string;
  decidedAt?: string | null;
  comment?: string | null;
}

/** A translated failure: the step's own wording first, then the talent pages' wording. */
export function useRecruitingError(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const code = errorCode(error);
      const details = errorDetails(error);
      const values =
        details && typeof details === 'object' && !Array.isArray(details)
          ? (details as Record<string, unknown>)
          : {};
      if (code) {
        const key = `recruiting.errors.${code}`;
        const text = t(key, { ...values, defaultValue: '' });
        if (text && text !== key) return text;
      }
      return errorMessage(error, t);
    },
    [t],
  );
}

/** Runs one request with a busy flag and a toast; answers the response data, or undefined after a failure. */
export function useAction() {
  const api = useApiClient();
  const failure = useRecruitingError();
  const [busy, setBusy] = useState<string | null>(null);
  const run = useCallback(
    async <T = unknown>(
      key: string,
      request: {
        path: string;
        method?: string;
        json?: unknown;
        body?: FormData;
      },
      success?: string,
    ): Promise<T | undefined> => {
      setBusy(key);
      try {
        const method = (request.method ?? 'POST') as 'POST';
        const response = request.body
          ? await api.request<{ data: T }>({
              path: request.path,
              method,
              body: request.body,
            })
          : request.json !== undefined
            ? await api.request<{ data: T }>({
                path: request.path,
                method,
                json: request.json,
              })
            : await api.request<{ data: T }>({ path: request.path, method });
        if (success) toast.add({ type: 'success', title: success });
        return response.data;
      } catch (error) {
        toast.add({ type: 'error', title: failure(error) });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [api, failure],
  );
  return { busy, run };
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function publicApiPath(path: string): string {
  return `public/recruiting/${path}`;
}
