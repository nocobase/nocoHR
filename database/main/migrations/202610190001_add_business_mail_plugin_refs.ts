import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 业务邮件改用 Mail 插件 (2026-10-05): a business message received or sent
 * through a Mail plugin account remembers that account and the plugin's own
 * message id, so a reply can be sent in the same conversation. Messages from
 * before the change have neither.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610190001_add_business_mail_plugin_refs',
  async up({ builder }) {
    await builder.alterCollection('businessMailMessages', (c) => {
      c.string('mailAccountId', { length: 64 }).nullable();
      c.string('mailMessageRef', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('businessMailMessages', (c) => {
      c.dropFields('mailAccountId', 'mailMessageRef');
    });
  },
});

export default migration;
