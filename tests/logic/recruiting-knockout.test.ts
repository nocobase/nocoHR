// @vitest-environment node

// 门槛问题判定: a yes/no expectation matches whatever wording either side used (是 / 能 / 可以 / yes), and an
// editor's 是 is stored as the contract's 'yes'.
import { describe, expect, it } from 'vitest';

import { judgeAnswer } from '../../server/providers/hr/recruiting/candidates.ts';
import { yesNoValue } from '../../server/providers/hr/recruiting/common.ts';
import { knockoutSchema } from '../../server/providers/hr/recruiting/postings.ts';

const question = (expected: string | null) => ({
  key: 'q1',
  question: '能否接受三班倒？',
  answerType: 'yesNo' as const,
  requirementKey: 'r1',
  expected,
});

describe('knockout answers', () => {
  it('matches yes/no in any wording', () => {
    for (const expected of ['yes', '是', '能', '可以'])
      for (const answer of ['yes', '是', '能', '可以', 'Yes'])
        expect(judgeAnswer(question(expected), answer)).toBe(true);
    expect(judgeAnswer(question('是'), 'no')).toBe(false);
    expect(judgeAnswer(question('yes'), '不能')).toBe(false);
    expect(judgeAnswer(question('no'), '否')).toBe(true);
  });

  it('leaves an unreadable expectation unjudged', () => {
    expect(judgeAnswer(question('看情况'), 'yes')).toBeNull();
    expect(yesNoValue('看情况')).toBeNull();
  });

  it('stores an edited 是 as yes', () => {
    expect(knockoutSchema.parse(question('是')).expected).toBe('yes');
    expect(
      knockoutSchema.parse({
        ...question('A 班'),
        answerType: 'choice',
        options: ['A 班', 'B 班'],
      }).expected,
    ).toBe('A 班');
  });
});
