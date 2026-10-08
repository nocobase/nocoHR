/**
 * 上线准备: the go-live checklist page (设置 · 上线准备), 批量开通账号并发激活链接
 * on 员工 and the employee detail page, the public activation page
 * `/activate/:token`, and the authorization titles the server registers
 * (`goLive.authz.*`). Merged into client/locales/{en-US,zh-CN}.ts as `goLive`,
 * plus the navigation and error entries spread into those files.
 */

const en = {
  title: 'Go-live',
  description:
    'Everything a company sets up before it starts using NocoHR, in order. Each step shows where it stands from the data already in the system.',
  remaining_one: '{{count}} step to finish',
  remaining_other: '{{count}} steps to finish',
  allDone: 'Every step is done or marked as not needed.',
  groups: {
    payroll: 'Payroll',
  },
  status: {
    notStarted: 'Not started',
    inProgress: 'In progress',
    done: 'Done',
    skipped: 'Not needed',
    notNeeded: 'Not needed',
  },
  open: 'Open',
  skip: 'Not needed',
  unskip: 'Needed after all',
  skippedToast: '“{{step}}” is marked as not needed.',
  unskippedToast: '“{{step}}” is needed again.',
  steps: {
    config: {
      title: 'Company and system configuration',
      description:
        'The company name and public address are set in the server configuration; mail, Feishu and AI are optional connections.',
      action: 'Mail settings',
    },
    departments: {
      title: 'Organization: departments',
      description:
        'The department tree, entered or imported here, or synchronized from Feishu.',
      action: 'Departments',
    },
    positions: {
      title: 'Positions',
      description: 'The positions employees hold.',
      action: 'Positions',
    },
    employees: {
      title: 'Employees',
      description:
        'The roster of people in service, usually imported from Excel.',
      action: 'Import employees',
    },
    contracts: {
      title: 'Employment contracts',
      description: 'The contract in force of each employee in service.',
      action: 'Contracts',
    },
    leaveOpening: {
      title: 'Opening leave balances',
      description:
        'Each employee’s remaining leave at go-live, imported once for this year.',
      action: 'Leave balances',
    },
    salaries: {
      title: 'Salary files',
      description: 'Each employee’s salary structure and amounts.',
      action: 'Salary files',
    },
    insurance: {
      title: 'Social insurance enrollment',
      description: 'Where and on what base each employee is insured.',
      action: 'Social insurance',
    },
    deductions: {
      title: 'Special additional deductions',
      description:
        'This year’s declared deductions (children, housing, elderly care and the like); not everyone has one.',
      action: 'Social insurance',
    },
    taxOpening: {
      title: 'Year-to-date income tax opening',
      description:
        'The cumulative income and tax of the months before the first payroll in NocoHR. Not needed when that payroll is January’s.',
      action: 'Payroll',
    },
    accounts: {
      title: 'Employee accounts',
      description:
        'Open accounts for employees and send each an activation link to set their own password.',
      action: 'Employees',
    },
    trialPayroll: {
      title: 'Trial payroll',
      description:
        'Calculate one month and compare it with the previous system before going live.',
      action: 'Payroll',
    },
  },
  facts: {
    companyName: 'Company name',
    publicOrigin: 'Public address',
    mail: 'Mail',
    feishu: 'Feishu',
    ai: 'AI model',
    configured: 'Configured',
    notConfigured: 'Not configured',
    count: '{{count}} recorded',
    coverage: '{{covered}} of {{total}} employees in service',
    lastImport: 'Last import {{id}}: {{created}} added, {{updated}} updated',
    lastSync: 'Last Feishu sync: {{status}}',
    syncStatus: {
      running: 'running',
      succeeded: 'succeeded',
      partial: 'partly done',
      failed: 'failed',
    },
    declared: '{{covered}} employees declared for {{year}}',
    notAvailable: 'The import for this step is not installed yet.',
    firstPayrollMonth: 'First payroll month {{month}}',
    accounts:
      '{{activated}} activated · {{pending}} waiting for activation · {{withoutAccount}} without an account',
    cycles: '{{calculated}} of {{cycles}} payroll months calculated',
  },
  firstMonth: {
    label: 'First payroll month in NocoHR',
    description:
      'Decides whether the year-to-date tax opening is needed. Empty: the earliest payroll month, else the current month.',
    save: 'Save',
    saved: 'First payroll month saved.',
  },
  workbench: {
    title: 'Go-live',
    description_one: '{{count}} go-live step is not finished yet.',
    description_other: '{{count}} go-live steps are not finished yet.',
    open: 'Open the checklist',
  },
  authz: {
    title: 'Go-live',
    view: 'View the HR steps',
    viewPayroll: 'View the payroll steps',
    skip: 'Mark HR steps as not needed',
    skipPayroll: 'Mark payroll steps as not needed',
    settings: 'Go-live settings',
  },
  activation: {
    bulkAction: 'Open accounts and send activation links',
    selected_one: '{{count}} selected',
    selected_other: '{{count}} selected',
    select: 'Select {{name}}',
    selectAll: 'Select all rows on this page',
    dialogTitle: 'Open accounts and send activation links',
    dialogDescription:
      'Each employee in service without an account gets one (login: the employee number), linked to their record. Their activation link goes to Feishu when bound, else to their work email; no password is set or shown.',
    scopeSelected_one: 'The selected employee ({{count}})',
    scopeSelected_other: 'The selected employees ({{count}})',
    scopeAll: 'Every employee in service without an account',
    privileged:
      'Accounts with administrator or payroll permissions are never activated by link; set them up on the Users page.',
    submit: 'Open and send',
    submitting: 'Opening…',
    cancel: 'Cancel',
    close: 'Close',
    resultTitle: 'Accounts opened',
    resultSummary:
      '{{sent}} links sent · {{manual}} to hand over · {{skipped}} skipped',
    handOverTitle: 'Hand these links over yourself',
    handOverDescription:
      'These employees have neither Feishu nor a work mailbox that could be reached. Each link is shown only now and opens the account once: give it to the person only.',
    copy: 'Copy link',
    copied: 'Link copied.',
    copyAll: 'Copy all',
    copiedAll: '{{count}} links copied, one line per employee.',
    linkLabel: 'Activation link of {{name}}',
    expires: 'Valid until {{at}}',
    sentBy: {
      feishu: 'Sent by Feishu',
      email: 'Sent to {{to}}',
    },
    skippedReason: {
      hasAccount: 'Already has an account',
      left: 'Has left',
      noEmail: 'No work email: an account needs one',
      emailTaken: 'Another account uses this email: link that one instead',
      loginTaken: 'The login name is taken',
      privileged:
        'Account opened, but it holds administrator or payroll permissions: activate it on the Users page',
      rateLimited: 'Too many links this hour: try again later',
    },
    manualReason: {
      noChannel: 'No Feishu or work email',
      deliveryFailed: 'Sending failed',
      noPublicAddress: 'No public address is configured for links',
    },
    detailTitle: 'Account activation',
    detailActivated: 'Activated on {{at}}',
    detailOpen: 'Link sent {{at}} · valid until {{expires}}',
    detailNone: 'No activation link is open.',
    resend: 'Send activation link',
    resendAgain: 'Send a new link',
    resent: 'A new activation link was sent.',
    revoke: 'Revoke link',
    revoked: 'The activation link was revoked.',
    settingsTitle: 'Activation links',
    linkDays: 'Days a link stays valid',
    linkDaysDescription: 'From 1 to 30 days; a new link replaces the old one.',
    saved: 'Saved.',
  },
  activate: {
    title: 'Activate your account',
    description: 'Set the password you will sign in with.',
    greeting: 'Hello {{name}}',
    login: 'Login: {{login}}',
    company: '{{company}} opened this account for you.',
    passwordHint: 'At least {{min}} characters.',
    password: 'New password',
    confirmPassword: 'Confirm new password',
    passwordMismatch: 'The two passwords differ.',
    submit: 'Set password and sign in',
    submitting: 'Setting…',
    invalid:
      'This link is no longer valid: it was used, replaced, revoked or has expired. Ask HR for a new one.',
    done: 'Your password is set. Signing you in…',
    toLogin: 'Go to sign in',
  },
};

const zh: typeof en = {
  title: '上线准备',
  description:
    '公司开始使用 NocoHR 前要准备的事项，按顺序排列。每一步的状态都来自系统里已有的数据。',
  remaining_one: '还有 {{count}} 步未完成',
  remaining_other: '还有 {{count}} 步未完成',
  allDone: '所有步骤都已完成或标记为不需要。',
  groups: {
    payroll: '薪酬',
  },
  status: {
    notStarted: '未开始',
    inProgress: '进行中',
    done: '已完成',
    skipped: '不需要',
    notNeeded: '不需要',
  },
  open: '前往',
  skip: '不需要',
  unskip: '改为需要',
  skippedToast: '已将“{{step}}”标记为不需要。',
  unskippedToast: '“{{step}}”改为需要。',
  steps: {
    config: {
      title: '公司信息与系统配置',
      description:
        '公司名称和对外访问地址在服务器配置中设置；邮件、飞书和 AI 为可选连接。',
      action: '邮件设置',
    },
    departments: {
      title: '组织：部门',
      description: '部门结构，在这里录入或导入，也可从飞书同步。',
      action: '部门',
    },
    positions: {
      title: '岗位',
      description: '员工所任的岗位。',
      action: '岗位',
    },
    employees: {
      title: '员工',
      description: '在职人员名单，通常从 Excel 导入。',
      action: '导入员工',
    },
    contracts: {
      title: '劳动合同',
      description: '每位在职员工正在履行的合同。',
      action: '劳动合同',
    },
    leaveOpening: {
      title: '期初假期余额',
      description: '上线时每位员工剩余的假期，本年度导入一次。',
      action: '假期余额',
    },
    salaries: {
      title: '薪资档案',
      description: '每位员工的薪资结构和金额。',
      action: '薪资档案',
    },
    insurance: {
      title: '社保参保',
      description: '每位员工的参保地和缴费基数。',
      action: '社保公积金',
    },
    deductions: {
      title: '专项附加扣除',
      description:
        '本年度申报的子女教育、住房、赡养老人等扣除；不是每个人都有。',
      action: '社保公积金',
    },
    taxOpening: {
      title: '本年个税累计期初',
      description:
        '在 NocoHR 首次算薪之前各月的累计收入和已扣税额。首个工资月是 1 月时不需要。',
      action: '算薪',
    },
    accounts: {
      title: '员工账号开通',
      description: '为员工开通账号并发送激活链接，由本人设置密码。',
      action: '员工',
    },
    trialPayroll: {
      title: '试算一期工资',
      description: '上线前算一个月，与原系统核对。',
      action: '算薪',
    },
  },
  facts: {
    companyName: '公司名称',
    publicOrigin: '对外访问地址',
    mail: '邮件',
    feishu: '飞书',
    ai: 'AI 模型',
    configured: '已配置',
    notConfigured: '未配置',
    count: '已有 {{count}} 条',
    coverage: '在职 {{total}} 人中 {{covered}} 人已有',
    lastImport: '最近导入 {{id}}：新增 {{created}}，更新 {{updated}}',
    lastSync: '最近一次飞书同步：{{status}}',
    syncStatus: {
      running: '进行中',
      succeeded: '成功',
      partial: '部分完成',
      failed: '失败',
    },
    declared: '{{year}} 年已有 {{covered}} 人申报',
    notAvailable: '这一步的导入功能尚未安装。',
    firstPayrollMonth: '首个工资月 {{month}}',
    accounts:
      '已激活 {{activated}} 人 · 待激活 {{pending}} 人 · 未开通 {{withoutAccount}} 人',
    cycles: '{{cycles}} 个工资月中已计算 {{calculated}} 个',
  },
  firstMonth: {
    label: 'NocoHR 首个工资月',
    description:
      '决定是否需要导入本年个税累计期初。不填时取最早的工资月，没有则取当前月份。',
    save: '保存',
    saved: '已保存首个工资月。',
  },
  workbench: {
    title: '上线准备',
    description_one: '还有 {{count}} 个上线步骤没有完成。',
    description_other: '还有 {{count}} 个上线步骤没有完成。',
    open: '查看上线清单',
  },
  authz: {
    title: '上线准备',
    view: '查看人事步骤',
    viewPayroll: '查看薪酬步骤',
    skip: '将人事步骤标记为不需要',
    skipPayroll: '将薪酬步骤标记为不需要',
    settings: '上线准备设置',
  },
  activation: {
    bulkAction: '开通账号并发送激活链接',
    selected_one: '已选 {{count}} 人',
    selected_other: '已选 {{count}} 人',
    select: '选择{{name}}',
    selectAll: '选择本页所有行',
    dialogTitle: '开通账号并发送激活链接',
    dialogDescription:
      '为没有账号的在职员工开通账号（登录名为工号）并关联到档案。激活链接优先发到飞书，没有绑定时发到工作邮箱；不会设置或显示密码。',
    scopeSelected_one: '已选的员工（{{count}} 人）',
    scopeSelected_other: '已选的员工（{{count}} 人）',
    scopeAll: '所有没有账号的在职员工',
    privileged:
      '拥有管理员或薪酬权限的账号不会通过链接激活，请在用户页面设置。',
    submit: '开通并发送',
    submitting: '正在开通…',
    cancel: '取消',
    close: '关闭',
    resultTitle: '账号开通结果',
    resultSummary:
      '已发送 {{sent}} 个链接 · 需转交 {{manual}} 个 · 跳过 {{skipped}} 人',
    handOverTitle: '请亲自转交这些链接',
    handOverDescription:
      '这些员工既没有绑定飞书，也无法发送到工作邮箱。链接只在这里显示一次，只能打开一次账号：请只交给本人。',
    copy: '复制链接',
    copied: '已复制链接。',
    copyAll: '复制全部',
    copiedAll: '已复制 {{count}} 个链接，每人一行。',
    linkLabel: '{{name}}的激活链接',
    expires: '有效期至 {{at}}',
    sentBy: {
      feishu: '已通过飞书发送',
      email: '已发送到 {{to}}',
    },
    skippedReason: {
      hasAccount: '已有账号',
      left: '已离职',
      noEmail: '没有工作邮箱：开通账号需要邮箱',
      emailTaken: '该邮箱已被其他账号使用：请改为关联那个账号',
      loginTaken: '登录名已被占用',
      privileged: '账号已开通，但拥有管理员或薪酬权限：请在用户页面激活',
      rateLimited: '本小时发送的链接过多，请稍后再试',
    },
    manualReason: {
      noChannel: '没有飞书或工作邮箱',
      deliveryFailed: '发送失败',
      noPublicAddress: '未配置对外访问地址，链接无法发送',
    },
    detailTitle: '账号激活',
    detailActivated: '已于 {{at}} 激活',
    detailOpen: '链接发送于 {{at}} · 有效期至 {{expires}}',
    detailNone: '没有未使用的激活链接。',
    resend: '发送激活链接',
    resendAgain: '重新发送链接',
    resent: '已发送新的激活链接。',
    revoke: '作废链接',
    revoked: '激活链接已作废。',
    settingsTitle: '激活链接',
    linkDays: '链接有效天数',
    linkDaysDescription: '1 到 30 天；发送新链接后旧链接失效。',
    saved: '已保存。',
  },
  activate: {
    title: '激活账号',
    description: '设置以后登录使用的密码。',
    greeting: '{{name}}，你好',
    login: '登录名：{{login}}',
    company: '{{company}}为你开通了这个账号。',
    passwordHint: '至少 {{min}} 个字符。',
    password: '新密码',
    confirmPassword: '确认新密码',
    passwordMismatch: '两次输入的密码不一致。',
    submit: '设置密码并登录',
    submitting: '正在设置…',
    invalid:
      '这个链接已失效：已使用、已被新链接替换、已作废或已过期。请联系 HR 重新发送。',
    done: '密码已设置，正在登录…',
    toLogin: '前往登录',
  },
};

const enShared = {
  navigation: { goLive: 'Go-live' },
  errors: {
    ACTIVATION_LINK_INVALID:
      'This activation link is no longer valid. Ask HR for a new one.',
    ACTIVATION_LIMITED: 'Too many attempts from this network. Try again later.',
    ACTIVATION_RATE_LIMITED:
      'Too many activation links were sent. Try again later.',
    ACTIVATION_TOO_SOON:
      'A link was just sent to this employee. Wait a minute before sending another.',
    ACTIVATION_BATCH_TOO_LARGE: 'Choose at most {{max}} employees at a time.',
    ACCOUNT_ALREADY_ACTIVATED:
      'This account is already activated; reset its password instead.',
    PASSWORD_TOO_SHORT: 'The password must have at least {{min}} characters.',
    PASSWORD_TOO_LONG: 'The password must have at most {{max}} characters.',
  },
};

const zhShared: typeof enShared = {
  navigation: { goLive: '上线准备' },
  errors: {
    ACTIVATION_LINK_INVALID: '这个激活链接已失效，请联系 HR 重新发送。',
    ACTIVATION_LIMITED: '当前网络的尝试次数过多，请稍后再试。',
    ACTIVATION_RATE_LIMITED: '发送的激活链接过多，请稍后再试。',
    ACTIVATION_TOO_SOON: '刚给这位员工发过链接，请一分钟后再发。',
    ACTIVATION_BATCH_TOO_LARGE: '每次最多选择 {{max}} 名员工。',
    ACCOUNT_ALREADY_ACTIVATED: '这个账号已激活；如需更换密码，请重置密码。',
    PASSWORD_TOO_SHORT: '密码至少需要 {{min}} 个字符。',
    PASSWORD_TOO_LONG: '密码最多 {{max}} 个字符。',
  },
};

export const goLiveAdditions = {
  en: { goLive: en, ...enShared },
  zh: { goLive: zh, ...zhShared },
};
