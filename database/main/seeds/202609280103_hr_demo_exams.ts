import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';

import {
  DEMO_CERTIFICATIONS,
  DEMO_EXAMS,
  DEMO_QUESTIONS,
  type DemoQuestion,
} from '../../seed-data/demo-exams.js';

/**
 * Exams, certification and the permission loop (V1 steps 3 and 4), added to
 * the "启衡精密" data for development and demo environments only. Rows are
 * keyed on fixed ids and skipped when present, so a replay never overwrites
 * edits. States are those before the first daily run (V3-10 / V4-14 test
 * data in the specification):
 *
 * - 王磊: valid CNC 岗位上岗证 issued 5 months ago (the portrait's certificate
 *   wall), and assigned 《安全实务问答》 for the manual grading demo.
 * - 赵阳: valid certificate issued 11 months ago, so the first daily run
 *   assigns renewal and marks it expiring.
 * - 吴敏: certificate expired yesterday but still `valid`, so the first daily
 *   run expires it and she loses the machine-start permission.
 * - 钱进: certificate expiring in 5 days, renewal assigned and not started
 *   (his recertification is stalling), so the certification steward
 *   escalates to 陈静.
 * - Work order MO-24031, operation 20 精车: machine starts recorded by 钱进,
 *   赵阳 and 吴敏 40 days ago, while their certificates were valid.
 * - 郑老师 holds 内部讲师资格, to which hr.instructor is assigned.
 *
 * It also sets hr01 as the owner of every AI automation (the specification's
 * default owner).
 */
const seed: SeedDefinition = defineSeed({
  name: '202609280103_hr_demo_exams',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false'
    )
      return;
    // The earlier demo seeds create the people and the course this data refers to.
    if (
      !(await query
        .selectFrom('courses')
        .select('id')
        .where('id', '=', 'course-cnc-intro')
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
    const addMonths = (date: string, months: number) => {
      const d = new Date(`${date}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + months);
      return d.toISOString().slice(0, 10);
    };
    const at = (date: string, hour = 10) =>
      new Date(`${date}T${String(hour).padStart(2, '0')}:00:00Z`);
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

    // ---- Questions ----
    for (const question of DEMO_QUESTIONS) {
      if (await exists('questions', question.id)) continue;
      await query
        .insertInto('questions')
        .values({
          id: question.id,
          type: question.type,
          stem: question.stem,
          options: JSON.stringify(question.options),
          answer: JSON.stringify(question.answer),
          explanation: question.explanation,
          gradingNotes: question.gradingNotes,
          difficulty: question.difficulty,
          sourceDocumentId: question.sourceDocumentId,
          sourceCourseId: question.sourceCourseId,
          sourceExcerpt: question.sourceExcerpt,
          score: 10,
          ownerUserId: await userIdOf(question.ownerAccount),
          source: question.source,
          reviewStatus: question.reviewStatus,
          active: true,
          ...stamp,
        })
        .execute();
      for (const competencyId of question.competencyIds) {
        await query
          .insertInto('questionCompetencies')
          .values({
            id: `${question.id}-${competencyId}`,
            questionId: question.id,
            competencyId,
            ...stamp,
          })
          .execute();
      }
    }

    // ---- Exams ----
    for (const exam of DEMO_EXAMS) {
      if (await exists('exams', exam.id)) continue;
      await query
        .insertInto('exams')
        .values({
          id: exam.id,
          title: exam.title,
          description: exam.description,
          paperMode: exam.paperMode,
          randomRules: JSON.stringify(exam.randomRules),
          durationMinutes: exam.durationMinutes,
          maxAttempts: exam.maxAttempts,
          passScore: exam.passScore,
          showAnswersAfter: exam.showAnswersAfter,
          ownerUserId: await userIdOf(exam.ownerAccount),
          published: true,
          active: true,
          ...stamp,
        })
        .execute();
      let order = 0;
      for (const item of exam.questions) {
        await query
          .insertInto('examQuestions')
          .values({
            id: `${exam.id}-${item.questionId}`,
            examId: exam.id,
            questionId: item.questionId,
            sortOrder: order,
            score: item.score,
            ...stamp,
          })
          .execute();
        order += 1;
      }
    }

    // ---- Certifications ----
    for (const certification of DEMO_CERTIFICATIONS) {
      if (await exists('certifications', certification.id)) continue;
      const { courseIds, examIds, ...values } = certification;
      await query
        .insertInto('certifications')
        .values({
          ...values,
          certificateTemplate: null,
          active: true,
          ...stamp,
        })
        .execute();
      for (const courseId of courseIds) {
        await query
          .insertInto('certificationCourses')
          .values({
            id: `${certification.id}-${courseId}`,
            certificationId: certification.id,
            courseId,
            ...stamp,
          })
          .execute();
      }
      for (const examId of examIds) {
        await query
          .insertInto('certificationExams')
          .values({
            id: `${certification.id}-${examId}`,
            certificationId: certification.id,
            examId,
            ...stamp,
          })
          .execute();
      }
    }

    // ---- 王磊 is assigned 《安全实务问答》 (its short answer is graded by hand) ----
    if (!(await exists('assignments', 'assign-wanglei-safety-exam'))) {
      await query
        .insertInto('assignments')
        .values({
          id: 'assign-wanglei-safety-exam',
          employeeId: 'emp-wanglei',
          courseId: null,
          examId: 'exam-safety-practice',
          certificateId: null,
          assignedByUserId: (await userIdOf('trainer01')) || null,
          dueDate: shift(14),
          status: 'notStarted',
          progress: 0,
          source: 'manual',
          completedAt: null,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: new Date(now.getTime() - 3 * 86_400_000),
          updatedAt: now,
        })
        .execute();
    }

    // ---- Passed attempts behind the seeded certificates ----
    const questionById = new Map<string, DemoQuestion>(
      DEMO_QUESTIONS.map((q) => [q.id, q]),
    );
    const certPaper: [string, number][] = [
      ['q-cnc-01', 10],
      ['q-cnc-02', 10],
      ['q-cnc-04', 10],
      ['q-record-01', 10],
      ['q-record-02', 10],
      ['q-cnc-06', 10],
      ['q-record-04', 10],
      ['q-cnc-08', 10],
      ['q-cnc-09', 10],
      ['q-record-05', 10],
    ];
    const trainerPaper: [string, number][] = [
      ['q-trainer-01', 20],
      ['q-trainer-02', 20],
      ['q-trainer-03', 20],
      ['q-trainer-04', 20],
      ['q-trainer-05', 20],
    ];
    // Certificates: issue date, expiry, status, and the attempt that earned each.
    const zhaoyangIssued = addMonths(todayDate, -11);
    const wangleiIssued = addMonths(todayDate, -5);
    const certificates = [
      {
        id: 'certificate-wumin-cnc',
        employeeId: 'emp-wumin',
        certificationId: 'cert-cnc',
        code: 'CNC-OP',
        no: 1,
        issuedAt: addMonths(shift(-1), -12),
        expiresAt: shift(-1),
        status: 'valid',
        examId: 'exam-cnc-cert',
        paper: certPaper,
        wrong: 1,
      },
      {
        id: 'certificate-qianjin-cnc',
        employeeId: 'emp-qianjin',
        certificationId: 'cert-cnc',
        code: 'CNC-OP',
        no: 2,
        issuedAt: addMonths(shift(5), -12),
        expiresAt: shift(5),
        status: 'expiring',
        examId: 'exam-cnc-cert',
        paper: certPaper,
        wrong: 2,
      },
      {
        id: 'certificate-zhaoyang-cnc',
        employeeId: 'emp-zhaoyang',
        certificationId: 'cert-cnc',
        code: 'CNC-OP',
        no: 3,
        issuedAt: zhaoyangIssued,
        expiresAt: addMonths(zhaoyangIssued, 12),
        status: 'valid',
        examId: 'exam-cnc-cert',
        paper: certPaper,
        wrong: 0,
      },
      {
        id: 'certificate-wanglei-cnc',
        employeeId: 'emp-wanglei',
        certificationId: 'cert-cnc',
        code: 'CNC-OP',
        no: 4,
        issuedAt: wangleiIssued,
        expiresAt: addMonths(wangleiIssued, 12),
        status: 'valid',
        examId: 'exam-cnc-cert',
        paper: certPaper,
        wrong: 1,
      },
      {
        id: 'certificate-trainer01-trn',
        employeeId: 'emp-trainer01',
        certificationId: 'cert-trainer',
        code: 'TRN',
        no: 1,
        issuedAt: shift(-400),
        expiresAt: null,
        status: 'valid',
        examId: 'exam-trainer-basic',
        paper: trainerPaper,
        wrong: 0,
      },
    ];
    for (const certificate of certificates) {
      if (await exists('employeeCertificates', certificate.id)) continue;
      const attemptId = `${certificate.id}-attempt`;
      const items = certificate.paper.map(([questionId, score]) => {
        const q = questionById.get(questionId)!;
        return {
          questionId,
          type: q.type,
          stem: q.stem,
          options: q.options,
          blankCount: 0,
          score,
          competencyIds: q.competencyIds,
        };
      });
      const answers: Record<string, unknown> = {};
      const results: Record<
        string,
        { score: number; correct: boolean; comment: null }
      > = {};
      let earned = 0;
      items.forEach((item, index) => {
        const q = questionById.get(item.questionId)!;
        const correct = index >= certificate.wrong;
        answers[item.questionId] = correct
          ? q.answer
          : q.type === 'judge'
            ? !q.answer
            : q.type === 'multiple'
              ? ['A']
              : 'D';
        results[item.questionId] = {
          score: correct ? item.score : 0,
          correct,
          comment: null,
        };
        if (correct) earned += item.score;
      });
      const startedAt = at(certificate.issuedAt, 9);
      await query
        .insertInto('examAttempts')
        .values({
          id: attemptId,
          examId: certificate.examId,
          employeeId: certificate.employeeId,
          assignmentId: null,
          attemptNo: 1,
          paperSnapshot: JSON.stringify(items),
          answers: JSON.stringify(answers),
          startedAt,
          deadlineAt: new Date(startedAt.getTime() + 20 * 60_000),
          submittedAt: new Date(startedAt.getTime() + 15 * 60_000),
          objectiveScore: earned,
          subjectiveScore: null,
          score: earned,
          status: 'passed',
          gradedBy: null,
          itemResults: JSON.stringify(results),
          createdAt: startedAt,
          updatedAt: startedAt,
        })
        .execute();
      await query
        .insertInto('employeeCertificates')
        .values({
          id: certificate.id,
          employeeId: certificate.employeeId,
          certificationId: certificate.certificationId,
          certificateNo: `${certificate.code}-${certificate.issuedAt.slice(0, 4)}-${String(certificate.no).padStart(5, '0')}`,
          issuedAt: certificate.issuedAt,
          expiresAt: certificate.expiresAt,
          status: certificate.status,
          source: 'internal',
          revokedReason: null,
          evidence: JSON.stringify({
            assignmentIds: [],
            attemptIds: [attemptId],
          }),
          supersededById: null,
          createdAt: at(certificate.issuedAt, 11),
          updatedAt: now,
        })
        .execute();
    }

    // ---- 钱进's renewal, assigned and not started ----
    if (!(await exists('assignments', 'assign-qianjin-recert'))) {
      const created = new Date(now.getTime() - 55 * 86_400_000);
      await query
        .insertInto('assignments')
        .values({
          id: 'assign-qianjin-recert',
          employeeId: 'emp-qianjin',
          courseId: null,
          examId: 'exam-cnc-cert',
          certificateId: 'certificate-qianjin-cnc',
          assignedByUserId: null,
          dueDate: shift(5),
          status: 'notStarted',
          progress: 0,
          source: 'recertification',
          completedAt: null,
          cancelledAt: null,
          lastRemindedAt: null,
          escalatedAt: null,
          createdAt: created,
          updatedAt: created,
        })
        .execute();
    }

    // ---- Work order MO-24031: operation 20 精车 started by 钱进 (苏州), 赵阳 and 吴敏 (成都) 40 days ago, certificates valid ----
    const signoffs = [
      {
        id: 'startlog-mo24031-qianjin',
        employeeId: 'emp-qianjin',
        account: 'emp_njl_3',
        certificateId: 'certificate-qianjin-cnc',
        hour: 6,
      },
      {
        id: 'startlog-mo24031-zhaoyang',
        employeeId: 'emp-zhaoyang',
        account: 'emp_th_1',
        certificateId: 'certificate-zhaoyang-cnc',
        hour: 7,
      },
      {
        id: 'startlog-mo24031-wumin',
        employeeId: 'emp-wumin',
        account: 'emp_th_2',
        certificateId: 'certificate-wumin-cnc',
        hour: 14,
      },
    ];
    for (const signoff of signoffs) {
      if (await exists('demoBatchSignoffs', signoff.id)) continue;
      const certificate = await query
        .selectFrom('employeeCertificates')
        .select(['certificateNo'])
        .where('id', '=', signoff.certificateId)
        .executeTakeFirst();
      const signedAt = at(shift(-40), signoff.hour);
      await query
        .insertInto('demoBatchSignoffs')
        .values({
          id: signoff.id,
          // DEMO_BATCH in server/providers/hr/demo-batch.ts.
          batchNo: 'MO-24031',
          step: 'op20',
          employeeId: signoff.employeeId,
          userId: (await userIdOf(signoff.account)) || null,
          signedAt,
          certificateId: signoff.certificateId,
          certificateNo: certificate ? String(certificate.certificateNo) : null,
          certificateStatus: 'valid',
          createdAt: signedAt,
          updatedAt: signedAt,
        })
        .execute();
    }

    // ---- Certified to act: the permission sets assigned to certification subjects ----
    const assign = async (
      permissionSetKey: string,
      certificationId: string,
    ) => {
      const set = await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', permissionSetKey)
        .executeTakeFirst();
      if (!set) return;
      const existing = await query
        .selectFrom('authorizationPermissionSetAssignments')
        .select('id')
        .where('permissionSetKey', '=', permissionSetKey)
        .where('subjectType', '=', 'hr.certification')
        .where('subjectId', '=', certificationId)
        .executeTakeFirst();
      if (existing) return;
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          permissionSetKey,
          subjectType: 'hr.certification',
          subjectId: certificationId,
          ...stamp,
        })
        .execute();
    };
    await assign('prod.cncOperator', 'cert-cnc');
    await assign('hr.instructor', 'cert-trainer');

    // ---- hr01 owns every AI automation ----
    const owner = await userIdOf('hr01');
    for (const key of [
      'frameworkAdvisor.draftNewPositions',
      'frameworkAdvisor.dictionaryReview',
      'contentWriter.draftCourseFromDocument',
      'contentWriter.fillCourseQuestions',
      'knowledgeAssistant.gapWeeklyReport',
      'certificationSteward.weeklyBrief',
      'certificationSteward.recertEscalation',
      'certificationSteward.remedialLearning',
    ]) {
      if (!owner || (await exists('aiAutomationSettings', key))) continue;
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: key,
          enabled: true,
          ownerUserId: owner,
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
