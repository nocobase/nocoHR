import {
  defineAppConfig,
  envBoolean,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

export interface AssistantConfig {
  readonly enabled: boolean;
  readonly llmService: string;
  readonly model: string;
  readonly apiKey: string;
  readonly baseURL: string;
}
/** Separate opt-in configuration; no existing deployment is switched by installing this code. */
const assistant: AppConfigFactory<AssistantConfig> =
  defineAppConfig<AssistantConfig>({
    defaults: {
      enabled: false,
      llmService: 'application',
      model: '',
      apiKey: '',
      baseURL: '',
    },
    env: {
      APP_ASSISTANT_ENABLED: envBoolean('enabled'),
      APP_ASSISTANT_LLM_SERVICE: envString('llmService'),
      APP_ASSISTANT_MODEL: envString('model'),
      APP_ASSISTANT_API_KEY: envString('apiKey'),
      APP_ASSISTANT_BASE_URL: envString('baseURL'),
    },
  });
export default assistant;
