import type { AppServerResource } from './en-US.js';
// V2-07
import { recruitingServerZh } from './modules/recruiting.js';
// V4-12
import { performanceServerZh } from './modules/performance.js';
// V4-13
import { talentReviewServerZh } from './modules/talent-review.js';
// V4-14
import { licensedServerZh } from './modules/licensed.js';

const zhCN: AppServerResource = {
  workbench: {
    title: '工作台',
    description: '集中处理审批、AI 准备事项与系统提醒。',
    today: '今天要处理',
    week: '本周',
    later: '稍后',
    completed: '已完成',
    source: '来源',
    all: '全部来源',
    approval: '审批',
    ai: 'AI 准备',
    rule: '系统提醒',
    open: '待处理',
    done: '已完成',
    dismissed: '已忽略',
    refresh: '刷新事项',
    go: '去处理',
    more: '更多操作：{{title}}',
    complete: '标记完成',
    dismiss: '忽略',
    cancel: '取消',
    close: '关闭',
    automatic: '由审批流程自动完成',
    emptyTitle: '暂无待办事项',
    emptyDescription: '业务流程产生的新事项会显示在这里。',
    noResults: '没有符合条件的事项',
    clear: '清除筛选',
    loading: '加载中',
    failed: '无法加载事项，请重试。',
    retry: '重试',
    forbidden: '无权访问工作台，请联系管理员。',
    signIn: '登录',
    saveFailed: '操作失败，请重试。',
    missing: '事项不存在或已不可访问，列表已刷新。',
    conflict: '事项状态已变化，请查看最新状态。',
    doneToast: '已完成“{{title}}”',
    dismissedToast: '已忽略“{{title}}”',
    dismissTitle: '忽略“{{title}}”？',
    dismissDescription: '该提醒将移入已完成，不会改变原业务状态。',
    previous: '上一页',
    next: '下一页',
    page: '第 {{page}} 页，共 {{total}} 条',
    noDue: '无期限',
    view: '查看',
    recipient: '发给我的事项',
    wait: '正在刷新或保存，请稍候',
  },
  aiAutomations: {
    settingsTitle: 'AI 员工任务',
  },
  // Permission set titles, for server-produced text such as the permissions a lapsed certificate withdraws.
  permissionSets: {
    hrAdmin: 'HR 管理员',
    hrManager: '业务主管',
    hrEmployee: '员工',
    hrInstructor: '讲师',
    cncOperator: '设备开工登记',
    // V3-11
    hrAuditor: '审计',
    hrIntegration: '质量系统集成账号',
    // V4-13
    ...talentReviewServerZh.permissionSets,
    // V4-14
    ...licensedServerZh.permissionSets,
  },
  notifications: {
    // V2-07 用工计划与招聘入职 (server/locales/modules/recruiting.ts).
    ...recruitingServerZh.notifications,
    // V4-12 绩效 (server/locales/modules/performance.ts).
    ...performanceServerZh.notifications,
    // V4-13 人才盘点与其他 (server/locales/modules/talent-review.ts).
    ...talentReviewServerZh.notifications,
    // V4-14 行业方案 · 持证上岗 (server/locales/modules/licensed.ts).
    ...licensedServerZh.notifications,
    // V3-11 画像、联动与内容维护 (profile/*.ts, revision-service.ts).
    trainingRecommendationPending: {
      title: '待确认的专项培训建议：{{department}}“{{competency}}”',
      body: '人才分析师根据反复出现的质量问题建议为{{department}}的 {{count}} 人安排专项培训，学习教练已配好内容，请在“待我决定”中确认或驳回。',
    },
    trainingRecommendationNeedsContent: {
      title: '专项培训建议需要讲师补充内容：{{department}}“{{competency}}”',
      body: '学习教练没有找到足够的课程、陪练或考试，请安排讲师补充后再由主管确认。',
    },
    recommendationAssigned: {
      title: '专项培训：{{competency}}',
      body: '主管为你安排了“{{competency}}”专项培训，请在 {{date}} 前完成。',
    },
    recommendationCompleted: {
      title: '专项培训已完成：{{department}}“{{competency}}”',
      body: '所有参加人都已完成，培训证明已生成。',
    },
    recommendationWritebackFailed: {
      title: '8D 回写失败：{{refs}}',
      body: '专项培训证明未能回写到质量管理系统，请在“业务数据”页重试。',
    },
    competencySuggestionDrafted: {
      title: '待确认的能力等级建议（{{count}} 条）',
      body: '人才分析师根据业务数据和考试结果提出了能力等级建议：{{list}}。请在“待我决定”中采纳或驳回。',
    },
    signalRuleDrafted: {
      title: '待确认的业务数据匹配规则（{{count}} 条）',
      body: '人才分析师为没有规则的分类起草了匹配规则：{{list}}。请在“业务数据 · 待匹配”中确认或修改。',
    },
    talentMonthlyReport: {
      title: '{{month}} 月度团队能力报告',
      body: '{{text}}',
    },
    talentMonthlyReportCompany: {
      title: '{{month}} 全公司能力报告',
      body: '{{text}}',
    },
    revisionReady: {
      title: '升版修订：{{title}} {{version}}',
      body: '内容编写员已起草变更要点课程和 {{count}} 条修订建议，预计 {{people}} 人需要参加差异培训。',
    },
    revisionAssigned: {
      title: '差异培训：{{title}}',
      body: '作业文件已升版，请在 {{date}} 前完成“{{title}}”。',
    },
    questionQualityFound: {
      title: '题目质量月检：{{count}} 道题目待改写',
      body: '内容编写员发现作答正确率异常的题目，已起草改写建议，请在“修订建议 · 题目质量”中处理。',
    },
    // V3-11 end
    hrImportCheck: {
      title: '导入数据体检：需处理 {{mustFix}} 项，建议处理 {{suggested}} 项',
      body: '{{report}}',
    },
    hrProbationPrep: {
      title: '转正准备：{{name}} 的试用期将于 {{date}} 结束',
      body: '{{text}}',
    },
    hrChangeChecklist: {
      title: '变动影响清单：{{name}}，{{count}} 项待处理',
      body: '人事助理已列出这次变动牵动的事项，请逐项确认。',
    },
    hrChangeChecklistOverdue: {
      title: '变动影响清单逾期：{{name}} 还有 {{count}} 项未处理',
      body: '清单已过处理期限，请尽快确认剩余事项。',
    },
    hrCompliance: {
      title: '用工合规提示：{{name}}',
      body: '{{text}}',
    },
    hrRenewalPrep: {
      title: '续签准备：{{name}} 的合同 {{contractNo}} 将于 {{date}} 到期',
      body: '{{text}}',
    },
    hrAttachmentExtracted: {
      title: '人事助理识别了附件',
      body: '已生成 {{fields}} 个待审核的字段，请在“待审核信息修改”中确认。档案本身未改动。',
    },
    hrSyncExplained: {
      title: '人事助理说明了 {{count}} 项同步待处理',
      body: '按类型：{{types}}；起草职务映射 {{drafts}} 条，请到“组织同步 · 待处理”查看。',
    },
    orgSyncFailed: {
      title: '组织同步失败',
      body: '原因：{{reason}}。请检查数据源后重新同步。',
    },
    orgSyncOnboarded: {
      title: '同步新建了员工 {{name}}',
      body: '请补齐 {{name}} 的档案与劳动合同。',
    },
    orgSyncOffboarded: {
      title: '同步将 {{name}} 改为离职',
      body: '{{name}} 在办公软件中已停用；生效中的合同未自动终止，请在合同管理中处理。',
    },
    orgSyncMoved: {
      title: '{{name}} 的任职已随同步变化',
      body: '办公软件中的{{type}}已写入 NocoHR。',
    },
    documentConflictFound: {
      title: '《{{title}}》与《{{other}}》有 {{count}} 处说法不一致',
      body: '知识助手发现两份文件对同一事项说法不同，请核对后处理；它不判断哪份正确。',
    },
    schedulePublished: {
      title: '你 {{from}} 至 {{to}} 的排班已发布',
      body: '共 {{count}} 天，在“我的档案 · 考勤与假期”查看班次。',
    },
    scheduleChanged: {
      title: '你 {{from}} 至 {{to}} 的排班有变更',
      body: '已发布的 {{count}} 天有变化，在“我的档案 · 考勤与假期”查看。',
    },
    scheduleLeaveConflict: {
      title: '{{name}} 的请假与 {{date}} 的排班冲突',
      body: '该班次已标为不能上岗。人事助理会推荐顶班人选，由你选择后保存排班。',
    },
    replacementSuggested: {
      title: '{{name}} {{date}} 的顶班推荐',
      body: '推荐 {{candidates}}。排班在你保存之前不会改变。',
    },
    replacementNone: {
      title: '{{name}} {{date}} 没有找到合适的顶班人选',
      body: '本部门没有满足规则的人员，建议跨部门协调。',
    },
    scheduleTransferBlocked: {
      title: '{{name}} 调岗后原排班不再适用',
      body: '{{from}} 至 {{to}} 的 {{count}} 个班次因“班次不适用于所在部门”被阻止，请重新排班。',
    },
    scheduleOffboardCleared: {
      title: '{{name}} {{date}} 之后的排班已清除',
      body: '离职日之后的 {{count}} 个班次已清除，请确认是否需要安排顶班。',
    },
    adjustmentPending: {
      title: '{{name}} 提交了 {{date}} 的考勤申请',
      body: '请在“审批”中处理。',
    },
    shiftSwapConsent: {
      title: '{{name}} 想和你调换 {{date}} 的班次',
      body: '请在“我的档案 · 考勤与假期”中同意或拒绝；你同意后再由主管审批。',
    },
    adjustmentApproved: {
      title: '你 {{date}} 的考勤申请已批准',
      body: '当天考勤已重新计算。',
    },
    adjustmentRejected: {
      title: '你 {{date}} 的考勤申请未通过',
      body: '在“我的档案 · 考勤与假期”查看审批意见。',
    },
    attendanceSummaryReady: {
      title: '{{month}} 考勤汇总待确认',
      body: '请在 {{days}} 天内确认或提出异议。',
    },
    attendanceObjection: {
      title: '{{name}} 对 {{month}} 考勤汇总提出异议',
      body: '请处理异议后再锁定当月汇总。',
    },
    attendanceObjectionHandled: {
      title: '你对 {{month}} 考勤汇总的异议已处理',
      body: '{{result}}',
    },
    attendanceMissingSelf: {
      title: '你已连续 {{days}} 天缺卡',
      body: '{{from}} 至 {{to}}。如当天正常出勤，请提交补卡申请。',
    },
    attendanceMissingHead: {
      title: '{{name}} 已连续 {{days}} 天缺卡',
      body: '{{from}} 至 {{to}}。{{name}} 没有账号，请跟进。',
    },
    attendanceOvertimeNear: {
      title: '{{name}} 本月加班接近预警线',
      body: '已批准加班 {{hours}} 小时，预警线 {{alert}} 小时。',
    },
    attendanceMonthCheck: {
      title: '{{month}} 考勤锁定前待处理事项',
      body: '{{list}}',
    },
    attendanceMonthCheckClean: {
      title: '{{month}} 考勤没有待处理事项',
      body: '汇总均已确认，也没有未审批的申请。',
    },
    // V2-05 (realigned): leave approvals, 考勤异常追问, 顶班邀请.
    leavePending: {
      title: '{{name}} 提交了{{leaveType}}申请',
      body: '{{from}} 至 {{to}}，共 {{duration}}。请在“审批”中处理。',
      body_day: '{{from}} 至 {{to}}，共 {{duration}} 天。请在“审批”中处理。',
      body_hour: '{{from}} 至 {{to}}，共 {{duration}} 小时。请在“审批”中处理。',
    },
    leaveApproved: {
      title: '你的{{leaveType}}申请已批准',
      body: '{{from}} 至 {{to}}。',
    },
    leaveRejected: {
      title: '你的{{leaveType}}申请未通过',
      body: '在“我的档案 · 考勤与假期”查看审批意见。',
    },
    attendanceInquiryHead: {
      title: '{{name}} 的考勤异常需要跟进',
      body: '{{detail}}。{{name}} 没有账号或未绑定飞书，人事助理无法直接询问，请跟进。',
    },
    attendanceInquiryOverdue: {
      title: '{{name}} 的考勤异常 {{days}} 天未回复',
      body: '{{detail}}。如当天正常出勤，请提交补卡或考勤异常说明。',
    },
    replacementAccepted: {
      title: '{{name}} 接受了 {{date}} 的顶班邀请',
      body: '已放入排班草稿，请在排班页确认后发布；发布时照常校验。',
    },
    documentReviewDue: {
      title: '《{{title}}》将于 {{date}} 到复核日期',
      body: '请复核文件内容，确认无需修改后点“标记已复核”，或上传新版本。',
    },
    documentReviewOverdue: {
      title: '《{{title}}》已过复核日期（{{date}}）',
      body: '文件已逾期未复核，请尽快复核或上传新版本。',
    },
    hrImportCheckClean: {
      title: '导入数据体检',
      body: '{{report}}',
    },
    automationPositionDrafted: {
      title: '体系顾问起草了新岗位的能力模型',
      body: '岗位「{{position}}」：{{requirements}} 条岗位要求草稿（新建能力项 {{competencies}} 个），请审核。',
    },
    automationDictionaryReview: {
      title: '能力词典月检建议',
      body: '建议合并 {{merge}} 组、停用 {{deactivate}} 项、改写 {{rewrite}} 条等级描述，岗位体系建议 {{positions}} 条，详见运行记录。',
    },
    automationGapReport: {
      title: '知识缺口周报',
      body: '{{questions}} 个未能回答的问题归并为 {{topics}} 个主题：{{list}}',
    },
    automationCourseDrafted: {
      title: '内容编写员生成了课程草稿',
      body: '根据《{{document}}》生成了《{{course}}》，请核对原文后确认发布。',
    },
    automationQuestionsDrafted: {
      title: '内容编写员补充了题目草稿',
      body: '为《{{course}}》补充了 {{count}} 道题目草稿，请审核。',
    },
    automationRecertEscalation: {
      title: '复审升级提醒',
      body: '{{text}}',
    },
    automationRemedialAssigned: {
      title: '已为你安排补学',
      body: '《{{certification}}》复审未通过，已安排补学：{{courses}}。薄弱能力项：{{weak}}。',
    },
    automationRemedialAssignedManager: {
      title: '复审未通过，已安排补学',
      body: '{{name}}的《{{certification}}》复审次数已用尽，已安排补学：{{courses}}；薄弱能力项：{{weak}}。补学完成后可由讲师重置考试次数。',
    },
    pathAssigned: {
      title: '新的学习路径：{{title}}',
      body: '你被指派了学习路径《{{title}}》，请在 {{date}} 前按顺序完成各步。',
    },
    pathStepUnlocked: {
      title: '学习路径的下一步已解锁',
      body: '《{{path}}》的下一步“{{title}}”已解锁，可以开始了。',
    },
    pathCompleted: {
      title: '学习路径已完成',
      body: '你已完成学习路径《{{title}}》的全部必修步骤。',
    },
    sessionCancelled: {
      title: '线下班次已取消',
      body: '你报名的“{{title}}”已取消，请在“我的学习”中重新报名其他班次。',
    },
    sessionAbsent: {
      title: '线下培训缺勤',
      body: '{{name}}报名了“{{title}}”但没有签到，已记为缺勤，对应的学习任务仍未完成。',
    },
    sessionReminder: {
      title: '明天有线下培训',
      body: '“{{title}}”将于 {{time}} 在 {{location}} 开始，请准时到场扫码签到。',
    },
    // V3-09
    pathAutoAssignedHead: {
      title: '已自动指派上岗路径：{{name}}',
      body: '{{name}}岗位变动后已自动获得学习路径《{{title}}》，截止 {{date}}。',
    },
    learningContentMissing: {
      title: '需要补充课程：{{competencies}}',
      body: '学习教练起草目标岗位学习计划时，以下能力项没有可指派的已发布课程：{{competencies}}。请补充课程。',
    },
    learningPlanMerged: {
      title: '学习计划新增内容：{{name}}',
      body: '学习教练在{{name}}待确认的学习计划中新增了 {{count}} 项，请一并确认或驳回。',
    },
    learningPlanDrafted: {
      title: '待确认的学习计划：{{name}}',
      body: '学习教练为{{name}}起草了一份学习计划（{{count}} 项），请确认或驳回。',
    },
    learningPlanApproved: {
      title: '你有新的学习任务',
      body: '{{name}}确认了为你制定的学习计划，已生成 {{count}} 项学习任务。',
    },
    learningNudge: {
      title: '学习提醒',
      body: '{{message}}',
    },
    learningLagManager: {
      title: '团队学习进度落后',
      body: '以下 {{count}} 项学习任务多次提醒后仍明显落后：{{names}}。',
    },
    practiceRecommended: {
      title: '考前陪练推荐',
      body: '考《{{exam}}》前，建议先做一次陪练“{{title}}”，把关键规程说一遍。可以在“我的学习 · 推荐”里开始，也可以忽略。',
    },
    automationScenarioDrafted: {
      title: '陪练教练起草了陪练场景',
      body: '课程《{{course}}》发布后，陪练教练起草了陪练场景“{{title}}”，请审核后确认。',
    },
    examGradingNeeded: {
      title: '有答卷待阅卷',
      body: '{{name}} 提交了《{{title}}》。',
    },
    examPassed: {
      title: '考试已通过',
      body: '你以 {{score}} 分通过了《{{title}}》。',
    },
    examFailed: {
      title: '考试未通过',
      body: '你在《{{title}}》中得 {{score}} 分，未通过。',
    },
    certificateIssued: {
      title: '获得证书',
      body: '{{name}} 获得《{{title}}》证书（{{no}}），有效期至 {{date}}。',
    },
    certificateRenewed: {
      title: '证书已换发',
      body: '{{name}} 的《{{title}}》已换发（{{no}}），有效期至 {{date}}。',
    },
    certificateRevoked: {
      title: '证书已吊销',
      body: '《{{title}}》已被吊销：{{reason}}。已收回权限：{{sets}}。',
    },
    certificateExpiring: {
      title: '证书即将到期',
      body: '{{name}} 的《{{title}}》将于 {{date}} 到期。',
    },
    certificateExpired: {
      title: '证书已过期',
      body: '{{name}} 的《{{title}}》已于 {{date}} 过期。已收回权限：{{sets}}。',
    },
    // V3-10 考试与认证
    examGradingNeededAi: {
      title: '有答卷待阅卷（已有 AI 建议分）',
      body: '{{name}} 提交了《{{title}}》，考官已给出简答题建议分，请确认后定分。',
    },
    certificateExpiredNotice: {
      title: '证书已过期',
      body: '{{name}} 的《{{title}}》已于 {{date}} 过期。到期后不再计入有效持证，岗位要求的资质显示为缺失。',
    },
    certificateExpiredWithSets: {
      title: '证书已过期',
      body: '{{name}} 的《{{title}}》已于 {{date}} 过期。到期后不再计入有效持证，岗位要求的资质显示为缺失。已收回权限：{{sets}}。',
    },
    certificateRevokedNotice: {
      title: '证书已吊销',
      body: '《{{title}}》已被吊销：{{reason}}。吊销后不再计入有效持证。',
    },
    externalCertificateExpiring: {
      title: '外部证书即将到期',
      body: '你的《{{title}}》将于 {{date}} 到期，请及时复审换证后重新登记。',
    },
    externalCertificateVerified: {
      title: '外部证书已核验',
      body: '你登记的《{{title}}》已通过核验，计入有效持证。',
    },
    externalCertificateRejected: {
      title: '外部证书未通过核验',
      body: '你登记的《{{title}}》未通过核验：{{note}}。请修改后重新提交。',
    },
    examFailedSelfStudy: {
      title: '考试失分分析',
      body: '《{{title}}》未通过。失分较多的能力项：{{weak}}。可以先自学：{{content}}。',
    },
    qualificationDossierReady: {
      title: '{{name}}具备{{position}}任职资格',
      body: '认证管家已整理好任职准备材料，附预填的晋升单入口。是否任职由你决定，系统不会自动发起异动。',
    },
    recertificationAssigned: {
      title: '请参加复训',
      body: '《{{title}}》将于 {{date}} 到期，请在「我的考试」中完成复训。',
    },
    certificationReminder: {
      title: '认证提醒',
      body: '{{note}}',
    },
    weeklyBrief: {
      title: '本周持证简报',
      body: '{{brief}}',
    },
    assignmentCreated: {
      title: '新的学习任务',
      body: '《{{title}}》· 截止 {{date}}',
    },
    assignmentReminder: {
      title: '学习任务催办',
      body: '请在 {{date}} 前完成《{{title}}》。',
    },
    assignmentOverdue: {
      title: '学习任务已逾期',
      body: '{{name}}：《{{title}}》已于 {{date}} 到期。',
    },
    assignmentDueSoon: {
      title: '学习任务即将到期',
      body: '《{{title}}》将于 {{date}} 到期。',
    },
    actionTypes: {
      onboard: '入职',
      regularize: '转正',
      transfer: '调岗',
      promote: '晋升',
      offboard: '离职',
    },
    actionPending: {
      title: '有一张人事异动单待你审批',
      body: '{{type}}：{{name}}',
    },
    actionRejected: {
      title: '你发起的人事异动单被驳回',
      body: '{{type}}：{{name}}。意见：{{comment}}',
    },
    actionEffective: {
      title: '人事异动已生效',
      body: '{{type}}：{{name}}',
    },
    actionCancelled: {
      title: '人事异动单已撤回',
      body: '{{type}}：{{name}}',
    },
    profileChangePending: {
      title: '有一条信息修改申请待审核',
      body: '申请人：{{name}}',
    },
    profileChangeApproved: {
      title: '你的信息修改申请已通过',
      body: '档案已更新。{{comment}}',
    },
    profileChangeRejected: {
      title: '你的信息修改申请未通过',
      body: '意见：{{comment}}',
    },
    probationEnding: {
      title: '试用期即将到期',
      body: '{{name}} 的试用期将于 {{date}} 到期。',
    },
    contractEnding: {
      title: '劳动合同即将到期',
      body: '合同 {{contractNo}} 将于 {{date}} 到期（{{days}} 天内）。',
    },
    contractExpired: {
      title: '劳动合同已到期',
      body: '合同 {{contractNo}} 已于 {{date}} 到期，已标记为已到期。',
    },
    // V2-06 薪酬与社保：通知中不出现金额。
    payrollOnboard: {
      title: '{{name}} 待建薪资档案',
      body: '{{date}} 入职：请建立薪资档案，并确认增员记录。',
    },
    payrollOffboard: {
      title: '{{name}} 将于 {{date}} 离职',
      body: '最后一个月按在职天数结算；请确认减员（停保）。',
    },
    payrollTransfer: {
      title: '{{type}}：请核对{{name}}的薪资结构',
      body: '{{date}} 生效，适用薪资结构可能变化；需要时发起调薪。',
    },
    payrollAdjustmentPending: {
      title: '有一张调薪申请待您审批',
      body: '{{name}}，{{month}} 起生效',
    },
    payrollAdjustmentApproved: {
      title: '调薪申请已批准',
      body: '{{name}}，{{month}} 起生效',
    },
    payrollAdjustmentRejected: {
      title: '调薪申请被驳回',
      body: '{{name}}，{{month}} 起生效',
    },
    payrollCyclePending: {
      title: '{{month}} 工资表待您审批',
      body: '请查看工资表后批准或驳回。',
    },
    payrollCycleApproved: {
      title: '{{month}} 工资表已批准',
      body: '工资表已锁定，可以发布工资条。',
    },
    payrollCycleRejected: {
      title: '{{month}} 工资表被驳回',
      body: '请查看审批意见，修正后重新提交。',
    },
    payrollAnomalies: {
      title: '{{month}} 算薪检查：{{count}} 条异常',
      body: '新增：{{added}}。已消除：{{removed}}。',
    },
    payrollAnomaliesClean: {
      title: '{{month}} 算薪检查：未发现异常',
      body: '已消除：{{removed}}。',
    },
    payslipPublished: {
      title: '您 {{month}} 的工资条已发布',
      body: '请在工资条页验证身份后查看。',
    },
    payrollInsuranceMonthly: {
      title: '{{month}} 增减员清单',
      body: '增员 {{started}} 人，减员 {{stopped}} 人，待确认 {{pending}} 条。',
    },
    payrollBaseAdjust: {
      title: '{{year}} 年度社保基数调整建议',
      body: '共 {{count}} 条建议，请核对后确认。',
    },
    payrollVendorBillReviewed: {
      title: '{{vendor}} {{month}} 账单已核对',
      body: '{{diffPeople}} 人工时有差异，合计 {{diffHours}} 小时。',
    },
    payrollVendorBillUploaded: {
      title: '{{vendor}} {{month}} 账单已上传',
      body: '{{diffPeople}} 人工时有差异，合计 {{diffHours}} 小时。',
    },
    // V2-06 邮件往来 (server/providers/hr/mail/)
    mailUnmatched: {
      title: '业务邮箱有一封来信待归类',
      body: '{{from}}：{{subject}}',
    },
    mailReplyReceived: {
      title: '{{vendor}} 回信',
      body: '{{subject}}',
    },
    mailDraftReady: {
      title: '{{vendor}} {{month}} 账单的回复已起草',
      body: '请核对后发送。',
    },
    // V3-11 审核邮箱 (server/providers/hr/mail/audit.ts): never the risks or a person's data in the text.
    mailAuditRequest: {
      title: '{{customer}} 发来审核资料请求',
      body: '期限 {{due}}；审核前有 {{risks}} 条风险待处理。请确认范围后生成审核包。',
    },
    mailAuditDraftReady: {
      title: '{{customer}} 审核请求的回复已起草',
      body: '请核对后发送；分享链接在发送时生成。',
    },
    // V2-07 招聘邮箱 (server/providers/hr/mail/recruiting.ts)
    mailResumeReceived: {
      title: '招聘邮箱收到一份简历',
      body: '{{name}} 已投递到「{{position}}」并开始初筛。',
    },
    mailCandidateReplied: {
      title: '候选人回信',
      body: '{{name}}{{intent}}，回复已起草，请确认后发送。',
    },
  },
  // V1-04 办公软件机器人与飞书卡片 (server/providers/hr/im-channel.ts, im-cards/)
  imBot: {
    textOnly: '目前只能回答文字消息，请直接用文字提问。',
    working: '正在处理，卡片稍后会更新。',
    payLinkOnly: '请在 NocoHR 工资条页验证身份后查看：{{link}}',
    groupOnly: '请私聊提问，避免在群里发出个人信息。',
    unbound:
      '暂时无法识别你的身份：请先用飞书登录一次 NocoHR，或联系 HR 开通账号。',
    confirmInApp: '这一步需要你在 NocoHR 中确认后才能继续。',
    noAnswer: '现有资料中没有找到相关内容，建议联系 HR。',
    viewInApp: '在 NocoHR 中查看：{{link}}',
    unavailable: 'AI 助手暂时不可用，请稍后再试，或在 NocoHR 中查看。',
    cardSent: '我已把修改内容整理成卡片，请核对变更前后后点击“提交”。',
    fieldNotAllowed:
      '其中有不能自助修改的信息，请联系 HR，或在 NocoHR 中提交。',
  },
  imCards: {
    openInApp: '在 NocoHR 中查看',
    unknown: { title: '卡片' },
    state: {
      handled: '已处理',
      unavailable: '已失效',
    },
    result: {
      duplicate: '这次操作已收到。',
      notFound: '这张卡片已失效。',
      notRecipient: '这张卡片不是发给你的。',
      alreadyHandled: '单据已处理。',
      failed: '操作没有成功（{{code}}），请在 NocoHR 中处理。',
    },
    approval: {
      title: '{{type}}审批',
      effectiveDate: '生效日期 {{date}}',
      applicant: '申请人 {{name}} · 第 {{level}} 级审批',
      approve: '同意',
      reject: '驳回',
      approved: '已同意',
      rejected: '已驳回',
      approvedDone: '已同意，单据已流转到下一步。',
      rejectedDone: '已驳回，已通知申请人。',
      commentRequired: '驳回须填写意见。',
      notApprover: '你不是这张单据的当前审批人，无权审批。',
      selfApproval: '不能审批与本人有关的单据。',
      status: {
        draft: '草稿',
        pending: '待下一级审批',
        approved: '已批准，待生效',
        effective: '已生效',
        rejected: '已驳回',
        cancelled: '已撤回',
      },
    },
    profileChange: {
      title: '信息修改申请',
      submit: '提交',
      discard: '放弃',
      editInApp: '修改后在 NocoHR 提交',
      submitted: '已提交，等待 HR 审核。',
      discarded: '已放弃。',
      pending: '你已有一份待 HR 审核的申请，处理完后再提交。',
      forbidden: '你没有提交信息修改的权限。',
      empty: '（空）',
      items: '{{count}} 条',
      fields: {
        mobile: '手机号',
        email: '邮箱',
        address: '住址',
        emergencyContacts: '紧急联系人',
        educations: '教育经历',
        experiences: '工作经历',
      },
    },
  },
  // V2-05 (realigned) 考勤与假期的飞书卡片与追问 (server/providers/hr/attendance-cards.ts)
  attendanceCards: {
    submit: '提交',
    discard: '放弃',
    editInApp: '在 NocoHR 中修改',
    customField: '{{zh}}：{{value}}',
    yes: '是',
    no: '否',
    customFieldsRequired: '还有必填项未填写，请在 NocoHR 中补充后提交。',
    units: { day: '天', halfDay: '天', hour: '小时' },
    types: {
      missingPunch: '补卡',
      overtime: '加班',
      shiftSwap: '调班',
      exception: '考勤异常说明',
    },
    anomalies: { late: '迟到', earlyLeave: '早退', missingPunch: '缺卡' },
    sides: { in: '上班', out: '下班' },
    leaveSubmit: {
      title: '请假单（人事助理起草）',
      line: '{{leaveType}} · {{from}} 至 {{to}} · {{duration}} {{unit}}',
      reason: '事由：{{reason}}',
      conflict: '与已发布排班冲突：{{date}} {{shift}}（{{time}}）',
      attachment: '此类假期须附证明，请在 NocoHR 中上传后提交。',
      submitted: '已提交，等待审批。',
      discarded: '已放弃。草稿仍在“我的申请”中，可修改后提交。',
      attachmentRequired: '须先上传证明材料，请在 NocoHR 中提交。',
    },
    adjustmentSubmit: {
      title: '考勤申请（人事助理起草）',
      missingPunch: '补卡 · {{date}} {{shift}} · {{side}} {{time}}',
      exception: '考勤异常说明 · {{date}} {{anomaly}} {{minutes}} 分钟',
      reason: '事由：{{reason}}',
      policy: '依据：{{citation}}',
      submitted: '已提交 {{count}} 张申请，等待审批。',
      partial:
        '已提交 {{done}} 张，{{failed}} 张未能提交（{{code}}），请在 NocoHR 中处理。',
      limit: '本月补卡次数已达上限（{{limit}} 次），请联系主管。',
      discarded: '已放弃这些草稿。',
    },
    approval: {
      leaveTitle: '请假审批',
      title: '{{type}}审批',
      consentTitle: '调班同意',
      leaveLine:
        '{{name}} · {{leaveType}} · {{from}} 至 {{to}} · {{duration}} {{unit}}',
      line: '{{name}} · {{type}} · {{date}}',
      level: '第 {{level}} 级审批',
      reason: '事由：{{reason}}',
      agree: '同意',
      disagree: '不同意',
      status: {
        pending: '待下一级审批',
        approved: '已批准',
        rejected: '已驳回',
        cancelled: '已撤回',
      },
    },
    invite: {
      title: '顶班邀请',
      line: '{{date}} {{shift}}（{{time}}）',
      from: '{{department}} · 由 {{inviter}} 发起',
      accept: '接受',
      decline: '不方便',
      accepted: '已接受，排班人确认发布后生效。',
      declined: '已回复不方便，谢谢。',
      expired: '邀请已失效（已有同事接受，或排班已调整）。',
      notEligible: '你当天已不满足顶班条件，邀请无法接受。',
      state: {
        accepted: '已接受',
        declined: '已回复不方便',
        expired: '已失效',
      },
    },
    inquiry: {
      missingOut: '你 {{dates}} {{shift}}下班都没有打卡记录，是忘了打卡吗？',
      missingOutOne: '你 {{dates}} {{shift}}下班没有打卡记录，是忘了打卡吗？',
      missingIn: '你 {{dates}} {{shift}}上班都没有打卡记录，是忘了打卡吗？',
      missingInOne: '你 {{dates}} {{shift}}上班没有打卡记录，是忘了打卡吗？',
      late: '你 {{dates}} 上班晚了 {{minutes}} 分钟，需要说明吗？',
      earlyLeave:
        '你 {{dates}} {{shift}}提前 {{minutes}} 分钟下班，需要说明吗？',
      day: '{{day}} 日',
      detailMissing: '{{dates}} 缺卡',
      detailLate: '{{dates}} 迟到 {{minutes}} 分钟',
      detailEarly: '{{dates}} 早退 {{minutes}} 分钟',
      draftedMissing:
        '好的，我按班次时间起草了 {{count}} 张补卡单，请在卡片上核对后点“提交”。',
      draftedException:
        '按《{{title}}》“{{clause}}”，这种情况可以说明。我起草了考勤异常说明，请在卡片上核对后点“提交”。',
      draftedExceptionPlain:
        '我起草了考勤异常说明，请在卡片上核对后点“提交”。是否批准由主管决定。',
      suggestLeave:
        '如果当天需要请假，请在 NocoHR 中提交请假申请；补卡和说明须如实填写，由你决定是否提交。',
      thanks:
        '收到。如需补卡或说明，可以在 NocoHR 的“我的档案 · 考勤与假期”中提交。',
      missingReason: '忘记打卡，当天正常出勤',
    },
    bot: {
      leaveCard: '我已起草请假单，请在卡片上核对后点“提交”。',
      adjustmentCard: '我已起草考勤申请，请在卡片上核对后点“提交”。',
    },
  },
  // V3-08 能力体系
  competency: {
    assessmentTodo: {
      title: '为{{name}}评定能力',
      summary: '尚未评定的必备能力项（{{count}} 项）：{{competencies}}',
    },
  },
  // V2-07
  // Permission set titles the recruiting and payroll seeds store (recruiting.* / payroll.* keys).
  recruiting: {
    ...recruitingServerZh.top,
    permissionSets: {
      hrRecruiter: '招聘专员',
      hrIntegrationErp: 'ERP 集成（排产计划）',
    },
  },
  payroll: {
    permissionSets: {
      hrPayroll: '薪酬专员',
      hrPayrollApprover: '薪酬审批',
    },
  },
};

export default zhCN;
