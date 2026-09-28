import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { HR_PERMISSION_SETS } from '../../seed-data/permission-sets.js';

/**
 * Knowledge and learning, exams and certification, and the permission loop
 * (V1 steps 2–4) add pages, business operations and two permission sets
 * (hr.instructor and prod.fillingOperator). A fresh installation already receives
 * them from the first permission seed. For an installation created before,
 * this creates the missing sets and appends to the existing ones only the
 * grants of resources these steps introduced, leaving every grant an
 * administrator already chose untouched.
 */
const INTRODUCED = new Set([
  'page:talent.myLearning',
  'page:talent.knowledgeQa',
  'page:talent.knowledge',
  'page:talent.courses',
  'page:talent.assignments',
  'page:talent.myExams',
  'page:talent.questions',
  'page:talent.exams',
  'page:talent.certifications',
  'page:talent.trainingReports',
  'page:demo.batchRecord',
  'composite:talent.kbDocument',
  'composite:talent.knowledgeGap',
  'composite:talent.course',
  'composite:talent.assignment',
  'composite:talent.learning',
  'composite:talent.learningHistory',
  'composite:talent.knowledgeAssistant',
  'composite:talent.contentWriter',
  'composite:talent.question',
  'composite:talent.exam',
  'composite:talent.examTaking',
  'composite:talent.certification',
  'composite:talent.certificate',
  'composite:talent.trainingReport',
  'composite:talent.certificationSteward',
  'composite:demo.batch',
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
  name: '202609280101_hr_learning_permissions',
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
