import {
  defineAppConfig,
  envInteger,
  envString,
  envStrings,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * What the deliberately public endpoints trust (configuration section
 * `publicEndpoints`; readiness review 2026-10-07): the careers page, the
 * document and audit-pack links, the IM and directory callbacks.
 *
 * - `trustedProxies`: the reverse proxies whose `X-Forwarded-For` /
 *   `X-Real-IP` give the client's address for per-address limits. A header
 *   from any other peer is ignored, so a client cannot pick its own address;
 *   behind an unlisted proxy every visitor shares the proxy's bucket.
 * - `imCallbackSecret` / `orgSyncCallbackSecret`: the HMAC keys of the IM and
 *   directory callbacks (`x-nocohr-signature` over `<timestamp>.<body>`,
 *   `x-nocohr-timestamp` in Unix seconds). Empty accepts no callback.
 * - `callbackToleranceSeconds`: how far a callback's timestamp may be from
 *   the server's clock.
 */
export interface PublicEndpointsConfig {
  /** IP addresses or CIDR ranges, e.g. `127.0.0.1`, `10.0.0.0/8`, `::1`. */
  readonly trustedProxies: readonly string[];
  readonly imCallbackSecret: string;
  readonly orgSyncCallbackSecret: string;
  readonly callbackToleranceSeconds: number;
}

const publicEndpoints: AppConfigFactory<PublicEndpointsConfig> =
  defineAppConfig<PublicEndpointsConfig>({
    defaults: {
      trustedProxies: [],
      imCallbackSecret: '',
      orgSyncCallbackSecret: '',
      callbackToleranceSeconds: 300,
    },
    env: {
      APP_TRUSTED_PROXIES: envStrings('trustedProxies'),
      IM_CALLBACK_SECRET: envString('imCallbackSecret'),
      ORG_SYNC_CALLBACK_SECRET: envString('orgSyncCallbackSecret'),
      CALLBACK_TOLERANCE_SECONDS: envInteger('callbackToleranceSeconds'),
    },
  });

export default publicEndpoints;
