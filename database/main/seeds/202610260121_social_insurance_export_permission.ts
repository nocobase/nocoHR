import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { socialInsuranceResource } from '../../../server/providers/hr/payroll/resources.js';

interface Grant {
  resource: { type: string; id: string };
  actions: { action: string }[];
}

const ALL = 'allRecords';

/**
 * 社保增减员导出 (talent.socialInsurance export): the 增减员 CSV used to need
 * only view; it is now its own export action, like the payroll and vendor
 * bill files. 薪酬专员 hr.payroll, which exported it until now, keeps it.
 * Only the missing action is added, so an administrator's edits stay; a
 * set that does not exist is skipped.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610260121_social_insurance_export_permission',
  transaction: true,
  async run({ query }) {
    const grant = socialInsuranceResource.reference().grant({
      export: { employees: ALL, employeeSocialInsurances: ALL },
    }) as unknown as Grant;
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
    const current = existing.find(
      (g) =>
        g.resource.type === grant.resource.type &&
        g.resource.id === grant.resource.id,
    );
    if (!current) existing.push(grant);
    else {
      const missing = grant.actions.filter(
        (action) => !current.actions.some((a) => a.action === action.action),
      );
      if (!missing.length) return;
      current.actions.push(...missing);
    }
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(existing), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;
