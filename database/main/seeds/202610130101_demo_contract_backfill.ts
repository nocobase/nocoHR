import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Demo only: full-time staff that later steps' seeds added (payroll01, fin01,
 * recruit01, qa_audit, 顾强, the Chengdu CNC operators, 杨帆, …) get a signed
 * contract from their hire date — three-year fixed-term, or open-ended where
 * three years would end within 90 days (no new expiry prompts) — so 用工合规 shows
 * only the cases the demo means to show. 郭凡 is left without one on purpose
 * (the 未签书面合同 case). Runs after every other demo seed; adds nothing
 * where a contract already exists.
 */
const INTENTIONALLY_UNSIGNED = new Set(['emp-guofan']);

function addYears(date: string, years: number): string {
  return `${Number(date.slice(0, 4)) + years}${date.slice(4)}`;
}

const seed: SeedDefinition = defineSeed({
  name: '202610130101_demo_contract_backfill',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const employees = await query
      .selectFrom('employees')
      .select(['id', 'employeeNo', 'hireDate', 'employmentType', 'status'])
      .where('status', '!=', 'leave')
      .execute();
    const contracted = new Set(
      (
        await query
          .selectFrom('employmentContracts')
          .select(['employeeId'])
          .execute()
      ).map((row) => String(row.employeeId as string)),
    );
    const now = new Date();
    const horizon = new Date(now.getTime() + 90 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    for (const employee of employees) {
      const id = String(employee.id);
      if (contracted.has(id) || INTENTIONALLY_UNSIGNED.has(id)) continue;
      if ((employee.employmentType ?? 'fullTime') !== 'fullTime') continue;
      if (!employee.hireDate) continue;
      const hireValue: unknown = employee.hireDate;
      const hire =
        hireValue instanceof Date
          ? hireValue.toISOString().slice(0, 10)
          : typeof hireValue === 'string'
            ? hireValue.slice(0, 10)
            : '';
      if (!hire) continue;
      await query
        .insertInto('employmentContracts')
        .values({
          id: `contract-demo-${id}`,
          employeeId: id,
          contractNo: `HT-DEMO-${String(employee.employeeNo)}`,
          type: addYears(hire, 3) > horizon ? 'fixedTerm' : 'openEnded',
          startDate: hire,
          endDate: addYears(hire, 3) > horizon ? addYears(hire, 3) : null,
          signedAt: hire,
          status: 'active',
          previousContractId: null,
          fileId: null,
          note: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  },
});
export default seed;
