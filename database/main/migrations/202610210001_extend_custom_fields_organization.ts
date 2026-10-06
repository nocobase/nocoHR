import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 界面追加字段 on the organisation: `customFields` on `departments` and
 * `positions` holds the values of administrator-added fields (总纲 可定制约定),
 * keyed by the definition's internal key — e.g. a store's 门店编号 and
 * 营业面积, a ward's 床位数, a position's 执业资格要求 — so an industry can
 * describe its units and posts without a schema change.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610210001_extend_custom_fields_organization',
  async up({ builder }) {
    await builder.alterCollection('departments', (c) => {
      c.json('customFields').nullable();
    });
    await builder.alterCollection('positions', (c) => {
      c.json('customFields').nullable();
    });
  },
  async down({ builder }) {
    await builder.alterCollection('positions', (c) => {
      c.dropFields('customFields');
    });
    await builder.alterCollection('departments', (c) => {
      c.dropFields('customFields');
    });
  },
});

export default migration;
