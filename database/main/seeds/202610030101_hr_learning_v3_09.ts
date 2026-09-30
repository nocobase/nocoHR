import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V3-09 学习与培训, development and demo only (rows keyed on fixed ids and
 * skipped when present, so a replay never overwrites edits):
 *
 * - hr01 owns the learning coach's two new tasks — the plan after a job
 *   change and the plan for a development target — like the coach's other
 *   work (the spec's default owner). A configured owner stays.
 * - 车间主任 requires 班组管理 3, 质量记录规范 3 and 安全生产与 5S 3, all
 *   mandatory and confirmed, and 《班组管理基础》 (班组管理) is published: the
 *   promotion of 赵阳 then yields a job-change learning plan (9B 种子).
 * - 李敏 finished 《质量记录填写规范》 a month ago, so her transfer to 装配工
 *   counts that step of 《装配工上岗路径》 as completed (9B 种子).
 * - The key scenario's three sales courses (《制动系统产品知识》《解决方案报价
 *   实务》《客户需求分析与技术交流》), confirmed and published and owned by
 *   trainer01 (9B 种子). They are tagged with the step-8 competencies found by
 *   title; the courses are written only once those competencies exist (the
 *   V3-08 seed), so this seed changes nothing in an application without the
 *   sales scenario. `HR_LEARNING_DEMO=false` skips the courses.
 */
const SALES_COURSES = [
  {
    id: 'course-sales-brake-knowledge',
    title: '制动系统产品知识',
    description:
      '制动卡钳的结构、关键参数和典型应用，面向与整车厂交流的销售与方案人员。',
    competencies: ['制动系统产品知识'],
    lessons: [
      {
        title: '制动卡钳的结构与分类',
        content:
          '## 结构\n\n浮动式卡钳由卡钳体、支架、活塞和导向销组成；固定式卡钳在两侧都有活塞。\n\n## 本节要点\n\n- 能说出浮动式与固定式的区别\n- 能指出导向销的作用',
        minutes: 8,
      },
      {
        title: '关键参数怎么看',
        content:
          '## 参数\n\n活塞直径决定夹紧力，卡钳质量影响簧下质量，摩擦片面积影响耐久。\n\n## 本节要点\n\n- 活塞直径、质量、摩擦面积三个参数与客户关注点的对应关系',
        minutes: 10,
      },
      {
        title: '新平台项目中的常见需求',
        content:
          '## 需求\n\n新平台常见的要求是轻量化、低拖滞力矩和噪声控制，交流时先确认车重与制动工况。\n\n## 本节要点\n\n- 先问车重和工况，再谈方案',
        minutes: 7,
      },
    ],
  },
  {
    id: 'course-sales-quotation',
    title: '解决方案报价实务',
    description: '从客户需求到报价单：成本构成、报价审批与交付风险的说明方式。',
    competencies: ['解决方案设计与报价'],
    lessons: [
      {
        title: '报价的输入',
        content:
          '## 输入\n\n报价前须拿到图纸版本、年需求量、交付节点与质量要求，缺一项先向客户确认。\n\n## 本节要点\n\n- 四项输入齐全才开始测算',
        minutes: 8,
      },
      {
        title: '成本构成与审批',
        content:
          '## 构成\n\n报价由材料、加工、模具分摊、物流与管理费组成；超出标准毛利区间的报价须经销售总监审批。\n\n## 本节要点\n\n- 知道哪些报价需要审批',
        minutes: 10,
      },
      {
        title: '向客户说明交付风险',
        content:
          '## 风险\n\n样件周期、模具周期和产能是三类主要风险，报价时一并说明应对措施。\n\n## 本节要点\n\n- 报价附风险说明',
        minutes: 7,
      },
    ],
  },
  {
    id: 'course-sales-customer-needs',
    title: '客户需求分析与技术交流',
    description: '组织整车厂技术交流：会前准备、需求澄清与会后纪要。',
    competencies: ['客户需求分析'],
    lessons: [
      {
        title: '交流前的准备',
        content:
          '## 准备\n\n会前确认参会的客户角色、项目阶段和对方关心的问题，邀请技术中心工程师一同参加。\n\n## 本节要点\n\n- 明确对方角色与项目阶段',
        minutes: 8,
      },
      {
        title: '把需求问清楚',
        content:
          '## 澄清\n\n用开放式问题了解使用工况，用确认式问题锁定指标；不当场承诺超出能力的指标。\n\n## 本节要点\n\n- 开放式提问，确认式收口',
        minutes: 9,
      },
      {
        title: '会后纪要与跟进',
        content:
          '## 纪要\n\n会后 24 小时内发出纪要，列出已确认的需求、待确认事项和负责人。\n\n## 本节要点\n\n- 24 小时内发纪要',
        minutes: 6,
      },
    ],
  },
] as const;

const seed: SeedDefinition = defineSeed({
  name: '202610030101_hr_learning_v3_09',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const userOf = async (username: string): Promise<string> => {
      const row = await query
        .selectFrom('user')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst();
      return row ? String(row.id) : '';
    };

    // ---- The coach's new tasks are owned by hr01 ----
    const hr = await userOf('hr01');
    if (hr)
      for (const id of [
        'learningCoach.jobEventPlans',
        'learningCoach.developmentTargetPlans',
      ]) {
        const owned = await query
          .selectFrom('aiAutomationSettings')
          .select(['id'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (owned) continue;
        await query
          .insertInto('aiAutomationSettings')
          .values({
            id,
            enabled: true,
            ownerUserId: hr,
            hour: null,
            weekday: null,
            monthDay: null,
            params: null,
            updatedByUserId: null,
            ...stamp,
          })
          .execute();
      }

    if (process.env.HR_LEARNING_DEMO === 'false') return;
    const trainer = await userOf('trainer01');
    if (!trainer) return;

    // ---- 车间主任's requirements and 《班组管理基础》 ----
    const hasCompetency = async (id: string) =>
      Boolean(
        await query
          .selectFrom('competencies')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const leadExists = await query
      .selectFrom('positions')
      .select('id')
      .where('id', '=', 'pos-workshop-lead')
      .executeTakeFirst();
    if (leadExists)
      for (const [competencyId, requiredLevel] of [
        ['comp-team', 3],
        ['comp-quality-record', 3],
        ['comp-safety', 3],
      ] as const) {
        if (!(await hasCompetency(competencyId))) continue;
        const present = await query
          .selectFrom('positionRequirements')
          .select('id')
          .where('positionId', '=', 'pos-workshop-lead')
          .where('competencyId', '=', competencyId)
          .executeTakeFirst();
        if (present) continue;
        await query
          .insertInto('positionRequirements')
          .values({
            id: `req-workshop-lead-${competencyId.slice('comp-'.length)}`,
            positionId: 'pos-workshop-lead',
            competencyId,
            requiredLevel,
            mandatory: true,
            source: 'manual',
            reviewStatus: 'confirmed',
            ...stamp,
          })
          .execute();
      }
    const courses: {
      id: string;
      title: string;
      description: string;
      competencies: readonly string[];
      competencyIds?: readonly string[];
      lessons: readonly { title: string; content: string; minutes: number }[];
    }[] = [
      {
        id: 'course-team-basics',
        title: '班组管理基础',
        description: '班组长的日常：班前会、交接班、现场问题的处理与上报。',
        competencies: [],
        competencyIds: ['comp-team'],
        lessons: [
          {
            title: '班前会怎么开',
            content:
              '## 班前会\n\n每班开工前 10 分钟：讲当班任务、上一班遗留问题和安全提醒，确认人员到岗。\n\n## 本节要点\n\n- 任务、遗留问题、安全三件事',
            minutes: 8,
          },
          {
            title: '交接班与记录',
            content:
              '## 交接班\n\n交接设备状态、在制品数量和未关闭的质量问题，双方在交接记录上签字。\n\n## 本节要点\n\n- 交接三项内容，双方签字',
            minutes: 8,
          },
          {
            title: '现场问题的处理与上报',
            content:
              '## 上报\n\n质量问题先隔离再上报；设备故障停机超过 30 分钟报车间主任。\n\n## 本节要点\n\n- 先隔离，再上报',
            minutes: 9,
          },
        ],
      },
      ...SALES_COURSES,
    ];
    for (const course of courses) {
      const present = await query
        .selectFrom('courses')
        .select('id')
        .where('id', '=', course.id)
        .executeTakeFirst();
      if (present) continue;
      // By fixed id, or by title for the step-8 competencies whose ids that seed chooses.
      const competencies = course.competencyIds
        ? await query
            .selectFrom('competencies')
            .select(['id'])
            .where('id', 'in', [...course.competencyIds])
            .execute()
        : await query
            .selectFrom('competencies')
            .select(['id'])
            .where('title', 'in', [...course.competencies])
            .execute();
      const wanted = course.competencyIds ?? course.competencies;
      if (!wanted.length || competencies.length !== wanted.length) continue;
      await query
        .insertInto('courses')
        .values({
          id: course.id,
          title: course.title,
          description: course.description,
          sourceDocumentId: null,
          ownerUserId: trainer,
          source: 'manual',
          reviewStatus: 'confirmed',
          published: true,
          publishedAt: now,
          active: true,
          deliveryMode: 'online',
          ...stamp,
        })
        .execute();
      for (const competency of competencies)
        await query
          .insertInto('courseCompetencies')
          .values({
            id: `${course.id}-${String(competency.id)}`,
            courseId: course.id,
            competencyId: String(competency.id),
            ...stamp,
          })
          .execute();
      let order = 0;
      for (const lesson of course.lessons) {
        await query
          .insertInto('lessons')
          .values({
            id: `${course.id}-l${order + 1}`,
            courseId: course.id,
            sortOrder: order,
            title: lesson.title,
            content: lesson.content,
            sourceExcerpt: null,
            estimatedMinutes: lesson.minutes,
            contentType: 'markdown',
            videoFileId: null,
            videoSeconds: null,
            minWatchPercent: null,
            ...stamp,
          })
          .execute();
        order += 1;
      }
    }

    // ---- 李敏 finished 《质量记录填写规范》 ----
    const limin = await query
      .selectFrom('employees')
      .select(['id'])
      .where('id', '=', 'emp-limin')
      .executeTakeFirst();
    const qualityLessons = await query
      .selectFrom('lessons')
      .select(['id'])
      .where('courseId', '=', 'course-quality-record')
      .execute();
    const finished = await query
      .selectFrom('assignments')
      .select('id')
      .where('id', '=', 'assign-limin-quality-record')
      .executeTakeFirst();
    if (limin && qualityLessons.length && !finished) {
      const done = new Date(now.getTime() - 30 * 86_400_000);
      await query
        .insertInto('assignments')
        .values({
          id: 'assign-limin-quality-record',
          employeeId: 'emp-limin',
          courseId: 'course-quality-record',
          examId: null,
          certificateId: null,
          assignedByUserId: trainer,
          dueDate: new Date(done.getTime() + 3 * 86_400_000)
            .toISOString()
            .slice(0, 10),
          status: 'completed',
          progress: 100,
          source: 'manual',
          completedAt: done,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: new Date(done.getTime() - 5 * 86_400_000),
          updatedAt: done,
        })
        .execute();
      for (const lesson of qualityLessons) {
        const present = await query
          .selectFrom('learningRecords')
          .select('id')
          .where('employeeId', '=', 'emp-limin')
          .where('lessonId', '=', String(lesson.id))
          .executeTakeFirst();
        if (present) continue;
        await query
          .insertInto('learningRecords')
          .values({
            id: `assign-limin-quality-record-${String(lesson.id)}`,
            employeeId: 'emp-limin',
            courseId: 'course-quality-record',
            lessonId: String(lesson.id),
            startedAt: new Date(done.getTime() - 10 * 60_000),
            completedAt: done,
            durationSeconds: 600,
            ...stamp,
          })
          .execute();
      }
    }
  },
});
export default seed;
