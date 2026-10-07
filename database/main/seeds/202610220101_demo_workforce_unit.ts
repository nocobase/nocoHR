import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 招聘设置 · 业务量单位 for the 启衡精密 demo, development and demo only:
 * skipped with NODE_ENV=production or HR_DEMO_SEED=false. A workforce plan's
 * quantities used to be written as 件 for every employer; the unit is now the
 * setting `workforce.unitLabel`, unset for a new install (shown as the neutral
 * 单位 / units). The demo's CNC workshop counts pieces, so its settings row
 * gets 件. Only the demo row is touched (the one with the 成都机加工车间 cd-mc
 * capacity parameters), and only while the unit was never saved: a unit
 * already chosen on 设置 / 招聘设置 is kept.
 */
const ROW_ID = 'recruiting.settings';
export const DEMO_WORKFORCE_UNIT = '件';

function parse(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string')
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null;
}

const seed: SeedDefinition = defineSeed({
  name: '202610220101_demo_workforce_unit',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const row = await query
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', ROW_ID)
      .executeTakeFirst();
    const value = parse(row?.value);
    if (!row || !value) return;
    const workforce = parse(value.workforce);
    if (!workforce || workforce.unitLabel !== undefined) return;
    const capacity = Array.isArray(workforce.capacity)
      ? (workforce.capacity as { departmentId?: unknown }[])
      : [];
    if (!capacity.some((c) => c.departmentId === 'cd-mc')) return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: {
          ...value,
          workforce: { ...workforce, unitLabel: DEMO_WORKFORCE_UNIT },
        },
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where('id', '=', ROW_ID)
      .execute();
  },
});
export default seed;
