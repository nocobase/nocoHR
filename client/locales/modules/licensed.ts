/**
 * V4-14 行业方案 · 持证上岗: the wording of the step's pages and mounted
 * pieces, and the authorization titles the server registers
 * (`licensed.authz.*`). Merged into client/locales/{en-US,zh-CN}.ts as
 * `licensed`, plus the navigation, error, AI-task, checklist, permission-set,
 * audit-kind and plugin override entries spread into those files. The
 * demonstration pages carry no "demo" wording (the user's decision).
 */

const en = {
  authz: {
    settings: 'Licensed operation settings',
    manage: 'Manage',
    configuration: 'Industry pack settings',
    shift: 'Shift requirements',
    manageRequiredCertifications: 'Set required certifications',
    shifts: 'Shifts',
    forklift: 'Forklift dispatch',
    view: 'View',
    dispatch: 'Register a dispatch',
    exportStartTrace: 'Export the work order operator trace',
    exportPermissionChanges: 'Export permission changes',
  },
  settings: {
    title: 'Licensed operation',
    description:
      'Certified to operate: certificates decide which business operations people may use. Turning the pack off leaves every other feature as it is.',
    pack: 'Industry pack',
    packDescription:
      'When on, a valid or expiring certificate grants the permission sets assigned to its certification in Settings → Authorization; expiry, revocation or leaving withdraws them at the next request.',
    enabled: 'Turn on licensed operation',
    enabledHint:
      'Off: certifications grant nothing, schedules are not checked against certificates and job changes are not checked.',
    scheduleCheck: 'Check schedules against required certifications',
    scheduleCheckHint:
      'A shift that requires a certification cannot be saved, published or swapped for someone without a certificate valid until the shift ends.',
    transferCheck: 'Check certificates after a transfer or promotion',
    transferCheckHint:
      'The certification steward tells HR and the new department head which certificates still bring operations the new position no longer requires.',
    certificationOnly: 'Obtainable only through a certification',
    certificationOnlyDescription:
      'These permission sets can be assigned to certifications only; assigning them to a user, a department, department heads or a position is refused.',
    otherAssignments:
      'Assigned to {{count}} non-certification subjects: remove those first',
    protectedByOther: 'Protected by the platform',
    assignedTo: 'Certifications: {{count}}',
    noSets: 'No permission sets yet.',
    save: 'Save settings',
    saved: 'Licensed operation settings saved.',
    conflict:
      'Someone else changed these settings. Reload the page and try again.',
    history: 'Change log',
    historyDescription:
      'Switch changes and changes to the certification-only list. Each is also written to the audit log.',
    historyEmpty: 'No changes yet.',
    historyEnabled: 'Turned {{state}}',
    historyList: 'Certification-only: {{list}}',
    on: 'on',
    off: 'off',
    none: 'none',
    prepare: 'Acceptance data',
    prepareDescription:
      'Development only: gives 李敏 and 刘洋 a valid CNC 岗位上岗证 and makes the machining shifts require it. Existing certificates and requirements are kept.',
    prepareButton: 'Prepare acceptance data',
    prepared: 'Prepared: {{people}}; shifts updated: {{shifts}}.',
    openAuthorization: 'Open Settings → Authorization',
  },
  shifts: {
    title: 'Required certifications of shifts',
    description:
      'Someone scheduled onto a shift must hold every certification it requires until the shift ends.',
    checkingOff:
      'The schedule check is off: requirements are kept but not enforced.',
    shift: 'Shift',
    required: 'Required certifications',
    noRequirement: 'None',
    edit: 'Edit',
    save: 'Save',
    cancel: 'Cancel',
    saved: 'Required certifications of {{shift}} saved.',
    field: 'Required certifications',
    fieldHint:
      'Saved on its own: a shift already in use can gain or lose a requirement.',
    external: 'External',
  },
  grants: {
    title: 'What your certificates allow',
    canOperate: 'Allows: {{operations}}',
    open: 'Open {{title}}',
    willLose: 'After it expires, these can no longer be used: {{operations}}',
  },
  checks: {
    rule: 'Certification',
    CERTIFICATION_MISSING: 'no valid {{certification}}',
    CERTIFICATION_EXPIRES_BEFORE_SHIFT_END:
      '{{certification}} expires on {{expiresAt}}, before the shift ends',
  },
  forklift: {
    description:
      'Register a warehouse dispatch on the forklift. Only holders of a verified forklift certificate can register; each entry keeps the certificate number.',
    noticeTitle: 'Certified to operate',
    notice:
      'Registering comes from the permission set assigned to the forklift certificate. When the certificate expires or is revoked, registering stops without anyone touching permissions.',
    order: 'Dispatch note {{no}}',
    forklift: 'Forklift {{no}}',
    warehouse: 'Warehouse',
    items: 'Goods',
    code: 'Part',
    quantity: 'Quantity',
    dispatch: 'Register dispatch',
    dispatched: 'Dispatch registered',
    alreadyDispatched:
      'You already registered this dispatch ({{time}}); it is not recorded twice.',
    cannotDispatch:
      'You do not hold a valid forklift certificate, so you cannot register a dispatch.',
    history: 'Registrations',
    none: 'No registrations yet',
    registrant: 'Registered by',
    at: 'Registered at',
    certificateNo: 'Certificate',
    statusAtRegister: 'Certificate status then',
  },
  audit: {
    tab: 'Licensed operation',
    startTrace: 'Work order operator trace',
    startTraceDescription:
      'For each operation of a work order: who registered, when, the certificate number and status then, its status now, and when they completed the required courses.',
    workOrderNo: 'Work order or dispatch note',
    operationNo: 'Operation (optional)',
    show: 'Show',
    download: 'Download Excel',
    registrant: 'Registered by',
    at: 'Registered at',
    operation: 'Operation',
    certificateNo: 'Certificate',
    statusThen: 'Status then',
    statusNow: 'Status now',
    courses: 'Required courses',
    notDone: 'not completed',
    open: 'Open record',
    permissionChanges: 'Permission changes',
    permissionChangesDescription:
      'Permission sets a person gained or lost through certificates or changes of the certification’s assignments, with the reason and the record behind it.',
    person: 'Employee',
    certification: 'Certification',
    by: 'By',
    byPerson: 'Person',
    byCertification: 'Certification',
    from: 'From',
    to: 'To',
    date: 'Date',
    change: 'Change',
    sets: 'Permission sets',
    reason: 'Reason',
    empty: 'Nothing in this period.',
    choose: 'Choose',
    changes: { gained: 'Gained', lost: 'Lost', kept: 'Continued' },
    reasons: {
      issue: 'Issued',
      renew: 'Renewed',
      expire: 'Expired',
      revoke: 'Revoked',
      verify: 'Verified',
      leave: 'Left',
      assignment: 'Assignment changed',
    },
    status: {
      valid: 'Valid',
      expiring: 'Expiring',
      expired: 'Expired',
      revoked: 'Revoked',
      superseded: 'Renewed',
      pending: 'Pending verification',
    },
  },
};

type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : Shape<T[K]>;
};

const zh: Shape<typeof en> = {
  authz: {
    settings: '持证上岗设置',
    manage: '管理',
    configuration: '行业方案设置',
    shift: '班次资质要求',
    manageRequiredCertifications: '维护要求的认证',
    shifts: '班次',
    forklift: '叉车出库登记',
    view: '查看',
    dispatch: '登记出库',
    exportStartTrace: '导出工单人员追溯',
    exportPermissionChanges: '导出权限变化记录',
  },
  settings: {
    title: '持证上岗',
    description:
      '证书决定业务系统中的操作权限。关闭本方案时，其他功能全部照常使用。',
    pack: '行业方案',
    packDescription:
      '开启后，持有有效或即将到期证书的人获得“设置 → 授权”中分配给该认证的权限集；证书到期、吊销或离职后，下一次请求即失去。',
    enabled: '启用持证上岗',
    enabledHint:
      '关闭时认证不带来任何权限，排班不按证书校验，调岗不做资质检查。',
    scheduleCheck: '排班按班次要求的认证校验',
    scheduleCheckHint:
      '班次要求认证时，到班次结束仍没有有效证书的人不能排入、发布或换入该班次。',
    transferCheck: '调岗、晋升后做资质检查',
    transferCheckHint:
      '认证管家提醒 HR 和新部门负责人：员工仍持有哪些新岗位不再要求、但仍带来操作权限的证书。',
    certificationOnly: '只能经认证获得的权限集',
    certificationOnlyDescription:
      '这些权限集只能分配给认证；分配给用户、部门、部门负责人或岗位时，系统拒绝并提示只能通过认证获得。',
    otherAssignments: '已分配给 {{count}} 个非认证对象，请先移除',
    protectedByOther: '平台保护',
    assignedTo: '已分配给 {{count}} 个认证',
    noSets: '还没有权限集。',
    save: '保存设置',
    saved: '持证上岗设置已保存。',
    conflict: '设置已被他人修改，请刷新页面后重试。',
    history: '变更记录',
    historyDescription: '开关变化和“只能经认证获得”的变化，同时写入审计日志。',
    historyEmpty: '暂无变更。',
    historyEnabled: '{{state}}持证上岗',
    historyList: '只能经认证获得：{{list}}',
    on: '开启',
    off: '关闭',
    none: '无',
    prepare: '验收数据',
    prepareDescription:
      '仅开发环境：为李敏、刘洋补齐有效的 CNC 岗位上岗证，并让机加工早班、中班、夜班要求该证书；已有的证书和要求保持不变。',
    prepareButton: '准备验收数据',
    prepared: '已准备：{{people}}；已更新班次：{{shifts}}。',
    openAuthorization: '打开“设置 → 授权”',
  },
  shifts: {
    title: '班次要求的认证',
    description: '排入班次的人，须在班次结束前一直持有班次要求的全部认证。',
    checkingOff: '排班资质校验已关闭：要求会保留，但暂不校验。',
    shift: '班次',
    required: '要求的认证',
    noRequirement: '不要求',
    edit: '修改',
    save: '保存',
    cancel: '取消',
    saved: '“{{shift}}”要求的认证已保存。',
    field: '要求的认证',
    fieldHint: '单独保存：已经排过的班次也可以增减要求。',
    external: '外部证书',
  },
  grants: {
    title: '证书带来的操作',
    canOperate: '可操作：{{operations}}',
    open: '进入{{title}}',
    willLose: '到期后将不能使用：{{operations}}',
  },
  checks: {
    rule: '资质',
    CERTIFICATION_MISSING: '没有有效的{{certification}}',
    CERTIFICATION_EXPIRES_BEFORE_SHIFT_END:
      '{{certification}}将于 {{expiresAt}} 到期，早于班次结束',
  },
  forklift: {
    description:
      '叉车出库时登记。只有持有已核验叉车证的人才能登记，每次登记都会记下当时所持证书的编号。',
    noticeTitle: '持证上岗',
    notice:
      '登记权限来自分配给叉车证的权限集。证书过期或被吊销后，无需人工调整权限，登记按钮即自动失效。',
    order: '出库单 {{no}}',
    forklift: '叉车 {{no}}',
    warehouse: '仓库',
    items: '出库明细',
    code: '零件',
    quantity: '数量',
    dispatch: '登记出库',
    dispatched: '已登记出库',
    alreadyDispatched: '你刚才已登记过这张出库单（{{time}}），不再重复记录。',
    cannotDispatch: '你没有有效的叉车证，不能登记出库。',
    history: '登记记录',
    none: '尚无登记',
    registrant: '登记人',
    at: '登记时间',
    certificateNo: '证书编号',
    statusAtRegister: '登记时证书状态',
  },
  audit: {
    tab: '持证上岗',
    startTrace: '工单人员追溯',
    startTraceDescription:
      '按工序列出登记人、登记时间、登记时的证书编号与状态、证书当前状态，以及登记人必修课程的完成时间。',
    workOrderNo: '工单号或出库单号',
    operationNo: '工序号（可选）',
    show: '查看',
    download: '下载 Excel',
    registrant: '登记人',
    at: '登记时间',
    operation: '工序',
    certificateNo: '证书编号',
    statusThen: '登记时状态',
    statusNow: '当前状态',
    courses: '必修课程',
    notDone: '未完成',
    open: '原始记录',
    permissionChanges: '权限变化记录',
    permissionChangesDescription:
      '某人或某认证在一段时间内，因证书状态变化或认证的分配变化而获得、失去的权限集，每行附原因和依据记录。',
    person: '员工',
    certification: '认证',
    by: '按',
    byPerson: '员工',
    byCertification: '认证',
    from: '开始日期',
    to: '结束日期',
    date: '日期',
    change: '变化',
    sets: '权限集',
    reason: '原因',
    empty: '这段时间没有变化。',
    choose: '请选择',
    changes: { gained: '获得', lost: '失去', kept: '延续' },
    reasons: {
      issue: '发证',
      renew: '续发',
      expire: '到期',
      revoke: '吊销',
      verify: '核验',
      leave: '离职',
      assignment: '分配变更',
    },
    status: {
      valid: '有效',
      expiring: '即将到期',
      expired: '已过期',
      revoked: '已吊销',
      superseded: '已续发',
      pending: '待核验',
    },
  },
};

const enShared = {
  navigation: {
    licensedOperationSettings: 'Licensed operation',
    demoForkliftDispatch: 'Forklift dispatch',
  },
  permissionSets: {
    forkliftOperator: 'Forklift dispatch',
  },
  errors: {
    CERTIFICATE_REQUIRED:
      'You do not hold a valid certificate for this operation, so it cannot be registered.',
    CERTIFICATION_ONLY_HAS_OTHER_ASSIGNMENTS:
      '{{permissionSet}} is still assigned to something other than a certification. Remove that assignment in Settings → Authorization first.',
    PERMISSION_SET_PROTECTED:
      '{{permissionSet}} is protected by the platform and cannot be listed.',
    PERMISSION_SET_NOT_FOUND:
      'The permission set {{permissionSet}} does not exist.',
    RECIPIENT_NOT_ALLOWED:
      'The notice can go only to the task owner and the new department head.',
    NOTHING_TO_SEND:
      'This job change leaves no certificate for HR to decide on.',
  },
  automationTasks: {
    'certificationSteward.transferCheck': {
      title: 'Qualification check after a job change',
      description:
        'After a transfer or promotion: tells HR and the new department head which certificates still bring operations the new position no longer requires; HR decides.',
    },
  },
  checklistItems: {
    licensedGrantsRetained:
      '{{title}} still allows {{operations}}, which {{position}} no longer requires. HR decides whether to keep or revoke it.',
  },
  overrides: {
    '@nocobase/app-plugin-authorization': {
      errors: {
        subjectNotAllowed:
          'This permission set cannot be assigned to the chosen subject: certified-operation permissions can only be obtained through a certification.',
      },
    },
  },
};

const zhShared: typeof enShared = {
  navigation: {
    licensedOperationSettings: '持证上岗',
    demoForkliftDispatch: '叉车出库登记',
  },
  permissionSets: {
    forkliftOperator: '叉车出库登记',
  },
  errors: {
    CERTIFICATE_REQUIRED: '你没有这项操作要求的有效证书，不能登记。',
    CERTIFICATION_ONLY_HAS_OTHER_ASSIGNMENTS:
      '{{permissionSet}} 仍分配给认证以外的对象，请先在“设置 → 授权”中移除。',
    PERMISSION_SET_PROTECTED: '{{permissionSet}} 由平台保护，不能列入。',
    PERMISSION_SET_NOT_FOUND: '权限集 {{permissionSet}} 不存在。',
    RECIPIENT_NOT_ALLOWED: '提醒只能发给任务负责人和新部门负责人。',
    NOTHING_TO_SEND: '这次调岗没有需要 HR 决定的证书。',
  },
  automationTasks: {
    'certificationSteward.transferCheck': {
      title: '调岗资质检查',
      description:
        '调岗、晋升处理完成后：提醒 HR 和新部门负责人，员工仍持有哪些新岗位不再要求、但仍带来操作权限的证书，由 HR 决定保留或吊销。',
    },
  },
  checklistItems: {
    licensedGrantsRetained:
      '仍持有{{title}}，仍可使用{{operations}}；{{position}}不再要求，由 HR 决定是否保留。',
  },
  overrides: {
    '@nocobase/app-plugin-authorization': {
      errors: {
        subjectNotAllowed:
          '该权限集不能分配给所选对象：持证上岗的操作权限只能通过认证获得。',
      },
    },
  },
};

export const licensedAdditions = {
  en: { licensed: en, ...enShared },
  zh: { licensed: zh, ...zhShared },
};
