/**
 * V4-13 人才盘点与其他: the server-produced wording — in-app notices and the
 * new permission-set titles. No notice carries a rating, a band, a box or a
 * potential answer: talent review and succession notices reach the office
 * suite as a title and a link only. Merged into server/locales/{en-US,zh-CN}.ts.
 */

const n = (title: string, body: string) => ({ title, body });

export const talentReviewServerEn = {
  permissionSets: {
    hrPracticalAssessor: 'Practical assessor',
    hrTicketIntegration: 'Ticket system integration',
  },
  notifications: {
    talentReviewPotential: n(
      'Fill in the potential assessment: {{title}}',
      'The talent review has started. Assess the potential of {{count}} people in your scope (three items, each with an example).',
    ),
    talentReviewPreplaced: n(
      'The talent analyst pre-placed the cards: {{title}}',
      '{{count}} cards carry a pre-placement with evidence. People decide the placement in the review session.',
    ),
    successionRecommended: n(
      'Successor candidates recommended: {{department}} {{position}}',
      'The talent analyst added {{count}} candidates with their gaps. Choose each readiness and confirm the plan.',
    ),
    successionRisk: n(
      'Succession risk: {{department}} {{position}}',
      '{{summary}}',
    ),
    practicalWitness: n(
      'A practical assessment waits for your witness signature: {{title}}',
      'The assessment of {{name}} is signed by the assessor. Review and sign it in your account.',
    ),
    trainingEvaluationL1: n(
      'How was the training? {{title}}',
      'Three quick questions about the course you completed. It takes a minute on your phone.',
    ),
    trainingEvaluationL3: n(
      'Has the training changed the work of {{name}}? {{title}}',
      'Thirty days after {{name}} completed the training, tell us whether you have seen a change, with an example.',
    ),
    trainingEvaluationDue: n(
      'Training evaluation due {{date}}: {{title}}',
      'Your evaluation expires if not answered by {{date}}.',
    ),
    trainingEffectReport: n(
      'Training effectiveness report {{quarter}}',
      '{{summary}}',
    ),
    knowledgeFaqDrafted: n(
      'A FAQ draft waits for your review: {{title}}',
      'The knowledge assistant drafted a FAQ from {{count}} resolved items ({{conflicts}} left out for conflicting with a controlled document). It answers questions only after you confirm it.',
    ),
    translationDrafted: n(
      'An English version waits for your review: {{title}}',
      'The content writer drafted the translation. Review and confirm it in Translation review.',
    ),
  },
};

export const talentReviewServerZh: typeof talentReviewServerEn = {
  permissionSets: {
    hrPracticalAssessor: '实操考评员',
    hrTicketIntegration: '工单系统集成账号',
  },
  notifications: {
    talentReviewPotential: n(
      '请填写潜力评估：{{title}}',
      '人才盘点已进入准备阶段，请为范围内的 {{count}} 人填写潜力评估（三项，每项附事例）。',
    ),
    talentReviewPreplaced: n(
      '人才分析师已完成预放置：{{title}}',
      '{{count}} 张卡片已附预放置建议和证据，落位在盘点会上由人决定。',
    ),
    successionRecommended: n(
      '继任候选推荐：{{department}}{{position}}',
      '人才分析师推荐了 {{count}} 名候选人并附差距说明，请选择准备度后确认继任计划。',
    ),
    successionRisk: n('继任风险提醒：{{department}}{{position}}', '{{summary}}'),
    practicalWitness: n(
      '实操考核待你见证签字：{{title}}',
      '{{name}} 的实操考核已由考评员签字，请在你的账号中核对并签字。',
    ),
    trainingEvaluationL1: n(
      '请评价培训：{{title}}',
      '你已完成这项学习，请花一分钟回答 3 个问题（手机上即可填写）。',
    ),
    trainingEvaluationL3: n(
      '{{name}} 培训后的行为改变：{{title}}',
      '{{name}} 完成培训已满 30 天，请评价是否观察到工作行为的改变并举一个事例。',
    ),
    trainingEvaluationDue: n(
      '培训评估将于 {{date}} 截止：{{title}}',
      '到期未填写的评估将自动失效。',
    ),
    trainingEffectReport: n('培训效果季报 {{quarter}}', '{{summary}}'),
    knowledgeFaqDrafted: n(
      '常见问题文档待审核：{{title}}',
      '知识助手根据 {{count}} 条已解决的问题起草了常见问题文档（{{conflicts}} 条与受控文件冲突未写入）。确认后才参与问答。',
    ),
    translationDrafted: n(
      '英文译文待审核：{{title}}',
      '内容编写员已起草译文，请在“译文审核”中核对并确认。',
    ),
  },
};
