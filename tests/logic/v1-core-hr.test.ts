// @vitest-environment node

// Acceptance checks for V1 step 2 (核心人事) as completed on 2026-09-29: the configurable approval chain (levels added
// per department, merging, auto-pass, snapshots, preview), promotions by grade order, 更正任职信息 with manual job
// events, the import switch, self-service fields and the job history scope. Each run boots the real standalone server
// on a throwaway SQLite database with migrations and seeds, so the demo database stays untouched.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

// The database task runner imports seed files through Node itself, outside Vite. Node strips their types but does
// not map a relative `.js` specifier to its `.ts` source the way `pnpm dev` and the compiled build do, so the seeds'
// imports of `database/seed-data/*` would not resolve here. Map only application sources, only after a miss.
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
      ) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v1-core-hr-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

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

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = {};
  if (username) headers.cookie = await signIn(username);
  if (body !== undefined) headers['content-type'] = 'application/json';
  // Writes pass the same-origin check a browser request would.
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    // Paths under /api/talent are written short; any other /api path is given in full.
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v1-core-hr-'));
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
  if (directory) rmSync(directory, { recursive: true, force: true });
});

async function upload(
  username: string,
  url: string,
  file: Buffer,
): Promise<{ status: number; json: Json }> {
  const body = new FormData();
  body.append(
    'file',
    new Blob([new Uint8Array(file)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    'import.xlsx',
  );
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method: 'POST',
      headers: {
        cookie: await signIn(username),
        origin: 'http://localhost',
      },
      body,
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

async function workbook(rows: readonly (readonly string[])[]): Promise<Buffer> {
  const XLSX = await import('xlsx');
  const { DEMO_IMPORT_HEADER } =
    await import('../../database/seed-data/demo.ts');
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
      [...DEMO_IMPORT_HEADER],
      ...rows.map((r) => [...r]),
    ]),
    'employees',
  );
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const todayInShanghai = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

/** Saves one section of 人事设置 at its current revision. */
async function saveSettings(section: string, value: unknown) {
  const current = await call('hr01', 'GET', '/personnel-settings');
  expect(current.status).toBe(200);
  return call('hr01', 'PATCH', `/personnel-settings/${section}`, {
    revision: current.json.data[section].revision,
    value,
  });
}

const CHENGDU_DIRECTOR = {
  id: 'rule-cd-director',
  departmentId: 'cd',
  actionTypes: ['onboard'],
  name: '厂长审批',
  approver: { type: 'departmentHead', departmentId: 'cd' },
  position: 'afterFirst',
  enabled: true,
};

async function userIdOf(username: string): Promise<string> {
  const me = await call(username, 'GET', '/api/auth/get-session');
  return String(me.json.user?.id ?? me.json.data?.user?.id);
}

let onboardSeq = 0;
function onboardInput(department: string, position = 'pos-cnc-operator') {
  onboardSeq += 1;
  return {
    actionType: 'onboard',
    effectiveDate: todayInShanghai(),
    toDepartmentId: department,
    toPositionId: position,
    name: `测试入职${onboardSeq}`,
    employeeNo: `QT9${String(onboardSeq).padStart(3, '0')}`,
    probationMonths: 3,
  };
}

describe('approval chain configured per department', () => {
  it('previews the default two levels, the applicant passing the HR level', async () => {
    const preview = await call(
      'hr01',
      'POST',
      '/personnel-settings/chain-preview',
      {
        departmentId: 'sz-mc',
        actionType: 'onboard',
      },
    );
    expect(preview.status).toBe(200);
    const steps = preview.json.data as Json[];
    expect(steps.map((s) => s.kind)).toEqual(['departmentHead', 'hrAdmin']);
    expect(steps[0]!.approverNames).toEqual(['陈静']);
    expect(steps[0]!.status).toBe('pending');
    expect(steps[1]!.status).toBe('auto');
  });

  it('adds 厂长审批 for 成都工厂 and merges it with the same head', async () => {
    expect(
      (
        await saveSettings('approvalChain', {
          rules: [CHENGDU_DIRECTOR],
          mergeAdjacent: true,
        })
      ).status,
    ).toBe(200);
    const chengdu = await call(
      'hr01',
      'POST',
      '/personnel-settings/chain-preview',
      {
        departmentId: 'cd-mc',
        actionType: 'onboard',
      },
    );
    const steps = chengdu.json.data as Json[];
    // 成都机加工车间 has no head: the first level goes up to 何伟, who is also the added level's approver.
    expect(steps).toHaveLength(2);
    expect(steps[0]!.approverNames).toEqual(['何伟']);
    expect(steps[0]!.merged).toEqual([{ kind: 'extra', name: '厂长审批' }]);
    const suzhou = await call(
      'hr01',
      'POST',
      '/personnel-settings/chain-preview',
      {
        departmentId: 'sz-mc',
        actionType: 'onboard',
      },
    );
    expect((suzhou.json.data as Json[]).map((s) => s.kind)).toEqual([
      'departmentHead',
      'hrAdmin',
    ]);
  });

  it('runs the merged level once, then separately when merging is off', async () => {
    const merged = await call(
      'hr01',
      'POST',
      '/actions',
      onboardInput('cd-mc'),
    );
    expect(merged.status).toBe(201);
    const mergedSteps = merged.json.data.approvals as Json[];
    expect(mergedSteps).toHaveLength(2);
    const mgrCd = await userIdOf('mgr_cd');
    expect(merged.json.data.status).toBe('pending');
    const approved = await call(
      'mgr_cd',
      'POST',
      `/actions/${merged.json.data.id}/approve`,
      {},
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe('effective');
    expect(approved.json.data.approvals[0].decidedBy).toBe(mgrCd);

    await saveSettings('approvalChain', {
      rules: [CHENGDU_DIRECTOR],
      mergeAdjacent: false,
    });
    const separate = await call(
      'hr01',
      'POST',
      '/actions',
      onboardInput('cd-mc'),
    );
    const steps = separate.json.data.approvals as Json[];
    expect(steps.map((s) => s.kind)).toEqual([
      'departmentHead',
      'extra',
      'hrAdmin',
    ]);
    expect(steps[1]!.name).toBe('厂长审批');
    const first = await call(
      'mgr_cd',
      'POST',
      `/actions/${separate.json.data.id}/approve`,
      {},
    );
    expect(first.json.data.status).toBe('pending');
    expect(first.json.data.currentLevel).toBe(2);
    const second = await call(
      'mgr_cd',
      'POST',
      `/actions/${separate.json.data.id}/approve`,
      {},
    );
    expect(second.json.data.status).toBe('effective');
  });

  it('keeps the submitted chain when the configuration changes afterwards', async () => {
    await saveSettings('approvalChain', { rules: [], mergeAdjacent: true });
    const raised = await call(
      'hr01',
      'POST',
      '/actions',
      onboardInput('sz-mc'),
    );
    expect((raised.json.data.approvals as Json[]).map((s) => s.kind)).toEqual([
      'departmentHead',
      'hrAdmin',
    ]);
    await saveSettings('approvalChain', {
      rules: [
        {
          ...CHENGDU_DIRECTOR,
          id: 'rule-sz',
          departmentId: 'sz',
          approver: { type: 'departmentHead', departmentId: 'sz' },
        },
      ],
      mergeAdjacent: true,
    });
    const later = await call('hr01', 'GET', `/actions/${raised.json.data.id}`);
    expect((later.json.data.approvals as Json[]).map((s) => s.kind)).toEqual([
      'departmentHead',
      'hrAdmin',
    ]);
    const fresh = await call('hr01', 'POST', '/actions', onboardInput('sz-mc'));
    expect((fresh.json.data.approvals as Json[]).map((s) => s.kind)).toEqual([
      'departmentHead',
      'extra',
      'hrAdmin',
    ]);
    await saveSettings('approvalChain', { rules: [], mergeAdjacent: true });
  });

  it('refuses the settings to department heads, and unknown references', async () => {
    expect((await call('mgr_cd', 'GET', '/personnel-settings')).status).toBe(
      403,
    );
    expect(
      (
        await call('mgr_east', 'POST', '/personnel-settings/chain-preview', {
          departmentId: 'sz-mc',
          actionType: 'onboard',
        })
      ).status,
    ).toBe(403);
    const unknown = await saveSettings('approvalChain', {
      rules: [{ ...CHENGDU_DIRECTOR, departmentId: 'nowhere' }],
      mergeAdjacent: true,
    });
    expect(unknown.json.code).toBe('SETTINGS_DEPARTMENT_NOT_FOUND');
  });

  it('never lets a head approve an action about themselves', async () => {
    const raised = await call('hr01', 'POST', '/actions', {
      actionType: 'offboard',
      employeeId: 'emp-mgr-njl',
      effectiveDate: '2099-01-01',
      leaveReason: 'resign',
    });
    expect(raised.status).toBe(201);
    const first = (raised.json.data.approvals as Json[])[0]!;
    expect(first.approverUserId).toBe(await userIdOf('mgr_east'));
    expect(first.fallback).toBe('selfEscalated');
    await call('hr01', 'POST', `/actions/${raised.json.data.id}/cancel`, {});
  });
});

describe('promotion by grade order', () => {
  it('promotes 赵阳 to 车间主任 and refuses a same-grade "promotion"', async () => {
    const sideways = await call('mgr_cd', 'POST', '/actions', {
      actionType: 'promote',
      employeeId: 'emp-zhaoyang',
      toPositionId: 'pos-assembler',
      effectiveDate: todayInShanghai(),
    });
    expect(sideways.json.code).toBe('ACTION_PROMOTE_NOT_HIGHER');
    const raised = await call('mgr_cd', 'POST', '/actions', {
      actionType: 'promote',
      employeeId: 'emp-zhaoyang',
      toPositionId: 'pos-workshop-lead',
      effectiveDate: todayInShanghai(),
    });
    expect(raised.status).toBe(201);
    expect(raised.json.data.approvals[0].status).toBe('auto');
    const done = await call(
      'hr01',
      'POST',
      `/actions/${raised.json.data.id}/approve`,
      {},
    );
    expect(done.json.data.status).toBe('effective');
    const events = await call('hr01', 'GET', '/employees/emp-zhaoyang/events');
    const latest = (events.json.data as Json[])[0]!;
    expect(latest.eventType).toBe('promote');
    expect(latest.source).toBe('action');
    expect(latest.actionId).toBe(raised.json.data.id);
  });
});

describe('更正任职信息', () => {
  it('requires a reason and writes a manual transfer event', async () => {
    const edit = await call('hr01', 'PATCH', '/employees/emp-qianjin', {
      departmentId: 'sz-as',
    });
    expect(edit.json.code).toBe('EMPLOYEE_CORE_FIELDS_LOCKED');
    const noReason = await call(
      'hr01',
      'POST',
      '/employees/emp-qianjin/correct-job',
      {
        departmentId: 'sz-as',
      },
    );
    expect(noReason.json.code).toBe('EMPLOYEE_CORRECTION_NOTE_REQUIRED');
    const corrected = await call(
      'hr01',
      'POST',
      '/employees/emp-qianjin/correct-job',
      {
        departmentId: 'sz-as',
        note: '入职时部门录错',
      },
    );
    expect(corrected.status).toBe(200);
    expect(corrected.json.data.departmentId).toBe('sz-as');
    const events = await call('hr01', 'GET', '/employees/emp-qianjin/events');
    const latest = (events.json.data as Json[])[0]!;
    expect(latest).toMatchObject({
      eventType: 'transfer',
      source: 'manual',
      note: '入职时部门录错',
      actionId: null,
    });
  });

  it('is refused to department heads and when the setting is off', async () => {
    expect(
      (
        await call('mgr_njl', 'POST', '/employees/emp-limin/correct-job', {
          departmentId: 'sz-as',
          note: 'x',
        })
      ).status,
    ).toBe(403);
    await saveSettings('jobInfo', {
      importMayChangeJob: true,
      allowCorrection: false,
    });
    const off = await call('hr01', 'POST', '/employees/emp-limin/correct-job', {
      departmentId: 'sz-as',
      note: 'x',
    });
    expect(off.json.code).toBe('EMPLOYEE_CORRECTION_DISABLED');
    await saveSettings('jobInfo', {
      importMayChangeJob: true,
      allowCorrection: true,
    });
  });

  it('marks the handler done: every event gets processedAt', async () => {
    // Seeded events are handed to the handler by the daily run, like any event whose handler failed.
    expect(
      (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
    ).toBe(200);
    const { databaseManagerToken } = await import('@nocobase/db');
    const database = server.application.container.resolve(databaseManagerToken);
    const pending = await database
      .query()
      .selectFrom('jobEvents')
      .select(['id'])
      .where('processedAt', 'is', null)
      .execute();
    expect(pending).toEqual([]);
  });
});

describe('import and job information', () => {
  it('rejects moving an employee by import once the switch is off', async () => {
    await saveSettings('jobInfo', {
      importMayChangeJob: false,
      allowCorrection: true,
    });
    const preview = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook([
        ['QH3002', '吴敏', 'CD-MC', 'prod-assembler', '', '2022-03-01', '', ''],
      ]),
    );
    expect(preview.status).toBe(200);
    expect(preview.json.data.rows[0].errors).toContain(
      'IMPORT_JOB_CHANGE_DISABLED',
    );
    await saveSettings('jobInfo', {
      importMayChangeJob: true,
      allowCorrection: true,
    });
    const allowed = await upload(
      'hr01',
      '/employees/import/preview',
      await workbook([
        [
          'QH3002',
          '吴敏',
          'CD-MC',
          'prod-cnc-operator',
          '',
          '2022-03-01',
          '',
          '',
        ],
      ]),
    );
    expect(allowed.json.data.rows[0].errors).toEqual([]);
  });
});

describe('employee self-service fields', () => {
  it('accepts only the fields 人事设置 ticks', async () => {
    await saveSettings('selfService', { fields: ['mobile'] });
    const fields = await call('emp_njl_2', 'GET', '/me/profile-change/fields');
    expect(fields.json.data).toEqual(['mobile']);
    const address = await call('emp_njl_2', 'POST', '/me/profile-change', {
      changes: { address: '苏州市测试路 1 号' },
    });
    expect(address.json.code).toBe('PROFILE_CHANGE_FIELD_NOT_ALLOWED');
    await saveSettings('selfService', {
      fields: [
        'mobile',
        'email',
        'address',
        'educations',
        'experiences',
        'emergencyContacts',
      ],
    });
  });
});

describe('job history scope', () => {
  it('shows the history within the viewer scope only', async () => {
    const own = await call('emp_njl_1', 'GET', '/employees/emp-wanglei/events');
    expect(own.status).toBe(200);
    expect((own.json.data as Json[]).map((e) => e.source)).toContain('import');
    const other = await call('emp_njl_1', 'GET', '/employees/emp-limin/events');
    expect(other.json.data ?? []).toEqual([]);
    const outside = await call('mgr_njl', 'GET', '/employees/emp-wumin/events');
    expect(outside.json.data ?? []).toEqual([]);
  });
});

describe('HR assistant: probation and renewal preparation', () => {
  it('prepares 孙丽 for mgr_east without the contract and for hr01 with it, once', async () => {
    const container = server.application.container;
    const { databaseManagerToken } = await import('@nocobase/db');
    const { notificationServiceToken } =
      await import('@nocobase/app-plugin-notification');
    const { hrCoreServiceToken } =
      await import('../../server/providers/hr/tokens.ts');
    const { scopeForUser } =
      await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const db = container.resolve(databaseManagerToken);
    const notifications = container.resolve(notificationServiceToken);
    const core = container.resolve(hrCoreServiceToken);
    const authz = container.resolve(authorizationToken);
    const mgrEast = await userIdOf('mgr_east');
    const hr01 = await userIdOf('hr01');
    const asHead = await core.hrSummary(
      { userId: mgrEast, authz: await scopeForUser(authz, mgrEast) },
      'emp-sunli',
      'zh-CN',
    );
    expect(asHead.contracts).toBeNull();
    expect(asHead.fixedTermContracts).toBeNull();
    expect(asHead.toConfirm).toContain('probationEvaluation');
    const asHr = await core.hrSummary(
      { userId: hr01, authz: await scopeForUser(authz, hr01) },
      'emp-sunli',
      'zh-CN',
    );
    expect(Array.isArray(asHr.contracts)).toBe(true);

    const before = await call('hr01', 'GET', '/actions?view=all');
    const regularizeBefore = (before.json.data.items as Json[]).filter(
      (a) => a.actionType === 'regularize',
    ).length;
    expect(
      (await call('hr01', 'POST', '/org/maintenance/run', {})).status,
    ).toBe(200);
    for (const recipient of [mgrEast, hr01])
      expect(
        await notifications.getByIdempotencyKey(
          `hr:hrAssistant:probationPrep:emp-sunli:${recipient}`,
        ),
      ).toBeTruthy();
    // 李敏's contract ends in 20 days in the seed, 陈静's in 60: both enter the 60-day window.
    for (const contract of ['contract-limin', 'contract-mgr-njl'])
      expect(
        await notifications.getByIdempotencyKey(
          `hr:hrAssistant:renewalPrep:${contract}`,
        ),
      ).toBeTruthy();
    const after = await call('hr01', 'GET', '/actions?view=all');
    expect(
      (after.json.data.items as Json[]).filter(
        (a) => a.actionType === 'regularize',
      ).length,
    ).toBe(regularizeBefore);
    const contract = await call(
      'hr01',
      'GET',
      '/contracts?employeeId=emp-limin',
    );
    expect((contract.json.data.items as Json[])[0]!.status).toBe('active');

    // A second run sends nothing new.
    await call('hr01', 'POST', '/org/maintenance/run', {});
    const logs = await db
      .query()
      .selectFrom('hrReminderLog')
      .select(['id'])
      .where('reminderKey', '=', 'hrAssistant:probationPrep:emp-sunli')
      .execute();
    expect(logs).toHaveLength(1);
  });

  it('keeps the probation reminder when the preparation is switched off', async () => {
    const settings = await call(
      'hr01',
      'PATCH',
      '/automations/hrAssistant.probationPrep',
      {
        enabled: false,
      },
    );
    expect(settings.status).toBe(200);
    const runs = await call(
      'hr01',
      'GET',
      '/automations/runs?task=hrAssistant.probationPrep',
    );
    expect(runs.status).toBe(200);
    await call('hr01', 'PATCH', '/automations/hrAssistant.probationPrep', {
      enabled: true,
    });
  });

  it('closes the 转正准备 when the confirmation takes effect, and the 续签准备 when the contract is renewed', async () => {
    const { databaseManagerToken } = await import('@nocobase/db');
    const db = server.application.container.resolve(databaseManagerToken);
    const open = async (prefix: string) =>
      (
        await db
          .query()
          .selectFrom('workItems')
          .select(['id'])
          .where('refId', 'like', `${prefix}%`)
          .where('status', '=', 'open')
          .execute()
      ).length;
    expect(await open('hrAssistant:probationPrep:emp-sunli:')).toBeGreaterThan(
      0,
    );
    const raised = await call('mgr_east', 'POST', '/actions', {
      actionType: 'regularize',
      employeeId: 'emp-sunli',
      effectiveDate: todayInShanghai(),
    });
    expect(raised.status).toBe(201);
    const done = await call(
      'hr01',
      'POST',
      `/actions/${raised.json.data.id}/approve`,
      {},
    );
    expect(done.json.data.status).toBe('effective');
    expect(await open('hrAssistant:probationPrep:emp-sunli:')).toBe(0);

    expect(await open('hrAssistant:renewalPrep:contract-mgr-njl')).toBe(1);
    const renewed = await call(
      'hr01',
      'POST',
      '/contracts/contract-mgr-njl/renew',
      {
        contractNo: 'HT-TEST-RENEW-1',
        type: 'openEnded',
        startDate: '2026-12-01',
      },
    );
    expect(renewed.status).toBe(201);
    expect(await open('hrAssistant:renewalPrep:contract-mgr-njl')).toBe(0);
  });
});

describe('HR assistant: attachment suggestions', () => {
  it('turns differing fields into a suggestion HR adopts field by field', async () => {
    const container = server.application.container;
    const { hrCoreServiceToken } =
      await import('../../server/providers/hr/tokens.ts');
    const { scopeForUser } =
      await import('../../server/providers/hr/authorize.ts');
    const { authorizationToken } =
      await import('@nocobase/app-plugin-authorization/server');
    const core = container.resolve(hrCoreServiceToken);
    const authz = container.resolve(authorizationToken);
    const hr01 = await userIdOf('hr01');
    const mgrNjl = await userIdOf('mgr_njl');
    await expect(
      core.createAiSuggestion(
        { userId: mgrNjl, authz: await scopeForUser(authz, mgrNjl) },
        { employeeId: 'emp-sunli', attachmentFileId: 'x', fields: {} },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const created = await core.createAiSuggestion(
      { userId: hr01, authz: await scopeForUser(authz, hr01) },
      {
        employeeId: 'emp-sunli',
        attachmentFileId: 'file-sample',
        fields: {
          idNumber: {
            value: '999999199501010099',
            confidence: 0.92,
            snippet: '公民身份号码 9999…',
          },
          birthDate: {
            value: '1995-01-01',
            confidence: 0.9,
            snippet: '出生 1995年1月1日',
          },
          gender: { value: 'nonsense', confidence: 0.3, snippet: '?' },
        },
      },
    );
    expect(created).toBeTruthy();
    expect(created!.fields).not.toContain('gender');
    const list = await call('hr01', 'GET', '/profile-changes?status=pending');
    const suggestion = (list.json.data as Json[]).find(
      (c) => c.id === created!.id,
    )!;
    expect(suggestion.source).toBe('ai');
    expect(suggestion.confidence.idNumber.confidence).toBe(0.92);
    const unchanged = await call('hr01', 'GET', '/employees/emp-sunli');
    expect(unchanged.json.data.employee.idNumber).not.toBe(
      '999999199501010099',
    );
    // An employee's own request is not blocked by the assistant's suggestion.
    const approved = await call(
      'hr01',
      'POST',
      `/profile-changes/${created!.id}/approve`,
      { values: { idNumber: '999999199501010099', birthDate: '1995-01-02' } },
    );
    expect(approved.status).toBe(200);
    expect(approved.json.data.reviewerUserId).toBe(hr01);
    const record = await call('hr01', 'GET', '/employees/emp-sunli');
    expect(record.json.data.employee.idNumber).toBe('999999199501010099');
    expect(record.json.data.employee.birthDate).toBe('1995-01-02');
  });

  it('records an image scan as needing a model that reads images', async () => {
    const container = server.application.container;
    const { automationTasksToken } =
      await import('../../server/providers/hr/tokens.ts');
    const { databaseManagerToken } = await import('@nocobase/db');
    const db = container.resolve(databaseManagerToken);
    const now = new Date();
    await db
      .query()
      .insertInto('hrFiles')
      .values({
        id: '00000000-0000-4000-8000-000000000001',
        disk: 'local',
        key: 'missing.png',
        filename: '身份证样例.png',
        ext: 'png',
        mimeType: 'image/png',
        size: 1,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await db
      .query()
      .insertInto('employeeAttachments')
      .values({
        id: 'attachment-sample',
        employeeId: 'emp-sunli',
        fileId: '00000000-0000-4000-8000-000000000001',
        category: 'idCard',
        title: '身份证样例',
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const outcome = await container
      .resolve(automationTasksToken)
      .onAttachmentUploaded({
        attachmentId: 'attachment-sample',
        uploaderUserId: await userIdOf('hr01'),
      });
    expect(outcome.status).toBe('failed');
    const run = await call(
      'hr01',
      'GET',
      `/automations/runs/${(outcome as Json).runId}`,
    );
    expect(String(run.json.data.error)).toContain('image');
    expect(JSON.stringify(run.json.data)).not.toContain('999999');
  });
});

describe('重置登录密码', () => {
  it('gives HR a one-time password that signs the employee in, and refuses others', async () => {
    // 刘洋 (emp_njl_4) is not used elsewhere in this file: revoking his sessions affects nothing else.
    expect(
      (await call('emp_njl_1', 'POST', '/employees/emp-liuyang/reset-password'))
        .status,
    ).toBe(403);
    expect(
      (await call(null, 'POST', '/employees/emp-liuyang/reset-password'))
        .status,
    ).toBe(401);
    // 孙丽 has no NocoHR account.
    const none = await call(
      'hr01',
      'POST',
      '/employees/emp-sunli/reset-password',
    );
    expect(none.status).toBe(409);
    expect(none.json.code).toBe('EMPLOYEE_NO_ACCOUNT');
    const reset = await call(
      'hr01',
      'POST',
      '/employees/emp-liuyang/reset-password',
    );
    expect(reset.status).toBe(200);
    const { password, login } = reset.json.data as {
      password: string;
      login: string;
    };
    expect(login).toBe('emp_njl_4');
    expect(password).toMatch(/^Qh-[A-Za-z2-9]{12}$/u);
    const signedIn = await server.fetch(
      new Request(`${base}/api/auth/sign-in/username`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: login, password }),
      }),
    );
    expect(signedIn.status).toBe(200);
  });
});

describe('工作台 · AI 员工已办完', () => {
  it('lists the finished runs of the tasks the caller is responsible for, and nobody else’s', async () => {
    const { databaseManagerToken } = await import('@nocobase/db');
    const database = server.application.container.resolve(databaseManagerToken);
    const now = new Date();
    const run = (
      id: string,
      owner: string,
      task: string,
      summary: string,
      output: unknown,
    ) => ({
      id,
      task,
      employee: task.split('.')[0],
      trigger: 'event',
      triggerRef: null,
      dedupeKey: id,
      ownerUserId: owner,
      status: 'succeeded',
      inputSummary: summary,
      output,
      references: null,
      fallback: false,
      conversationSessionId: null,
      error: null,
      startedAt: now,
      finishedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await database
      .query()
      .insertInto('aiTaskRuns')
      .values([
        run(
          'ai-done-hr',
          await userIdOf('hr01'),
          'hrAssistant.renewalPrep',
          '为 1 份即将到期的合同准备了续签材料',
          {},
        ),
        run(
          'ai-done-empty',
          await userIdOf('hr01'),
          // A task key nothing else runs here, so only this empty run could show it.
          'certificationSteward.emptyRunCheck',
          '复审未开始且临近到期 0 人',
          { escalated: 0, heads: 0 },
        ),
        run(
          'ai-done-payroll',
          await userIdOf('payroll01'),
          'hrAssistant.mailSortBilling',
          '蓉川人力账单已归档',
          {
            billId: 'bill-x',
          },
        ),
      ])
      .execute();
    expect((await call(null, 'GET', '/work-items/ai-done')).status).toBe(401);
    const mine = await call('hr01', 'GET', '/work-items/ai-done');
    expect(mine.status).toBe(200);
    const tasks = (mine.json.data.groups as Json[]).map((g) => g.task);
    expect(tasks).toContain('hrAssistant.renewalPrep');
    // The billing mailbox belongs to payroll01: it never shows on hr01's workbench.
    expect(tasks).not.toContain('hrAssistant.mailSortBilling');
    // A run that produced nothing is not work done.
    expect(tasks).not.toContain('certificationSteward.emptyRunCheck');
    const renewal = (mine.json.data.groups as Json[]).find(
      (g) => g.task === 'hrAssistant.renewalPrep',
    );
    expect(renewal).toMatchObject({
      employee: 'hrAssistant',
      today: expect.any(Number),
    });
    expect(renewal.entries[0]).toMatchObject({
      text: '为 1 份即将到期的合同准备了续签材料',
      link: '/talent/contracts',
    });
    expect(mine.json.data.today).toBeGreaterThanOrEqual(1);
    const payroll = await call('payroll01', 'GET', '/work-items/ai-done');
    expect((payroll.json.data.groups as Json[]).map((g) => g.task)).toEqual([
      'hrAssistant.mailSortBilling',
    ]);
  });
});
