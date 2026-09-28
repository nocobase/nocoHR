import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * Browsing the employee list became its own business action (`list`) after
 * the job permission sets were first written. For an installation that
 * already has them, add `list` to the talent.employee grant of hr.admin (all
 * employees) and hr.manager (managed departments) — only when the set still
 * has no `list` entry, so an administrator's later choice is left alone.
 */
const PATCHES: Record<string, string> = {
  'hr.admin': 'allRecords',
  'hr.manager': 'talent.managedDepartments',
};

interface StoredGrant {
  resource: { type: string; id: string };
  actions: { action: string; policy?: unknown }[];
}

function decode(value: unknown): StoredGrant[] {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1)
    current = JSON.parse(current);
  return Array.isArray(current) ? (current as StoredGrant[]) : [];
}

const seed: SeedDefinition = defineSeed({
  name: '202609270103_hr_employee_list_grant',
  transaction: true,
  async run({ query }) {
    for (const [key, scope] of Object.entries(PATCHES)) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) continue;
      const grants = decode(row.grants);
      const grant = grants.find(
        (g) =>
          g.resource.type === 'composite' &&
          g.resource.id === 'talent.employee',
      );
      if (!grant || grant.actions.some((a) => a.action === 'list')) continue;
      grant.actions.push({
        action: 'list',
        policy: { type: 'composite', scopes: { employees: scope } },
      });
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});

export default seed;
