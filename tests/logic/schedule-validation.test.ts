import { describe, expect, it } from 'vitest';
import { attendanceRuleSchema } from '../../server/providers/hr/attendance-catalog';
import {
  validateScheduleCells,
  type ScheduleCell,
} from '../../server/providers/hr/schedule-validation';
import { addDays } from '../../server/providers/hr/shared';

const departments = [
  { id: 'company', parentId: null, active: true },
  { id: 'factory', parentId: 'company', active: true },
  { id: 'workshop', parentId: 'factory', active: true },
  { id: 'other', parentId: 'company', active: true },
];
const employee = {
  id: 'employee',
  departmentId: 'workshop',
  status: 'active',
  hireDate: '2026-01-01',
  leaveDate: null,
};
const day = {
  id: 'day',
  startTime: '09:00',
  endTime: '17:00',
  isNight: false,
  active: true,
  departmentIds: null,
};
const night = {
  ...day,
  id: 'night',
  startTime: '22:00',
  endTime: '06:00',
  isNight: true,
};
const rule = {
  id: 'rule',
  ...attendanceRuleSchema.parse({
    title: 'Factory',
    departmentIds: ['factory'],
    workHourSystem: 'standard',
    punchSource: 'device',
  }),
};
type Input = Parameters<typeof validateScheduleCells>[0];
const cell = (
  date = '2027-04-02',
  shiftId: string | null = 'day',
): ScheduleCell => ({ employeeId: employee.id, date, shiftId });
function validate(overrides: Partial<Input> = {}) {
  return validateScheduleCells({
    cells: [cell()],
    existing: [],
    employees: [employee],
    shifts: [day, night],
    departments,
    rules: [rule],
    leaves: [],
    lockedMonths: [],
    timeZone: 'Asia/Shanghai',
    ...overrides,
  });
}
const messages = (result: ReturnType<typeof validate>) =>
  Object.values(result.checks)
    .flat()
    .map((check) => check.message);

describe('V2-05 documented scheduling validation', () => {
  it('accepts an eligible day shift and does not mutate the input', () => {
    const cells = [cell()];
    const snapshot = structuredClone(cells);
    expect(validate({ cells })).toEqual({
      checks: {},
      hasBlock: false,
      hasWarn: false,
    });
    expect(cells).toEqual(snapshot);
  });
  it.each([null, [], ['factory'], ['company'], ['workshop']])(
    'accepts all-department and ancestor applicability: %j',
    (departmentIds) => {
      expect(validate({ shifts: [{ ...day, departmentIds }] }).hasBlock).toBe(
        false,
      );
    },
  );
  it('blocks an unrelated department and never treats star as a wildcard department', () => {
    for (const departmentIds of [['other'], ['*']])
      expect(
        messages(validate({ shifts: [{ ...day, departmentIds }] })),
      ).toContain('SHIFT_NOT_APPLICABLE');
  });
  it.each([
    { status: 'leave' },
    { hireDate: '2027-04-03' },
    { leaveDate: '2027-04-01' },
  ])('blocks employment violations %j', (patch) => {
    expect(
      messages(validate({ employees: [{ ...employee, ...patch }] })),
    ).toContain('EMPLOYEE_NOT_ACTIVE');
  });
  it('allows dates exactly on hire and leave dates', () => {
    expect(
      validate({
        employees: [
          { ...employee, hireDate: '2027-04-02', leaveDate: '2027-04-02' },
        ],
      }).hasBlock,
    ).toBe(false);
  });
  it('does not reveal a missing employee or accept a missing/inactive shift', () => {
    expect(messages(validate({ employees: [] }))).toEqual([
      'EMPLOYEE_NOT_FOUND',
    ]);
    expect(messages(validate({ shifts: [] }))).toContain('SHIFT_NOT_FOUND');
    expect(
      messages(validate({ shifts: [{ ...day, active: false }] })),
    ).toContain('SHIFT_NOT_FOUND');
  });
  it.each(['pending', 'approved'])(
    'blocks %s leave that intersects the actual shift interval',
    (status) => {
      expect(
        messages(
          validate({
            leaves: [
              {
                employeeId: employee.id,
                status,
                startAt: '2027-04-02T02:00:00Z',
                endAt: '2027-04-02T03:00:00Z',
              },
            ],
          }),
        ),
      ).toContain('LEAVE_CONFLICT');
    },
  );
  it.each(['draft', 'rejected', 'cancelled'])('ignores %s leave', (status) => {
    expect(
      validate({
        leaves: [
          {
            employeeId: employee.id,
            status,
            startAt: '2027-04-02T02:00:00Z',
            endAt: '2027-04-02T03:00:00Z',
          },
        ],
      }).hasBlock,
    ).toBe(false);
  });
  it('checks night shifts against the following day and uses exclusive boundaries', () => {
    const leaves = [
      {
        employeeId: employee.id,
        status: 'approved',
        startAt: '2027-04-02T21:00:00Z',
        endAt: '2027-04-02T23:00:00Z',
      },
    ];
    expect(
      messages(validate({ cells: [cell('2027-04-02', 'night')], leaves })),
    ).toContain('LEAVE_CONFLICT');
    expect(
      validate({
        cells: [cell('2027-04-02', 'night')],
        leaves: [{ ...leaves[0], startAt: '2027-04-02T22:00:00Z' }],
      }).hasBlock,
    ).toBe(false);
    expect(
      validate({
        leaves: [
          {
            ...leaves[0],
            startAt: '2027-04-02T00:00:00Z',
            endAt: '2027-04-02T01:00:00Z',
          },
        ],
      }).hasBlock,
    ).toBe(false);
    expect(
      validate({ cells: [cell('2027-04-02', null)], leaves }).hasBlock,
    ).toBe(false);
  });
  it('checks saved shifts before and after a one-cell edit', () => {
    expect(
      messages(validate({ existing: [cell('2027-04-01', 'night')] })),
    ).toContain('INSUFFICIENT_REST');
    expect(
      messages(
        validate({
          cells: [cell('2027-04-02', 'night')],
          existing: [cell('2027-04-03')],
        }),
      ),
    ).toContain('INSUFFICIENT_REST');
  });
  it('honors the nearest configured rest interval and exact boundary', () => {
    const rules = [
      rule,
      { ...rule, id: 'child', departmentIds: ['workshop'], minRestHours: 3 },
    ];
    expect(
      validate({ existing: [cell('2027-04-01', 'night')], rules }).hasWarn,
    ).toBe(false);
    expect(
      validate({ existing: [cell('2027-04-01', 'night')], rules: [rule] })
        .hasWarn,
    ).toBe(true);
  });
  it('does not warn on a single night or nonconsecutive night dates', () => {
    expect(validate({ cells: [cell('2027-04-02', 'night')] }).hasWarn).toBe(
      false,
    );
    expect(
      validate({
        cells: [cell('2027-04-02', 'night'), cell('2027-04-04', 'night')],
      }).hasWarn,
    ).toBe(false);
  });
  it('warns for six consecutive nights, including history outside the edited range', () => {
    const nights = Array.from({ length: 6 }, (_, i) =>
      cell(addDays('2027-03-29', i), 'night'),
    );
    const batch = validate({ cells: nights });
    expect(batch.hasBlock).toBe(false);
    expect(batch.hasWarn).toBe(true);
    expect(Object.values(batch.checks)).toHaveLength(6);
    expect(
      messages(validate({ cells: [nights[5]], existing: nights.slice(0, 5) })),
    ).toContain('CONSECUTIVE_NIGHTS');
    expect(
      messages(validate({ cells: [nights[0]], existing: nights.slice(1) })),
    ).toContain('CONSECUTIVE_NIGHTS');
    expect(validate({ cells: nights.slice(0, 5) }).hasWarn).toBe(false);
  });
  it('merges the whole batch before evaluating and ignores request ordering', () => {
    const nights = Array.from({ length: 6 }, (_, i) =>
      cell(addDays('2027-03-29', i), 'night'),
    );
    const edits = [nights[5], cell(nights[2].date, null)];
    expect(
      validate({ cells: edits, existing: nights.slice(0, 5) }).hasWarn,
    ).toBe(false);
    expect(
      validate({ cells: [...edits].reverse(), existing: nights.slice(0, 5) })
        .hasWarn,
    ).toBe(false);
  });
  it('does not silently interpret duplicate cells by last-write-wins', () => {
    expect(() =>
      validate({ cells: [cell(), cell('2027-04-02', null)] }),
    ).toThrow('DUPLICATE_SCHEDULE_CELL');
  });
  it('blocks changes in a locked month, including changing to rest', () => {
    for (const shiftId of ['day', null])
      expect(
        messages(
          validate({
            cells: [cell('2027-04-02', shiftId)],
            lockedMonths: [{ employeeId: employee.id, month: '2027-04' }],
          }),
        ),
      ).toContain('MONTH_LOCKED');
  });
  it('fails closed for absent/ambiguous rules and invalid department ancestry', () => {
    expect(messages(validate({ rules: [] }))).toContain(
      'ATTENDANCE_RULE_NOT_CONFIGURED',
    );
    expect(
      messages(validate({ rules: [rule, { ...rule, id: 'duplicate' }] })),
    ).toContain('ATTENDANCE_RULE_CONFLICT');
    expect(
      messages(
        validate({
          departments: [{ id: 'workshop', parentId: 'workshop', active: true }],
        }),
      ),
    ).toContain('INVALID_DEPARTMENT_TREE');
  });
  it('fails closed for missing saved-shift context instead of ignoring a boundary', () => {
    expect(
      validate({ existing: [cell('2027-04-01', 'missing')] }).hasBlock,
    ).toBe(true);
  });
  it('does not invent offsets for DST gaps or ambiguous local times', () => {
    const shift = { ...day, startTime: '02:30', endTime: '10:00' };
    expect(
      validate({
        cells: [cell('2027-03-14')],
        shifts: [shift],
        timeZone: 'America/New_York',
      }).hasBlock,
    ).toBe(true);
    expect(
      validate({
        cells: [cell('2027-11-07')],
        shifts: [{ ...shift, startTime: '01:30' }],
        timeZone: 'America/New_York',
      }).hasBlock,
    ).toBe(true);
  });
});
