import { useTranslation } from '@nocobase/i18n/client';

import { useAI } from '@/extensions/nocobase-ai';

/** Whether an application AI employee can take a message now, and why not when it cannot. */
export function useEmployeeReadiness(username: string): {
  ready: boolean;
  problem: string;
} {
  const { t } = useTranslation();
  const {
    configurationStatus,
    configurationError,
    modelConfigurationError,
    employees,
    hasEnabledModels,
  } = useAI();
  const listed = employees.some((e) => e.username === username);
  const ready =
    configurationStatus === 'ready' &&
    listed &&
    !modelConfigurationError &&
    hasEnabledModels;
  const problem =
    configurationStatus === 'loading'
      ? t('talent.advisor.loading')
      : configurationStatus === 'error'
        ? (configurationError?.message ?? t('talent.advisor.configError'))
        : !listed
          ? t('talent.advisor.noEmployee')
          : t('talent.advisor.noModel');
  return { ready, problem };
}
