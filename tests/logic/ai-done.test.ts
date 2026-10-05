// @vitest-environment node

// 工作台 · AI 员工已办完: summary lines that carry internal ids are dropped, links point at the record or the
// task's page, and the endpoint lists only the runs of the tasks the caller is responsible for.
import { describe, expect, it } from 'vitest';

import {
  aiDoneLink,
  aiDoneText,
} from '../../server/providers/hr/ai-done-service.ts';

describe('AI done summary lines and links', () => {
  it('keeps sentences and drops lines that are, or carry, an internal id', () => {
    expect(aiDoneText('为 2 份即将到期的合同准备了续签材料')).toBe(
      '为 2 份即将到期的合同准备了续签材料',
    );
    expect(
      aiDoneText('application fcfd8db3-7398-487a-a5a8-32abad2fd0e7'),
    ).toBeNull();
    expect(
      aiDoneText('继任候选推荐：计划 1b28ee8f-2587-4050-bb28-17285ce1990b'),
    ).toBeNull();
    expect(aiDoneText('建议 fa7f4ac3c2ca8dceb37ce6c')).toBeNull();
    expect(aiDoneText('  ')).toBeNull();
  });

  it('links the record a run acted on, else the page of its task', () => {
    expect(
      aiDoneLink('recruitingAssistant.screening', { applicationId: 'a1' }),
    ).toBe('/talent/candidates/a1');
    expect(aiDoneLink('vendorReconciler.billReview', { billId: 'b1' })).toBe(
      '/talent/payroll/vendor-bills/b1',
    );
    expect(
      aiDoneLink('talentAnalyst.successorRecommend', { planId: 'p1' }),
    ).toBe('/talent/succession/p1');
    expect(
      aiDoneLink('hrAssistant.replacementSuggest', { scheduleId: 's1' }),
    ).toBe('/talent/schedules');
    expect(aiDoneLink('performanceAssistant.calibrationPack', {})).toBe(
      '/talent/calibration',
    );
    expect(aiDoneLink('learningCoach.gapPlans', { planId: 'x' })).toBe(
      '/talent/learning-plans',
    );
    expect(aiDoneLink('unknown.task', {})).toBeNull();
  });
});
