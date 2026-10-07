import { describe, expect, it } from 'vitest';

import { guardedAnswer } from '../../server/providers/hr/ai-text-guard.ts';
import { readablePayrollNote } from '../../server/providers/hr/payroll/assistant.ts';

const CODED =
  '成都生产一线薪资结构 nightRate=40，与《夜班津贴管理办法》HR-POL-0002 的 50 元/班不一致。';
const READABLE =
  '“成都生产一线薪资结构”的夜班津贴单价为 40，与《夜班津贴管理办法》HR-POL-0002 的 50 元/班不一致；受影响的员工：赵阳。';

describe('payroll anomaly notes', () => {
  it('rejects a note that names a parameter code and accepts its title', () => {
    expect(readablePayrollNote(CODED)).toBe(false);
    expect(readablePayrollNote(READABLE, ['nightRate'])).toBe(true);
  });

  it("rejects the run's own codes, even a plain or dotted one", () => {
    expect(readablePayrollNote('结构的 rate 为 40。', ['rate'])).toBe(false);
    expect(
      readablePayrollNote('本月 perf.coefficient 按 0 计算。', [
        'perf.coefficient',
      ]),
    ).toBe(false);
    expect(readablePayrollNote('分隔 separate 不算。', ['rate'])).toBe(true);
  });

  it('asks the model again after a coded note and keeps the readable one', async () => {
    const replies = [CODED, READABLE];
    let fellBack = false;
    const note = await guardedAnswer(
      async () => replies.shift()!,
      () => 'rule',
      {
        accept: (text) => readablePayrollNote(text, ['nightRate']),
        unavailable: () => false,
        onFallback: () => (fellBack = true),
      },
    );
    expect(note).toBe(READABLE);
    expect(fellBack).toBe(false);
  });

  it('falls back to the rule-based notes after two coded notes', async () => {
    let fellBack = false;
    const note = await guardedAnswer(
      async () => CODED,
      () => 'rule',
      {
        accept: (text) => readablePayrollNote(text, ['nightRate']),
        unavailable: () => false,
        onFallback: () => (fellBack = true),
      },
    );
    expect(note).toBe('rule');
    expect(fellBack).toBe(true);
  });
});
