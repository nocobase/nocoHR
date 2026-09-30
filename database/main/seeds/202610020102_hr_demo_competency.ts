import { encodeAuthorizationTitle } from '@nocobase/authorization/core';
import { defineSeed, type SeedDefinition } from '@nocobase/db';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';

import { ensureDemoAccount } from '../../seed-data/demo-accounts.js';
import {
  ASSESSMENT_IMPORT_SAMPLE,
  SALES_ASSESSMENTS,
  SALES_COMPETENCIES,
  SALES_DEPARTMENT,
  SALES_ENGINEER_REQUIREMENTS,
  SALES_JOB_FAMILY,
  SALES_PEOPLE,
  SALES_POSITIONS,
  SOLUTION_MANAGER_JD,
  WORKSHOP_LEAD_JD,
} from '../../seed-data/demo-competency.js';

/** A minimal Word document: one paragraph per line, the fictional-data note in its properties only. */
function wordDocument(paragraphs: readonly string[], note: string): Buffer {
  const escape = (text: string) =>
    text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`,
    )
    .join('');
  const files: Record<string, string> = {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escape(paragraphs[0] ?? '')}</dc:title><dc:description>${escape(note)}</dc:description></cp:coreProperties>`,
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  };
  // Loaded as CommonJS by Node, the namespace may carry CFB only on its default export.
  const cfb = (XLSX.CFB ??
    (XLSX as unknown as { default: { CFB: typeof XLSX.CFB } }).default.CFB) as {
    utils: {
      cfb_new(): unknown;
      cfb_add(archive: unknown, name: string, content: Buffer): void;
    };
    write(
      archive: unknown,
      options: { fileType: 'zip'; type: 'buffer' },
    ): Buffer;
  };
  const archive = cfb.utils.cfb_new();
  for (const [name, content] of Object.entries(files))
    cfb.utils.cfb_add(archive, name, Buffer.from(content, 'utf8'));
  return cfb.write(archive, { fileType: 'zip', type: 'buffer' });
}

/**
 * V3-08 能力体系 demonstration data, added to the earlier demo data for
 * development and demo environments only (01-演示案例.md 主推场景): 销售部
 * headed by 程远 (mgr_sales), the 营销序列 with 销售工程师 (required 制动系统产品知识
 * 3 mandatory, 客户关系管理 2) and 销售总监, and the sales engineers 高原,
 * 林峰 and 许可 with 程远's assessments. 销售解决方案经理 is not created: hr01
 * creates it in the demo and uploads 《销售解决方案经理岗位说明书》, written
 * here to storage/demo-materials together with the 车间主任 JD sample and
 * 《能力评定导入数据.xlsx》.
 *
 * Rows are keyed on fixed ids and skipped when present, so a replay never
 * overwrites an administrator's edits. `HR_COMPETENCY_DEMO=false` skips it
 * (for suites that count the V1 organisation).
 */
const seed: SeedDefinition = defineSeed({
  name: '202610020102_hr_demo_competency',
  transaction: true,
  async run({ query }) {
    if (
      process.env.NODE_ENV === 'production' ||
      process.env.HR_DEMO_SEED === 'false' ||
      process.env.HR_COMPETENCY_DEMO === 'false'
    )
      return;
    const now = new Date();
    const stamp = { createdAt: now, updatedAt: now };
    const todayDate = now.toISOString().slice(0, 10);
    const daysAgo = (days: number) => {
      const d = new Date(`${todayDate}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - days);
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
    // The earlier demo seed did not run (production data, or a skipped demo): add nothing.
    if (!(await exists('departments', SALES_DEPARTMENT.parentId))) return;

    const userIds = new Map<string, string>();
    for (const person of SALES_PEOPLE)
      userIds.set(
        person.account,
        await ensureDemoAccount(query, {
          username: person.account,
          name: person.name,
          email: `${person.account.replace(/_/gu, '.')}@qiheng.test`,
        }),
      );

    if (!(await exists('departments', SALES_DEPARTMENT.id)))
      await query
        .insertInto('departments')
        .values({
          id: SALES_DEPARTMENT.id,
          code: SALES_DEPARTMENT.code,
          title: encodeAuthorizationTitle({
            key: SALES_DEPARTMENT.titleKey,
            ns: 'hr',
          }),
          parentId: SALES_DEPARTMENT.parentId,
          managerId: userIds.get(SALES_DEPARTMENT.managerAccount) ?? null,
          active: true,
          sortOrder: SALES_DEPARTMENT.sortOrder,
          ...stamp,
        })
        .execute();

    if (!(await exists('jobFamilies', SALES_JOB_FAMILY.id)))
      await query
        .insertInto('jobFamilies')
        .values({ ...SALES_JOB_FAMILY, active: true, ...stamp })
        .execute();
    for (const position of SALES_POSITIONS) {
      if (await exists('positions', position.id)) continue;
      await query
        .insertInto('positions')
        .values({ ...position, active: true, ...stamp })
        .execute();
    }
    for (const competency of SALES_COMPETENCIES) {
      if (await exists('competencies', competency.id)) continue;
      const { levels, ...rest } = competency;
      await query
        .insertInto('competencies')
        .values({
          ...rest,
          source: 'manual',
          reviewStatus: 'confirmed',
          active: true,
          ...stamp,
        })
        .execute();
      for (const [index, [title, behaviors]] of levels.entries())
        await query
          .insertInto('competencyLevels')
          .values({
            id: `${competency.id}-l${index + 1}`,
            competencyId: competency.id,
            level: index + 1,
            title,
            behaviors,
            ...stamp,
          })
          .execute();
    }
    for (const requirement of SALES_ENGINEER_REQUIREMENTS) {
      if (await exists('positionRequirements', requirement.id)) continue;
      await query
        .insertInto('positionRequirements')
        .values({
          ...requirement,
          positionId: 'pos-sales-engineer',
          source: 'manual',
          reviewStatus: 'confirmed',
          ...stamp,
        })
        .execute();
    }

    for (const person of SALES_PEOPLE) {
      if (await exists('employees', person.employeeId)) continue;
      const userId = userIds.get(person.account) ?? null;
      await query
        .insertInto('employees')
        .values({
          id: person.employeeId,
          employeeNo: person.employeeNo,
          name: person.name,
          userId,
          departmentId: SALES_DEPARTMENT.id,
          positionId: person.positionId,
          managerEmployeeId: person.managerEmployeeId,
          status: 'active',
          hireDate: person.hireDate,
          positionSince: person.hireDate,
          email: `${person.account.replace(/_/gu, '.')}@qiheng.test`,
          mobile: person.mobile,
          note: null,
          gender: person.gender,
          birthDate: person.birthDate,
          idType: 'idCard',
          idNumber: person.idNumber,
          employmentType: 'fullTime',
          workLocation: null,
          probationEndDate: null,
          regularizedAt: null,
          leaveDate: null,
          leaveReason: null,
          address: '苏州市工业园区星湖街 328 号 7 幢 1203 室',
          ...stamp,
        })
        .execute();
      if (userId)
        await query
          .insertInto('departmentMembers')
          .values({
            id: randomUUID(),
            departmentId: SALES_DEPARTMENT.id,
            userId,
            primary: true,
            active: true,
            ...stamp,
          })
          .execute();
      // Open-ended contracts, so the compliance checks have nothing to report about the demo's sales staff.
      const contractId = `contract-${person.employeeId.replace(/^emp-/u, '')}`;
      if (!(await exists('employmentContracts', contractId)))
        await query
          .insertInto('employmentContracts')
          .values({
            id: contractId,
            employeeId: person.employeeId,
            contractNo: `HT-${person.hireDate.slice(0, 4)}-${person.employeeNo.slice(2)}`,
            type: 'openEnded',
            startDate: person.hireDate,
            endDate: null,
            status: 'active',
            previousContractId: null,
            signedAt: person.hireDate,
            fileId: null,
            note: null,
            ...stamp,
          })
          .execute();
    }

    const assessor = userIds.get('mgr_sales') ?? 'system';
    for (const [
      id,
      employeeId,
      competencyId,
      level,
      evidence,
    ] of SALES_ASSESSMENTS) {
      if (await exists('employeeCompetencies', id)) continue;
      await query
        .insertInto('employeeCompetencies')
        .values({
          id,
          employeeId,
          competencyId,
          level,
          source: 'assessment',
          evidence,
          assessedBy: assessor,
          assessedAt: new Date(`${daysAgo(20)}T02:00:00Z`),
          ...stamp,
        })
        .execute();
    }

    // Demo materials: the JD to upload, the JD to paste, and the assessment import sample.
    // Files are a convenience for the demo: failing to write one never fails the seed.
    try {
      writeMaterials(daysAgo);
    } catch {
      // Ignored: the database rows above are what the demo needs.
    }
  },
});

function writeMaterials(daysAgo: (days: number) => string): void {
  const materials = path.resolve(process.cwd(), 'storage', 'demo-materials');
  mkdirSync(materials, { recursive: true });
  writeFileSync(
    path.join(materials, '销售解决方案经理岗位说明书.docx'),
    wordDocument(SOLUTION_MANAGER_JD, '启衡精密科技 · 岗位说明书'),
  );
  writeFileSync(
    path.join(materials, '车间主任职责说明.txt'),
    `${WORKSHOP_LEAD_JD}\n`,
  );
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['工号', '能力项编码', '等级', '依据', '评定日期'],
      ...ASSESSMENT_IMPORT_SAMPLE(daysAgo),
    ]),
    'assessments',
  );
  writeFileSync(
    path.join(materials, '能力评定导入数据.xlsx'),
    XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer,
  );
}

export default seed;
