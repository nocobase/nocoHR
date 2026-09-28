/**
 * Demonstration data for "启衡精密科技" (启衡精密), the fictional automotive
 * parts supplier of the NocoHR demo case (01-演示案例.md): precision die
 * casting and machining of brake calipers and steering knuckles, with a
 * Suzhou and a Chengdu plant. Only the demo seeds read this module; it never
 * runs in production. Every mobile and ID number is an obviously fake test
 * value.
 */

export interface DemoDepartment {
  id: string;
  code: string;
  titleKey: string;
  parentId: string | null;
  managerAccount: string | null;
  sortOrder: number;
}

/**
 * The V1-01 organisation, with 何伟 (mgr_cd) heading 成都工厂 from step 2
 * (V1-02). 装配车间 and 成都机加工车间 deliberately have no head: approvals,
 * scopes and notifications go up to 苏州工厂 and 成都工厂. 财务部 arrives with
 * payroll (step 6) and 销售部 with the key scenario (step 8), so neither is
 * seeded here.
 */
export const DEMO_DEPARTMENTS: readonly DemoDepartment[] = [
  {
    id: 'qiheng',
    code: 'ROOT',
    titleKey: 'departments.seed.root',
    parentId: null,
    managerAccount: null,
    sortOrder: 0,
  },
  {
    id: 'hr',
    code: 'HR',
    titleKey: 'departments.seed.hr',
    parentId: 'qiheng',
    managerAccount: null,
    sortOrder: 0,
  },
  {
    id: 'quality',
    code: 'QUALITY',
    titleKey: 'departments.seed.quality',
    parentId: 'qiheng',
    managerAccount: null,
    sortOrder: 1,
  },
  {
    id: 'tech',
    code: 'TECH',
    titleKey: 'departments.seed.tech',
    parentId: 'qiheng',
    managerAccount: null,
    sortOrder: 2,
  },
  {
    id: 'ops',
    code: 'OPS',
    titleKey: 'departments.seed.ops',
    parentId: 'qiheng',
    managerAccount: null,
    sortOrder: 3,
  },
  {
    id: 'sz',
    code: 'SZ',
    titleKey: 'departments.seed.sz',
    parentId: 'ops',
    managerAccount: 'mgr_east',
    sortOrder: 0,
  },
  {
    id: 'sz-mc',
    code: 'SZ-MC',
    titleKey: 'departments.seed.szMc',
    parentId: 'sz',
    managerAccount: 'mgr_njl',
    sortOrder: 0,
  },
  {
    id: 'sz-as',
    code: 'SZ-AS',
    titleKey: 'departments.seed.szAs',
    parentId: 'sz',
    managerAccount: null,
    sortOrder: 1,
  },
  {
    id: 'cd',
    code: 'CD',
    titleKey: 'departments.seed.cd',
    parentId: 'ops',
    managerAccount: 'mgr_cd',
    sortOrder: 1,
  },
  {
    id: 'cd-mc',
    code: 'CD-MC',
    titleKey: 'departments.seed.cdMc',
    parentId: 'cd',
    managerAccount: null,
    sortOrder: 0,
  },
];

export const DEMO_JOB_FAMILIES = [
  {
    id: 'jf-prod',
    code: 'prod',
    title: '生产序列',
    description: '车间一线操作与生产管理岗位',
    sortOrder: 0,
  },
  {
    id: 'jf-office',
    code: 'office',
    title: '职能序列',
    description: '人力资源、培训、招聘、薪酬、财务与内审等职能岗位',
    sortOrder: 1,
  },
] as const;

/**
 * Only the CNC operator has a job description (V1-01). The others are left
 * empty on purpose: the workshop lead to demonstrate drafting in the chat,
 * and all of them so the framework advisor's first daily run drafts nothing.
 * Office positions carry no grade.
 */
export const DEMO_POSITIONS = [
  {
    id: 'pos-cnc-operator',
    code: 'prod-cnc-operator',
    title: 'CNC 操作工',
    jobFamilyId: 'jf-prod',
    grade: 'S1',
    responsibilities:
      '负责数控机床的开机点检、装夹与加工、首件检验、过程自检、质量记录填写和设备日常保养，须持有 CNC 岗位上岗证才能独立开机。',
    sortOrder: 0,
  },
  {
    id: 'pos-assembler',
    code: 'prod-assembler',
    title: '装配工',
    jobFamilyId: 'jf-prod',
    grade: 'S1',
    responsibilities: null,
    sortOrder: 1,
  },
  {
    id: 'pos-workshop-lead',
    code: 'prod-workshop-lead',
    title: '车间主任',
    jobFamilyId: 'jf-prod',
    grade: 'S3',
    responsibilities: null,
    sortOrder: 2,
  },
  {
    id: 'pos-plant-director',
    code: 'prod-plant-director',
    title: '厂长',
    jobFamilyId: 'jf-prod',
    grade: 'S4',
    responsibilities: null,
    sortOrder: 3,
  },
  {
    id: 'pos-office-hr',
    code: 'office-hr',
    title: 'HR 专员',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 0,
  },
  {
    id: 'pos-office-trainer',
    code: 'office-trainer',
    title: '培训专员',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 1,
  },
  {
    id: 'pos-office-recruiter',
    code: 'office-recruiter',
    title: '招聘专员',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 2,
  },
  {
    id: 'pos-office-payroll',
    code: 'office-payroll',
    title: '薪酬专员',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 3,
  },
  {
    id: 'pos-office-finance-manager',
    code: 'office-finance-manager',
    title: '财务经理',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 4,
  },
  {
    id: 'pos-office-auditor',
    code: 'office-auditor',
    title: '内审专员',
    jobFamilyId: 'jf-office',
    grade: null,
    responsibilities: null,
    sortOrder: 5,
  },
] as const;

type Levels = readonly (readonly [string, string])[];

/** The V3-08 competency dictionary, all confirmed, every level described. */
export const DEMO_COMPETENCIES: readonly {
  id: string;
  code: string;
  title: string;
  category: 'skill' | 'quality' | 'qualification';
  description: string;
  maxLevel: number;
  levels: Levels;
}[] = [
  {
    id: 'comp-cnc',
    code: 'cnc-operation',
    title: 'CNC 设备操作',
    category: 'skill',
    description:
      '按作业指导书完成数控机床的开机点检、装夹、程序调用与加工、首件检验和过程自检的能力。',
    maxLevel: 5,
    levels: [
      [
        '入门',
        '在带教人员监护下完成开机点检，能说出急停按钮的位置和停机后首件检验的要求。',
      ],
      [
        '基础',
        '独立完成开机点检、工件装夹、程序调用和首件送检，班内无操作性质量问题。',
      ],
      [
        '熟练',
        '独立处理停机、换刀和报警后的复机，按规定做首件检验并记录，能判断常见尺寸超差原因。',
      ],
      [
        '精通',
        '能进行刀具补偿与参数微调、排查常见设备故障，并带教新人取得上岗证。',
      ],
      ['专家', '能优化加工工艺与作业指导书，参与新设备验收和新零件试制。'],
    ],
  },
  {
    id: 'comp-safety',
    code: 'safety-5s',
    title: '安全生产与 5S',
    category: 'skill',
    description:
      '遵守车间安全规定与劳保要求，保持工位整理、整顿、清扫、清洁和素养，预防人身伤害与设备事故。',
    maxLevel: 5,
    levels: [
      [
        '入门',
        '能说出劳保用品穿戴要求和旋转设备禁止戴手套、首饰的规定，并在提醒下执行。',
      ],
      [
        '基础',
        '每班独立做好劳保穿戴、工位 5S 和设备安全防护检查，无违规记录。',
      ],
      ['熟练', '能识别他人的不安全行为并当场纠正，说明其风险。'],
      [
        '精通',
        '能组织班组安全与 5S 自查，分析隐患和轻微事故的原因并推动整改。',
      ],
      ['专家', '能制定车间安全与 5S 标准和培训方案，主导事故调查。'],
    ],
  },
  {
    id: 'comp-quality-record',
    code: 'quality-records',
    title: '质量记录规范',
    category: 'quality',
    description:
      '及时、准确、完整地填写首件检验、过程自检等质量记录，修改须签名注明日期，确保记录真实、可追溯，满足客户审核要求。',
    maxLevel: 5,
    levels: [
      ['入门', '能按模板填写首件检验记录，知道修改须签名并注明日期。'],
      [
        '基础',
        '独立、及时填写所负责工序的质量记录，一个月内无记录类质量问题。',
      ],
      ['熟练', '能复核他人记录，发现并纠正漏填、错填和不规范修改。'],
      ['精通', '能组织车间记录检查并提出改进，带教记录规范。'],
      ['专家', '能设计记录表单与审核流程，支持客户审核中的记录追溯。'],
    ],
  },
  {
    id: 'comp-safety-license',
    code: 'job-safety-qualification',
    title: '岗位安全上岗资格',
    category: 'qualification',
    description:
      '通过岗位安全培训与考核、取得岗位安全上岗资格，方可独立操作所在岗位的设备。',
    maxLevel: 1,
    levels: [['持有', '岗位安全上岗资格考核合格，且在有效期内。']],
  },
  {
    id: 'comp-maintenance',
    code: 'equipment-maintenance',
    title: '设备保养',
    category: 'skill',
    description:
      '按设备点检与保养规程完成日常点检、清洁、润滑、紧固和异常上报。',
    maxLevel: 5,
    levels: [
      ['入门', '在指导下按点检表完成设备外观清洁和油位检查。'],
      ['基础', '独立完成负责设备的日常点检、清洁与润滑，并正确填写点检表。'],
      ['熟练', '能发现异响、漏油、精度下降等异常，做初步处理并及时上报。'],
      ['精通', '能评估保养效果、调整保养周期，并协助维修人员排除故障。'],
      ['专家', '能制定设备保养规程并推动全员生产维护。'],
    ],
  },
  {
    id: 'comp-team',
    code: 'team-leading',
    title: '班组管理',
    category: 'quality',
    description: '组织班组完成生产任务，并培养班组成员。',
    maxLevel: 5,
    levels: [
      ['入门', '能按排班表安排当班分工，做好交接班。'],
      ['基础', '能根据生产计划调整人手，并对新人进行岗位带教。'],
      ['熟练', '能设定班组目标，定期给出成员反馈并跟进改进。'],
      ['精通', '能分析班组质量问题并推动改进，培养可接班的骨干。'],
      ['专家', '能搭建多车间管理梯队并推动组织改进。'],
    ],
  },
  {
    // Deliberately close to "质量记录规范" and required by no position: the advisor's monthly check should flag it.
    id: 'comp-process-record',
    code: 'process-record-integrity',
    title: '过程记录完整性',
    category: 'quality',
    description:
      '确保生产过程与质量记录及时、准确、完整、真实、可追溯，修改须签名注明日期并保留原记录。',
    maxLevel: 5,
    levels: [
      ['入门', '知道过程记录须及时、真实、完整，修改须签名注明日期。'],
      ['基础', '在所负责工序的记录中做到及时、完整、可追溯。'],
      ['熟练', '能发现他人记录中的缺项、补记和不规范修改并纠正。'],
      ['精通', '能组织过程记录检查并推动整改。'],
      ['专家', '能建立过程记录管理制度并应对客户审核。'],
    ],
  },
];

/** The CNC operator's requirements (V3-08); the seed writes them onto pos-cnc-operator. */
export const DEMO_FILLER_REQUIREMENTS = [
  {
    id: 'req-cnc-operation',
    competencyId: 'comp-cnc',
    requiredLevel: 3,
    mandatory: true,
  },
  {
    id: 'req-cnc-safety',
    competencyId: 'comp-safety',
    requiredLevel: 2,
    mandatory: true,
  },
  {
    id: 'req-cnc-quality-record',
    competencyId: 'comp-quality-record',
    requiredLevel: 2,
    mandatory: false,
  },
  {
    id: 'req-cnc-license',
    competencyId: 'comp-safety-license',
    requiredLevel: 1,
    mandatory: true,
  },
] as const;

export interface DemoPerson {
  employeeId: string;
  employeeNo: string;
  name: string;
  account: string | null;
  departmentId: string;
  positionId: string;
  managerEmployeeId: string | null;
  gender: 'male' | 'female';
  hireDate: string;
  mobile: string;
  idNumber: string;
  birthDate: string;
  address: string;
  education: {
    school: string;
    degree: string;
    major: string;
    startDate: string;
    endDate: string;
  };
  contact: { name: string; relation: string; phone: string };
}

/**
 * The V1-01 employees plus 何伟 (mgr_cd, V1-02). 孙丽 has no account and an
 * empty hire date: the seed hires her 80 days before it runs and puts her on
 * a three-month probation ending 10 days after it (V1-02).
 */
export const DEMO_PEOPLE: readonly DemoPerson[] = [
  {
    employeeId: 'emp-hr01',
    employeeNo: 'QH1001',
    name: '林晓',
    account: 'hr01',
    departmentId: 'hr',
    positionId: 'pos-office-hr',
    managerEmployeeId: null,
    gender: 'female',
    hireDate: '2021-03-01',
    mobile: '13900000001',
    idNumber: '999999199001010011',
    birthDate: '1990-01-01',
    address: '测试市测试路 1 号',
    education: {
      school: '测试大学',
      degree: 'bachelor',
      major: '人力资源管理',
      startDate: '2008-09-01',
      endDate: '2012-06-30',
    },
    contact: { name: '林测试', relation: '父亲', phone: '13900001001' },
  },
  {
    employeeId: 'emp-mgr-east',
    employeeNo: 'QH1002',
    name: '周宏',
    account: 'mgr_east',
    departmentId: 'sz',
    positionId: 'pos-plant-director',
    managerEmployeeId: null,
    gender: 'male',
    hireDate: '2018-07-15',
    mobile: '13900000002',
    idNumber: '999999198505050022',
    birthDate: '1985-05-05',
    address: '测试市测试路 2 号',
    education: {
      school: '测试理工大学',
      degree: 'master',
      major: '机械工程',
      startDate: '2007-09-01',
      endDate: '2010-06-30',
    },
    contact: { name: '周测试', relation: '配偶', phone: '13900001002' },
  },
  {
    employeeId: 'emp-mgr-njl',
    employeeNo: 'QH1003',
    name: '陈静',
    account: 'mgr_njl',
    departmentId: 'sz-mc',
    positionId: 'pos-workshop-lead',
    managerEmployeeId: 'emp-mgr-east',
    gender: 'female',
    hireDate: '2020-04-10',
    mobile: '13900000003',
    idNumber: '999999199208080033',
    birthDate: '1992-08-08',
    address: '测试市测试路 3 号',
    education: {
      school: '测试职业技术学院',
      degree: 'associate',
      major: '机械制造与自动化',
      startDate: '2010-09-01',
      endDate: '2013-06-30',
    },
    contact: { name: '陈测试', relation: '母亲', phone: '13900001003' },
  },
  {
    employeeId: 'emp-mgr-cd',
    employeeNo: 'QH1004',
    name: '何伟',
    account: 'mgr_cd',
    departmentId: 'cd',
    positionId: 'pos-plant-director',
    managerEmployeeId: null,
    gender: 'male',
    hireDate: '2019-03-18',
    mobile: '13900000011',
    idNumber: '999999198311110110',
    birthDate: '1983-11-11',
    address: '测试市测试路 11 号',
    education: {
      school: '测试理工大学',
      degree: 'bachelor',
      major: '材料成型及控制工程',
      startDate: '2001-09-01',
      endDate: '2005-06-30',
    },
    contact: { name: '何测试', relation: '配偶', phone: '13900001011' },
  },
  {
    employeeId: 'emp-wanglei',
    employeeNo: 'QH2001',
    name: '王磊',
    account: 'emp_njl_1',
    departmentId: 'sz-mc',
    positionId: 'pos-cnc-operator',
    managerEmployeeId: 'emp-mgr-njl',
    gender: 'male',
    hireDate: '2024-09-01',
    mobile: '13900000004',
    idNumber: '999999199903030044',
    birthDate: '1999-03-03',
    address: '测试市测试路 4 号',
    education: {
      school: '测试技工学校',
      degree: 'other',
      major: '数控加工',
      startDate: '2015-09-01',
      endDate: '2018-01-31',
    },
    contact: { name: '王测试', relation: '父亲', phone: '13900001004' },
  },
  {
    employeeId: 'emp-limin',
    employeeNo: 'QH2002',
    name: '李敏',
    account: 'emp_njl_2',
    departmentId: 'sz-mc',
    positionId: 'pos-cnc-operator',
    managerEmployeeId: 'emp-mgr-njl',
    gender: 'female',
    hireDate: '2025-02-15',
    mobile: '13900000005',
    idNumber: '999999200011110055',
    birthDate: '2000-11-11',
    address: '测试市测试路 5 号',
    education: {
      school: '测试职业技术学院',
      degree: 'associate',
      major: '机电一体化技术',
      startDate: '2018-09-01',
      endDate: '2021-06-30',
    },
    contact: { name: '李测试', relation: '母亲', phone: '13900001005' },
  },
  {
    employeeId: 'emp-qianjin',
    employeeNo: 'QH2003',
    name: '钱进',
    account: 'emp_njl_3',
    departmentId: 'sz-mc',
    positionId: 'pos-cnc-operator',
    managerEmployeeId: 'emp-mgr-njl',
    gender: 'male',
    hireDate: '2022-05-09',
    mobile: '13900000010',
    idNumber: '999999199506060100',
    birthDate: '1995-06-06',
    address: '测试市测试路 10 号',
    education: {
      school: '测试技工学校',
      degree: 'other',
      major: '数控车工',
      startDate: '2011-09-01',
      endDate: '2014-06-30',
    },
    contact: { name: '钱测试', relation: '配偶', phone: '13900001010' },
  },
  {
    employeeId: 'emp-zhaoyang',
    employeeNo: 'QH3001',
    name: '赵阳',
    account: 'emp_th_1',
    departmentId: 'cd-mc',
    positionId: 'pos-cnc-operator',
    managerEmployeeId: 'emp-mgr-cd',
    gender: 'male',
    hireDate: '2023-06-01',
    mobile: '13900000006',
    idNumber: '999999199707070066',
    birthDate: '1997-07-07',
    address: '测试市测试路 6 号',
    education: {
      school: '测试中专',
      degree: 'other',
      major: '机械加工技术',
      startDate: '2012-09-01',
      endDate: '2015-06-30',
    },
    contact: { name: '赵测试', relation: '兄弟', phone: '13900001006' },
  },
  {
    employeeId: 'emp-wumin',
    employeeNo: 'QH3002',
    name: '吴敏',
    account: 'emp_th_2',
    departmentId: 'cd-mc',
    positionId: 'pos-cnc-operator',
    managerEmployeeId: 'emp-mgr-cd',
    gender: 'female',
    hireDate: '2022-03-14',
    mobile: '13900000009',
    idNumber: '999999199604040099',
    birthDate: '1996-04-04',
    address: '测试市测试路 9 号',
    education: {
      school: '测试职业技术学院',
      degree: 'associate',
      major: '模具设计与制造',
      startDate: '2014-09-01',
      endDate: '2017-06-30',
    },
    contact: { name: '吴测试', relation: '配偶', phone: '13900001009' },
  },
  {
    employeeId: 'emp-sunli',
    employeeNo: 'QH2101',
    name: '孙丽',
    account: null,
    departmentId: 'sz-as',
    positionId: 'pos-assembler',
    managerEmployeeId: 'emp-mgr-east',
    gender: 'female',
    hireDate: '',
    mobile: '13900000007',
    idNumber: '999999200202020077',
    birthDate: '2002-02-02',
    address: '测试市测试路 7 号',
    education: {
      school: '测试职业技术学院',
      degree: 'associate',
      major: '汽车制造与试验技术',
      startDate: '2020-09-01',
      endDate: '2023-06-30',
    },
    contact: { name: '孙测试', relation: '父亲', phone: '13900001007' },
  },
];

/** The login accounts; names match the employees above. The instructor is created by the learning seed. */
export const DEMO_ACCOUNTS = DEMO_PEOPLE.filter((p) => p.account).map((p) => ({
  username: p.account!,
  name: p.name,
  email: `${p.account!.replace(/_/gu, '.')}@demo.test`,
}));

/**
 * 《员工导入样例.xlsx》 (V1-01 测试数据): ten rows designed to exercise the
 * preview and the HR assistant's health check. Rows 9 and 10 fail the
 * preview; without them the import updates 2, creates 6 and creates the
 * position "数控操作工". Row 6 repeats 孙丽's name and mobile under a new
 * employee number. Header: 工号、姓名、部门编码、岗位、上级工号、入职日期、邮箱、手机.
 */
export const DEMO_IMPORT_SAMPLE: readonly (readonly string[])[] = [
  [
    'QH2001',
    '王磊',
    'SZ-MC',
    'prod-cnc-operator',
    'QH1003',
    '2024-09-01',
    'wanglei.new@qiheng.test',
    '13900000004',
  ],
  [
    'QH2002',
    '李敏',
    'SZ-MC',
    'CNC 操作工',
    'QH1003',
    '2025-02-15',
    'emp.njl.2@demo.test',
    '13900000005',
  ],
  [
    'QH2102',
    '张涛',
    'SZ-AS',
    '装配工',
    'QH2104',
    '2026-06-01',
    'zhangtao@qiheng.test',
    '13900002102',
  ],
  [
    'QH2005',
    '黄志强',
    'SZ-MC',
    '数控操作工',
    'QH1003',
    '2026-06-01',
    'huangzq@qiheng.test',
    '13900002005',
  ],
  [
    'QH2006',
    '刘芳',
    'SZ-MC',
    '',
    'QH1003',
    '2026-06-01',
    'liufang@qiheng.test',
    '13900002006',
  ],
  [
    'QH2103',
    '孙丽',
    'SZ-AS',
    '装配工',
    'QH1002',
    '2026-06-15',
    'sunli2@qiheng.test',
    '139 0000 0007',
  ],
  [
    'QH2104',
    '韦青',
    'SZ-AS',
    '装配工',
    'QH2102',
    '2026-06-01',
    'weiqing@qiheng.test',
    '13900002104',
  ],
  [
    'QH3003',
    '邓川',
    'CD-MC',
    'prod-cnc-operator',
    '',
    '2026-06-01',
    'dengchuan@qiheng.test',
    '13900003003',
  ],
  [
    'QH2007',
    '赵磊',
    'SZ-PAINT',
    '装配工',
    'QH1002',
    '2026-06-01',
    'zhaolei@qiheng.test',
    '13900002007',
  ],
  [
    'QH2006',
    '许诺',
    'SZ-MC',
    'prod-cnc-operator',
    'QH1003',
    '2026-06-01',
    'xunuo@qiheng.test',
    '13900002016',
  ],
];
export const DEMO_IMPORT_HEADER = [
  '工号',
  '姓名',
  '部门编码',
  '岗位',
  '上级工号',
  '入职日期',
  '邮箱',
  '手机',
] as const;
