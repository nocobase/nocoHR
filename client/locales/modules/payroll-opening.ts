/**
 * 上线准备 · 薪酬期初导入: the wording of the four payroll importers (薪资档案,
 * 参保, 专项附加扣除, 本年个税累计期初) and the authorization titles the server
 * registers (`payroll.opening.authz.*`). Merged into
 * client/locales/{en-US,zh-CN}.ts as `payroll.opening`. Row problems are
 * keyed by the server's codes (server/providers/hr/payroll/opening-imports.ts).
 */

const en = {
  authz: {
    salaryImport: 'Import opening salary files',
    insuranceImport: 'Import enrolments and special deductions',
    taxOpeningImport: 'Import year-to-date tax opening balances',
  },
  collections: {
    payrollTaxOpenings: 'Year-to-date tax opening balances',
  },
  entry: {
    salaryFiles: 'Import opening files',
    enrolments: 'Import',
    deductions: 'Import',
    taxOpenings: 'Import year-to-date tax',
  },
  title: {
    salaryFiles: 'Import opening salary files',
    enrolments: 'Import enrolments',
    deductions: 'Import special additional deductions',
    taxOpenings: 'Import year-to-date tax opening balances',
  },
  description: {
    salaryFiles:
      'Loads each employee’s current salary file from your previous system. It takes effect without the adjustment approval and is recorded as an opening import; importing the same employee and month again corrects it.',
    enrolments:
      'Loads each employee’s social insurance and housing fund enrolment by plan city. Bases outside the plan’s range are adjusted to it; importing the same employee again updates the enrolment.',
    deductions:
      'Loads the special additional deductions employees declared in the tax app. The rows of an employee and year replace that year’s declared items.',
    taxOpenings:
      'For going live mid-year: the cumulative figures from January up to the month before go-live, so cumulative withholding is right in the first month calculated here. The months up to the cut-off month come only from these figures; importing the same employee and year again updates them.',
  },
  steps: {
    template:
      'Download the template, fill in one row per record, then upload it. Nothing is saved until you confirm.',
  },
  template: 'Download template',
  upload: 'Upload file',
  uploadAgain: 'Upload another file',
  checking: 'Checking…',
  summary:
    '{{valid}} rows can be imported ({{create}} new, {{update}} updates); {{errors}} rows have problems.',
  unknownColumns: 'Columns not recognized (ignored): {{columns}}',
  fixFirst: 'Correct the rows with problems in the file and upload it again.',
  confirm: 'Import {{count}} rows',
  done: 'Imported {{rows}} rows: {{created}} new, {{updated}} updated.',
  lastImport: 'Last import: {{at}}',
  cancel: 'Cancel',
  table: {
    row: 'Row',
    employeeNo: 'Employee no.',
    name: 'Name',
    action: 'Result',
    values: 'Values',
    problems: 'Problems',
  },
  actions: {
    create: 'New',
    update: 'Update',
  },
  rowProblem: '{{column}}: {{message}}',
  errors: {
    EMPLOYEE_NO_REQUIRED: 'Fill in the employee number.',
    EMPLOYEE_NOT_FOUND: 'No employee has this number.',
    EMPLOYEE_OUT_OF_SCOPE:
      'This employee is outside the people you may manage.',
    NAME_MISMATCH: 'The employee with this number is {{name}}.',
    DUPLICATE_ROW: 'The same record is already on row {{row}}.',
    VALUE_REQUIRED: 'Required.',
    AMOUNT_INVALID: 'Enter a non-negative amount.',
    MONTH_INVALID: 'Enter a month such as 2026-10.',
    YEAR_INVALID: 'Enter a year such as 2026.',
    MONTH_NOT_IN_YEAR: 'The month must be in {{year}}.',
    END_BEFORE_START: 'The end month is before the start month.',
    STRUCTURE_NOT_FOUND: 'No salary structure has this name.',
    ITEM_NOT_IN_STRUCTURE: 'The row’s salary structure does not use this item.',
    FIELD_NOT_ALLOWED: 'Your permissions do not include this field.',
    BANK_ACCOUNT_INVALID: 'Enter digits (spaces allowed), 4 to 40 characters.',
    VALUE_TOO_LONG: 'Too long.',
    SALARY_MONTH_TAKEN:
      'This month already has a salary file that was not imported as opening data; change it with a salary adjustment.',
    SALARY_MONTH_CALCULATED:
      'Payroll for {{month}} is already approved with this employee’s salary; use a salary adjustment.',
    PLAN_NOT_FOUND: 'No social insurance plan has this city.',
    PLAN_NOT_IN_FORCE: 'The plan is not in force in {{month}}.',
    ACCOUNT_INVALID: 'Use letters, digits and hyphens only.',
    DEDUCTION_TYPE_UNKNOWN:
      'Use one of: children’s education, continuing education, serious illness, housing loan interest, housing rent, elderly support, infant care.',
    HIRED_AFTER_OPENING:
      'The employee was hired on {{date}}, after the cut-off month.',
    TAX_OPENING_AFTER_LOCKED:
      'Payroll for {{month}} is already approved with this employee’s tax; the cut-off month must be {{month}} or later.',
  },
  warnings: {
    BASE_CLAMPED: 'Adjusted to the plan’s range: {{value}}.',
    DEDUCTIONS_REPLACED: 'Replaces the items already declared for {{year}}.',
    RECALCULATE_NEEDED:
      'A payroll month after the cut-off was already calculated; it goes back to draft and must be calculated again.',
    BASIC_DEDUCTION_HIGH:
      'More than the standard deduction for {{months}} months ({{amount}}).',
  },
  failures: {
    IMPORT_HAS_ERRORS:
      'Some rows have problems; correct them and upload the file again.',
    IMPORT_COLUMNS_MISSING:
      'The file has no 工号 column; start from the template.',
    IMPORT_FILE_EMPTY: 'The file has no data rows.',
    IMPORT_FILE_INVALID: 'The file is not a readable Excel workbook.',
  },
};

type Shape<T> = {
  [K in keyof T]: T[K] extends string ? string : Shape<T[K]>;
};

const zh: Shape<typeof en> = {
  authz: {
    salaryImport: '导入期初薪资档案',
    insuranceImport: '导入参保和专项附加扣除',
    taxOpeningImport: '导入个税累计期初',
  },
  collections: {
    payrollTaxOpenings: '个税累计期初',
  },
  entry: {
    salaryFiles: '导入期初档案',
    enrolments: '导入',
    deductions: '导入',
    taxOpenings: '导入个税累计期初',
  },
  title: {
    salaryFiles: '导入期初薪资档案',
    enrolments: '导入参保',
    deductions: '导入专项附加扣除',
    taxOpenings: '导入本年个税累计期初',
  },
  description: {
    salaryFiles:
      '从原系统导入每位员工当前的薪资档案。直接生效，不走调薪审批，记为“期初导入”；同一员工、同一生效月份再次导入会更正这条档案。',
    enrolments:
      '按参保城市导入每位员工的社保公积金参保。超出方案上下限的基数按方案截取；同一员工再次导入会更新其参保。',
    deductions:
      '导入员工在个税 App 中申报的专项附加扣除。同一员工、同一年度的行会替换该年度已登记的项目。',
    taxOpenings:
      '年中上线用：导入本年 1 月到上线前一个月的累计数，第一个在这里算薪的月份才能按累计预扣法算对。截至月份及以前的月份只按这些累计数计算；同一员工、同一年度再次导入会更新。',
  },
  steps: {
    template: '下载模板，每条记录填一行后上传。确认前不会保存任何数据。',
  },
  template: '下载模板',
  upload: '上传文件',
  uploadAgain: '重新上传',
  checking: '正在检查…',
  summary:
    '{{valid}} 行可以导入（新建 {{create}}，更新 {{update}}），{{errors}} 行有问题。',
  unknownColumns: '未识别的列（将忽略）：{{columns}}',
  fixFirst: '请在文件中修正有问题的行，再重新上传。',
  confirm: '导入 {{count}} 行',
  done: '已导入 {{rows}} 行：新建 {{created}}，更新 {{updated}}。',
  lastImport: '上次导入：{{at}}',
  cancel: '取消',
  table: {
    row: '行',
    employeeNo: '工号',
    name: '姓名',
    action: '结果',
    values: '内容',
    problems: '问题',
  },
  actions: {
    create: '新建',
    update: '更新',
  },
  rowProblem: '{{column}}：{{message}}',
  errors: {
    EMPLOYEE_NO_REQUIRED: '请填写工号。',
    EMPLOYEE_NOT_FOUND: '没有这个工号的员工。',
    EMPLOYEE_OUT_OF_SCOPE: '该员工不在你可管理的范围内。',
    NAME_MISMATCH: '这个工号的员工是{{name}}。',
    DUPLICATE_ROW: '与第 {{row}} 行重复。',
    VALUE_REQUIRED: '必填。',
    AMOUNT_INVALID: '请填写不小于 0 的金额。',
    MONTH_INVALID: '请填写月份，如 2026-10。',
    YEAR_INVALID: '请填写年度，如 2026。',
    MONTH_NOT_IN_YEAR: '月份须在 {{year}} 年内。',
    END_BEFORE_START: '结束月早于起始月。',
    STRUCTURE_NOT_FOUND: '没有这个名称的薪资结构。',
    ITEM_NOT_IN_STRUCTURE: '这一行的薪资结构不用这个项目。',
    FIELD_NOT_ALLOWED: '你的权限不包含这个字段。',
    BANK_ACCOUNT_INVALID: '请填写 4 到 40 位数字（可含空格）。',
    VALUE_TOO_LONG: '内容过长。',
    SALARY_MONTH_TAKEN: '该月份已有非期初导入的薪资档案，请通过调薪修改。',
    SALARY_MONTH_CALCULATED:
      '{{month}} 的工资已按该员工的薪资审批，请通过调薪修改。',
    PLAN_NOT_FOUND: '没有这个城市的参保方案。',
    PLAN_NOT_IN_FORCE: '该方案在 {{month}} 不适用。',
    ACCOUNT_INVALID: '只能包含字母、数字和连字符。',
    DEDUCTION_TYPE_UNKNOWN:
      '请填写：子女教育、继续教育、大病医疗、住房贷款利息、住房租金、赡养老人、3岁以下婴幼儿照护。',
    HIRED_AFTER_OPENING: '该员工 {{date}} 入职，晚于截至月份。',
    TAX_OPENING_AFTER_LOCKED:
      '{{month}} 的工资已按该员工的个税审批，截至月份不能早于 {{month}}。',
  },
  warnings: {
    BASE_CLAMPED: '已按方案上下限调整为 {{value}}。',
    DEDUCTIONS_REPLACED: '将替换 {{year}} 年度已登记的项目。',
    RECALCULATE_NEEDED:
      '截至月份之后已有算薪结果，导入后该周期回到草稿，需要重新计算。',
    BASIC_DEDUCTION_HIGH: '超过 {{months}} 个月的标准减除费用（{{amount}}）。',
  },
  failures: {
    IMPORT_HAS_ERRORS: '部分行有问题，请修正后重新上传文件。',
    IMPORT_COLUMNS_MISSING: '文件中没有“工号”列，请从模板开始填写。',
    IMPORT_FILE_EMPTY: '文件没有数据行。',
    IMPORT_FILE_INVALID: '文件不是可读取的 Excel。',
  },
};

export const payrollOpeningAdditions = { en, zh };
