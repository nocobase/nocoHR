/**
 * V3-08 demonstration data (01-演示案例.md "V3 主推场景：一个新岗位，从定义到
 * 有人胜任" and "V3 数据：人才发展"): 销售部 with 程远 as its head, the
 * 营销序列 and its 销售工程师 position, the two sales competencies the
 * framework advisor reuses, and three sales engineers to be prepared for the
 * new 销售解决方案经理 position, which the demo creates by hand. Only the demo
 * seed reads this module. Every mobile and ID number is an obvious test value.
 */

export const SALES_DEPARTMENT = {
  id: 'sales',
  code: 'SALES',
  titleKey: 'departments.seed.sales',
  parentId: 'qiheng',
  managerAccount: 'mgr_sales',
  sortOrder: 4,
} as const;

export const SALES_JOB_FAMILY = {
  id: 'jf-sales',
  code: 'sales',
  title: '营销序列',
  description: '销售、客户与解决方案岗位',
  sortOrder: 2,
} as const;

export const SALES_POSITIONS = [
  {
    id: 'pos-sales-engineer',
    code: 'sales-engineer',
    title: '销售工程师',
    jobFamilyId: 'jf-sales',
    grade: 'S2',
    responsibilities:
      '负责所辖整车厂客户的制动卡钳与转向节产品销售：日常客户拜访与关系维护、询价响应与报价跟进、订单与交付协调、回款跟踪，以及收集客户需求和竞品信息。',
    sortOrder: 0,
  },
  {
    id: 'pos-sales-director',
    code: 'sales-director',
    title: '销售总监',
    jobFamilyId: 'jf-sales',
    grade: 'S4',
    responsibilities: null,
    sortOrder: 2,
  },
] as const;

type Levels = readonly (readonly [string, string])[];

export const SALES_COMPETENCIES: readonly {
  id: string;
  code: string;
  title: string;
  category: 'skill' | 'quality' | 'qualification';
  description: string;
  maxLevel: number;
  levels: Levels;
}[] = [
  {
    id: 'comp-brake-product',
    code: 'brake-product-knowledge',
    title: '制动系统产品知识',
    category: 'skill',
    description:
      '掌握制动卡钳、转向节等产品的结构、材料、性能参数与主要工艺，能据此回答客户技术问题的能力。',
    maxLevel: 5,
    levels: [
      ['入门', '能说出公司主要产品的名称、适配车型和基本结构。'],
      ['基础', '能对照产品技术手册向客户讲解产品结构与主要性能参数。'],
      [
        '熟练',
        '能独立回答客户关于材料、工艺与性能测试的常见技术问题，并指出与竞品的差异。',
      ],
      [
        '精通',
        '能根据客户新平台的需求初步判断适配方案，并组织技术中心完成技术交流。',
      ],
      ['专家', '能主导新产品的客户推介，参与制定产品规划与技术路线。'],
    ],
  },
  {
    id: 'comp-crm',
    code: 'customer-relationship',
    title: '客户关系管理',
    category: 'skill',
    description:
      '建立和维护与整车厂采购、质量、研发等关键人员的业务关系，并跟进客户满意度的能力。',
    maxLevel: 5,
    levels: [
      ['入门', '按计划完成客户拜访，并在系统中记录拜访内容。'],
      ['基础', '掌握负责客户的组织结构和关键联系人，按月更新客户档案。'],
      [
        '熟练',
        '能识别客户决策链中的关键角色，协调解决客户投诉并在约定时间内闭环。',
      ],
      [
        '精通',
        '能制定重点客户年度关系计划，并推动公司高层与客户高层的定期交流。',
      ],
      ['专家', '能与战略客户建立长期合作机制，带领团队拓展新客户。'],
    ],
  },
];

/** 销售工程师's confirmed requirements (V3-08 测试数据). */
export const SALES_ENGINEER_REQUIREMENTS = [
  {
    id: 'req-sales-engineer-product',
    competencyId: 'comp-brake-product',
    requiredLevel: 3,
    mandatory: true,
  },
  {
    id: 'req-sales-engineer-crm',
    competencyId: 'comp-crm',
    requiredLevel: 2,
    mandatory: false,
  },
] as const;

export interface SalesPerson {
  employeeId: string;
  employeeNo: string;
  name: string;
  account: string;
  positionId: string;
  managerEmployeeId: string | null;
  gender: 'male' | 'female';
  hireDate: string;
  mobile: string;
  idNumber: string;
  birthDate: string;
}

export const SALES_PEOPLE: readonly SalesPerson[] = [
  {
    employeeId: 'emp-mgr-sales',
    employeeNo: 'QH5001',
    name: '程远',
    account: 'mgr_sales',
    positionId: 'pos-sales-director',
    managerEmployeeId: null,
    gender: 'male',
    hireDate: '2021-03-01',
    mobile: '13900005001',
    idNumber: '999999198203030501',
    birthDate: '1982-03-03',
  },
  {
    employeeId: 'emp-sales-gaoyuan',
    employeeNo: 'QH5101',
    name: '高原',
    account: 'emp_sales_1',
    positionId: 'pos-sales-engineer',
    managerEmployeeId: 'emp-mgr-sales',
    gender: 'male',
    hireDate: '2020-07-06',
    mobile: '13900005101',
    idNumber: '999999199005050511',
    birthDate: '1990-05-05',
  },
  {
    employeeId: 'emp-sales-linfeng',
    employeeNo: 'QH5102',
    name: '林峰',
    account: 'emp_sales_2',
    positionId: 'pos-sales-engineer',
    managerEmployeeId: 'emp-mgr-sales',
    gender: 'male',
    hireDate: '2022-04-11',
    mobile: '13900005102',
    idNumber: '999999199306060512',
    birthDate: '1993-06-06',
  },
  {
    employeeId: 'emp-sales-xuke',
    employeeNo: 'QH5103',
    name: '许可',
    account: 'emp_sales_3',
    positionId: 'pos-sales-engineer',
    managerEmployeeId: 'emp-mgr-sales',
    gender: 'female',
    hireDate: '2024-02-19',
    mobile: '13900005103',
    idNumber: '999999199707070523',
    birthDate: '1997-07-07',
  },
];

/**
 * The sales engineers' assessments by 程远, so the target-position gaps come
 * out 高原 < 林峰 < 许可 once the new position's model is confirmed.
 */
export const SALES_ASSESSMENTS: readonly [
  id: string,
  employeeId: string,
  competencyId: string,
  level: number,
  evidence: string,
][] = [
  [
    'assess-gaoyuan-product',
    'emp-sales-gaoyuan',
    'comp-brake-product',
    4,
    '上季度独立完成两家整车厂新平台的技术交流，客户技术问题当场答复。',
  ],
  [
    'assess-gaoyuan-crm',
    'emp-sales-gaoyuan',
    'comp-crm',
    3,
    '负责客户的两起质量投诉均在约定时间内闭环。',
  ],
  [
    'assess-linfeng-product',
    'emp-sales-linfeng',
    'comp-brake-product',
    3,
    '能对照技术手册回答材料与工艺问题，并说明与竞品的差异。',
  ],
  [
    'assess-linfeng-crm',
    'emp-sales-linfeng',
    'comp-crm',
    2,
    '客户档案按月更新，关键联系人齐全。',
  ],
  [
    'assess-xuke-product',
    'emp-sales-xuke',
    'comp-brake-product',
    2,
    '能讲解产品结构与主要性能参数，技术问题仍需技术中心支持。',
  ],
  ['assess-xuke-crm', 'emp-sales-xuke', 'comp-crm', 2, '客户档案按月更新。'],
];

/**
 * 《销售解决方案经理岗位说明书》 (01-演示案例.md): six duties and four
 * requirements, numbered so the advisor can cite the clause each competency
 * comes from. Written as a Word file; the fictional-data note lives only in
 * the document properties.
 */
export const SOLUTION_MANAGER_JD: readonly string[] = [
  '销售解决方案经理岗位说明书',
  '岗位名称：销售解决方案经理　所属部门：销售部　所属序列：营销序列　职级：S3　直接上级：销售总监',
  '一、岗位目的',
  '面向整车厂客户，把制动系统的产品能力转化为可落地的解决方案，牵头从需求到定点的全过程。',
  '二、岗位职责',
  '1. 需求调研与技术交流：理解整车厂新平台的制动系统需求，组织客户与技术中心的技术交流。',
  '2. 方案设计与报价：牵头制定制动卡钳与转向节的配套方案，完成成本测算与报价。',
  '3. 样件与定点项目推进：协调技术中心与工厂按节点完成样件试制、送样与客户认可，推动项目定点。',
  '4. 跨部门协调：组织技术中心、质量部、生产运营部解决项目中的技术、质量与交付问题。',
  '5. 重点客户关系维护：维护整车厂采购、质量、研发等关键人员关系，跟进客户满意度。',
  '6. 竞品与行业信息收集：收集竞品方案、价格与行业动态，形成分析报告。',
  '三、任职要求',
  '1. 5 年以上汽车零部件销售或技术支持经验。',
  '2. 熟悉制动系统产品的结构、材料与性能。',
  '3. 能独立完成报价测算。',
  '4. 具备商务谈判经验。',
];

/** 车间主任 JD 样例 (V3-08 测试数据), pasted into the advisor's chat in the demo. */
export const WORKSHOP_LEAD_JD =
  '车间主任岗位职责：1. 负责车间的生产排班与人员调配，按订单节拍组织生产；2. 组织班组分析质量问题，推动纠正措施落实并跟踪效果；3. 管理交接班，确保设备状态、在制品和质量信息完整交接；4. 每日开展安全与 5S 检查，发现隐患立即整改；5. 负责新员工带教计划的制定与跟进，确保新员工按期取得上岗证；6. 统计车间生产、质量和人员数据，每周向工厂负责人汇报。';

/**
 * 《能力评定导入数据.xlsx》 (V3-08 测试数据): five rows; row 3 names an
 * employee number that does not exist and row 4 a level above the maximum;
 * row 5 assesses 过程记录完整性, which is legitimate. Header: 工号、能力项编码、
 * 等级、依据、评定日期. Dates are relative to the seed run.
 */
export const ASSESSMENT_IMPORT_SAMPLE = (
  daysAgo: (days: number) => string,
): (string | number)[][] => [
  ['QH2003', 'safety-5s', 2, '班前安全检查与 5S 现场观察合格。', daysAgo(5)],
  ['QH9001', 'cnc-operation', 3, '现场实操观察。', daysAgo(5)],
  ['QH2003', 'quality-records', 6, '质量记录抽查。', daysAgo(5)],
  ['QH2002', 'process-record-integrity', 3, '过程记录抽查完整。', daysAgo(4)],
  ['QH2101', 'safety-5s', 2, '装配线 5S 检查合格。', daysAgo(4)],
];
