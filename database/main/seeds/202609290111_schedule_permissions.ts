import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { scheduleResource } from '../../../server/providers/hr/schedule-resources.js';

/** Add scheduling actions and page access without replacing administrator edits. */
const seed: SeedDefinition = defineSeed({
  name: '202609290111_schedule_permissions',
  transaction: true,
  async run({ query }) {
    const additions = [
      {
        key: 'hr.admin',
        grants: {
          view: {
            employees: 'allRecords',
            shifts: 'allRecords',
            schedules: 'allRecords',
          },
          edit: {
            employees: 'allRecords',
            shifts: 'allRecords',
            schedules: 'allRecords',
          },
          publish: {
            employees: 'allRecords',
            shifts: 'allRecords',
            schedules: 'allRecords',
          },
        },
      },
      {
        key: 'hr.manager',
        grants: {
          view: {
            employees: 'talent.managedDepartments',
            shifts: 'allRecords',
            schedules: 'talent.managedDepartments',
          },
          edit: {
            employees: 'talent.managedDepartments',
            shifts: 'allRecords',
            schedules: 'talent.managedDepartments',
          },
          publish: {
            employees: 'talent.managedDepartments',
            shifts: 'allRecords',
            schedules: 'talent.managedDepartments',
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
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const before = JSON.stringify(decoded);
      const grant = scheduleResource
        .reference()
        .grant(addition.grants as never);
      const existing = (
        decoded as {
          resource: { type: string; id: string };
          actions: { action: string }[];
        }[]
      ).find(
        (item) =>
          item.resource.type === grant.resource.type &&
          item.resource.id === grant.resource.id,
      );
      if (!existing) (decoded as unknown[]).push(grant);
      else
        for (const action of grant.actions)
          if (!existing.actions.some((item) => item.action === action.action))
            existing.actions.push(action);
      if (JSON.stringify(decoded) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(decoded), updatedAt: new Date() })
          .where('id', '=', String(row.id))
          .execute();
    }
    for (const key of ['hr.admin', 'hr.manager'] as const) {
      const pageRow = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!pageRow) throw new Error(`Missing required permission set: ${key}`);
      let grants: unknown = pageRow.grants;
      for (let i = 0; i < 3 && typeof grants === 'string'; i++)
        grants = JSON.parse(grants);
      if (!Array.isArray(grants)) throw new Error('Invalid permission grants');
      const before = JSON.stringify(grants);
      const page = (
        grants as {
          resource: { type: string; id: string };
          actions: { action: string }[];
        }[]
      ).find(
        (item) =>
          item.resource.type === 'page' &&
          item.resource.id === 'talent.schedules',
      );
      if (page) {
        if (!page.actions.some((action) => action.action === 'access'))
          page.actions.push({ action: 'access' });
      } else
        (grants as unknown[]).push({
          resource: { type: 'page', id: 'talent.schedules' },
          actions: [{ action: 'access' }],
        });
      if (JSON.stringify(grants) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
          .where('id', '=', String(pageRow.id))
          .execute();
    }
  },
});
export default seed;
