import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  DEMO_ACCOUNTS,
  DEMO_COMPETENCIES,
  DEMO_DEPARTMENTS,
  DEMO_JOB_FAMILIES,
  DEMO_FILLER_REQUIREMENTS,
  DEMO_IMPORT_HEADER,
  DEMO_IMPORT_SAMPLE,
  DEMO_PEOPLE,
  DEMO_POSITIONS,
} from '../../seed-data/demo.js';

/**
 * Demonstration data for "启衡精密" (01-演示案例.md, the V1-01 and V1-02 test
 * data) for development and demo environments; it writes nothing in
 * production. Rows are keyed on fixed ids and skipped when present, so a
 * replay never overwrites an administrator's edits.
 *
 * Demo account passwords are never written into the repository: see
 * `ensureDemoAccount` (HR_DEMO_PASSWORD, else the password already recorded in
 * storage/hr-demo-accounts.txt, else a new random one written there).
 */
const seed: SeedDefinition = defineSeed({
  name: '202609270102_hr_demo_data',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const todayDate = now.toISOString().slice(0, 10);
    const shift = (days: number) => {
      const d = new Date(`${todayDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );

    // ---- Accounts ----
    const userIds = new Map<string, string>();
    for (const account of DEMO_ACCOUNTS)
      userIds.set(account.username, await ensureDemoAccount(query, account));

    // ---- Organisation ----
    for (const department of DEMO_DEPARTMENTS) {
      if (await exists('departments', department.id)) continue;
      await query
        .insertInto('departments')
        .values({
          id: department.id,
          code: department.code,
          title: encodeAuthorizationTitle({
            key: department.titleKey,
            ns: 'hr',
          }),
          parentId: department.parentId,
          managerId: department.managerAccount
            ? (userIds.get(department.managerAccount) ?? null)
            : null,
          active: true,
          sortOrder: department.sortOrder,
          ...stamp,
        })
        .execute();
    }

    // ---- Framework ----
    for (const family of DEMO_JOB_FAMILIES) {
      if (await exists('jobFamilies', family.id)) continue;
      await query
        .insertInto('jobFamilies')
        .values({ ...family, active: true, ...stamp })
        .execute();
    }
    for (const position of DEMO_POSITIONS) {
      if (await exists('positions', position.id)) continue;
      await query
        .insertInto('positions')
        .values({ ...position, active: true, ...stamp })
        .execute();
    }
    for (const competency of DEMO_COMPETENCIES) {
      if (await exists('competencies', competency.id)) continue;
      const { levels, ...rest } = competency;
      await query
        .insertInto('competencies')
        .values({
          ...rest,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
          ...stamp,
        })
        .execute();
      let level = 1;
      for (const [title, behaviors] of levels) {
        await query
          .insertInto('competencyLevels')
          .values({
            id: `${competency.id}-l${level}`,
            competencyId: competency.id,
            level,
            title,
            behaviors,
            ...stamp,
          })
          .execute();
        level += 1;
      }
    }
    for (const requirement of DEMO_FILLER_REQUIREMENTS) {
      if (await exists('positionRequirements', requirement.id)) continue;
      await query
        .insertInto('positionRequirements')
        .values({
          ...requirement,
          positionId: 'pos-cnc-operator',
          source: 'manual',
          reviewStatus: 'confirmed',
          ...stamp,
        })
        .execute();
    }

    // ---- Employees, memberships and profiles ----
    for (const person of DEMO_PEOPLE) {
      if (await exists('employees', person.employeeId)) continue;
      const userId = person.account
        ? (userIds.get(person.account) ?? null)
        : null;
      const onProbation = person.employeeId === 'emp-sunli';
      const hireDate = person.hireDate || shift(-80);
      await query
        .insertInto('employees')
        .values({
          id: person.employeeId,
          employeeNo: person.employeeNo,
          name: person.name,
          userId,
          departmentId: person.departmentId,
          positionId: person.positionId,
          managerEmployeeId: person.managerEmployeeId,
          status: onProbation ? 'probation' : 'active',
          hireDate,
          positionSince: hireDate,
          email: person.account
            ? `${person.account.replace(/_/gu, '.')}@demo.test`
            : null,
          mobile: person.mobile,
          note: null,
          gender: person.gender,
          birthDate: person.birthDate,
          idType: 'idCard',
          idNumber: person.idNumber,
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: onProbation ? shift(10) : null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: person.address,
          ...stamp,
        })
        .execute();
      if (userId) {
        await query
          .insertInto('departmentMembers')
          .values({
            id: randomUUID(),
            departmentId: person.departmentId,
            userId,
            primary: true,
            active: true,
            ...stamp,
          })
          .execute();
      }
      await query
        .insertInto('employeeEducations')
        .values({
          id: `${person.employeeId}-edu1`,
          employeeId: person.employeeId,
          ...person.education,
          major: person.education.major || null,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employeeEmergencyContacts')
        .values({
          id: `${person.employeeId}-contact1`,
          employeeId: person.employeeId,
          ...person.contact,
          ...stamp,
        })
        .execute();
    }
    const wangleiExperience = 'emp-wanglei-exp1';
    if (!(await exists('employeeExperiences', wangleiExperience))) {
      await query
        .insertInto('employeeExperiences')
        .values({
          id: wangleiExperience,
          employeeId: 'emp-wanglei',
          company: '苏州华锐精工配件有限公司',
          title: '普车操作工',
          startDate: '2018-03-01',
          endDate: '2024-08-15',
          description: '负责普通车床上的零件粗加工和去毛刺工序。',
          ...stamp,
        })
        .execute();
    }

    // ---- Assessments ----
    // 王磊's gaps: 安全生产与 5S 2 and 岗位安全上岗资格 1 (V3-08). 李敏 is assessed twice, 40 and 10 days ago, to show history.
    const assessor = userIds.get('mgr_njl') ?? userIds.get('hr01') ?? 'system';
    const assessments = [
      {
        id: 'assess-wanglei-cnc',
        employeeId: 'emp-wanglei',
        competencyId: 'comp-cnc',
        level: 3,
        evidence:
          '能独立处理停机后的复机，按规定做首件检验并记录，本月无操作性质量问题。',
        assessedAt: new Date(now.getTime() - 7 * 86_400_000),
      },
      {
        id: 'assess-wanglei-record',
        employeeId: 'emp-wanglei',
        competencyId: 'comp-quality-record',
        level: 2,
        evidence: '首件检验与过程自检记录填写及时，一个月内无记录类质量问题。',
        assessedAt: new Date(now.getTime() - 7 * 86_400_000),
      },
      {
        id: 'assess-limin-cnc-1',
        employeeId: 'emp-limin',
        competencyId: 'comp-cnc',
        level: 1,
        evidence: '入职首月，在带教人员监护下操作数控机床。',
        assessedAt: new Date(now.getTime() - 40 * 86_400_000),
      },
      {
        id: 'assess-limin-cnc-2',
        employeeId: 'emp-limin',
        competencyId: 'comp-cnc',
        level: 3,
        evidence: '已能独立完成换刀、报警后的复机和首件检验，并完成记录。',
        assessedAt: new Date(now.getTime() - 10 * 86_400_000),
      },
    ];
    for (const assessment of assessments) {
      if (await exists('employeeCompetencies', assessment.id)) continue;
      await query
        .insertInto('employeeCompetencies')
        .values({
          ...assessment,
          source: 'assessment',
          assessedBy: assessor,
          ...stamp,
        })
        .execute();
    }

    // ---- Contracts (V1-02): one active contract each; 李敏's ends in 20 days,
    // 陈静's in 60, 赵阳 has a renewed predecessor, and every other fixed term
    // has more than a year left. ----
    const contracts = [
      {
        id: 'contract-hr01',
        employeeId: 'emp-hr01',
        contractNo: 'HT-2024-001',
        type: 'openEnded',
        startDate: '2024-03-01',
        endDate: null,
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-mgr-east',
        employeeId: 'emp-mgr-east',
        contractNo: 'HT-2024-002',
        type: 'openEnded',
        startDate: '2024-07-15',
        endDate: null,
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-mgr-cd',
        employeeId: 'emp-mgr-cd',
        contractNo: 'HT-2024-012',
        type: 'openEnded',
        startDate: '2024-03-18',
        endDate: null,
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-mgr-njl',
        employeeId: 'emp-mgr-njl',
        contractNo: 'HT-2023-003',
        type: 'fixedTerm',
        startDate: '2023-04-10',
        // Ends in 60 days, to show renewal preparation.
        endDate: shift(60),
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-wanglei',
        employeeId: 'emp-wanglei',
        contractNo: 'HT-2024-004',
        type: 'fixedTerm',
        startDate: '2024-09-01',
        endDate: shift(700),
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-limin',
        employeeId: 'emp-limin',
        contractNo: 'HT-2025-005',
        type: 'fixedTerm',
        startDate: '2025-02-15',
        endDate: shift(20),
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-zhaoyang-old',
        employeeId: 'emp-zhaoyang',
        contractNo: 'HT-2023-006',
        type: 'fixedTerm',
        startDate: '2023-06-01',
        endDate: '2025-05-31',
        status: 'renewed',
        previousContractId: null,
      },
      {
        id: 'contract-zhaoyang',
        employeeId: 'emp-zhaoyang',
        contractNo: 'HT-2025-007',
        type: 'fixedTerm',
        startDate: '2025-06-01',
        endDate: shift(970),
        status: 'active',
        previousContractId: 'contract-zhaoyang-old',
      },
      {
        id: 'contract-qianjin',
        employeeId: 'emp-qianjin',
        contractNo: 'HT-2025-010',
        type: 'fixedTerm',
        startDate: '2025-05-09',
        endDate: shift(950),
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-wumin',
        employeeId: 'emp-wumin',
        contractNo: 'HT-2025-009',
        type: 'fixedTerm',
        startDate: '2025-03-14',
        endDate: shift(880),
        status: 'active',
        previousContractId: null,
      },
      {
        id: 'contract-sunli',
        employeeId: 'emp-sunli',
        contractNo: 'HT-2026-008',
        type: 'fixedTerm',
        startDate: shift(-80),
        endDate: shift(1015),
        status: 'active',
        previousContractId: null,
      },
    ];
    for (const contract of contracts) {
      if (await exists('employmentContracts', contract.id)) continue;
      await query
        .insertInto('employmentContracts')
        .values({
          ...contract,
          signedAt: contract.startDate,
          fileId: null,
          note: null,
          ...stamp,
        })
        .execute();
    }

    // ---- Personnel actions ----
    const hr01 = userIds.get('hr01');
    const mgrNjl = userIds.get('mgr_njl');
    const mgrEast = userIds.get('mgr_east');
    if (!(await exists('personnelActions', 'action-sunli-onboard')) && hr01) {
      const decidedAt = new Date(now.getTime() - 81 * 86_400_000).toISOString();
      await query
        .insertInto('personnelActions')
        .values({
          id: 'action-sunli-onboard',
          actionType: 'onboard',
          employeeId: 'emp-sunli',
          candidate: JSON.stringify({
            name: '孙丽',
            employeeNo: 'QH2101',
            probationMonths: 3,
            createAccount: false,
          }),
          toDepartmentId: 'sz-as',
          toPositionId: 'pos-assembler',
          effectiveDate: shift(-80),
          reason: null,
          leaveReason: null,
          status: 'effective',
          applicantUserId: hr01,
          approvals: JSON.stringify([
            {
              level: 1,
              kind: 'departmentHead',
              approverUserId: mgrEast ?? null,
              departmentId: 'sz',
              status: 'approved',
              decidedBy: mgrEast ?? null,
              decidedAt,
              comment: null,
            },
            {
              level: 2,
              kind: 'hrAdmin',
              approverUserId: null,
              departmentId: null,
              status: 'approved',
              decidedBy: hr01,
              decidedAt,
              comment: null,
            },
          ]),
          effectiveAt: new Date(now.getTime() - 80 * 86_400_000),
          ...stamp,
        })
        .execute();
      await query
        .insertInto('jobEvents')
        .values({
          id: 'event-sunli-onboard',
          employeeId: 'emp-sunli',
          eventType: 'onboard',
          fromDepartmentId: null,
          toDepartmentId: 'sz-as',
          fromPositionId: null,
          toPositionId: 'pos-assembler',
          effectiveDate: shift(-80),
          actionId: 'action-sunli-onboard',
          ...stamp,
        })
        .execute();
    }
    if (
      !(await exists('personnelActions', 'action-wanglei-transfer')) &&
      mgrNjl
    ) {
      await query
        .insertInto('personnelActions')
        .values({
          id: 'action-wanglei-transfer',
          actionType: 'transfer',
          employeeId: 'emp-wanglei',
          candidate: null,
          toDepartmentId: 'sz-as',
          toPositionId: 'pos-assembler',
          effectiveDate: todayDate,
          reason: '装配车间新卡钳装配线投产人手不足，调派支援。',
          leaveReason: null,
          status: 'pending',
          applicantUserId: mgrNjl,
          // 装配车间 has no head, so the first level goes up to 苏州工厂 (周宏).
          approvals: JSON.stringify([
            {
              level: 1,
              kind: 'departmentHead',
              approverUserId: mgrEast ?? null,
              departmentId: 'sz',
              status: 'pending',
              decidedBy: null,
              decidedAt: null,
              comment: null,
            },
            {
              level: 2,
              kind: 'hrAdmin',
              approverUserId: null,
              departmentId: null,
              status: 'pending',
              decidedBy: null,
              decidedAt: null,
              comment: null,
            },
          ]),
          effectiveAt: null,
          ...stamp,
        })
        .execute();
    }

    // ---- Profile change request ----
    if (!(await exists('profileChangeRequests', 'change-wanglei-mobile'))) {
      await query
        .insertInto('profileChangeRequests')
        .values({
          id: 'change-wanglei-mobile',
          employeeId: 'emp-wanglei',
          changes: JSON.stringify({ mobile: '13900009004' }),
          status: 'pending',
          reviewerUserId: null,
          reviewedAt: null,
          comment: null,
          ...stamp,
        })
        .execute();
    }

    // ---- Initial assignments that name demo organisation subjects (V1-01) ----
    // hr.manager goes to the department-head subject in the permission-set
    // seed. hr.admin goes to the HR 专员 position, not to 人力资源部: the
    // trainer, recruiter and payroll specialists there hold only their own
    // permission sets.
    const assign = async (
      permissionSetKey: string,
      subjectType: string,
      subjectId: string,
    ) => {
      const set = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', permissionSetKey)
        .executeTakeFirst();
      if (!set) return;
      const existing = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select('id')
        .where('permissionSetKey', '=', permissionSetKey)
        .where('subjectType', '=', subjectType)
        .where('subjectId', '=', subjectId)
        .executeTakeFirst();
      if (existing) return;
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          permissionSetKey,
          subjectType,
          subjectId,
          ...stamp,
        })
        .execute();
    };
    await assign('hr.admin', 'org.position', 'pos-office-hr');
    await assign('hr.employee', 'org.department', 'qiheng');

    // 《9月新员工花名册.xlsx》 and its problem-free variant (row 1 only), for the import demo.
    const materials = path.resolve(process.cwd(), 'storage', 'demo-materials');
    mkdirSync(materials, { recursive: true });
    const workbook = (rows: readonly (readonly string[])[]) => {
      const book = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        book,
        XLSX.utils.aoa_to_sheet([
          [...DEMO_IMPORT_HEADER],
          ...rows.map((r) => [...r]),
        ]),
        'employees',
      );
      return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    };
    writeFileSync(
      path.join(materials, '9月新员工花名册.xlsx'),
      workbook(DEMO_IMPORT_SAMPLE),
    );
    writeFileSync(
      path.join(materials, '9月新员工花名册-已核对.xlsx'),
      workbook(DEMO_IMPORT_SAMPLE.slice(0, 1)),
    );

    // The HR assistant's import health check is owned by hr01 (V1 step 1).
    const owner = userIds.get('hr01');
    if (
      owner &&
      !(await exists('aiAutomationSettings', 'hrAssistant.importCheck'))
    )
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: 'hrAssistant.importCheck',
          enabled: true,
          ownerUserId: owner,
          hour: null,
          weekday: null,
          monthDay: null,
          params: null,
          updatedByUserId: null,
          ...stamp,
        })
        .execute();
  },
});

export default seed;
