import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 工作台 · AI 员工备好的材料: `workItems.detail` holds the full text an AI
 * employee prepared for its recipient (转正准备, 续签准备, 变动影响清单说明,
 * 用工合规提示), so the workbench card can expand it; `summary` keeps the
 * short line. The same text already reaches that recipient's inbox.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610150001_add_work_item_detail',
  async up({ builder }) {
    await builder.alterCollection('workItems', (c) => {
      c.text('detail').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('workItems', (c) => {
      c.dropFields('detail');
    });
  },
});

export default migration;
