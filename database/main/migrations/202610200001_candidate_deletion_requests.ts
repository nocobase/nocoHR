import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-07 删除申请: the resume receipt carries a link through which the
 * candidate asks for their information to be deleted.
 *
 * - `candidates.deletionTokenHash`: the link's token, stored as a hash; it is
 *   cleared when the candidate is anonymized, so the link stops working.
 * - `candidates.deletionRequestedAt`: when the candidate asked; a recruiter
 *   then anonymizes them (`anonymizedAt` / `anonymizedBy` record who and when).
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610200001_candidate_deletion_requests',
  async up({ builder }) {
    await builder.alterCollection('candidates', (c) => {
      c.string('deletionTokenHash', { length: 128 }).nullable();
      c.datetime('deletionRequestedAt').nullable();
      c.index(['deletionTokenHash']);
    });
  },
  async down({ builder }) {
    // The index `up` creates is unnamed, so the builder named it idx_candidates_deletion_token_hash. Corrected
    // 2026-10-07 with the user's approval: this `down` dropped a name that never existed. The index goes in its
    // own step: SQLite rebuilds the table to drop the columns, so in the same step the index is already gone.
    await builder.alterCollection('candidates', (c) => {
      c.dropIndex('idx_candidates_deletion_token_hash');
    });
    await builder.alterCollection('candidates', (c) => {
      c.dropFields('deletionTokenHash', 'deletionRequestedAt');
    });
  },
});

export default migration;
