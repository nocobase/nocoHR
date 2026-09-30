/** V2-06 薪酬与社保: formatting and error hooks shared by the payroll pages (amounts with two decimals). */
import { useTranslation } from '@nocobase/i18n/client';
import { useCallback } from 'react';

import { errorCode, errorDetails, errorMessage } from './errors.js';

export function useMoney(): (value: number | null | undefined) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (value: number | null | undefined) =>
      value === null || value === undefined || Number.isNaN(value)
        ? '—'
        : new Intl.NumberFormat(i18n.language, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(value),
    [i18n.language],
  );
}

export function useNumber(): (value: number | null | undefined) => string {
  const { i18n } = useTranslation();
  return useCallback(
    (value: number | null | undefined) =>
      value === null || value === undefined
        ? '—'
        : new Intl.NumberFormat(i18n.language, {
            maximumFractionDigits: 4,
          }).format(value),
    [i18n.language],
  );
}

/** A payroll failure: the step's own wording first (`payroll.errors.<CODE>`), then the shared one. */
export function usePayrollError(): (error: unknown) => string {
  const { t } = useTranslation();
  return useCallback(
    (error: unknown) => {
      const code = errorCode(error);
      if (code) {
        const details = errorDetails(error);
        const values =
          details && typeof details === 'object' && !Array.isArray(details)
            ? Object.fromEntries(
                Object.entries(details as Record<string, unknown>).map(
                  ([key, value]) => [
                    key,
                    Array.isArray(value)
                      ? value
                          .map((v) =>
                            v && typeof v === 'object'
                              ? JSON.stringify(v)
                              : String(v),
                          )
                          .join('、')
                      : value,
                  ],
                ),
              )
            : {};
        const text = t(`payroll.errors.${code}`, {
          defaultValue: '',
          ...values,
        });
        if (text) return text;
      }
      return errorMessage(error, t);
    },
    [t],
  );
}
