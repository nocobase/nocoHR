import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import type { AppI18nConfig } from '@nocobase/app-server/i18n';

const i18n: AppConfigFactory<AppI18nConfig> = defineAppConfig({
  // NocoHR starts in Simplified Chinese; English is offered alongside it.
  defaults: { defaultLocale: 'zh-CN' },
  env: { APP_DEFAULT_LOCALE: envString('defaultLocale') },
});

export default i18n;
