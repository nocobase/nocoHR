import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  DEMO_RESUMES,
  PUBLIC_APPLICANTS,
  resumeDocx,
  ZHOU_DI_RESUME,
} from '../../seed-data/demo-recruiting.js';
import { RECRUITING_SETTINGS_DEFAULTS } from '../../../server/providers/hr/recruiting/config.js';

/**
 * V2-07 测试数据 (演示案例 · V2 数据), development and demo only: skipped when
 * NODE_ENV=production, HR_DEMO_SEED=false or HR_RECRUITING_DEMO=false, and
 * when the V1 demo people are absent. Each part checks the rows it depends
 * on, so it never fails when another demo is switched off.
 *
 * - recruit01 苏晴 (人力资源部, 招聘专员, hr.recruiter); integration_mes, an
 *   account without a password (it cannot sign in) holding hr.integrationErp —
 *   its API key is made on 设置 / 招聘设置 and shown once, never here;
 * - accountless CNC operators in 成都机加工车间 up to 18 on duty (赵阳、吴敏、
 *   邓凯 included, the dispatched workers not); 成都机加工车间 keeps no head,
 *   so approvals and the hiring manager go up to 何伟 (mgr_cd);
 * - 招聘设置: the careers page on; 成都机加工车间 · CNC 操作工 100 件/人·班,
 *   22 班/月, 8 小时/班; 苏州机加工车间 may lend 4 (coordinated by 周宏);
 *   recruiting 14 days, onboarding 14 days;
 * - the automation owners: 林晓 for the HR assistant's work, 苏晴 for the
 *   recruiting assistant's;
 * - 成都生产一线薪资结构: the CNC 操作工 pay range when missing; nightRate is
 *   not touched (V2-06's walkthrough corrects 40 → 50);
 * - the draft requisition 成都机加工车间 · CNC 操作工 × 10 raised by 何伟, with
 *   the department's four conditions;
 * - last year's unhired candidate for the same position, consent still valid
 *   (the talent pool);
 * - 《宿舍管理规定》HR-POL-0010 in the knowledge base when absent (新员工回访);
 * - storage/demo-materials/recruiting: the 30 resumes and the two other
 *   careers-page applicants (not seeded: the acceptance submits them).
 */
const TZ = 'Asia/Shanghai';
const localToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const FILLER = [
  '付强', '唐亮', '邹勇', '熊斌', '罗杰', '毛刚', '史涛', '邱亮', '侯军', '贺鹏',
  '龙飞', '段波', '雷鸣', '汤宇', '黎晨', '易鑫', '常凯', '武东', '乔林', '贾浩',
];

const DORM_POLICY = `> 启衡精密科技，文件编号 HR-POL-0010。

# 1 宿舍分配
员工宿舍 4 人间，配空调和独立卫生间。入职时由人力资源部按班次分配，同一班次的员工安排同住；调换宿舍须在系统中申请，人力资源部在 3 个工作日内答复。

# 2 班车时刻
- 成都工厂：夜班下班（06:15）有返程班车；中班下班（22:15）有返程班车。
- 苏州工厂：去程 05:20、13:20、21:20；返程 06:15、14:15、22:15。
- 节假日班车另行通知；班车凭工牌乘坐。

# 3 报修
宿舍水电、空调、门锁故障在飞书“宿舍报修”应用中提交，后勤在 24 小时内上门处理。

# 4 宿舍纪律
宿舍内禁止使用大功率电器和明火；夜班员工白天休息，其他人员 09:00–16:00 保持安静。`;

const seed: SeedDefinition = defineSeed({
  name: '202610090102_demo_recruiting',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_RECRUITING_DEMO === 'false'
    )
      return;
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    if (!(await exists('employees', 'emp-wanglei'))) return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = localToday();
    const userOf = async (username: string) => {
      const row = await query
        .selectFrom('user')
        .select(['id'])
        .where('username', '=', username)
        .executeTakeFirst();
      return row ? String(row.id) : null;
    };
    const assign = async (permissionSetKey: string, userId: string) => {
      const set = await query
        .selectFrom('authorizationPermissionSets')
        .select(['id'])
        .where('key', '=', permissionSetKey)
        .executeTakeFirst();
      if (!set) return;
      const existing = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select(['id'])
        .where('permissionSetKey', '=', permissionSetKey)
        .where('subjectType', '=', 'user')
        .where('subjectId', '=', userId)
        .executeTakeFirst();
      if (existing) return;
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          permissionSetKey,
          subjectType: 'user',
          subjectId: userId,
          ...stamp,
        })
        .execute();
    };

    // ---- recruit01 苏晴 ----
    const recruit01 = await ensureDemoAccount(query, {
      username: 'recruit01',
      name: '苏晴',
      email: 'recruit01@demo.test',
    });
    if (!(await exists('employees', 'emp-recruit01')) && (await exists('positions', 'pos-office-recruiter'))) {
      await query
        .insertInto('employees')
        .values({
          id: 'emp-recruit01',
          employeeNo: 'QH1009',
          name: '苏晴',
          userId: recruit01,
          departmentId: 'hr',
          positionId: 'pos-office-recruiter',
          managerEmployeeId: null,
          status: 'active',
          hireDate: '2023-03-06',
          positionSince: '2023-03-06',
          email: 'recruit01@demo.test',
          mobile: '13900000043',
          note: null,
          gender: 'female',
          birthDate: '1995-03-06',
          idType: 'idCard',
          idNumber: '999999199503060043',
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市吴中区长桥街道龙西路 160 号 1 幢 1506 室',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('departmentMembers')
        .values({
          id: randomUUID(),
          departmentId: 'hr',
          userId: recruit01,
          primary: true,
          active: true,
          ...stamp,
        })
        .execute();
    }
    await assign('hr.recruiter', recruit01);

    // ---- integration_mes: no password, so it cannot sign in; its key is made in 招聘设置 ----
    let integration = await userOf('integration_mes');
    if (!integration) {
      integration = randomUUID();
      await query
        .insertInto('user')
        .values({
          id: integration,
          name: 'ERP 集成账号',
          username: 'integration_mes',
          email: 'integration_mes@demo.test',
          emailVerified: true,
          ...stamp,
        })
        .execute();
    }
    await assign('hr.integrationErp', integration);

    // ---- 成都机加工车间: 18 CNC operators on duty ----
    if ((await exists('departments', 'cd-mc')) && (await exists('positions', 'pos-cnc-operator'))) {
      const onDuty = (
        await query
          .selectFrom('employees')
          .select(['id', 'status', 'employmentType'])
          .where('departmentId', '=', 'cd-mc')
          .where('positionId', '=', 'pos-cnc-operator')
          .execute()
      ).filter((e) => String(e.status) !== 'leave' && (typeof e.employmentType === 'string' ? e.employmentType : 'fullTime') !== 'dispatched').length;
      for (let i = 0, added = 0; onDuty + added < 18 && i < FILLER.length; i++) {
        const id = `emp-cd-cnc-${String(i + 1).padStart(2, '0')}`;
        if (await exists('employees', id)) continue;
        await query
          .insertInto('employees')
          .values({
            id,
            employeeNo: `QH36${String(i + 1).padStart(2, '0')}`,
            name: FILLER[i],
            userId: null,
            departmentId: 'cd-mc',
            positionId: 'pos-cnc-operator',
            managerEmployeeId: 'emp-mgr-cd',
            status: 'active',
            hireDate: addDays(today, -400 - i * 30),
            positionSince: addDays(today, -400 - i * 30),
            email: null,
            mobile: `139000032${String(i + 1).padStart(2, '0')}`,
            note: null,
            gender: 'male',
            birthDate: null,
            idType: 'idCard',
            idNumber: null,
            employmentType: 'fullTime',
            workLocation: null,
            probationEndDate: null,
            regularizedAt: null,
            leaveDate: null,
            leaveReason: null,
            address: null,
            ...stamp,
          })
          .execute();
        added += 1;
      }
    }

    // ---- 招聘设置 ----
    const mgrEast = await userOf('mgr_east');
    if (!(await exists('personnelSettings', 'recruiting.settings')))
      await query
        .insertInto('personnelSettings')
        .values({
          id: 'recruiting.settings',
          value: {
            ...RECRUITING_SETTINGS_DEFAULTS,
            publicPage: { ...RECRUITING_SETTINGS_DEFAULTS.publicPage, enabled: true },
            workforce: {
              ...RECRUITING_SETTINGS_DEFAULTS.workforce,
              capacity: [
                {
                  departmentId: 'cd-mc',
                  positionId: 'pos-cnc-operator',
                  outputPerShift: 100,
                  shiftsPerMonth: 22,
                  hoursPerShift: 8,
                },
              ],
              transferLimits: [
                { departmentId: 'sz-mc', maxHeadcount: 4, coordinatorUserId: mgrEast },
              ],
              recruitingCycleDays: 14,
              onboardingDays: 14,
            },
          },
          revision: 1,
          updatedBy: recruit01,
          ...stamp,
        })
        .execute();

    // ---- automation owners ----
    const hr01 = await userOf('hr01');
    const owners: [string, string | null][] = [
      ['hrAssistant.workforceExplain', hr01],
      ['hrAssistant.preboarding', hr01],
      ['hrAssistant.preboardingExtract', hr01],
      ['hrAssistant.newHireCheckIn', hr01],
      ['recruitingAssistant.postingDraft', recruit01],
      ['recruitingAssistant.poolReuse', recruit01],
      ['recruitingAssistant.screening', recruit01],
      ['recruitingAssistant.interviewQuestions', recruit01],
      ['recruitingAssistant.interviewSummary', recruit01],
      ['recruitingAssistant.dailyDigest', recruit01],
    ];
    for (const [key, owner] of owners)
      if (owner && !(await exists('aiAutomationSettings', key)))
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id: key,
            enabled: true,
            ownerUserId: owner,
            hour: key.endsWith('dailyDigest') ? 18 : key.endsWith('preboarding') || key.endsWith('newHireCheckIn') ? 9 : null,
            weekday: null,
            monthDay: null,
            params: null,
            updatedByUserId: null,
            ...stamp,
          })
          .execute();

    // ---- 成都生产一线薪资结构: the CNC pay range only ----
    // nightRate is left as the V2-06 demo wrote it (40): payroll01 finds and
    // corrects it in the V2-06 walkthrough, which comes before this step's.
    const structure = await query
      .selectFrom('salaryStructures')
      .select(['id', 'payRanges'])
      .where('id', '=', 'struct-prod-cd')
      .executeTakeFirst();
    if (structure) {
      let ranges: unknown = structure.payRanges;
      for (let i = 0; i < 3 && typeof ranges === 'string'; i++) ranges = JSON.parse(ranges);
      const list = (Array.isArray(ranges) ? ranges : []) as { positionId?: string }[];
      if (!list.some((r) => r.positionId === 'pos-cnc-operator'))
        await query
          .updateTable('salaryStructures')
          .set({
            payRanges: [...list, { positionId: 'pos-cnc-operator', min: 4800, max: 8500 }],
            updatedAt: now,
          })
          .where('id', '=', 'struct-prod-cd')
          .execute();
    }

    // ---- 招聘需求（draft, raised by 何伟） ----
    const mgrCd = await userOf('mgr_cd');
    const checklist = [
      { type: 'education', text: '中专或技校及以上', mustHave: true },
      { type: 'experience', text: '1 年以上数控机床或加工中心操作经验', mustHave: false },
      { type: 'skill', text: '会看简单零件图纸并使用卡尺与千分尺', mustHave: true },
      { type: 'other', text: '能适应三班倒', mustHave: true },
    ];
    if (mgrCd && (await exists('departments', 'cd-mc')) && !(await exists('jobRequisitions', 'req-cd-cnc'))) {
      await query
        .insertInto('jobRequisitions')
        .values({
          id: 'req-cd-cnc',
          departmentId: 'cd-mc',
          positionId: 'pos-cnc-operator',
          headcount: 10,
          reason: 'newHeadcount',
          workforcePlanId: null,
          replacingEmployeeId: null,
          targetDate: addDays(today, 60),
          requirementsChecklist: checklist,
          note: null,
          requesterUserId: mgrCd,
          hiringManagerUserId: mgrCd,
          recruiterUserId: null,
          status: 'draft',
          approvals: [],
          hiredCount: 0,
          poolSuggestion: null,
          openedAt: null,
          filledAt: null,
          ...stamp,
        })
        .execute();
    }

    // ---- 简历库: last year's unhired candidate for CNC 操作工 ----
    if (mgrCd && !(await exists('candidates', 'cand-pool-qinchuan'))) {
      const lastYear = new Date(now.getTime() - 330 * 86_400_000);
      await query
        .insertInto('jobRequisitions')
        .values({
          id: 'req-cd-cnc-lastyear',
          departmentId: 'cd-mc',
          positionId: 'pos-cnc-operator',
          headcount: 3,
          reason: 'replacement',
          workforcePlanId: null,
          replacingEmployeeId: null,
          targetDate: lastYear.toISOString().slice(0, 10),
          requirementsChecklist: checklist,
          note: null,
          requesterUserId: mgrCd,
          hiringManagerUserId: mgrCd,
          recruiterUserId: recruit01,
          status: 'filled',
          approvals: [],
          hiredCount: 3,
          poolSuggestion: null,
          openedAt: lastYear,
          filledAt: lastYear,
          createdAt: lastYear,
          updatedAt: lastYear,
        })
        .execute();
      await query
        .insertInto('jobPostings')
        .values({
          id: 'post-cd-cnc-lastyear',
          requisitionId: 'req-cd-cnc-lastyear',
          title: 'CNC 操作工（成都）',
          description: '成都机加工车间 CNC 操作工（去年的招聘，已结束）。',
          requirements: checklist.map((c, i) => ({ key: `c${i + 1}`, ...c, origin: 'checklist' })),
          location: '成都工厂',
          publicSlug: null,
          channels: [],
          status: 'closed',
          source: 'manual',
          reviewStatus: 'confirmed',
          knockoutQuestions: [],
          interviewSlots: [],
          selfBookingEnabled: false,
          bookingTemplate: null,
          aiInterviewEnabled: false,
          aiInterviewPlan: null,
          confirmedBy: recruit01,
          confirmedAt: lastYear,
          publishedAt: lastYear,
          closedAt: lastYear,
          createdAt: lastYear,
          updatedAt: lastYear,
        })
        .execute();
      await query
        .insertInto('candidates')
        .values({
          id: 'cand-pool-qinchuan',
          name: '秦川',
          phone: '13900007300',
          email: 'qinchuan@demo.test',
          resumeFileId: null,
          parsedProfile: {
            education: [{ level: 'vocational', school: '某技工学校', major: '数控技术' }],
            experiences: [
              { summary: '某机械厂 数控车床操作工 3 年：装夹、加工与首件检验', years: 3, keywords: ['数控车床', '首件检验'] },
            ],
            skills: ['数控车床', '看图纸', '卡尺', '千分尺'],
            certificates: [],
          },
          parseConfidence: { education: 0.8, experiences: 0.8, skills: 0.7, certificates: 0.5 },
          parseStatus: 'parsed',
          sourceChannel: 'careersPage',
          consentAt: lastYear,
          consentBy: 'page',
          retentionUntil: addDays(today, 400),
          lastActivityAt: lastYear,
          anonymizedAt: null,
          anonymizedBy: null,
          customFields: {},
          createdAt: lastYear,
          updatedAt: lastYear,
        })
        .execute();
      await query
        .insertInto('applications')
        .values({
          id: 'app-pool-qinchuan',
          candidateId: 'cand-pool-qinchuan',
          postingId: 'post-cd-cnc-lastyear',
          stage: 'rejected',
          sourceChannel: 'careersPage',
          screeningSuggestion: null,
          screenedAt: null,
          knockoutAnswers: [],
          screeningDecision: 'reject',
          decidedBy: recruit01,
          decidedAt: lastYear,
          rejectRequirementKeys: ['c4'],
          rejectNote: '当时名额已满',
          stageHistory: [
            { from: null, to: 'applied', by: 'candidate', at: lastYear.toISOString() },
            { from: 'applied', to: 'rejected', by: recruit01, at: lastYear.toISOString() },
          ],
          stageSince: lastYear,
          messages: [],
          submitCount: 1,
          lastSubmittedAt: lastYear,
          bookingTokenHash: null,
          aiInterviewDeclined: false,
          aiInterviewTokenHash: null,
          createdAt: lastYear,
          updatedAt: lastYear,
        })
        .execute();
    }

    // ---- 《宿舍管理规定》for the new-hire check-in, when the knowledge base lacks it ----
    const dorm = await query
      .selectFrom('kbDocuments')
      .select(['id'])
      .where('docNo', '=', 'HR-POL-0010')
      .executeTakeFirst();
    if (!dorm && hr01) {
      const fileId = 'file-hr-pol-0010';
      const key = 'hr-files/demo/doc-hr-pol-0010.md';
      const bytes = Buffer.from(DORM_POLICY, 'utf8');
      const file = path.resolve(process.cwd(), 'storage', key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      if (!(await exists('hrFiles', fileId)))
        await query
          .insertInto('hrFiles')
          .values({ id: fileId, disk: 'local', key, filename: 'HR-POL-0010 宿舍管理规定 V1.0.md', ext: 'md', mimeType: 'text/markdown', size: bytes.length, ...stamp })
          .execute();
      await query
        .insertInto('kbDocuments')
        .values({
          id: 'doc-hr-pol-0010',
          title: '宿舍管理规定',
          docNo: 'HR-POL-0010',
          version: 'V1.0',
          effectiveDate: addDays(today, -90),
          category: 'policy',
          fileId,
          contentText: DORM_POLICY,
          parseStatus: 'ready',
          parseError: null,
          visibility: 'all',
          ownerUserId: hr01,
          reviewDate: addDays(today, 270),
          autoDraftCourse: false,
          active: true,
          ...stamp,
        })
        .execute();
    }

    // ---- 演示资料 (files only) ----
    const dir = path.resolve(process.cwd(), 'storage', 'demo-materials', 'recruiting');
    mkdirSync(dir, { recursive: true });
    for (const resume of DEMO_RESUMES) writeFileSync(path.join(dir, resume.file), resumeDocx(resume));
    writeFileSync(path.join(dir, ZHOU_DI_RESUME.file), resumeDocx(ZHOU_DI_RESUME));
    writeFileSync(
      path.join(dir, '公开页投递-另两名候选人.json'),
      JSON.stringify(PUBLIC_APPLICANTS, null, 2),
    );
  },
});
export default seed;
