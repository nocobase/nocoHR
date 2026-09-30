/**
 * Wording for the realigned V2-05 考勤与假期 additions: 考勤异常说明 and 已说明,
 * the HR assistant's drafts in 我的申请, 考勤异常追问 on the anomaly list,
 * 允许说明豁免 in the rule form, and 顶班邀请 in the cover dialog. Kept in its
 * own module and spread into `en-US.ts` / `zh-CN.ts` as `attendanceV2`, so
 * the two locales stay checked against the same shape while other steps edit
 * those files.
 */
const en = {
  attendanceV2: {
    excused: 'Explained',
    excusedHint: 'An approved exception explanation covers this day.',
    source: {
      hrAssistant: 'Drafted by the HR assistant',
      self: 'Submitted by the employee',
    },
    viaCard: 'On a Feishu card',
    drafts: {
      submit: 'Submit',
      discard: 'Discard',
      submitted: '{{type}} submitted for approval.',
      discarded: 'Draft discarded.',
      hint: 'The HR assistant drafted this for you. Check it, then submit it yourself.',
    },
    exception: {
      open: 'Explain an anomaly',
      title: 'Exception explanation',
      description:
        'Explain why you were late or left early on a day. Once your manager approves, the day is marked Explained.',
      day: 'Day',
      pick: 'Choose a late or early day',
      none: 'This month has no late or early day to explain.',
      anomaly: '{{date}} · {{status}} {{minutes}} minutes',
      policy: 'Policy',
      minutes: '{{minutes}} minutes',
    },
    inquiry: {
      asked: 'Asked',
      askedFeishu: 'Asked in Feishu',
      askedHead: 'Head reminded',
      replied: 'Replied',
      reply: 'Reply: {{reply}}',
      reminded: 'Reminded after no reply',
      followUp: {
        waitingApproval: 'Waiting for approval',
        needsHr: 'Needs HR follow-up',
        drafted: 'Drafted, not submitted',
        replied: 'Replied',
      },
    },
    rule: {
      exceptionExcusable: 'Excuse explained anomalies',
      exceptionExcusableHint:
        'An approved exception explanation keeps that late arrival or early leave out of the monthly counts.',
    },
    invite: {
      button: 'Send cover invitations',
      hint: 'Each suggested colleague gets a Feishu card to accept or decline. The first to accept goes into a draft of that shift for you to publish.',
      title: 'Cover invitations',
      sent: 'Invitations sent: {{count}}.',
      results: {
        sent: 'Sent',
        duplicate: 'Already invited',
        notBound: 'Not on Feishu',
        noAccount: 'No account',
        failed: 'Not delivered',
      },
      status: {
        pending: 'Waiting',
        accepted: 'Accepted',
        declined: 'Not available',
        expired: 'Expired',
      },
      accepted:
        '{{name}} accepted: the shift is in the draft schedule. Publish it to confirm.',
    },
  },
  errors: {
    EXCEPTION_NOT_APPLICABLE:
      'Only a late arrival or an early leave can be explained.',
    MISSING_PUNCH_NOT_APPLICABLE: 'That day has no missed punch.',
    NO_ELIGIBLE_CANDIDATE:
      'None of these colleagues meets the cover rules any more.',
    REPLACEMENT_ALREADY_ACCEPTED: 'A colleague has already accepted.',
    IM_TRANSPORT_NOT_CONFIGURED:
      'No office-suite bot is connected, so nothing can be sent.',
  },
};

const zh: typeof en = {
  attendanceV2: {
    excused: '已说明',
    excusedHint: '已批准的考勤异常说明覆盖这一天。',
    source: {
      hrAssistant: '人事助理起草',
      self: '本人提交',
    },
    viaCard: '经飞书卡片',
    drafts: {
      submit: '提交',
      discard: '放弃',
      submitted: '{{type}}已提交审批。',
      discarded: '草稿已放弃。',
      hint: '这是人事助理为你起草的申请，请核对后由你本人提交。',
    },
    exception: {
      open: '异常说明',
      title: '考勤异常说明',
      description: '说明某天迟到或早退的原因。主管批准后，这一天标为“已说明”。',
      day: '日期',
      pick: '选择迟到或早退的日子',
      none: '本月没有需要说明的迟到或早退。',
      anomaly: '{{date}} · {{status}} {{minutes}} 分钟',
      policy: '制度依据',
      minutes: '{{minutes}} 分钟',
    },
    inquiry: {
      asked: '已追问',
      askedFeishu: '已在飞书追问',
      askedHead: '已提醒部门负责人',
      replied: '已回复',
      reply: '回复：{{reply}}',
      reminded: '未回复，已提醒',
      followUp: {
        waitingApproval: '等待审批',
        needsHr: '需要 HR 跟进',
        drafted: '已起草未提交',
        replied: '已回复',
      },
    },
    rule: {
      exceptionExcusable: '允许说明豁免',
      exceptionExcusableHint:
        '考勤异常说明批准后，该次迟到或早退不计入月度异常。',
    },
    invite: {
      button: '发出顶班邀请',
      hint: '向推荐的同事发送飞书卡片（接受 / 不方便）。第一个接受的人进入该班次的排班草稿，由你确认后发布。',
      title: '顶班邀请',
      sent: '已发出 {{count}} 份顶班邀请。',
      results: {
        sent: '已发送',
        duplicate: '已邀请过',
        notBound: '未绑定飞书',
        noAccount: '没有账号',
        failed: '未送达',
      },
      status: {
        pending: '等待回复',
        accepted: '已接受',
        declined: '不方便',
        expired: '已失效',
      },
      accepted: '{{name}} 已接受，班次已放入排班草稿，请确认后发布。',
    },
  },
  errors: {
    EXCEPTION_NOT_APPLICABLE: '只有迟到或早退可以提交考勤异常说明。',
    MISSING_PUNCH_NOT_APPLICABLE: '这一天没有缺卡。',
    NO_ELIGIBLE_CANDIDATE: '这些同事都已不满足顶班条件。',
    REPLACEMENT_ALREADY_ACCEPTED: '已有同事接受了顶班邀请。',
    IM_TRANSPORT_NOT_CONFIGURED: '尚未接入办公软件机器人，无法发送。',
  },
};

export const attendanceAdditions = { en, zh };
