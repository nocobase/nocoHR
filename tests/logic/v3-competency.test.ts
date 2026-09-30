// @vitest-environment node

// V3-08 能力体系 acceptance: gaps (差距口径, 取最新一条, 未评定), assessment rules, the Excel import, 发展目标岗位 with
// 对标差距 and 评定待办, 岗位说明书 extraction, the transfer reference block and change-checklist items, the
// framework advisor's monthly check facts, and the permission matrix. Boots the real standalone server on a
// throwaway SQLite database with every migration and seed.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { databaseManagerToken } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';

import { ASSESSMENT_IMPORT_SAMPLE } from '../../database/seed-data/demo-competency.ts';
import { SOLUTION_MANAGER_JD } from '../../database/seed-data/demo-competency.ts';
import { scopeForUser } from '../../server/providers/hr/authorize.ts';
import { computePositionIssues } from '../../server/providers/hr/competency-issues.ts';
import {
  computeGapRows,
  parseImportDate,
  summarize,
} from '../../server/providers/hr/competency-service.ts';
import {
  checklistServiceToken,
  competencyServiceToken,
  talentServiceToken,
} from '../../server/providers/hr/tokens.ts';
import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// Seeds import `database/seed-data/*.js` through Node itself; map a missing relative `.js` to its `.ts` source.
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      const parent = (context.parentURL ?? '').replace(/[?#].*$/u, '');
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        parent.endsWith('.ts') &&
        !parent.includes('/node_modules/')
      )
        return next(`${specifier.slice(0, -3)}.ts`, context);
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'competency-acceptance-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v3-competency-'));
  const config = path.join(directory, 'config.json');
  writeFileSync(
    config,
    JSON.stringify({
      auth: { secret: 'test-auth-secret-at-least-32-characters' },
      database: {
        default: 'main',
        connections: {
          main: {
            dialect: 'sqlite',
            filename: path.join(directory, 'database.sqlite'),
          },
        },
        migrations: { autoRun: true },
        seeds: { autoRun: true },
      },
      hub: { host: { enabled: false } },
    }),
  );
  process.env.HR_DEMO_PASSWORD = PASSWORD;
  // V3-11's demo seeds 销售解决方案经理 and 内审专员's holder, which this suite creates and expects vacant.
  process.env.HR_PROFILE_DEMO = 'false';
  const root = path.resolve(import.meta.dirname, '../..');
  server = await createStandaloneServer({
    viteDevUrl: false,
    env: {
      DB_DIALECT: 'sqlite',
      DB_MIGRATIONS_AUTO_RUN: 'true',
      DB_SEEDS_AUTO_RUN: 'true',
      APP_PUBLIC_ORIGIN: 'http://localhost',
      APP_CONFIG_FILE: config,
    },
    paths: {
      rootDir: root,
      serverDir: path.join(root, 'server'),
      databaseDir: path.join(root, 'database'),
      clientDir: path.join(root, 'dist/client'),
      storageDir: path.join(directory, 'storage'),
    },
  });
  base = `http://localhost${server.application.publicBasePath}`;
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_PROFILE_DEMO;
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function signIn(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await server.fetch(
    new Request(`${base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status, `sign in ${username}`).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  cookies.set(username, cookie);
  return cookie;
}

async function raw(
  username: string | null,
  method: string,
  url: string,
  body?: BodyInit,
  json = false,
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {};
  if (username) headers.cookie = await signIn(username);
  if (json) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      { method, headers, body },
    ),
  );
  const text = await response.text();
  let parsed: Json;
  try {
    parsed = text ? (JSON.parse(text) as Json) : {};
  } catch {
    parsed = { text };
  }
  return { status: response.status, json: parsed };
}

const call = (
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
) =>
  raw(
    username,
    method,
    url,
    body === undefined ? undefined : JSON.stringify(body),
    body !== undefined,
  );

async function userId(username: string): Promise<string> {
  const session = await call(username, 'GET', '/api/auth/get-session');
  return String(session.json.user.id);
}

async function actorOf(username: string) {
  const id = await userId(username);
  return {
    authz: await scopeForUser(
      server.application.container.resolve(authorizationToken),
      id,
    ),
    userId: id,
  };
}

const db = () => server.application.container.resolve(databaseManagerToken);

function workbook(rows: (string | number)[][]): Blob {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      ['工号', '能力项编码', '等级', '依据', '评定日期'],
      ...rows,
    ]),
    'assessments',
  );
  return new Blob([
    XLSX.write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer,
  ]);
}

function form(blob: Blob, name: string): FormData {
  const data = new FormData();
  data.append('file', new File([blob], name));
  return data;
}

const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

describe('gap rules', () => {
  const competencies = new Map([
    ['a', { id: 'a', code: 'a', title: 'A', category: 'skill', maxLevel: 5 }],
    ['b', { id: 'b', code: 'b', title: 'B', category: 'skill', maxLevel: 5 }],
    ['c', { id: 'c', code: 'c', title: 'C', category: 'quality', maxLevel: 5 }],
  ]);
  it('counts an unassessed competency as 0 but marks it, and puts mandatory items first', () => {
    const rows = computeGapRows(
      [
        {
          positionId: 'p',
          competencyId: 'a',
          requiredLevel: 2,
          mandatory: false,
        },
        {
          positionId: 'p',
          competencyId: 'b',
          requiredLevel: 3,
          mandatory: true,
        },
        {
          positionId: 'p',
          competencyId: 'c',
          requiredLevel: 1,
          mandatory: true,
        },
      ],
      new Map([
        ['a', 0],
        ['c', 1],
      ]),
      competencies,
      new Map(),
      false,
    );
    expect(rows.map((r) => r.competencyId)).toEqual(['b', 'c', 'a']);
    expect(rows[0]).toMatchObject({ assessed: false, currentLevel: 0, gap: 3 });
    // Assessed at 0 is not the same as unassessed.
    expect(rows[2]).toMatchObject({ assessed: true, currentLevel: 0, gap: 2 });
    expect(summarize(rows)).toEqual({
      mandatoryGaps: 1,
      totalGap: 5,
      unassessedMandatory: 1,
    });
  });
  it('reads Excel serials, dates and text as calendar dates', () => {
    expect(parseImportDate('2026/9/1')).toEqual({
      date: '2026-09-01',
      invalid: false,
    });
    expect(parseImportDate(46266).date).toBe('2026-09-01');
    expect(parseImportDate('2026-02-30').invalid).toBe(true);
    expect(parseImportDate('')).toEqual({ date: null, invalid: false });
  });
});

describe('V3-08 dictionary and requirements', () => {
  it('refuses lowering a maximum level under existing requirements and assessments, listing them', async () => {
    const lowered = await call('hr01', 'PATCH', '/competencies/comp-cnc', {
      code: 'cnc-operation',
      title: 'CNC 设备操作',
      category: 'skill',
      maxLevel: 2,
    });
    expect(lowered.status).toBe(409);
    expect(lowered.json.code).toBe('COMPETENCY_MAX_LEVEL_CONFLICT');
    expect(
      lowered.json.details.requirements.map((r: Json) => r.positionId),
    ).toContain('pos-cnc-operator');
    expect(
      lowered.json.details.assessments.map((a: Json) => a.employeeId),
    ).toEqual(expect.arrayContaining(['emp-wanglei', 'emp-limin']));
  });

  it('rejects duplicate requirements and levels above the maximum', async () => {
    const duplicate = await call(
      'hr01',
      'POST',
      '/framework/positions/pos-cnc-operator/requirements',
      { competencyId: 'comp-safety', requiredLevel: 2, mandatory: true },
    );
    expect(duplicate.json.code).toBe('REQUIREMENT_EXISTS');
    const tooHigh = await call(
      'hr01',
      'POST',
      '/framework/positions/pos-workshop-lead/requirements',
      { competencyId: 'comp-safety-license', requiredLevel: 2 },
    );
    expect(tooHigh.status).toBe(400);
    expect(tooHigh.json.code).toBe('REQUIREMENT_LEVEL_EXCEEDS_MAX');
  });

  it('keeps assessments of a deactivated competency and refuses new requirements and assessments for it', async () => {
    const assessed = await call(
      'mgr_njl',
      'POST',
      '/competency/employees/emp-wanglei/assessments',
      { competencyId: 'comp-maintenance', level: 2, evidence: '日常保养检查' },
    );
    expect(assessed.status).toBe(201);
    const off = await call(
      'hr01',
      'POST',
      '/competencies/comp-maintenance/active',
      {
        active: false,
      },
    );
    expect(off.status).toBe(200);
    expect(
      (
        await call(
          'hr01',
          'POST',
          '/framework/positions/pos-assembler/requirements',
          { competencyId: 'comp-maintenance', requiredLevel: 1 },
        )
      ).json.code,
    ).toBe('COMPETENCY_NOT_FOUND');
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/competency/employees/emp-limin/assessments',
          {
            competencyId: 'comp-maintenance',
            level: 1,
          },
        )
      ).json.code,
    ).toBe('COMPETENCY_NOT_FOUND');
    const history = await call(
      'hr01',
      'GET',
      '/employees/emp-wanglei/assessments',
    );
    expect(
      (history.json.data as Json[]).some(
        (a) => a.competencyId === 'comp-maintenance',
      ),
    ).toBe(true);
    await call('hr01', 'POST', '/competencies/comp-maintenance/active', {
      active: true,
    });
  });

  it('refuses discarding a draft a confirmed requirement references', async () => {
    const ctx = await actorOf('hr01');
    const talent = server.application.container.resolve(talentServiceToken);
    const draft = await talent.saveCompetency(
      ctx,
      null,
      {
        code: 'v308-draft-in-use',
        title: '测试用草稿能力',
        category: 'skill',
        maxLevel: 3,
        levels: [
          { level: 1, title: '入门', behaviors: '能按清单完成一次操作。' },
        ],
      },
      { source: 'ai', draft: true },
    );
    await talent.saveRequirement(ctx, 'pos-plant-director', {
      competencyId: draft.id,
      requiredLevel: 1,
    });
    const refused = await call('hr01', 'POST', '/competencies/discard', {
      ids: [draft.id],
    });
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('COMPETENCY_IN_USE');
  });
});

describe('V3-08 gaps and assessments', () => {
  it('shows 王磊 his CNC operator requirements, unassessed items marked, mandatory first', async () => {
    const view = await call(
      'emp_njl_1',
      'GET',
      '/competency/employees/emp-wanglei',
    );
    expect(view.status).toBe(200);
    const rows = (view.json.data.rows as Json[]).filter(
      (r) => r.requiredLevel !== null,
    );
    expect(rows).toHaveLength(4);
    expect(rows.slice(0, 3).every((r) => r.mandatory)).toBe(true);
    const safety = rows.find((r) => r.competencyId === 'comp-safety')!;
    expect(safety).toMatchObject({ assessed: false, currentLevel: 0, gap: 2 });
    // The training seed records his safety qualification (1 of 1), so only 安全生产与 5S is outstanding.
    expect(view.json.data.summary.mandatoryGaps).toBe(1);
    expect(
      (await call('emp_njl_1', 'GET', '/competency/employees/emp-limin'))
        .status,
    ).toBe(404);
  });

  it("takes the latest of 李敏's two CNC assessments and keeps both in the history", async () => {
    const view = await call(
      'emp_njl_2',
      'GET',
      '/competency/employees/emp-limin',
    );
    const cnc = (view.json.data.rows as Json[]).find(
      (r) => r.competencyId === 'comp-cnc',
    );
    expect(cnc).toMatchObject({ currentLevel: 3, assessed: true, gap: 0 });
    const history = await call(
      'emp_njl_2',
      'GET',
      '/employees/emp-limin/assessments',
    );
    expect(
      (history.json.data as Json[]).filter(
        (a) => a.competencyId === 'comp-cnc',
      ),
    ).toHaveLength(2);
  });

  it('records the signed-in assessor whatever the request says, within scope and never oneself', async () => {
    const forged = await call(
      'mgr_njl',
      'POST',
      '/competency/employees/emp-wanglei/assessments',
      {
        competencyId: 'comp-quality-record',
        level: 2,
        evidence: '抽查记录完整',
        assessedBy: 'someone-else',
      },
    );
    expect(forged.status).toBe(201);
    expect(forged.json.data.assessedBy).toBe(await userId('mgr_njl'));
    const stored = await db()
      .query()
      .selectFrom('employeeCompetencies')
      .select(['assessedBy'])
      .where('id', '=', forged.json.data.id)
      .executeTakeFirst();
    expect(stored?.assessedBy).toBe(await userId('mgr_njl'));
    expect(
      (
        await call(
          'mgr_njl',
          'POST',
          '/competency/employees/emp-zhaoyang/assessments',
          {
            competencyId: 'comp-cnc',
            level: 3,
          },
        )
      ).status,
    ).toBe(404);
    const self = await call(
      'mgr_njl',
      'POST',
      '/competency/employees/emp-mgr-njl/assessments',
      { competencyId: 'comp-team', level: 3 },
    );
    expect(self.json.code).toBe('ASSESSMENT_SELF');
    // 周宏 heads 苏州工厂: 装配车间 has no head, so 孙丽 (no account) is his to assess.
    expect(
      (
        await call(
          'mgr_east',
          'POST',
          '/competency/employees/emp-sunli/assessments',
          {
            competencyId: 'comp-safety',
            level: 1,
          },
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await call(
          'emp_njl_1',
          'POST',
          '/competency/employees/emp-limin/assessments',
          {
            competencyId: 'comp-safety',
            level: 1,
          },
        )
      ).status,
    ).toBe(403);
  });

  it("counts 王磊's mandatory gaps for the employee list", async () => {
    const counts = await server.application.container
      .resolve(competencyServiceToken)
      .pendingCounts([
        { id: 'emp-wanglei', positionId: 'pos-cnc-operator' },
        { id: 'emp-qianjin', positionId: 'pos-cnc-operator' },
      ]);
    expect(counts.get('emp-wanglei')).toBe(1);
    expect(counts.get('emp-qianjin')).toBe(0);
  });

  it('keeps scope on the 能力 Tab: 周宏 sees Suzhou, not Chengdu', async () => {
    expect(
      (await call('mgr_east', 'GET', '/competency/employees/emp-wanglei'))
        .status,
    ).toBe(200);
    expect(
      (await call('mgr_east', 'GET', '/competency/employees/emp-zhaoyang'))
        .status,
    ).toBe(404);
    expect(
      (await call('mgr_east', 'GET', '/employees/emp-zhaoyang/assessments'))
        .json.data ?? [],
    ).toEqual([]);
  });
});

describe('V3-08 assessment import', () => {
  it('names both bad rows of the sample, refuses the file, then imports the corrected one without overwriting', async () => {
    const sample = workbook(ASSESSMENT_IMPORT_SAMPLE(daysAgo));
    expect(
      (
        await raw(
          'mgr_njl',
          'POST',
          '/competency/assessments/import/preview',
          form(sample, 'a.xlsx'),
        )
      ).status,
    ).toBe(403);
    const preview = await raw(
      'hr01',
      'POST',
      '/competency/assessments/import/preview',
      form(sample, '能力评定导入数据.xlsx'),
    );
    expect(preview.status).toBe(200);
    expect(preview.json.data.invalid).toBe(2);
    const bad = (preview.json.data.rows as Json[]).filter(
      (r) => r.errors.length,
    );
    expect(bad.map((r) => [r.row, r.errors])).toEqual([
      [3, ['employeeNotFound']],
      [4, ['levelAboveMax']],
    ]);
    const refused = await raw(
      'hr01',
      'POST',
      '/competency/assessments/import',
      form(sample, 'a.xlsx'),
    );
    expect(refused.json.code).toBe('IMPORT_HAS_ERRORS');

    const before = await db()
      .query()
      .selectFrom('employeeCompetencies')
      .select(['id'])
      .execute();
    const fixed = workbook(
      ASSESSMENT_IMPORT_SAMPLE(daysAgo).filter((_, i) => i !== 1 && i !== 2),
    );
    const imported = await raw(
      'hr01',
      'POST',
      '/competency/assessments/import',
      form(fixed, 'fixed.xlsx'),
    );
    expect(imported.status).toBe(201);
    expect(imported.json.data.created).toBe(3);
    const after = await db()
      .query()
      .selectFrom('employeeCompetencies')
      .select(['id', 'source', 'competencyId', 'employeeId', 'assessedAt'])
      .execute();
    expect(after.length).toBe(before.length + 3);
    expect(before.every((b) => after.some((a) => a.id === b.id))).toBe(true);
    const process = after.find(
      (a) =>
        a.employeeId === 'emp-limin' &&
        a.competencyId === 'comp-process-record',
    );
    expect(process?.source).toBe('import');
    expect(
      new Date(String(process?.assessedAt)).toISOString().slice(0, 10),
    ).toBe(daysAgo(4));
  });

  it('refuses an importer assessing themselves', async () => {
    const self = await raw(
      'hr01',
      'POST',
      '/competency/assessments/import/preview',
      form(workbook([['QH1001', 'team-leading', 2, '', '']]), 'self.xlsx'),
    );
    expect(self.json.data.rows[0].errors).toEqual(['self']);
  });
});

describe('V3-08 transfer reference and change checklist', () => {
  it("shows 装配工's mandatory requirements with 王磊's levels, and lists the gap in the checklist", async () => {
    const block = await call(
      'mgr_east',
      'GET',
      '/competency/actions/action-wanglei-transfer/gap',
    );
    expect(block.status).toBe(200);
    expect(block.json.data.positionId).toBe('pos-assembler');
    expect(block.json.data.levelsVisible).toBe(true);
    const safety = (block.json.data.rows as Json[]).find(
      (r) => r.competencyId === 'comp-safety',
    );
    expect(safety).toMatchObject({ requiredLevel: 2, assessed: false, gap: 2 });
    expect(block.json.data.rows).toHaveLength(2);
    // Outside the approver's scope the block is not readable.
    expect(
      (
        await call(
          'mgr_cd',
          'GET',
          '/competency/actions/action-wanglei-transfer/gap',
        )
      ).status,
    ).not.toBe(200);

    const checklist = await server.application.container
      .resolve(checklistServiceToken)
      .syncAction('action-wanglei-transfer', {
        change: true,
        onboard: true,
        offboard: true,
      });
    const items = (checklist?.items ?? []).filter(
      (i) => i.provider === 'competencyGap',
    );
    expect(items).toEqual([
      expect.objectContaining({
        code: 'competencyGapUnassessed',
        params: expect.objectContaining({
          competency: '安全生产与 5S',
          required: '2',
        }),
      }),
    ]);
  });
});

describe('V3-08 new position: job description, candidates and 对标差距', () => {
  const shared: Record<string, string> = {};

  it('attaches the uploaded 岗位说明书 and extracts its text', async () => {
    const created = await call('hr01', 'POST', '/framework/positions', {
      code: 'sales-solution-manager',
      title: '销售解决方案经理',
      jobFamilyId: 'jf-sales',
      grade: 'S3',
    });
    expect(created.status).toBe(201);
    shared.position = created.json.data.id;
    const { readFileSync } = await import('node:fs');
    const docx = readFileSync(
      path.resolve(
        process.cwd(),
        'storage',
        'demo-materials',
        '销售解决方案经理岗位说明书.docx',
      ),
    );
    const data = new FormData();
    data.append(
      'file',
      new File([docx], '销售解决方案经理岗位说明书.docx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    const upload = await raw('hr01', 'POST', '/api/hrFiles:uploadOne', data);
    expect(upload.status).toBeLessThan(300);
    const fileId = String(upload.json.data.record.id);
    expect(
      (
        await call(
          'mgr_sales',
          'POST',
          `/competency/positions/${shared.position}/jd`,
          { fileId },
        )
      ).status,
    ).toBe(403);
    const attached = await call(
      'hr01',
      'POST',
      `/competency/positions/${shared.position}/jd`,
      { fileId },
    );
    expect(attached.status).toBe(200);
    expect(attached.json.data.jdStatus).toBe('pending');
    // Extraction runs after the response; run it here as the background job would.
    await server.application.container
      .resolve(competencyServiceToken)
      .extractJobDescription(shared.position);
    const framework = await call('hr01', 'GET', '/framework');
    const position = (framework.json.data.positions as Json[]).find(
      (p) => p.id === shared.position,
    )!;
    expect(['ready', 'pending']).toContain(position.jdStatus);
    const row = await db()
      .query()
      .selectFrom('positions')
      .select(['jdStatus', 'jdText'])
      .where('id', '=', shared.position)
      .executeTakeFirst();
    expect(row?.jdStatus).toBe('ready');
    expect(String(row?.jdText)).toContain('方案设计与报价');
    expect(String(row?.jdText)).toContain(SOLUTION_MANAGER_JD[0]);
  });

  it('hides drafts from 程远 until hr01 confirms them, confirming a draft competency with its requirement', async () => {
    const ctx = await actorOf('hr01');
    const talent = server.application.container.resolve(talentServiceToken);
    const design = await talent.saveCompetency(
      ctx,
      null,
      {
        code: 'solution-design-quotation',
        title: '解决方案设计与报价',
        category: 'skill',
        description:
          '牵头制定配套方案并完成成本测算与报价。依据：职责 2 方案设计与报价',
        maxLevel: 5,
        levels: [1, 2, 3, 4, 5].map((level) => ({
          level,
          title: `L${level}`,
          behaviors: `能独立完成第 ${level} 级复杂度的方案与报价测算。`,
        })),
      },
      { source: 'ai', draft: true },
    );
    shared.design = design.id;
    for (const [competencyId, requiredLevel] of [
      ['comp-brake-product', 4],
      ['comp-crm', 3],
      [design.id, 3],
    ] as const)
      await talent.saveRequirement(
        ctx,
        shared.position,
        { competencyId, requiredLevel, mandatory: true },
        { source: 'ai', draft: true },
      );
    const hidden = await call('mgr_sales', 'GET', '/framework');
    expect(
      (hidden.json.data.requirements as Json[]).filter(
        (r) => r.positionId === shared.position,
      ),
    ).toEqual([]);
    const drafts = (
      await call('hr01', 'GET', '/framework')
    ).json.data.requirements.filter(
      (r: Json) => r.positionId === shared.position,
    );
    expect(
      drafts.every(
        (r: Json) => r.reviewStatus === 'draft' && r.source === 'ai',
      ),
    ).toBe(true);
    const confirmed = await call(
      'hr01',
      'POST',
      '/framework/requirements/confirm',
      {
        ids: drafts.map((r: Json) => r.id),
      },
    );
    expect(confirmed.json.data.confirmedCompetencies).toEqual([design.id]);
    const visible = await call('mgr_sales', 'GET', '/framework');
    expect(
      (visible.json.data.requirements as Json[]).filter(
        (r) => r.positionId === shared.position,
      ),
    ).toHaveLength(3);
  });

  it('lets 程远 set the three sales engineers as candidates, raising one to-do each, without changing their jobs', async () => {
    for (const employeeId of [
      'emp-sales-xuke',
      'emp-sales-linfeng',
      'emp-sales-gaoyuan',
    ]) {
      const set = await call('mgr_sales', 'POST', '/competency/targets', {
        employeeId,
        targetPositionId: shared.position,
        reason: '新设岗位拟任',
      });
      expect(set.status).toBe(201);
      expect(set.json.data.createdBy).toBe(await userId('mgr_sales'));
    }
    const todos = await db()
      .query()
      .selectFrom('workItems')
      .select(['refId', 'summary', 'status'])
      .where('type', '=', 'assessmentTodo')
      .where('recipientUserId', '=', await userId('mgr_sales'))
      .execute();
    expect(todos.map((t) => t.refId).sort()).toEqual([
      'emp-sales-gaoyuan',
      'emp-sales-linfeng',
      'emp-sales-xuke',
    ]);
    expect(
      todos.every((t) => String(t.summary).includes('解决方案设计与报价')),
    ).toBe(true);
    const people = await db()
      .query()
      .selectFrom('employees')
      .select(['positionId', 'departmentId'])
      .where('id', 'in', [
        'emp-sales-gaoyuan',
        'emp-sales-linfeng',
        'emp-sales-xuke',
      ])
      .execute();
    expect(
      people.every(
        (p) =>
          p.positionId === 'pos-sales-engineer' && p.departmentId === 'sales',
      ),
    ).toBe(true);
  });

  it('refuses the current position and a repeated target', async () => {
    const current = await call('mgr_sales', 'POST', '/competency/targets', {
      employeeId: 'emp-sales-xuke',
      targetPositionId: 'pos-sales-engineer',
    });
    expect(current.json.code).toBe('TARGET_IS_CURRENT_POSITION');
    const again = await call('mgr_sales', 'POST', '/competency/targets', {
      employeeId: 'emp-sales-xuke',
      targetPositionId: shared.position,
    });
    expect(again.json.code).toBe('TARGET_EXISTS');
  });

  it('keeps 陈静 out of the sales candidates', async () => {
    // Neither 林峰 nor the new position (held by nobody) is in 陈静's departments.
    const outside = await call('mgr_njl', 'POST', '/competency/targets', {
      employeeId: 'emp-sales-linfeng',
      targetPositionId: shared.position,
    });
    expect([403, 404]).toContain(outside.status);
    const list = await call(
      'mgr_njl',
      'GET',
      `/competency/positions/${shared.position}/candidates`,
    );
    expect(list.json.data.items).toEqual([]);
    expect(
      (await call('mgr_njl', 'GET', '/competency/employees/emp-sales-gaoyuan'))
        .status,
    ).toBe(404);
  });

  it('orders the candidates by 对标差距 after 程远 assesses them, closing their to-dos', async () => {
    for (const [employeeId, level] of [
      ['emp-sales-gaoyuan', 3],
      ['emp-sales-linfeng', 2],
      ['emp-sales-xuke', 1],
    ] as const) {
      const assessed = await call(
        'mgr_sales',
        'POST',
        `/competency/employees/${employeeId}/assessments`,
        { competencyId: shared.design, level, evidence: '方案案例评审' },
      );
      expect(assessed.status).toBe(201);
    }
    const list = await call(
      'mgr_sales',
      'GET',
      `/competency/positions/${shared.position}/candidates`,
    );
    expect(list.status).toBe(200);
    expect((list.json.data.items as Json[]).map((i) => i.employeeName)).toEqual(
      ['高原', '林峰', '许可'],
    );
    expect(list.json.data.items[0].summary).toMatchObject({
      mandatoryGaps: 0,
      totalGap: 0,
    });
    const open = await db()
      .query()
      .selectFrom('workItems')
      .select(['id'])
      .where('type', '=', 'assessmentTodo')
      .where('recipientUserId', '=', await userId('mgr_sales'))
      .where('status', '=', 'open')
      .execute();
    expect(open).toHaveLength(0);
    const mine = await call(
      'emp_sales_1',
      'GET',
      '/competency/employees/emp-sales-gaoyuan',
    );
    expect(mine.json.data.targets).toHaveLength(1);
    expect(mine.json.data.targets[0]).toMatchObject({
      targetPositionTitle: '销售解决方案经理',
      summary: { mandatoryGaps: 0 },
    });
    expect(mine.json.data.targets[0].rows).toHaveLength(3);
  });

  it('achieves the target when the employee takes the position', async () => {
    const competency = server.application.container.resolve(
      competencyServiceToken,
    );
    await competency.onJobEvent({
      id: 'event-test-promote',
      employeeId: 'emp-sales-gaoyuan',
      eventType: 'promote',
      fromDepartmentId: 'sales',
      toDepartmentId: 'sales',
      fromPositionId: 'pos-sales-engineer',
      toPositionId: shared.position,
      effectiveDate: daysAgo(0),
      source: 'action',
      actionId: 'action-test-promote',
      note: null,
    });
    const row = await db()
      .query()
      .selectFrom('developmentTargets')
      .select(['status', 'decisionActionId', 'achievedAt'])
      .where('employeeId', '=', 'emp-sales-gaoyuan')
      .executeTakeFirst();
    expect(row).toMatchObject({
      status: 'achieved',
      decisionActionId: 'action-test-promote',
    });
  });

  it("raises to-dos when a position's requirements are first confirmed", async () => {
    const ctx = await actorOf('hr01');
    const talent = server.application.container.resolve(talentServiceToken);
    const position = await talent.savePosition(ctx, null, {
      code: 'prod-inspector-v308',
      title: '过程检验员',
      jobFamilyId: 'jf-prod',
      grade: 'S2',
    });
    const target = await call('hr01', 'POST', '/competency/targets', {
      employeeId: 'emp-qianjin',
      targetPositionId: position.id,
    });
    expect(target.json.data.todoRaised).toBe(false);
    const requirement = await talent.saveRequirement(
      ctx,
      position.id,
      {
        competencyId: 'comp-process-record',
        requiredLevel: 2,
        mandatory: true,
      },
      { source: 'ai', draft: true },
    );
    await call('hr01', 'POST', '/framework/requirements/confirm', {
      ids: [requirement.id],
    });
    const todo = await db()
      .query()
      .selectFrom('workItems')
      .select(['recipientUserId', 'summary', 'link'])
      .where('type', '=', 'assessmentTodo')
      .where('refId', '=', 'emp-qianjin')
      .where('status', '=', 'open')
      .executeTakeFirst();
    expect(todo?.recipientUserId).toBe(await userId('mgr_njl'));
    expect(String(todo?.summary)).toContain('过程记录完整性');
    expect(todo?.link).toBe('/talent/employees/emp-qianjin/abilities');
    const cancelled = await call(
      'hr01',
      'POST',
      `/competency/targets/${target.json.data.id}/cancel`,
    );
    expect(cancelled.json.data.status).toBe('cancelled');
    const after = await db()
      .query()
      .selectFrom('workItems')
      .select(['status'])
      .where('type', '=', 'assessmentTodo')
      .where('refId', '=', 'emp-qianjin')
      .executeTakeFirst();
    expect(after?.status).toBe('done');
  });
});

describe('V3-08 permissions', () => {
  it('keeps drafts, the advisor and the dictionary writes to HR administrators', async () => {
    const employee = await call('emp_njl_1', 'GET', '/framework');
    expect(employee.status).toBe(200);
    expect(employee.json.data.canUseAdvisor).toBe(false);
    expect(employee.json.data.canManage).toBe(false);
    expect(
      (employee.json.data.requirements as Json[]).every(
        (r) => r.reviewStatus === 'confirmed',
      ),
    ).toBe(true);
    expect(
      (await call('mgr_njl', 'GET', '/framework')).json.data.canUseAdvisor,
    ).toBe(false);
    expect(
      (
        await call('mgr_njl', 'POST', '/competencies', {
          code: 'x-y',
          title: 'x',
          category: 'skill',
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          'emp_njl_1',
          'GET',
          '/competency/assessments/import/template',
        )
      ).status,
    ).toBe(403);
    expect(
      (await call('hr01', 'GET', '/competency/assessments/import/template'))
        .status,
    ).toBe(200);
  });

  it("withdraws a head's assessment right with the hr.manager assignment, and restores it", async () => {
    const authz = server.application.container.resolve(authorizationToken);
    // hr.manager goes to the department-head subject; take it away from every subject it has.
    const assignments = [
      ...(await authz.permissionSets.listAssignments('hr.manager')),
    ];
    expect(assignments.length).toBeGreaterThan(0);
    const assess = () =>
      call('mgr_njl', 'POST', '/competency/employees/emp-limin/assessments', {
        competencyId: 'comp-team',
        level: 1,
      });
    for (const assignment of assignments)
      await authz.permissionSets.revoke(
        String((assignment as { id: string }).id),
      );
    expect((await assess()).status).toBe(403);
    for (const assignment of assignments)
      await authz.permissionSets.assign(assignment);
    expect((await assess()).status).toBe(201);
  });
});

describe('V3-08 framework advisor: monthly check facts', () => {
  it('lists vacant, gradeless and similar positions without changing anything', async () => {
    const before = await db()
      .query()
      .selectFrom('positions')
      .selectAll()
      .execute();
    const issues = await computePositionIssues(db());
    expect(issues.vacant.map((p) => p.title)).toContain('内审专员');
    expect(issues.noGrade.map((p) => p.title)).toContain('内审专员');
    const run = await call(
      'hr01',
      'POST',
      '/automations/frameworkAdvisor.dictionaryReview/run',
    );
    const detail = await call(
      'hr01',
      'GET',
      `/automations/runs/${run.json.data.runId}`,
    );
    expect(run.json.data.status).toBe('succeeded');
    expect(detail.json.data.error).toBeNull();
    const suggestions = detail.json.data.output.suggestions as Json[];
    expect(
      suggestions.some(
        (s) =>
          s.kind === 'merge' &&
          s.competencies.includes('质量记录规范') &&
          s.competencies.includes('过程记录完整性'),
      ),
    ).toBe(true);
    expect(
      suggestions.some(
        (s) => s.kind === 'position' && s.competencies.includes('内审专员'),
      ),
    ).toBe(true);
    const after = await db()
      .query()
      .selectFrom('positions')
      .selectAll()
      .execute();
    expect(after).toEqual(before);
  });

  it('drafts a position that has only an extracted job description', async () => {
    const ctx = await actorOf('hr01');
    const position = await server.application.container
      .resolve(talentServiceToken)
      .savePosition(ctx, null, {
        code: 'prod-quality-inspector-v308',
        title: '质检员',
        jobFamilyId: 'jf-prod',
        grade: 'S2',
      });
    await db()
      .query()
      .updateTable('positions')
      .set({ jdText: '负责首件检验与巡检。', jdStatus: 'ready' })
      .where('id', '=', position.id)
      .execute();
    // Without a model the run fails rather than inventing requirements: the position was picked up.
    const run = await call(
      'hr01',
      'POST',
      '/automations/frameworkAdvisor.draftNewPositions/run',
    );
    expect(run.json.data.status).toBe('failed');
  });
});

describe('V3-08 migration 202610020001_extend_competency_framework', () => {
  it('adds the job description fields, custom-field columns and development targets, and reverses cleanly', async () => {
    const { readdirSync } = await import('node:fs');
    const { createDatabaseManager, InMemoryCollectionMetadataStore } =
      await import('@nocobase/db');
    const { sqlite } = await import('@nocobase/db-sqlite');
    const migrations = path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    );
    const name = '202610020001_extend_competency_framework';
    const names = readdirSync(migrations)
      .filter((file) => /^\d{12}_.+\.ts$/u.test(file))
      .map((file) => file.replace(/\.ts$/u, ''))
      .sort();
    const previous = names[names.indexOf(name) - 1];
    const folder = mkdtempSync(path.join(tmpdir(), 'hr-v3-competency-schema-'));
    const database = createDatabaseManager({
      default: 'main',
      connections: {
        main: sqlite({
          filename: path.join(folder, 'test.sqlite'),
          schemaManagement: 'managed',
        }),
      },
      metadataStore: new InMemoryCollectionMetadataStore(),
    });
    try {
      const migrator = database.createMigrator({
        directory: migrations,
        packageName: 'hr',
      });
      await migrator.upTo(previous);
      expect((await migrator.upTo(name)).executed).toEqual([name]);
      const fields = async (table: string) =>
        ((await database.collections().get(table))?.fields ?? []).map(
          (f) => f.name,
        );
      expect(await fields('positions')).toEqual(
        expect.arrayContaining([
          'jdFileId',
          'jdFilename',
          'jdText',
          'jdStatus',
          'jdError',
        ]),
      );
      for (const table of [
        'competencies',
        'competencyLevels',
        'positionRequirements',
      ])
        expect(await fields(table)).toContain('customFields');
      expect(
        await database.collections().getPhysical('developmentTargets'),
      ).toBeDefined();
      expect((await migrator.rollback()).rolledBack).toEqual([name]);
      expect(
        await database.collections().getPhysical('developmentTargets'),
      ).toBeUndefined();
      expect(await fields('positions')).not.toContain('jdText');
      expect(await fields('competencies')).not.toContain('customFields');
      expect((await migrator.upTo(name)).executed).toEqual([name]);
    } finally {
      await database.destroy();
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
