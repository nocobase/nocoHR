import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { attendanceSettingsResource } from '../../../server/providers/hr/attendance-settings-resource.js';

/** One-time, additive V2 configuration access; preserve existing administrator choices. */
const seed: SeedDefinition = defineSeed({
  name: '202609290105_attendance_settings_permissions',
  transaction: true,
  async run(context) {
    const { query } = context;
    // Stable optimistic serialization row: competing catalog edits must not both pass a conflict scan.
    const settings = context.repository('personnelSettings');
    if (!(await settings.exists({ filter: { id: 'attendance.catalog' } }))) {
      await settings.createOne({
        values: {
          id: 'attendance.catalog',
          value: {},
          revision: 0,
          updatedBy: 'system',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const row = await query
      .selectFrom('authorizationPermissionSets')
      .select(['id', 'grants'])
      .where('key', '=', 'hr.admin')
      .executeTakeFirst();
    if (!row) throw new Error('Missing required permission set: hr.admin');
    let decoded = row.grants;
    for (let i = 0; i < 3 && typeof decoded === 'string'; i++)
      decoded = JSON.parse(decoded);
    if (!Array.isArray(decoded)) throw new Error('Invalid permission grants');
    const grants = decoded as {
      resource: { type: string; id: string };
      actions: { action: string }[];
    }[];
    const resource = { type: 'composite', id: 'talent.attendanceSettings' };
    const existing = grants.find(
      (g) => g.resource.type === resource.type && g.resource.id === resource.id,
    );
    if (existing?.actions.some((a) => a.action === 'manage')) return;
    const action = attendanceSettingsResource.reference().grant({
      manage: {
        configuration: 'allRecords',
        shifts: 'allRecords',
        rules: 'allRecords',
        departments: 'allRecords',
        schedules: 'allRecords',
      },
    }).actions[0];
    if (existing) existing.actions.push(action);
    else grants.push({ resource, actions: [action] });
    await query
      .updateTable('authorizationPermissionSets')
      .set({ grants: JSON.stringify(grants), updatedAt: new Date() })
      .where('id', '=', String(row.id))
      .execute();
  },
});
export default seed;
