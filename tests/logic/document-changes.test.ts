// @vitest-environment node

// Unit checks for the deterministic document-version helpers of V2 step 6: the section comparison, which content a change
// touches, replaced quantities, numeric conflicts between documents, and working-day due dates.
import { describe, expect, it } from 'vitest';

import {
  addWorkingDays,
  diffSections,
  numericConflicts,
  replaceQuantity,
  replacedQuantities,
  touchesChange,
} from '../../server/providers/hr/document-changes.ts';

const V40 = `> 演示资料：文件编号 SOP-PR-0231，版本 V4.0。

# 5.3 灌装中断
灌装中断超过 15 分钟，须通知 QA 现场评估后才能继续。中断期间不得打开灌装区的隔离装置，操作员不得离开灌装间。

# 5.4 中断记录
中断原因与处理结果由班组长口头确认。

# 6.1 设备点检
每班开工前点检。`;
const V41 = V40.replace('V4.0', 'V4.1')
  .replace('超过 15 分钟', '超过 10 分钟')
  .replace(
    '中断原因与处理结果由班组长口头确认。',
    '中断原因、时长和处理结果须记入批生产记录附页。',
  );

describe('document changes', () => {
  it('lists changed sections only, ignoring the header and unchanged sections', () => {
    const changes = diffSections(V40, V41);
    expect(changes.map((c) => [c.sectionTitle, c.changeType])).toEqual([
      ['5.3 灌装中断', 'modified'],
      ['5.4 中断记录', 'modified'],
    ]);
    expect(diffSections(V40, `${V40}\n\n# 7 附录\n新增内容。`)).toEqual([
      expect.objectContaining({ sectionTitle: '7 附录', changeType: 'added' }),
    ]);
    expect(
      diffSections(V40, V40.replace(/# 6\.1 设备点检\n每班开工前点检。/u, '')),
    ).toEqual([
      expect.objectContaining({ sectionTitle: '6.1 设备点检', changeType: 'removed' }),
    ]);
    // Reformatting is not a change.
    expect(diffSections(V40, V40.replace('15 分钟', '**15 分钟**'))).toEqual([]);
  });

  it('finds content quoting the replaced text, and the numbers that changed', () => {
    const [interruption, record] = diffSections(V40, V41);
    const lesson =
      '灌装中断超过 **15 分钟**，须通知 QA 现场评估后才能继续。\n中断原因与处理结果由班组长口头确认。';
    expect(touchesChange(lesson, interruption)).toBe(true);
    expect(touchesChange(lesson, record)).toBe(true);
    expect(touchesChange('每班开工前点检。', interruption)).toBe(false);
    const [pair] = replacedQuantities(interruption);
    expect([pair.from.text, pair.to.text]).toEqual(['15 分钟', '10 分钟']);
    expect(replaceQuantity(lesson, pair.from, pair.to)).toContain('**10 分钟**');
  });

  it('flags the same statement with a different number in another document', () => {
    const [interruption] = diffSections(V40, V41);
    const conflicts = numericConflicts(
      interruption.after ?? '',
      '灌装中断超过 15 分钟须通知 QA，并记在交接班本上。',
    );
    expect(conflicts[0]?.quantity.text).toBe('10 分钟');
    expect(conflicts[0]?.otherQuantity.text).toBe('15 分钟');
    // Different subjects with different numbers are not a conflict.
    expect(
      numericConflicts(interruption.after ?? '', 'B 级区内每 30 分钟用 75% 乙醇消毒手套。'),
    ).toEqual([]);
  });

  it('counts due dates in working days', () => {
    // 2026-09-28 is a Monday.
    expect(addWorkingDays('2026-09-28', 5)).toBe('2026-10-05');
    expect(addWorkingDays('2026-10-02', 1)).toBe('2026-10-05');
    expect(addWorkingDays('2026-10-03', 0)).toBe('2026-10-03');
  });
});
