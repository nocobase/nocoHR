/**
 * V2-06 测试数据 (演示案例 · V2 数据 · 薪酬), shared by the demo seed and the
 * development-only demo files. Every amount, rate and base is a made-up
 * example (示例): the payroll specialist sets the real ones.
 */
import type { StructureItem, StructureParam } from './calc.js';

export const DEMO_STRUCTURE_IDS = {
  suzhou: 'struct-prod-sz',
  chengdu: 'struct-prod-cd',
  office: 'struct-office',
} as const;

function item(
  sortOrder: number,
  code: string,
  title: string,
  kind: StructureItem['kind'],
  calc: StructureItem['calc'],
  formula: string | null,
  extra: Partial<StructureItem> = {},
): StructureItem {
  return {
    code,
    title,
    kind,
    calc,
    formula,
    unit: null,
    departmentIds: [],
    taxable: kind !== 'reference',
    includedInSocialBase: false,
    sortOrder,
    ...extra,
  };
}

/** 生产一线: 基本工资、岗位津贴、夜班津贴、加班费、事假扣款、绩效奖金 (imported). */
export function productionItems(): StructureItem[] {
  return [
    item(
      0,
      'base',
      '基本工资',
      'earning',
      'formula',
      'base × payableDays ÷ payDaysPerMonth',
      {
        includedInSocialBase: true,
      },
    ),
    item(10, 'post', '岗位津贴', 'earning', 'formula', 'allowance.post', {
      includedInSocialBase: true,
    }),
    item(
      20,
      'night',
      '夜班津贴',
      'earning',
      'formula',
      'att.nightShiftCount × param.nightRate',
      {
        includedInSocialBase: true,
      },
    ),
    item(
      30,
      'overtime',
      '加班费',
      'earning',
      'formula',
      'hourlyRate × (att.overtime.workday × 1.5 + att.overtime.restDay × 2 + att.overtime.holiday × 3)',
    ),
    item(
      40,
      'personalLeave',
      '事假扣款',
      'deduction',
      'formula',
      'dailyRate × att.leave.personal',
    ),
    item(50, 'perfBonus', '绩效奖金', 'earning', 'imported', null, {
      includedInSocialBase: true,
    }),
  ];
}

/** 职能: 基本工资、岗位津贴、加班费、事假扣款、绩效奖金 (imported). */
export function officeItems(): StructureItem[] {
  return productionItems().filter((i) => i.code !== 'night');
}

export function nightRate(value: number): StructureParam {
  return { code: 'nightRate', title: '夜班津贴标准', value, unit: '元/班' };
}

/** Monthly base salary and post allowance per demo employee (示例). */
export const DEMO_SALARIES: Readonly<
  Record<string, { base: number; post: number }>
> = {
  'emp-hr01': { base: 8000, post: 500 },
  'emp-trainer01': { base: 8000, post: 500 },
  'emp-payroll01': { base: 8500, post: 500 },
  'emp-fin01': { base: 12000, post: 1000 },
  'emp-mgr-east': { base: 15000, post: 2000 },
  'emp-mgr-njl': { base: 9000, post: 1000 },
  'emp-mgr-cd': { base: 14000, post: 2000 },
  'emp-wanglei': { base: 6000, post: 500 },
  'emp-limin': { base: 6000, post: 500 },
  'emp-qianjin': { base: 6200, post: 500 },
  'emp-chenchen': { base: 5500, post: 300 },
  'emp-liuyang': { base: 5500, post: 300 },
  'emp-zhaoyang': { base: 5800, post: 500 },
  'emp-wumin': { base: 5800, post: 500 },
  'emp-dengkai': { base: 5800, post: 500 },
  'emp-sunli': { base: 5000, post: 300 },
  'emp-guofan': { base: 5000, post: 300 },
  'emp-yangfan': { base: 5000, post: 300 },
};
/** Anyone else on the books when the seed runs. */
export const DEFAULT_SALARY = { base: 6000, post: 300 };

/** 车间月度绩效奖金 (Excel sample), by employee number; QH9999 does not exist. 杨帆 is not in it. */
export const DEMO_PERF_BONUS: readonly [string, string, number][] = [
  ['QH1001', '林晓', 800],
  ['QH1002', '周宏', 2000],
  ['QH1003', '陈静', 1000],
  ['QH1004', '何伟', 2000],
  ['QH1006', '郑老师', 800],
  ['QH1007', '许婷', 800],
  ['QH1008', '韩冬', 1000],
  ['QH2001', '王磊', 600],
  ['QH2002', '李敏', 500],
  ['QH2003', '钱进', 300],
  ['QH2101', '孙丽', 300],
  ['QH2105', '郭凡', 200],
  ['QH2201', '陈晨', 400],
  ['QH3001', '赵阳', 500],
  ['QH3002', '吴敏', 450],
  ['QH3004', '邓凯', 450],
  ['QH9999', '张三', 300],
];

/** MES 导出的装配车间计件数: 孙丽 2,400; 杨帆's number is missing. */
export const DEMO_PIECE_COUNTS: readonly [string, string, number][] = [
  ['QH2101', '孙丽', 2400],
  ['QH2105', '郭凡', 900],
];

/** 蓉川人力派到成都机加工车间的 4 名派遣员工 (no accounts). */
export const DEMO_DISPATCHED: readonly {
  id: string;
  employeeNo: string;
  name: string;
}[] = [
  { id: 'emp-dispatch-1', employeeNo: 'QH3101', name: '刘强' },
  { id: 'emp-dispatch-2', employeeNo: 'QH3102', name: '张伟' },
  { id: 'emp-dispatch-3', employeeNo: 'QH3103', name: '陈刚' },
  { id: 'emp-dispatch-4', employeeNo: 'QH3104', name: '黄勇' },
];
export const DEMO_VENDOR = '蓉川人力';
/** The bill: 720 hours for the four, two of them 24 hours over; one row with an unknown number. */
export const DEMO_BILL_LINES: readonly [string, string, number][] = [
  ['QH3101', '刘强', 168],
  ['QH3102', '张伟', 168],
  ['QH3103', '陈刚', 192],
  ['QH3104', '黄勇', 192],
  ['QH3199', '周波', 8],
];
export const DEMO_BILL_RATE = 35;

/** Plans (示例 rates and bases, percent): 苏州 and 成都. */
export const DEMO_PLANS = [
  {
    id: 'si-plan-suzhou',
    city: '苏州',
    items: [
      {
        code: 'pension',
        employerRate: 16,
        employeeRate: 8,
        baseMin: 4494,
        baseMax: 24042,
      },
      {
        code: 'medical',
        employerRate: 7,
        employeeRate: 2,
        baseMin: 4494,
        baseMax: 24042,
      },
      {
        code: 'unemployment',
        employerRate: 0.5,
        employeeRate: 0.5,
        baseMin: 4494,
        baseMax: 24042,
      },
      {
        code: 'injury',
        employerRate: 0.4,
        employeeRate: 0,
        baseMin: 4494,
        baseMax: 24042,
      },
      {
        code: 'maternity',
        employerRate: 0.8,
        employeeRate: 0,
        baseMin: 4494,
        baseMax: 24042,
      },
      {
        code: 'housingFund',
        employerRate: 7,
        employeeRate: 7,
        baseMin: 2490,
        baseMax: 34000,
      },
    ],
  },
  {
    id: 'si-plan-chengdu',
    city: '成都',
    items: [
      {
        code: 'pension',
        employerRate: 16,
        employeeRate: 8,
        baseMin: 4246,
        baseMax: 21228,
      },
      {
        code: 'medical',
        employerRate: 6.5,
        employeeRate: 2,
        baseMin: 4246,
        baseMax: 21228,
      },
      {
        code: 'unemployment',
        employerRate: 0.6,
        employeeRate: 0.4,
        baseMin: 4246,
        baseMax: 21228,
      },
      {
        code: 'injury',
        employerRate: 0.3,
        employeeRate: 0,
        baseMin: 4246,
        baseMax: 21228,
      },
      {
        code: 'maternity',
        employerRate: 0.8,
        employeeRate: 0,
        baseMin: 4246,
        baseMax: 21228,
      },
      {
        code: 'housingFund',
        employerRate: 6,
        employeeRate: 6,
        baseMin: 2100,
        baseMax: 28000,
      },
    ],
  },
] as const;
