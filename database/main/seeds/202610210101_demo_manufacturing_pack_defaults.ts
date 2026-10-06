import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * The 持证上岗 industry pack's certification-only list no longer defaults to the manufacturing sets
 * (prod.cncOperator, equip.forkliftOperator): a hospital or a store has neither. The 启衡精密 demo keeps
 * them by writing the list into its pack row, only when the row does not hold one yet, so an
 * administrator's list is never replaced. Development and demo only, like the other demo seeds.
 */
const PACK_ROW = 'licensedOperation.pack';
const MANUFACTURING_SETS = ['prod.cncOperator', 'equip.forkliftOperator'];

const seed: SeedDefinition = defineSeed({
  name: '202610210101_demo_manufacturing_pack_defaults',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_LICENSED_DEMO === 'false'
    )
      return;
    const now = new Date();
    const row = await query
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', PACK_ROW)
      .executeTakeFirst();
    if (!row) {
      await query
        .insertInto('personnelSettings')
        .values({
          id: PACK_ROW,
          value: JSON.stringify({
            certificationOnlyPermissionSets: MANUFACTURING_SETS,
          }),
          revision: 1,
          updatedBy: 'system',
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return;
    }
    let value: unknown = row.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    const stored =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (stored.certificationOnlyPermissionSets !== undefined) return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: JSON.stringify({
          ...stored,
          certificationOnlyPermissionSets: MANUFACTURING_SETS,
        }),
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: now,
      })
      .where('id', '=', PACK_ROW)
      .execute();
  },
});

export default seed;
