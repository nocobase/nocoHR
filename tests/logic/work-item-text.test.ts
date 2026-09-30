// @vitest-environment node

// 工作台 · AI 员工备好的材料: a short summary on the card, the full text behind it when longer.
import { describe, expect, it } from 'vitest';

import { workItemText } from '../../server/providers/hr/work-item-store.ts';

describe('work item text', () => {
  it('keeps a short text as the summary only', () => {
    expect(workItemText('孙丽的试用期将于 10-10 结束。')).toEqual({
      summary: '孙丽的试用期将于 10-10 结束。',
      detail: null,
    });
  });

  it('shortens a long text to its first lines and keeps the full text', () => {
    const body = `**转正准备**\n${'孙丽在试用期内表现稳定，学习任务已完成一项。'.repeat(10)}`;
    const { summary, detail } = workItemText(body);
    expect(summary?.length).toBeLessThanOrEqual(160);
    expect(summary).not.toContain('**');
    expect(summary?.endsWith('…')).toBe(true);
    expect(detail).toBe(body);
  });

  it('has nothing for an empty text', () => {
    expect(workItemText('  ')).toEqual({ summary: null, detail: null });
  });
});
