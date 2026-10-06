import {
  defineAppConfig,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

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
 * 本地文件邮箱 account for it automatically.
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

const businessMail: AppConfigFactory<MailConfig> = defineAppConfig({
  defaults: {
    billing: { address: 'billing@qiheng.test' },
    recruiting: { address: 'recruiting@qiheng.test' },
    audit: { address: 'audit@qiheng.test' },
    hr: { address: 'hr@qiheng.test' },
  },
  env: Object.fromEntries(
    PURPOSES.map((purpose) => [
      `BUSINESS_MAIL_${purpose.toUpperCase()}_ADDRESS`,
      envString(`${purpose}.address`),
    ]),
  ),
});

export default businessMail;
