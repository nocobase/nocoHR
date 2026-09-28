import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * The position and competency framework: job families, positions, the
 * competency dictionary with its level descriptions, and what each position
 * requires. Competencies and requirements carry `source` and `reviewStatus`
 * because the framework advisor writes drafts that a person confirms.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609270002_create_talent_framework',
  async up({ builder }) {
    await builder.createCollection('jobFamilies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code', { length: 64 }).notNull();
      c.string('title').notNull();
      c.text('description').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.integer('sortOrder').notNull().defaultTo(0);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code');
    });
    await builder.createCollection('positions', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code', { length: 64 }).notNull();
      c.string('title').notNull();
      c.string('jobFamilyId', { length: 64 }).notNull();
      c.string('grade', { length: 32 }).nullable();
      // The job description the framework advisor reads.
      c.text('responsibilities').nullable();
      c.boolean('active').notNull().defaultTo(true);
      c.integer('sortOrder').notNull().defaultTo(0);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code');
      c.index('jobFamilyId');
    });
    await builder.createCollection('competencies', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('code', { length: 64 }).notNull();
      c.string('title').notNull();
      // skill | quality | qualification
      c.string('category', { length: 32 }).notNull();
      c.text('description').nullable();
      c.integer('maxLevel').notNull().defaultTo(5);
      // manual | ai | import
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('confirmed');
      c.boolean('active').notNull().defaultTo(true);
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('code');
      c.index('category');
      c.index('reviewStatus');
    });
    await builder.createCollection('competencyLevels', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('competencyId', { length: 64 }).notNull();
      c.integer('level').notNull();
      c.string('title').notNull();
      c.text('behaviors').notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['competencyId', 'level']);
    });
    await builder.createCollection('positionRequirements', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('positionId', { length: 64 }).notNull();
      c.string('competencyId', { length: 64 }).notNull();
      c.integer('requiredLevel').notNull();
      c.boolean('mandatory').notNull().defaultTo(false);
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('confirmed');
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['positionId', 'competencyId']);
      c.index('competencyId');
    });
  },
  async down({ builder }) {
    await builder.dropCollection('positionRequirements');
    await builder.dropCollection('competencyLevels');
    await builder.dropCollection('competencies');
    await builder.dropCollection('positions');
    await builder.dropCollection('jobFamilies');
  },
});

export default migration;
