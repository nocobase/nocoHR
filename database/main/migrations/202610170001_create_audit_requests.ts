import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-11 客户审核问询 (审核邮箱 · 审核请求):
 *
 * - `auditRequests`: a customer's request for audit material, created from a
 *   message in the audit mailbox. The recognised `scope` (departments,
 *   positions, materials) waits as `reviewStatus = draft` until a person
 *   confirms it; only then can the pack be built. `excludedRequests` lists
 *   what was asked for but is never provided (contact details, ID numbers,
 *   salary). `risks` is the snapshot listed when the request arrived.
 * - The share link is stored as a hash with its expiry and revocation; the
 *   one-time code sent to `requesterAddress` likewise, with its expiry and
 *   failed attempts. `downloads` records each download through the link
 *   (time, source address); every download is also in `auditExports`.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610170001_create_audit_requests',
  async up({ builder }) {
    await builder.createCollection('auditRequests', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('customerName', { length: 200 }).notNull();
      c.string('requesterAddress', { length: 320 }).notNull();
      c.json('scope').notNull();
      c.json('excludedRequests').nullable();
      c.json('unmatchedNames').nullable();
      c.date('dueDate').nullable();
      // draft | confirmed | packReady | replied | closed
      c.string('status', { length: 16 }).notNull();
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull();
      c.json('risks').nullable();
      c.string('packFileId', { length: 64 }).nullable();
      c.string('packFileName', { length: 255 }).nullable();
      c.string('shareTokenHash', { length: 128 }).nullable();
      c.datetime('shareExpiresAt').nullable();
      c.datetime('shareRevokedAt').nullable();
      c.string('shareCodeHash', { length: 128 }).nullable();
      c.datetime('shareCodeExpiresAt').nullable();
      c.integer('shareCodeAttempts').notNull().defaultTo(0);
      c.datetime('shareCodeSentAt').nullable();
      c.json('downloads').nullable();
      c.string('sourceMailId', { length: 64 }).nullable();
      c.string('createdBy', { length: 64 }).nullable();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['shareTokenHash']);
      c.index(['status']);
      c.index(['sourceMailId']);
    });
  },
  async down({ builder }) {
    await builder.dropCollection('auditRequests');
  },
});

export default migration;
