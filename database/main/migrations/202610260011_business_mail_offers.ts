import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Readiness review 2026-10-07: an HR administrator could bind any user's own
 * mailbox (我的邮箱) as a business mailbox on 设置 / 邮件 and then read and
 * send its mail. A Mail plugin account is now offered for business use by its
 * owner first (我的邮箱 · 允许作为业务邮箱); only offered accounts are listed
 * and may be newly bound. One row per offered account.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610260011_business_mail_offers',
  async up({ builder }) {
    await builder.createCollection('businessMailOffers', (c) => {
      // The Mail plugin account id.
      c.string('accountId', { length: 64 }).notNull();
      c.primary('accountId');
      // The account's owner, who offered it.
      c.string('userId', { length: 64 }).notNull();
      c.datetime('offeredAt').notNull();
      c.index(['userId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('businessMailOffers');
  },
});

export default migration;
