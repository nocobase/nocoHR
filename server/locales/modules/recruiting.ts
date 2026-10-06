/**
 * V2-07 用工计划与招聘入职: the server-produced wording — in-app notices (whose
 * titles never name a candidate: the office suite receives the title and a
 * link only), candidate email templates, the offer letter and the new-hire
 * check-in. Merged into server/locales/{en-US,zh-CN}.ts.
 */

const n = (title: string, body: string) => ({ title, body });

export const recruitingServerEn = {
  notifications: {
    recruitingWorkforceGap: n(
      '{{department}} {{month}}: short of {{count}} people',
      'The HR assistant calculated the staffing gap and three options (overtime, transfer, hiring). Please decide.',
    ),
    recruitingTransferCoordination: n(
      'Transfer coordination: {{department}} {{month}}',
      '{{department}} ({{position}}) is short of staff and chose a loan from {{from}} (up to {{count}}). Please pick the people and arrange a transfer or a temporary schedule.',
    ),
    recruitingRequisitionDrafted: n(
      'Draft requisition: {{position}} × {{count}}',
      'A draft requisition was made from the workforce plan ({{month}}). Check the conditions and submit it.',
    ),
    recruitingRequisitionPending: n(
      'Requisition to approve: {{department}} {{position}}',
      '{{department}} asks to hire {{count}} × {{position}}. Please review.',
    ),
    recruitingRequisitionRejected: n(
      'Requisition returned: {{position}}',
      'Comment: {{comment}}',
    ),
    recruitingRequisitionOpened: n(
      'Requisition approved: {{position}}',
      'Recruiter: {{recruiter}}.',
    ),
    recruitingPostingDrafted: n(
      'Posting draft to confirm: {{position}}',
      'The recruiting assistant drafted the description, requirements and knockout questions. It can be published once you confirm it.',
    ),
    recruitingPoolSuggested: n(
      '{{count}} candidates in the talent pool may fit',
      '{{position}}: the recruiting assistant found {{count}} past candidates with valid consent, with the reasons. Nobody is contacted automatically.',
    ),
    recruitingInterviewScheduled: n(
      'You have a new interview',
      'Interview with {{name}} at {{time}}. The questions will be ready 24 hours before.',
    ),
    recruitingInterviewRescheduled: n(
      'An interview was moved',
      'The interview with {{name}} moved from {{from}} to {{time}}.',
    ),
    recruitingInterviewQuestions: n(
      'Interview questions are ready',
      'The recruiting assistant prepared questions based on the requirements.',
    ),
    recruitingInterviewSummary: n(
      'Interview summary: {{position}}',
      'Every interviewer has scored. The summary lists the score distribution, divergences and what to verify.',
    ),
    recruitingOfferPending: n(
      'Offer to approve: {{position}}',
      'Please review this offer.',
    ),
    recruitingOfferRejected: n('Offer returned', 'Comment: {{comment}}'),
    recruitingOfferApproved: n(
      'Offer approved',
      'The offer letter is ready. Preview the email and send it.',
    ),
    recruitingOfferAccepted: n(
      'An offer was accepted',
      '{{name}} accepted the offer.',
    ),
    recruitingOfferDeclined: n(
      'An offer was declined',
      '{{name}} declined the offer.',
    ),
    recruitingOnboardDraft: n(
      'Onboarding to process: {{position}}',
      'The candidate accepted; the onboarding action is pre-filled for {{date}}. Enter the employee number and submit.',
    ),
    recruitingPayrollPrefill: n(
      'Salary file pre-filled from the offer',
      'A new employee joining {{date}} is waiting in "To be filed" with the salary from the offer. Confirm to write it.',
    ),
    recruitingArrivalUnconfirmed: n(
      'Arrival not confirmed for tomorrow',
      '{{name}} starts on {{date}} and has not confirmed arrival. Please call to confirm.',
    ),
    recruitingPreboardingTemplate: n(
      'Arrival reminder template to confirm',
      'The arrival reminders for {{name}} are sent once you confirm the template.',
    ),
    recruitingPreboardingExtracted: n(
      'Joining documents read, to review',
      'The documents a candidate uploaded were read. Review them on the onboarding draft before {{date}}.',
    ),
    recruitingNewHireIssue: n(
      'New-hire check-in: {{topic}}',
      '{{name}} mentioned: {{summary}}. Please follow up.',
    ),
    recruitingCheckInFaceToFace: n(
      'Please check in with a new employee in person',
      '{{name}} is on day {{day}} without an account or Feishu binding. Ask how the commute, mentoring, the workload and the schedule are going.',
    ),
    recruitingDeletionRequested: n(
      'A candidate asked to have their information deleted',
      'They asked through the link in the resume receipt. Open the candidate and anonymize them.',
    ),
    recruitingStaleApplications: n(
      '{{count}} applications waiting over {{days}} days',
      'Please process the applications that stayed in one stage.',
    ),
    recruitingDigest: n(
      "Today's recruiting digest ({{date}})",
      '{{total}} new applications: high {{high}}, medium {{medium}}, low {{low}}, not screened {{pending}}; knockout not met {{knockout}}.',
    ),
  },
  top: {
    templates: {
      bookingConfirmation: {
        subject: 'Your interview for {{position}}',
        body: 'Hello {{name}}, your interview for {{position}} is at {{time}}, {{location}}.',
        footer: 'To reschedule or cancel once: {{link}}',
      },
      interviewReminder: {
        subject: 'Reminder: interview tomorrow',
        body: 'Hello {{name}}, your interview for {{position}} is at {{time}}, {{location}}. To reschedule: {{link}}',
      },
      invitation: {
        subject: 'Interview invitation: {{position}}',
        body: 'Hello {{name}}, we would like to invite you to an interview for {{position}} at {{time}}, {{location}}. Please reply to confirm.',
      },
      rejection: {
        subject: 'Your application for {{position}}',
        body: 'Hello {{name}}, thank you for applying for {{position}}. We will not continue with your application this time. We wish you all the best.',
      },
      offer: {
        subject: 'Offer: {{position}} at {{company}}',
        body: 'Hello {{name}}, we are pleased to offer you the position of {{position}} in {{department}}, starting {{startDate}}. Please read the offer letter and reply by {{respondBy}}: {{link}}',
      },
      preboarding: {
        subject: 'Your first day: {{date}}',
        body: 'Hello {{name}}, you start as {{position}} on {{date}} (in {{days}} days) at {{location}}, 08:30. Please bring your ID card, bank card, diploma and a photo. Confirm your arrival or upload documents here: {{link}}',
      },
      aiInterviewInvitation: {
        subject: 'Initial interview for {{position}}',
        body: 'Hello {{name}}, you may take a text initial interview for {{position}} with our recruiting assistant (about {{minutes}} minutes; answers are kept with your application for its retention period). You can choose a human interview instead. {{link}}',
      },
    },
    letter: {
      title: 'Offer Letter',
      greeting: 'Dear {{name}},',
      body: '{{company}} is pleased to offer you the position of {{position}} in {{department}}.',
      startDate: 'Start date: {{date}}',
      probation: 'Probation: {{months}} months',
      salary: 'Monthly base salary: {{amount}} yuan',
      closing:
        'Please reply through the link in the email before the deadline.',
    },
    checkIns: {
      opening:
        'Hi {{name}}, this is the HR assistant. It is your day {{day}} with us. {{question}} (Anything else about: {{more}})',
      thanks: 'Thanks! Glad to hear things are going well.',
      received: 'Thanks for telling us.',
      policy: 'Per {{title}} ({{section}}): {{excerpt}} {{link}}',
      routed: 'I have passed this on to {{names}}, who will follow up.',
      topics: {
        commute: 'Commute and accommodation',
        mentoring: 'Mentoring and support',
        schedule: 'Schedule and working hours',
        workload: 'Workload',
        expectations: 'Work as described',
        environment: 'Working environment',
        other: 'Other',
        // Legacy topics of check-ins recorded before 2026-10.
        housing: 'Housing',
        shuttle: 'Shuttle bus',
      },
    },
    onboard: {
      resumeTitle: 'Resume (from recruiting)',
      consentTitle: 'Personal information consent record',
      consentAt: 'Consented at',
      consentBy: 'Consent given',
      consentChannel: 'Source',
    },
    consentBy: {
      page: 'ticked on the careers page',
      recruiter: 'confirmed by the recruiter on import',
      email: 'the candidate sent the resume to the recruiting mailbox',
    },
    uploads: {
      idCard: 'ID card',
      bankCard: 'Bank card',
      diploma: 'Diploma',
    },
    public: {
      consent:
        '{{company}} uses your information only for this recruitment and keeps it for {{months}} months after your last activity. You may ask for it to be deleted at any time by replying to our email.',
    },
  },
};

export const recruitingServerZh: typeof recruitingServerEn = {
  notifications: {
    recruitingWorkforceGap: n(
      '{{department}} {{month}} 用工缺口 {{count}} 人',
      '人事助理已算出用工缺口，并准备了加班、借调、招聘三种方案，请确定方案。',
    ),
    recruitingTransferCoordination: n(
      '借调协调：{{department}} {{month}}',
      '{{department}}{{position}}用工不足，已选择从{{from}}借调（最多 {{count}} 人），请确认人选后按调岗或临时排班办理。',
    ),
    recruitingRequisitionDrafted: n(
      '招聘需求草稿：{{position}} {{count}} 人',
      '已根据用工计划（{{month}}）生成招聘需求草稿，请核对条件清单后提交。',
    ),
    recruitingRequisitionPending: n(
      '待审批招聘需求：{{department}}{{position}}',
      '{{department}}申请招聘{{position}} {{count}} 人，请审批。',
    ),
    recruitingRequisitionRejected: n(
      '招聘需求被退回：{{position}}',
      '审批意见：{{comment}}',
    ),
    recruitingRequisitionOpened: n(
      '招聘需求已批准：{{position}}',
      '招聘负责人：{{recruiter}}。',
    ),
    recruitingPostingDrafted: n(
      '职位草稿待确认：{{position}}',
      '招聘助理已按岗位职责和条件清单起草职位描述、任职要求和门槛问题，确认后才能发布。',
    ),
    recruitingPoolSuggested: n(
      '简历库中有 {{count}} 名可复用的候选人',
      '{{position}}：招聘助理从授权有效的候选人中找到 {{count}} 人并写明了匹配理由，不会自动联系候选人。',
    ),
    recruitingInterviewScheduled: n(
      '你有一场新的面试安排',
      '{{time}} 面试候选人{{name}}，面试题会在面试前 24 小时准备好。',
    ),
    recruitingInterviewRescheduled: n(
      '面试时间已调整',
      '候选人{{name}}的面试由 {{from}} 改到 {{time}}。',
    ),
    recruitingInterviewQuestions: n(
      '面试题已就绪',
      '招聘助理已按任职要求准备好面试题。',
    ),
    recruitingInterviewSummary: n(
      '面试汇总：{{position}}',
      '所有面试官已提交评分，招聘助理整理了评分分布、分歧点和待核实事项。',
    ),
    recruitingOfferPending: n('待审批 Offer：{{position}}', '请审批这份录用。'),
    recruitingOfferRejected: n('Offer 被退回', '审批意见：{{comment}}'),
    recruitingOfferApproved: n(
      'Offer 已审批通过',
      '录用通知书已生成，预览邮件后即可发送。',
    ),
    recruitingOfferAccepted: n('候选人已接受 Offer', '{{name}}已接受 Offer。'),
    recruitingOfferDeclined: n('候选人已拒绝 Offer', '{{name}}已拒绝 Offer。'),
    recruitingOnboardDraft: n(
      '待办理入职：{{position}}',
      '候选人已接受 Offer，入职单已预填（{{date}} 入职），请填写工号后提交。',
    ),
    recruitingPayrollPrefill: n(
      '按 Offer 预填的薪资档案待确认',
      '{{date}} 入职的新员工已在“待建档”中，薪资按 Offer 预填，确认后写入。',
    ),
    recruitingArrivalUnconfirmed: n(
      '报到前一天仍未确认到岗',
      '{{name}} {{date}} 报到，尚未确认到岗，请电话确认。',
    ),
    recruitingPreboardingTemplate: n(
      '报到提醒模板待确认',
      '{{name}}的报到提醒需要你确认模板后才会发送。',
    ),
    recruitingPreboardingExtracted: n(
      '入职材料已识别，待确认',
      '候选人上传的材料已识别，请在 {{date}} 入职前到入职单草稿中核对。',
    ),
    recruitingNewHireIssue: n(
      '新员工回访：{{topic}}',
      '{{name}}在回访中提到：{{summary}}。请跟进。',
    ),
    recruitingCheckInFaceToFace: n(
      '请当面了解新员工近况',
      '{{name}}入职第 {{day}} 天，没有账号或未绑定飞书，请当面了解通勤、带教、工作量和排班是否适应。',
    ),
    recruitingDeletionRequested: n(
      '有候选人申请删除个人信息',
      '候选人通过简历回执中的链接提交了删除申请，请打开候选人并执行匿名化。',
    ),
    recruitingStaleApplications: n(
      '有 {{count}} 份投递超过 {{days}} 天未处理',
      '请尽快处理停留在同一阶段的投递。',
    ),
    recruitingDigest: n(
      '今日招聘汇总（{{date}}）',
      '新投递 {{total}} 份：匹配度高 {{high}}、中 {{medium}}、低 {{low}}，待初筛 {{pending}}；门槛未满足 {{knockout}} 份。',
    ),
  },
  top: {
    templates: {
      bookingConfirmation: {
        subject: '面试时间确认：{{position}}',
        body: '{{name}}，你好。你的{{position}}面试时间为 {{time}}，地点：{{location}}。',
        footer: '如需改期或取消（限一次）：{{link}}',
      },
      interviewReminder: {
        subject: '面试提醒：明天的面试',
        body: '{{name}}，你好。你的{{position}}面试在 {{time}}，地点：{{location}}。如需改期：{{link}}',
      },
      invitation: {
        subject: '面试邀请：{{position}}',
        body: '{{name}}，你好。诚邀你参加{{position}}面试，时间 {{time}}，地点：{{location}}。请回复确认。',
      },
      rejection: {
        subject: '关于你应聘的{{position}}',
        body: '{{name}}，你好。感谢你应聘{{position}}。经过慎重考虑，本次暂不继续推进你的应聘，祝你一切顺利。',
      },
      offer: {
        subject: '录用通知：{{company}} {{position}}',
        body: '{{name}}，你好。很高兴通知你，你已被录用为{{department}}{{position}}，入职日期 {{startDate}}。请查看录用通知书，并在 {{respondBy}} 前通过以下链接回复：{{link}}',
      },
      preboarding: {
        subject: '报到提醒：{{date}}',
        body: '{{name}}，你好。你将于 {{date}}（{{days}} 天后）08:30 到{{location}}报到，入职{{position}}。请带好身份证、银行卡、学历证书和一寸照片。确认到岗或上传材料：{{link}}',
      },
      aiInterviewInvitation: {
        subject: '{{position}}初面邀请',
        body: '{{name}}，你好。你可以和我们的招聘助理完成一轮文字初面（约 {{minutes}} 分钟，问答记录随投递按保存期限保存），也可以选择改为人工面试。{{link}}',
      },
    },
    letter: {
      title: '录用通知书',
      greeting: '{{name}}：',
      body: '{{company}}很高兴地通知你，你已被录用为{{department}}{{position}}。',
      startDate: '入职日期：{{date}}',
      probation: '试用期：{{months}} 个月',
      salary: '月基本工资：{{amount}} 元',
      closing: '请在截止日期前通过邮件中的链接回复。',
    },
    checkIns: {
      opening:
        '{{name}}，你好，我是人事助理。今天是你入职第 {{day}} 天，想问问：{{question}}（也可以说说：{{more}}）',
      thanks: '谢谢！一切顺利就好，有需要随时找我。',
      received: '谢谢你告诉我们。',
      policy: '按《{{title}}》（{{section}}）：{{excerpt}} {{link}}',
      routed: '这件事我已经转给{{names}}跟进。',
      topics: {
        commute: '通勤与住宿',
        mentoring: '带教与同事支持',
        schedule: '排班与工作时间',
        workload: '工作量',
        expectations: '工作内容与预期',
        environment: '工作环境',
        other: '其他',
        // 2026-10 之前记录的回访主题.
        housing: '住宿',
        shuttle: '班车',
      },
    },
    onboard: {
      resumeTitle: '简历（来自招聘）',
      consentTitle: '个人信息授权记录',
      consentAt: '授权时间',
      consentBy: '授权方式',
      consentChannel: '来源',
    },
    consentBy: {
      page: '公开页投递时勾选',
      recruiter: '导入时由招聘负责人确认已取得授权',
      email: '候选人主动发来简历（招聘邮箱）',
    },
    uploads: {
      idCard: '身份证',
      bankCard: '银行卡',
      diploma: '学历证书',
    },
    public: {
      consent:
        '{{company}}仅将你的信息用于本次招聘，保存至你最后一次活动后 {{months}} 个月；你可以随时回复我们的邮件申请删除。',
    },
  },
};
