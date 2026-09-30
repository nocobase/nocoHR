import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-11 课程修订记录: an applied lesson suggestion remembers who applied it,
 * when, and the course version it produced, so a course's revision history
 * lists each application with its handler and the suggestions it took.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610080002_extend_content_revisions',
  async up({ builder }) {
    await builder.alterCollection('contentRevisions', (c) => {
      c.string('appliedBy', { length: 64 }).nullable();
      c.datetime('appliedAt').nullable();
      c.integer('appliedVersion').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('contentRevisions', (c) => {
      c.dropFields('appliedBy', 'appliedAt', 'appliedVersion');
    });
  },
});

export default migration;
