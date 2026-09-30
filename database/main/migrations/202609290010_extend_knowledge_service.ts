import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1 step 4 (员工服务与知识问答), the fields the first knowledge base left out:
 *
 * - `knowledgeGaps.channel`: where the question was asked (app | feishu |
 *   dingtalk | wecom); earlier gaps were all asked in the app;
 * - `documentConflicts.source` (ai | manual) and `resolutionNote`, required
 *   when a conflict is ignored and written by the system when a document in
 *   it is superseded or deactivated.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290010_extend_knowledge_service',
  async up({ builder }) {
    await builder.alterCollection('knowledgeGaps', (c) => {
      c.string('channel', { length: 16 }).notNull().defaultTo('app');
    });
    await builder.alterCollection('documentConflicts', (c) => {
      c.string('source', { length: 16 }).notNull().defaultTo('ai');
      c.text('resolutionNote').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('documentConflicts', (c) => {
      c.dropFields('source', 'resolutionNote');
    });
    await builder.alterCollection('knowledgeGaps', (c) => {
      c.dropFields('channel');
    });
  },
});

export default migration;
