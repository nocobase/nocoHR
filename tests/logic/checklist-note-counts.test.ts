/**
 * 变动影响清单说明: the HR assistant gets the list's own totals, and a note that
 * states another count falls back to the rule text.
 */
import { describe, expect, it } from 'vitest';

import {
  checklistCounts,
  miscounts,
} from '../../server/providers/hr/hr-assistant-changes.ts';

const items = [
  ...Array.from({ length: 5 }, () => ({ status: 'todo' })),
  { status: 'auto' },
  { status: 'auto' },
  { status: 'done' },
  { status: 'notNeeded' },
];

describe('change checklist note counts', () => {
  it('counts what HR still has to do and what the system finished', () => {
    expect(checklistCounts(items)).toEqual({
      total: 9,
      hrTodo: 5,
      systemDone: 4,
    });
  });

  it('flags a note whose count is not the list’s own', () => {
    const counts = checklistCounts(items);
    expect(miscounts('HR 需处理 6 项待办，系统自动完成 3 项。', counts)).toBe(
      true,
    );
    expect(
      miscounts('共 9 项：HR 需处理 5 项，系统已完成 4 项。', counts),
    ).toBe(false);
    expect(miscounts('最容易漏的是直属上级。', counts)).toBe(false);
  });
});
