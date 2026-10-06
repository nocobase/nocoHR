import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 设备开工登记 (prod.cncOperator) and 叉车出库登记 (equip.forkliftOperator) are the manufacturing
 * industry pack's permission sets, demonstrated by the 启衡精密 case. Earlier seeds created them on
 * every installation, so a hospital or a store found two factory sets in its permission list. Outside
 * the demo, this removes each of them that nothing is assigned to; one an administrator has put to use
 * stays. The demo (development with demo data) keeps both.
 */
const MANUFACTURING_SETS = ['prod.cncOperator', 'equip.forkliftOperator'];

const seed: SeedDefinition = defineSeed({
  name: '202610210102_drop_unused_manufacturing_sets',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV !== 'production' &&
      process.env.HR_DEMO_SEED !== 'false'
    )
      return;
    for (const key of MANUFACTURING_SETS) {
      const assigned = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select('id')
        .where('permissionSetKey', '=', key)
        .executeTakeFirst();
      if (assigned) continue;
      await query
        .deleteFrom('authorizationPermissionSets')
        .where('key', '=', key)
        .execute();
    }
  },
});

export default seed;
