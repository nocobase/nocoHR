import {
  defineAppConfig,
  envBoolean,
  envInteger,
  envString,
  type AppConfigFactory,
} from '@nocobase/app-server/config';

/**
 * Business mailboxes (总纲 邮件约定, V2-06): where each mailbox's mail is read
 * from. Only credentials and connection details live here — set them through
 * the environment (`.env.local` in development, the deployment's secret store
 * in production), never in a committed file. What the mailboxes are used for
 * (sender domains, attachment types, retention, the sending channel) is the
 * 设置 / 邮件 page's data.
 *
 * `adapter`:
 * - `mock` reads `storage/mail/inbox/<purpose>/*.eml` and writes sent mail to
 *   `storage/mail/outbox/`; it is refused in production.
 * - `imap` reads the mailbox's INBOX over IMAP.
 * - `none` turns the mailbox off.
 *
 * Sending always goes through the notification plugin's email channel named
 * on 设置 / 邮件; `address` is the reply address, and replies come back to
 * `<local>+<threadKey>@<domain>`, so the mail server must deliver plus
 * addresses to the same mailbox.
 */
export interface MailboxConfig {
  readonly adapter: 'mock' | 'imap' | 'none';
  readonly address: string;
  readonly imapHost: string;
  readonly imapPort: number;
  readonly imapSecure: boolean;
  readonly imapUser: string;
  readonly imapPassword: string;
}

export interface MailConfig {
  readonly billing: MailboxConfig;
  readonly recruiting: MailboxConfig;
  readonly audit: MailboxConfig;
  readonly hr: MailboxConfig;
}

const PURPOSES = ['billing', 'recruiting', 'audit', 'hr'] as const;

const mailboxDefaults = (purpose: string): MailboxConfig => ({
  adapter: 'mock',
  address: `${purpose}@qiheng.test`,
  imapHost: '',
  imapPort: 993,
  imapSecure: true,
  imapUser: '',
  imapPassword: '',
});

const mail: AppConfigFactory<MailConfig> = defineAppConfig({
  defaults: {
    billing: mailboxDefaults('billing'),
    recruiting: mailboxDefaults('recruiting'),
    audit: mailboxDefaults('audit'),
    hr: mailboxDefaults('hr'),
  },
  env: Object.fromEntries(
    PURPOSES.flatMap((purpose) => {
      const prefix = `MAIL_${purpose.toUpperCase()}`;
      return [
        [`${prefix}_ADAPTER`, envString(`${purpose}.adapter`)],
        [`${prefix}_ADDRESS`, envString(`${purpose}.address`)],
        [`${prefix}_IMAP_HOST`, envString(`${purpose}.imapHost`)],
        [`${prefix}_IMAP_PORT`, envInteger(`${purpose}.imapPort`)],
        [`${prefix}_IMAP_SECURE`, envBoolean(`${purpose}.imapSecure`)],
        [`${prefix}_IMAP_USER`, envString(`${purpose}.imapUser`)],
        [`${prefix}_IMAP_PASSWORD`, envString(`${purpose}.imapPassword`)],
      ];
    }),
  ),
});

export default mail;
