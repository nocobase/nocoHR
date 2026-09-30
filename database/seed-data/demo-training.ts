/**
 * Training operations demonstration data (V2 step 5) for "启衡精密", as set
 * out in 01-演示案例 "V3 数据：人才发展" and V3-09 "测试数据" (9B, 9C).
 * Fictional; development and demo environments only.
 */

export interface DemoCourseV2 {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly deliveryMode: 'online' | 'offline';
  readonly sourceDocumentId: string | null;
  readonly competencyIds: readonly string[];
  readonly lessons: readonly {
    title: string;
    content: string;
    estimatedMinutes: number;
  }[];
}

export const DEMO_V2_COURSES: readonly DemoCourseV2[] = [
  {
    id: 'course-first-article-practical',
    title: 'CNC 首件检验实操培训',
    description:
      '线下实操：在苏州工厂培训室由讲师示范停机后的首件检验，逐人确认量具使用与首件确认流程。签到即完成。',
    deliveryMode: 'offline',
    sourceDocumentId: 'doc-wi-mc-0231',
    competencyIds: ['comp-cnc'],
    lessons: [
      {
        title: '实操讲义：停机后首件检验要点',
        content:
          '## 课前准备\n- 穿好工作服和安全鞋，佩戴防护眼镜；操作旋转设备时不戴手套和首饰。\n- 带上本工序检验卡，确认检具和量具在校准有效期内。\n\n## 实操中讲师确认的要点\n1. 设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。\n2. 首件按检验卡逐项测量关键尺寸（孔径、位置度、端面跳动），三坐标或专用检具使用方法正确。\n3. 首件结果由班组长口头确认；不合格时停机调整，重新做首件。',
        estimatedMinutes: 10,
      },
    ],
  },
  {
    id: 'course-quality-record',
    title: '质量记录填写规范',
    description: '质量记录的基本原则与填写、修改要求。',
    deliveryMode: 'online',
    sourceDocumentId: null,
    competencyIds: ['comp-quality-record'],
    lessons: [
      {
        title: '为什么要做质量记录',
        content:
          '## 可追溯是客户的要求\n汽车行业质量体系要求每个零件都能追溯到加工它的人、设备和时间，整车厂客户审核时会抽查质量记录。\n\n- 按作业指导书操作：不凭经验、不走捷径。\n- 及时记录：做完一步记一步，不补记、不预记。\n- 出现异常及时报告班组长。',
        estimatedMinutes: 15,
      },
      {
        title: '质量记录的填写与修改',
        content:
          '## 填写要求\n- 用黑色签字笔，字迹清楚，测量值按实际读数填写。\n- 修改时划一横线，写明修改理由并签名、签日期，原内容仍可辨认。\n- 不得使用涂改液，不得撕页。',
        estimatedMinutes: 15,
      },
    ],
  },
  {
    id: 'course-assembly-intro',
    title: '装配岗位操作入门',
    description:
      '装配车间制动卡钳的装配流程、拧紧与防错、安全操作基础。',
    deliveryMode: 'online',
    sourceDocumentId: null,
    competencyIds: ['comp-safety', 'comp-quality-record'],
    lessons: [
      {
        title: '制动卡钳装配流程',
        content:
          '## 工艺流程\n零件清洗 → 活塞与密封圈装配 → 支架与螺栓拧紧 → 气密性检测 → 终检 → 包装。每道工序开工前核对工单与零件图号，混放的零件不得直接使用。',
        estimatedMinutes: 15,
      },
      {
        title: '拧紧、防错与安全操作',
        content:
          '## 拧紧与防错\n- 螺栓按工艺卡的扭矩拧紧，扭矩未达到设定值不得流转，须当场复拧并记录。\n- 每班开工前用标准件验证防错装置有效后才能开始装配。\n\n## 安全操作\n- 压装设备使用双手按钮，不得把手伸入压装区。\n- 按《安全与 5S 管理规定》穿戴劳保用品，工位保持整理整顿。',
        estimatedMinutes: 15,
      },
    ],
  },
];

/** The video lesson added to 《车间安全与 5S 基础》; the file is a generated placeholder, not a real recording. */
export const DEMO_VIDEO_LESSON = {
  id: 'course-safety-basics-video',
  courseId: 'course-safety-basics',
  fileId: '6d1f4c1e-0a4b-4c5e-9b1a-0000000000f1',
  filename: '劳保用品穿戴.mp4',
  asset: 'ppe-demo.mp4',
  title: '劳保用品穿戴',
  content:
    '视频按步骤展示工作服、安全鞋、防护眼镜和耳塞的穿戴，并提示操作旋转设备时禁止戴手套和首饰。',
  videoSeconds: 480,
  minWatchPercent: 90,
} as const;

/** 装配工's position requirements (01-演示案例): both mandatory, level 2. */
export const DEMO_ASSEMBLER_REQUIREMENTS = [
  {
    id: 'req-assembler-safety',
    competencyId: 'comp-safety',
    requiredLevel: 2,
    mandatory: true,
  },
  {
    id: 'req-assembler-quality-record',
    competencyId: 'comp-quality-record',
    requiredLevel: 2,
    mandatory: true,
  },
] as const;

export const DEMO_ASSEMBLY_QUESTIONS = [
  {
    id: 'q-assembly-1',
    stem: '螺栓拧紧后扭矩未达到设定值，可以先流转，终检时再补拧。',
    answer: false,
    explanation: '扭矩未达到设定值不得流转，须当场复拧并记录。',
  },
  {
    id: 'q-assembly-2',
    stem: '每班开工前须用标准件验证防错装置有效后才能开始装配。',
    answer: true,
    explanation: '防错装置失效会让漏装、错装流到下道工序。',
  },
  {
    id: 'q-assembly-3',
    stem: '每道工序开工前须核对工单与零件图号。',
    answer: true,
    explanation: '防止混料和装错零件。',
  },
  {
    id: 'q-assembly-4',
    stem: '质量记录写错时可以用涂改液修改。',
    answer: false,
    explanation: '划一横线、写明理由并签名签日期，不得使用涂改液。',
  },
  {
    id: 'q-assembly-5',
    stem: '制动卡钳在气密性检测合格后才进入终检。',
    answer: true,
    explanation: '工艺流程：气密性检测 → 终检 → 包装。',
  },
] as const;

export const DEMO_ASSEMBLY_EXAM = {
  id: 'exam-assembly-cert',
  title: '装配岗位考试',
  description: '固定卷，5 道判断题，每题 20 分，80 分及格。',
} as const;

export const DEMO_PATHS = [
  {
    id: 'path-cnc-operator-onboard',
    code: 'path-cnc-operator-onboard',
    title: 'CNC 操作工上岗路径',
    description:
      '新入职 CNC 操作工的上岗路径：车间安全与 5S → 首件检验实操 → 岗位操作入门 → 班组长抽问陪练 → 上岗考试，按顺序解锁。',
    positionId: 'pos-cnc-operator',
    steps: [
      { stepType: 'course', ref: 'course-safety-basics', due: 3 },
      { stepType: 'course', ref: 'course-first-article-practical', due: 7 },
      { stepType: 'course', ref: 'course-cnc-intro', due: 10 },
      { stepType: 'practice', ref: 'scenario-first-article-check', due: 12 },
      { stepType: 'exam', ref: 'exam-cnc-cert', due: 14 },
    ],
  },
  {
    id: 'path-assembler-onboard',
    code: 'path-assembler-onboard',
    title: '装配工上岗路径',
    description:
      '装配工的上岗路径，用于调岗后指派：车间安全与 5S → 装配岗位操作入门 → 质量记录填写规范。',
    positionId: 'pos-assembler',
    steps: [
      { stepType: 'course', ref: 'course-safety-basics', due: 3 },
      { stepType: 'course', ref: 'course-assembly-intro', due: 7 },
      { stepType: 'course', ref: 'course-quality-record', due: 10 },
    ],
  },
] as const;

const WI_MC_0231 = 'doc-wi-mc-0231';

/**
 * Rubric excerpts quote WI-MC-0231 V4.0 verbatim: 4.3 停机后首件 and 4.4 首件记录
 * for the first scenario; sections 1 and 2 and the preamble for the second.
 */
export const DEMO_SCENARIOS = [
  {
    id: 'scenario-first-article-check',
    title: '班组长现场抽问：停机后首件检验',
    persona:
      '机加工车间班组长，说话直接，会追问细节：设备停了多久、重新开机前要做什么、首件检验查哪些内容、结果怎么记录和确认。员工说错时追问依据，不直接给答案。',
    situation:
      '你在机加工车间操作一台加工中心，加工制动卡钳支架。刚才换刀后排查报警，设备停了一段时间，现在准备重新开机。班组长走过来抽问，请像平时一样回答。',
    openingLine:
      '我是今天的班组长。你这台机床刚才停了，停了多久？重新开机前你打算怎么做？',
    sourceDocumentId: WI_MC_0231,
    reviewStatus: 'confirmed',
    source: 'manual',
    rubric: [
      {
        point: '停机超过 15 分钟，重新开机须做首件检验',
        weight: 40,
        competencyId: 'comp-cnc',
        sourceExcerpt:
          '设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。',
      },
      {
        point: '首件检验合格后才能批量加工',
        weight: 30,
        competencyId: 'comp-cnc',
        sourceExcerpt:
          '设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。',
      },
      {
        point: '首件结果由班组长确认',
        weight: 20,
        competencyId: 'comp-cnc',
        sourceExcerpt: '首件结果由班组长口头确认。',
      },
      {
        // Restarting also means the safety basics: this item lets the scenario close a 安全生产与 5S gap too.
        point: '重新开机前穿戴合规：操作旋转设备不戴手套和首饰',
        weight: 10,
        competencyId: 'comp-safety',
        sourceExcerpt:
          '上岗前按《安全与 5S 管理规定》（SAF-0105）穿戴劳保用品；操作旋转设备时禁止戴手套和首饰。',
      },
    ],
  },
  {
    id: 'scenario-customer-audit',
    title: '客户审核问询：你的上岗资格和培训',
    persona:
      '整车厂客户的审核员，语气正式，逐项核实操作工持有的上岗资格、最近一次培训和所用作业指导书的版本，回答含糊时要求出示记录。',
    situation:
      '整车厂客户来苏州工厂做年度审核，审核员来到机加工车间你的机床旁，要求你说明自己的上岗资格和培训情况。',
    openingLine:
      '你好，我是客户审核组的。请说一下你持有什么上岗资格，最近一次培训是什么时候、学的是哪份作业指导书的哪个版本？',
    sourceDocumentId: WI_MC_0231,
    reviewStatus: 'draft',
    source: 'ai',
    rubric: [
      {
        point: '说明持有有效的 CNC 岗位上岗证，未取得上岗证不独立开机',
        weight: 40,
        competencyId: 'comp-quality-record',
        sourceExcerpt: '未取得有效的 CNC 岗位上岗证者，不得独立开机加工。',
      },
      {
        point: '说明已完成岗位操作入门培训并通过上岗考试',
        weight: 35,
        competencyId: 'comp-quality-record',
        sourceExcerpt:
          '操作工须完成《CNC 岗位操作入门》培训并通过《CNC 上岗考试》，持有有效的 CNC 岗位上岗证。',
      },
      {
        point: '能说出所用作业指导书的编号和版本',
        weight: 25,
        competencyId: 'comp-quality-record',
        sourceExcerpt: '启衡精密科技，文件编号 WI-MC-0231。',
      },
    ],
  },
] as const;
