import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-06 业务邮箱与邮件往来 (总纲 邮件约定):
 *
 * - `businessMailMessages` (named `mailMessages` until 2026-10-05, renamed for
 *   the Mail plugin's own `mailMessages`; see 202609020001): one row per
 *   message a business mailbox received or the
 *   application sent (drafts included), grouped by `threadKey` and linked to
 *   the business record it belongs to (`refType` / `refId`). `mailbox` is the
 *   purpose (billing, recruiting, audit, hr); later steps add purposes and
 *   record types, not columns. A received message is stored once per
 *   (`mailbox`, `messageId`).
 * - `laborVendorBills.sourceMailId`: the message a bill came from, when it
 *   arrived in the billing mailbox.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610160001_create_mail_messages',
  async up({ builder }) {
    await builder.createCollection('businessMailMessages', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('mailbox', { length: 32 }).notNull();
      c.string('direction', { length: 16 }).notNull();
      c.string('status', { length: 16 }).notNull();
      c.string('messageId', { length: 255 }).nullable();
      c.string('inReplyTo', { length: 255 }).nullable();
      c.string('threadKey', { length: 64 }).notNull();
      c.string('fromAddress', { length: 320 }).notNull();
      c.string('fromName', { length: 200 }).nullable();
      c.json('toAddresses').notNull();
      c.json('ccAddresses').nullable();
      c.string('subject', { length: 500 }).notNull();
      c.text('bodyText').nullable();
      c.json('attachmentFileIds').nullable();
      c.json('rejectedAttachments').nullable();
      c.string('refType', { length: 32 }).nullable();
      c.string('refId', { length: 64 }).nullable();
      c.string('aiIntent', { length: 64 }).nullable();
      c.text('aiSummary').nullable();
      c.string('draftOf', { length: 64 }).nullable();
      c.string('sentBy', { length: 64 }).nullable();
      c.datetime('sentAt').nullable();
      c.string('deliveryError', { length: 200 }).nullable();
      c.datetime('receivedAt').nullable();
      c.date('retentionUntil').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['mailbox', 'messageId']);
      c.index(['mailbox', 'status']);
      c.index(['threadKey']);
      c.index(['refType', 'refId']);
      c.index(['retentionUntil']);
    });
    await builder.alterCollection('laborVendorBills', (c) => {
      c.string('sourceMailId', { length: 64 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('laborVendorBills', (c) => {
      c.dropFields('sourceMailId');
    });
    await builder.dropCollection('businessMailMessages');
  },
});

export default migration;
