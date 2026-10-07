import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 行业内容包: the manufacturing content of 持证上岗 (设备开工登记, 叉车出库登记) became the 制造业 pack, which is
 * off unless an administrator turns it on (personnelSettings row `industryPacks`). An installation that already
 * uses it, where one of the pack's permission sets still exists and is assigned to something, keeps it on, so
 * nothing it relies on stops working. Every other installation, and every new one, has no pack on: this writes
 * nothing then. A saved choice (the row exists) is never changed.
 */
const ROW = 'industryPacks';
const MANUFACTURING_SETS = ['prod.cncOperator', 'equip.forkliftOperator'];

const seed: SeedDefinition = defineSeed({
  name: '202610230101_industry_pack_in_use',
  transaction: true,
  async run({ query }) {
    const saved = await query
      .selectFrom('personnelSettings')
      .select('id')
      .where('id', '=', ROW)
      .executeTakeFirst();
    if (saved) return;
    let used = false;
    for (const key of MANUFACTURING_SETS) {
      const set = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', key)
        .executeTakeFirst();
      if (!set) continue;
      const assigned = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select('id')
        .where('permissionSetKey', '=', key)
        .executeTakeFirst();
      if (assigned) used = true;
    }
    if (!used) return;
    const now = new Date();
    await query
      .insertInto('personnelSettings')
      .values({
        id: ROW,
        value: JSON.stringify({ enabled: ['manufacturing'], history: [] }),
        revision: 1,
        updatedBy: 'system',
        createdAt: now,
        updatedAt: now,
      })
      .execute();
  },
});

export default seed;
