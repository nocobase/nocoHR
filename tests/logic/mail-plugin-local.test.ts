// @vitest-environment node

// The 本地文件邮箱 on the Mail plugin: an account connects, a message dropped into its inbox directory is
// synchronized and read through MailService, and a reply goes out with the thread's headers into the outbox.
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
const PASSWORD = 'mail-plugin-local-test-password';

let server: StandaloneServer;
let directory: string;

async function userId(username: string): Promise<string> {
  const { databaseManagerToken } = await import('@nocobase/db');
  const db = server.application.container.resolve(databaseManagerToken);
  const row = await db
    .query()
    .selectFrom('user')
    .select(['id'])
    .where('username', '=', username)
    .executeTakeFirstOrThrow();
  return String(row.id);
}

describe('本地文件邮箱 on the Mail plugin', () => {
  it('synchronizes a dropped message and sends a threaded reply', async () => {
    const { mailServiceToken } =
      await import('@nocobase/app-plugin-mail/server');
    const mail = server.application.container.resolve(mailServiceToken);
    const ctx = { actorId: await userId('payroll01') };
    const account = await mail.connectAccount(ctx, {
      provider: { type: 'local-files', name: 'local' },
      address: 'billing@qiheng.test',
      username: 'billing',
      password: 'local',
      initialSyncReceivedAfter: new Date(
        Date.now() - 30 * 86_400_000,
      ).toISOString(),
    });
    expect(account.address).toBe('billing@qiheng.test');
    const inbox = path.join(
      directory,
      'storage',
      'mail',
      'local',
      'billing@qiheng.test',
      'inbox',
    );
    mkdirSync(inbox, { recursive: true });
    writeFileSync(
      path.join(inbox, '01.eml'),
      composeMail({
        from: { name: '蓉川人力', address: 'billing@rongchuan-hr.test' },
        to: 'billing@qiheng.test',
        subject: '九月账单',
        text: '附件是账单。',
        date: new Date(),
      }),
    );
    let run = await mail.startSync(ctx, { accountId: account.id });
    for (
      let i = 0;
      i < 100 &&
      !['completed', 'failed', 'cancelled'].includes(String(run.status));
      i++
    ) {
      await new Promise((r) => setTimeout(r, 100));
      run = (await mail.getSyncRun(ctx, run.id)) ?? run;
    }
    expect(run.status).toBe('completed');
    const page = await mail.listMessages(ctx, { accountIds: [account.id] });
    const received = page.items.find((m) => m.subject === '九月账单');
    expect(received).toBeTruthy();
    const full = await mail.getMessage(ctx, account.id, received!.id);
    expect(full?.text).toContain('附件是账单');
    const identity = (await mail.listIdentities(ctx, account.id))[0]!;
    const submission = await mail.sendMessage(ctx, {
      accountId: account.id,
      identityId: identity.id,
      to: [{ address: 'billing@rongchuan-hr.test' }],
      subject: 'Re: 九月账单',
      text: '已核对。',
      inReplyToMessageId: received!.id,
      idempotencyKey: 'local-test-reply-1',
    });
    expect(['pending', 'submitting', 'accepted']).toContain(
      String(submission.status),
    );
    const outbox = path.join(directory, 'storage', 'mail', 'outbox');
    let sent: string[] = [];
    for (let i = 0; i < 100 && !sent.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        sent = readdirSync(outbox);
      } catch {
        sent = [];
      }
    }
    expect(sent).toHaveLength(1);
    const text = readFileSync(path.join(outbox, sent[0]!), 'utf8');
    expect(text).toMatch(/In-Reply-To: <.+>/u);
    expect(text).toContain('To: billing@rongchuan-hr.test');
  });
});
beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'hr-mail-plugin-local-'));
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
}, 180_000);

afterAll(async () => {
  await server?.close();
  delete process.env.HR_DEMO_PASSWORD;
  if (directory) rmSync(directory, { recursive: true, force: true });
});
