import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

import { HR_PERMISSION_SETS } from '../../seed-data/permission-sets.js';

/**
 * Creates the talent platform's job permission sets and the one assignment
 * that needs no organisation data: department heads hold hr.manager. A set
 * that already exists is left untouched so administrator edits survive.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609270101_hr_permission_sets',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    for (const set of HR_PERMISSION_SETS) {
      const existing = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', set.key)
        .executeTakeFirst();
      if (existing) continue;
      await query
        .insertInto('authorizationPermissionSets')
        .values({
          id: set.key,
          key: set.key,
          title: encodeAuthorizationTitle(set.title),
          grants: JSON.stringify(set.grants),
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
    const assignment = {
      permissionSetKey: 'hr.manager',
      subjectType: 'org.departmentHead',
      subjectId: '*',
    };
    const existing = await query
      .selectFrom('authorizationPermissionSetAssignments')
      .select('id')
      .where('permissionSetKey', '=', assignment.permissionSetKey)
      .where('subjectType', '=', assignment.subjectType)
      .where('subjectId', '=', assignment.subjectId)
      .executeTakeFirst();
    if (!existing) {
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          ...assignment,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  },
});

export default seed;
