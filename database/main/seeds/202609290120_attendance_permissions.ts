import { defineSeed, type SeedDefinition } from '@nocobase/db';

import {
  adjustmentResource,
  attendanceRecordResource,
} from '../../../server/providers/hr/attendance-resources.js';

/**
 * V2-05 权限配置, the parts earlier attendance seeds left out: 考勤记录
 * (view / import / recompute / lock / unlock) and 考勤调整申请 (request /
 * approve), and the 考勤 and 我的考勤 pages. hr.admin: everything, all
 * records; hr.manager: view and approve within managed departments, request
 * for themself; hr.employee: view and request for themself. Adds what is
 * missing; an administrator's edits stay.
 */
type Grant = {
  resource: { type: string; id: string };
  actions: { action: string }[];
};

const ALL = 'allRecords';
const MANAGED = 'talent.managedDepartments';
const SELF = 'talent.self';

const composites = [
  {
    resource: attendanceRecordResource,
    grants: {
      'hr.admin': {
        view: { employees: ALL, records: ALL, summaries: ALL },
        import: { employees: ALL, records: ALL },
        recompute: { employees: ALL, records: ALL },
        lock: { employees: ALL, summaries: ALL },
        unlock: { employees: ALL, summaries: ALL },
      },
      'hr.manager': {
        view: { employees: MANAGED, records: MANAGED, summaries: MANAGED },
      },
      'hr.employee': {
        view: { employees: SELF, records: SELF, summaries: SELF },
      },
    },
  },
  {
    resource: adjustmentResource,
    grants: {
      'hr.admin': {
        request: { employees: SELF, adjustments: SELF },
        approve: { employees: ALL, adjustments: ALL },
      },
      'hr.manager': {
        request: { employees: SELF, adjustments: SELF },
        approve: { employees: MANAGED, adjustments: MANAGED },
      },
      'hr.employee': {
        request: { employees: SELF, adjustments: SELF },
      },
    },
  },
] as const;

const pages: Record<string, readonly string[]> = {
  'hr.admin': ['talent.attendance', 'talent.myAttendance'],
  'hr.manager': ['talent.attendance', 'talent.myAttendance'],
  'hr.employee': ['talent.myAttendance'],
};

const seed: SeedDefinition = defineSeed({
  name: '202609290120_attendance_permissions',
  transaction: true,
  async run({ query }) {
    for (const key of ['hr.admin', 'hr.manager', 'hr.employee']) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', key)
        .executeTakeFirst();
      if (!row) throw new Error(`Missing required permission set: ${key}`);
      let decoded: unknown = row.grants;
      for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
        decoded = JSON.parse(decoded);
      if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
      const list = decoded as Grant[];
      const before = JSON.stringify(list);
      for (const composite of composites) {
        const addition = (composite.grants as Record<string, unknown>)[key];
        if (!addition) continue;
        const reference = composite.resource.reference() as unknown as {
          grant(assignments: unknown): Grant;
        };
        const grant = reference.grant(addition);
        const existing = list.find(
          (item) =>
            item.resource.type === grant.resource.type &&
            item.resource.id === grant.resource.id,
        );
        if (!existing) list.push(grant);
        else
          for (const action of grant.actions)
            if (!existing.actions.some((item) => item.action === action.action))
              existing.actions.push(action);
      }
      for (const id of pages[key]) {
        const page = list.find(
          (item) => item.resource.type === 'page' && item.resource.id === id,
        );
        if (!page)
          list.push({
            resource: { type: 'page', id },
            actions: [{ action: 'access' }],
          });
        else if (!page.actions.some((a) => a.action === 'access'))
          page.actions.push({ action: 'access' });
      }
      if (JSON.stringify(list) !== before)
        await query
          .updateTable('authorizationPermissionSets')
          .set({ grants: JSON.stringify(list), updatedAt: new Date() })
          .where('id', '=', String(row.id))
          .execute();
    }
  },
});
export default seed;
