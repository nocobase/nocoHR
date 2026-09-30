import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1-04 飞书卡片与按用户推送:
 *
 * - `imCards`: an interactive card sent to one bound user through the office
 *   suite bot (本人提交, 审批). The card's buttons carry only the card id, so a
 *   callback cannot change what it acts on; the drafted payload stays here
 *   and is cleared once the card is handled. Business state stays in the
 *   business tables — a card is re-rendered from them.
 * - `workItems.pushedAt` / `pushError`: the result of pushing a to-do to the
 *   user's bound office suite, since the notification plugin cannot send to
 *   one user there (no separate message table).
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610050001_add_im_cards',
  async up({ builder }) {
    await builder.createCollection('imCards', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('provider', { length: 16 }).notNull();
      c.string('kind', { length: 64 }).notNull();
      c.string('recipientUserId', { length: 64 }).notNull();
      c.string('externalUserId', { length: 128 }).notNull();
      c.string('refType', { length: 64 }).notNull();
      c.string('refId', { length: 128 }).notNull();
      // Deduplicates a card per recipient and business step.
      c.string('dedupeKey', { length: 255 }).notNull();
      c.json('payload').nullable();
      c.string('status', { length: 16 }).notNull().defaultTo('open');
      c.string('resultText', { length: 500 }).nullable();
      c.datetime('handledAt').nullable();
      c.string('sendError', { length: 255 }).nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['dedupeKey']);
      c.index(['refType', 'refId']);
      c.index(['externalUserId', 'createdAt']);
    });
    await builder.alterCollection('workItems', (c) => {
      c.datetime('pushedAt').nullable();
      c.string('pushError', { length: 255 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('workItems', (c) => {
      c.dropFields('pushedAt', 'pushError');
    });
    await builder.dropCollection('imCards');
  },
});

export default migration;
