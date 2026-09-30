import { randomUUID } from 'node:crypto';

import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V4-14 行业方案 · 持证上岗, development and demo only (`NODE_ENV=production`,
 * `HR_DEMO_SEED=false` or `HR_LICENSED_DEMO=false` skips it). Every part
 * checks the rows it builds on and is keyed on fixed ids, so it never fails
 * when other demo seeds are off and never runs twice.
 *
 * Earlier steps' scenes are not pre-run or changed: no existing certificate,
 * assessment, schedule, payroll cycle, review result or business signal is
 * written. The industry pack stays as V3-10's seed left it (on); its other
 * options keep their defaults (both checks on, certification-only
 * prod.cncOperator and equip.forkliftOperator).
 *
 * - equip.forkliftOperator is assigned to the 叉车证 certification subject,
 *   so 李敏's pending 叉车证 (V3-10's seed) brings 叉车出库登记 once hr01
 *   verifies it.
 * - 实操考评员资格 (new): pass 《实操考评员考核》 (5 judge questions, 80 to
 *   pass), 24 months; trainer01 holds it, valid for 23 more months.
 *   hr.practicalAssessor stays assigned to trainer01 directly: hr01 moves it
 *   to the certification in the walkthrough.
 * - hr01 owns the certification steward's 调岗资质检查.
 *
 * What the step's walkthrough needs but earlier steps must not see yet —
 * 李敏's and 刘洋's CNC 岗位上岗证, and the 机加工 shifts requiring it — is
 * created by 设置 / 持证上岗 · 准备验收数据 (licensed/index.ts prepareDemo),
 * which hr01 runs when starting this step.
 */
const QUESTIONS = [
  '考评时应按考核表逐项观察并记录，不能凭印象打分。',
  '关键项不合格时，即使总分达到合格线，整次考核也判为不通过。',
  '考评员可以在学员操作前提示下一步的操作要点。',
  '见证人需在考评员签字后复核记录并签字。',
  '学员对考评结果有异议时，应在记录中写明并由 HR 复核。',
];
const ANSWERS = [true, true, false, true, true];

const seed: SeedDefinition = defineSeed({
  name: '202610120102_demo_licensed',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_LICENSED_DEMO === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = now.toISOString().slice(0, 10);
    const months = (n: number) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + n);
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

    // ---- 叉车证 → equip.forkliftOperator ----
    const assigned = await query
      .selectFrom('authorizationPermissionSetAssignments')
      .select('id')
      .where('permissionSetKey', '=', 'equip.forkliftOperator')
      .where('subjectType', '=', 'hr.certification')
      .where('subjectId', '=', 'cert-forklift')
      .executeTakeFirst();
    if (
      !assigned &&
      (await exists('certifications', 'cert-forklift')) &&
      (await query
        .selectFrom('authorizationPermissionSets')
        .select('id')
        .where('key', '=', 'equip.forkliftOperator')
        .executeTakeFirst())
    )
      await query
        .insertInto('authorizationPermissionSetAssignments')
        .values({
          id: randomUUID(),
          permissionSetKey: 'equip.forkliftOperator',
          subjectType: 'hr.certification',
          subjectId: 'cert-forklift',
          ...stamp,
        })
        .execute();

    // ---- 实操考评员资格, 《实操考评员考核》 and trainer01's certificate ----
    const hr01 = await userIdOf('hr01');
    if (hr01 && !(await exists('exams', 'exam-practical-assessor'))) {
      for (const [index, stem] of QUESTIONS.entries()) {
        const id = `q-assessor-0${index + 1}`;
        if (await exists('questions', id)) continue;
        await query
          .insertInto('questions')
          .values({
            id,
            type: 'judge',
            stem,
            options: JSON.stringify([]),
            answer: JSON.stringify(ANSWERS[index]),
            explanation: null,
            gradingNotes: null,
            difficulty: 'easy',
            sourceDocumentId: null,
            sourceCourseId: null,
            sourceExcerpt: null,
            score: 20,
            ownerUserId: hr01,
            source: 'manual',
            reviewStatus: 'confirmed',
            active: true,
            ...stamp,
          })
          .execute();
      }
      await query
        .insertInto('exams')
        .values({
          id: 'exam-practical-assessor',
          title: '实操考评员考核',
          description: '实操考评员资格的考核：5 道判断题，80 分通过。',
          paperMode: 'fixed',
          randomRules: JSON.stringify([]),
          durationMinutes: 15,
          maxAttempts: 3,
          passScore: 80,
          showAnswersAfter: 'afterSubmit',
          ownerUserId: hr01,
          published: true,
          active: true,
          ...stamp,
        })
        .execute();
      for (let index = 0; index < QUESTIONS.length; index += 1)
        await query
          .insertInto('examQuestions')
          .values({
            id: `exam-practical-assessor-q-assessor-0${index + 1}`,
            examId: 'exam-practical-assessor',
            questionId: `q-assessor-0${index + 1}`,
            sortOrder: index,
            score: 20,
            ...stamp,
          })
          .execute();
    }
    if (
      (await exists('exams', 'exam-practical-assessor')) &&
      !(await exists('certifications', 'cert-practical-assessor'))
    ) {
      await query
        .insertInto('certifications')
        .values({
          id: 'cert-practical-assessor',
          code: 'PRA',
          title: '实操考评员资格',
          description:
            '通过《实操考评员考核》后获得，有效期 24 个月；持证人可以主持实操考核。',
          validityMonths: 24,
          competencyId: null,
          competencyLevel: null,
          certificateTemplate: null,
          expiringNoticeDays: 30,
          recertAdvanceDays: 60,
          escalateDays: 7,
          recertMode: 'examOnly',
          kind: 'internal',
          issuingAuthority: null,
          qualifiesPositionId: null,
          active: true,
          ...stamp,
        })
        .execute();
      await query
        .insertInto('certificationExams')
        .values({
          id: 'cert-practical-assessor-exam-practical-assessor',
          certificationId: 'cert-practical-assessor',
          examId: 'exam-practical-assessor',
          ...stamp,
        })
        .execute();
    }
    if (
      (await exists('certifications', 'cert-practical-assessor')) &&
      (await exists('employees', 'emp-trainer01')) &&
      !(await exists('employeeCertificates', 'certificate-trainer01-pra'))
    )
      await query
        .insertInto('employeeCertificates')
        .values({
          id: 'certificate-trainer01-pra',
          employeeId: 'emp-trainer01',
          certificationId: 'cert-practical-assessor',
          certificateNo: `PRA-${months(-1).slice(0, 4)}-00001`,
          issuedAt: months(-1),
          expiresAt: months(23),
          status: 'valid',
          source: 'internal',
          revokedReason: null,
          evidence: JSON.stringify({ exams: ['exam-practical-assessor'] }),
          supersededById: null,
          ...stamp,
        })
        .execute();

    // ---- hr01 owns 调岗资质检查 ----
    if (
      hr01 &&
      !(await exists('aiAutomationSettings', 'certificationSteward.transferCheck'))
    )
      await query
        .insertInto('aiAutomationSettings')
        .values({
          id: 'certificationSteward.transferCheck',
          enabled: true,
          ownerUserId: hr01,
          hour: null,
          weekday: null,
          monthDay: null,
          params: null,
          updatedByUserId: null,
          ...stamp,
        })
        .execute();
  },
});

export default seed;
