// @vitest-environment node

// The talent analyst's successor notes reached people as “差距：gaps 为空，未记录…” and “学习计划（draft）”, and
// a position without requirements read “已达到岗位要求”. What the model is given, the rule-based notes, and the
// check that sends a leaking note back once and then falls back.
import { describe, expect, it } from 'vitest';

import {
  guardedAnswer,
  guardedWording,
  mentionsInternals,
} from '../../server/providers/hr/ai-text-guard.ts';
import { successorFacts } from '../../server/providers/hr/talent-review/analyst.ts';
import {
  developmentRecordLabel,
  NO_REQUIREMENTS_NOTE,
  successorNote,
  type SuccessorMatch,
} from '../../server/providers/hr/talent-review/succession.ts';

const match = (overrides: Partial<SuccessorMatch>): SuccessorMatch => ({
  employeeId: 'emp-gao',
  name: '高原',
  departmentTitle: '销售部',
  positionTitle: '销售工程师',
  totalGap: 0,
  mandatoryGaps: 0,
  gaps: [],
  latestRating: 'A',
  box: null,
  developmentRecords: [
    developmentRecordLabel('draft'),
    developmentRecordLabel('approved'),
  ],
  requirementsSet: true,
  ...overrides,
});

describe('mentionsInternals', () => {
  it('finds field names, status codes and empty values', () => {
    for (const text of [
      '差距：gaps 为空，未记录。',
      '已有发展记录：学习计划（draft）',
      '学习计划（状态 approved/已批准）',
      'latestRating 为 A',
      'development_records 为空',
      '考核等级 null',
    ])
      expect(mentionsInternals(text)).toBe(true);
  });

  it('keeps ordinary sentences, including English product words', () => {
    for (const text of [
      '与岗位要求的差距：客户关系管理（1/2）；已有发展记录：学习计划（待确认）',
      NO_REQUIREMENTS_NOTE,
      '熟悉 PLC 与 Excel，最近考核等级 A。',
    ])
      expect(mentionsInternals(text)).toBe(false);
  });
});

describe('successor notes and facts', () => {
  it('a position without requirements is never “met”', () => {
    const note = successorNote(match({ requirementsSet: false }));
    expect(note).toContain(NO_REQUIREMENTS_NOTE);
    expect(note).not.toContain('已达到');
    expect(note).toContain('学习计划（待确认）');
    expect(mentionsInternals(note)).toBe(false);
    const facts = successorFacts(match({ requirementsSet: false }));
    expect(facts).toContain(NO_REQUIREMENTS_NOTE);
    expect(facts).not.toContain('已达到');
  });

  it('gaps and records in the words people read', () => {
    const m = match({
      gaps: [
        { competencyId: 'c1', title: '客户关系管理', required: 2, current: 1 },
      ],
      totalGap: 1,
    });
    expect(successorNote(m)).toBe(
      '与岗位要求的差距：客户关系管理（1/2）；已有发展记录：学习计划（待确认）、学习计划（已确认）',
    );
    const facts = successorFacts(m);
    expect(facts).toContain('客户关系管理（当前 1 级，要求 2 级）');
    expect(facts).toContain('学习计划（已确认）');
    // The employee number is the only code, and it is the id the answer is keyed on.
    expect(mentionsInternals(facts.replace('emp-gao', ''))).toBe(false);
    expect(successorNote(match({}))).toContain('已达到岗位当前要求');
    expect(successorNote(match({ developmentRecords: [] }))).toBe(
      '已达到岗位当前要求',
    );
  });
});

describe('guarded answers', () => {
  const unavailable = () => false;

  it('asks once more when a note leaks a code, then keeps the readable one', async () => {
    const replies = [
      '差距：gaps 为空',
      '与岗位要求的差距：客户关系管理（1/2）',
    ];
    let fellBack = false;
    const text = await guardedWording(
      async () => replies.shift()!,
      () => 'fallback',
      {
        unavailable,
        onFallback: () => (fellBack = true),
        accept: (value) => !mentionsInternals(value),
      },
    );
    expect(text).toBe('与岗位要求的差距：客户关系管理（1/2）');
    expect(fellBack).toBe(false);
  });

  it('falls back after two leaking answers', async () => {
    let calls = 0;
    let fellBack = false;
    const answer = await guardedAnswer(
      async () => {
        calls++;
        return {
          notes: [{ employeeId: 'emp-gao', note: '学习计划（draft）' }],
        };
      },
      () => null,
      {
        accept: (value) =>
          !value || value.notes.every((n) => !mentionsInternals(n.note)),
        unavailable,
        onFallback: () => (fellBack = true),
      },
    );
    expect(answer).toBeNull();
    expect(calls).toBe(2);
    expect(fellBack).toBe(true);
  });

  it('without `accept`, guardedWording still keeps any real text', async () => {
    expect(
      await guardedWording(
        async () => 'gaps 两项',
        () => 'fallback',
        {
          unavailable,
          onFallback: () => undefined,
        },
      ),
    ).toBe('gaps 两项');
  });
});
