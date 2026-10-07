// @vitest-environment node

// The 学习计划 page reads `talent.plans.trigger.<trigger>` for every plan; the key is built at runtime, so a trigger
// the server can store without wording showed its key path ("talent.plans.trigger.developmentTarget").
import { describe, expect, it } from 'vitest';

import enUS from '../../client/locales/en-US.ts';
import zhCN from '../../client/locales/zh-CN.ts';
import { PLAN_TRIGGERS } from '../../server/providers/hr/plan-service.ts';

describe('learning plan trigger wording', () => {
  for (const [locale, resource] of [
    ['en-US', enUS],
    ['zh-CN', zhCN],
  ] as const) {
    it(`every trigger the server stores has a label in ${locale}`, () => {
      const labels = (
        resource as unknown as {
          talent: { plans: { trigger: Record<string, string | undefined> } };
        }
      ).talent.plans.trigger;
      expect(PLAN_TRIGGERS.filter((trigger) => !labels[trigger])).toEqual([]);
    });
  }

  it('labels the development-target plan in Chinese', () => {
    expect(zhCN.talent.plans.trigger.developmentTarget).toBe('发展目标岗位');
    expect(enUS.talent.plans.trigger.developmentTarget).toBe(
      'Development target',
    );
  });
});
