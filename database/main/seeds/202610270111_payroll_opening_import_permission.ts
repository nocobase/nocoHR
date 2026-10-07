import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  payrollResource,
  salaryResource,
  socialInsuranceResource,
} from '../../../server/providers/hr/payroll/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';

/**
 * 上线准备 · 薪酬期初导入: 薪酬专员 hr.payroll gets the three new import
 * actions — talent.salary import (导入期初档案), talent.socialInsurance
 * import (参保 and 专项附加扣除) and talent.payroll importOpening (本年个税累计
 * 期初). Only a missing action is added, so an administrator's edits (a
 * narrower record scope, say) stay; a set that does not exist is skipped.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610270111_payroll_opening_import_permission',
  transaction: true,
  async run({ query }) {
    const wanted = [
      salaryResource.reference().grant({
        import: {
          employees: ALL,
          employeeSalaries: ALL,
          salaryStructures: ALL,
        },
      }),
      socialInsuranceResource.reference().grant({
        import: {
          employees: ALL,
          socialInsurancePlans: ALL,
          employeeSocialInsurances: ALL,
          employeeTaxDeductions: ALL,
        },
      }),
      payrollResource.reference().grant({
        importOpening: { employees: ALL, payrollTaxOpenings: ALL },
      }),
    ] as unknown as Grant[];
    const row = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'hr.payroll')
      .executeTakeFirst();
    if (!row) return;
    let decoded: unknown = row.grants;
    for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
      decoded = JSON.parse(decoded);
    if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
    const existing = decoded as Grant[];
    let changed = false;
    for (const grant of wanted) {
      const current = existing.find(
        (g) =>
          g.resource.type === grant.resource.type &&
          g.resource.id === grant.resource.id,
      );
      if (!current) {
        existing.push(grant);
        changed = true;
        continue;
      }
      const missing = grant.actions.filter(
        (action) => !current.actions.some((a) => a.action === action.action),
      );
      if (!missing.length) continue;
      current.actions.push(...missing);
      changed = true;
    }
    if (!changed) return;
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;
