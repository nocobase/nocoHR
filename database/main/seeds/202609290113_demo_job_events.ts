import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

/**
 * V1-02 测试数据 · 异动记录: every demo employee's history starts with an
 * onboard event (source=import, on the hire date); 孙丽's comes from her
 * historical onboarding action (source=action). The first demo seed wrote
 * only 孙丽's event, before `source` existed. Development and demo only;
 * an employee who already has any event is left alone.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290113_demo_job_events',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    await query
      .updateTable('jobEvents')
      .set({ source: 'action', updatedAt: now })
      .where('id', '=', 'event-sunli-onboard')
      .where('actionId', 'is not', null)
      .execute();
    const withEvents = new Set(
      (
        await query.selectFrom('jobEvents').select(['employeeId']).execute()
      ).map((row) => String(row.employeeId)),
    );
    const employees = await query
      .selectFrom('employees')
      .select(['id', 'departmentId', 'positionId', 'hireDate'])
      .where('id', 'like', 'emp-%')
      .execute();
    for (const employee of employees) {
      if (withEvents.has(String(employee.id)) || !employee.hireDate) continue;
      await query
        .insertInto('jobEvents')
        .values({
          id: randomUUID(),
          employeeId: String(employee.id),
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: employee.departmentId,
          fromPositionId: null,
          toPositionId: employee.positionId,
          effectiveDate: employee.hireDate,
          source: 'import',
          actionId: null,
          note: null,
          // History, not news: nothing is left for the handler to do.
          processedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  },
});
export default seed;
