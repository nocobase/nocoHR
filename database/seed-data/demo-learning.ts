/**
 * Demonstration knowledge documents and courses for "启衡精密" (01-演示案例.md
 * "V1 数据 · 制度文档" and "V3 数据 · 作业文件"; V1-04, V3-09 and V3-11 test
 * data). All content is fictional and marked 演示资料.
 *
 * - HR-POL-0002 states the night-shift allowance (50 元 per shift); the
 *   live-uploaded WI-PR-0101 V1.0 says 40 元 and conflicts with it.
 * - MAN-PR-0007 is visible only to workshop leads and plant directors and
 *   holds a figure operators must not see (the quarterly quality-issue line
 *   of 3).
 * - WI-MC-0231 V4.0 holds the rule the knowledge assistant must cite (4.3:
 *   a stop longer than 15 minutes needs a first-article inspection) and the
 *   numbered sections the V4.1 comparison pairs by title (4.3, 4.4, 5.1).
 *   WI-PR-0102 repeats the 15-minute rule, so the V4.1 upload conflicts with it.
 * - Nothing covers wearing a ring in the workshop in general or who signs the
 *   night-shift handover, so those questions stay knowledge gaps.
 * - Seeded documents have automatic course drafting off, so the first run
 *   drafts nothing. The files uploaded during the demo (WI-EQ-0412, WI-MC-0231
 *   V4.1, WI-PR-0101 V1.0 and V1.1, HR-POL-0010, a damaged PDF) are written to
 *   storage/demo-materials/ and never seeded (V1-04, V3-09, V3-11).
 *
 * The document preamble carries the number but not the version, so a version
 * comparison reports only the sections that changed.
 */

export interface DemoDocument {
  readonly id: string;
  readonly fileId: string;
  /** The title without its number; the number and version are separate fields. */
  readonly title: string;
  readonly docNo: string;
  readonly version: string;
  readonly filename: string;
  readonly category: 'policy' | 'sop' | 'manual' | 'other';
  readonly ownerAccount: string;
  readonly visibility: 'all' | 'restricted';
  readonly positionIds: readonly string[];
  readonly competencyIds: readonly string[];
  /** Days from the seed run to the next review; negative is overdue. */
  readonly reviewInDays: number;
  /** Days from the seed run to the effective date (negative: in the past). */
  readonly effectiveInDays: number;
  readonly content: string;
}

const PREAMBLE = (docNo: string, extra = '') =>
  `> 演示资料：本文档内容为虚构，仅用于 NocoHR 演示。启衡精密科技，文件编号 ${docNo}。${extra}`;

const WI_MC_0231_COMMON = {
  intro: `# 1 目的与适用范围
规范机加工车间数控车床与加工中心的操作，保证制动卡钳、转向节等零件的尺寸与表面质量。适用于苏州工厂机加工车间、成都工厂成都机加工车间的全部 CNC 操作工。未取得有效的 CNC 岗位上岗证者，不得独立开机加工。

# 2 人员要求
- 操作工须完成《CNC 岗位操作入门》培训并通过《CNC 上岗考试》，持有有效的 CNC 岗位上岗证。
- 上岗前按《安全与 5S 管理规定》（SAF-0105）穿戴劳保用品；操作旋转设备时禁止戴手套和首饰。

# 3 职责
- CNC 操作工：开机点检、装夹与加工、首件检验、过程自检和日常保养。
- 班组长：确认首件结果，处理停机和尺寸异常。
- 质量部：维护检验卡，按计划抽检。

# 4.1 装夹与对刀
- 按工艺卡选用夹具，清理定位面铁屑后装夹，确认工件无松动。
- 更换刀具后重新对刀，并在机床上空运行一次程序，确认刀路无干涉。

# 4.2 首件检验
- 每班首件、换型首件、换刀后首件须做首件检验。
- 首件检验按检验卡逐项测量关键尺寸（孔径、位置度、端面跳动），用三坐标或专用检具，结果全部合格才能批量加工。`,
  selfCheck: `# 4.5 过程自检
批量加工中每 20 件自检一次关键尺寸；发现尺寸接近公差上下限时，立即停机报告班组长，不得自行修改程序补偿值。`,
  maintenance: `# 5.1 开机点检
每班开工前点检，内容包括润滑油位、切削液浓度、气压、防护门联锁和急停按钮；点检不合格不得开工，须报告班组长并挂“待维修”状态牌。

# 5.2 日常保养
每班结束前清理铁屑和工作台，擦拭导轨；切削液过滤网每周清洗一次，按《设备点检与保养规程》执行。`,
};

const wiMc0231 = (stop: string, record: string) =>
  `${PREAMBLE('WI-MC-0231')}

${WI_MC_0231_COMMON.intro}

# 4.3 停机后首件
${stop}

# 4.4 首件记录
${record}

${WI_MC_0231_COMMON.selfCheck}

${WI_MC_0231_COMMON.maintenance}`;

const WI_MC_0231_V40 = wiMc0231(
  '设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。停机原因包括设备故障、换班交接、待料和午休。',
  '首件结果由班组长口头确认。',
);

const WI_MC_0231_V41 = wiMc0231(
  '设备停机超过 10 分钟，重新开机须做首件检验，合格后才能批量加工。停机原因包括设备故障、换班交接、待料和午休。',
  '首件结果须记入首件检验记录表并由班组长签字。',
);

const wiPr0101 = (allowance: string) => `${PREAMBLE('WI-PR-0101')}

# 1 适用范围
适用于苏州工厂机加工车间的全部一线员工与班组长。

# 2 班次安排
机加工车间实行三班倒：早班 06:00–14:00、中班 14:00–22:00、夜班 22:00–06:00（跨天）。班次每周一轮换一次，顺序为早班 → 中班 → 夜班。

# 3 排班发布
车间主任每周四在系统中发布下周排班；持有有效 CNC 岗位上岗证的人员才能排入机加工班次。

# 4 换班
换班须提前 1 天在系统中申请，经车间主任同意；换班双方须为同一岗位且均持有有效上岗证。

# 5 津贴
${allowance}`;

export const DEMO_DOCUMENTS: readonly DemoDocument[] = [
  {
    id: 'doc-hr-pol-0001',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000004',
    title: '员工手册',
    docNo: 'HR-POL-0001',
    version: 'V5.0',
    filename: 'HR-POL-0001 员工手册 V5.0.md',
    category: 'policy',
    ownerAccount: 'hr01',
    visibility: 'all',
    positionIds: [],
    competencyIds: [],
    reviewInDays: 20,
    effectiveInDays: -345,
    content: `${PREAMBLE('HR-POL-0001')}

# 1 适用范围
适用于启衡精密科技苏州工厂、成都工厂及总部的全部员工，含试用期员工；临时工另有约定的从其约定。

# 2 工作时间
机加工车间实行三班倒（综合计算工时），装配车间实行两班制，职能部门实行标准工时（08:30–17:30）。具体班次与考勤按《考勤与加班管理制度》（HR-POL-0002）执行。

# 3 年假
- 年假天数按累计工作年限确定：满 1 年不满 10 年 5 天，满 10 年不满 20 年 10 天，满 20 年 15 天。
- 当年入职的员工按剩余日历天数折算，不足 1 天的部分不计。
- 在本公司工作满 1 年后，当年年假可分两次休，每次不少于 1 天；未满 1 年的须一次休完。
- 年假须提前 3 个工作日在系统中申请，由直接上级审批；当年未休的年假不跨年结转。

# 4 请假
病假须提供医院证明；事假须提前一个工作日在系统中申请，由直接上级审批，事假按日扣发工资。

# 5 培训与上岗
新员工入职后须完成三级安全教育；CNC 操作工等关键岗位须取得相应上岗证后方可独立上岗，上岗证到期前须完成复审。

# 6 行为准则
遵守公司保密制度，不得在社交媒体发布车间照片、客户图纸和工艺参数。`,
  },
  {
    id: 'doc-hr-pol-0002',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000005',
    title: '考勤与加班管理制度',
    docNo: 'HR-POL-0002',
    version: 'V3.2',
    filename: 'HR-POL-0002 考勤与加班管理制度 V3.2.md',
    category: 'policy',
    ownerAccount: 'hr01',
    visibility: 'all',
    positionIds: [],
    competencyIds: [],
    reviewInDays: 200,
    effectiveInDays: -165,
    content: `${PREAMBLE('HR-POL-0002')}

# 1 适用范围
适用于启衡精密科技全体员工。

# 2 班次与打卡
- 机加工车间：早班 06:00–14:00、中班 14:00–22:00、夜班 22:00–06:00（跨天），考勤机打卡。
- 装配车间：两班制 08:00–20:00、20:00–08:00，考勤机打卡。
- 职能部门：常日班 08:30–17:30，飞书打卡。

# 3 迟到与缺卡
迟到 30 分钟以内按迟到计，超过 30 分钟按旷工半天计。缺卡须在 3 个工作日内在系统中提交补卡申请，由直接上级审批，每月补卡不超过 3 次。

# 4 加班
- 加班须提前在系统申请，经直接上级审批；未提前申请的不计加班。
- 加班费按国家规定计发：工作日 1.5 倍、休息日 2 倍（未安排补休时）、法定节假日 3 倍。

# 5 夜班津贴
夜班津贴每班 50 元，按当月实际出勤的夜班数计发，随当月工资发放。`,
  },
  {
    id: 'doc-man-pr-0007',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000003',
    title: '车间管理人员手册',
    docNo: 'MAN-PR-0007',
    version: 'V1.3',
    filename: 'MAN-PR-0007 车间管理人员手册 V1.3.md',
    category: 'manual',
    ownerAccount: 'hr01',
    visibility: 'restricted',
    positionIds: ['pos-workshop-lead', 'pos-plant-director'],
    competencyIds: ['comp-team'],
    reviewInDays: -10,
    effectiveInDays: -375,
    content: `${PREAMBLE('MAN-PR-0007', '仅限车间主任、厂长查阅。')}

# 1 质量指标
- 车间季度质量问题考核线为 3 起，超过考核线的车间须在 5 个工作日内提交专项整改计划（8D）。
- 零件一次交检合格率目标 99.5%；客户投诉和批量尺寸超差纳入车间月度考核。

# 2 人员资质管理
- CNC 操作工须持有有效的 CNC 岗位上岗证方可独立开机；上岗证过期或被暂停的人员不得排入机加工班次。
- 车间主任每月查看一次本车间的持证情况，提前安排即将到期人员参加复审。

# 3 排产与交接
- 每日下班前确认次日排产；设备计划保养须提前 3 天与生产计划部门协调。
- 交接班时双方共同确认设备状态、在制品数量和异常记录。

# 4 班组沟通
每天开班前召开 10 分钟班前会：昨日质量情况、今日重点和一项安全提醒。`,
  },
  {
    id: 'doc-saf-0105',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000002',
    title: '安全与 5S 管理规定',
    docNo: 'SAF-0105',
    version: 'V2.1',
    filename: 'SAF-0105 安全与 5S 管理规定 V2.1.md',
    category: 'policy',
    ownerAccount: 'hr01',
    visibility: 'all',
    positionIds: [],
    competencyIds: ['comp-safety'],
    reviewInDays: 300,
    effectiveInDays: -65,
    content: `${PREAMBLE('SAF-0105')}

# 1 适用范围
适用于进入苏州工厂、成都工厂生产现场的全部人员，包括操作工、维修人员、质量人员和来访人员。

# 2 劳保用品
- 进入车间须穿工作服、安全鞋，佩戴防护眼镜；噪声区域佩戴耳塞。
- 长发须盘入工作帽内，工作服袖口须扎紧。

# 3 旋转设备操作
- 操作旋转设备时禁止戴手套和首饰。
- 设备运转中不得打开防护门，不得用手清理铁屑，须用专用铁钩或毛刷。
- 防护门联锁、急停按钮失效时不得开机。

# 4 5S 现场管理
- 整理、整顿、清扫、清洁、素养：工位只放当班所需的工件、刀具和量具，物品定置摆放。
- 每班结束前清扫工位，地面油污当班清理；车间每周五进行 5S 检查并公示结果。

# 5 安全事件报告
发生人身伤害、设备损坏或未遂事件，立即停机并报告班组长，当班内填写安全事件报告；不得隐瞒或私自处理。`,
  },
  {
    id: 'doc-wi-mc-0231',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000001',
    title: 'CNC 加工作业指导书',
    docNo: 'WI-MC-0231',
    version: 'V4.0',
    filename: 'WI-MC-0231 CNC 加工作业指导书 V4.0.md',
    category: 'sop',
    ownerAccount: 'trainer01',
    visibility: 'all',
    positionIds: [],
    competencyIds: ['comp-cnc', 'comp-quality-record'],
    reviewInDays: 180,
    effectiveInDays: -120,
    content: WI_MC_0231_V40,
  },
  {
    id: 'doc-wi-pr-0102',
    fileId: '6d1f4c1e-0a4b-4c5e-9b1a-000000000006',
    title: '机加工车间交接班须知',
    docNo: 'WI-PR-0102',
    version: 'V1.0',
    filename: 'WI-PR-0102 机加工车间交接班须知 V1.0.md',
    category: 'sop',
    ownerAccount: 'mgr_njl',
    visibility: 'all',
    positionIds: [],
    competencyIds: ['comp-cnc'],
    reviewInDays: 180,
    effectiveInDays: -90,
    content: `${PREAMBLE('WI-PR-0102')}

# 1 适用范围
适用于苏州工厂机加工车间早、中、夜三班之间的交接。

# 2 交接内容
- 设备状态：运行、停机或待维修，停机的注明原因和时长。
- 在制品：当前工序、已加工数量和待检数量。
- 刀具与量具：刀具剩余寿命、需要更换的刀具和量具校准到期情况。
- 异常：本班发生的质量问题、设备报警和未完成的处理事项。

# 3 停机与首件
停机超过 15 分钟须做首件检验，首件合格后方可继续批量加工。跨班停机的，由接班人员完成首件检验。

# 4 交接记录
交接内容填写在机台旁的交接班记录本上，记录本由班组长每周收回存档，保存 1 年。`,
  },
];

export interface DemoUploadMaterial {
  readonly filename: string;
  readonly content: string;
}

/**
 * Files uploaded live during the demo; never seeded as documents. The seed
 * writes them to storage/demo-materials/.
 *
 * - WI-EQ-0412 V1.0 (trainer01): the content writer drafts a course from it.
 * - WI-MC-0231 V4.1 (trainer01, as a new version): 4.3 and 4.4 change, 5.1
 *   does not; it conflicts with WI-PR-0102 section 3.
 * - WI-PR-0101 V1.0 (hr01): "夜班津贴每班 40 元" conflicts with HR-POL-0002;
 *   V1.1 (mgr_njl, as a new version) changes only section 5 to 50 元.
 * - HR-POL-0010 V1.0 (hr01): bus timetable and dormitory repairs, for the
 *   "add an AI employee" customisation demo.
 * - A damaged PDF, to show a parse failure.
 */
export const DEMO_UPLOAD_MATERIALS: readonly DemoUploadMaterial[] = [
  {
    filename: 'WI-EQ-0412 设备点检与保养规程 V1.0.md',
    content: `${PREAMBLE('WI-EQ-0412')}

# 1 适用范围
适用于机加工车间数控车床与加工中心的日常点检和定期保养，由 CNC 操作工和设备维修工执行。

# 2 日常点检
每班开工前点检以下项目，结果记入设备点检表：
- 润滑油位在上下刻度线之间；
- 切削液浓度 5%–8%（用折光仪测量）；
- 气压 0.5–0.7 MPa；
- 防护门联锁、急停按钮动作有效。

# 3 周保养
每周五由操作工完成：清理排屑器和切削液箱铁屑，清洗切削液过滤网，检查导轨润滑情况并擦拭导轨防护罩。

# 4 月保养
每月由设备维修工与操作工共同完成：检查主轴温升和异响，检查皮带张紧度，校验机床水平，清洁电气柜滤网。

# 5 异常处理与记录
点检或保养中发现异常，不得开机，挂“待维修”状态牌并报告班组长；维修完成后由维修工在设备点检表上注明处理结果，操作工确认后方可恢复生产。`,
  },
  {
    filename: 'WI-MC-0231 CNC 加工作业指导书 V4.1.md',
    content: WI_MC_0231_V41,
  },
  {
    filename: 'WI-PR-0101 机加工车间排班须知 V1.0.md',
    content: wiPr0101(
      '夜班津贴每班 40 元，由车间按当月夜班数汇总后报人力资源部，随当月工资发放。',
    ),
  },
  {
    filename: 'WI-PR-0101 机加工车间排班须知 V1.1.md',
    content: wiPr0101(
      '夜班津贴每班 50 元，由车间按当月夜班数汇总后报人力资源部，随当月工资发放。',
    ),
  },
  {
    filename: 'HR-POL-0010 宿舍管理规定 V1.0.md',
    content: `${PREAMBLE('HR-POL-0010')}

# 1 宿舍分配
苏州工厂员工宿舍位于厂区东侧，4 人间，配空调和独立卫生间。入职时由人力资源部按班次分配，同一班次的员工安排同住；调换宿舍须在系统中申请。

# 2 班车时刻
- 去程（市区地铁站 → 苏州工厂）：05:20、13:20、21:20，分别对应早班、中班、夜班。
- 返程（苏州工厂 → 市区地铁站）：06:15、14:15、22:15。
- 节假日班车另行通知；班车凭工牌乘坐。

# 3 报修
宿舍水电、空调、门锁故障在飞书“宿舍报修”应用中提交，后勤在 24 小时内上门处理；紧急漏水请直接拨打后勤值班电话。

# 4 宿舍纪律
宿舍内禁止使用大功率电器和明火；夜班员工白天休息，其他人员 09:00–16:00 保持安静；访客须在门卫登记，不得留宿。`,
  },
  {
    filename: '损坏的样例文件（演示资料）.pdf',
    // Truncated on purpose: a PDF header with no body or trailer.
    content: '%PDF-1.4\n%âãÏÓ\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R',
  },
];

export interface DemoLesson {
  readonly title: string;
  readonly content: string;
  readonly sourceExcerpt: string;
  readonly estimatedMinutes: number;
}

export interface DemoCourse {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly sourceDocumentId: string;
  readonly ownerAccount: string;
  readonly source: 'manual' | 'ai';
  readonly reviewStatus: 'draft' | 'confirmed';
  readonly published: boolean;
  readonly competencyIds: readonly string[];
  readonly lessons: readonly DemoLesson[];
}

export const DEMO_COURSES: readonly DemoCourse[] = [
  {
    id: 'course-cnc-intro',
    title: 'CNC 岗位操作入门',
    description:
      '面向新上岗的 CNC 操作工：开机点检与装夹、停机后首件检验、首件检验与过程自检。',
    sourceDocumentId: 'doc-wi-mc-0231',
    ownerAccount: 'trainer01',
    source: 'manual',
    reviewStatus: 'confirmed',
    published: true,
    competencyIds: ['comp-cnc', 'comp-quality-record'],
    lessons: [
      {
        title: '开机点检与装夹',
        estimatedMinutes: 6,
        sourceExcerpt:
          '每班开工前点检，内容包括润滑油位、切削液浓度、气压、防护门联锁和急停按钮',
        content: `## 什么时候点检
**每班开工前**点检，内容包括：润滑油位、切削液浓度、气压、防护门联锁和急停按钮。

## 点检不合格怎么办
不得开工，报告班组长，挂“**待维修**”状态牌。

## 装夹与对刀
1. 按工艺卡选用夹具，清理定位面铁屑后装夹，确认工件无松动。
2. 更换刀具后重新对刀，空运行一次程序，确认刀路无干涉。

## 本节要点
- 每班开工前点检，不合格不开工
- 换刀后重新对刀并空运行`,
      },
      {
        title: '停机后首件检验',
        estimatedMinutes: 8,
        sourceExcerpt:
          '设备停机超过 15 分钟，重新开机须做首件检验，合格后才能批量加工。',
        content: `## 什么时候要重新做首件
设备停机超过 **15 分钟**，重新开机须做首件检验，**合格后才能批量加工**。

停机原因包括设备故障、换班交接、待料和午休——不论什么原因，只看停机时长。

## 首件结果谁来确认
首件结果由班组长口头确认。

## 本节要点
- 停机超过 15 分钟 → 重新开机先做首件检验
- 首件合格后才能批量加工`,
      },
      {
        title: '首件检验与过程自检',
        estimatedMinutes: 6,
        sourceExcerpt:
          '首件检验按检验卡逐项测量关键尺寸（孔径、位置度、端面跳动），用三坐标或专用检具，结果全部合格才能批量加工。',
        content: `## 哪些情况要做首件
每班首件、换型首件、换刀后首件。

## 测什么
按检验卡逐项测量关键尺寸：**孔径、位置度、端面跳动**，用三坐标或专用检具，全部合格才能批量加工。

## 过程自检
批量加工中**每 20 件**自检一次关键尺寸；尺寸接近公差上下限时立即停机报告班组长，不得自行修改补偿值。

## 本节要点
- 每班、换型、换刀后都要做首件
- 每 20 件自检一次`,
      },
    ],
  },
  {
    id: 'course-safety-basics',
    title: '车间安全与 5S 基础',
    description:
      '劳保用品与着装、旋转设备安全操作、5S 现场管理与安全事件报告。（AI 草稿，待讲师确认）',
    sourceDocumentId: 'doc-saf-0105',
    ownerAccount: 'trainer01',
    source: 'ai',
    reviewStatus: 'draft',
    published: false,
    competencyIds: ['comp-safety'],
    lessons: [
      {
        title: '劳保用品与着装',
        estimatedMinutes: 5,
        sourceExcerpt:
          '进入车间须穿工作服、安全鞋，佩戴防护眼镜；噪声区域佩戴耳塞。',
        content:
          '进入车间须穿工作服、安全鞋，佩戴防护眼镜；噪声区域佩戴耳塞。长发须盘入工作帽内，工作服袖口须扎紧。\n\n**本节要点**：工作服、安全鞋、防护眼镜缺一不可。',
      },
      {
        title: '旋转设备安全操作',
        estimatedMinutes: 6,
        sourceExcerpt: '操作旋转设备时禁止戴手套和首饰。',
        content:
          '操作旋转设备时**禁止戴手套和首饰**。设备运转中不得打开防护门，不得用手清理铁屑，须用专用铁钩或毛刷；防护门联锁、急停按钮失效时不得开机。\n\n**本节要点**：不戴手套和首饰；运转中不开防护门、不用手清屑。',
      },
      {
        title: '5S 现场管理',
        estimatedMinutes: 5,
        sourceExcerpt: '工位只放当班所需的工件、刀具和量具，物品定置摆放。',
        content:
          '整理、整顿、清扫、清洁、素养：工位只放当班所需的工件、刀具和量具，物品定置摆放。每班结束前清扫工位，地面油污当班清理；车间每周五进行 5S 检查并公示结果。\n\n**本节要点**：定置摆放，当班清扫。',
      },
      {
        title: '安全事件报告',
        estimatedMinutes: 4,
        sourceExcerpt:
          '发生人身伤害、设备损坏或未遂事件，立即停机并报告班组长，当班内填写安全事件报告',
        content:
          '发生人身伤害、设备损坏或未遂事件，立即停机并报告班组长，当班内填写安全事件报告；不得隐瞒或私自处理。\n\n**本节要点**：先停机、再报告，当班填报。',
      },
    ],
  },
];
