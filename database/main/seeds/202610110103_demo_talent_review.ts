import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

/**
 * V4-13 测试数据 (演示案例 · V4 数据), development and demo only
 * (`NODE_ENV=production`, `HR_DEMO_SEED=false` or `HR_TALENT_REVIEW_DEMO=false`
 * skips it). Every part checks the rows it builds on and is keyed on fixed
 * ids, so it never fails when other demo seeds are off and never runs twice.
 *
 * Earlier steps' scenes are not pre-run or changed: no review cycle, result,
 * certificate, assessment, payroll cycle or business signal is written, and
 * no existing person is changed.
 *
 * - hr01 owns the ten automations of this step.
 * - “<year> 苏州工厂人才盘点” (draft, 苏州工厂, owner hr01) on the V4-12
 *   “<year> 年度考核” when that cycle exists; it can enter preparing once the
 *   V4-12 walkthrough has published the cycle.
 * - 车间主任 stays isKey = false (hr01 marks it in the walkthrough).
 * - CNC 操作工: version 1 is the current requirements (the required seed
 *   202610110102); a draft version raises 质量记录规范 from 2 to 3.
 * - 实操考核表 “CNC 首件检验实操考评” (8 items, 3 critical: 安全防护, 首件测量,
 *   记录完整; WI-MC-0231; a witness required), confirmed, trainer01's.
 *   hr.practicalAssessor is assigned to trainer01. The link to 认证 “CNC 岗位
 *   上岗证” (practicalRequiredFor = recert) is NOT seeded: it would change
 *   the V3-10 recertification walkthrough of 钱进, which runs first; hr01
 *   sets it on the certification in the 13B walkthrough.
 * - 讲师: 郑老师 (trainer01, internal, senior) and 机床厂家应用工程师
 *   (external), who taught a past offline session of 《CNC 首件检验实操培训》
 *   (instructorProfileId set; the organizer trainer01 stays in the required
 *   instructorUserId).
 * - integration_ticket (no password: it cannot sign in) holds only
 *   hr.ticketIntegration; its API key is issued at runtime, never here.
 * - 知识候选: three resolved tickets on “CNC 报警 E17 后如何复位” and one
 *   featured forum post saying no first-article inspection is needed within
 *   15 minutes of a stop (it conflicts with WI-MC-0231 V4.1 once the V3-11
 *   walkthrough has uploaded V4.1).
 * - 外部客户端: “公司 Claude 工作区”, active, every tool.
 * - The glossary (首件检验, 作业指导书, 质量问题, 上岗证) is the settings default.
 */
const AUTOMATIONS = [
  'talentAnalyst.prePlacement',
  'talentAnalyst.successorRecommend',
  'talentAnalyst.successionRisk',
  'talentAnalyst.trainingEffectReport',
  'frameworkAdvisor.versionChangeNote',
  'examiner.structureObservation',
  'examiner.draftPracticalChecklist',
  'knowledgeAssistant.knowledgeDistill',
  'contentWriter.translationDraft',
  'learningCoach.talentReviewPlans',
];
const TOOLS = [
  'askKnowledge',
  'getMyLearning',
  'getMyCertificates',
  'getMySchedule',
  'getMyLeaveBalance',
  'draftMyLeaveRequest',
  'getTeamCertificationSummary',
  'getTeamLearningProgress',
  'listMyPendingDecisions',
  'searchEmployees',
];
const CHECKLIST = [
  { key: 'safety', item: '安全防护：穿戴劳保用品，不戴手套和首饰，防护门关闭后开机', critical: true, sourceExcerpt: '上岗前按《安全与 5S 管理规定》（SAF-0105）穿戴劳保用品；操作旋转设备时禁止戴手套和首饰。' },
  { key: 'stopTime', item: '停机时长判断：确认停机时长并判断是否须做首件', critical: false, sourceExcerpt: '设备停机超过 10 分钟，重新开机须做首件检验，合格后才能批量加工。' },
  { key: 'gauge', item: '量具确认：检具、量具在校准有效期内', critical: false, sourceExcerpt: null },
  { key: 'measure', item: '首件测量：按检验卡逐项测量孔径、位置度、端面跳动', critical: true, sourceExcerpt: '首件检验按检验卡逐项测量关键尺寸（孔径、位置度、端面跳动），用三坐标或专用检具，结果全部合格才能批量加工。' },
  { key: 'judge', item: '结果判定：首件合格后才批量加工，不合格停机调整', critical: false, sourceExcerpt: null },
  { key: 'record', item: '记录完整：首件结果记入首件检验记录表并由班组长签字', critical: true, sourceExcerpt: '首件结果须记入首件检验记录表并由班组长签字。' },
  { key: 'report', item: '异常报告：尺寸接近公差限时停机报告班组长', critical: false, sourceExcerpt: '发现尺寸接近公差上下限时，立即停机报告班组长，不得自行修改程序补偿值。' },
  { key: 'fiveS', item: '5S：结束后清理铁屑，工具定置摆放', critical: false, sourceExcerpt: null },
];

const seed: SeedDefinition = defineSeed({
  name: '202610110103_demo_talent_review',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_TALENT_REVIEW_DEMO === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = now.toISOString().slice(0, 10);
    const exists = async (table: string, id: string) =>
      Boolean(
        await query.selectFrom(table).select('id').where('id', '=', id).executeTakeFirst(),
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
        .values({ id: randomUUID(), permissionSetKey, subjectType: 'user', subjectId: userId, ...stamp })
        .execute();
    };
    const hr = await userOf('hr01');
    const trainer = await userOf('trainer01');

    // ---- Automations of this step are owned by hr01 ----
    if (hr)
      for (const id of AUTOMATIONS) {
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

    // ---- 2026 苏州工厂人才盘点 (draft) ----
    if (hr && (await exists('departments', 'sz')) && !(await exists('talentReviews', 'tr-demo-sz'))) {
      const cycle = (await exists('reviewCycles', 'perf-cycle-annual')) ? 'perf-cycle-annual' : null;
      await query
        .insertInto('talentReviews')
        .values({
          id: 'tr-demo-sz',
          title: `${today.slice(0, 4)} 苏州工厂人才盘点`,
          scope: { departmentIds: ['sz'] },
          reviewCycleId: cycle,
          status: 'draft',
          ownerUserId: hr,
          stageLog: [],
          ...stamp,
        })
        .execute();
    }

    // ---- CNC 操作工: a draft version raising 质量记录规范 from 2 to 3 ----
    if (await exists('positions', 'pos-cnc-operator')) {
      const versions = await query
        .selectFrom('competencyModelVersions')
        .select(['versionNo', 'status'])
        .where('positionId', '=', 'pos-cnc-operator')
        .execute();
      if (!versions.some((v) => v.status === 'draft')) {
        const current = await query
          .selectFrom('positionRequirements')
          .select(['competencyId', 'requiredLevel', 'mandatory'])
          .where('positionId', '=', 'pos-cnc-operator')
          .where('reviewStatus', '=', 'confirmed')
          .execute();
        if (current.some((r) => String(r.competencyId) === 'comp-quality-record')) {
          await query
            .insertInto('competencyModelVersions')
            .values({
              id: 'cmv-demo-cnc-draft',
              positionId: 'pos-cnc-operator',
              versionNo: Math.max(1, ...versions.map((v) => Number(v.versionNo))) + 1,
              snapshot: current
                .map((r) => ({
                  competencyId: String(r.competencyId),
                  requiredLevel:
                    String(r.competencyId) === 'comp-quality-record' ? 3 : Number(r.requiredLevel),
                  mandatory: r.mandatory === true || r.mandatory === 1,
                }))
                .sort((a, b) => a.competencyId.localeCompare(b.competencyId)),
              status: 'draft',
              effectiveFrom: null,
              changeNote: null,
              changeNoteSource: null,
              changeNoteHash: null,
              impactPreview: null,
              publishedBy: null,
              publishedAt: null,
              archivedAt: null,
              source: 'manual',
              createdBy: hr || null,
              ...stamp,
            })
            .execute();
        }
      }
    }

    // ---- 实操考核表 and the assessor permission set ----
    if (trainer && !(await exists('practicalAssessments', 'pa-demo-cnc-first-article'))) {
      await query
        .insertInto('practicalAssessments')
        .values({
          id: 'pa-demo-cnc-first-article',
          title: 'CNC 首件检验实操考评',
          competencyIds: (await exists('competencies', 'comp-cnc')) ? ['comp-cnc'] : [],
          checklist: CHECKLIST,
          passRule: { allCriticalPass: true, minPassRate: 80 },
          sourceDocumentId: (await exists('kbDocuments', 'doc-wi-mc-0231')) ? 'doc-wi-mc-0231' : null,
          requiresWitness: true,
          reviewStatus: 'confirmed',
          source: 'manual',
          active: true,
          ownerUserId: trainer,
          confirmedBy: trainer,
          confirmedAt: now,
          customFields: null,
          ...stamp,
        })
        .execute();
    }
    await assign('hr.practicalAssessor', trainer);

    // ---- 讲师 and the external instructor's session ----
    if (trainer && !(await exists('instructorProfiles', 'ip-demo-zheng')))
      await query
        .insertInto('instructorProfiles')
        .values({
          id: 'ip-demo-zheng',
          userId: trainer,
          name: '郑老师',
          type: 'internal',
          organization: null,
          competencyIds: ['comp-cnc', 'comp-safety'],
          level: 'senior',
          active: true,
          customFields: null,
          ...stamp,
        })
        .execute();
    if (!(await exists('instructorProfiles', 'ip-demo-vendor')))
      await query
        .insertInto('instructorProfiles')
        .values({
          id: 'ip-demo-vendor',
          userId: null,
          name: '机床厂家应用工程师',
          type: 'external',
          organization: '数控机床厂家（应用技术部）',
          competencyIds: ['comp-cnc'],
          level: 'expert',
          active: true,
          customFields: null,
          ...stamp,
        })
        .execute();
    if (
      (trainer || hr) &&
      (await exists('courses', 'course-first-article-practical')) &&
      !(await exists('trainingSessions', 'ts-demo-vendor'))
    ) {
      const start = new Date(`${today}T01:00:00Z`);
      start.setUTCDate(start.getUTCDate() - 40);
      await query
        .insertInto('trainingSessions')
        .values({
          id: 'ts-demo-vendor',
          courseId: 'course-first-article-practical',
          title: 'CNC 首件检验实操培训 · 厂家专场',
          // The organizer stays in instructorUserId (required); the external instructor is the profile.
          instructorUserId: trainer || hr,
          instructorProfileId: 'ip-demo-vendor',
          startAt: start,
          endAt: new Date(start.getTime() + 3 * 3_600_000),
          location: '苏州工厂培训室',
          capacity: 12,
          enrollDeadline: null,
          status: 'completed',
          ownerUserId: trainer || hr,
          ...stamp,
        })
        .execute();
    }

    // ---- integration_ticket: no password, only knowledgeCandidate.ingest ----
    let integration = await userOf('integration_ticket');
    if (!integration) {
      integration = randomUUID();
      await query
        .insertInto('user')
        .values({
          id: integration,
          name: '工单系统集成',
          username: 'integration_ticket',
          email: 'integration.ticket@demo.test',
          emailVerified: true,
          ...stamp,
        })
        .execute();
    }
    await assign('hr.ticketIntegration', integration);

    // ---- 知识候选 ----
    const candidates = [
      {
        id: 'kc-demo-tk-1101',
        sourceSystem: 'ticket',
        externalId: 'TK-2026-1101',
        title: 'CNC 报警 E17 后如何复位',
        content: '机加工 3 号机出现 E17 报警（主轴定位超时）。处理：按急停后复位，检查主轴编码器插头是否松动，重新上电后执行主轴回零，报警消除。',
      },
      {
        id: 'kc-demo-tk-1102',
        sourceSystem: 'ticket',
        externalId: 'TK-2026-1102',
        title: '5 号机 E17 报警复位不了',
        content: 'E17 报警按复位键无效。处理：断电 30 秒后重新上电，执行主轴回零；仍报警时检查主轴编码器插头并报设备维修。',
      },
      {
        id: 'kc-demo-tk-1103',
        sourceSystem: 'ticket',
        externalId: 'TK-2026-1103',
        title: 'E17 报警怎么处理',
        content: '夜班出现 E17 报警。处理：先按急停再复位，主轴回零后报警消除；复位后按作业指导书判断是否需要做首件。',
      },
      {
        id: 'kc-demo-fm-0088',
        sourceSystem: 'forum',
        externalId: 'FM-2026-0088',
        title: 'E17 报警复位后要不要做首件',
        content: '经验分享：E17 报警复位后，设备停机 15 分钟内不用做首件检验，直接继续批量加工即可。',
      },
    ];
    for (const c of candidates) {
      if (await exists('knowledgeCandidates', c.id)) continue;
      await query
        .insertInto('knowledgeCandidates')
        .values({
          ...c,
          link: `https://tickets.qiheng.example/${c.externalId}`,
          topic: null,
          status: 'new',
          draftDocumentId: null,
          ignoredBy: null,
          ...stamp,
        })
        .execute();
    }

    // ---- 外部客户端 ----
    if (hr && !(await exists('agentClients', 'ac-demo-claude')))
      await query
        .insertInto('agentClients')
        .values({
          id: 'ac-demo-claude',
          name: '公司 Claude 工作区',
          ownerUserId: hr,
          allowedTools: TOOLS,
          status: 'active',
          ...stamp,
        })
        .execute();
  },
});
export default seed;
