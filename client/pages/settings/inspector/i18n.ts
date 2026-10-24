import { useTranslation } from '@nocobase/i18n/client';
import type { LocalizedText } from '@nocobase/app-plugin-authorization/client';
export const AUTHORIZATION_NAMESPACE = '@nocobase/app-plugin-authorization';
export type Translate = (
  key: string,
  options?: Record<string, unknown>,
) => string;
export function useAuthorizationTranslation(): Translate {
  return useTranslation().t;
}
export function titleText(value: LocalizedText, t: Translate): string {
  return typeof value === 'string'
    ? value
    : t(value.key, {
        ns: value.ns ?? AUTHORIZATION_NAMESPACE,
        defaultValue: value.defaultValue ?? value.key,
      });
}
