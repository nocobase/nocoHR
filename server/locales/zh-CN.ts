import type { AppServerResource } from './en-US.js';

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
    cncOperator: 'CNC 开工登记（演示）',
  },
  notifications: {
    hrImportCheck: {
      title: '导入数据体检：需处理 {{mustFix}} 项，建议处理 {{suggested}} 项',
      body: '{{report}}',
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
      body: '建议合并 {{merge}} 组、停用 {{deactivate}} 项、改写 {{rewrite}} 条等级描述，详见运行记录。',
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
  },
};

export default zhCN;
