import { describe, expect, it } from 'vitest';

import {
  describesFormat,
  guardedWording,
} from '../../server/providers/hr/ai-text-guard.ts';

const REPORTED =
  '已按要求输出不超过150字的HR合规提示，含事实、法条依据《劳动合同法》第十九条及HR核对事项，并以指定句子结尾，未给法律结论。';
const TIP =
  '陈晨的试用期为 7 个月，超过劳动合同期限对应的法定上限。依据：《劳动合同法》第十九条。建议核对合同期限与试用期约定。提示，不是法律意见，请 HR 核对。';

describe('replies that describe the instructions', () => {
  it('recognizes a reply about the format, not the matter', () => {
    expect(describesFormat(REPORTED)).toBe(true);
    expect(describesFormat('我已经按你的要求写好了提示。')).toBe(true);
    expect(describesFormat('以下是按要求生成的说明：')).toBe(true);
    expect(describesFormat('内容符合上述要求，共 120 字。')).toBe(true);
    expect(describesFormat('   ')).toBe(true);
  });

  it('keeps real text, including words that only look alike', () => {
    expect(describesFormat(TIP)).toBe(false);
    expect(describesFormat('已完成 3 门必修课，考试成绩符合要求。')).toBe(
      false,
    );
    expect(
      describesFormat('以下是需要 HR 核对的事项：合同期限、试用期。'),
    ).toBe(false);
    expect(describesFormat('已生成 2 项学习任务，截止 10 月 31 日。')).toBe(
      false,
    );
  });
});

describe('guardedWording', () => {
  const unavailable = (error: unknown) =>
    error instanceof Error && error.message === 'unavailable';

  it('asks once more after a format report and keeps the second reply', async () => {
    const replies = [REPORTED, TIP];
    let fellBack = false;
    const text = await guardedWording(
      async () => replies.shift()!,
      () => 'fallback',
      { unavailable, onFallback: () => (fellBack = true) },
    );
    expect(text).toBe(TIP);
    expect(fellBack).toBe(false);
  });

  it('uses the rule-based text after two format reports', async () => {
    let calls = 0;
    let fellBack = false;
    const text = await guardedWording(
      async () => {
        calls++;
        return REPORTED;
      },
      () => 'fallback',
      { unavailable, onFallback: () => (fellBack = true) },
    );
    expect(calls).toBe(2);
    expect(text).toBe('fallback');
    expect(fellBack).toBe(true);
  });

  it('falls back when no model is available and rethrows other failures', async () => {
    await expect(
      guardedWording(
        async () => {
          throw new Error('unavailable');
        },
        () => 'fallback',
        { unavailable, onFallback: () => undefined },
      ),
    ).resolves.toBe('fallback');
    await expect(
      guardedWording(
        async () => {
          throw new Error('boom');
        },
        () => 'fallback',
        { unavailable, onFallback: () => undefined },
      ),
    ).rejects.toThrow('boom');
  });
});
