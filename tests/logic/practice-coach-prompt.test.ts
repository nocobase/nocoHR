/**
 * 陪练: every coach turn is a fresh conversation, so its prompt carries the
 * setting, the source document and the whole dialogue so far.
 */
import { describe, expect, it } from 'vitest';

import { coachPrompt } from '../../server/providers/hr/practice-service.ts';

const scenario = {
  persona: '严格的班组长',
  situation: '机床停机后准备重新开机',
  rubric: JSON.stringify([
    { point: '停机超过 15 分钟须做首件检验', weight: 40 },
  ]),
  openingLine: '你这台机床停了多久？',
  maxTurns: 6,
};

describe('coach prompt', () => {
  it('opens with the opening line on the first turn', () => {
    const prompt = coachPrompt(scenario, [], '停了 20 分钟', 1, '依据原文');
    expect(prompt).toContain('你已经说出的开场白：你这台机床停了多久？');
    expect(prompt).toContain('员工的回答（第 1/6 轮）：停了 20 分钟');
    expect(prompt).toContain('依据原文');
    expect(prompt).toContain('停机超过 15 分钟须做首件检验');
  });

  it('carries the earlier turns from the second turn on', () => {
    const prompt = coachPrompt(
      scenario,
      [
        { role: 'coach', text: '你这台机床停了多久？', at: '' },
        { role: 'employee', text: '停了 20 分钟', at: '' },
        { role: 'coach', text: '那开机前要做什么？', at: '' },
      ],
      '先做首件检验',
      2,
      '依据原文',
    );
    expect(prompt).toContain(
      '到目前为止的对话：\n你：你这台机床停了多久？\n员工：停了 20 分钟\n你：那开机前要做什么？',
    );
    expect(prompt).toContain('员工的回答（第 2/6 轮）：先做首件检验');
    expect(prompt).not.toContain('你已经说出的开场白');
  });
});
