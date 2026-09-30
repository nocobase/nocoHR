import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

/**
 * V4-13 能力模型版本, required (not a demo): 首次上线时为每个岗位把现有要求生成
 * 1 号版本 (published). A position that already has a version is left alone;
 * a position created later gets its version 1 the first time its versions
 * are read or drafted (talent-review/model-versions.ts).
 */
const seed: SeedDefinition = defineSeed({
  name: '202610110102_talent_review_initial_versions',
  transaction: true,
  async run({ query }) {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const positions = await query.selectFrom('positions').select(['id']).execute();
    for (const position of positions) {
      const positionId = String(position.id);
      const existing = await query
        .selectFrom('competencyModelVersions')
        .select(['id'])
        .where('positionId', '=', positionId)
        .executeTakeFirst();
      if (existing) continue;
      const requirements = await query
        .selectFrom('positionRequirements')
        .select(['competencyId', 'requiredLevel', 'mandatory'])
        .where('positionId', '=', positionId)
        .where('reviewStatus', '=', 'confirmed')
        .execute();
      const snapshot = requirements
        .map((r) => ({
          competencyId: String(r.competencyId),
          requiredLevel: Number(r.requiredLevel),
          mandatory: r.mandatory === true || r.mandatory === 1,
        }))
        .sort((a, b) => a.competencyId.localeCompare(b.competencyId));
      await query
        .insertInto('competencyModelVersions')
        .values({
          id: randomUUID(),
          positionId,
          versionNo: 1,
          snapshot,
          status: 'published',
          effectiveFrom: today,
          changeNote: null,
          changeNoteSource: null,
          changeNoteHash: null,
          impactPreview: null,
          publishedBy: null,
          publishedAt: now,
          archivedAt: null,
          source: 'system',
          createdBy: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    }
  },
});
export default seed;
