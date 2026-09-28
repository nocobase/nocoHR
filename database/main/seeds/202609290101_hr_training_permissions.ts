import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { HR_PERMISSION_SETS } from '../../seed-data/permission-sets.js';

/**
 * Training operations (V2 step 5) add pages and business operations to the
 * job permission sets. A fresh installation already receives them from the
 * first permission seed. For an installation created before, this appends to
 * each existing set only the grants of resources this step introduced,
 * leaving every grant an administrator already chose untouched.
 */
const INTRODUCED = new Set([
  'page:talent.paths',
  'page:talent.sessions',
  'page:talent.practiceScenarios',
  'page:talent.learningPlans',
  'page:talent.practice',
  'page:talent.checkIn',
  'composite:talent.learningPath',
  'composite:talent.trainingSession',
  'composite:talent.practiceScenario',
  'composite:talent.practice',
  'composite:talent.learningPlan',
  'composite:talent.learningCoach',
  'composite:talent.practiceCoach',
]);

interface StoredGrant {
  resource: { type: string; id: string };
  actions: unknown[];
}

function decode(value: unknown): StoredGrant[] {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1)
    current = JSON.parse(current);
  return Array.isArray(current) ? (current as StoredGrant[]) : [];
}

const key = (grant: StoredGrant) =>
  `${grant.resource.type}:${grant.resource.id}`;

const seed: SeedDefinition = defineSeed({
  name: '202609290101_hr_training_permissions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    for (const set of HR_PERMISSION_SETS) {
      const row = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id', 'grants'])
        .where('key', '=', set.key)
        .executeTakeFirst();
      if (!row) {
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
        continue;
      }
      const stored = decode(row.grants);
      const present = new Set(stored.map(key));
      const additions = (set.grants as unknown as StoredGrant[]).filter(
        (grant) => INTRODUCED.has(key(grant)) && !present.has(key(grant)),
      );
      if (!additions.length) continue;
      await query
        .updateTable('authorizationPermissionSets')
        .set({
          grants: JSON.stringify([...stored, ...additions]),
          updatedAt: now,
        })
        .where('id', '=', String(row.id))
        .execute();
    }
  },
});

export default seed;
