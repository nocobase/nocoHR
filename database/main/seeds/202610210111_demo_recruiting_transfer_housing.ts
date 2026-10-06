import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * 招聘设置 · 借调人员需安排住宿 for the 启衡精密 demo, development and demo only:
 * skipped with NODE_ENV=production or HR_DEMO_SEED=false. The loan option of
 * a workforce plan used to carry the housing risk for every employer; it is
 * now the setting `workforce.transferHousingRisk`, off for a new install. The
 * demo's factories house the staff they lend, so its settings row turns it
 * on. Only the demo row is touched (the one lending from 苏州机加工车间,
 * sz-mc), and only while the setting was never saved: a choice already made
 * on 设置 / 招聘设置 is kept.
 */
const ROW_ID = 'recruiting.settings';

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
  name: '202610210111_demo_recruiting_transfer_housing',
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
    if (!workforce || workforce.transferHousingRisk !== undefined) return;
    const limits = Array.isArray(workforce.transferLimits)
      ? (workforce.transferLimits as { departmentId?: unknown }[])
      : [];
    if (!limits.some((l) => l.departmentId === 'sz-mc')) return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: {
          ...value,
          workforce: { ...workforce, transferHousingRisk: true },
        },
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where('id', '=', ROW_ID)
      .execute();
  },
});
export default seed;
