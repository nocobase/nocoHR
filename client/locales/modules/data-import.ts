/**
 * 初始数据导入 (上线准备): the wording of the department, position, contract
 * and opening-leave-balance importers (`client/components/talent/data-import-page.tsx`
 * and the pages that mount it). Merged into client/locales/{en-US,zh-CN}.ts
 * as `dataImport`, plus the endpoint errors spread into `talent.errors`.
 * `dataImport.authz.importBalances` is the title the server registers for
 * talent.leaveRequest's importBalances action.
 */

const en = {
  authz: {
    importBalances: 'Import opening balances',
  },
  open: 'Import',
  openBalances: 'Import opening balances',
  template: 'Download template',
  upload: 'Upload a file',
  uploadHint:
    'Fill in the template and upload it. Nothing is written until you confirm the preview.',
  columnsLabel: 'Columns',
  required: 'required',
  failed: 'The file could not be imported',
  preview: 'Preview',
  line: 'Row',
  result: 'Result',
  hasErrors:
    '{{count}} of {{total}} rows have problems. Fix them in the file and upload it again.',
  ready:
    'No problems found: {{created}} to create, {{updated}} to update, {{unchanged}} unchanged.',
  confirm: 'Import',
  done: 'Imported: {{created}} created, {{updated}} updated, {{unchanged}} unchanged.',
  doneDetail: 'Batch {{batch}}',
  action: {
    create: 'Create',
    update: 'Update',
    unchanged: 'Unchanged',
  },
  newFamilies: 'These job families will be created: {{titles}}',
  departments: {
    title: 'Import departments',
    description:
      'Create or update departments by department code. Parents may come before or after their children in the file.',
    columns: {
      code: 'Department code',
      title: 'Department name',
      parentCode: 'Parent department code',
      managerNo: 'Head employee no.',
      sortOrder: 'Sort order',
    },
  },
  positions: {
    title: 'Import positions',
    description:
      'Create or update positions by position code. A job family that does not exist yet is created. Empty optional cells leave stored values unchanged.',
    columns: {
      code: 'Position code',
      title: 'Position name',
      family: 'Job family',
      grade: 'Grade',
      departmentCode: 'Department code',
    },
  },
  contracts: {
    title: 'Import contracts',
    description:
      'Import labour contracts, including past ones, by contract number. Contracts that have ended are recorded as history and raise no renewal reminder; one compliance check runs after the import.',
    columns: {
      employeeNo: 'Employee no.',
      contractNo: 'Contract no.',
      type: 'Contract type',
      startDate: 'Start date',
      endDate: 'End date',
      signedAt: 'Signed on',
      probationEndDate: 'Probation ends',
      note: 'Note',
    },
  },
  leaveBalances: {
    title: 'Import opening leave balances',
    description:
      'Each row sets a leave balance for the year as of go-live, recorded as an "opening import" adjustment. Leave taken in the system afterwards is deducted from it. Only leave types that keep a balance can be imported.',
    columns: {
      employeeNo: 'Employee no.',
      leaveType: 'Leave type',
      year: 'Year',
      opening: 'Opening balance (days)',
      used: 'Used (days)',
      note: 'Note',
    },
  },
  errors: {
    REQUIRED: 'Required',
    CODE_INVALID: 'Letters, digits, - _ . only, up to 64 characters',
    TOO_LONG: 'Too long',
    DUPLICATE_IN_FILE: 'Appears more than once in the file',
    PARENT_NOT_FOUND: 'No such department in the file or the system',
    DEPARTMENT_CYCLE: 'The parent chain would loop back to this department',
    EMPLOYEE_NOT_FOUND: 'No employee with this number',
    MANAGER_NO_ACCOUNT: 'This employee has no login account to be the head',
    INTEGER_INVALID: 'Must be a whole number',
    DEPARTMENT_NOT_FOUND: 'No department with this code',
    CONTRACT_TYPE_INVALID:
      'Use fixed term, open-ended, internship or labour service',
    DATE_INVALID: 'Not a date (use YYYY-MM-DD)',
    OPEN_ENDED_HAS_END: 'An open-ended contract has no end date',
    END_REQUIRED: 'A fixed-term contract needs an end date',
    END_BEFORE_START: 'Ends before it starts',
    PROBATION_OUTSIDE: 'Outside the contract term',
    CONTRACT_NO_TAKEN: 'This contract number exists with different details',
    CONTRACT_OVERLAP: "Overlaps another of the employee's contracts",
    CONTRACT_ACTIVE_EXISTS: 'The employee already has a contract in effect',
    EMPLOYEE_LEFT: 'The employee has left; the balance is frozen',
    LEAVE_TYPE_NOT_FOUND: 'No leave type with this name or code',
    LEAVE_TYPE_NO_BALANCE: 'This leave type keeps no balance',
    YEAR_INVALID: 'Not a year',
    DAYS_INVALID: 'Days between 0 and 366, up to 4 decimals',
  },
};

type Shape = typeof en;

const zh: Shape = {
  authz: {
    importBalances: '导入期初余额',
  },
  open: '导入',
  openBalances: '导入期初余额',
  template: '下载模板',
  upload: '上传文件',
  uploadHint: '按模板填写后上传。确认预览前不会写入任何数据。',
  columnsLabel: '列',
  required: '必填',
  failed: '文件无法导入',
  preview: '预览',
  line: '行号',
  result: '结果',
  hasErrors:
    '{{total}} 行中有 {{count}} 行存在问题，请在文件中修正后重新上传。',
  ready:
    '未发现问题：新建 {{created}} 条，更新 {{updated}} 条，{{unchanged}} 条无变化。',
  confirm: '确认导入',
  done: '导入完成：新建 {{created}} 条，更新 {{updated}} 条，{{unchanged}} 条无变化。',
  doneDetail: '批次 {{batch}}',
  action: {
    create: '新建',
    update: '更新',
    unchanged: '无变化',
  },
  newFamilies: '将新建以下岗位序列：{{titles}}',
  departments: {
    title: '导入部门',
    description: '按部门编码新建或更新部门。上级部门在文件中的先后不限。',
    columns: {
      code: '部门编码',
      title: '部门名称',
      parentCode: '上级部门编码',
      managerNo: '负责人工号',
      sortOrder: '排序',
    },
  },
  positions: {
    title: '导入岗位',
    description:
      '按岗位编码新建或更新岗位。尚不存在的岗位序列会一并新建；选填列留空时保留系统中的原值。',
    columns: {
      code: '岗位编码',
      title: '岗位名称',
      family: '岗位序列',
      grade: '职级',
      departmentCode: '所属部门编码',
    },
  },
  contracts: {
    title: '导入劳动合同',
    description:
      '按合同编号导入劳动合同，含历史合同。已到期的合同作为历史记录，不产生续签提醒；导入完成后统一做一次用工合规检查。',
    columns: {
      employeeNo: '工号',
      contractNo: '合同编号',
      type: '合同类型',
      startDate: '开始日期',
      endDate: '结束日期',
      signedAt: '签订日期',
      probationEndDate: '试用期结束日期',
      note: '备注',
    },
  },
  leaveBalances: {
    title: '导入期初假期余额',
    description:
      '每行设定员工某类假期在上线时的年度余额，记为一条“期初导入”调整；之后在系统中请的假从中扣减。只能导入有余额的假期类型。',
    columns: {
      employeeNo: '工号',
      leaveType: '假期类型',
      year: '年度',
      opening: '期初余额(天)',
      used: '已用(天)',
      note: '备注',
    },
  },
  errors: {
    REQUIRED: '必填',
    CODE_INVALID: '只能包含字母、数字和 - _ .，最多 64 个字符',
    TOO_LONG: '内容过长',
    DUPLICATE_IN_FILE: '在文件中重复出现',
    PARENT_NOT_FOUND: '文件和系统中都没有这个部门',
    DEPARTMENT_CYCLE: '上级关系会形成循环',
    EMPLOYEE_NOT_FOUND: '没有这个工号的员工',
    MANAGER_NO_ACCOUNT: '该员工没有登录账号，不能担任负责人',
    INTEGER_INVALID: '须为整数',
    DEPARTMENT_NOT_FOUND: '没有这个编码的部门',
    CONTRACT_TYPE_INVALID: '请填写 固定期限、无固定期限、实习 或 劳务',
    DATE_INVALID: '不是有效日期（格式 YYYY-MM-DD）',
    OPEN_ENDED_HAS_END: '无固定期限合同不填结束日期',
    END_REQUIRED: '固定期限合同须填结束日期',
    END_BEFORE_START: '结束日期早于开始日期',
    PROBATION_OUTSIDE: '不在合同期限内',
    CONTRACT_NO_TAKEN: '该合同编号已存在且内容不同',
    CONTRACT_OVERLAP: '与该员工的其他合同期限重叠',
    CONTRACT_ACTIVE_EXISTS: '该员工已有一份生效中的合同',
    EMPLOYEE_LEFT: '该员工已离职，余额已冻结',
    LEAVE_TYPE_NOT_FOUND: '没有这个名称或编码的假期类型',
    LEAVE_TYPE_NO_BALANCE: '该假期类型不设余额',
    YEAR_INVALID: '不是有效年度',
    DAYS_INVALID: '天数须在 0 到 366 之间，最多 4 位小数',
  },
};

/** Endpoint errors, translated through `talent.errors` like every NocoHR endpoint's. */
const enErrors = {
  DATA_IMPORT_HEADER_INVALID:
    'The header must contain the template columns ({{expected}}). Download the template.',
  IMPORT_ORG_MASTER_EXTERNAL:
    'Departments come from the office suite directory (Settings → Organization sync), so they cannot be imported.',
  IMPORT_EMPTY: 'The file has no data rows.',
  ADJUSTMENT_HISTORY_FULL:
    'This balance has too many adjustments to record another.',
};

const zhErrors: typeof enErrors = {
  DATA_IMPORT_HEADER_INVALID:
    '表头须包含模板中的列（{{expected}}），请下载模板。',
  IMPORT_ORG_MASTER_EXTERNAL:
    '部门以办公软件通讯录为准（设置 / 组织同步），不能导入。',
  IMPORT_EMPTY: '文件中没有数据行。',
  ADJUSTMENT_HISTORY_FULL: '该余额的调整记录已满，不能再记录。',
};

export const dataImportAdditions = {
  en: { dataImport: en, errors: enErrors },
  zh: { dataImport: zh, errors: zhErrors },
};
