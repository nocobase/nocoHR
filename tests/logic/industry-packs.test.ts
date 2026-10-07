// @vitest-environment node

// 行业内容包 (server/providers/hr/industry-packs/): the registry of the manufacturing pack, turning a pack on and off
// (its pages leave what certificates allow, its endpoints answer INDUSTRY_PACK_DISABLED, its kinds leave the trace,
// the export and the steward's tools; nothing is deleted and turning it on restores it, recreating a missing
// permission set without touching an existing one), the settings endpoints' authorization, and the seeds that
// decide the pack for the demo and for an existing installation. Boots the real standalone server on a throwaway
// SQLite database with migrations and seeds (demo data on).
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { databaseManagerToken, type DatabaseManager } from '@nocobase/db';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';

import { traceBatchSignoffs } from '../../server/ai/tools/exam-tools.ts';
import { traceStartLogs } from '../../server/ai/tools/licensed-tools.ts';
import {
  CNC_OPERATOR_SET,
  FORKLIFT_OPERATOR_SET,
  manufacturingPack,
} from '../../server/providers/hr/industry-packs/manufacturing.ts';
import {
  INDUSTRY_PACKS,
  operationByKind,
  operationByPage,
  operationsByPermissionSet,
  packByKey,
} from '../../server/providers/hr/industry-packs/registry.ts';
import { readIndustryPacks } from '../../server/providers/hr/industry-packs/service.ts';
import {
  demoBatchServiceToken,
  industryPackServiceToken,
  licensedServicesToken,
} from '../../server/providers/hr/tokens.ts';
import {
  createStandaloneServer,
  type StandaloneServer,
} from '../../server/standalone.ts';

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
const PASSWORD = 'industry-packs-test-password';

type Json = Record<string, any>;

let server: StandaloneServer;
let directory: string;
let base: string;
const cookies = new Map<string, string>();

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-industry-packs-'));
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
  // The payroll demo pre-builds a locked month these checks do not need.
  process.env.HR_PAYROLL_DEMO = 'false';
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
  // The boot-time protection and history baseline run in the background.
  await new Promise((resolve) => setTimeout(resolve, 300));
  await licensed().start();
}, 240_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  delete process.env.HR_PAYROLL_DEMO;
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
  expect(response.status).toBe(200);
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
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers: Record<string, string> = { ...extra };
  if (username) headers.cookie = await signIn(username);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET') headers.origin = 'http://localhost';
  return server.fetch(
    new Request(
      `${base}${url.startsWith('/api/') ? url : `/api/talent${url}`}`,
      {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      },
    ),
  );
}

async function call(
  username: string | null,
  method: string,
  url: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const response = await raw(username, method, url, body, extra);
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

const db = (): DatabaseManager =>
  server.application.container.resolve(databaseManagerToken);
const licensed = () =>
  server.application.container.resolve(licensedServicesToken);
const authz = () => server.application.container.resolve(authorizationToken);

async function userIdOf(username: string): Promise<string> {
  const row = await db()
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirst();
  return String(row!.id);
}

const packs = () =>
  server.application.container.resolve(industryPackServiceToken);

const setPack = (enabled: boolean, username = 'hr01') =>
  call(username, 'PUT', '/licensed/industry-packs/manufacturing', {
    enabled,
  });

async function tool(
  definition: { invoke: unknown },
  username: string,
  args: Json,
): Promise<Json> {
  const invoke = definition.invoke as (c: unknown, a: unknown) => Promise<Json>;
  return invoke(
    {
      actor: { id: await userIdOf(username) },
      deps: {
        demoBatch: server.application.container.resolve(demoBatchServiceToken),
        industryPacks: packs(),
        authz: authz(),
      },
    },
    args,
  );
}

async function packRow(): Promise<Json | undefined> {
  const row = await db()
    .query()
    .selectFrom('personnelSettings')
    .selectAll()
    .where('id', '=', 'industryPacks')
    .executeTakeFirst();
  return row as Json | undefined;
}

describe('the registry', () => {
  it('maps the manufacturing pack’s pages, kinds and permission sets to each other', () => {
    expect(INDUSTRY_PACKS.map((p) => p.key)).toEqual(['manufacturing']);
    expect(packByKey('manufacturing')).toBe(manufacturingPack);
    expect(packByKey('hospital')).toBeUndefined();
    expect(operationByPage('demo.batchRecord')).toMatchObject({
      pack: 'manufacturing',
      kind: 'machineStart',
      path: '/demo/batch-record',
      resource: 'demo.batch',
      action: 'signFilling',
      permissionSet: CNC_OPERATOR_SET,
    });
    expect(operationByKind('forkliftDispatch')).toMatchObject({
      page: 'demo.forkliftDispatch',
      path: '/demo/forklift-dispatch',
      resource: 'demo.forklift',
      action: 'dispatch',
      permissionSet: FORKLIFT_OPERATOR_SET,
    });
    expect(
      operationsByPermissionSet(CNC_OPERATOR_SET).map((op) => op.kind),
    ).toEqual(['machineStart']);
    // Each set's definition grants its own page and operation.
    for (const op of manufacturingPack.operations) {
      const set = op.permissionSetDefinition();
      expect(set.key).toBe(op.permissionSet);
      expect(set.grants).toContainEqual(
        expect.objectContaining({
          resource: { type: 'page', id: op.page },
        }),
      );
      const composite = set.grants.find(
        (g) => g.resource.type === 'composite' && g.resource.id === op.resource,
      );
      expect(composite?.actions.map((a) => a.action)).toContain(op.action);
    }
  });
});

describe('设置 / 持证上岗 · 行业内容包', () => {
  it('lists the packs to HR administrators only, with the demo’s manufacturing pack on', async () => {
    expect((await call(null, 'GET', '/licensed/industry-packs')).status).toBe(
      401,
    );
    expect(
      (
        await call(null, 'PUT', '/licensed/industry-packs/manufacturing', {
          enabled: false,
        })
      ).status,
    ).toBe(401);
    for (const username of ['emp_njl_1', 'mgr_njl']) {
      expect(
        (await call(username, 'GET', '/licensed/industry-packs')).status,
      ).toBe(403);
      expect((await setPack(false, username)).status).toBe(403);
    }
    const list = await call('hr01', 'GET', '/licensed/industry-packs');
    expect(list.status).toBe(200);
    const [pack] = list.json.data.packs as Json[];
    expect(pack).toMatchObject({
      key: 'manufacturing',
      title: '制造业',
      enabled: true,
    });
    const machine = (pack.operations as Json[]).find(
      (op) => op.kind === 'machineStart',
    )!;
    expect(machine).toMatchObject({
      title: '设备开工登记',
      path: '/demo/batch-record',
      permissionSet: CNC_OPERATOR_SET,
      permissionSetExists: true,
    });
    expect(machine.certifications).toContainEqual(
      expect.objectContaining({ id: 'cert-cnc' }),
    );
    // English titles follow the request's language.
    const english = await call(
      'hr01',
      'GET',
      '/licensed/industry-packs',
      undefined,
      { 'accept-language': 'en-US' },
    );
    expect(english.json.data.packs[0].title).toBe('Manufacturing');
  });

  it('answers 404 for a pack that does not exist, and 400 for a malformed body', async () => {
    const unknown = await call('hr01', 'PUT', '/licensed/industry-packs/x', {
      enabled: true,
    });
    expect(unknown.status).toBe(404);
    expect(unknown.json.code).toBe('INDUSTRY_PACK_NOT_FOUND');
    expect(
      (
        await call('hr01', 'PUT', '/licensed/industry-packs/manufacturing', {
          enabled: 'yes',
        })
      ).status,
    ).toBe(400);
  });
});

describe('turning the manufacturing pack off and on', () => {
  it('hides its pages, stops its endpoints, trace, export and tools, and restores them all', async () => {
    // 李敏 gets a valid CNC 岗位上岗证 (the step's acceptance data).
    expect(
      (await call('hr01', 'POST', '/licensed/demo/prepare', {})).status,
    ).toBe(200);
    const mine = await call('emp_njl_2', 'GET', '/licensed/my-grants');
    expect(mine.json.data.items).toContainEqual(
      expect.objectContaining({
        certificationId: 'cert-cnc',
        pages: ['demo.batchRecord'],
        pageLinks: [
          {
            id: 'demo.batchRecord',
            title: '设备开工登记',
            path: '/demo/batch-record',
          },
        ],
      }),
    );
    const detail = await call('emp_njl_2', 'GET', '/certifications/cert-cnc');
    expect(detail.json.data.grantedPageLinks).toEqual([
      {
        id: 'demo.batchRecord',
        title: '设备开工登记',
        path: '/demo/batch-record',
      },
    ]);
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/batch-record')).status,
    ).toBe(200);
    const optionsOn = await call('qa_audit', 'GET', '/licensed/audit/options');
    expect(optionsOn.json.data.startTraceAvailable).toBe(true);
    expect(optionsOn.json.data.startTraceSample).toMatch(/^(MO|CK)-/u);

    const off = await setPack(false);
    expect(off.status).toBe(200);
    expect(off.json.data.packs[0].enabled).toBe(false);
    expect(
      (await readIndustryPacks(db().query())).history.at(-1),
    ).toMatchObject({ pack: 'manufacturing', enabled: false });

    // What certificates allow leaves out the pack's sets and pages.
    expect(
      (await licensed().certificationGrants('cert-cnc')).map((g) => g.key),
    ).not.toContain(CNC_OPERATOR_SET);
    expect(await licensed().operationsOf('cert-forklift')).toEqual([]);
    const mineOff = await call('emp_njl_2', 'GET', '/licensed/my-grants');
    expect(
      (mineOff.json.data.items as Json[]).filter(
        (item) => item.certificationId === 'cert-cnc',
      ),
    ).toEqual([]);
    const detailOff = await call(
      'emp_njl_2',
      'GET',
      '/certifications/cert-cnc',
    );
    expect(detailOff.json.data.grantedPages).toEqual([]);
    expect(detailOff.json.data.grantedPageLinks).toEqual([]);

    // Its endpoints refuse before anything else, even for the holder.
    for (const [method, url] of [
      ['GET', '/api/demo/batch-record'],
      ['POST', '/api/demo/batch-record/sign-filling'],
      ['GET', '/api/demo/forklift-dispatch'],
      ['POST', '/api/demo/forklift-dispatch/dispatch'],
    ] as const) {
      const refused = await call(
        'emp_njl_2',
        method,
        url,
        method === 'POST' ? {} : undefined,
      );
      expect({ url, status: refused.status, code: refused.json.code }).toEqual({
        url,
        status: 404,
        code: 'INDUSTRY_PACK_DISABLED',
      });
    }

    // Nothing to trace or export, and the tools say so.
    const optionsOff = await call('qa_audit', 'GET', '/licensed/audit/options');
    expect(optionsOff.json.data).toEqual({
      startTraceAvailable: false,
      startTraceSample: null,
    });
    const trace = await call(
      'qa_audit',
      'GET',
      '/licensed/audit/start-trace?workOrderNo=MO-24031',
    );
    expect(trace.status).toBe(404);
    expect(trace.json.code).toBe('INDUSTRY_PACK_DISABLED');
    const logs = await tool(traceStartLogs, 'hr01', {
      workOrderNo: 'MO-24031',
    });
    expect(logs.content).toMatchObject({ packDisabled: true, logs: [] });
    const signoffs = await tool(traceBatchSignoffs, 'hr01', {
      batchNo: 'MO-24031',
    });
    expect(signoffs.content).toMatchObject({ packDisabled: true });
    const demo = server.application.container.resolve(demoBatchServiceToken);
    expect(await demo.traceWithin(new Set(['emp-wumin']), 'MO-24031')).toEqual(
      [],
    );

    // Nothing was deleted: the sets, their assignments and the records stay.
    expect(await authz().permissionSets.get(CNC_OPERATOR_SET)).toBeDefined();
    expect(
      (await authz().permissionSets.listAssignments(CNC_OPERATOR_SET)).length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db()
          .query()
          .selectFrom('demoBatchSignoffs')
          .select(['id'])
          .execute()
      ).length,
    ).toBeGreaterThan(0);

    // Turning it on restores everything.
    const on = await setPack(true);
    expect(on.status).toBe(200);
    expect(on.json.data.created).toEqual([]);
    expect(
      (await call('emp_njl_2', 'GET', '/api/demo/batch-record')).status,
    ).toBe(200);
    expect(
      (await call('emp_njl_2', 'GET', '/licensed/my-grants')).json.data.items,
    ).toContainEqual(
      expect.objectContaining({
        certificationId: 'cert-cnc',
        pageLinks: [expect.objectContaining({ path: '/demo/batch-record' })],
      }),
    );
    const back = await tool(traceStartLogs, 'hr01', {
      workOrderNo: 'MO-24031',
      operationNo: '20',
    });
    expect(back.content.packDisabled).toBeUndefined();
    expect((back.content.logs as Json[]).length).toBeGreaterThan(0);
    expect(
      (await call('qa_audit', 'GET', '/licensed/audit/options')).json.data
        .startTraceAvailable,
    ).toBe(true);
  });

  it('recreates a missing permission set when turned on, and leaves an existing one alone', async () => {
    const original = await db()
      .query()
      .selectFrom('authorizationPermissionSets')
      .selectAll()
      .where('key', '=', CNC_OPERATOR_SET)
      .executeTakeFirstOrThrow();
    const assignments = await db()
      .query()
      .selectFrom('authorizationPermissionSetAssignments')
      .selectAll()
      .where('permissionSetKey', '=', CNC_OPERATOR_SET)
      .execute();
    const forklift = await authz().permissionSets.get(FORKLIFT_OPERATOR_SET);
    expect((await setPack(false)).status).toBe(200);
    await db()
      .query()
      .deleteFrom('authorizationPermissionSetAssignments')
      .where('permissionSetKey', '=', CNC_OPERATOR_SET)
      .execute();
    await db()
      .query()
      .deleteFrom('authorizationPermissionSets')
      .where('key', '=', CNC_OPERATOR_SET)
      .execute();
    // An administrator's edit of the other set.
    await authz().permissionSets.update(FORKLIFT_OPERATOR_SET, {
      key: FORKLIFT_OPERATOR_SET,
      title: '叉车出库（本厂）',
      grants: forklift!.grants,
    });

    const on = await setPack(true);
    expect(on.status).toBe(200);
    expect(on.json.data.created).toEqual([CNC_OPERATOR_SET]);
    const recreated = await authz().permissionSets.get(CNC_OPERATOR_SET);
    expect(recreated?.grants).toContainEqual(
      expect.objectContaining({
        resource: { type: 'page', id: 'demo.batchRecord' },
      }),
    );
    const machine = (on.json.data.packs[0].operations as Json[]).find(
      (op) => op.kind === 'machineStart',
    )!;
    expect(machine).toMatchObject({
      permissionSetExists: true,
      certifications: [],
    });
    expect(
      (await authz().permissionSets.get(FORKLIFT_OPERATOR_SET))?.title,
    ).toBe('叉车出库（本厂）');

    // Restore the demo's sets.
    await authz().permissionSets.update(FORKLIFT_OPERATOR_SET, {
      key: FORKLIFT_OPERATOR_SET,
      title: forklift!.title,
      grants: forklift!.grants,
    });
    await db()
      .query()
      .deleteFrom('authorizationPermissionSets')
      .where('key', '=', CNC_OPERATOR_SET)
      .execute();
    await db()
      .query()
      .insertInto('authorizationPermissionSets')
      .values(original)
      .execute();
    if (assignments.length)
      await db()
        .query()
        .insertInto('authorizationPermissionSetAssignments')
        .values(assignments)
        .execute();
  });
});

describe('the seeds deciding the pack', () => {
  type Run = (context: { query: unknown }) => Promise<void>;
  const runSeed = async (file: string) => {
    const seed = (await import(`../../database/main/seeds/${file}.ts`))
      .default as { run: Run };
    await seed.run({ query: db().query() });
  };
  const IN_USE = '202610230101_industry_pack_in_use';
  const DEMO = '202610230102_demo_industry_pack';
  const dropRow = () =>
    db()
      .query()
      .deleteFrom('personnelSettings')
      .where('id', '=', 'industryPacks')
      .execute();
  const enabled = async () => (await readIndustryPacks(db().query())).enabled;

  it('keeps the pack on where one of its sets is in use, and writes nothing otherwise', async () => {
    const saved = await packRow();
    await dropRow();
    await runSeed(IN_USE);
    expect(await enabled()).toEqual(['manufacturing']);

    await dropRow();
    const assignments = await db()
      .query()
      .selectFrom('authorizationPermissionSetAssignments')
      .selectAll()
      .where('permissionSetKey', 'in', [
        CNC_OPERATOR_SET,
        FORKLIFT_OPERATOR_SET,
      ])
      .execute();
    await db()
      .query()
      .deleteFrom('authorizationPermissionSetAssignments')
      .where('permissionSetKey', 'in', [
        CNC_OPERATOR_SET,
        FORKLIFT_OPERATOR_SET,
      ])
      .execute();
    try {
      await runSeed(IN_USE);
      expect(await packRow()).toBeUndefined();
      expect(await enabled()).toEqual([]);
    } finally {
      if (assignments.length)
        await db()
          .query()
          .insertInto('authorizationPermissionSetAssignments')
          .values(assignments)
          .execute();
    }

    // The demo turns it on when nothing was chosen.
    await runSeed(DEMO);
    expect(await enabled()).toEqual(['manufacturing']);

    // A saved choice is never replaced, by either seed.
    await db()
      .query()
      .updateTable('personnelSettings')
      .set({ value: JSON.stringify({ enabled: [] }) })
      .where('id', '=', 'industryPacks')
      .execute();
    await runSeed(IN_USE);
    await runSeed(DEMO);
    expect(await enabled()).toEqual([]);

    await dropRow();
    if (saved)
      await db()
        .query()
        .insertInto('personnelSettings')
        .values(saved)
        .execute();
  });

  it('leaves the demo seed out of production', async () => {
    const saved = await packRow();
    await dropRow();
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await runSeed(DEMO);
    } finally {
      process.env.NODE_ENV = env;
    }
    expect(await packRow()).toBeUndefined();
    if (saved)
      await db()
        .query()
        .insertInto('personnelSettings')
        .values(saved)
        .execute();
  });
});
