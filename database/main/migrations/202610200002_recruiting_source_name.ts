import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V2-07 渠道名称: a resume a job site forwards to the recruiting mailbox keeps
 * `sourceChannel = email` (招聘邮箱) and records the site in `sourceName`
 * (e.g. 蜀才招聘网), on the candidate and on the application.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610200002_recruiting_source_name',
  async up({ builder }) {
    await builder.alterCollection('candidates', (c) => {
      c.string('sourceName', { length: 100 }).nullable();
    });
    await builder.alterCollection('applications', (c) => {
      c.string('sourceName', { length: 100 }).nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('applications', (c) => {
      c.dropFields('sourceName');
    });
    await builder.alterCollection('candidates', (c) => {
      c.dropFields('sourceName');
    });
  },
});

export default migration;
