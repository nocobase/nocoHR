import {
  defineAppConfig,
  envBoolean,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * The Feishu self-built app the organization sync (V1-03) and, later, the
 * bot (V1-04) use. No office-suite plugin is installed in this application,
 * so these credentials are read here instead of from a plugin's settings.
 * Set them through the environment (`.env.local` in development, the
 * deployment's secret store in production), never in a committed file.
 * With `appId` or `appSecret` empty the sync keeps the development mock
 * source outside production and has no source in production.
 */
export interface FeishuConfig {
  readonly appId: string;
  readonly appSecret: string;
  /** Only needed for HTTP event callbacks; the long connection does without it. */
  readonly encryptKey: string;
  readonly verificationToken: string;
  /** `https://open.larksuite.com` for a Lark tenant. */
  readonly baseUrl: string;
  /**
   * Open the long connection that receives bot messages and card button
   * presses. Only one server of a deployment should hold it.
   */
  readonly longConnection: boolean;
  /**
   * The origin links in Feishu messages start with. Empty: `app.publicOrigin`,
   * else `http://localhost:<server.port>` outside production.
   */
  readonly linkOrigin: string;
}

const feishu: AppConfigFactory<FeishuConfig> = defineAppConfig({
  defaults: {
    appId: '',
    appSecret: '',
    encryptKey: '',
    verificationToken: '',
    baseUrl: 'https://open.feishu.cn',
    longConnection: true,
    linkOrigin: '',
  },
  env: {
    FEISHU_APP_ID: envString('appId'),
    FEISHU_APP_SECRET: envString('appSecret'),
    FEISHU_ENCRYPT_KEY: envString('encryptKey'),
    FEISHU_VERIFICATION_TOKEN: envString('verificationToken'),
    FEISHU_BASE_URL: envString('baseUrl'),
    FEISHU_LONG_CONNECTION: envBoolean('longConnection'),
    FEISHU_LINK_ORIGIN: envString('linkOrigin'),
  },
});

export default feishu;
