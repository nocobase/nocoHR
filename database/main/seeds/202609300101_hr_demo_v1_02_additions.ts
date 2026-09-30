import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';

/**
 * V1-02 additions for the demo (《演示案例》 V1 数据), development and demo only:
 *
 * - 邓凯 (emp_th_3, 成都机加工车间 CNC 操作工) and his pending resignation —
 *   raised by 何伟, first level passed by itself, waiting for HR — so
 *   approving it opens the offboarding checklist;
 * - 陈晨 (no account, joined 1 July): a two-year contract with a six-month
 *   probation, over the legal limit of two months;
 * - 郭凡 (no account, 装配车间 装配工): joined 40 days ago, no contract yet;
 * - 陈静's current contract becomes her second consecutive fixed-term one;
 * - hr01 owns the HR assistant's checklist notes and compliance checks.
 *
 * Every row is written only when missing, so an administrator's changes stay.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609300101_hr_demo_v1_02_additions',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const day = (offset: number) =>
      new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
    const addMonths = (date: string, months: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + months);
      d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    };
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const hr = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-hr01')
      .executeTakeFirst();
    const mgrCd = await query
      .selectFrom('employees')
      .select(['userId'])
      .where('id', '=', 'emp-mgr-cd')
      .executeTakeFirst();
    // The base demo is required; without it there is nothing to add to.
    if (!hr?.userId) return;

    // ---- Task owners ----
    for (const key of [
      'hrAssistant.checklistNotes',
      'hrAssistant.compliance',
    ]) {
      if (await exists('aiAutomationSettings', key)) continue;
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: key,
          enabled: true,
          ownerUserId: hr.userId,
          hour: null,
          weekday: null,
          monthDay: null,
          params: null,
          updatedByUserId: null,
          ...stamp,
        })
        .execute();
    }

    // ---- 邓凯 ----
    if (!(await exists('employees', 'emp-dengkai'))) {
      const userId = await ensureDemoAccount(query, {
        username: 'emp_th_3',
        name: '邓凯',
        email: 'emp.th.3@demo.test',
      });
      await query
        .insertInto('employees')
        .values({
          id: 'emp-dengkai',
          employeeNo: 'QH3004',
          name: '邓凯',
          userId,
          departmentId: 'cd-mc',
          positionId: 'pos-cnc-operator',
          managerEmployeeId: 'emp-mgr-cd',
          status: 'active',
          hireDate: '2023-05-08',
          positionSince: '2023-05-08',
          email: 'emp.th.3@demo.test',
          mobile: '13900000012',
          note: null,
          gender: 'male',
          birthDate: '1998-08-08',
          idType: 'idCard',
          idNumber: '999999199808080012',
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '成都市龙泉驿区驿都大道 399 号 6 栋 903 室',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('departmentMembers')
        .values({
          id: randomUUID(),
          departmentId: 'cd-mc',
          userId,
          primary: true,
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employeeEducations')
        .values({
          id: 'emp-dengkai-edu1',
          employeeId: 'emp-dengkai',
          school: '西蜀机电职业技术学院',
          degree: 'associate',
          major: '数控技术',
          startDate: '2016-09-01',
          endDate: '2019-06-30',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employeeEmergencyContacts')
        .values({
          id: 'emp-dengkai-contact1',
          employeeId: 'emp-dengkai',
          name: '邓志明',
          relation: '父亲',
          phone: '13900001012',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('jobEvents')
        .values({
          id: 'event-dengkai-onboard',
          employeeId: 'emp-dengkai',
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: 'cd-mc',
          fromPositionId: null,
          toPositionId: 'pos-cnc-operator',
          effectiveDate: '2023-05-08',
          source: 'import',
          actionId: null,
          note: null,
          processedAt: now,
          ...stamp,
        })
        .execute();
    }
    if (!(await exists('employmentContracts', 'contract-dengkai')))
      await query
        .insertInto('employmentContracts')
        .values({
          id: 'contract-dengkai',
          employeeId: 'emp-dengkai',
          contractNo: 'HT-2023-013',
          type: 'fixedTerm',
          startDate: '2023-05-08',
          endDate: day(600),
          status: 'active',
          previousContractId: null,
          signedAt: '2023-05-08',
          fileId: null,
          note: null,
          ...stamp,
        })
        .execute();
    if (
      !(await exists('personnelActions', 'action-dengkai-offboard')) &&
      mgrCd?.userId
    )
      await query
        .insertInto('personnelActions')
        .values({
          id: 'action-dengkai-offboard',
          actionType: 'offboard',
          employeeId: 'emp-dengkai',
          candidate: null,
          fromDepartmentId: 'cd-mc',
          fromPositionId: 'pos-cnc-operator',
          approvalDepartmentId: 'cd-mc',
          toDepartmentId: null,
          toPositionId: null,
          effectiveDate: day(30),
          reason: '家里安排回老家发展。',
          leaveReason: 'resign',
          status: 'pending',
          applicantUserId: mgrCd.userId,
          // 成都机加工车间 has no head: the first level is 何伟, who raised it, so it passed by itself.
          approvals: JSON.stringify([
            {
              level: 1,
              kind: 'departmentHead',
              approverUserId: mgrCd.userId,
              approverUserIds: [mgrCd.userId],
              departmentId: 'cd',
              status: 'auto',
              decidedBy: mgrCd.userId,
              decidedAt: now.toISOString(),
              comment: null,
            },
            {
              level: 2,
              kind: 'hrAdmin',
              approverUserId: null,
              approverUserIds: [],
              anyHrAdmin: true,
              departmentId: null,
              status: 'pending',
              decidedBy: null,
              decidedAt: null,
              comment: null,
            },
          ]),
          // The HR level: every HR administrator; hr01 is the one in the demo.
          currentApproverUserIds: JSON.stringify([hr.userId]),
          effectiveAt: null,
          ...stamp,
        })
        .execute();

    // ---- 陈晨: the attendance demo may already have added him ----
    const year = day(0).slice(0, 4);
    const hire = `${year}-07-01`;
    if (hire <= day(0)) {
      if (!(await exists('employees', 'emp-chenchen')))
        await query
          .insertInto('employees')
          .values({
            id: 'emp-chenchen',
            employeeNo: 'QH2201',
            name: '陈晨',
            userId: null,
            departmentId: 'sz-mc',
            positionId: 'pos-cnc-operator',
            managerEmployeeId: 'emp-mgr-njl',
            status: 'probation',
            hireDate: hire,
            positionSince: hire,
            email: null,
            mobile: '13900000031',
            note: null,
            gender: 'male',
            birthDate: '2000-05-05',
            idType: 'idCard',
            idNumber: '999999200005050031',
            employmentType: 'fullTime',
            workLocation: null,
            probationEndDate: `${year}-12-31`,
            regularizedAt: null,
            leaveDate: null,
            leaveReason: null,
            address: '苏州市吴中区苏蠡路 72 号 10 幢 305 室',
            ...stamp,
          })
          .execute();
      if (!(await exists('employmentContracts', 'contract-chenchen')))
        await query
          .insertInto('employmentContracts')
          .values({
            id: 'contract-chenchen',
            employeeId: 'emp-chenchen',
            contractNo: `HT-${year}-021`,
            type: 'fixedTerm',
            startDate: hire,
            endDate: addMonths(hire, 24),
            status: 'active',
            previousContractId: null,
            signedAt: hire,
            fileId: null,
            note: null,
            ...stamp,
          })
          .execute();
    }

    // ---- 郭凡: 40 days in, no contract ----
    if (!(await exists('employees', 'emp-guofan'))) {
      const hired = day(-40);
      await query
        .insertInto('employees')
        .values({
          id: 'emp-guofan',
          employeeNo: 'QH2105',
          name: '郭凡',
          userId: null,
          departmentId: 'sz-as',
          positionId: 'pos-assembler',
          managerEmployeeId: 'emp-mgr-east',
          status: 'probation',
          hireDate: hired,
          positionSince: hired,
          email: null,
          mobile: '13900000032',
          note: null,
          gender: 'male',
          birthDate: '2001-06-06',
          idType: 'idCard',
          idNumber: '999999200106060032',
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: addMonths(hired, 2),
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市吴中区东山大道 1088 号 2 幢 1106 室',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('jobEvents')
        .values({
          id: 'event-guofan-onboard',
          employeeId: 'emp-guofan',
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: 'sz-as',
          fromPositionId: null,
          toPositionId: 'pos-assembler',
          effectiveDate: hired,
          source: 'import',
          actionId: null,
          note: null,
          processedAt: now,
          ...stamp,
        })
        .execute();
    }

    // ---- 陈静: her current fixed-term contract follows an earlier one ----
    if (!(await exists('employmentContracts', 'contract-mgr-njl-first'))) {
      await query
        .insertInto('employmentContracts')
        .values({
          id: 'contract-mgr-njl-first',
          employeeId: 'emp-mgr-njl',
          contractNo: 'HT-2020-003',
          type: 'fixedTerm',
          startDate: '2020-04-10',
          endDate: '2023-04-09',
          status: 'renewed',
          previousContractId: null,
          signedAt: '2020-04-10',
          fileId: null,
          note: null,
          ...stamp,
        })
        .execute();
      await query
        .updateTable('employmentContracts')
        .set({ previousContractId: 'contract-mgr-njl-first', updatedAt: now })
        .where('id', '=', 'contract-mgr-njl')
        .where('previousContractId', 'is', null)
        .execute();
    }
  },
});
export default seed;
