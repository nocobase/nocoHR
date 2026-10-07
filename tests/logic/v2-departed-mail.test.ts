// @vitest-environment node

// Acceptance checks for V1-02 V2 增补 · 已离职员工的邮件往来: hr01 confirms the separation certificate template;
// 邓凯's 离职单 carries his personal email, and when it takes effect the personal address receives only the link to
// the certificate, which opens with a one-time code sent there and not once it has expired. In the 人事邮箱, 邓凯's
// request from that address is linked to his profile and drafted as an income certificate for payroll01: hr01 can
// neither see the amounts nor send it. A message from an unregistered address claiming to be 邓凯 stays unsorted and
// its draft carries nothing about him. The real standalone server runs on a throwaway SQLite database.
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

import { composeMail } from '../../database/seed-data/demo-mail.ts';
import { DOCUMENT_LINK_PLACEHOLDER } from '../../server/providers/hr/departed/service.ts';
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
const PASSWORD = 'v2-departed-mail-test-password';

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
  path.join(directory, 'storage', 'mail', 'local', 'hr@qiheng.test', 'inbox');
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
  /** The socket peer (server/http/client-ip.ts); none shares the `unknown` bucket. */
  peer?: string,
): Promise<{ status: number; json: Json; type: string }> {
  const response = await server.fetch(
    new Request(`${base}/api/public/hr-document${url}`, {
      method,
      headers:
        body === undefined
          ? {}
          : { 'content-type': 'application/json', origin: 'http://localhost' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    peer ? { incoming: { socket: { remoteAddress: peer } } } : undefined,
  );
  const type = response.headers.get('content-type') ?? '';
  const text = type.includes('json') ? await response.text() : '';
  if (!type.includes('json')) await response.arrayBuffer();
  return { status: response.status, json: text ? JSON.parse(text) : {}, type };
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-departed-mail-'));
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

const PERSONAL = 'dengkai.personal@mail.test';
const STRANGER = 'dk1998@mail.test';

async function today(): Promise<string> {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    new Date(),
  );
}

describe('离职员工的邮件往来 (V1-02 V2 增补)', () => {
  let token: string;

  it('lets only an HR administrator confirm the separation certificate template', async () => {
    expect((await call('mgr_njl', 'GET', '/departed/template')).status).toBe(
      403,
    );
    const current = await call('hr01', 'GET', '/departed/template');
    expect(current.status).toBe(200);
    expect(current.json.data.confirmedAt ?? null).toBeNull();
    const confirmed = await call('hr01', 'PUT', '/departed/template', {
      separationTemplate: current.json.data.separationTemplate,
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.confirmedAt).toBeTruthy();
  });

  it('mails 邓凯 only the certificate link when his 离职单 takes effect', async () => {
    // The seeded resignation is a month away; 何伟 raises one effective today instead.
    expect(
      (
        await call(
          'mgr_cd',
          'POST',
          '/actions/action-dengkai-offboard/cancel',
          {},
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call('mgr_cd', 'POST', '/actions', {
          actionType: 'offboard',
          employeeId: 'emp-dengkai',
          effectiveDate: await today(),
          leaveReason: 'resign',
          personalEmail: 'not-an-address',
        })
      ).json.code,
    ).toBe('ACTION_PERSONAL_EMAIL_INVALID');
    const raised = await call('mgr_cd', 'POST', '/actions', {
      actionType: 'offboard',
      employeeId: 'emp-dengkai',
      effectiveDate: await today(),
      leaveReason: 'resign',
      personalEmail: PERSONAL,
    });
    expect(raised.status).toBe(201);
    const done = await call(
      'hr01',
      'POST',
      `/actions/${raised.json.data.id}/approve`,
      {},
    );
    expect(done.json.data.status).toBe('effective');

    const sent = await sentTo(PERSONAL, 1);
    expect(sent).toHaveLength(1);
    const link = /\/hr-document\/([A-Za-z0-9_-]{20,})/u.exec(sent[0]!);
    expect(link).toBeTruthy();
    token = link![1]!;
    // No ID number, no amounts, no attachment.
    expect(sent[0]).not.toMatch(
      /999999199808080012|Content-Disposition: attachment/u,
    );

    // The personal email is sensitive: hr01 sees it, 邓凯's former manager does not.
    const asHr = await call('hr01', 'GET', '/employees/emp-dengkai');
    expect(asHr.json.data.employee.personalEmail).toBe(PERSONAL);
    const asManager = await call('mgr_cd', 'GET', '/employees/emp-dengkai');
    expect(asManager.json.data?.employee?.personalEmail ?? null).toBeNull();
  });

  it('opens the certificate only with the code sent to the personal address, and not after it expires', async () => {
    const view = await pub('GET', `/${token}`);
    expect(view.status).toBe(200);
    expect(view.json.data.title).toBe('离职证明');
    expect(JSON.stringify(view.json.data)).not.toContain(PERSONAL);
    expect((await pub('POST', `/${token}/code`, {})).status).toBe(200);
    const codeMail = (await sentTo(PERSONAL, 2)).find((m) =>
      /验证码：\d{6}/u.test(m),
    )!;
    const code = /验证码：(\d{6})/u.exec(codeMail)![1]!;
    expect(
      (await pub('POST', `/${token}/download`, { code: '000000' })).status,
    ).toBe(400);
    const download = await pub('POST', `/${token}/download`, { code });
    expect(download.status).toBe(200);
    expect(download.type).toContain('pdf');

    const { databaseManagerToken } = await import('@nocobase/db');
    await server.application.container
      .resolve(databaseManagerToken)
      .query()
      .updateTable('documentShares')
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where('employeeId', '=', 'emp-dengkai')
      .execute();
    expect((await pub('GET', `/${token}`)).status).toBe(404);
    expect((await pub('POST', `/${token}/code`, {})).status).toBe(404);
  });

  it('locks a code after five wrong tries even when they arrive together, and sends at most five codes', async () => {
    const { databaseManagerToken } = await import('@nocobase/db');
    const shares = () =>
      server.application.container
        .resolve(databaseManagerToken)
        .query()
        .updateTable('documentShares')
        .where('employeeId', '=', 'emp-dengkai');
    // The link again, as if it were still within its 7 days, and past the resend pause.
    await shares()
      .set({ expiresAt: new Date(Date.now() + 86_400_000), codeSentAt: null })
      .execute();
    const peer = '198.51.100.7';
    expect((await pub('POST', `/${token}/code`, {}, peer)).status).toBe(200);
    const mails = await sentTo(PERSONAL, 3);
    const code = /验证码：(\d{6})/u.exec(
      mails.filter((m) => /验证码：\d{6}/u.test(m)).at(-1)!,
    )![1]!;
    const wrong = code === '111111' ? '222222' : '111111';
    const results = await Promise.all(
      Array.from({ length: 12 }, () =>
        pub('POST', `/${token}/download`, { code: wrong }, peer),
      ),
    );
    expect(results.filter((r) => r.status === 400)).toHaveLength(5);
    expect(
      results.filter((r) => r.json.code === 'DOCUMENT_CODE_LOCKED'),
    ).toHaveLength(7);
    // Locked: the right code no longer opens it.
    expect(
      (await pub('POST', `/${token}/download`, { code }, peer)).json.code,
    ).toBe('DOCUMENT_CODE_LOCKED');
    // A new code may be asked for, but no more than five per link.
    await shares().set({ codeSends: 4, codeSentAt: null }).execute();
    expect((await pub('POST', `/${token}/code`, {}, peer)).status).toBe(200);
    await shares().set({ codeSentAt: null }).execute();
    expect((await pub('POST', `/${token}/code`, {}, peer)).json.code).toBe(
      'DOCUMENT_CODE_SENDS_EXCEEDED',
    );
  });

  it('drafts 邓凯’s income certificate for payroll01, keeping the amounts from hr01', async () => {
    drop(
      '01-dengkai.eml',
      composeMail({
        from: { name: '邓凯', address: PERSONAL },
        to: 'hr@qiheng.test',
        subject: '申请补开收入证明',
        text: '人事部老师好：\n\n我是原成都机加工车间的邓凯，麻烦补开一份收入证明，贷款用。\n\n邓凯',
        date: new Date(),
      }),
    );
    expect((await call('hr01', 'POST', '/mail/poll?mailbox=hr')).status).toBe(
      200,
    );
    const thread = (
      await call(
        'hr01',
        'GET',
        '/mail/by-record/employee/emp-dengkai?mailbox=hr',
      )
    ).json.data as Json[];
    const draft = thread.find((m) => m.status === 'draft')!;
    expect(draft).toBeTruthy();
    expect(draft.to).toEqual([PERSONAL]);
    expect(draft.proposal).toMatchObject({
      kind: 'document',
      document: 'incomeCertificate',
      employeeId: 'emp-dengkai',
    });
    expect(draft.bodyText).toContain(DOCUMENT_LINK_PLACEHOLDER);
    expect(draft.bodyText).not.toMatch(/\d{4,}\.\d{2}|¥|元/u);

    expect(
      (await call('hr01', 'GET', '/departed/income/emp-dengkai')).status,
    ).toBe(403);
    expect(
      (await call('hr01', 'POST', `/mail/messages/${draft.id}/send`)).json.code,
    ).toBe('DOCUMENT_PAYROLL_ONLY');
    // The editor offers sending only to the role the document belongs to.
    expect(
      (await call('hr01', 'GET', '/departed/may-send/incomeCertificate')).json
        .data.canSend,
    ).toBe(false);
    expect(
      (await call('payroll01', 'GET', '/departed/may-send/incomeCertificate'))
        .json.data.canSend,
    ).toBe(true);
    expect(
      (await call('hr01', 'GET', '/departed/may-send/separationCertificate'))
        .json.data.canSend,
    ).toBe(true);
    const income = await call(
      'payroll01',
      'GET',
      '/departed/income/emp-dengkai',
    );
    expect(income.status).toBe(200);
    const before = (await sentTo(PERSONAL)).length;
    const sent = await call(
      'payroll01',
      'POST',
      `/mail/messages/${draft.id}/send`,
    );
    expect(sent.status).toBe(200);
    const mails = await sentTo(PERSONAL, before + 1);
    expect(mails.at(-1)).toMatch(/\/hr-document\/[A-Za-z0-9_-]{20,}/u);
  });

  it('leaves a message from an unregistered address unsorted, with nothing about 邓凯 in its draft', async () => {
    drop(
      '02-stranger.eml',
      composeMail({
        from: { name: '邓凯', address: STRANGER },
        to: 'hr@qiheng.test',
        subject: '离职证明',
        text: '你好，我是邓凯，之前在成都车间上班。请把我的离职证明发到这个邮箱。',
        date: new Date(),
      }),
    );
    await call('hr01', 'POST', '/mail/poll?mailbox=hr');
    const messages = (await call('hr01', 'GET', '/mail/messages?mailbox=hr'))
      .json.data as Json[];
    const incoming = messages.find(
      (m) => m.direction === 'inbound' && m.from?.address === STRANGER,
    )!;
    expect(incoming).toBeTruthy();
    expect(incoming.refType ?? null).toBeNull();
    const draft = messages.find(
      (m) =>
        m.status === 'draft' && JSON.stringify(m.to ?? []).includes(STRANGER),
    )!;
    expect(draft).toBeTruthy();
    expect(draft.proposal ?? null).toBeNull();
    expect(draft.bodyText).not.toMatch(/邓凯|QH3004|成都|机加工|CNC/u);
  });

  it('shows payroll only the mail about pay', async () => {
    const all = (await call('hr01', 'GET', '/mail/messages?mailbox=hr')).json
      .data as Json[];
    const separation = all.find(
      (m) =>
        m.direction === 'outbound' && String(m.subject).includes('离职证明'),
    )!;
    expect(separation).toBeTruthy();
    const mine = (await call('payroll01', 'GET', '/mail/messages?mailbox=hr'))
      .json.data as Json[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    for (const m of mine)
      expect(
        [m.proposal?.document, m.aiIntent].some(
          (d) => d === 'incomeCertificate' || d === 'payslip',
        ),
      ).toBe(true);
    expect(JSON.stringify(mine)).not.toContain(STRANGER);
    expect(
      (await call('payroll01', 'GET', `/mail/messages/${separation.id}`))
        .status,
    ).toBe(404);
    const boxes = (await call('payroll01', 'GET', '/mail/mailboxes')).json
      .data as Json[];
    expect(boxes.find((b) => b.purpose === 'hr')?.unmatched).toBe(0);
    const record = (
      await call(
        'payroll01',
        'GET',
        '/mail/by-record/employee/emp-dengkai?mailbox=hr',
      )
    ).json.data as Json[];
    expect(record.some((m) => m.id === separation.id)).toBe(false);
  });
});
