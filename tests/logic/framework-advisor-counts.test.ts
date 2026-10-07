import { describe, expect, it } from 'vitest';

import {
  categoryCounts,
  createCompetencyDrafts,
  createRequirementDrafts,
} from '../../server/ai/tools/framework-advisor-tools.ts';
import frameworkAdvisor from '../../server/ai/employees/framework-advisor/index.ts';

// The advisor once summed its own list wrongly (“6 项专业技能＋4 项通用素质… 实际为 7 项…更正：8 项”): the
// drafting tools return the counts, and the prompt tells it to quote them instead of counting.

const allow = {
  subjects: { resolveFor: async () => [] },
  for: () => ({ authorize: async () => ({ effect: 'allow' }) }),
};

type Invoke = (ctx: any, args: any) => Promise<any>;

describe('framework advisor counts', () => {
  it('counts by category', () => {
    expect(
      categoryCounts(['skill', 'skill', 'quality', 'qualification', undefined]),
    ).toEqual({ total: 5, skill: 2, quality: 1, qualification: 1 });
  });

  it('returns the counts of the competencies it created', async () => {
    const talent = {
      saveCompetency: async (
        _actor: unknown,
        _id: null,
        item: { code: string; title: string },
      ) => ({ id: `c-${item.code}`, code: item.code, title: item.title }),
    };
    const level = [{ level: 1, title: '入门', behaviors: '能按说明操作' }];
    const result = await (createCompetencyDrafts.invoke as Invoke)(
      { deps: { talent, authz: allow }, actor: { id: 1 } },
      {
        competencies: [
          {
            code: 'a',
            title: 'A',
            category: 'skill',
            maxLevel: 1,
            levels: level,
          },
          {
            code: 'b',
            title: 'B',
            category: 'skill',
            maxLevel: 1,
            levels: level,
          },
          {
            code: 'c',
            title: 'C',
            category: 'quality',
            maxLevel: 1,
            levels: level,
          },
        ],
      },
    );
    expect(result.content.counts).toEqual({
      created: { total: 3, skill: 2, quality: 1, qualification: 0 },
      failed: 0,
    });
  });

  it('returns the counts of the requirements it created', async () => {
    const categories: Record<string, string> = {
      c1: 'skill',
      c2: 'quality',
      c3: 'qualification',
    };
    const talent = {
      positionContext: async () => ({
        position: { jdStatus: 'none', jdText: null, responsibilities: '' },
      }),
      saveRequirement: async (
        _actor: unknown,
        _positionId: string,
        item: { competencyId: string },
      ) => ({ id: `r-${item.competencyId}`, competencyId: item.competencyId }),
    };
    const query = {
      selectFrom: () => query,
      select: () => query,
      where: (_column: string, _op: string, ids: string[]) => {
        query.ids = ids;
        return query;
      },
      ids: [] as string[],
      execute: async () =>
        query.ids.map((id) => ({ id, category: categories[id] })),
    };
    const database = { query: () => query };
    const result = await (createRequirementDrafts.invoke as Invoke)(
      { deps: { talent, authz: allow, database }, actor: { id: 1 } },
      {
        positionId: 'p1',
        requirements: [
          { competencyId: 'c1', requiredLevel: 3, mandatory: true },
          { competencyId: 'c2', requiredLevel: 2, mandatory: false },
          { competencyId: 'c3', requiredLevel: 1, mandatory: true },
        ],
      },
    );
    expect(result.content.counts).toEqual({
      created: { total: 3, skill: 1, quality: 1, qualification: 1 },
      mandatory: 2,
      skipped: 0,
    });
  });

  it('tells the advisor to quote the counts rather than count', () => {
    expect(frameworkAdvisor.systemPrompt).toContain('返回的 counts');
    expect(frameworkAdvisor.systemPrompt).toContain('不要自己数');
  });
});
