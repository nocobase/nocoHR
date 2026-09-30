import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  DEMO_ASSEMBLER_REQUIREMENTS,
  DEMO_ASSEMBLY_EXAM,
  DEMO_ASSEMBLY_QUESTIONS,
  DEMO_PATHS,
  DEMO_SCENARIOS,
  DEMO_V2_COURSES,
  DEMO_VIDEO_LESSON,
} from '../../seed-data/demo-training.js';

/**
 * Training operations demonstration data (V2 step 5), added to the
 * "启衡精密" data for development and demo environments only. Rows are keyed
 * on fixed ids and skipped when present, so a replay never overwrites edits.
 *
 * - 刘洋 (emp_njl_4, 机加工车间 CNC 操作工) joined two days ago, with no tasks
 *   and no assessments; he demonstrates the onboarding path and the practice.
 * - 《车间安全与 5S 基础》 is published with a generated video lesson
 *   《劳保用品穿戴》 as its last lesson; the offline 《CNC 首件检验实操培训》,
 *   《装配岗位操作入门》, 《质量记录填写规范》 and the assembly exam are
 *   published; two learning paths and three sessions (苏州 ×2, 成都 ×1) exist.
 * - 装配工 requires 安全生产与 5S 2 and 质量记录规范 2, both mandatory; 孙丽
 *   has finished 《车间安全与 5S 基础》 and is half way through 《装配岗位操作入门》.
 * - Practice scenario "班组长现场抽问" is confirmed, "客户审核问询" is a draft.
 * - 李敏 has an uncovered gap in 安全生产与 5S (level 1 of 2); the other CNC
 *   operators are assessed so that only she yields a learning plan.
 * - 王磊 has finished 《CNC 岗位操作入门》, and two lagging courses: one
 *   never reminded, one reminded twice and due in two days.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609290102_hr_demo_training',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    // Needs the V1 learning and exam demo data.
    if (
      !(await query
        .selectFrom('courses')
        .select('id')
        .where('id', '=', 'course-safety-basics')
        .executeTakeFirst()) ||
      !(await query
        .selectFrom('exams')
        .select('id')
        .where('id', '=', 'exam-cnc-cert')
        .executeTakeFirst())
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const todayDate = now.toISOString().slice(0, 10);
    const shift = (days: number) => {
      const d = new Date(`${todayDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const daysAgo = (days: number) =>
      new Date(now.getTime() - days * 86_400_000);
    const exists = async (table: string, id: string) =>
      Boolean(
        await query
          .selectFrom(table)
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst(),
      );
    const userIdOf = async (username: string): Promise<string> => {
      const row = await query
        .selectFrom('user')
        .select('id')
        .where('username', '=', username)
        .executeTakeFirst();
      return row ? String(row.id) : '';
    };
    const trainer = await userIdOf('trainer01');
    const headNjl = await userIdOf('mgr_njl');
    const hr = await userIdOf('hr01');

    // ---- 刘洋, new CNC operator, joined two days ago ----
    const liuyang = await ensureDemoAccount(query, {
      username: 'emp_njl_4',
      name: '刘洋',
      email: 'emp.njl.4@demo.test',
    });
    if (!(await exists('employees', 'emp-liuyang'))) {
      await query
        .insertInto('employees')
        .values({
          id: 'emp-liuyang',
          employeeNo: 'QH2004',
          name: '刘洋',
          userId: liuyang,
          departmentId: 'sz-mc',
          positionId: 'pos-cnc-operator',
          managerEmployeeId: 'emp-mgr-njl',
          status: 'probation',
          hireDate: shift(-2),
          positionSince: shift(-2),
          email: 'emp.njl.4@demo.test',
          mobile: '13900000012',
          note: null,
          gender: 'male',
          birthDate: '2001-03-12',
          idType: 'idCard',
          idNumber: '999999200103120012',
          employmentType: 'fullTime',
          workLocation: '苏州工厂',
          probationEndDate: shift(180 - 2),
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市吴中区木渎镇金山路 66 号 3 幢 702 室',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('departmentMembers')
        .values({
          id: randomUUID(),
          departmentId: 'sz-mc',
          userId: liuyang,
          primary: true,
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employmentContracts')
        .values({
          id: 'contract-liuyang',
          employeeId: 'emp-liuyang',
          contractNo: 'HT-2026-031',
          type: 'fixedTerm',
          startDate: shift(-2),
          endDate: shift(3 * 365 - 2),
          status: 'active',
          previousContractId: null,
          signedAt: shift(-2),
          fileId: null,
          note: null,
          ...stamp,
        })
        .execute();
    }

    // ---- 《车间安全与 5S 基础》: published, with the video lesson 《劳保用品穿戴》 last ----
    if (!(await exists('lessons', DEMO_VIDEO_LESSON.id))) {
      const assetFile = fileURLToPath(
        new URL(
          `../../seed-data/assets/${DEMO_VIDEO_LESSON.asset}`,
          import.meta.url,
        ),
      );
      // A build that did not carry the asset gets the course without the video.
      if (existsSync(assetFile)) {
        const key = `hr-files/demo/${DEMO_VIDEO_LESSON.asset}`;
        const target = path.resolve(process.cwd(), 'storage', key);
        mkdirSync(path.dirname(target), { recursive: true });
        copyFileSync(assetFile, target);
        if (!(await exists('hrFiles', DEMO_VIDEO_LESSON.fileId)))
          await query
            .insertInto('hrFiles')
            .values({
              id: DEMO_VIDEO_LESSON.fileId,
              disk: 'local',
              key,
              filename: DEMO_VIDEO_LESSON.filename,
              ext: 'mp4',
              mimeType: 'video/mp4',
              size: statSync(target).size,
              ...stamp,
            })
            .execute();
        // Appended after the text lessons (V3-09 9B: the fifth lesson).
        const existing = await query
          .selectFrom('lessons')
          .select(['sortOrder'])
          .where('courseId', '=', DEMO_VIDEO_LESSON.courseId)
          .execute();
        const sortOrder = existing.reduce(
          (next, lesson) => Math.max(next, Number(lesson.sortOrder) + 1),
          0,
        );
        await query
          .insertInto('lessons')
          .values({
            id: DEMO_VIDEO_LESSON.id,
            courseId: DEMO_VIDEO_LESSON.courseId,
            sortOrder,
            title: DEMO_VIDEO_LESSON.title,
            content: DEMO_VIDEO_LESSON.content,
            sourceExcerpt: null,
            estimatedMinutes: Math.round(DEMO_VIDEO_LESSON.videoSeconds / 60),
            contentType: 'video',
            videoFileId: DEMO_VIDEO_LESSON.fileId,
            videoSeconds: DEMO_VIDEO_LESSON.videoSeconds,
            minWatchPercent: DEMO_VIDEO_LESSON.minWatchPercent,
            ...stamp,
          })
          .execute();
      }
      await query
        .updateTable('courses')
        .set({
          // No longer the V1 draft: reviewed and published, so its description loses the draft note.
          description:
            '劳保用品与着装、旋转设备安全操作、5S 现场管理与安全事件报告。',
          reviewStatus: 'confirmed',
          published: true,
          publishedAt: now,
          updatedAt: now,
        })
        .where('id', '=', DEMO_VIDEO_LESSON.courseId)
        .execute();
    }

    // ---- Courses added in V2 ----
    for (const course of DEMO_V2_COURSES) {
      if (await exists('courses', course.id)) continue;
      await query
        .insertInto('courses')
        .values({
          id: course.id,
          title: course.title,
          description: course.description,
          sourceDocumentId: course.sourceDocumentId,
          ownerUserId: trainer,
          source: 'manual',
          reviewStatus: 'confirmed',
          published: true,
          publishedAt: now,
          active: true,
          deliveryMode: course.deliveryMode,
          ...stamp,
        })
        .execute();
      for (const competencyId of course.competencyIds)
        await query
          .insertInto('courseCompetencies')
          .values({
            id: `${course.id}-${competencyId}`,
            courseId: course.id,
            competencyId,
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
            estimatedMinutes: lesson.estimatedMinutes,
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

    // ---- 装配工's position requirements, keyed on position and competency ----
    for (const requirement of DEMO_ASSEMBLER_REQUIREMENTS) {
      const present = await query
        .selectFrom('positionRequirements')
        .select('id')
        .where('positionId', '=', 'pos-assembler')
        .where('competencyId', '=', requirement.competencyId)
        .executeTakeFirst();
      if (present || (await exists('positionRequirements', requirement.id)))
        continue;
      await query
        .insertInto('positionRequirements')
        .values({
          ...requirement,
          positionId: 'pos-assembler',
          source: 'manual',
          reviewStatus: 'confirmed',
          ...stamp,
        })
        .execute();
    }

    // ---- 装配岗位考试 ----
    for (const question of DEMO_ASSEMBLY_QUESTIONS) {
      if (await exists('questions', question.id)) continue;
      await query
        .insertInto('questions')
        .values({
          id: question.id,
          type: 'judge',
          stem: question.stem,
          options: JSON.stringify([]),
          answer: JSON.stringify(question.answer),
          explanation: question.explanation,
          gradingNotes: null,
          difficulty: 'easy',
          sourceDocumentId: null,
          sourceCourseId: 'course-assembly-intro',
          sourceExcerpt: null,
          score: 20,
          ownerUserId: trainer,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
          ...stamp,
        })
        .execute();
      // Tagged 安全生产与 5S, not 质量记录规范: the CNC exam draws its record questions by competency and must
      // never pick an assembly question.
      await query
        .insertInto('questionCompetencies')
        .values({
          id: `${question.id}-comp-safety`,
          questionId: question.id,
          competencyId: 'comp-safety',
          ...stamp,
        })
        .execute();
    }
    if (!(await exists('exams', DEMO_ASSEMBLY_EXAM.id))) {
      await query
        .insertInto('exams')
        .values({
          id: DEMO_ASSEMBLY_EXAM.id,
          title: DEMO_ASSEMBLY_EXAM.title,
          description: DEMO_ASSEMBLY_EXAM.description,
          paperMode: 'fixed',
          randomRules: JSON.stringify([]),
          durationMinutes: 15,
          maxAttempts: 3,
          passScore: 80,
          showAnswersAfter: 'afterSubmit',
          ownerUserId: trainer,
          published: true,
          active: true,
          ...stamp,
        })
        .execute();
      let order = 0;
      for (const question of DEMO_ASSEMBLY_QUESTIONS) {
        await query
          .insertInto('examQuestions')
          .values({
            id: `${DEMO_ASSEMBLY_EXAM.id}-${question.id}`,
            examId: DEMO_ASSEMBLY_EXAM.id,
            questionId: question.id,
            sortOrder: order,
            score: 20,
            ...stamp,
          })
          .execute();
        order += 1;
      }
    }

    // ---- Practice scenarios ----
    for (const scenario of DEMO_SCENARIOS) {
      if (await exists('practiceScenarios', scenario.id)) continue;
      await query
        .insertInto('practiceScenarios')
        .values({
          id: scenario.id,
          title: scenario.title,
          persona: scenario.persona,
          situation: scenario.situation,
          openingLine: scenario.openingLine,
          rubric: JSON.stringify(scenario.rubric),
          sourceDocumentId: scenario.sourceDocumentId,
          maxTurns: 12,
          passScore: 70,
          ownerUserId: trainer,
          source: scenario.source,
          reviewStatus: scenario.reviewStatus,
          active: true,
          ...stamp,
        })
        .execute();
      for (const competencyId of [
        ...new Set(scenario.rubric.map((r) => r.competencyId)),
      ])
        await query
          .insertInto('practiceScenarioCompetencies')
          .values({
            id: `${scenario.id}-${competencyId}`,
            scenarioId: scenario.id,
            competencyId,
            ...stamp,
          })
          .execute();
    }

    // ---- Learning paths ----
    for (const pathDef of DEMO_PATHS) {
      if (await exists('learningPaths', pathDef.id)) continue;
      await query
        .insertInto('learningPaths')
        .values({
          id: pathDef.id,
          code: pathDef.code,
          title: pathDef.title,
          description: pathDef.description,
          positionId: pathDef.positionId,
          purpose: 'onboarding',
          sequential: true,
          skipCompleted: true,
          ownerUserId: trainer,
          published: true,
          publishedAt: now,
          active: true,
          ...stamp,
        })
        .execute();
      let order = 0;
      for (const step of pathDef.steps) {
        await query
          .insertInto('learningPathSteps')
          .values({
            id: `${pathDef.id}-s${order + 1}`,
            pathId: pathDef.id,
            sortOrder: order,
            stepType: step.stepType,
            courseId: step.stepType === 'course' ? step.ref : null,
            examId: step.stepType === 'exam' ? step.ref : null,
            practiceScenarioId: step.stepType === 'practice' ? step.ref : null,
            dueOffsetDays: step.due,
            required: true,
            ...stamp,
          })
          .execute();
        order += 1;
      }
    }

    // ---- Sessions of the offline first-article training, 09:00–12:00 local (UTC+8):
    // two in 苏州 (in 3 and 10 days) and one in 成都 (in 5 days) ----
    const sessions: [string, number, string, string][] = [
      ['session-gowning-1', 3, '苏州工厂培训室', '苏州第 1 期'],
      ['session-gowning-2', 10, '苏州工厂培训室', '苏州第 2 期'],
      ['session-first-article-cd-1', 5, '成都工厂培训室', '成都第 1 期'],
    ];
    for (const [id, days, location, label] of sessions) {
      if (await exists('trainingSessions', id)) continue;
      const day = shift(days);
      const startAt = new Date(`${day}T01:00:00Z`);
      await query
        .insertInto('trainingSessions')
        .values({
          id,
          courseId: 'course-first-article-practical',
          title: `CNC 首件检验实操培训 · ${label}`,
          instructorUserId: trainer,
          startAt,
          endAt: new Date(`${day}T04:00:00Z`),
          location,
          capacity: 12,
          enrollDeadline: new Date(startAt.getTime() - 24 * 60 * 60_000),
          status: 'scheduled',
          ownerUserId: trainer,
          ...stamp,
        })
        .execute();
    }

    // ---- Assessments: only 李敏 keeps an uncovered gap (安全生产与 5S 1 of 2) ----
    const assessments: [string, string, string, number, number][] = [
      ['assess-limin-aseptic', 'emp-limin', 'comp-safety', 1, 10],
      ['assess-limin-gowning', 'emp-limin', 'comp-safety-license', 1, 10],
      ['assess-wanglei-gowning', 'emp-wanglei', 'comp-safety-license', 1, 30],
      ['assess-qianjin-filling', 'emp-qianjin', 'comp-cnc', 3, 60],
      ['assess-qianjin-aseptic', 'emp-qianjin', 'comp-safety', 2, 60],
      ['assess-qianjin-gowning', 'emp-qianjin', 'comp-safety-license', 1, 60],
      ['assess-zhaoyang-filling', 'emp-zhaoyang', 'comp-cnc', 3, 60],
      ['assess-zhaoyang-aseptic', 'emp-zhaoyang', 'comp-safety', 2, 60],
      ['assess-zhaoyang-gowning', 'emp-zhaoyang', 'comp-safety-license', 1, 60],
      ['assess-wumin-filling', 'emp-wumin', 'comp-cnc', 3, 60],
      ['assess-wumin-aseptic', 'emp-wumin', 'comp-safety', 2, 60],
      ['assess-wumin-gowning', 'emp-wumin', 'comp-safety-license', 1, 60],
    ];
    for (const [id, employeeId, competencyId, level, ago] of assessments) {
      if (await exists('employeeCompetencies', id)) continue;
      await query
        .insertInto('employeeCompetencies')
        .values({
          id,
          employeeId,
          competencyId,
          level,
          source: 'assessment',
          evidence: '主管日常评定。',
          assessedBy: headNjl || hr || 'system',
          assessedAt: daysAgo(ago),
          ...stamp,
        })
        .execute();
    }

    // ---- 王磊: 《CNC 岗位操作入门》 finished; two lagging courses ----
    const cncLessons = ['course-cnc-intro-l2', 'course-cnc-intro-l3'];
    for (const [i, lessonId] of cncLessons.entries()) {
      const id = `assign-wanglei-cnc-${lessonId}`;
      if (await exists('learningRecords', id)) continue;
      const finished = daysAgo(3 - i);
      await query
        .insertInto('learningRecords')
        .values({
          id,
          employeeId: 'emp-wanglei',
          courseId: 'course-cnc-intro',
          lessonId,
          startedAt: new Date(finished.getTime() - 8 * 60_000),
          completedAt: finished,
          durationSeconds: 480,
          watchedSeconds: null,
          maxPositionSeconds: null,
          watchedRanges: null,
          lastReportedAt: null,
          ...stamp,
        })
        .execute();
    }
    await query
      .updateTable('assignments')
      .set({
        status: 'completed',
        progress: 100,
        completedAt: daysAgo(2),
        updatedAt: now,
      })
      .where('id', '=', 'assign-wanglei-cnc')
      .where('status', '!=', 'completed')
      .execute();
    // One lesson of 《车间安全与 5S 基础》 done: of five with the video (20%).
    const safetyLessons = await query
      .selectFrom('lessons')
      .select('id')
      .where('courseId', '=', 'course-safety-basics')
      .execute();
    const lagging = [
      {
        id: 'assign-wanglei-safety',
        courseId: 'course-safety-basics',
        progress: Math.round(100 / Math.max(1, safetyLessons.length)),
        status: 'inProgress',
        reminderCount: 0,
        lastRemindedAt: null as Date | null,
        done: ['course-safety-basics-l1'],
      },
      {
        id: 'assign-wanglei-record',
        courseId: 'course-quality-record',
        progress: 0,
        status: 'notStarted',
        reminderCount: 2,
        lastRemindedAt: daysAgo(2),
        done: [] as string[],
      },
    ];
    for (const item of lagging) {
      if (await exists('assignments', item.id)) continue;
      await query
        .insertInto('assignments')
        .values({
          id: item.id,
          employeeId: 'emp-wanglei',
          courseId: item.courseId,
          examId: null,
          certificateId: null,
          learningPathId: null,
          parentAssignmentId: null,
          pathStepId: null,
          practiceScenarioId: null,
          learningPlanId: null,
          optional: false,
          reminderCount: item.reminderCount,
          assignedByUserId: headNjl || null,
          dueDate: shift(2),
          status: item.status,
          progress: item.progress,
          source: 'manual',
          completedAt: null,
          cancelledAt: null,
          lastRemindedAt: item.lastRemindedAt,
          escalatedAt: null,
          createdAt: daysAgo(8),
          updatedAt: now,
        })
        .execute();
      for (const lessonId of item.done)
        await query
          .insertInto('learningRecords')
          .values({
            id: `${item.id}-${lessonId}`,
            employeeId: 'emp-wanglei',
            courseId: item.courseId,
            lessonId,
            startedAt: daysAgo(6),
            completedAt: daysAgo(6),
            durationSeconds: 420,
            watchedSeconds: null,
            maxPositionSeconds: null,
            watchedRanges: null,
            lastReportedAt: null,
            ...stamp,
          })
          .execute();
    }

    // ---- 孙丽 (装配工, on probation): 《车间安全与 5S 基础》 done, 《装配岗位操作入门》 half way.
    // Both courses cover 装配工's requirements, so the learning coach drafts no plan for her. ----
    if (await exists('employees', 'emp-sunli')) {
      const sunliCourses = [
        {
          id: 'assign-sunli-safety',
          courseId: 'course-safety-basics',
          status: 'completed',
          progress: 100,
          completedAt: daysAgo(4) as Date | null,
          done: safetyLessons.map((lesson) => String(lesson.id)),
        },
        {
          id: 'assign-sunli-assembly',
          courseId: 'course-assembly-intro',
          status: 'inProgress',
          progress: 50,
          completedAt: null as Date | null,
          done: ['course-assembly-intro-l1'],
        },
      ];
      for (const item of sunliCourses) {
        if (await exists('assignments', item.id)) continue;
        await query
          .insertInto('assignments')
          .values({
            id: item.id,
            employeeId: 'emp-sunli',
            courseId: item.courseId,
            examId: null,
            certificateId: null,
            learningPathId: null,
            parentAssignmentId: null,
            pathStepId: null,
            practiceScenarioId: null,
            learningPlanId: null,
            optional: false,
            reminderCount: 0,
            assignedByUserId: hr || null,
            dueDate: shift(20),
            status: item.status,
            progress: item.progress,
            source: 'manual',
            completedAt: item.completedAt,
            cancelledAt: null,
            lastRemindedAt: null,
            escalatedAt: null,
            createdAt: daysAgo(6),
            updatedAt: now,
          })
          .execute();
        for (const lessonId of item.done) {
          const video = lessonId === DEMO_VIDEO_LESSON.id;
          await query
            .insertInto('learningRecords')
            .values({
              id: `${item.id}-${lessonId}`,
              employeeId: 'emp-sunli',
              courseId: item.courseId,
              lessonId,
              startedAt: daysAgo(5),
              completedAt: daysAgo(5),
              durationSeconds: video ? DEMO_VIDEO_LESSON.videoSeconds : 360,
              watchedSeconds: video ? DEMO_VIDEO_LESSON.videoSeconds : null,
              maxPositionSeconds: video ? DEMO_VIDEO_LESSON.videoSeconds : null,
              watchedRanges: null,
              lastReportedAt: null,
              ...stamp,
            })
            .execute();
        }
      }
    }

    // ---- The two new AI employees' automations, owned by hr01 like the others ----
    for (const key of [
      'learningCoach.gapPlans',
      'learningCoach.progressNudge',
      'practiceCoach.draftScenarioOnPublish',
      'practiceCoach.preExamRecommend',
    ]) {
      if (!hr || (await exists('aiAutomationSettings', key))) continue;
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: key,
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
  },
});

export default seed;
