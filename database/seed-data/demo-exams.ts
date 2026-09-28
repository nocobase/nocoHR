/**
 * Demonstration questions, exams and certifications for "启衡精密" (V1 steps
 * 3 and 4 test data, V3-10 in the specification). Only the demo seed reads
 * this module.
 *
 * - 15 confirmed questions from WI-MC-0231 V4.0 (8 single, 3 multiple, 3
 *   judge, 1 short) tagged CNC 设备操作 / 质量记录规范 and written from the
 *   course 《CNC 岗位操作入门》, plus 3 AI drafts. Exactly two confirmed
 *   questions (q-cnc-01, q-cnc-08) test the "15 minutes" first-article rule
 *   (4.3) that the V4.1 revision changes to 10 minutes; the short answer is a
 *   chip-clearing safety case (SAF-0105 3) for manual grading.
 * - 《CNC 上岗考试》 draws 5 single, 2 multiple and 3 judge questions at 10
 *   points each (rules filtered by competency), 20 minutes, 3 attempts, 80 to
 *   pass. 《安全实务问答》 is a fixed paper with one short answer.
 * - CNC 岗位上岗证 = the course + the exam, 12 months; its permission set
 *   prod.cncOperator records machine starts on work order MO-24031.
 * - 内部讲师资格 = 《讲师基础考核》 (5 judge questions), never expires; hr.instructor
 *   is assigned to it, so 郑老师 is an instructor because she holds it.
 */

export type DemoQuestionType =
  'single' | 'multiple' | 'judge' | 'blank' | 'short';

export interface DemoQuestion {
  readonly id: string;
  readonly type: DemoQuestionType;
  readonly stem: string;
  readonly options: readonly { key: string; text: string }[];
  readonly answer: unknown;
  readonly explanation: string | null;
  readonly gradingNotes: string | null;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly sourceDocumentId: string | null;
  readonly sourceCourseId: string | null;
  readonly sourceExcerpt: string | null;
  readonly ownerAccount: string;
  readonly source: 'manual' | 'ai' | 'import';
  readonly reviewStatus: 'draft' | 'confirmed';
  readonly competencyIds: readonly string[];
}

const opts = (...texts: string[]) =>
  texts.map((text, i) => ({ key: String.fromCharCode(65 + i), text }));
// Excerpts quote WI-MC-0231 V4.0 and SAF-0105 V2.1 in demo-learning.ts verbatim.
const wi = {
  sourceDocumentId: 'doc-wi-mc-0231',
  sourceCourseId: 'course-cnc-intro',
  ownerAccount: 'trainer01',
  source: 'manual',
  reviewStatus: 'confirmed',
  gradingNotes: null,
} as const;
const CNC = ['comp-cnc'];
const RECORD = ['comp-quality-record'];
const FIRST_ARTICLE_STOP =
  '设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。';
const FIRST_ARTICLE_CHECK =
  '首件检验按检验卡逐项测量关键尺寸（孔径、位置度、端面跳动），用三坐标或专用检具，结果全部合格才能批量加工。';
const START_CHECK =
  '每班开工前点检，内容包括润滑油位、切削液浓度、气压、防护门联锁和急停按钮；点检不合格不得开工，须报告班组长并挂“待维修”状态牌。';

export const DEMO_QUESTIONS: readonly DemoQuestion[] = [
  // Single choice: 5 CNC operation, 3 quality records.
  {
    ...wi,
    id: 'q-cnc-01',
    type: 'single',
    stem: '设备停机超过多长时间，重新开机须做首件检验？',
    options: opts('5 分钟', '10 分钟', '15 分钟', '30 分钟'),
    answer: 'C',
    explanation: '见 WI-MC-0231 4.3 停机后首件。',
    difficulty: 'easy',
    sourceExcerpt: FIRST_ARTICLE_STOP,
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-02',
    type: 'single',
    stem: '首件检验结果满足什么条件，才能开始批量加工？',
    options: opts(
      '大部分尺寸合格',
      '按检验卡测量的关键尺寸全部合格',
      '目测无毛刺、无划伤',
      '班组长看过即可',
    ),
    answer: 'B',
    explanation: '见 4.2 首件检验。',
    difficulty: 'easy',
    sourceExcerpt: FIRST_ARTICLE_CHECK,
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-03',
    type: 'single',
    stem: '批量加工中多久自检一次关键尺寸？',
    options: opts('每 5 件', '每 20 件', '每 50 件', '每班一次'),
    answer: 'B',
    explanation: '见 4.5 过程自检。',
    difficulty: 'medium',
    sourceExcerpt: '批量加工中每 20 件自检一次关键尺寸',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-04',
    type: 'single',
    stem: '开机点检应在什么时候进行？',
    options: opts('每周一次', '每班开工前', '每个工单结束后', '出现报警时'),
    answer: 'B',
    explanation: '见 5.1 开机点检。',
    difficulty: 'easy',
    sourceExcerpt: '每班开工前点检',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-05',
    type: 'single',
    stem: '操作数控车床时，以下穿戴正确的是？',
    options: opts(
      '戴棉纱手套，防止被铁屑划手',
      '戴戒指和手表，方便看时间',
      '不戴手套和首饰',
      '袖口敞开，方便操作',
    ),
    answer: 'C',
    explanation: '见 2 人员要求；SAF-0105 3 旋转设备操作。',
    difficulty: 'easy',
    sourceExcerpt: '操作旋转设备时禁止戴手套和首饰。',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-record-01',
    type: 'single',
    stem: '首件检验应依据什么逐项测量关键尺寸？',
    options: opts('检验卡', '个人经验', '上一班的口头交代', '零件外观'),
    answer: 'A',
    explanation: '见 4.2 首件检验。',
    difficulty: 'easy',
    sourceExcerpt: FIRST_ARTICLE_CHECK,
    competencyIds: RECORD,
  },
  {
    ...wi,
    id: 'q-record-02',
    type: 'single',
    stem: '过程自检发现尺寸接近公差上下限时，应该怎么做？',
    options: opts(
      '立即停机报告班组长',
      '自行修改程序补偿值后继续加工',
      '继续加工到本批结束再说',
      '把这件挑出来，其余照常加工',
    ),
    answer: 'A',
    explanation: '见 4.5 过程自检。',
    difficulty: 'medium',
    sourceExcerpt:
      '发现尺寸接近公差上下限时，立即停机报告班组长，不得自行修改程序补偿值。',
    competencyIds: RECORD,
  },
  {
    ...wi,
    id: 'q-record-03',
    type: 'single',
    stem: '按 WI-MC-0231 V4.0，首件检验结果如何确认？',
    options: opts(
      '由班组长口头确认',
      '由质量部书面批准',
      '由操作工自行判定',
      '不需要确认',
    ),
    answer: 'A',
    explanation: '见 4.4 首件记录。',
    difficulty: 'medium',
    sourceExcerpt: '首件结果由班组长口头确认。',
    competencyIds: RECORD,
  },
  // Multiple choice: 2 CNC operation, 1 quality records.
  {
    ...wi,
    id: 'q-cnc-06',
    type: 'multiple',
    stem: '开机点检包括哪些内容？',
    options: opts('润滑油位', '切削液浓度', '防护门联锁', '更衣柜整洁'),
    answer: ['A', 'B', 'C'],
    explanation: '见 5.1 开机点检。',
    difficulty: 'medium',
    sourceExcerpt: START_CHECK,
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-07',
    type: 'multiple',
    stem: '以下哪些情况须做首件检验？',
    options: opts('每班首件', '换型首件', '换刀后首件', '每次开关防护门后'),
    answer: ['A', 'B', 'C'],
    explanation: '见 4.2 首件检验。',
    difficulty: 'medium',
    sourceExcerpt: '每班首件、换型首件、换刀后首件须做首件检验。',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-record-04',
    type: 'multiple',
    stem: '开机点检不合格时应该怎么做？',
    options: opts(
      '不得开工',
      '报告班组长',
      '挂“待维修”状态牌',
      '先开工再报修',
    ),
    answer: ['A', 'B', 'C'],
    explanation: '见 5.1 开机点检。',
    difficulty: 'easy',
    sourceExcerpt: START_CHECK,
    competencyIds: RECORD,
  },
  // Judge: 2 CNC operation, 1 quality records.
  {
    ...wi,
    id: 'q-cnc-08',
    type: 'judge',
    stem: '设备停机 12 分钟后重新开机，可以不做首件检验直接批量加工。',
    options: [],
    answer: true,
    explanation: '按 V4.0，停机超过 15 分钟才须做首件检验。',
    difficulty: 'medium',
    sourceExcerpt: FIRST_ARTICLE_STOP,
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-cnc-09',
    type: 'judge',
    stem: '未取得有效 CNC 岗位上岗证的人员，可以在他人指导下独立开机加工。',
    options: [],
    answer: false,
    explanation: '未取得有效上岗证者不得独立开机加工。',
    difficulty: 'easy',
    sourceExcerpt: '未取得有效的 CNC 岗位上岗证者，不得独立开机加工。',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-record-05',
    type: 'judge',
    stem: '尺寸接近公差上限时，操作工可以先自行修改程序补偿值，事后再报告班组长。',
    options: [],
    answer: false,
    explanation: '须立即停机报告班组长，不得自行修改补偿值。',
    difficulty: 'easy',
    sourceExcerpt:
      '发现尺寸接近公差上下限时，立即停机报告班组长，不得自行修改程序补偿值。',
    competencyIds: RECORD,
  },
  // Short answer (《安全实务问答》, graded by the instructor), from SAF-0105.
  {
    ...wi,
    id: 'q-cnc-10',
    type: 'short',
    stem: '精车过程中你发现长铁屑缠绕在工件和刀具上，应该如何处理？',
    options: [],
    answer:
      '按下暂停或停止主轴，等设备停止运转后再打开防护门；不戴手套和首饰，用专用铁钩或毛刷清理铁屑，不得用手清理；关好防护门后再恢复加工；铁屑反复缠绕时报告班组长检查刀具与切削参数。',
    explanation: null,
    gradingNotes:
      '评分要点（共 4 条，按比例折算）：1. 先停机，设备停止运转后才打开防护门（3 分）；2. 不戴手套和首饰（2 分）；3. 用专用铁钩或毛刷清理，不用手清理（3 分）；4. 关好防护门后恢复，反复缠绕时报告班组长（2 分）。',
    difficulty: 'hard',
    sourceDocumentId: 'doc-saf-0105',
    sourceCourseId: 'course-safety-basics',
    sourceExcerpt:
      '设备运转中不得打开防护门，不得用手清理铁屑，须用专用铁钩或毛刷。',
    competencyIds: ['comp-cnc', 'comp-safety'],
  },
  // AI drafts awaiting review.
  {
    ...wi,
    id: 'q-draft-01',
    type: 'single',
    stem: '防护门联锁应在什么时候检查？',
    options: opts('每班开工前', '每月一次', '年度设备检修时', '发现故障后'),
    answer: 'A',
    explanation: '见 5.1 开机点检。',
    difficulty: 'easy',
    sourceExcerpt:
      '每班开工前点检，内容包括润滑油位、切削液浓度、气压、防护门联锁和急停按钮',
    source: 'ai',
    reviewStatus: 'draft',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-draft-02',
    type: 'judge',
    stem: '首件只要目测无毛刺，即可开始批量加工。',
    options: [],
    answer: false,
    explanation: '首件须按检验卡测量，结果全部合格。',
    difficulty: 'easy',
    sourceExcerpt: '结果全部合格才能批量加工',
    source: 'ai',
    reviewStatus: 'draft',
    competencyIds: CNC,
  },
  {
    ...wi,
    id: 'q-draft-03',
    type: 'single',
    stem: '开机点检不合格时应挂哪种状态牌？',
    options: opts('合格', '待维修', '停用', '待检'),
    answer: 'B',
    explanation: null,
    difficulty: 'easy',
    sourceExcerpt: '挂“待维修”状态牌',
    source: 'ai',
    reviewStatus: 'draft',
    competencyIds: RECORD,
  },
  // 讲师基础考核: 5 judge questions, no competency.
  {
    id: 'q-trainer-01',
    type: 'judge',
    stem: '讲解完操作要点后，让学员动手练习并给出反馈，比再讲一遍更有效。',
    options: [],
    answer: true,
    explanation: null,
    gradingNotes: null,
    difficulty: 'easy',
    sourceDocumentId: null,
    sourceCourseId: null,
    sourceExcerpt: null,
    ownerAccount: 'hr01',
    source: 'manual',
    reviewStatus: 'confirmed',
    competencyIds: [],
  },
  {
    id: 'q-trainer-02',
    type: 'judge',
    stem: '课程内容应以公司现行受控文件（作业指导书、制度）为依据。',
    options: [],
    answer: true,
    explanation: null,
    gradingNotes: null,
    difficulty: 'easy',
    sourceDocumentId: null,
    sourceCourseId: null,
    sourceExcerpt: null,
    ownerAccount: 'hr01',
    source: 'manual',
    reviewStatus: 'confirmed',
    competencyIds: [],
  },
  {
    id: 'q-trainer-03',
    type: 'judge',
    stem: '作业指导书升版后，已发布的课程无需复核即可继续使用。',
    options: [],
    answer: false,
    explanation: null,
    gradingNotes: null,
    difficulty: 'easy',
    sourceDocumentId: null,
    sourceCourseId: null,
    sourceExcerpt: null,
    ownerAccount: 'hr01',
    source: 'manual',
    reviewStatus: 'confirmed',
    competencyIds: [],
  },
  {
    id: 'q-trainer-04',
    type: 'judge',
    stem: '带教新员工第一次上机时，应先示范，再让新员工在监护下操作。',
    options: [],
    answer: true,
    explanation: null,
    gradingNotes: null,
    difficulty: 'easy',
    sourceDocumentId: null,
    sourceCourseId: null,
    sourceExcerpt: null,
    ownerAccount: 'hr01',
    source: 'manual',
    reviewStatus: 'confirmed',
    competencyIds: [],
  },
  {
    id: 'q-trainer-05',
    type: 'judge',
    stem: '考试题目可以考查受控文件中没有写明的内容。',
    options: [],
    answer: false,
    explanation: null,
    gradingNotes: null,
    difficulty: 'easy',
    sourceDocumentId: null,
    sourceCourseId: null,
    sourceExcerpt: null,
    ownerAccount: 'hr01',
    source: 'manual',
    reviewStatus: 'confirmed',
    competencyIds: [],
  },
];

export interface DemoExam {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly paperMode: 'fixed' | 'random';
  readonly randomRules: readonly {
    competencyId: string | null;
    questionType: DemoQuestionType;
    difficulty: string | null;
    count: number;
    scoreEach: number;
  }[];
  readonly questions: readonly { questionId: string; score: number }[];
  readonly durationMinutes: number;
  readonly maxAttempts: number;
  readonly passScore: number;
  readonly showAnswersAfter: 'never' | 'afterSubmit' | 'afterPass';
  readonly ownerAccount: string;
}

export const DEMO_EXAMS: readonly DemoExam[] = [
  {
    id: 'exam-cnc-cert',
    title: 'CNC 上岗考试',
    description:
      'CNC 岗位上岗证的必考项：随机抽题，单选 5、多选 2、判断 3，每题 10 分，80 分及格。',
    paperMode: 'random',
    // Filtered by competency so the draw never reaches questions outside WI-MC-0231.
    randomRules: [
      {
        competencyId: 'comp-cnc',
        questionType: 'single',
        difficulty: null,
        count: 3,
        scoreEach: 10,
      },
      {
        competencyId: 'comp-quality-record',
        questionType: 'single',
        difficulty: null,
        count: 2,
        scoreEach: 10,
      },
      {
        competencyId: 'comp-cnc',
        questionType: 'multiple',
        difficulty: null,
        count: 1,
        scoreEach: 10,
      },
      {
        competencyId: 'comp-quality-record',
        questionType: 'multiple',
        difficulty: null,
        count: 1,
        scoreEach: 10,
      },
      {
        competencyId: 'comp-cnc',
        questionType: 'judge',
        difficulty: null,
        count: 2,
        scoreEach: 10,
      },
      {
        competencyId: 'comp-quality-record',
        questionType: 'judge',
        difficulty: null,
        count: 1,
        scoreEach: 10,
      },
    ],
    questions: [],
    durationMinutes: 20,
    maxAttempts: 3,
    passScore: 80,
    showAnswersAfter: 'afterSubmit',
    ownerAccount: 'trainer01',
  },
  {
    id: 'exam-safety-practice',
    title: '安全实务问答',
    description:
      '固定试卷：机床安全操作与开机点检，含 1 道简答题，由讲师人工批改。',
    paperMode: 'fixed',
    randomRules: [],
    questions: [
      { questionId: 'q-cnc-05', score: 20 },
      { questionId: 'q-cnc-06', score: 20 },
      { questionId: 'q-cnc-09', score: 20 },
      { questionId: 'q-cnc-10', score: 40 },
    ],
    durationMinutes: 20,
    maxAttempts: 2,
    passScore: 70,
    showAnswersAfter: 'afterPass',
    ownerAccount: 'trainer01',
  },
  {
    id: 'exam-trainer-basic',
    title: '讲师基础考核',
    description: '内部讲师资格的考核：5 道判断题。',
    paperMode: 'fixed',
    randomRules: [],
    questions: [
      { questionId: 'q-trainer-01', score: 20 },
      { questionId: 'q-trainer-02', score: 20 },
      { questionId: 'q-trainer-03', score: 20 },
      { questionId: 'q-trainer-04', score: 20 },
      { questionId: 'q-trainer-05', score: 20 },
    ],
    durationMinutes: 15,
    maxAttempts: 3,
    passScore: 80,
    showAnswersAfter: 'afterSubmit',
    ownerAccount: 'hr01',
  },
];

export const DEMO_CERTIFICATIONS = [
  {
    id: 'cert-cnc',
    code: 'CNC-OP',
    title: 'CNC 岗位上岗证',
    description:
      '完成《CNC 岗位操作入门》并通过《CNC 上岗考试》后自动发证；持证方可独立开机，并在工单工序上开工登记。',
    validityMonths: 12,
    competencyId: null,
    competencyLevel: null,
    expiringNoticeDays: 30,
    recertAdvanceDays: 60,
    escalateDays: 7,
    recertMode: 'examOnly',
    courseIds: ['course-cnc-intro'],
    examIds: ['exam-cnc-cert'],
  },
  {
    id: 'cert-trainer',
    code: 'TRN',
    title: '内部讲师资格',
    description:
      '通过《讲师基础考核》后获得，长期有效；持证人获得讲师权限（课程、题库、考试）。',
    validityMonths: null,
    competencyId: null,
    competencyLevel: null,
    expiringNoticeDays: 30,
    recertAdvanceDays: 0,
    escalateDays: 0,
    recertMode: 'examOnly',
    courseIds: [] as string[],
    examIds: ['exam-trainer-basic'],
  },
] as const;
