import { describe, expect, it } from 'vitest';

import {
  complianceFallback,
  findIssues,
} from '../../server/providers/hr/compliance.ts';

// 用工合规检查 rules (V1-02): which employees they apply to, and the wording shown before the assistant writes a note.
const settings = {
  enabled: true,
  checks: {
    secondFixedTerm: true,
    probationLimit: true,
    noContract: true,
    expiredContract: true,
  },
  noContractDays: 30,
  probationLimits: {
    underThreeMonths: 0,
    underOneYear: 1,
    underThreeYears: 2,
    threeYearsOrOpen: 6,
  },
};

const hiredLongAgo = {
  id: 'e1',
  name: '郭凡',
  status: 'active',
  hireDate: '2026-08-01',
  probationEndDate: null,
};

describe('用工合规规则', () => {
  it('flags a full-time employee without a written contract', () => {
    expect(
      findIssues(
        { ...hiredLongAgo, employmentType: 'fullTime' },
        [],
        settings,
        30,
        '2026-09-29',
      ).map((f) => f.kind),
    ).toEqual(['noContract']);
  });

  it('leaves out 派遣、外包、实习 and 兼职, who sign no labour contract with the company', () => {
    for (const employmentType of [
      'dispatched',
      'outsourced',
      'intern',
      'partTime',
    ])
      expect(
        findIssues(
          { ...hiredLongAgo, employmentType },
          [],
          settings,
          30,
          '2026-09-29',
        ),
      ).toEqual([]);
  });

  it('words a prompt from the rule when the assistant has not written one', () => {
    const text = complianceFallback({
      id: 'i1',
      employeeId: 'e1',
      employeeName: '郭凡',
      kind: 'noContract',
      status: 'open',
      detail: { days: 59, hireDate: '2026-08-01' },
      aiNote: null,
      note: '',
      detectedAt: '2026-09-29T00:00:00.000Z',
      closedAt: null,
    });
    expect(text).toContain('郭凡');
    expect(text).toContain('第八十二条');
    expect(text.endsWith('提示，不是法律意见，请 HR 核对。')).toBe(true);
  });
});
