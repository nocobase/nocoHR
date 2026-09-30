import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V4-12 测试数据 (演示案例 · V4 数据), development and demo only.
 *
 * - The performance assistant's five jobs and the learning coach's plan for
 *   low results are owned by hr01 (whenever hr01 exists; `NODE_ENV=production`
 *   or `HR_DEMO_SEED=false` skips everything).
 * - The rest is skipped with `HR_PERFORMANCE_DEMO=false`, written once
 *   (skipped when the demo scheme exists), and every part checks the rows it
 *   builds on, so it never fails when other demo seeds are off:
 *   - 生产操作工考核方案 (生产序列 S1: goals 30, competencies 40, quality and
 *     safety 30; self review, manager review, calibration) and 管理岗考核方案
 *     (车间主任, 厂长: goals 50, competencies 30, peers 20; self review, 3 peers,
 *     manager and skip-level review, calibration). Guide S ≤ 10 %, A ≤ 25 %,
 *     C + D ≥ 5 %; coefficients S 1.5, A 1.2, B 1.0, C 0.7, D 0.
 *   - “<year> 年度考核” (the seed's year), 苏州工厂, draft, autoAdvance off,
 *     owner hr01; goal setting closes in 3 days (for the goal drafts), the other
 *     stages a week apart. 陈静's peers are named in advance: trainer01, hr01,
 *     李敏 (nominated; 周宏 confirms).
 *   - 机加工车间's department goals.
 *   - Locked monthly attendance summaries from January to two months back for
 *     the 苏州 participants where none exists (王磊 one late arrival in March);
 *     the last month's summaries come with V2-06.
 *
 * Earlier steps' scenes are not pre-run: QI-2026-0457 arrives when the V3-11
 * walkthrough pushes it (with QI-2026-0301 seeded by V3-11, 钱进 then has the
 * two major issues), 王磊's targeted training is completed in that walkthrough
 * too, and no payroll row is written — the bonus base comes with a salary file
 * or an adjustment and the payroll cycle is created by payroll01 when the
 * perf.coefficient acceptance is run.
 *
 * People are not changed: 刘洋 keeps the hire date of the V3-09 demo (days
 * ago, so still excluded for tenure), 孙丽 stays on probation, 李敏 in
 * 机加工车间. Every amount is an example.
 */
const TZ = 'Asia/Shanghai';

function localToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
}
function shift(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(month: string, count: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

const RATINGS = [
  {
    code: 'S',
    score: 5,
    description: '卓越：显著超出目标与岗位要求，可作为标杆',
  },
  { code: 'A', score: 4, description: '优秀：全面达成并部分超出目标' },
  { code: 'B', score: 3, description: '良好：达成目标，满足岗位要求' },
  { code: 'C', score: 2, description: '待改进：部分目标未达成，需要改进计划' },
  { code: 'D', score: 1, description: '不合格：多数目标未达成或有严重问题' },
];
const GUIDE = { S: { max: 10 }, A: { max: 25 }, 'C+D': { min: 5 } };
const COEFFICIENTS = { S: 1.5, A: 1.2, B: 1.0, C: 0.7, D: 0 };
const QUALITY_RULES = {
  base: 5,
  min: 1,
  perIssue: { critical: -3, major: -1.5, minor: -0.5 },
  excludeCategories: ['设备故障'],
  learningOnTime: { enabled: true, below: 90, points: -1 },
  certificateExpired: { enabled: true, points: -1 },
  absentDays: { enabled: false, perDay: -0.5 },
};
const SCORING = {
  competencyBase: 3,
  competencyCap: 5,
  overrideReasonDelta: 1,
  ratingReasonGap: 2,
};
export const DEMO_OPERATOR_SCHEME = 'perf-scheme-operator';
export const DEMO_MANAGER_SCHEME = 'perf-scheme-manager';
export const DEMO_CYCLE = 'perf-cycle-annual';

const seed: SeedDefinition = defineSeed({
  name: '202610100102_demo_performance',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = localToday();
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const userIdOf = async (username: string): Promise<string | null> => {
      const row = await query
        .selectFrom('user')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst();
      return row ? String(row.id) : null;
    };
    const hr = await userIdOf('hr01');

    // ---- Owners of this step's AI work ----
    if (hr)
      for (const id of [
        'performanceAssistant.evidenceSummary',
        'performanceAssistant.goalDrafts',
        'performanceAssistant.reviewDrafts',
        'performanceAssistant.deviationCheck',
        'performanceAssistant.calibrationPack',
        'learningCoach.reviewResultPlans',
      ]) {
        if (await exists('aiAutomationSettings', id)) continue;
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id,
            enabled: true,
            ownerUserId: hr,
            hour: null,
            weekday: null,
            monthDay: null,
            params: null,
            updatedByUserId: hr,
            ...stamp,
          })
          .execute();
      }

    if (process.env.HR_PERFORMANCE_DEMO === 'false') return;
    if (!hr || (await exists('reviewSchemes', DEMO_OPERATOR_SCHEME))) return;
    for (const id of ['sz', 'sz-mc'])
      if (!(await exists('departments', id))) return;
    for (const id of ['emp-wanglei', 'emp-qianjin', 'emp-mgr-njl'])
      if (!(await exists('employees', id))) return;

    // ---- Schemes ----
    const scheme = (values: Record<string, unknown>) =>
      query
        .insertInto('reviewSchemes')
        .values({
          ratingScale: RATINGS,
          qualitySafetyRules: QUALITY_RULES,
          distributionGuide: GUIDE,
          ratingCoefficients: COEFFICIENTS,
          scoring: SCORING,
          active: true,
          customFields: null,
          updatedBy: hr,
          ...stamp,
          ...values,
        })
        .execute();
    await scheme({
      id: DEMO_OPERATOR_SCHEME,
      title: '生产操作工考核方案',
      appliesTo: { positionIds: [], jobFamilyIds: ['jf-prod'], grades: ['S1'] },
      sections: [
        { key: 'goals', weight: 30 },
        { key: 'competencies', weight: 40 },
        { key: 'qualitySafety', weight: 30 },
      ],
      stages: {
        goalSetting: true,
        selfReview: true,
        peerReview: { enabled: false, count: 3 },
        managerReview: true,
        skipLevelReview: false,
        calibration: true,
      },
    });
    await scheme({
      id: DEMO_MANAGER_SCHEME,
      title: '管理岗考核方案',
      appliesTo: {
        positionIds: ['pos-workshop-lead', 'pos-plant-director'],
        jobFamilyIds: [],
        grades: [],
      },
      sections: [
        { key: 'goals', weight: 50 },
        { key: 'competencies', weight: 30 },
        { key: 'peer', weight: 20 },
      ],
      stages: {
        goalSetting: true,
        selfReview: true,
        peerReview: { enabled: true, count: 3 },
        managerReview: true,
        skipLevelReview: true,
        calibration: true,
      },
    });

    // ---- The cycle and 陈静's peers ----
    const year = today.slice(0, 4);
    const peers: string[] = [];
    for (const username of ['trainer01', 'hr01', 'emp_njl_2']) {
      const id = await userIdOf(username);
      if (id) peers.push(id);
    }
    await query
      .insertInto('reviewCycles')
      .values({
        id: DEMO_CYCLE,
        title: `${year} 年度考核`,
        periodStart: `${year}-01-01`,
        periodEnd: `${year}-12-31`,
        scope: {
          departmentIds: ['sz'],
          minTenureDays: 90,
          excludeProbation: true,
          schemeOverrides: {},
          managerOverrides: {},
          peerPresets: peers.length >= 2 ? { 'emp-mgr-njl': peers } : {},
        },
        stageDeadlines: {
          goalSetting: shift(today, 3),
          selfReview: shift(today, 10),
          peerReview: shift(today, 17),
          managerReview: shift(today, 24),
          calibration: shift(today, 31),
        },
        autoAdvance: false,
        status: 'draft',
        ownerUserId: hr,
        exclusions: null,
        stageLog: [],
        calibrationPack: null,
        publishedAt: null,
        ...stamp,
      })
      .execute();

    // ---- 机加工车间's department goals ----
    for (const [id, title, measure] of [
      [
        'perf-goal-mc-quality',
        '全年无 critical 质量问题，major 质量问题不超过 2 起',
        '质量系统中机加工车间全年 critical 质量问题 0 起、major 质量问题不超过 2 起',
      ],
      [
        'perf-goal-mc-onboarding',
        '新人上岗周期缩短到 14 天以内',
        '新入职 CNC 操作工从入职到取得 CNC 岗位上岗证的平均天数不超过 14 天',
      ],
    ] as const)
      await query
        .insertInto('goals')
        .values({
          id,
          cycleId: DEMO_CYCLE,
          employeeId: null,
          departmentId: 'sz-mc',
          title,
          measure,
          weight: null,
          alignedGoalId: null,
          progress: 0,
          progressNotes: [],
          status: 'approved',
          source: 'manual',
          editedByEmployee: false,
          createdBy: hr,
          submittedAt: now,
          approvedBy: hr,
          approvedAt: now,
          returnNote: null,
          ...stamp,
        })
        .execute();

    // ---- Locked monthly attendance from January to two months back ----
    const participants = [
      'emp-mgr-njl',
      'emp-wanglei',
      'emp-limin',
      'emp-qianjin',
    ];
    const lastLocked = addMonths(today.slice(0, 7), -2);
    for (
      let month = `${year}-01`;
      month <= lastLocked;
      month = addMonths(month, 1)
    )
      for (const employeeId of participants) {
        if (!(await exists('employees', employeeId))) continue;
        const present = await query
          .selectFrom('attendanceMonthlySummaries')
          .select('id')
          .where('employeeId', '=', employeeId)
          .where('month', '=', month)
          .executeTakeFirst();
        if (present) continue;
        await query
          .insertInto('attendanceMonthlySummaries')
          .values({
            id: `perf-demo-${employeeId}-${month}`,
            employeeId,
            month,
            scheduledDays: 21,
            workedDays: 21,
            lateCount:
              employeeId === 'emp-wanglei' && month === `${year}-03` ? 1 : 0,
            earlyCount: 0,
            missingCount: 0,
            absentDays: 0,
            leaveByType: {},
            overtimeByType: {},
            nightShiftCount: 0,
            shiftCounts: {},
            status: 'locked',
            objection: null,
            confirmedAt: now,
            lockedBy: hr,
            lockedAt: now,
            lockLog: null,
            ...stamp,
          })
          .execute();
      }
  },
});
export default seed;
