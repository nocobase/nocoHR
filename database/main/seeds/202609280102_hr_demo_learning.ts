import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  DEMO_COURSES,
  DEMO_DOCUMENTS,
  DEMO_UPLOAD_MATERIALS,
} from '../../seed-data/demo-learning.js';

/**
 * Knowledge and learning demonstration data (V1-04 documents and gaps, V3-09
 * courses and assignments), added to the "启衡精密" data for development and
 * demo environments only. Rows are keyed
 * on fixed ids and skipped when present, so a replay never overwrites edits.
 *
 * Documents are written as Markdown files under storage/ and seeded already
 * extracted, with automatic course drafting off so the first run drafts
 * nothing. The files uploaded live during the demo (the content writer, version
 * and conflict demonstrations) go to storage/demo-materials/.
 */
const seed: SeedDefinition = defineSeed({
  name: '202609280102_hr_demo_learning',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    // The first demo seed creates the organisation this data refers to.
    if (
      !(await query
        .selectFrom('employees')
        .select('id')
        .where('id', '=', 'emp-wanglei')
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

    // ---- trainer01 郑老师, training specialist in 人力资源部 ----
    // Her instructor permissions come from the 内部讲师资格 certification (the exams seed), not a direct assignment.
    const trainer = await ensureDemoAccount(query, {
      username: 'trainer01',
      name: '郑老师',
      email: 'trainer01@demo.test',
    });
    if (!(await exists('employees', 'emp-trainer01'))) {
      await query
        .insertInto('employees')
        .values({
          id: 'emp-trainer01',
          employeeNo: 'QH1006',
          name: '郑老师',
          userId: trainer,
          departmentId: 'hr',
          positionId: 'pos-office-trainer',
          managerEmployeeId: null,
          status: 'active',
          hireDate: '2021-05-06',
          positionSince: '2021-05-06',
          email: 'trainer01@demo.test',
          mobile: '13900000008',
          note: null,
          gender: 'female',
          birthDate: '1988-08-18',
          idType: 'idCard',
          idNumber: '999999198808180088',
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '测试市测试路 8 号',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('departmentMembers')
        .values({
          id: randomUUID(),
          departmentId: 'hr',
          userId: trainer,
          primary: true,
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employeeEducations')
        .values({
          id: 'emp-trainer01-edu1',
          employeeId: 'emp-trainer01',
          school: '测试理工大学',
          degree: 'bachelor',
          major: '机械设计制造及其自动化',
          startDate: '2006-09-01',
          endDate: '2010-06-30',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employeeEmergencyContacts')
        .values({
          id: 'emp-trainer01-contact1',
          employeeId: 'emp-trainer01',
          name: '郑测试',
          relation: '配偶',
          phone: '13900001008',
          ...stamp,
        })
        .execute();
      await query
        .insertInto('employmentContracts')
        .values({
          id: 'contract-trainer01',
          employeeId: 'emp-trainer01',
          contractNo: 'HT-2024-011',
          type: 'openEnded',
          startDate: '2024-05-06',
          endDate: null,
          status: 'active',
          previousContractId: null,
          signedAt: '2024-05-06',
          fileId: null,
          note: null,
          ...stamp,
        })
        .execute();
    }

    // ---- Documents, stored as files and already extracted ----
    for (const document of DEMO_DOCUMENTS) {
      if (await exists('kbDocuments', document.id)) continue;
      const key = `hr-files/demo/${document.id}.md`;
      const bytes = Buffer.from(document.content, 'utf8');
      const file = path.resolve(process.cwd(), 'storage', key);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, bytes);
      if (!(await exists('hrFiles', document.fileId))) {
        await query
          .insertInto('hrFiles')
          .values({
            id: document.fileId,
            disk: 'local',
            key,
            filename: document.filename,
            ext: 'md',
            mimeType: 'text/markdown',
            size: bytes.length,
            ...stamp,
          })
          .execute();
      }
      await query
        .insertInto('kbDocuments')
        .values({
          id: document.id,
          title: document.title,
          docNo: document.docNo,
          version: document.version,
          effectiveDate: shift(document.effectiveInDays),
          category: document.category,
          fileId: document.fileId,
          contentText: document.content,
          parseStatus: 'ready',
          parseError: null,
          visibility: document.visibility,
          ownerUserId: await userIdOf(document.ownerAccount),
          reviewDate: shift(document.reviewInDays),
          // Seeded documents never draft a course; the live upload demonstrates it.
          autoDraftCourse: false,
          active: true,
          ...stamp,
        })
        .execute();
      for (const competencyId of document.competencyIds) {
        await query
          .insertInto('kbDocumentCompetencies')
          .values({
            id: `${document.id}-${competencyId}`,
            documentId: document.id,
            competencyId,
            ...stamp,
          })
          .execute();
      }
      for (const positionId of document.positionIds) {
        await query
          .insertInto('kbDocumentPositions')
          .values({
            id: `${document.id}-${positionId}`,
            documentId: document.id,
            positionId,
            ...stamp,
          })
          .execute();
      }
    }
    for (const material of DEMO_UPLOAD_MATERIALS) {
      const target = path.resolve(
        process.cwd(),
        'storage',
        'demo-materials',
        material.filename,
      );
      mkdirSync(path.dirname(target), { recursive: true });
      writeFileSync(target, material.content, 'utf8');
    }

    // ---- Courses ----
    for (const course of DEMO_COURSES) {
      if (await exists('courses', course.id)) continue;
      await query
        .insertInto('courses')
        .values({
          id: course.id,
          title: course.title,
          description: course.description,
          sourceDocumentId: course.sourceDocumentId,
          ownerUserId: await userIdOf(course.ownerAccount),
          source: course.source,
          reviewStatus: course.reviewStatus,
          published: course.published,
          publishedAt: course.published ? now : null,
          active: true,
          ...stamp,
        })
        .execute();
      for (const competencyId of course.competencyIds) {
        await query
          .insertInto('courseCompetencies')
          .values({
            id: `${course.id}-${competencyId}`,
            courseId: course.id,
            competencyId,
            ...stamp,
          })
          .execute();
      }
      let order = 0;
      for (const lesson of course.lessons) {
        await query
          .insertInto('lessons')
          .values({
            id: `${course.id}-l${order + 1}`,
            courseId: course.id,
            sortOrder: order,
            ...lesson,
            ...stamp,
          })
          .execute();
        order += 1;
      }
    }

    // ---- Assignments and learning records ----
    // 《CNC 岗位操作入门》: 王磊 was assigned three days ago and finished lesson 1; 李敏's is past due but not yet marked
    // (the first daily run marks it overdue); 赵阳 finished.
    const assigner = await userIdOf('trainer01');
    const lessons = DEMO_COURSES.find(
      (c) => c.id === 'course-cnc-intro',
    )!.lessons.map((_, i) => `course-cnc-intro-l${i + 1}`);
    const assignments = [
      {
        id: 'assign-wanglei-cnc',
        employeeId: 'emp-wanglei',
        dueDate: shift(7),
        status: 'inProgress',
        progress: 33,
        done: lessons.slice(0, 1),
        daysAgo: 1,
        assignedDaysAgo: 3,
      },
      {
        id: 'assign-limin-cnc',
        employeeId: 'emp-limin',
        dueDate: shift(-1),
        status: 'notStarted',
        progress: 0,
        done: [] as string[],
        daysAgo: 0,
        assignedDaysAgo: 12,
      },
      {
        id: 'assign-zhaoyang-cnc',
        employeeId: 'emp-zhaoyang',
        dueDate: shift(-20),
        status: 'completed',
        progress: 100,
        done: lessons,
        daysAgo: 25,
        assignedDaysAgo: 30,
      },
    ];
    for (const item of assignments) {
      if (await exists('assignments', item.id)) continue;
      const completedAt =
        item.status === 'completed'
          ? new Date(now.getTime() - item.daysAgo * 86_400_000)
          : null;
      await query
        .insertInto('assignments')
        .values({
          id: item.id,
          employeeId: item.employeeId,
          courseId: 'course-cnc-intro',
          examId: null,
          certificateId: null,
          assignedByUserId: assigner || null,
          dueDate: item.dueDate,
          status: item.status,
          progress: item.progress,
          source: 'manual',
          completedAt,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: new Date(
            now.getTime() - item.assignedDaysAgo * 86_400_000,
          ),
          updatedAt: now,
        })
        .execute();
      let minutesAgo = 60 * 24 * Math.max(item.daysAgo, 1) + 120;
      for (const lessonId of item.done) {
        const finished = new Date(now.getTime() - minutesAgo * 60_000);
        await query
          .insertInto('learningRecords')
          .values({
            id: `${item.id}-${lessonId}`,
            employeeId: item.employeeId,
            courseId: 'course-cnc-intro',
            lessonId,
            startedAt: new Date(finished.getTime() - 7 * 60_000),
            completedAt: finished,
            durationSeconds: 420,
            ...stamp,
          })
          .execute();
        minutesAgo -= 30;
      }
    }

    // ---- Knowledge gaps asked last week, not yet reported ----
    // The first two mean the same thing: the weekly report should group them into one topic.
    // SAF-0105 forbids jewellery only when operating rotating equipment, so the ring questions stay open.
    const gaps = [
      {
        id: 'gap-ring-1',
        question: '车间里能戴戒指吗？',
        asker: 'emp_njl_1',
        daysAgo: 6,
      },
      {
        id: 'gap-ring-2',
        question: '上班可以戴戒指吗？',
        asker: 'emp_njl_2',
        daysAgo: 5,
      },
      {
        id: 'gap-night-handover',
        question: '夜班交接记录由谁签字？',
        asker: 'emp_th_1',
        daysAgo: 4,
      },
    ];
    for (const gap of gaps) {
      if (await exists('knowledgeGaps', gap.id)) continue;
      const askedAt = new Date(now.getTime() - gap.daysAgo * 86_400_000);
      await query
        .insertInto('knowledgeGaps')
        .values({
          id: gap.id,
          question: gap.question,
          askedByUserId: (await userIdOf(gap.asker)) || trainer,
          askedAt,
          askCount: 1,
          lastAskedAt: askedAt,
          relatedDocumentId: gap.id.startsWith('gap-ring')
            ? 'doc-saf-0105'
            : null,
          topic: null,
          reportedAt: null,
          status: 'open',
          resolvedDocumentId: null,
          resolvedByUserId: null,
          resolvedAt: null,
          createdAt: askedAt,
          updatedAt: askedAt,
        })
        .execute();
    }
  },
});

export default seed;
