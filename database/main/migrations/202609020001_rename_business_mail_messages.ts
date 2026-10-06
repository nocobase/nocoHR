import {
  defineMigration,
  type CollectionDefinitionBuilder,
  type MigrationDefinition,
} from '@nocobase/db';

/**
 * 业务邮件改用 Mail 插件 (2026-10-05): the business mailboxes' messages move
 * from `mailMessages` to `businessMailMessages`, because the Mail plugin
 * creates its own `mailMessages` (its migration 202609030001_create_mail_tables).
 *
 * The name sorts before the plugin's migration on purpose: pending migrations
 * run in name order, so on a database that already holds the application's
 * table this runs first and the plugin then creates its own. The application's
 * 202610160001 and 202610180001 were changed to the new name in the same
 * change (approved by the user while the application was not yet in use
 * outside development); on such a database their checksums are realigned with
 * `pnpm nocobase db repair` after this migration. A fresh database has no
 * application table here, and nothing happens.
 *
 * The Collection Store cannot rename a collection that carries supplemental
 * metadata (the JSON field types), so the table is created anew with the
 * columns of 202610160001 and 202610180001, the rows are copied in batches
 * (the query builder has no INSERT … SELECT; a business mailbox holds few
 * messages) and the old table is dropped.
 */
const COLUMNS = [
  'id',
  'mailbox',
  'direction',
  'status',
  'messageId',
  'inReplyTo',
  'threadKey',
  'fromAddress',
  'fromName',
  'toAddresses',
  'ccAddresses',
  'subject',
  'bodyText',
  'attachmentFileIds',
  'rejectedAttachments',
  'refType',
  'refId',
  'aiIntent',
  'aiSummary',
  'draftOf',
  'sentBy',
  'sentAt',
  'deliveryError',
  'receivedAt',
  'retentionUntil',
  'createdAt',
  'updatedAt',
  'proposal',
] as const;

const JSON_COLUMNS = new Set<string>([
  'toAddresses',
  'ccAddresses',
  'attachmentFileIds',
  'rejectedAttachments',
  'proposal',
]);

type Query = Parameters<MigrationDefinition['up']>[0]['query'];

/**
 * Copies every row between the two tables, 200 at a time. JSON columns may read
 * back as text; they are decoded first so the builder does not encode them twice.
 */
async function copyRows(
  query: Query,
  from: string,
  to: string,
  columns: readonly string[],
): Promise<void> {
  const rows = await query
    .selectFrom(from)
    .select([...columns])
    .execute();
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((row) =>
      Object.fromEntries(
        columns.map((c) => {
          const value = (row as Record<string, unknown>)[c];
          if (JSON_COLUMNS.has(c) && typeof value === 'string')
            try {
              return [c, JSON.parse(value) as unknown];
            } catch {
              return [c, value];
            }
          return [c, value ?? null];
        }),
      ),
    );
    if (batch.length) await query.insertInto(to).values(batch).execute();
  }
}

/** The business message table as 202610160001 and 202610180001 define it. */
const define = (c: CollectionDefinitionBuilder): void => {
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
  c.json('proposal').nullable();
  c.unique(['mailbox', 'messageId']);
  c.index(['mailbox', 'status']);
  c.index(['threadKey']);
  c.index(['refType', 'refId']);
  c.index(['retentionUntil']);
};

const migration: MigrationDefinition = defineMigration({
  name: '202609020001_rename_business_mail_messages',
  async up({ builder, query }) {
    if (!(await builder.hasCollection('mailMessages'))) return;
    // The table is the application's only when its own migration created it and the plugin's has not run.
    const history = await query
      .selectFrom('__nocobase_migrations')
      .select(['name'])
      .where('name', 'in', [
        '202610160001_create_mail_messages',
        '202610180001_add_mail_proposal',
        '202609030001_create_mail_tables',
      ])
      .execute();
    const names = new Set(history.map((r) => String(r.name)));
    if (
      !names.has('202610160001_create_mail_messages') ||
      names.has('202609030001_create_mail_tables')
    )
      return;
    await builder.createCollection('businessMailMessages', define);
    const copied = COLUMNS.filter(
      (c) => c !== 'proposal' || names.has('202610180001_add_mail_proposal'),
    );
    await copyRows(query, 'mailMessages', 'businessMailMessages', copied);
    await builder.dropCollection('mailMessages');
  },
  async down({ builder, query }) {
    // Only back when the plugin's table is not in the way.
    if (
      !(await builder.hasCollection('businessMailMessages')) ||
      (await builder.hasCollection('mailMessages'))
    )
      return;
    await builder.createCollection('mailMessages', define);
    await copyRows(query, 'businessMailMessages', 'mailMessages', COLUMNS);
    await builder.dropCollection('businessMailMessages');
  },
});

export default migration;
