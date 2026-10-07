import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * The 启衡精密 demo is a manufacturing case: it turns the 制造业 industry content pack on (设备开工登记,
 * 叉车出库登记 and their traces), only when the `industryPacks` row holds no choice yet, so an administrator's
 * choice is never replaced. Development and demo only, like the other demo seeds.
 */
const ROW = 'industryPacks';

const seed: SeedDefinition = defineSeed({
  name: '202610230102_demo_industry_pack',
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
      .where('id', '=', ROW)
      .executeTakeFirst();
    if (!row) {
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
      return;
    }
    let value: unknown = row.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    const stored =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    if (stored.enabled !== undefined) return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: JSON.stringify({ ...stored, enabled: ['manufacturing'] }),
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: now,
      })
      .where('id', '=', ROW)
      .execute();
  },
});

export default seed;
