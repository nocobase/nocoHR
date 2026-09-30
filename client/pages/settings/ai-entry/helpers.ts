import { useTranslation } from '@nocobase/i18n/client';

/** Splits a comma, 、 or newline separated list into distinct trimmed items. */
export function listOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[,，、\n]/u)
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ];
}

/** A permission set key such as `hr.admin` shown by its translated name when there is one. */
export function usePermissionSetName(): (key: string) => string {
  const { t } = useTranslation();
  return (key) =>
    t(
      `permissionSets.${key.replace(/[._-](\w)/gu, (_, c: string) => c.toUpperCase())}`,
      { defaultValue: key },
    );
}
