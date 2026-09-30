import { defineSeed, type SeedDefinition } from '@nocobase/db';

/**
 * V3-10 demo additions to the 启衡精密 exam data (development and demo only;
 * `HR_EXAM_DEMO=false` or `HR_DEMO_SEED=false` skips it). Rows are keyed on
 * fixed ids and skipped when present, so a replay never overwrites edits:
 *
 * - The V4-14 industry pack (持证上岗) is on, as the specification's demo
 *   seed says, so the machine-start demonstration keeps granting through the
 *   CNC 岗位上岗证. A fresh installation without this seed has it off.
 * - CNC 岗位上岗证 assesses 岗位安全上岗资格 at level 1, so it is a required
 *   certification of the positions that require that qualification.
 * - The external certificate type 叉车证（特种设备作业人员证）, issued by
 *   市场监督管理部门, 48 months, with no courses or exams; 李敏 has registered
 *   one expiring in 45 days, waiting for verification.
 * - hr01 owns the three V3-10 automations.
 */
const seed: SeedDefinition = defineSeed({
  name: '202610040102_demo_exams_v3_10',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_EXAM_DEMO === 'false'
    )
      return;
    // The earlier exam demo seed creates the certifications this data refers to.
    if (
      !(await query
        .selectFrom('certifications')
        .select('id')
        .where('id', '=', 'cert-cnc')
        .executeTakeFirst())
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const today = now.toISOString().slice(0, 10);
    const shift = (days: number) => {
      const d = new Date(`${today}T00:00:00Z`);
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

    // ---- 持证上岗 industry pack on ----
    if (!(await exists('personnelSettings', 'licensedOperation')))
      await query
        .insertInto('personnelSettings')
        .values({
          id: 'licensedOperation',
          value: { enabled: true },
          revision: 1,
          updatedBy: 'system',
          ...stamp,
        })
        .execute();

    // ---- CNC 岗位上岗证 → 岗位安全上岗资格 1 级 ----
    if (await exists('competencies', 'comp-safety-license'))
      await query
        .updateTable('certifications')
        .set({
          competencyId: 'comp-safety-license',
          competencyLevel: 1,
          updatedAt: now,
        })
        .where('id', '=', 'cert-cnc')
        .where('competencyId', 'is', null)
        .execute();

    // ---- 叉车证 external type, and 李敏's registration waiting for HR ----
    if (!(await exists('certifications', 'cert-forklift')))
      await query
        .insertInto('certifications')
        .values({
          id: 'cert-forklift',
          code: 'FORKLIFT',
          title: '叉车证（特种设备作业人员证）',
          description:
            '外部证书：员工登记证书编号、发证日、到期日并上传扫描件，HR 核验后进入证书生命周期。',
          validityMonths: 48,
          competencyId: null,
          competencyLevel: null,
          certificateTemplate: null,
          expiringNoticeDays: 30,
          recertAdvanceDays: 0,
          escalateDays: 0,
          recertMode: 'examOnly',
          kind: 'external',
          issuingAuthority: '市场监督管理部门',
          qualifiesPositionId: null,
          active: true,
          ...stamp,
        })
        .execute();
    if (
      (await exists('employees', 'emp-limin')) &&
      !(await exists('employeeCertificates', 'certificate-limin-forklift'))
    )
      await query
        .insertInto('employeeCertificates')
        .values({
          id: 'certificate-limin-forklift',
          employeeId: 'emp-limin',
          certificationId: 'cert-forklift',
          certificateNo: 'EXT-FORKLIFT-LIMIN',
          issuedAt: shift(-(4 * 365 - 45)),
          expiresAt: shift(45),
          status: 'pending',
          source: 'external',
          revokedReason: null,
          evidence: { registeredBy: await userIdOf('emp_njl_2') },
          supersededById: null,
          externalNo: 'T320500202211040017',
          // The demo carries no scan file; one uploaded in the demo replaces it through "修改重提".
          attachmentFileId: null,
          verifyStatus: 'pending',
          verifiedBy: null,
          verifiedAt: null,
          verifyNote: null,
          ...stamp,
        })
        .execute();

    // ---- hr01 owns the V3-10 automations ----
    const owner = await userIdOf('hr01');
    for (const key of [
      'certificationSteward.qualificationPrep',
      'examiner.gradingSuggestion',
      'learningCoach.examFailedPlan',
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
