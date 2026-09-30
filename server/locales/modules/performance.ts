/**
 * V4-12 绩效: the server-produced wording — in-app notices. No title or body
 * carries a rating, a score or a comment: the office suite receives the title
 * and a link only. Merged into server/locales/{en-US,zh-CN}.ts.
 */

const n = (title: string, body: string) => ({ title, body });

export const performanceServerEn = {
  notifications: {
    performanceGoalSetting: n(
      'Goal setting has started: {{cycle}}',
      'Draft and submit your goals in My review by {{deadline}}.',
    ),
    performanceGoalDrafts: n(
      'The performance assistant drafted goals for you: {{cycle}}',
      'Draft goals based on the department goals and your role are ready. Edit and submit them by {{deadline}}.',
    ),
    performanceGoalsSubmitted: n(
      'Goals to confirm: {{name}}',
      '{{name}} submitted their goals for {{cycle}}. Confirm or return them.',
    ),
    performanceGoalApproved: n(
      'Goal confirmed: {{goal}}',
      'Your manager confirmed the goal for {{cycle}}. Keep its progress up to date.',
    ),
    performanceGoalReturned: n(
      'Goal returned: {{goal}}',
      'Your manager returned the goal for {{cycle}}. Revise and submit it again.',
    ),
    performanceSelfReview: n(
      'Complete your self review: {{cycle}}',
      'Due {{deadline}}. Your evidence snapshot is on the self review page.',
    ),
    performancePeerReview: n(
      'A peer review is waiting for you: {{cycle}}',
      'Due {{deadline}}. Peer reviews are anonymous to the person reviewed.',
    ),
    performancePeersNominated: n(
      'Peer reviewers to confirm: {{name}}',
      '{{name}} nominated peer reviewers for {{cycle}}. Confirm or change them.',
    ),
    performanceDraftsReady: n(
      'Comment drafts are ready: {{cycle}}',
      'The performance assistant drafted comments for {{count}} of your team members. They fill the form only when you choose "Use in the form".',
    ),
    performanceReviewHints: n(
      'Hints on your review: {{cycle}}',
      'The performance assistant has {{count}} hints on the review you submitted. You may revise and resubmit it before the deadline.',
    ),
    performanceDeadline: n(
      'Review deadline in {{days}} days: {{cycle}}',
      'You still have review tasks to finish before {{deadline}}.',
    ),
    performanceUrge: n(
      'Reminder from HR: {{cycle}}',
      'You have {{count}} review tasks to finish. Deadline: {{deadline}}.',
    ),
    performanceCalibrationStarted: n(
      'Calibration has started: {{cycle}}',
      'The performance assistant is preparing the calibration pack.',
    ),
    performanceCalibrationPack: n(
      'Calibration pack ready: {{cycle}}',
      'Distribution against the guide and the anomaly list are on the calibration page ({{anomalies}} people flagged).',
    ),
    performanceResultPublished: n(
      'Your review result is published: {{cycle}}',
      'See it in My review, then acknowledge it or appeal within 7 days.',
    ),
    performanceAppealSubmitted: n(
      'Review appeal to handle: {{name}}',
      '{{name}} appealed their result in {{cycle}}.',
    ),
    performanceAppealHandled: n(
      'Your appeal has been handled: {{cycle}}',
      'See the outcome in My review.',
    ),
    performanceLowResult: n(
      'Review result to follow up: {{name}}',
      "{{name}}'s result in {{cycle}} needs follow-up. The learning coach drafted a learning plan for the manager to confirm.",
    ),
  },
};

export const performanceServerZh: typeof performanceServerEn = {
  notifications: {
    performanceGoalSetting: n(
      '考核目标设定已开始：{{cycle}}',
      '请在 {{deadline}} 前在“我的考核”中起草并提交个人目标。',
    ),
    performanceGoalDrafts: n(
      '绩效助理已为你起草目标：{{cycle}}',
      '已根据部门目标和岗位职责起草了目标草稿，请修改后在 {{deadline}} 前提交。',
    ),
    performanceGoalsSubmitted: n(
      '目标待确认：{{name}}',
      '{{name}} 提交了 {{cycle}} 的个人目标，请确认或退回。',
    ),
    performanceGoalApproved: n(
      '目标已确认：{{goal}}',
      '上级已确认你在 {{cycle}} 的目标，请在考核期内更新进度。',
    ),
    performanceGoalReturned: n(
      '目标被退回：{{goal}}',
      '上级退回了你在 {{cycle}} 的目标，请修改后重新提交。',
    ),
    performanceSelfReview: n(
      '请完成自评：{{cycle}}',
      '截止日 {{deadline}}，自评页可以查看你的过程数据快照。',
    ),
    performancePeerReview: n(
      '你有一份互评任务：{{cycle}}',
      '截止日 {{deadline}}，互评对被评价人匿名。',
    ),
    performancePeersNominated: n(
      '互评人待确认：{{name}}',
      '{{name}} 提名了 {{cycle}} 的互评人，请确认或调整。',
    ),
    performanceDraftsReady: n(
      '评语初稿已就绪：{{cycle}}',
      '绩效助理为你的 {{count}} 位成员起草了评语初稿；只有点击“采用到评价表”后才会填入表单。',
    ),
    performanceReviewHints: n(
      '绩效助理的评价提示：{{cycle}}',
      '你提交的评价有 {{count}} 条提示，截止日前可以修改后重新提交。',
    ),
    performanceDeadline: n(
      '考核截止还有 {{days}} 天：{{cycle}}',
      '你还有考核任务未完成，截止日 {{deadline}}。',
    ),
    performanceUrge: n(
      'HR 催办：{{cycle}}',
      '你有 {{count}} 项考核任务未完成，截止日 {{deadline}}。',
    ),
    performanceCalibrationStarted: n(
      '考核进入校准：{{cycle}}',
      '绩效助理正在准备校准材料。',
    ),
    performanceCalibrationPack: n(
      '校准材料已就绪：{{cycle}}',
      '校准页已列出分布与指引的对比和异常名单（{{anomalies}} 人有提示）。',
    ),
    performanceResultPublished: n(
      '考核结果已发布：{{cycle}}',
      '请在“我的考核”中查看结果，确认或在 7 天内申诉。',
    ),
    performanceAppealSubmitted: n(
      '考核申诉待处理：{{name}}',
      '{{name}} 对 {{cycle}} 的结果提出了申诉。',
    ),
    performanceAppealHandled: n(
      '你的考核申诉已处理：{{cycle}}',
      '请在“我的考核”中查看处理结果。',
    ),
    performanceLowResult: n(
      '考核结果需要跟进：{{name}}',
      '{{name}} 在 {{cycle}} 中的结果需要跟进，学习教练已起草学习计划，交上级确认。',
    ),
  },
};
