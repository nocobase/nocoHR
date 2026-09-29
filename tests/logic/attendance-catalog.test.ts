import { describe, expect, it } from 'vitest';
import {
  attendanceRuleSchema,
  shiftSchema,
  resolveAttendanceRule,
} from '../../server/providers/hr/attendance-catalog';

const shift = {
  code: 'mc-night',
  title: 'Night',
  startTime: '22:00',
  endTime: '06:00',
  isNight: true,
};
const tree = [
  { id: 'root', parentId: null, active: true },
  { id: 'factory', parentId: 'root', active: true },
  { id: 'workshop', parentId: 'factory', active: true },
];
const rule = (id: string, departmentIds: string[]) => ({
  id,
  ...attendanceRuleSchema.parse({
    title: id,
    departmentIds,
    workHourSystem: 'standard',
    punchSource: 'device',
  }),
});

describe('attendance catalog rules', () => {
  it('supports overnight shifts with the documented defaults', () => {
    expect(shiftSchema.parse(shift)).toMatchObject({
      breakMinutes: 30,
      departmentIds: null,
      active: true,
    });
    expect(
      attendanceRuleSchema.parse({
        title: 'Factory',
        departmentIds: ['factory'],
        workHourSystem: 'comprehensive',
        punchSource: 'device',
      }),
    ).toMatchObject({
      lateGraceMinutes: 5,
      overtimeRequiresApproval: true,
      monthlyOvertimeAlertHours: 36,
      minRestHours: 11,
      maxConsecutiveNights: 5,
    });
  });
  it.each([
    { endTime: '22:00' },
    { startTime: '24:00' },
    { endTime: '06:60' },
    { breakMinutes: 480 },
    { breakMinutes: -1 },
    { departmentIds: ['root', 'root'] },
    { status: 'approved' },
  ])('rejects invalid shift input %j', (value) => {
    expect(shiftSchema.safeParse({ ...shift, ...value }).success).toBe(false);
  });
  it('selects the nearest active department rule independently of row order', () => {
    const rules = [
      rule('global', ['root']),
      rule('factory', ['factory']),
      { ...rule('disabled', ['workshop']), active: false },
    ];
    expect(resolveAttendanceRule('workshop', tree, rules).id).toBe('factory');
    expect(
      resolveAttendanceRule('workshop', tree, [...rules].reverse()).id,
    ).toBe('factory');
  });
  it('fails closed on missing, ambiguous, cyclic and inactive departments', () => {
    expect(() => resolveAttendanceRule('workshop', tree, [])).toThrow(
      'ATTENDANCE_RULE_NOT_CONFIGURED',
    );
    expect(() =>
      resolveAttendanceRule('workshop', tree, [
        rule('a', ['factory']),
        rule('b', ['factory']),
      ]),
    ).toThrow('ATTENDANCE_RULE_CONFLICT');
    expect(() =>
      resolveAttendanceRule('missing', tree, [rule('a', ['root'])]),
    ).toThrow('INVALID_DEPARTMENT');
    expect(() =>
      resolveAttendanceRule(
        'workshop',
        [...tree.slice(0, 2), { ...tree[2], active: false }],
        [],
      ),
    ).toThrow('INVALID_DEPARTMENT');
    expect(() =>
      resolveAttendanceRule(
        'root',
        [{ id: 'root', parentId: 'root', active: true }],
        [rule('a', ['root'])],
      ),
    ).toThrow('INVALID_DEPARTMENT_TREE');
  });
});
