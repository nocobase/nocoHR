import { useTranslation } from '@nocobase/i18n/client';

/** An AI employee's display name; the names live with the AI employee tasks page. */
export function useEmployeeName(): (username: string) => string {
  const { t } = useTranslation();
  return (username) =>
    t(`aiAutomations.employees.${username}`, { defaultValue: username });
}
