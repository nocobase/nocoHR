import {
  defineAppConfig,
  type AppConfigFactory,
} from '@nocobase/app-server/config';
import {
  DEFAULT_MAIL_CONFIG,
  type MailConfig,
} from '@nocobase/app-plugin-mail/server';

/**
 * The Mail plugin's configuration (`mail.providers`, OAuth callback and return
 * pages): the mailboxes connected through the plugin, business mailboxes
 * included. NocoHR's mailbox purposes are `businessMail` (business-mail.ts).
 *
 * Outside production one provider instance, `local`, is configured by
 * default: the 本地文件邮箱 (server/providers/hr/mail/local-provider.ts) under
 * `storage/mail/local/<address>/inbox`, writing sent mail to
 * `storage/mail/outbox`, for development, tests and the demo. Production
 * configures its real providers (IMAP/SMTP, Gmail, Microsoft 365) in
 * config.yml and gets no local instance.
 */
const mail: AppConfigFactory<MailConfig> = defineAppConfig<MailConfig>({
  defaults: ({ paths, env }): MailConfig => ({
    ...DEFAULT_MAIL_CONFIG,
    providers:
      env.NODE_ENV === 'production'
        ? {}
        : {
            local: {
              type: 'local-files',
              directory: paths.storage('mail/local'),
              outboxDirectory: paths.storage('mail/outbox'),
            },
          },
  }),
});

export default mail;
