/**
 * Wording for the V3-10 考试与认证 additions (examiner, anti-cheating,
 * external certificates, qualification material, the exam → competency
 * rule). Kept in its own module and spread into `en-US.ts` / `zh-CN.ts`, so
 * the two locales stay checked against the same shape while other steps edit
 * those files.
 */
const en = {
  talent: {
    examIntegrity: {
      settings: {
        title: 'Anti-cheating and AI grading',
        shuffleOptions: 'Shuffle options',
        shuffleOptionsHint:
          'Each candidate sees the options in their own order; scoring is unaffected.',
        disableCopy: 'Block copy and paste',
        disableCopyHint:
          'Questions cannot be copied and answers cannot be pasted; a blocked paste is recorded.',
        singleDevice: 'One device per attempt',
        singleDeviceHint:
          'Opening the attempt on another device takes it over; the first device can no longer submit.',
        maxBlurCount: 'Times the page may be left',
        blurAction: 'Beyond that',
        blurActions: {
          flag: 'Flag the attempt for review',
          submit: 'Submit with the saved answers',
        },
        aiGrading: 'Examiner suggests short-answer scores',
        aiGradingHint:
          'After submission the examiner suggests a score per short answer; the instructor sets the final score.',
      },
      tab: 'Flagged attempts',
      empty: 'No flagged attempts.',
      blurCount: 'Left the page {{count}} times',
      blurNo: 'time {{no}}',
      reviews: { valid: 'Kept as valid', voided: 'Voided' },
      flagTypes: {
        blur: 'Left the page',
        multiDevice: 'Another device',
        pasteAttempt: 'Tried to paste',
      },
      deviceDetail: {
        opened: 'opened on another device',
        rejected: 'submission from the first device refused',
      },
      voidReason: 'Voided: {{reason}}',
      keep: 'Keep as valid',
      void: 'Void',
      voidTitle: 'Void this attempt',
      voidDescription:
        'A voided attempt counts neither as passed nor failed, but uses one of the attempts.',
      reason: 'Reason',
      resetToo: 'Also reset the candidate’s attempts',
      voided: 'Attempt voided',
      kept: 'Attempt kept as valid',
      flaggedCount: '{{count}} flagged',
      blurRecorded: 'Leaving the page was recorded ({{count}} times)',
      noPaste: 'Pasting is not allowed in this exam',
      deviceChangedTitle: 'Opened on another device',
      deviceChanged:
        'This attempt was opened on another device. Continue there; answers from this device are no longer accepted.',
    },
    examiner: {
      suggested: 'Examiner suggests {{score}} / {{max}}',
      adopt: 'Adopt',
      matched: 'Covered:',
      missing: 'Missing:',
      agreement: 'AI within 1 point',
      lossTitle: 'Points lost by competency',
      askHint:
        'Ask the examiner in the AI assistant why points were lost on a question.',
      lost: 'lost {{lost}} of {{total}}',
    },
    examRules: {
      open: 'Competency rule',
      title: 'Exam → competency level rule',
      description:
        'Which competencies an exam assesses and at what level. Changes apply from the next scoring.',
      saved: 'Rule saved',
      minWeight: 'Minimum share of the paper (%)',
      minWeightHint:
        'Only competencies carrying at least this share of the points are assessed.',
      fullRate: 'Score rate for the required level (%)',
      fullRateHint: 'At or above: the level the position requires.',
      partialRate: 'Score rate for one level below (%)',
      partialRateHint:
        'At or above: one level below; lower rates write nothing.',
    },
    externalCerts: {
      fields: {
        kind: 'Type',
        issuingAuthority: 'Issuing authority',
        type: 'Certificate type',
        externalNo: 'Certificate number',
        issuedAt: 'Issued',
        expiresAt: 'Expires',
        scan: 'Scan',
      },
      kinds: {
        internal: 'Internal certification',
        external: 'External certificate',
      },
      typeHint:
        'An external certificate has no courses or exams: employees register it with a scan and HR verifies it.',
      submitted: 'Submitted for verification',
      resubmitTitle: 'Correct and resubmit',
      registerTitle: 'Register an external certificate',
      rejectedBecause: 'Not verified: {{note}}',
      registerDescription:
        'Fill in the certificate as printed and upload a scan. HR verifies it before it counts as valid.',
      chooseType: 'Choose a type',
      uploadScan: 'Upload the scan',
      scanKept: 'The scan already uploaded is kept unless you upload another.',
      scanHint: 'PDF, PNG or JPEG, up to 5 MB.',
      submit: 'Submit',
      viewScan: 'View scan',
      noScan: 'No scan',
      mineTitle: 'My external certificates',
      mineDescription:
        'Certificates issued by outside authorities, such as a forklift licence. They count once HR has verified them.',
      register: 'Register',
      mineEmpty: 'None registered.',
      verifyStatus: {
        pending: 'Awaiting verification',
        verified: 'Verified',
        rejected: 'Not verified',
      },
      status: {
        valid: 'Valid',
        expiring: 'Expiring',
        expired: 'Expired',
        superseded: 'Replaced',
        revoked: 'Revoked',
        pending: 'Awaiting verification',
      },
      edit: 'Correct',
      expiringCount: '{{count}} expiring',
      pageDescription:
        'External certificates employees registered. Check the scan against the details, then verify or reject with a reason.',
      empty: 'Nothing here.',
      note: 'Note: {{note}}',
      reject: 'Reject',
      verify: 'Verify',
      rejected: 'Rejected; the holder was told',
      verified: 'Verified; the certificate is now valid',
      rejectTitle: 'Reject this certificate',
      verifyTitle: 'Verify this certificate',
      rejectReason: 'Reason (the holder sees it)',
      verifyNote: 'Note (optional)',
    },
    qualification: {
      field: 'Qualifies for position',
      fieldHint:
        'Holding a valid certificate means qualified for this position; it never changes anyone’s position.',
      badge: 'Qualification: {{position}}',
      dossierTitle: '{{name}} is qualified for {{position}}',
      template: 'Rule-based text',
      gap: 'Gap to the target position: {{then}} when set, {{now}} now',
      gapItem:
        '{{competency}}: required {{required}}, then {{then}}, now {{now}}',
      courses: 'Courses completed',
      exams: 'Exam results',
      practice: 'Practice sessions: {{count}}, average {{average}}',
      decision:
        'Appointing, a trial period and any salary change are decided by people; nothing was started automatically.',
      promote: 'Start a promotion',
    },
  },
  navigation: { talentExternalCerts: 'External certificates' },
  errors: {
    EXAM_ANTI_CHEAT_INVALID: 'The anti-cheating settings are not valid.',
    ATTEMPT_DEVICE_CHANGED:
      'This attempt was opened on another device; this device can no longer save or submit it.',
    ATTEMPT_NOT_REVIEWABLE:
      'Only a submitted attempt that is not voided can be reviewed.',
    VOID_REASON_REQUIRED: 'Give a reason for voiding the attempt.',
    ATTEMPT_CERTIFIED:
      'A certificate was issued on this attempt. Revoke the certificate first.',
    CERTIFICATION_EXTERNAL_REQUIREMENTS:
      'An external certificate type has no courses or exams.',
    CERTIFICATION_NOT_EXTERNAL: 'Choose an enabled external certificate type.',
    EXTERNAL_CERTIFICATE_PENDING:
      'One registration of this type is already awaiting verification.',
    EXTERNAL_CERTIFICATE_NOT_PENDING:
      'This certificate is not awaiting verification any more.',
    VERIFY_NOTE_REQUIRED: 'Give a reason for rejecting.',
    VERIFY_OWN_CERTIFICATE: 'You cannot verify your own certificate.',
    EXTERNAL_ISSUED_REQUIRED: 'Enter the issue date.',
    EXTERNAL_DATES_INVALID: 'The expiry date must be after the issue date.',
    EXTERNAL_SCAN_REQUIRED: 'Upload a scan of the certificate.',
    EXTERNAL_NO_REQUIRED: 'Enter the certificate number.',
    STEWARD_TEAM_FORBIDDEN:
      'Team certification summaries are for department heads and HR.',
    SCAN_FORMAT_INVALID: 'Upload a PDF, PNG or JPEG file.',
  },
  automationTasks: {
    'certificationSteward.qualificationPrep': {
      title: 'Appointment material',
      description:
        'When someone obtains the qualification certificate of their target position, marks the target achieved and prepares the material for the head and HR.',
    },
    'examiner.gradingSuggestion': {
      title: 'Suggested short-answer scores',
      description:
        'After submission, suggests a score per short answer with the points covered and missed; the instructor sets the final score.',
    },
    'learningCoach.examFailedPlan': {
      title: 'Remedial plan after a failed exam',
      description:
        'Drafts a learning plan for the competencies that lost the most points, for the head to approve, and sends the candidate what to study.',
    },
  },
  authzExam: {
    reviewIntegrity: 'Review flagged attempts',
    voidAttempt: 'Void attempts',
    configure: 'Competency rule',
  },
  authz: {
    externalCertificate: {
      title: 'External certificates',
      register: 'Register',
      verify: 'Verify',
    },
    examiner: { title: 'Examiner', use: 'Use' },
  },
  checklistItems: {
    certificateMissing:
      'The new position requires {{title}}, which is not held; arrange it.',
    certificateNoLongerRequired:
      '{{title}} is no longer required by the new position; it stays valid.',
  },
};

type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : Shape<T[K]>;
};

const zh: Shape<typeof en> = {
  talent: {
    examIntegrity: {
      settings: {
        title: '防作弊与 AI 建议分',
        shuffleOptions: '选项乱序',
        shuffleOptionsHint: '每位考生看到的选项顺序不同，判分不受影响。',
        disableCopy: '禁止复制与粘贴',
        disableCopyHint: '题干不能复制、答案不能粘贴；被拦截的粘贴会记录。',
        singleDevice: '单设备作答',
        singleDeviceHint:
          '在另一台设备打开答卷后，由新设备继续；原设备不能再提交。',
        maxBlurCount: '允许切出页面次数',
        blurAction: '超过后',
        blurActions: {
          flag: '标记为异常答卷，由讲师复核',
          submit: '按已保存答案自动交卷',
        },
        aiGrading: '简答题 AI 建议分',
        aiGradingHint: '交卷后由考官为每道简答题给出建议分，最终分由讲师确定。',
      },
      tab: '异常答卷',
      empty: '没有异常答卷。',
      blurCount: '切出页面 {{count}} 次',
      blurNo: '第 {{no}} 次',
      reviews: { valid: '已判定有效', voided: '已作废' },
      flagTypes: {
        blur: '切出页面',
        multiDevice: '其他设备',
        pasteAttempt: '尝试粘贴',
      },
      deviceDetail: {
        opened: '在另一台设备打开',
        rejected: '原设备提交被拒绝',
      },
      voidReason: '作废原因：{{reason}}',
      keep: '判定有效',
      void: '作废',
      voidTitle: '作废这份答卷',
      voidDescription: '作废的答卷不计为通过或未通过，但占用一次作答次数。',
      reason: '原因',
      resetToo: '同时重置该考生的作答次数',
      voided: '答卷已作废',
      kept: '已判定有效',
      flaggedCount: '{{count}} 份异常',
      blurRecorded: '已记录切屏 {{count}} 次',
      noPaste: '本场考试不允许粘贴',
      deviceChangedTitle: '答卷已在另一台设备打开',
      deviceChanged:
        '这份答卷已在另一台设备打开，请在那台设备继续；本设备的作答不再被接受。',
    },
    examiner: {
      suggested: '考官建议 {{score}} / {{max}} 分',
      adopt: '采用',
      matched: '命中：',
      missing: '遗漏：',
      agreement: 'AI 偏差 ≤ 1 分',
      lossTitle: '失分分析',
      askHint: '可以在 AI 助手中问考官“这题为什么扣分”。',
      lost: '失 {{lost}} / {{total}} 分',
    },
    examRules: {
      open: '能力等级规则',
      title: '考试 → 能力等级规则',
      description: '考试回写哪些能力项、记为几级。修改后从下一次判分起生效。',
      saved: '规则已保存',
      minWeight: '能力项最低占分比例（%）',
      minWeightHint: '只对试卷中占分不低于此比例的能力项生效。',
      fullRate: '记为要求等级的得分率（%）',
      fullRateHint: '达到后记为所属岗位的要求等级。',
      partialRate: '记为要求等级 − 1 的得分率（%）',
      partialRateHint: '达到后记为要求等级 − 1；更低不写入。',
    },
    externalCerts: {
      fields: {
        kind: '类型',
        issuingAuthority: '发证机构',
        type: '证书类型',
        externalNo: '证书编号',
        issuedAt: '发证日',
        expiresAt: '到期日',
        scan: '扫描件',
      },
      kinds: { internal: '内部认证', external: '外部证书' },
      typeHint: '外部证书不设所需课程与考试：由员工登记并上传扫描件，HR 核验。',
      submitted: '已提交，等待核验',
      resubmitTitle: '修改后重新提交',
      registerTitle: '登记外部证书',
      rejectedBecause: '未通过核验：{{note}}',
      registerDescription:
        '按证书上的内容填写并上传扫描件，HR 核验后计入有效持证。',
      chooseType: '选择证书类型',
      uploadScan: '上传扫描件',
      scanKept: '不重新上传则保留已上传的扫描件。',
      scanHint: 'PDF、PNG 或 JPEG，不超过 5 MB。',
      submit: '提交',
      viewScan: '查看扫描件',
      noScan: '无扫描件',
      mineTitle: '我的外部证书',
      mineDescription:
        '由外部机构颁发的证书，如叉车证；HR 核验后才计入有效持证。',
      register: '登记外部证书',
      mineEmpty: '还没有登记。',
      verifyStatus: {
        pending: '待核验',
        verified: '已核验',
        rejected: '已驳回',
      },
      status: {
        valid: '有效',
        expiring: '即将到期',
        expired: '已过期',
        superseded: '已换发',
        revoked: '已吊销',
        pending: '待核验',
      },
      edit: '修改重提',
      expiringCount: '即将到期 {{count}} 人',
      pageDescription:
        '员工登记的外部证书：对照扫描件核对内容，核验通过或填写原因驳回。',
      empty: '没有记录。',
      note: '说明：{{note}}',
      reject: '驳回',
      verify: '核验通过',
      rejected: '已驳回并通知本人',
      verified: '已核验，证书生效',
      rejectTitle: '驳回外部证书',
      verifyTitle: '核验外部证书',
      rejectReason: '驳回原因（本人可见）',
      verifyNote: '说明（可选）',
    },
    qualification: {
      field: '任职资格认证',
      fieldHint: '持有有效证书表示具备该岗位任职资格，不改变员工岗位。',
      badge: '任职资格：{{position}}',
      dossierTitle: '{{name}}具备{{position}}任职资格',
      template: '规则生成',
      gap: '对标差距：设定时 {{then}}，现在 {{now}}',
      gapItem:
        '{{competency}}：要求 {{required}} 级，设定时 {{then}} 级，现在 {{now}} 级',
      courses: '完成课程',
      exams: '考试成绩',
      practice: '陪练 {{count}} 次，平均 {{average}} 分',
      decision:
        '是否任职、试任期和薪资调整由人决定；系统没有自动发起任何异动。',
      promote: '发起晋升单',
    },
  },
  navigation: { talentExternalCerts: '外部证书核验' },
  errors: {
    EXAM_ANTI_CHEAT_INVALID: '防作弊设置无效。',
    ATTEMPT_DEVICE_CHANGED:
      '这份答卷已在另一台设备打开，本设备不能再保存或提交。',
    ATTEMPT_NOT_REVIEWABLE: '只能复核已交卷且未作废的答卷。',
    VOID_REASON_REQUIRED: '作废答卷须填写原因。',
    ATTEMPT_CERTIFIED: '已据此答卷发证，请先吊销证书。',
    CERTIFICATION_EXTERNAL_REQUIREMENTS: '外部证书不设所需课程与考试。',
    CERTIFICATION_NOT_EXTERNAL: '请选择已启用的外部证书类型。',
    EXTERNAL_CERTIFICATE_PENDING: '该类型已有一张待核验的登记。',
    EXTERNAL_CERTIFICATE_NOT_PENDING: '这张证书已不在待核验状态。',
    VERIFY_NOTE_REQUIRED: '驳回须填写原因。',
    VERIFY_OWN_CERTIFICATE: '不能核验自己的证书。',
    EXTERNAL_ISSUED_REQUIRED: '请填写发证日。',
    EXTERNAL_DATES_INVALID: '到期日须晚于发证日。',
    EXTERNAL_SCAN_REQUIRED: '请上传证书扫描件。',
    EXTERNAL_NO_REQUIRED: '请填写证书编号。',
    STEWARD_TEAM_FORBIDDEN: '团队持证情况只对部门负责人和 HR 开放。',
    SCAN_FORMAT_INVALID: '请上传 PDF、PNG 或 JPEG 文件。',
  },
  automationTasks: {
    'certificationSteward.qualificationPrep': {
      title: '任职准备材料',
      description:
        '员工取得目标岗位的任职资格证书后，把发展目标置为已达成，为主管和 HR 整理任职材料。',
    },
    'examiner.gradingSuggestion': {
      title: '简答题建议分',
      description:
        '交卷后为每道简答题给出建议分、命中与遗漏的要点；最终分由讲师确定。',
    },
    'learningCoach.examFailedPlan': {
      title: '考后补学计划',
      description:
        '考试未通过后，按失分最多的能力项起草学习计划交部门负责人确认，并把可自学的内容发给考生。',
    },
  },
  authzExam: {
    reviewIntegrity: '复核异常答卷',
    voidAttempt: '作废答卷',
    configure: '能力等级规则',
  },
  authz: {
    externalCertificate: {
      title: '外部证书',
      register: '登记',
      verify: '核验',
    },
    examiner: { title: '考官', use: '使用' },
  },
  checklistItems: {
    certificateMissing:
      '新岗位要求《{{title}}》，员工尚无有效证书，请安排取证。',
    certificateNoLongerRequired:
      '新岗位不再要求《{{title}}》，证书仍有效，不因调岗改变。',
  },
};

export const examAdditions = { en, zh };
