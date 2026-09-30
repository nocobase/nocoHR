import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

/**
 * V3-11 新人留存, development and demo only (`NODE_ENV=production`,
 * `HR_DEMO_SEED=false` or `HR_PROFILE_DEMO=false` skips it).
 *
 * 40 CNC operators joined 成都机加工车间 between about 100 and 180 days ago,
 * without accounts: 20 on the night shift, 20 on the early shift (their first
 * three published shifts). Within 30 days 7 night-shift and 3 day-shift hires
 * left (35 % and 15 %); the other 30 left later, all before the previous
 * month began. So nobody of this cohort is on duty — V2-07's demo counts 18
 * operators on duty there — and no leaver falls into a current payroll or
 * attendance month. Their day-7 回访 name 班车 four times.
 *
 * The rows are realigned to this layout on every run, so a database seeded by
 * the earlier version of 202610080102 (which left 30 of them on duty) is
 * corrected; nothing outside the `emp-cd-new-*` rows is touched.
 */
const COUNT = 40;
const SURNAMES =
  '陈杨黄周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏';
const GIVEN = '晨阳宇浩然涛斌磊鹏飞';
/** Day-7 回访 of four early leavers mention 班车, two 住宿, one 带教. */
const CHECK_INS: Record<number, { topic: string; text: string }[]> = {
  0: [{ topic: 'shuttle', text: '夜班下班后等班车要四十分钟。' }],
  2: [{ topic: 'shuttle', text: '班车太早，赶不上。' }],
  4: [
    { topic: 'shuttle', text: '住得远，下夜班没有班车。' },
    { topic: 'housing', text: '宿舍离厂区远。' },
  ],
  6: [{ topic: 'housing', text: '宿舍四人间太挤。' }],
  1: [{ topic: 'shuttle', text: '白班班车满员。' }],
  3: [{ topic: 'mentoring', text: '带教师傅经常不在。' }],
};

const seed: SeedDefinition = defineSeed({
  name: '202610080103_hr_demo_profile_retention',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_PROFILE_DEMO === 'false'
    )
      return;
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    if (
      !(await exists('departments', 'cd-mc')) ||
      !(await exists('positions', 'pos-cnc-operator'))
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = now.toISOString().slice(0, 10);
    const addDays = (date: string, days: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const night = (await exists('shifts', 'shift-mc-night'))
      ? 'shift-mc-night'
      : null;
    const day = (await exists('shifts', 'shift-mc-early'))
      ? 'shift-mc-early'
      : null;
    const ids = Array.from(
      { length: COUNT },
      (_, i) => `emp-cd-new-${String(i + 1).padStart(2, '0')}`,
    );
    // Rebuilt below: the cohort's own events, schedules and check-ins.
    await query
      .deleteFrom('jobEvents')
      .where('employeeId', 'in', ids)
      .execute();
    await query
      .deleteFrom('shiftSchedules')
      .where('employeeId', 'in', ids)
      .execute();
    await query
      .deleteFrom('newHireCheckIns')
      .where('employeeId', 'in', ids)
      .execute();
    for (let i = 0; i < COUNT; i += 1) {
      const id = ids[i];
      const n = String(i + 1).padStart(2, '0');
      const nightShift = i % 2 === 0;
      const index = Math.floor(i / 2);
      const early = nightShift ? index < 7 : index < 3;
      const hired = addDays(today, -(100 + 2 * i));
      // Early leavers within 30 days; the rest between day 31 and 35, at least 65 days ago.
      const left = early
        ? addDays(hired, 12 + (i % 10))
        : addDays(hired, 31 + (i % 5));
      const values = {
        employeeNo: `QH39${n}`,
        name: `${SURNAMES[i]}${GIVEN[i % GIVEN.length]}`,
        userId: null,
        departmentId: 'cd-mc',
        positionId: 'pos-cnc-operator',
        managerEmployeeId: null,
        status: 'leave',
        hireDate: hired,
        positionSince: hired,
        email: null,
        mobile: `139000390${n}`,
        note: null,
        gender: i % 3 === 0 ? 'female' : 'male',
        birthDate: '2002-01-01',
        idType: 'idCard',
        idNumber: `9999992002010139${n}`,
        employmentType: 'fullTime',
        workLocation: '成都工厂',
        probationEndDate: addDays(hired, 180),
        regularizedAt: null,
        leaveDate: left,
        leaveReason: '个人原因',
      };
      if (await exists('employees', id))
        await query
          .updateTable('employees')
          .set({ ...values, updatedAt: now })
          .where('id', '=', id)
          .execute();
      else
        await query
          .insertInto('employees')
          .values({ id, ...values, address: null, ...stamp })
          .execute();
      for (const [eventType, date] of [
        ['onboard', hired],
        ['offboard', left],
      ] as const)
        await query
          .insertInto('jobEvents')
          .values({
            id: randomUUID(),
            employeeId: id,
            eventType,
            fromDepartmentId: eventType === 'offboard' ? 'cd-mc' : null,
            toDepartmentId: eventType === 'offboard' ? null : 'cd-mc',
            fromPositionId:
              eventType === 'offboard' ? 'pos-cnc-operator' : null,
            toPositionId: eventType === 'offboard' ? null : 'pos-cnc-operator',
            effectiveDate: date,
            source: 'import',
            actionId: null,
            note: null,
            // History, not news: nothing is left for the handler to do.
            processedAt: now,
            ...stamp,
          })
          .execute();
      const shiftId = nightShift ? night : day;
      if (shiftId)
        for (let d = 0; d < 3; d += 1)
          await query
            .insertInto('shiftSchedules')
            .values({
              id: `sched-${id}-${d}`,
              employeeId: id,
              date: addDays(hired, d),
              shiftId,
              publishedShiftId: shiftId,
              status: 'published',
              checkResult: null,
              replacementSuggestion: null,
              publishedBy: 'system',
              publishedAt: now,
              ...stamp,
            })
            .execute();
      const answers = CHECK_INS[i];
      if (answers) {
        const at = new Date(`${addDays(hired, 7)}T02:00:00Z`);
        await query
          .insertInto('newHireCheckIns')
          .values({
            id: `checkin-${id}-7`,
            employeeId: id,
            day: 7,
            channel: 'app',
            askedAt: at,
            repliedAt: at,
            answers,
            issues: answers.map((a) => ({ topic: a.topic, summary: a.text })),
            status: 'replied',
            ...stamp,
          })
          .execute();
      }
    }
  },
});
export default seed;
