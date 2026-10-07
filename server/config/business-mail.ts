import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

import { isDemoEnvironment } from './demo.js';

/**
 * Business mailboxes (总纲 邮件约定, V2-06), configuration section
 * `businessMail` (environment `BUSINESS_MAIL_<PURPOSE>_ADDRESS`; the `mail`
 * section and `MAIL_*` variables belong to the Mail plugin).
 *
 * Since 2026-10-05 the mailboxes are Mail plugin accounts: how a mailbox is
 * reached (IMAP/SMTP, Gmail, Microsoft 365) and its credentials are the
 * plugin's (`mail.providers`, the account connection), and which account
 * serves which purpose is the 设置 / 邮件 page's data. What stays here is each
 * purpose's address, which development, tests and the demo use to connect a
 * 本地文件邮箱 account for it automatically, and which production shows on
 * 设置 / 邮件 and drafts until an account is bound.
 *
 * The addresses default to the 启衡精密 demo's `<purpose>@qiheng.test` only
 * while the demo is on; production and `HR_DEMO_SEED=false` start empty, and
 * a purpose stays off until 设置 / 邮件 binds a Mail plugin account to it.
 */
export interface MailboxConfig {
  readonly address: string;
}

export interface MailConfig {
  readonly billing: MailboxConfig;
  readonly recruiting: MailboxConfig;
  readonly audit: MailboxConfig;
  readonly hr: MailboxConfig;
}

const PURPOSES = ['billing', 'recruiting', 'audit', 'hr'] as const;

const businessMail: AppConfigFactory<MailConfig> = defineAppConfig<MailConfig>({
  defaults: ({ env }) => {
    const demo = isDemoEnvironment(env);
    const mailbox = (purpose: (typeof PURPOSES)[number]) => ({
      address: demo ? `${purpose}@qiheng.test` : '',
    });
    return {
      billing: mailbox('billing'),
      recruiting: mailbox('recruiting'),
      audit: mailbox('audit'),
      hr: mailbox('hr'),
    };
  },
  env: Object.fromEntries(
    PURPOSES.map((purpose) => [
      `BUSINESS_MAIL_${purpose.toUpperCase()}_ADDRESS`,
      envString(`${purpose}.address`),
    ]),
  ),
});

export default businessMail;
