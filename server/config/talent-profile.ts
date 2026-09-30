import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * V3-11 专项培训 8D 回写: where a completed recommendation's proof is pushed
 * back to the quality system, and the secret its HMAC-SHA256 signature
 * (`x-nocohr-signature`) is made with. Both are the administrator's; leave the
 * URL empty to only generate the proof. The secret is never returned by any
 * API or written to the database.
 */
export interface TalentProfileConfig {
  readonly writebackUrl: string;
  readonly writebackSecret: string;
}

const talentProfile: AppConfigFactory<TalentProfileConfig> = defineAppConfig({
  defaults: { writebackUrl: '', writebackSecret: '' },
  env: {
    HR_SIGNAL_WRITEBACK_URL: envString('writebackUrl'),
    HR_SIGNAL_WRITEBACK_SECRET: envString('writebackSecret'),
  },
});

export default talentProfile;
