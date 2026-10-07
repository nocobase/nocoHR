import {
  defineAppConfig,
  envBoolean,
  envStrings,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * The Content-Security-Policy sent with the application's HTML pages
 * (configuration section `contentSecurityPolicy`, see
 * `server/http/content-security-policy.ts`).
 *
 * The baseline only lets the page load images, scripts and connections from
 * its own origin, so text a model was steered into writing (a resume, an
 * inbound mail, a knowledge document) cannot make the browser send data to
 * another host through `![](https://…)`. A deployment that serves files from
 * another origin — an S3 bucket or a CDN — adds that origin here instead of
 * loosening the baseline in code.
 */
export interface ContentSecurityPolicyConfig {
  /** Send the header. It is never sent while `pnpm dev` serves the client through Vite. */
  readonly enabled: boolean;
  /** Extra sources for `img-src` and `media-src`, e.g. `https://files.example.com`. */
  readonly imgSrc: readonly string[];
  /** Extra sources for `connect-src`. */
  readonly connectSrc: readonly string[];
  /** Extra sources for `frame-src`. */
  readonly frameSrc: readonly string[];
}

const contentSecurityPolicy: AppConfigFactory<ContentSecurityPolicyConfig> =
  defineAppConfig<ContentSecurityPolicyConfig>({
    defaults: {
      enabled: true,
      imgSrc: [],
      connectSrc: [],
      frameSrc: [],
    },
    env: {
      APP_CSP_ENABLED: envBoolean('enabled'),
      APP_CSP_IMG_SRC: envStrings('imgSrc'),
      APP_CSP_CONNECT_SRC: envStrings('connectSrc'),
      APP_CSP_FRAME_SRC: envStrings('frameSrc'),
    },
  });

export default contentSecurityPolicy;
