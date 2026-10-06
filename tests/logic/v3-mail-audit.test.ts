// @vitest-environment node

// Acceptance checks for V3-11 客户审核问询: 远航汽车's request in the audit mailbox becomes an audit request draft
// (customer, scope, material, due date, what is not provided, the pre-audit risks); qa_audit confirms the scope and
// builds the pack; the drafted reply names the material and never the risks or a link; sending it creates the share
// link, which opens only with a one-time code sent to the requester and is logged; a revoked link opens nothing.
// mgr_njl sees neither the mailbox nor the requests. The real standalone server runs on a throwaway SQLite database.
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as XLSX from 'xlsx';

import { composeMail } from '../../database/seed-data/demo-mail.ts';
import { pdfText } from '../../server/providers/hr/profile/pdf.ts';
import {
  addWorkdays,
  readAuditRequest,
  SHARE_LINK_PLACEHOLDER,
} from '../../server/providers/hr/mail/audit.ts';
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
      ) {
        return next(`${specifier.slice(0, -3)}.ts`, context);
      }
      throw error;
    }
  },
});

process.env.AUTH_SECRET ??= 'test-auth-secret-at-least-32-characters';
// A test-only value for the demo seed; never a real credential.
const PASSWORD = 'v3-mail-audit-test-password';

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
  if (method !== 'GET') headers.origin = 'http://localhost';
  const response = await server.fetch(
    new Request(`${base}/api/talent${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const text = await response.text();
  return {
    status: response.status,
    json: text ? (JSON.parse(text) as Json) : {},
  };
}

const inbox = () =>
  path.join(
    directory,
    'storage',
    'mail',
    'local',
    'audit@qiheng.test',
    'inbox',
  );
const outbox = () => path.join(directory, 'storage', 'mail', 'outbox');

function drop(name: string, eml: string) {
  mkdirSync(inbox(), { recursive: true });
  writeFileSync(path.join(inbox(), name), eml);
}

/**
 * Mail sent to an address, as written to the outbox. Sending goes through the
 * Mail plugin's outbox job: with `atLeast`, wait for that many; without it,
 * give the job a moment and answer what is there (to check nothing went out).
 */
async function sentTo(address: string, atLeast = 0): Promise<string[]> {
  const read = () => {
    let names: string[];
    try {
      names = readdirSync(outbox()).sort();
    } catch {
      return [];
    }
    return names
      .map((n) => readFileSync(path.join(outbox(), n), 'utf8'))
      .filter((text) => text.includes(`To: ${address}`));
  };
  if (!atLeast) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return read();
  }
  for (let i = 0; i < 100; i++) {
    const found = read();
    if (found.length >= atLeast) return found;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return read();
}

async function pub(
  method: string,
  url: string,
  body?: unknown,
): Promise<{ status: number; json: Json; type: string }> {
  const response = await server.fetch(
    new Request(`${base}/api/public/audit-pack${url}`, {
      method,
      headers:
        body === undefined
          ? {}
          : { 'content-type': 'application/json', origin: 'http://localhost' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
  const type = response.headers.get('content-type') ?? '';
  const text = type.includes('json') ? await response.text() : '';
  if (!type.includes('json')) await response.arrayBuffer();
  return { status: response.status, json: text ? JSON.parse(text) : {}, type };
}

const REQUESTER = 'sqe@yuanhang-auto.test';

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v3-mail-audit-'));
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

describe('审核邮箱 rules', () => {
  it('reads material, refused items and the due date', () => {
    const read = readAuditRequest(
      '请在 3 个工作日内提供 CNC 操作工的持证清单与近 12 个月的培训记录，并提供操作工的联系方式。',
      '2026-10-09',
    );
    expect(read.materials).toEqual(['certificates', 'trainingRecords']);
    expect(read.excluded).toEqual(['联系方式']);
    // Friday + 3 working days is Wednesday.
    expect(read.dueDate).toBe('2026-10-14');
    expect(addWorkdays('2026-10-09', 1)).toBe('2026-10-12');
    expect(
      readAuditRequest('请于10月20日前提供台账', '2026-10-09').dueDate,
    ).toBe('2026-10-20');
  });
});

describe('审核邮箱 (V3-11)', () => {
  let requestId: string;
  let token: string;

  it('turns 远航汽车’s request into an audit request draft with the risks', async () => {
    drop(
      '01-yuanhang.eml',
      composeMail({
        from: { name: '远航汽车 供应商质量 何嘉', address: REQUESTER },
        to: 'audit@qiheng.test',
        subject: '供应商过程审核资料请求（CNC 操作工）',
        text: '启衡精密人力资源部：\n\n你好！我司计划下周对贵司进行供应商过程审核。请在 3 个工作日内提供苏州和成都机加工车间 CNC 操作工的持证清单与近 12 个月的培训记录。\n另请一并提供上述操作工的联系方式。\n\n远航汽车 供应商质量工程师 何嘉',
        date: new Date(),
      }),
    );
    const polled = await call('hr01', 'POST', '/mail/poll?mailbox=audit');
    expect(polled.status).toBe(200);
    expect(polled.json.data.audit).toBe(1);
    const list = await call('qa_audit', 'GET', '/audit-requests');
    expect(list.status).toBe(200);
    expect(list.json.data).toHaveLength(1);
    const request = list.json.data[0] as Json;
    requestId = request.id;
    expect(request).toMatchObject({
      customerName: '远航汽车',
      requesterAddress: REQUESTER,
      status: 'draft',
      reviewStatus: 'draft',
      excludedRequests: ['联系方式'],
    });
    expect([...request.scope.departmentIds].sort()).toEqual(['cd-mc', 'sz-mc']);
    expect(request.scope.positionIds).toEqual(['pos-cnc-operator']);
    expect(request.scope.materials).toEqual([
      'certificates',
      'trainingRecords',
    ]);
    expect(request.dueDate > new Date().toISOString().slice(0, 10)).toBe(true);
    const names = (request.risks as Json[]).map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['钱进', '刘洋', '吴敏']));
    const mail = await call(
      'qa_audit',
      'GET',
      `/mail/by-record/auditRequest/${requestId}?mailbox=audit`,
    );
    expect(mail.json.data[0].aiSummary).toContain('联系方式，不在提供范围内');
  });

  it('keeps the mailbox and the requests from mgr_njl and anonymous callers', async () => {
    expect((await call('mgr_njl', 'GET', '/audit-requests')).status).toBe(403);
    const boxes = await call('mgr_njl', 'GET', '/mail/mailboxes');
    expect((boxes.json.data as Json[]).map((m) => m.purpose)).not.toContain(
      'audit',
    );
    expect((await call(null, 'GET', '/audit-requests')).status).toBe(401);
  });

  it('builds the pack only after the scope is confirmed, and drafts a reply without risks or links', async () => {
    expect(
      (await call('qa_audit', 'POST', `/audit-requests/${requestId}/pack`))
        .status,
    ).toBe(409);
    const confirmed = await call(
      'qa_audit',
      'POST',
      `/audit-requests/${requestId}/confirm`,
    );
    expect(confirmed.json.data).toMatchObject({
      status: 'confirmed',
      reviewStatus: 'confirmed',
    });
    const built = await call(
      'qa_audit',
      'POST',
      `/audit-requests/${requestId}/pack`,
    );
    expect(built.status).toBe(200);
    expect(built.json.data.status).toBe('packReady');
    // 审核包只含 scope 内的资料: certificates and training records were asked for, nothing else.
    const zipped = await server.fetch(
      new Request(`${base}/api/talent/audit-requests/${requestId}/pack`, {
        headers: { cookie: await signIn('qa_audit') },
      }),
    );
    expect(zipped.status).toBe(200);
    const zip = XLSX.CFB.read(new Uint8Array(await zipped.arrayBuffer()), {
      type: 'array',
    });
    const entry = (name: string) =>
      XLSX.CFB.find(zip, name)?.content as Uint8Array | undefined;
    const workbook = XLSX.read(entry('/audit-pack.xlsx')!, { type: 'array' });
    expect(workbook.SheetNames).toEqual([
      '培训与考试记录',
      '证书及有效期',
      '过期与吊销处理',
    ]);
    expect(pdfText(entry('/cover.pdf')!)).toContain(
      'audit-pack.xlsx：培训与考试记录、证书及有效期、过期与吊销处理。',
    );
    const thread = (
      await call(
        'qa_audit',
        'GET',
        `/mail/by-record/auditRequest/${requestId}?mailbox=audit`,
      )
    ).json.data as Json[];
    const draft = thread.find((m) => m.status === 'draft')!;
    expect(draft.to).toEqual([REQUESTER]);
    expect(draft.bodyText).toContain(SHARE_LINK_PLACEHOLDER);
    expect(draft.bodyText).toContain('联系方式不在提供范围内');
    expect(draft.bodyText).toContain('验证码');
    expect(draft.bodyText).not.toMatch(/钱进|刘洋|吴敏|https?:/u);
    expect(draft.attachments).toEqual([]);

    // A link a person adds to the draft is refused; only the server's link leaves.
    const original = draft.bodyText as string;
    await call('qa_audit', 'PATCH', `/mail/messages/${draft.id}`, {
      body: `${original}\nhttp://files.example.test/all.zip`,
    });
    expect(
      (await call('qa_audit', 'POST', `/mail/messages/${draft.id}/send`))
        .status,
    ).toBe(400);
    await call('qa_audit', 'PATCH', `/mail/messages/${draft.id}`, {
      body: original,
    });
    expect(
      (await call('qa_audit', 'POST', `/mail/messages/${draft.id}/send`))
        .status,
    ).toBe(200);
    const sent = await sentTo(REQUESTER, 1);
    expect(sent).toHaveLength(1);
    const link = /\/audit-pack\/([A-Za-z0-9_-]{20,})/u.exec(sent[0]!);
    expect(link).toBeTruthy();
    token = link![1]!;
    expect(sent[0]).not.toContain('Content-Disposition: attachment');
    // The thread keeps the reply without the link.
    const after = (
      await call(
        'qa_audit',
        'GET',
        `/mail/by-record/auditRequest/${requestId}?mailbox=audit`,
      )
    ).json.data as Json[];
    expect(JSON.stringify(after)).not.toContain(token);
    expect(
      (await call('qa_audit', 'GET', `/audit-requests/${requestId}`)).json.data
        .status,
    ).toBe('replied');
  });

  it('opens the pack only with the code sent to the requester, and logs the download', async () => {
    const view = await pub('GET', `/${token}`);
    expect(view.status).toBe(200);
    expect(view.json.data.customerName).toBe('远航汽车');
    expect(JSON.stringify(view.json.data)).not.toContain(REQUESTER);
    expect(
      (await pub('POST', `/${token}/download`, { code: '000000' })).status,
    ).toBe(400);
    expect((await pub('POST', `/${token}/code`, {})).status).toBe(200);
    const codeMail = (await sentTo(REQUESTER, 2)).find((m) =>
      /验证码：\d{6}/u.test(m),
    )!;
    expect(codeMail).toBeTruthy();
    const code = /验证码：(\d{6})/u.exec(codeMail)![1]!;
    // The thread never keeps the code itself.
    const thread = await call(
      'qa_audit',
      'GET',
      `/mail/by-record/auditRequest/${requestId}?mailbox=audit`,
    );
    expect(JSON.stringify(thread.json.data)).not.toContain(code);
    const download = await pub('POST', `/${token}/download`, { code });
    expect(download.status).toBe(200);
    expect(download.type).toContain('zip');
    // The code is used up.
    expect((await pub('POST', `/${token}/download`, { code })).status).toBe(
      400,
    );
    const request = (
      await call('qa_audit', 'GET', `/audit-requests/${requestId}`)
    ).json.data;
    expect(request.downloads).toHaveLength(1);
    const log = await call('qa_audit', 'GET', '/audit/log');
    expect(
      (log.json.data as Json[]).some((l) => l.kind === 'auditPackShare'),
    ).toBe(true);
  });

  it('opens nothing once the link is revoked', async () => {
    expect(
      (await call('mgr_njl', 'POST', `/audit-requests/${requestId}/revoke`))
        .status,
    ).toBe(403);
    const revoked = await call(
      'qa_audit',
      'POST',
      `/audit-requests/${requestId}/revoke`,
    );
    expect(revoked.json.data.share.active).toBe(false);
    expect((await pub('GET', `/${token}`)).status).toBe(404);
    expect((await pub('POST', `/${token}/code`, {})).status).toBe(404);
  });
});
