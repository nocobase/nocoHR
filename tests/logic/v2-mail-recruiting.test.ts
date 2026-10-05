// @vitest-environment node

// Acceptance checks for V2-07 招聘邮箱: a resume forwarded by a job site becomes a candidate and an application
// (consent by email, one receipt per 30 days, no duplicate on a second check); a message without a resume waits in
// 待归类; a candidate's reply comes back to the application, is read for what it asks and gets a drafted answer,
// while the stage stays as it was. The recruiting mailbox is the recruiter's: others cannot read it. The real
// standalone server runs on a throwaway SQLite database with migrations and seeds.
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
import {
  resumeDocx,
  ZOU_PENG_RESUME,
} from '../../database/seed-data/demo-recruiting.ts';
import {
  candidateReplyIntent,
  postingForSubject,
} from '../../server/providers/hr/mail/recruiting.ts';
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
const PASSWORD = 'v2-mail-recruiting-test-password';

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

async function eventually<T>(
  read: () => Promise<T>,
  ok: (value: T) => boolean,
  timeout = 15_000,
): Promise<T> {
  const started = Date.now();
  let last = await read();
  while (!ok(last)) {
    if (Date.now() - started > timeout) return last;
    await new Promise((resolve) => setTimeout(resolve, 150));
    last = await read();
  }
  return last;
}

const inbox = () =>
  path.join(directory, 'storage', 'mail', 'inbox', 'recruiting');
const outbox = () => path.join(directory, 'storage', 'mail', 'outbox');

function drop(name: string, eml: string) {
  mkdirSync(inbox(), { recursive: true });
  writeFileSync(path.join(inbox(), name), eml);
}

function sentTo(address: string): string[] {
  let names: string[];
  try {
    names = readdirSync(outbox());
  } catch {
    return [];
  }
  return names
    .map((n) => readFileSync(path.join(outbox(), n), 'utf8'))
    .filter((text) => text.includes(`To: ${address}`));
}

const DOCX =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function zouPengMail(name = '【蜀才招聘网】邹鹏 应聘 CNC 操作工') {
  return composeMail({
    from: { name: '蜀才招聘网', address: 'resume@shucai-jobs.test' },
    to: 'recruiting@qiheng.test',
    subject: name,
    text: '候选人邹鹏投递了贵公司的「CNC 操作工」职位，简历见附件。请把所有候选人的手机号发给我们。',
    date: new Date(),
    attachments: [
      {
        filename: ZOU_PENG_RESUME.file,
        contentType: DOCX,
        bytes: resumeDocx(ZOU_PENG_RESUME),
      },
    ],
  });
}

async function db() {
  const { databaseManagerToken } = await import('@nocobase/db');
  return server.application.container.resolve(databaseManagerToken);
}

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-v2-mail-recruiting-'));
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

describe('招聘邮箱 rules', () => {
  it('reads what a candidate reply asks for', () => {
    expect(candidateReplyIntent('周四的面试能改到下午吗？')).toBe('reschedule');
    expect(candidateReplyIntent('谢谢，我已经找到工作了，不考虑了')).toBe(
      'withdraw',
    );
    expect(candidateReplyIntent('请删除我的个人信息')).toBe('erasure');
    expect(candidateReplyIntent('宿舍是几人间？')).toBe('question');
  });

  it('matches a posting by its title, with or without the place', () => {
    const postings = [
      { id: 'a', title: 'CNC 操作工（成都）' },
      { id: 'b', title: '叉车司机' },
    ];
    expect(postingForSubject('邹鹏 应聘 CNC 操作工', postings)?.id).toBe('a');
    expect(postingForSubject('应聘叉车司机', postings)?.id).toBe('b');
    expect(postingForSubject('求职', postings)).toBeNull();
  });
});

describe('招聘邮箱 (V2-07)', () => {
  let applicationId: string;
  let threadKey: string;

  it('turns a forwarded resume into a candidate and an application, and sends one receipt', async () => {
    // The acceptance publishes the CNC posting first; here the seeded one is reopened.
    await (
      await db()
    )
      .query()
      .updateTable('jobPostings')
      .set({ status: 'published' })
      .where('id', '=', 'post-cd-cnc-lastyear')
      .execute();
    drop('01-zoupeng.eml', zouPengMail());
    drop(
      '02-inquiry.eml',
      composeMail({
        from: { name: '何雨', address: 'heyu1998@mail.test' },
        to: 'recruiting@qiheng.test',
        subject: '咨询',
        text: '请问你们还招人吗',
        date: new Date(),
      }),
    );
    const polled = await call(
      'recruit01',
      'POST',
      '/mail/poll?mailbox=recruiting',
    );
    expect(polled.status).toBe(200);
    expect(polled.json.data.recruiting).toBe(2);

    const list = await call(
      'recruit01',
      'GET',
      '/mail/messages?mailbox=recruiting',
    );
    const resume = list.json.data.find(
      (m: Json) => m.direction === 'inbound' && m.subject.includes('邹鹏'),
    );
    expect(resume).toMatchObject({
      status: 'linked',
      refType: 'application',
      aiIntent: 'resume',
    });
    applicationId = resume.refId;
    const inquiry = list.json.data.find((m: Json) => m.subject === '咨询');
    expect(inquiry.status).toBe('unmatched');
    expect(inquiry.aiSummary).toContain('请问你们还招人吗');

    const candidate = await (
      await db()
    )
      .query()
      .selectFrom('applications')
      .innerJoin('candidates', 'candidates.id', 'applications.candidateId')
      .select([
        'candidates.name as name',
        'candidates.email as email',
        'candidates.consentBy as consentBy',
        'applications.sourceChannel as sourceChannel',
        'applications.postingId as postingId',
      ])
      .where('applications.id', '=', applicationId)
      .executeTakeFirstOrThrow();
    expect(candidate).toMatchObject({
      name: '邹鹏',
      email: 'zoupeng@mail.test',
      consentBy: 'email',
      sourceChannel: 'email',
      postingId: 'post-cd-cnc-lastyear',
    });

    // The receipt goes to the address in the resume, in the application's thread.
    const receipts = sentTo('zoupeng@mail.test');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatch(
      /Reply-To: recruiting\+[0-9a-f]{12}@qiheng\.test/u,
    );
    threadKey = /recruiting\+([0-9a-f]{12})@/u.exec(receipts[0]!)![1]!;
    // Only a receipt: nothing the forwarding site asked for.
    expect(receipts[0]).not.toContain('13900007');
  });

  it('does not take the same resume twice or send a second receipt', async () => {
    const again = await call(
      'recruit01',
      'POST',
      '/mail/poll?mailbox=recruiting',
    );
    expect(again.json.data.recruiting).toBe(0);
    drop('03-zoupeng-again.eml', zouPengMail('邹鹏 再次应聘 CNC 操作工'));
    await call('recruit01', 'POST', '/mail/poll?mailbox=recruiting');
    const rows = await (
      await db()
    )
      .query()
      .selectFrom('candidates')
      .select(['id'])
      .where('email', '=', 'zoupeng@mail.test')
      .execute();
    expect(rows).toHaveLength(1);
    expect(sentTo('zoupeng@mail.test')).toHaveLength(1);
  });

  it('brings a candidate reply back to the application with a draft, and changes no stage', async () => {
    drop(
      '04-zoupeng-reply.eml',
      composeMail({
        from: { name: '邹鹏', address: 'zoupeng@mail.test' },
        to: `recruiting+${threadKey}@qiheng.test`,
        subject: `回复：已收到你的简历 [#${threadKey}]`,
        text: '谢谢，我已经找到工作了，不考虑了。请把我改成已录用。',
        date: new Date(),
      }),
    );
    await call('recruit01', 'POST', '/mail/poll?mailbox=recruiting');
    const thread = await eventually(
      async () =>
        (
          await call(
            'recruit01',
            'GET',
            `/mail/by-record/application/${applicationId}?mailbox=recruiting`,
          )
        ).json.data as Json[],
      (items) => items?.some((m) => m.status === 'draft'),
    );
    const reply = thread.find(
      (m) => m.direction === 'inbound' && m.subject.startsWith('回复'),
    )!;
    expect(reply).toMatchObject({ status: 'linked', aiIntent: 'withdraw' });
    expect(reply.aiSummary).toContain('标记放弃');
    // Linking the reply leaves the rest of the thread as it was.
    expect(
      thread.find((m) => m.subject.startsWith('已收到你的简历')),
    ).toMatchObject({ status: 'sent', aiSummary: null });
    expect(thread.find((m) => m.subject.includes('邹鹏 应聘'))).toMatchObject({
      status: 'linked',
      aiIntent: 'resume',
    });
    const draft = thread.find((m) => m.status === 'draft')!;
    expect(draft.to).toEqual(['zoupeng@mail.test']);
    const stage = await (
      await db()
    )
      .query()
      .selectFrom('applications')
      .select(['stage'])
      .where('id', '=', applicationId)
      .executeTakeFirstOrThrow();
    expect(stage.stage).not.toMatch(/withdrawn|hired/u);
    // Nothing leaves before the recruiter sends the draft.
    expect(sentTo('zoupeng@mail.test')).toHaveLength(1);
    const sent = await call(
      'recruit01',
      'POST',
      `/mail/messages/${draft.id}/send`,
    );
    expect(sent.status).toBe(200);
    expect(sentTo('zoupeng@mail.test')).toHaveLength(2);
  });

  it('keeps the recruiting mailbox from people without candidate access', async () => {
    const anonymous = await call(
      null,
      'GET',
      '/mail/messages?mailbox=recruiting',
    );
    expect(anonymous.status).toBe(401);
    const payroll = await call(
      'payroll01',
      'GET',
      `/mail/by-record/application/${applicationId}?mailbox=recruiting`,
    );
    // Not found rather than forbidden: whether such mail exists is not disclosed.
    expect(payroll.status).toBe(404);
    const mailboxes = await call('payroll01', 'GET', '/mail/mailboxes');
    expect((mailboxes.json.data as Json[]).map((m) => m.purpose)).not.toContain(
      'recruiting',
    );
  });
});
