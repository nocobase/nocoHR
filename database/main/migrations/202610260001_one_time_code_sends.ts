import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Readiness review 2026-10-07: how many one-time codes a share link has sent.
 * A new code reset the wrong-attempt count, so codes requested again and
 * again gave unlimited guesses; a link now sends at most five codes
 * (documentShares for 已离职员工的文件, auditRequests for 客户审核包).
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610260001_one_time_code_sends',
  async up({ builder }) {
    await builder.alterCollection('documentShares', (c) => {
      c.integer('codeSends').notNull().defaultTo(0);
    });
    await builder.alterCollection('auditRequests', (c) => {
      c.integer('shareCodeSends').notNull().defaultTo(0);
    });
  },
  async down({ builder }) {
    await builder.alterCollection('auditRequests', (c) => {
      c.dropFields('shareCodeSends');
    });
    await builder.alterCollection('documentShares', (c) => {
      c.dropFields('codeSends');
    });
  },
});

export default migration;
