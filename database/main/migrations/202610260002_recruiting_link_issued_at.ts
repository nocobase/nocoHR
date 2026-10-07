import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Readiness review 2026-10-07: the self-booking and AI-interview links had no
 * time limit. Each now records when it was issued and lasts 30 days (and, as
 * before, only while its posting is open). Links issued before this
 * migration count from the upgrade, so none stops working at once.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610260002_recruiting_link_issued_at',
  async up({ builder, query }) {
    await builder.alterCollection('applications', (c) => {
      c.datetime('bookingTokenIssuedAt').nullable();
      c.datetime('aiInterviewTokenIssuedAt').nullable();
    });
    const now = new Date();
    await query
      .updateTable('applications')
      .set({ bookingTokenIssuedAt: now })
      .where('bookingTokenHash', 'is not', null)
      .execute();
    await query
      .updateTable('applications')
      .set({ aiInterviewTokenIssuedAt: now })
      .where('aiInterviewTokenHash', 'is not', null)
      .execute();
  },
  async down({ builder }) {
    await builder.alterCollection('applications', (c) => {
      c.dropFields('bookingTokenIssuedAt', 'aiInterviewTokenIssuedAt');
    });
  },
});

export default migration;
