import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { leaveResource } from '../../../server/providers/hr/leave-resources.js';

/** Add the request/approval actions without replacing administrator edits. */
const seed: SeedDefinition = defineSeed({
  name: '202609290109_leave_request_permissions',
  transaction: true,
  async run({ query }) {
    const additions = [
      {
        key: 'hr.admin',
        grant: {
          request: {
            requests: 'allRecords',
            employees: 'allRecords',
            types: 'allRecords',
            balances: 'allRecords',
            schedules: 'allRecords',
            attendance: 'allRecords',
            configuration: 'allRecords',
          },
          approve: {
            requests: 'allRecords',
            employees: 'allRecords',
            types: 'allRecords',
            balances: 'allRecords',
            schedules: 'allRecords',
            attendance: 'allRecords',
            configuration: 'allRecords',
          },
        },
      },
      {
        key: 'hr.manager',
        grant: {
          request: {
            requests: 'talent.self',
            employees: 'talent.self',
            types: 'allRecords',
            balances: 'talent.self',
            schedules: 'talent.self',
            attendance: 'talent.self',
            configuration: 'allRecords',
          },
          approve: {
            requests: 'talent.managedDepartments',
            employees: 'talent.managedDepartments',
            types: 'allRecords',
            balances: 'talent.managedDepartments',
            schedules: 'talent.managedDepartments',
            attendance: 'talent.managedDepartments',
            configuration: 'allRecords',
          },
        },
      },
      {
        key: 'hr.employee',
        grant: {
          request: {
            requests: 'talent.self',
            employees: 'talent.self',
            types: 'allRecords',
            balances: 'talent.self',
            schedules: 'talent.self',
            attendance: 'talent.self',
            configuration: 'allRecords',
          },
        },
      },
    ] as const;
    for (const addition of additions) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', addition.key)
        .executeTakeFirst();
      if (!row)
        throw new Error(`Missing required permission set: ${addition.key}`);
      let decoded: unknown = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i += 1)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const before = JSON.stringify(decoded);
      const grant = leaveResource.reference().grant(addition.grant as never);
      const grants = decoded as {
        resource: { type: string; id: string };
        actions: { action: string; policy?: unknown }[];
      }[];
      const existing = grants.find(
        (item) =>
          item.resource.type === grant.resource.type &&
          item.resource.id === grant.resource.id,
      );
      if (!existing) grants.push(grant as never);
      else
        for (const action of grant.actions)
          if (!existing.actions.some((item) => item.action === action.action))
            existing.actions.push(action);
      if (JSON.stringify(decoded) === before) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({ grants: JSON.stringify(decoded), updatedAt: new Date() })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});
export default seed;
