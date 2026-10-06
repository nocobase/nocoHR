import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * The talent review settings (`personnelSettings` row `talentReview`) no
 * longer default to manufacturing words: the translation glossary is empty,
 * and the practical checklist's rule fallback reads neutral section and
 * critical words. The 启衡精密 demo keeps what it was built on — the four
 * glossary terms and the words of its work instructions (检验, 点检, 首件) —
 * by writing them into the row, each only when the row does not hold that
 * value yet, so nothing an administrator saved is replaced. The values are
 * written out here because a seed must not follow later changes to the
 * defaults. Development and demo only (`NODE_ENV=production`,
 * `HR_DEMO_SEED=false` or `HR_TALENT_REVIEW_DEMO=false` skips it).
 */
const ROW_ID = 'talentReview';
const DEMO_VALUES: Record<string, unknown> = {
  glossary: [
    { zh: '首件检验', en: 'first article inspection' },
    { zh: '作业指导书', en: 'work instruction' },
    { zh: '质量问题', en: 'quality issue' },
    { zh: '上岗证', en: 'job qualification certificate' },
  ],
  practicalSectionKeywords: ['检验', '操作', '点检', '记录', '安全'],
  practicalCriticalKeywords: ['安全', '首件', '须', '禁止', '不得'],
};

const seed: SeedDefinition = defineSeed({
  name: '202610210131_demo_talent_review_terms',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_TALENT_REVIEW_DEMO === 'false'
    )
      return;
    const now = new Date();
    const row = await query
      .selectFrom('personnelSettings')
      .select(['value', 'revision'])
      .where('id', '=', ROW_ID)
      .executeTakeFirst();
    if (!row) {
      await query
        .insertInto('personnelSettings')
        .values({
          id: ROW_ID,
          value: JSON.stringify(DEMO_VALUES),
          revision: 1,
          updatedBy: 'system',
          createdAt: now,
          updatedAt: now,
        })
        .execute();
      return;
    }
    let value: unknown = row.value;
    for (let i = 0; i < 3 && typeof value === 'string'; i++)
      value = JSON.parse(value);
    const stored =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const missing = Object.fromEntries(
      Object.entries(DEMO_VALUES).filter(([key]) => stored[key] === undefined),
    );
    if (!Object.keys(missing).length) return;
    await query
      .updateTable('personnelSettings')
      .set({
        value: JSON.stringify({ ...stored, ...missing }),
        revision: Number(row.revision ?? 0) + 1,
        updatedAt: now,
      })
      .where('id', '=', ROW_ID)
      .execute();
  },
});
export default seed;
