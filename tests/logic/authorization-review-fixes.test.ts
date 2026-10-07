// @vitest-environment node

// 2026-10-07 readiness review, section 二 (authorization): on the demo data (启衡精密), with the real
// standalone server and its permission sets.
//
// - Payroll applies the record scope of each action's grant: a payroll specialist limited to their
//   departments sees, calculates on and exports only those people; the default all-records grants are
//   unchanged (tests/logic/v2-payroll.test.ts), and a grant without a field leaves it out.
// - A payroll approver sees a pending cycle or salary adjustment only when they hold the pending step's set.
// - The social-insurance changes file needs the new export action (seed 202610260121).
// - A stored audit pack is downloaded by its builder, or by someone whose grant reaches every employee.
// - Small checks: the employee import template, sensitive department fields, the checklist opened by
//   action (no write before the check), and an automation's owner.
// - Middleware of routers mounted at /talent stays on their own paths (org-sync's 64 KB body limit).
// - Practical photos are capped and typed by their bytes; downloads carry nosniff and an encoded name.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  PASSWORD,
  startHarness,
  type Harness,
  type Json,
} from './talent-review-harness.ts';

let h: Harness;
const ALL = 'allRecords';
const MANAGED = 'talent.managedDepartments';
const cookies = new Map<string, string>();

beforeAll(async () => {
  h = await startHarness('authorization-review-fixes');
}, 240_000);

afterAll(async () => {
  await h?.close();
});

async function cookieOf(username: string): Promise<string> {
  const cached = cookies.get(username);
  if (cached) return cached;
  const response = await h.server.fetch(
    new Request(`${h.base}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: PASSWORD }),
    }),
  );
  expect(response.status).toBe(200);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .join('; ');
  cookies.set(username, cookie);
  return cookie;
}

/** A raw request, for downloads, headers and multipart bodies. */
async function raw(
  username: string | null,
  method: string,
  url: string,
  body?: BodyInit,
  headers: Record<string, string> = {},
): Promise<Response> {
  return h.server.fetch(
    new Request(`${h.base}/api/talent${url}`, {
      method,
      headers: {
        ...headers,
        ...(username ? { cookie: await cookieOf(username) } : {}),
        ...(method === 'GET' ? {} : { origin: 'http://localhost' }),
      },
      body,
    }),
  );
}

async function authz() {
  const { authorizationToken } =
    await import('@nocobase/app-plugin-authorization/server');
  return h.server.application.container.resolve(authorizationToken);
}

/** Creates a permission set for the test and assigns it to a user; answers the clean-up. */
async function grantSet(
  key: string,
  username: string,
  grants: unknown[],
): Promise<() => Promise<void>> {
  const service = await authz();
  await service.permissionSets.create({
    key,
    title: key,
    grants: grants as never,
  });
  const assignment = await service.permissionSets.assign({
    permissionSet: key,
    subject: { type: 'user', id: await h.userId(username) },
  });
  return async () => {
    await service.permissionSets.revoke(
      String((assignment as { id: string }).id),
    );
    await service.permissionSets.delete(key);
  };
}

describe('payroll record scope', () => {
  let release: () => Promise<void>;
  let published: string;

  beforeAll(async () => {
    const { salaryResource, payrollResource } =
      await import('../../server/providers/hr/payroll/resources.ts');
    release = await grantSet('test-scoped-payroll', 'mgr_njl', [
      salaryResource.reference().grant({
        view: {
          employees: MANAGED,
          employeeSalaries: ALL,
          salaryAdjustments: ALL,
          salaryStructures: ALL,
        },
      }),
      payrollResource.reference().grant({
        view: { employees: MANAGED, payrollCycles: ALL, payslips: MANAGED },
        calculate: {
          employees: MANAGED,
          payrollCycles: ALL,
          payslips: MANAGED,
          employeeSalaries: ALL,
          salaryStructures: ALL,
          employeeSocialInsurances: ALL,
          socialInsurancePlans: ALL,
          employeeTaxDeductions: ALL,
          attendanceMonthlySummaries: ALL,
        },
        export: {
          employees: MANAGED,
          payrollCycles: ALL,
          payslips: MANAGED,
          employeeSalaries: ALL,
        },
      }),
    ]);
    const cycles = await h.call('payroll01', 'GET', '/payroll/cycles');
    published = (cycles.json.data.cycles as Json[]).find(
      (c) => c.status === 'published' || c.status === 'closed',
    )!.id;
  });

  afterAll(async () => {
    await release?.();
  });

  it('lists only the salary files of the departments the grant reaches', async () => {
    const all = await h.call('payroll01', 'GET', '/salaries');
    const scoped = await h.call('mgr_njl', 'GET', '/salaries');
    expect(scoped.status).toBe(200);
    const allIds = new Set(
      (all.json.data.rows as Json[]).map((r) => r.employeeId),
    );
    const scopedIds = (scoped.json.data.rows as Json[]).map(
      (r) => r.employeeId,
    );
    expect(scopedIds.length).toBeGreaterThan(0);
    expect(scopedIds.length).toBeLessThan(allIds.size);
    for (const id of scopedIds) expect(allIds.has(id)).toBe(true);
    const outside = [...allIds].find((id) => !scopedIds.includes(id))!;
    expect(
      (await h.call('payroll01', 'GET', `/salaries/${outside}`)).status,
    ).toBe(200);
    const refused = await h.call('mgr_njl', 'GET', `/salaries/${outside}`);
    expect(refused.status).toBe(404);
    expect(JSON.stringify(refused.json)).not.toMatch(/baseSalary/u);
    expect(
      (await h.call('mgr_njl', 'GET', `/salaries/${scopedIds[0]}`)).status,
    ).toBe(200);
  });

  it('shows and exports only the payslips of those departments', async () => {
    const all = await h.call(
      'payroll01',
      'GET',
      `/payroll/cycles/${published}/payslips`,
    );
    const scoped = await h.call(
      'mgr_njl',
      'GET',
      `/payroll/cycles/${published}/payslips`,
    );
    expect(scoped.status).toBe(200);
    const scopedIds = (scoped.json.data as Json[]).map((s) => s.id);
    expect(scopedIds.length).toBeGreaterThan(0);
    expect(scopedIds.length).toBeLessThan((all.json.data as Json[]).length);
    const outside = (all.json.data as Json[]).find(
      (s) => !scopedIds.includes(s.id),
    )!;
    expect(
      (
        await h.call(
          'mgr_njl',
          'GET',
          `/payroll/cycles/${published}/payslips/${outside.id}`,
        )
      ).status,
    ).toBe(404);
    const bank = await raw(
      'mgr_njl',
      'GET',
      `/payroll/cycles/${published}/exports/bank`,
    );
    expect(bank.status).toBe(200);
    const lines = (await bank.text())
      .split(/\r?\n/u)
      .filter((line) => line.trim());
    // The header and one line per payslip in scope; nobody outside.
    expect(lines.length - 1).toBe(
      (scoped.json.data as Json[]).filter((s) => s.calculated).length,
    );
    expect(lines.join('\n')).not.toContain(outside.employeeNo);
  });

  it('leaves out a field the grant does not list', async () => {
    const { payrollScopes } =
      await import('../../server/providers/hr/payroll/scope.ts');
    const fields = ['id', 'employeeId', 'baseSalary'];
    const scopes = payrollScopes(await h.db(), {
      employeeSalaries: {
        read: { scope: true, fields },
        create: false,
        update: false,
        delete: false,
      },
    });
    const row = await scopes.fields('employeeSalaries', {
      id: 's1',
      employeeId: 'e1',
      baseSalary: 1,
      bankAccount: { accountNo: '6222' },
    });
    expect(row).toEqual({ id: 's1', employeeId: 'e1', baseSalary: 1 });
  });
});

describe('payroll approvers see only their own step', () => {
  const now = new Date();
  const step = (permissionSet: string) => [
    {
      level: 1,
      title: '审批',
      permissionSet,
      status: 'pending',
      decidedBy: null,
      decidedByName: null,
      decidedAt: null,
      comment: null,
    },
  ];

  beforeAll(async () => {
    const q = (await h.db()).query();
    for (const [id, month, set] of [
      ['test-cycle-mine', '2019-01', 'hr.payrollApprover'],
      ['test-cycle-other', '2019-02', 'hr.admin'],
    ])
      await q
        .insertInto('payrollCycles')
        .values({
          id,
          month,
          scope: { departmentIds: [] },
          status: 'pendingApproval',
          imports: [],
          calculatedAt: now,
          calculationId: null,
          calculatedBy: null,
          submittedBy: await h.userId('payroll01'),
          submittedAt: now,
          approvals: step(set),
          approvedBy: null,
          approvedAt: null,
          publishedAt: null,
          publishedBy: null,
          exports: [],
          review: null,
          bonusCycleId: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
    const employee = await q
      .selectFrom('employeeSalaries')
      .select(['employeeId'])
      .executeTakeFirstOrThrow();
    for (const [id, set] of [
      ['test-adjustment-mine', 'hr.payrollApprover'],
      ['test-adjustment-other', 'hr.admin'],
    ])
      await q
        .insertInto('salaryAdjustments')
        .values({
          id,
          employeeId: String(employee.employeeId),
          effectiveMonth: '2019-01',
          changes: { before: {}, after: {} },
          reason: '测试',
          relatedActionId: null,
          relatedReviewResultId: null,
          status: 'pending',
          approvals: step(set),
          applicantUserId: await h.userId('payroll01'),
          customFields: null,
          createdAt: now,
          updatedAt: now,
        })
        .execute();
  });

  it('lists and opens a pending cycle only for a holder of the pending step', async () => {
    const listed = await h.call('fin01', 'GET', '/payroll/cycles');
    const ids = (listed.json.data.cycles as Json[]).map((c) => c.id);
    expect(ids).toContain('test-cycle-mine');
    expect(ids).not.toContain('test-cycle-other');
    expect(
      (await h.call('fin01', 'GET', '/payroll/cycles/test-cycle-mine')).status,
    ).toBe(200);
    expect(
      (await h.call('fin01', 'GET', '/payroll/cycles/test-cycle-other')).status,
    ).toBe(404);
    expect(
      (
        await h.call(
          'fin01',
          'GET',
          '/payroll/cycles/test-cycle-other/payslips',
        )
      ).status,
    ).toBe(404);
  });

  it('lists a pending salary adjustment only for a holder of the pending step', async () => {
    const listed = await h.call('fin01', 'GET', '/salaries/adjustments');
    expect(listed.status).toBe(200);
    const ids = (listed.json.data as Json[]).map((a) => a.id);
    expect(ids).toContain('test-adjustment-mine');
    expect(ids).not.toContain('test-adjustment-other');
    // The payroll specialist, with the view action, sees both.
    const all = await h.call('payroll01', 'GET', '/salaries/adjustments');
    expect((all.json.data as Json[]).map((a) => a.id)).toEqual(
      expect.arrayContaining(['test-adjustment-mine', 'test-adjustment-other']),
    );
  });
});

describe('social-insurance changes export', () => {
  it('needs the export action, which hr.payroll holds', async () => {
    const { socialInsuranceResource } =
      await import('../../server/providers/hr/payroll/resources.ts');
    const release = await grantSet('test-insurance-viewer', 'emp_njl_1', [
      socialInsuranceResource.reference().grant({
        view: {
          employees: ALL,
          socialInsurancePlans: ALL,
          employeeSocialInsurances: ALL,
          employeeTaxDeductions: ALL,
        },
      }),
    ]);
    try {
      expect(
        (
          await h.call(
            'emp_njl_1',
            'GET',
            '/social-insurance/changes?month=2026-01',
          )
        ).status,
      ).toBe(200);
      const refused = await raw(
        'emp_njl_1',
        'GET',
        '/social-insurance/changes/export?month=2026-01',
      );
      expect(refused.status).toBe(403);
      const allowed = await raw(
        'payroll01',
        'GET',
        '/social-insurance/changes/export?month=2026-01',
      );
      expect(allowed.status).toBe(200);
    } finally {
      await release();
    }
  });
});

describe('audit pack download', () => {
  it('serves a pack to its builder or to an all-records grant only', async () => {
    const { auditResource } =
      await import('../../server/providers/hr/profile/resources.ts');
    const { profileServicesToken } =
      await import('../../server/providers/hr/tokens.ts');
    const profile =
      h.server.application.container.resolve(profileServicesToken);
    const release = await grantSet('test-scoped-auditor', 'mgr_njl', [
      auditResource.reference().grant({
        exportAuditPack: { employees: MANAGED },
      }),
    ]);
    try {
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
      const others = await profile.storeAuditPack(
        { bytes, fileName: 'audit-pack-2026-10-07.zip' },
        await h.userId('hr01'),
      );
      const own = await profile.storeAuditPack(
        { bytes, fileName: 'audit-pack-2026-10-07.zip' },
        await h.userId('mgr_njl'),
      );
      expect(others).toMatch(/^[0-9a-f-]{36}$/u);
      expect(
        (await raw('mgr_njl', 'GET', `/audit/packs/${others}`)).status,
      ).toBe(404);
      expect((await raw('mgr_njl', 'GET', `/audit/packs/${own}`)).status).toBe(
        200,
      );
      // hr01's grant reaches every employee.
      expect((await raw('hr01', 'GET', `/audit/packs/${own}`)).status).toBe(
        200,
      );
      // Without the action, not even one's own.
      expect(
        (await raw('emp_njl_1', 'GET', `/audit/packs/${own}`)).status,
      ).toBe(403);
      // Another kind of file is no pack.
      const other = await (
        await h.db()
      )
        .query()
        .selectFrom('hrFiles')
        .select(['id'])
        .where('id', 'not in', [own, others])
        .executeTakeFirst();
      if (other)
        expect(
          (await raw('hr01', 'GET', `/audit/packs/${String(other.id)}`)).status,
        ).toBe(404);
    } finally {
      await release();
    }
  });
});

describe('small authorization checks', () => {
  it('asks for the import action before the employee import template', async () => {
    expect(
      (await raw('emp_njl_1', 'GET', '/employees/import-template')).status,
    ).toBe(403);
    expect(
      (await raw('hr01', 'GET', '/employees/import-template')).status,
    ).toBe(200);
  });

  it('shows sensitive department fields only to HR administrators', async () => {
    const created = await h.call('hr01', 'POST', '/custom-fields', {
      collection: 'departments',
      label: { 'zh-CN': '成本中心编码', 'en-US': 'Cost centre code' },
      type: 'text',
      placements: ['form', 'detail'],
      sensitive: true,
    });
    expect(created.status).toBe(201);
    const key = created.json.data.key as string;
    const listed = await h.call('hr01', 'GET', '/org/departments');
    const department = (listed.json.data as Json[])[0];
    expect(
      (
        await h.call('hr01', 'PATCH', `/org/departments/${department.id}`, {
          customFields: { [key]: 'CC-001' },
        })
      ).json.data.customFields,
    ).toEqual({ [key]: 'CC-001' });
    const release = await grantSet('test-department-reader', 'emp_njl_1', [
      {
        resource: { type: 'settings', id: 'talent.departments' },
        actions: [{ action: 'read' }, { action: 'update' }],
      },
    ]);
    try {
      const read = await h.call('emp_njl_1', 'GET', '/org/departments');
      expect(read.status).toBe(200);
      const seen = (read.json.data as Json[]).find(
        (d) => d.id === department.id,
      )!;
      expect(seen.customFields[key]).toBeUndefined();
      // Nor written by them: the stored value stays.
      const patched = await h.call(
        'emp_njl_1',
        'PATCH',
        `/org/departments/${department.id}`,
        { customFields: { [key]: 'CC-999' } },
      );
      expect(patched.status).toBe(200);
      expect(patched.json.data.customFields[key]).toBeUndefined();
      const again = await h.call('hr01', 'GET', '/org/departments');
      expect(
        (again.json.data as Json[]).find((d) => d.id === department.id)!
          .customFields[key],
      ).toBe('CC-001');
    } finally {
      await release();
    }
  });

  it('writes no checklist for an action before the caller may read it', async () => {
    const q = (await h.db()).query();
    const count = async () =>
      (
        await q
          .selectFrom('jobChangeChecklists')
          .select(['id'])
          .where('actionId', '=', 'action-wanglei-transfer')
          .execute()
      ).length;
    await q
      .deleteFrom('jobChangeChecklists')
      .where('actionId', '=', 'action-wanglei-transfer')
      .execute();
    const refused = await h.call(
      'emp_njl_1',
      'GET',
      '/checklists/by-action/action-wanglei-transfer',
    );
    expect(refused.status).toBe(200);
    expect(refused.json.data).toBeNull();
    expect(await count()).toBe(0);
    // The action's approver brings it up to date and reads it.
    const approver = await h.call(
      'mgr_east',
      'GET',
      '/checklists/by-action/action-wanglei-transfer',
    );
    expect(approver.json.data?.stage).toBe('preview');
    expect(await count()).toBe(1);
  });

  it('hands an automation only to the caller or a peer who may configure it', async () => {
    const hr01 = await h.userId('hr01');
    const payroll01 = await h.userId('payroll01');
    const refused = await h.call(
      'payroll01',
      'PATCH',
      '/automations/hrAssistant.payrollCheck',
      { ownerUserId: hr01 },
    );
    expect(refused.status).toBe(403);
    expect(refused.json.code).toBe('AUTOMATION_OWNER_NOT_PERMITTED');
    const own = await h.call(
      'payroll01',
      'PATCH',
      '/automations/hrAssistant.payrollCheck',
      { ownerUserId: payroll01 },
    );
    expect(own.status).toBe(200);
    expect(own.json.data.ownerUserId).toBe(payroll01);
    const owners = await h.call(
      'payroll01',
      'GET',
      '/automations/owners?key=hrAssistant.payrollCheck',
    );
    const ids = (owners.json.data as Json[]).map((o) => o.userId);
    expect(ids).toContain(payroll01);
    expect(ids).not.toContain(hr01);
  });
});

describe('middleware stays on its own paths', () => {
  it('does not put org-sync’s 64 KB limit on later /talent routes', async () => {
    const big = new FormData();
    big.set(
      'file',
      new File([new Uint8Array(200 * 1024)], 'photo.jpg', {
        type: 'image/jpeg',
      }),
    );
    const response = await raw(
      'trainer01',
      'POST',
      '/practicals/records/no-such-record/attachments',
      big,
    );
    expect(response.status).not.toBe(413);
    // Its own paths keep it.
    const own = await raw(
      'hr01',
      'PATCH',
      '/org-sync/settings',
      JSON.stringify({ padding: 'x'.repeat(100 * 1024) }),
      { 'content-type': 'application/json' },
    );
    expect(own.status).toBe(413);
  });

  it('still authenticates every path the routers own', async () => {
    for (const path of [
      '/employees',
      '/lookups',
      '/checklists',
      '/compliance',
      '/org-sync',
      '/position-aliases',
      '/job-events',
    ])
      expect({ path, status: (await raw(null, 'GET', path)).status }).toEqual({
        path,
        status: 401,
      });
  });
});

describe('uploads and downloads', () => {
  let recordId: string;

  beforeAll(async () => {
    const started = await h.call('trainer01', 'POST', '/practicals/records', {
      assessmentId: 'pa-demo-cnc-first-article',
      employeeId: 'emp-qianjin',
      witnessUserId: await h.userId('qa_audit'),
    });
    if (started.status !== 201)
      throw new Error(`practical record not started: ${started.status}`);
    recordId = started.json.data.id;
  });

  const attach = (bytes: Uint8Array, name: string, type: string) => {
    const form = new FormData();
    form.set('file', new File([bytes], name, { type }));
    return raw(
      'trainer01',
      'POST',
      `/practicals/records/${recordId}/attachments`,
      form,
    );
  };

  it('stores a photo by its own bytes, refusing a disguised file and one over 10 MB', async () => {
    const html = new TextEncoder().encode('<html><script>alert(1)</script>');
    const disguised = await attach(html, 'photo.jpg', 'image/jpeg');
    expect(disguised.status).toBe(400);
    expect(((await disguised.json()) as Json).code).toBe('UPLOAD_TYPE_INVALID');
    const tooLarge = new Uint8Array(10 * 1024 * 1024 + 1);
    tooLarge.set([0xff, 0xd8, 0xff]);
    const large = await attach(tooLarge, 'big.jpg', 'image/jpeg');
    expect(large.status).toBe(400);
    expect(((await large.json()) as Json).code).toBe('UPLOAD_TOO_LARGE');
    // A real PNG declared as something else is stored as the PNG it is.
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
    const stored = await attach(png, 'scan.html', 'video/quicktime');
    expect(stored.status).toBe(201);
    const row = await (
      await h.db()
    )
      .query()
      .selectFrom('hrFiles')
      .select(['mimeType', 'ext', 'filename', 'key'])
      .where('key', 'like', `hr-files/practicals/${recordId}/%`)
      .executeTakeFirstOrThrow();
    expect(row).toMatchObject({
      mimeType: 'image/png',
      ext: 'png',
      filename: 'scan.png',
    });
  });

  it('exports a session with an encoded file name', async () => {
    const trainer = await h.userId('trainer01');
    const session = await (
      await h.db()
    )
      .query()
      .selectFrom('trainingSessions')
      .select(['id'])
      .where((eb) =>
        eb.or([
          eb('ownerUserId', '=', trainer),
          eb('instructorUserId', '=', trainer),
        ]),
      )
      .executeTakeFirstOrThrow();
    const exported = await raw(
      'trainer01',
      'GET',
      `/sessions/${String(session.id)}/export`,
    );
    expect(exported.status).toBe(200);
    const disposition = exported.headers.get('content-disposition') ?? '';
    expect(disposition).toMatch(/filename\*=UTF-8''/u);
    expect(disposition).toMatch(/^[\x20-\x7e]*$/u);
  });

  it('serves a knowledge document with nosniff', async () => {
    const q = (await h.db()).query();
    const document = await q
      .selectFrom('kbDocuments')
      .select(['id', 'fileId'])
      .where('fileId', 'is not', null)
      .where('visibility', '=', 'all')
      .executeTakeFirstOrThrow();
    // The demo rows name their file; put its bytes on the test drive.
    const file = await q
      .selectFrom('hrFiles')
      .select(['disk', 'key'])
      .where('id', '=', String(document.fileId))
      .executeTakeFirstOrThrow();
    const { driveManagerToken } = await import('@nocobase/app-server/drive');
    await h.server.application.container
      .resolve(driveManagerToken)
      .use(String(file.disk))
      .put(String(file.key), new TextEncoder().encode('%PDF-1.4'));
    const response = await raw(
      'hr01',
      'GET',
      `/kb/documents/${String(document.id)}/download`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
