import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';

/**
 * V3-11 画像、联动与内容维护, development and demo only (`NODE_ENV=production`,
 * `HR_DEMO_SEED=false` or `HR_PROFILE_DEMO=false` skips it). Every part checks
 * that the rows it builds on exist, so it never fails when other demo seeds
 * are off; rows are keyed on fixed ids and skipped when present.
 *
 * - 马骏 (qa_audit, 质量部 内审专员) holds hr.auditor; the integration account
 *   integration_qms has no password (it cannot sign in to the interface) and
 *   holds only hr.integration. Its API key is issued at runtime, never here.
 * - hr01 owns the eight automations of this step.
 * - Matching rules: qms 首件检验 → CNC 设备操作, 记录规范 → 质量记录规范
 *   (confirmed); 设备故障 has none. project 方案设计 → 解决方案设计与报价,
 *   客户交流 → 客户需求分析 (confirmed, with the sales scenario).
 * - Records QI-2026-0301 (钱进, 120 days ago), 0412 (王磊, 80, 8D-2026-0088),
 *   0463 (赵阳, 35), 0439 (钱进, 20, 设备故障, unmatched competency), 0440 (an
 *   unknown number, 15, unmatched person). QI-2026-0457 is pushed in the demo.
 * - 顾强 (a CNC operator of 机加工车间 without an account), the 找人 hit: a
 *   valid CNC 岗位上岗证 issued two months ago and CNC 设备操作 4 by mgr_njl
 *   30 days ago. The specification names 李敏; her certificates and
 *   assessments stay as the V3-08 / V3-10 / V4-14 demos need them.
 * - 王磊, 钱进, 赵阳 completed 《CNC 岗位操作入门》 against WI-MC-0231 V4.0.
 * - A confirmed question of trainer01 answered 25 times, 5 correctly.
 * - The sales scenario (when 销售部 exists): 解决方案设计与报价 and 客户需求分析,
 *   销售解决方案经理 with its requirements, 高原's achieved target, level 2,
 *   《解决方案经理任职考试》 92, two tasks delivered on time; 林峰 one delayed.
 * - New-hire retention: see 202610080103_hr_demo_profile_retention.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610080102_hr_demo_profile',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_PROFILE_DEMO === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = now.toISOString().slice(0, 10);
    const shift = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const daysAgo = (days: number, hour = 2) =>
      new Date(`${shift(-days)}T${String(hour).padStart(2, '0')}:00:00Z`);
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const userOf = async (username: string): Promise<string> => {
      const row = await query
        .selectFrom('user')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst();
      return row ? String(row.id) : '';
    };
    const assign = async (permissionSetKey: string, userId: string) => {
      if (!userId) return;
      const set = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
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
    const hr = await userOf('hr01');
    const headNjl = await userOf('mgr_njl');
    const headSales = await userOf('mgr_sales');
    const trainer = await userOf('trainer01');
    const departments = new Set(
      (await query.selectFrom('departments').select('id').execute()).map((d) =>
        String(d.id),
      ),
    );

    // ---- Accounts: 马骏 (hr.auditor) and the integration account (hr.integration) ----
    if (departments.has('quality')) {
      const qa = await ensureDemoAccount(query, {
        username: 'qa_audit',
        name: '马骏',
        email: 'qa.audit@demo.test',
      });
      if (!(await exists('employees', 'emp-qa-audit'))) {
        await query
          .insertInto('employees')
          .values({
            id: 'emp-qa-audit',
            employeeNo: 'QH6001',
            name: '马骏',
            userId: qa,
            departmentId: 'quality',
            positionId: (await exists('positions', 'pos-office-auditor'))
              ? 'pos-office-auditor'
              : null,
            managerEmployeeId: null,
            status: 'active',
            hireDate: '2021-09-01',
            positionSince: '2021-09-01',
            email: 'qa.audit@demo.test',
            mobile: '13900006001',
            note: null,
            gender: 'male',
            birthDate: '1988-08-08',
            idType: 'idCard',
            idNumber: '999999198808086001',
            employmentType: 'fullTime',
            workLocation: '苏州工厂',
            probationEndDate: null,
            regularizedAt: null,
            leaveDate: null,
            leaveReason: null,
            address: '苏州市相城区元和街道采莲路 305 号 3 幢 802 室',
            ...stamp,
          })
          .execute();
        await query
          .insertInto('departmentMembers')
          .values({
            id: randomUUID(),
            departmentId: 'quality',
            userId: qa,
            primary: true,
            active: true,
            ...stamp,
          })
          .execute();
      }
      await assign('hr.auditor', qa);
    }
    // No credential account: the integration account cannot sign in; it only calls the ingest API with a key.
    let integration = await userOf('integration_qms');
    if (!integration) {
      integration = randomUUID();
      await query
        .insertInto('user')
        .values({
          id: integration,
          name: '质量管理系统集成',
          username: 'integration_qms',
          email: 'integration.qms@demo.test',
          emailVerified: true,
          ...stamp,
        })
        .execute();
    }
    await assign('hr.integration', integration);

    // ---- The automations of this step are owned by hr01 ----
    if (hr)
      for (const id of [
        'talentAnalyst.trainingCheck',
        'learningCoach.recommendationItems',
        'talentAnalyst.levelSuggestions',
        'talentAnalyst.monthlyReport',
        'talentAnalyst.summaryRefresh',
        'talentAnalyst.ruleDrafting',
        'contentWriter.versionRevision',
        'contentWriter.questionQuality',
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

    // ---- Matching rules ----
    const rule = async (
      id: string,
      sourceSystem: string,
      category: string,
      competencyId: string,
    ) => {
      if (!(await exists('competencies', competencyId))) return;
      const existing = await query
        .selectFrom('signalCompetencyRules')
        .select('id')
        .where('sourceSystem', '=', sourceSystem)
        .where('category', '=', category)
        .executeTakeFirst();
      if (existing) return;
      await query
        .insertInto('signalCompetencyRules')
        .values({
          id,
          sourceSystem,
          category,
          competencyId,
          source: 'manual',
          reviewStatus: 'confirmed',
          note: null,
          createdBy: hr || null,
          confirmedBy: hr || null,
          confirmedAt: now,
          ...stamp,
        })
        .execute();
    };
    await rule('rule-qms-first-article', 'qms', '首件检验', 'comp-cnc');
    await rule('rule-qms-records', 'qms', '记录规范', 'comp-quality-record');

    // ---- Business records ----
    const signal = async (input: {
      sourceSystem: string;
      externalId: string;
      signalType: string;
      category: string;
      severity: string | null;
      title: string;
      summary: string | null;
      daysAgo: number;
      employeeId: string | null;
      personKey: string;
      competencyId: string | null;
      matchStatus: string;
      correctiveActionRef?: string | null;
    }) => {
      if (input.employeeId && !(await exists('employees', input.employeeId)))
        return;
      const existing = await query
        .selectFrom('businessSignals')
        .select('id')
        .where('sourceSystem', '=', input.sourceSystem)
        .where('externalId', '=', input.externalId)
        .executeTakeFirst();
      if (existing) return;
      const employee = input.employeeId
        ? await query
            .selectFrom('employees')
            .select(['departmentId'])
            .where('id', '=', input.employeeId)
            .executeTakeFirst()
        : undefined;
      const competencyId =
        input.competencyId && (await exists('competencies', input.competencyId))
          ? input.competencyId
          : null;
      await query
        .insertInto('businessSignals')
        .values({
          id: `signal-${input.externalId.toLowerCase()}`,
          sourceSystem: input.sourceSystem,
          externalId: input.externalId,
          signalType: input.signalType,
          category: input.category,
          severity: input.severity,
          title: input.title,
          summary: input.summary,
          occurredAt: daysAgo(input.daysAgo, 3),
          employeeId: input.employeeId,
          personKey: input.personKey,
          departmentId: employee ? String(employee.departmentId) : null,
          competencyId,
          correctiveActionRef: input.correctiveActionRef ?? null,
          link: `https://qms.example.test/issues/${input.externalId}`,
          matchStatus:
            input.matchStatus === 'matched' && !competencyId
              ? 'unmatchedCompetency'
              : input.matchStatus,
          rawPayload: {
            sourceSystem: input.sourceSystem,
            externalId: input.externalId,
            personKey: input.personKey,
            demo: true,
          },
          customFields: null,
          channel: 'seed',
          ingestedBy: null,
          ...stamp,
        })
        .execute();
    };
    await signal({
      sourceSystem: 'qms',
      externalId: 'QI-2026-0301',
      signalType: 'qualityIssue',
      category: '首件检验',
      severity: 'major',
      title: '转向节孔径首件超差未拦截',
      summary:
        '换刀后首件孔径超差 0.03 mm，首件检验记录缺失，批量流入下道工序。',
      daysAgo: 120,
      employeeId: 'emp-qianjin',
      personKey: 'QH2003',
      competencyId: 'comp-cnc',
      matchStatus: 'matched',
    });
    await signal({
      sourceSystem: 'qms',
      externalId: 'QI-2026-0412',
      signalType: 'qualityIssue',
      category: '首件检验',
      severity: 'major',
      title: '停机后未做首件检验即批量加工',
      summary: '午休停机 20 分钟后直接批量加工，端面跳动超差 12 件。',
      daysAgo: 80,
      employeeId: 'emp-wanglei',
      personKey: 'QH2001',
      competencyId: 'comp-cnc',
      matchStatus: 'matched',
      correctiveActionRef: '8D-2026-0088',
    });
    await signal({
      sourceSystem: 'qms',
      externalId: 'QI-2026-0463',
      signalType: 'qualityIssue',
      category: '记录规范',
      severity: 'minor',
      title: '过程检验记录漏填',
      summary: '夜班过程自检记录两处漏填测量值。',
      daysAgo: 35,
      employeeId: 'emp-zhaoyang',
      personKey: 'QH3001',
      competencyId: 'comp-quality-record',
      matchStatus: 'matched',
    });
    await signal({
      sourceSystem: 'qms',
      externalId: 'QI-2026-0439',
      signalType: 'qualityIssue',
      category: '设备故障',
      severity: 'minor',
      title: '主轴异响停机',
      summary: '加工中心主轴异响，停机报修。',
      daysAgo: 20,
      employeeId: 'emp-qianjin',
      personKey: 'QH2003',
      competencyId: null,
      matchStatus: 'unmatchedCompetency',
    });
    await signal({
      sourceSystem: 'qms',
      externalId: 'QI-2026-0440',
      signalType: 'qualityIssue',
      category: '首件检验',
      severity: 'minor',
      title: '首件检验卡未签字',
      summary: '首件检验卡缺班组长签字。',
      daysAgo: 15,
      employeeId: null,
      personKey: 'QH2998',
      competencyId: 'comp-cnc',
      matchStatus: 'unmatchedPerson',
    });

    // ---- 顾强: the 找人 hit — a valid CNC 岗位上岗证, CNC 设备操作 4, no quality issue ----
    // A new person rather than 李敏, whose certificates and assessments other steps' demos rely on.
    if (
      departments.has('sz-mc') &&
      (await exists('positions', 'pos-cnc-operator')) &&
      (await exists('certifications', 'cert-cnc')) &&
      !(await exists('employees', 'emp-profile-guqiang'))
    ) {
      await query
        .insertInto('employees')
        .values({
          id: 'emp-profile-guqiang',
          employeeNo: 'QH2091',
          name: '顾强',
          userId: null,
          departmentId: 'sz-mc',
          positionId: 'pos-cnc-operator',
          managerEmployeeId: (await exists('employees', 'emp-mgr-njl'))
            ? 'emp-mgr-njl'
            : null,
          status: 'active',
          hireDate: '2021-04-12',
          positionSince: '2021-04-12',
          email: null,
          mobile: '13900002091',
          note: null,
          gender: 'male',
          birthDate: '1994-10-10',
          idType: 'idCard',
          idNumber: '999999199410102091',
          employmentType: 'fullTime',
          workLocation: '苏州工厂',
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: null,
          ...stamp,
        })
        .execute();
      const issued = shift(-61);
      const expires = new Date(`${issued}T00:00:00Z`);
      expires.setUTCMonth(expires.getUTCMonth() + 12);
      await query
        .insertInto('employeeCertificates')
        .values({
          id: 'certificate-guqiang-cnc',
          employeeId: 'emp-profile-guqiang',
          certificationId: 'cert-cnc',
          certificateNo: `CNC-OP-${issued.slice(0, 4)}-00021`,
          issuedAt: issued,
          expiresAt: expires.toISOString().slice(0, 10),
          status: 'valid',
          source: 'internal',
          revokedReason: null,
          evidence: { assignmentIds: [], attemptIds: [] },
          ...stamp,
        })
        .execute();
      if (await exists('competencies', 'comp-cnc'))
        await query
          .insertInto('employeeCompetencies')
          .values({
            id: 'assess-profile-guqiang-cnc',
            employeeId: 'emp-profile-guqiang',
            competencyId: 'comp-cnc',
            level: 4,
            source: 'assessment',
            evidence: '现场实操观察：换型、首件与过程自检独立完成，带教新人。',
            assessedBy: headNjl || hr || 'system',
            assessedAt: daysAgo(30),
            ...stamp,
          })
          .execute();
    }

    // ---- 《CNC 岗位操作入门》 completed against WI-MC-0231 V4.0 ----
    if (
      (await exists('courses', 'course-cnc-intro')) &&
      (await exists('kbDocuments', 'doc-wi-mc-0231'))
    ) {
      for (const [employeeId, ago] of [
        ['emp-wanglei', 150],
        ['emp-qianjin', 300],
        ['emp-zhaoyang', 330],
      ] as const) {
        if (!(await exists('employees', employeeId))) continue;
        const done = await query
          .selectFrom('assignments')
          .select('id')
          .where('employeeId', '=', employeeId)
          .where('courseId', '=', 'course-cnc-intro')
          .where('status', '=', 'completed')
          .executeTakeFirst();
        if (done) continue;
        await query
          .insertInto('assignments')
          .values({
            id: `assign-profile-${employeeId}-cnc-intro`,
            employeeId,
            courseId: 'course-cnc-intro',
            examId: null,
            certificateId: null,
            learningPathId: null,
            parentAssignmentId: null,
            pathStepId: null,
            practiceScenarioId: null,
            learningPlanId: null,
            optional: false,
            reminderCount: 0,
            assignedByUserId: trainer || null,
            dueDate: shift(-ago + 7),
            status: 'completed',
            progress: 100,
            source: 'manual',
            completedAt: daysAgo(ago),
            cancelledAt: null,
            lastRemindedAt: null,
            escalatedAt: null,
            courseVersion: 1,
            courseSourceDocumentId: 'doc-wi-mc-0231',
            createdAt: daysAgo(ago + 7),
            updatedAt: now,
          })
          .execute();
      }
      await query
        .updateTable('kbDocuments')
        .set({ effectiveDate: shift(-400) })
        .where('id', '=', 'doc-wi-mc-0231')
        .where('effectiveDate', 'is', null)
        .execute();
    }
    // Completed course tasks written by earlier seeds: version 1 of the course's current source (as the migration does).
    for (const course of await query
      .selectFrom('courses')
      .select(['id', 'sourceDocumentId'])
      .execute())
      await query
        .updateTable('assignments')
        .set({
          courseVersion: 1,
          courseSourceDocumentId:
            course.sourceDocumentId == null
              ? null
              : `${course.sourceDocumentId as string}`,
        })
        .where('courseId', '=', String(course.id))
        .where('status', '=', 'completed')
        .where('courseVersion', 'is', null)
        .execute();

    // ---- 题目质量月检: 25 answers, 5 correct ----
    if (trainer && !(await exists('questions', 'q-profile-quality-01'))) {
      const options = [
        { key: 'A', text: '每班一次' },
        { key: 'B', text: '每 20 件' },
        { key: 'C', text: '每 50 件' },
        { key: 'D', text: '只在换型后' },
      ];
      await query
        .insertInto('questions')
        .values({
          id: 'q-profile-quality-01',
          type: 'single',
          stem: '过程检验记录应在什么时候补填测量值？',
          options,
          answer: 'B',
          explanation: '测量后当即填写；表中“每 20 件”指自检频次。',
          gradingNotes: null,
          difficulty: 'medium',
          sourceDocumentId: null,
          sourceCourseId: null,
          sourceExcerpt: null,
          score: 10,
          ownerUserId: trainer,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('exams')
        .values({
          id: 'exam-profile-record-drill',
          title: '质量记录随堂练习',
          description: '班组随堂练习，不计入认证。',
          paperMode: 'fixed',
          randomRules: null,
          durationMinutes: 10,
          maxAttempts: 99,
          passScore: 60,
          showAnswersAfter: 'afterSubmit',
          ownerUserId: trainer,
          published: false,
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('examQuestions')
        .values({
          id: 'exam-profile-record-drill-q1',
          examId: 'exam-profile-record-drill',
          questionId: 'q-profile-quality-01',
          sortOrder: 0,
          score: 100,
          ...stamp,
        })
        .execute();
      // The demo's new people only: the drill must not change anyone else's exam history.
      const takers = ['emp-profile-guqiang', 'emp-qa-audit'];
      const present: string[] = [];
      for (const id of takers)
        if (await exists('employees', id)) present.push(id);
      const paper = [
        {
          questionId: 'q-profile-quality-01',
          type: 'single',
          stem: '过程检验记录应在什么时候补填测量值？',
          options,
          blankCount: 0,
          score: 100,
          competencyIds: [],
        },
      ];
      for (let i = 0; i < 25 && present.length; i += 1) {
        const correct = i % 5 === 0;
        const answer = correct ? 'B' : ['A', 'C', 'D', 'A'][i % 4];
        const startedAt = daysAgo(220 - i, 8);
        await query
          .insertInto('examAttempts')
          .values({
            id: `attempt-profile-drill-${String(i + 1).padStart(2, '0')}`,
            examId: 'exam-profile-record-drill',
            employeeId: present[i % present.length],
            assignmentId: null,
            attemptNo: Math.floor(i / present.length) + 1,
            paperSnapshot: paper,
            answers: { 'q-profile-quality-01': answer },
            startedAt,
            deadlineAt: new Date(startedAt.getTime() + 10 * 60_000),
            submittedAt: new Date(startedAt.getTime() + 5 * 60_000),
            objectiveScore: correct ? 100 : 0,
            subjectiveScore: null,
            score: correct ? 100 : 0,
            status: correct ? 'passed' : 'failed',
            gradedBy: null,
            itemResults: {
              'q-profile-quality-01': {
                score: correct ? 100 : 0,
                correct,
                comment: null,
              },
            },
            createdAt: startedAt,
            updatedAt: startedAt,
          })
          .execute();
      }
    }

    // ---- The sales scenario: 高原's delivered tasks, level 2 and 92 in the qualification exam ----
    if (
      departments.has('sales') &&
      (await exists('employees', 'emp-sales-gaoyuan'))
    ) {
      const competency = async (
        id: string,
        title: string,
        description: string,
        levels: string[],
      ) => {
        const byTitle = await query
          .selectFrom('competencies')
          .select('id')
          .where('title', '=', title)
          .executeTakeFirst();
        if (byTitle) return String(byTitle.id);
        await query
          .insertInto('competencies')
          .values({
            id,
            code: id.replace(/^comp-/u, ''),
            title,
            category: 'skill',
            description,
            maxLevel: 5,
            source: 'manual',
            reviewStatus: 'confirmed',
            active: true,
            ...stamp,
          })
          .execute();
        for (const [index, behaviors] of levels.entries())
          await query
            .insertInto('competencyLevels')
            .values({
              id: `${id}-l${index + 1}`,
              competencyId: id,
              level: index + 1,
              title: ['入门', '基础', '熟练', '精通', '专家'][index],
              behaviors,
              ...stamp,
            })
            .execute();
        return id;
      };
      const quote = await competency(
        'comp-solution-quote',
        '解决方案设计与报价',
        '牵头制定制动卡钳与转向节的配套方案，完成成本测算与报价的能力。',
        [
          '能按模板整理客户询价信息。',
          '能在指导下完成常规产品的报价测算。',
          '能独立完成新平台配套方案与报价，并说明交付风险。',
          '能牵头复杂项目的方案评审与报价策略。',
          '能制定报价规则并培养团队。',
        ],
      );
      const needs = await competency(
        'comp-customer-needs',
        '客户需求分析',
        '理解整车厂新平台的制动系统需求，组织客户与技术中心技术交流的能力。',
        [
          '能记录客户提出的需求。',
          '能按清单向客户确认需求。',
          '能独立组织技术交流并澄清关键指标。',
          '能识别客户未明说的需求并引导方案。',
          '能主导战略客户的需求规划。',
        ],
      );
      await rule('rule-project-design', 'project', '方案设计', quote);
      await rule('rule-project-communication', 'project', '客户交流', needs);
      const byTitle = await query
        .selectFrom('positions')
        .select('id')
        .where('title', '=', '销售解决方案经理')
        .executeTakeFirst();
      let position = byTitle ? String(byTitle.id) : '';
      if (!position && (await exists('jobFamilies', 'jf-sales'))) {
        position = 'pos-sales-solution-manager';
        await query
          .insertInto('positions')
          .values({
            id: position,
            code: 'sales-solution-manager',
            title: '销售解决方案经理',
            jobFamilyId: 'jf-sales',
            grade: 'S3',
            responsibilities:
              '面向整车厂客户，把制动系统的产品能力转化为可落地的解决方案，牵头从需求到定点的全过程。',
            sortOrder: 1,
            active: true,
            ...stamp,
          })
          .execute();
        for (const [competencyId, level, mandatory] of [
          [quote, 3, true],
          [needs, 3, true],
          ['comp-brake-product', 3, true],
        ] as const)
          if (await exists('competencies', competencyId))
            await query
              .insertInto('positionRequirements')
              .values({
                id: `req-solution-${competencyId}`,
                positionId: position,
                competencyId,
                requiredLevel: level,
                mandatory,
                source: 'manual',
                reviewStatus: 'confirmed',
                ...stamp,
              })
              .execute();
      }
      if (
        position &&
        !(await exists('developmentTargets', 'target-profile-gaoyuan'))
      ) {
        const open = await query
          .selectFrom('developmentTargets')
          .select('id')
          .where('employeeId', '=', 'emp-sales-gaoyuan')
          .where('targetPositionId', '=', position)
          .executeTakeFirst();
        if (!open)
          await query
            .insertInto('developmentTargets')
            .values({
              id: 'target-profile-gaoyuan',
              employeeId: 'emp-sales-gaoyuan',
              targetPositionId: position,
              reason: '具备销售解决方案经理任职资格，待发起晋升',
              status: 'achieved',
              createdBy: headSales || hr || 'system',
              achievedAt: daysAgo(10),
              cancelledAt: null,
              cancelledBy: null,
              decisionActionId: null,
              ...stamp,
            })
            .execute();
      }
      if (
        !(await exists('employeeCompetencies', 'assess-profile-gaoyuan-quote'))
      )
        await query
          .insertInto('employeeCompetencies')
          .values({
            id: 'assess-profile-gaoyuan-quote',
            employeeId: 'emp-sales-gaoyuan',
            competencyId: quote,
            level: 2,
            source: 'assessment',
            evidence: '在指导下完成两家客户的常规报价测算。',
            assessedBy: headSales || hr || 'system',
            assessedAt: daysAgo(150),
            ...stamp,
          })
          .execute();
      if (
        !(await exists('exams', 'exam-sales-solution-qualification')) &&
        headSales
      ) {
        const questions = [
          ['q-solution-01', '报价前必须拿到的四项输入是什么？', quote],
          ['q-solution-02', '超出标准毛利区间的报价由谁审批？', quote],
        ] as const;
        for (const [id, stem, competencyId] of questions) {
          await query
            .insertInto('questions')
            .values({
              id,
              type: 'short',
              stem,
              options: [],
              answer: '见《解决方案报价实务》。',
              explanation: null,
              gradingNotes: null,
              difficulty: 'medium',
              sourceDocumentId: null,
              sourceCourseId: null,
              sourceExcerpt: null,
              score: 50,
              ownerUserId: trainer || headSales,
              source: 'manual',
              reviewStatus: 'confirmed',
              active: true,
              ...stamp,
            })
            .execute();
          await query
            .insertInto('questionCompetencies')
            .values({
              id: `${id}-${competencyId}`,
              questionId: id,
              competencyId,
              ...stamp,
            })
            .execute();
        }
        await query
          .insertInto('exams')
          .values({
            id: 'exam-sales-solution-qualification',
            title: '解决方案经理任职考试',
            description: '销售解决方案经理任职资格考试：方案设计与报价。',
            paperMode: 'fixed',
            randomRules: null,
            durationMinutes: 60,
            maxAttempts: 2,
            passScore: 80,
            showAnswersAfter: 'never',
            ownerUserId: trainer || headSales,
            published: true,
            active: true,
            ...stamp,
          })
          .execute();
        for (const [index, [id]] of questions.entries())
          await query
            .insertInto('examQuestions')
            .values({
              id: `exam-sales-solution-qualification-${id}`,
              examId: 'exam-sales-solution-qualification',
              questionId: id,
              sortOrder: index,
              score: 50,
              ...stamp,
            })
            .execute();
        const startedAt = daysAgo(25, 6);
        await query
          .insertInto('examAttempts')
          .values({
            id: 'attempt-profile-gaoyuan-solution',
            examId: 'exam-sales-solution-qualification',
            employeeId: 'emp-sales-gaoyuan',
            assignmentId: null,
            attemptNo: 1,
            paperSnapshot: questions.map(([id, stem, competencyId]) => ({
              questionId: id,
              type: 'short',
              stem,
              options: [],
              blankCount: 0,
              score: 50,
              competencyIds: [competencyId],
            })),
            answers: {},
            startedAt,
            deadlineAt: new Date(startedAt.getTime() + 60 * 60_000),
            submittedAt: new Date(startedAt.getTime() + 45 * 60_000),
            objectiveScore: 0,
            subjectiveScore: 92,
            score: 92,
            status: 'passed',
            gradedBy: trainer || headSales,
            itemResults: {
              'q-solution-01': { score: 46, correct: null, comment: null },
              'q-solution-02': { score: 46, correct: null, comment: null },
            },
            createdAt: startedAt,
            updatedAt: startedAt,
          })
          .execute();
      }
      const project = async (
        externalId: string,
        employeeId: string,
        personKey: string,
        signalType: string,
        title: string,
        ago: number,
      ) =>
        signal({
          sourceSystem: 'project',
          externalId,
          signalType,
          category: '方案设计',
          severity: null,
          title,
          summary: null,
          daysAgo: ago,
          employeeId,
          personKey,
          competencyId: quote,
          matchStatus: 'matched',
        });
      await project(
        'PJ-2026-018-T03',
        'emp-sales-gaoyuan',
        'QH5101',
        'taskDelivered',
        'PJ-2026-018 某整车厂新平台卡钳定点 · 配套方案设计',
        60,
      );
      await project(
        'PJ-2026-018-T07',
        'emp-sales-gaoyuan',
        'QH5101',
        'taskDelivered',
        'PJ-2026-018 某整车厂新平台卡钳定点 · 方案评审与优化',
        20,
      );
      await project(
        'PJ-2026-018-T05',
        'emp-sales-linfeng',
        'QH5102',
        'taskDelayed',
        'PJ-2026-018 某整车厂新平台卡钳定点 · 报价测算',
        30,
      );
    }

    // New-hire retention (40 CNC hires of 成都机加工车间) is written by 202610080103_hr_demo_profile_retention.
  },
});
export default seed;
