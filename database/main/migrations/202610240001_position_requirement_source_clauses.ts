import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V3-08 新岗位自动起草 (01-演示案例 · 能力模型: 每项注明出自说明书哪一条):
 * `sourceClauses` on `positionRequirements` holds the clauses of the
 * position's 岗位说明书 or 职责说明 a drafted requirement comes from, as
 * `[{ source: 'jd' | 'duties', number, section, item, quote }]`. It is null
 * for a requirement entered by hand or drafted before this column existed.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610240001_position_requirement_source_clauses',
  async up({ builder }) {
    await builder.alterCollection('positionRequirements', (c) => {
      c.json('sourceClauses').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('positionRequirements', (c) => {
      c.dropFields('sourceClauses');
    });
  },
});

export default migration;
