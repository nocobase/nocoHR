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

import { simpleParser } from 'mailparser';

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
  path.join(
    directory,
    'storage',
    'mail',
    'local',
    'recruiting@qiheng.test',
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
    const receipts = await sentTo('zoupeng@mail.test', 1);
    expect(receipts).toHaveLength(1);
    // The application's thread tag is in its subject.
    const receipt = await simpleParser(receipts[0]!);
    threadKey = /\[#([0-9a-f]{12})\]/u.exec(receipt.subject ?? '')![1]!;
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
    expect(await sentTo('zoupeng@mail.test')).toHaveLength(1);
  });

  it('brings a candidate reply back to the application with a draft, and changes no stage', async () => {
    drop(
      '04-zoupeng-reply.eml',
      composeMail({
        from: { name: '邹鹏', address: 'zoupeng@mail.test' },
        to: 'recruiting@qiheng.test',
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
    expect(await sentTo('zoupeng@mail.test')).toHaveLength(1);
    const sent = await call(
      'recruit01',
      'POST',
      `/mail/messages/${draft.id}/send`,
    );
    expect(sent.status).toBe(200);
    expect(await sentTo('zoupeng@mail.test', 2)).toHaveLength(2);
  });

  it('proposes the free Thursday afternoon times for a reschedule reply, and moves the interview only when the reply is sent', async () => {
    const userOf = async (username: string) =>
      String(
        (
          await (
            await db()
          )
            .query()
            .selectFrom('user')
            .select(['id'])
            .where('username', '=', username)
            .executeTakeFirstOrThrow()
        ).id,
      );
    const interviewers = [await userOf('mgr_cd'), await userOf('hr01')];
    // Next week's Thursday, 10:00 in Shanghai.
    const now = new Date(
      new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }),
    );
    const thursday = new Date(now);
    thursday.setDate(now.getDate() + ((4 - now.getDay() + 7) % 7) + 7);
    const day = `${thursday.getFullYear()}-${String(thursday.getMonth() + 1).padStart(2, '0')}-${String(thursday.getDate()).padStart(2, '0')}`;
    const scheduled = await call(
      'recruit01',
      'POST',
      '/recruiting/interviews',
      {
        applicationId,
        mode: 'onsite',
        scheduledAt: `${day}T10:00:00+08:00`,
        durationMinutes: 60,
        locationOrLink: '成都工厂行政楼 2 楼会议室',
        interviewerUserIds: interviewers,
      },
    );
    expect(scheduled.status).toBe(201);
    const interviewId = scheduled.json.data.id as string;

    // A new message from his own address, outside the thread.
    drop(
      '05-zoupeng-reschedule.eml',
      composeMail({
        from: { name: '邹鹏', address: 'zoupeng@mail.test' },
        to: 'recruiting@qiheng.test',
        subject: '面试时间',
        text: '您好，周四的面试能改到下午吗？上午要交接班。',
        date: new Date(),
      }),
    );
    await call('recruit01', 'POST', '/mail/poll?mailbox=recruiting');
    const thread = (
      await call(
        'recruit01',
        'GET',
        `/mail/by-record/application/${applicationId}?mailbox=recruiting`,
      )
    ).json.data as Json[];
    const request = thread.find((m) => m.subject === '面试时间')!;
    expect(request).toMatchObject({ status: 'linked', aiIntent: 'reschedule' });
    expect(request.aiSummary).toContain('可改到');
    const draft = thread.find(
      (m) => m.status === 'draft' && m.proposal?.kind === 'reschedule',
    )!;
    const options = draft.proposal.options as Json[];
    expect(options.length).toBeGreaterThan(0);
    for (const o of options) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date(o.start)),
      );
      expect(hour).toBeGreaterThanOrEqual(13);
      expect(
        o.start.slice(0, 10) <= day && o.start.slice(0, 10) >= day.slice(0, 8),
      ).toBe(true);
    }
    expect(draft.bodyText).toContain('（周四）13:00');
    expect(draft.bodyText).toContain('成都工厂行政楼 2 楼会议室');

    // Picking another time rewrites the reply; nothing moves yet.
    let chosen = options[0]!;
    if (options.length > 1) {
      const picked = await call(
        'recruit01',
        'PATCH',
        `/mail/messages/${draft.id}/proposal`,
        { choice: 1 },
      );
      expect(picked.status).toBe(200);
      expect(picked.json.data.bodyText).toContain('（周四）14:00');
      chosen = options[1]!;
    }
    const before = await (
      await db()
    )
      .query()
      .selectFrom('interviews')
      .select(['scheduledAt'])
      .where('id', '=', interviewId)
      .executeTakeFirstOrThrow();
    expect(new Date(before.scheduledAt as string).toISOString()).toBe(
      new Date(`${day}T10:00:00+08:00`).toISOString(),
    );

    const sent = await call(
      'recruit01',
      'POST',
      `/mail/messages/${draft.id}/send`,
    );
    expect(sent.status).toBe(200);
    const after = await (
      await db()
    )
      .query()
      .selectFrom('interviews')
      .select(['scheduledAt', 'status'])
      .where('id', '=', interviewId)
      .executeTakeFirstOrThrow();
    expect(new Date(after.scheduledAt as string).toISOString()).toBe(
      chosen.start,
    );
    expect(after.status).toBe('scheduled');
    // Both interviewers hear of the change.
    const { notificationServiceToken } =
      await import('@nocobase/app-plugin-notification');
    const notifications = server.application.container.resolve(
      notificationServiceToken,
    );
    expect(
      await notifications.getByIdempotencyKey(
        `hr:interview:${interviewId}:rescheduled:${chosen.start}`,
      ),
    ).toBeTruthy();
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

  it('shows a recruiter only the mail of their own requisitions, and the unsorted mail', async () => {
    const { databaseManagerToken } = await import('@nocobase/db');
    const database = server.application.container.resolve(databaseManagerToken);
    const requisition = await database
      .query()
      .selectFrom('applications')
      .innerJoin('jobPostings', 'jobPostings.id', 'applications.postingId')
      .select(['jobPostings.requisitionId as id'])
      .where('applications.id', '=', applicationId)
      .executeTakeFirstOrThrow();
    const thread = async () =>
      (await call('recruit01', 'GET', '/mail/messages?mailbox=recruiting')).json
        .data as Json[];
    const before = await thread();
    expect(before.some((m) => m.refId === applicationId)).toBe(true);
    const unsorted = before.filter((m) => !m.refType);
    expect(unsorted.length).toBeGreaterThan(0);
    const one = before.find((m) => m.refId === applicationId)!;

    // The requisition passes to another recruiter: its mail leaves recruit01's view, 待归类 stays.
    const other = String(
      (
        await database
          .query()
          .selectFrom('user')
          .select(['id'])
          .where('username', '=', 'hr01')
          .executeTakeFirstOrThrow()
      ).id,
    );
    const owner = (
      await database
        .query()
        .selectFrom('jobRequisitions')
        .select(['recruiterUserId'])
        .where('id', '=', requisition.id)
        .executeTakeFirstOrThrow()
    ).recruiterUserId;
    await database
      .query()
      .updateTable('jobRequisitions')
      .set({ recruiterUserId: other })
      .where('id', '=', requisition.id)
      .execute();
    try {
      const after = await thread();
      expect(after.some((m) => m.refId === applicationId)).toBe(false);
      expect(
        after
          .filter((m) => !m.refType)
          .map((m) => m.id)
          .sort(),
      ).toEqual(unsorted.map((m) => m.id).sort());
      expect(
        (await call('recruit01', 'GET', `/mail/messages/${one.id}`)).status,
      ).toBe(404);
      expect(
        (
          (
            await call(
              'recruit01',
              'GET',
              `/mail/by-record/application/${applicationId}?mailbox=recruiting`,
            )
          ).json.data as Json[]
        ).length,
      ).toBe(0);
    } finally {
      await database
        .query()
        .updateTable('jobRequisitions')
        .set({ recruiterUserId: owner })
        .where('id', '=', requisition.id)
        .execute();
    }
    expect((await thread()).some((m) => m.refId === applicationId)).toBe(true);
  });

  it('sends receipts only from a template a recruiter confirmed once', async () => {
    const resumeFrom = (who: { name: string; phone: string; email: string }) =>
      composeMail({
        from: { name: '蜀才招聘网', address: 'resume@shucai-jobs.test' },
        to: 'recruiting@qiheng.test',
        subject: `【蜀才招聘网】${who.name} 应聘 CNC 操作工`,
        text: `候选人${who.name}投递了贵公司的「CNC 操作工」职位，简历见附件。`,
        date: new Date(),
        attachments: [
          {
            filename: `${who.name}-简历.docx`,
            contentType: DOCX,
            bytes: resumeDocx({
              ...ZOU_PENG_RESUME,
              ...who,
              file: `${who.name}-简历.docx`,
            }),
          },
        ],
      });

    // The demo has recruit01's confirmation; only recruiters may read or confirm it.
    const seeded = await call(
      'recruit01',
      'GET',
      '/mail/recruiting/receipt-template',
    );
    expect(seeded.status).toBe(200);
    expect(seeded.json.data.confirmedAt).toBeTruthy();
    expect(seeded.json.data.body).toContain('{{months}}');
    expect(
      (await call('payroll01', 'GET', '/mail/recruiting/receipt-template'))
        .status,
    ).toBe(403);
    expect(
      (
        await call('recruit01', 'PUT', '/mail/recruiting/receipt-template', {
          subject: '收到',
          body: '收到你的简历。',
        })
      ).json.code,
    ).toBe('MAIL_RECEIPT_RETENTION_REQUIRED');

    // Without a confirmed template the resume is taken in, but nothing is sent.
    await (
      await db()
    )
      .query()
      .deleteFrom('personnelSettings')
      .where('id', '=', 'recruitingReceipt')
      .execute();
    drop(
      '05-sunhao.eml',
      resumeFrom({
        name: '孙浩',
        phone: '13900007311',
        email: 'sunhao@mail.test',
      }),
    );
    await call('recruit01', 'POST', '/mail/poll?mailbox=recruiting');
    expect(
      (await call('recruit01', 'GET', '/mail/recruiting/receipt-template')).json
        .data.confirmedAt,
    ).toBeNull();
    expect(await sentTo('sunhao@mail.test')).toHaveLength(0);

    // recruit01 confirms new wording; the next resume is answered with it.
    const confirmed = await call(
      'recruit01',
      'PUT',
      '/mail/recruiting/receipt-template',
      {
        subject: '启衡精密已收到你的简历（{{posting}}）',
        body: '{{name}}，你好：简历已收到。信息保存 {{months}} 个月。\n{{sender}}',
      },
    );
    expect(confirmed.status).toBe(200);
    expect(confirmed.json.data.confirmedAt).toBeTruthy();
    drop(
      '06-zhouli.eml',
      resumeFrom({
        name: '周立',
        phone: '13900007312',
        email: 'zhouli@mail.test',
      }),
    );
    await call('recruit01', 'POST', '/mail/poll?mailbox=recruiting');
    const receipts = await sentTo('zhouli@mail.test', 1);
    expect(receipts).toHaveLength(1);
    const receipt = await simpleParser(receipts[0]!);
    expect(receipt.subject).toContain('启衡精密已收到你的简历（');
    expect(receipt.text).toContain('周立，你好：简历已收到。信息保存');
    expect(receipt.text).not.toContain('{{');
  });
});
