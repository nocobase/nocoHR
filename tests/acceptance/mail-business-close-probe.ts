import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import {
  mailServiceToken as nativeMailToken,
  type MailConfig,
} from '@nocobase/app-plugin-mail/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { jobExecutorServiceToken } from '@nocobase/app-server/jobs';
import { composeMail } from '../../database/seed-data/demo-mail.ts';
import {
  automationServiceToken,
  mailServiceToken,
  recruitingMailToken,
} from '../../server/providers/hr/tokens.ts';
import { fixtureProviderStates } from '../helpers/close-diagnostics.ts';
import type { Harness } from '../logic/talent-review-harness.ts';

type ObjectView = Record<string, unknown>;
function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((done, failed) => {
    resolve = done;
    reject = failed;
  });
  return { promise, resolve, reject };
}
const object = (value: unknown): ObjectView =>
  value !== null && typeof value === 'object' ? (value as ObjectView) : {};

/** Causal intervention for an isolated copy; not imported by normal tests or production. */
export async function installMailBusinessProbe(h: Harness) {
  assert.equal(process.env.NODE_ENV, 'test');
  const phase = process.env.MAIL_PROBE_PHASE ?? 'before';
  const result = process.env.MAIL_PROBE_RESULT ?? 'success';
  assert(['success', 'failure', 'mixed'].includes(result));
  const expectFailure = result !== 'success';
  assert(['before', 'late'].includes(phase));
  const app = h.server.application;
  const config = app.config.get<MailConfig>('mail');
  assert(config, 'Mail configuration must exist');
  assert(Object.values(config.providers).length > 0);
  assert(
    Object.values(config.providers).every((p) => p.type === 'local-files'),
  );
  const native = app.container.resolve(nativeMailToken);
  const business = app.container.resolve(mailServiceToken);
  const online = app.container.resolve(agentsToken).onlineAgent;
  const automation = app.container.resolve(automationServiceToken);
  const recruiter = app.container.resolve(recruitingMailToken);
  const entered = deferred();
  const gate = deferred();
  const terminalDone = deferred();
  let pollError: unknown;
  const restores: (() => void)[] = [];
  let modelCalls = 0;
  let modelActive = 0;
  let first = true;
  const log = (event: string, details: ObjectView = {}) => {
    process.stderr.write(
      `MAIL_BUSINESS ${JSON.stringify({ event, phase, result, pid: process.pid, t: performance.now(), providers: fixtureProviderStates(app, true), ...details })}\n`,
    );
  };
  function observe(target: object, key: string, label: string) {
    const original = Reflect.get(target, key);
    assert.equal(typeof original, 'function');
    const observed = function (this: unknown, ...args: unknown[]) {
      const metadata =
        label === 'automation'
          ? { task: typeof args[0] === 'string' ? args[0] : undefined }
          : {};
      log(`${label}.begin`, metadata);
      try {
        const result = Reflect.apply(original, this, args) as Promise<unknown>;
        void result.then(
          (value) =>
            log(`${label}.done`, { ...metadata, status: object(value).status }),
          (error: unknown) =>
            log(`${label}.failed`, {
              ...metadata,
              error:
                error instanceof Error ? error.message : 'Non-Error rejection',
            }),
        );
        return result;
      } catch (error) {
        log(`${label}.threw`, {
          ...metadata,
          error: error instanceof Error ? error.message : 'Non-Error throw',
        });
        throw error;
      }
    };
    Object.assign(target, { [key]: observed });
    restores.push(() => {
      if (Reflect.get(target, key) === observed)
        Object.assign(target, { [key]: original });
    });
  }
  observe(online, 'background', 'native.background');
  observe(automation, 'run', 'automation');
  observe(recruiter.handler, 'onUnmatched', 'business.handler');
  observe(recruiter.handler, 'onReply', 'business.reply');
  const originalSync = native.startSync;
  native.startSync = async function (...args) {
    if (first) {
      first = false;
      log('sync.gate.enter');
      entered.resolve();
      await gate.promise;
      log('sync.gate.release');
    }
    return Reflect.apply(originalSync, this, args);
  };
  restores.push(() => {
    native.startSync = originalSync;
  });
  const originalPoll = business.poll;
  business.poll = function (...args) {
    const result = Reflect.apply(originalPoll, this, args);
    void result.then(
      () => log('poll.settled'),
      (error) => {
        pollError = error;
        log('poll.rejected', {
          error: error instanceof Error ? error.message : 'non-Error rejection',
        });
      },
    );
    return result;
  };
  restores.push(() => {
    business.poll = originalPoll;
  });

  const model = createServer(async (request, response) => {
    modelActive += 1;
    modelCalls += 1;
    response.once('close', () => {
      modelActive -= 1;
    });
    let raw = '';
    for await (const part of request) raw += part;
    const input = JSON.parse(raw) as { stream?: boolean };
    log('model.request', { modelCalls });
    if (expectFailure && (result === 'failure' || modelCalls === 1)) {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          error: {
            message: 'controlled-mail-model-failure',
            type: 'invalid_request_error',
            code: 'controlled_failure',
          },
        }),
      );
      return;
    }
    const message = {
      role: 'assistant',
      content: JSON.stringify({ answer: '工作地点是成都工厂。', open: [] }),
    };
    if (input.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const [delta, finish_reason] of [
        [message, null],
        [{}, 'stop'],
      ] as const)
        response.write(
          `data: ${JSON.stringify({ id: 'controlled', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({
          id: 'controlled',
          object: 'chat.completion',
          created: 1,
          model: 'fixture',
          choices: [{ index: 0, message, finish_reason: 'stop' }],
          usage: { prompt_tokens: 2, completion_tokens: 3 },
        }),
      );
    }
  });
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  const address = model.address();
  assert(address && typeof address === 'object');
  await app.container.resolve(agentsToken).models.services.create({
    title: 'Controlled local dependency fixture',
    provider: 'openai-compatible',
    apiKey: 'synthetic-local-only',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [{ value: 'fixture' }],
  });
  assert(
    (await app.container.resolve(agentsToken).models.services.defaults())
      .effectiveChat,
  );
  const db = await h.db();
  // Isolated seed records only: make the known synthetic candidate's application active.
  await db
    .query()
    .updateTable('applications')
    .set({ stage: 'screening' })
    .where('id', '=', 'app-pool-qinchuan')
    .execute();
  assert(
    await db
      .query()
      .selectFrom('applications')
      .select('id')
      .where('id', '=', 'app-pool-qinchuan')
      .executeTakeFirst(),
  );
  const inbox = path.join(
    String(object(config.providers.local).directory),
    'recruiting@qiheng.test',
    'inbox',
  );
  mkdirSync(inbox, { recursive: true });
  writeFileSync(
    path.join(inbox, 'mail-dependency-question.eml'),
    composeMail({
      from: { name: 'Controlled candidate', address: 'qinchuan@qiheng.test' },
      to: 'recruiting@qiheng.test',
      subject: 'Controlled dependency question',
      text: '请问上班地点在哪里？',
      date: new Date(),
    }),
  );
  if (result === 'mixed') {
    writeFileSync(
      path.join(inbox, 'mail-dependency-withdraw.eml'),
      composeMail({
        from: { name: 'Controlled candidate', address: 'qinchuan@qiheng.test' },
        to: 'recruiting@qiheng.test',
        subject: 'Controlled second question',
        text: '请问工作地点是在成都吗？',
        date: new Date(Date.now() + 2_000),
      }),
    );
  }
  const schedule = await db
    .query()
    .selectFrom('scheduleDefinitions')
    .select('id')
    .where('key', '=', 'test.mail-dependency-probe')
    .executeTakeFirstOrThrow();
  const executor = app.container
    .resolve(jobExecutorServiceToken)
    .getScheduleExecutor(
      '@nocobase/app-plugin-scheduler',
      app.config.get<{ jobs?: string }>('scheduler')?.jobs,
    );
  let terminal: ObjectView | undefined;
  const unsubscribe = executor.subscribe(async (event) => {
    if (event.jobName !== String(schedule.id) || event.name === 'ScheduleStart')
      return;
    const tasks = await db
      .query()
      .selectFrom('aiTaskRuns')
      .select([
        'id',
        'task',
        'status',
        'error',
        'finishedAt',
        'conversationSessionId',
      ])
      .where('task', 'in', [
        'recruitingAssistant.mailSortRecruiting',
        'recruitingAssistant.mailReplyRecruiting',
      ])
      .execute();
    const messages = await db
      .query()
      .selectFrom('businessMailMessages')
      .select(['id', 'status', 'direction', 'draftOf', 'refType', 'refId'])
      .where('mailbox', '=', 'recruiting')
      .execute();
    const occurrences = await db
      .query()
      .selectFrom('scheduleOccurrences')
      .select(['id', 'status', 'finishedAt', 'reason'])
      .where('scheduleId', '=', String(schedule.id))
      .execute();
    terminal = {
      event: event.name,
      tasks,
      messages,
      occurrences,
      modelCalls,
      modelActive,
      cost: cost(),
    };
    log('terminal', terminal);
    terminalDone.resolve();
  });
  const client = await db.connection().client<{
    on(event: string, fn: (q: { sql: string }) => void): void;
    removeListener(event: string, fn: (q: { sql: string }) => void): void;
  }>();
  const sql: string[] = [];
  const onQuery = ({ sql: text }: { sql: string }) => sql.push(text);
  client.on('query', onQuery);
  const cost = () =>
    Object.fromEntries(
      ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
        (kind) => [
          kind,
          sql.filter((q) => new RegExp(`^${kind}\\b`, 'i').test(q)).length,
        ],
      ),
    );
  log('fixture.ready', {
    schedulerJobs:
      app.config.get<{ jobs?: string }>('scheduler')?.jobs ??
      '(default memory)',
    modelConfigured: true,
  });
  return {
    async close() {
      let applicationClosed = false;
      await entered.promise;
      const timer = setInterval(
        () => log('waiting', { cost: cost(), modelCalls, modelActive }),
        5000,
      );
      timer.unref();
      try {
        if (phase === 'before') {
          gate.resolve();
          await terminalDone.promise;
          if (expectFailure) {
            if (result === 'failure') {
              const source = await db
                .query()
                .selectFrom('businessMailMessages')
                .select(['id', 'threadKey'])
                .where('mailbox', '=', 'recruiting')
                .where('direction', '=', 'inbound')
                .executeTakeFirstOrThrow();
              writeFileSync(
                path.join(inbox, 'direct-reply.eml'),
                composeMail({
                  from: {
                    name: 'Controlled candidate',
                    address: 'qinchuan@qiheng.test',
                  },
                  to: 'recruiting@qiheng.test',
                  subject: `Re: [#${String(source.threadKey)}]`,
                  text: '请问上班地点在哪里？',
                  date: new Date(),
                }),
              );
              assert.equal(
                (await h.call(null, 'POST', '/mail/poll?mailbox=recruiting'))
                  .status,
                401,
              );
              assert.equal(
                (
                  await h.call(
                    'mgr_njl',
                    'POST',
                    '/mail/poll?mailbox=recruiting',
                  )
                ).status,
                404,
              );
              const manual = await h.call(
                'recruit01',
                'POST',
                '/mail/poll?mailbox=recruiting',
              );
              assert.equal(manual.status, 500);
              assert(
                !JSON.stringify(manual.json).includes(
                  'controlled-mail-model-failure',
                ),
              );
              const runs = await db
                .query()
                .selectFrom('aiTaskRuns')
                .select(['id', 'status', 'task', 'error', 'finishedAt'])
                .where('task', '=', 'recruitingAssistant.mailReplyRecruiting')
                .execute();
              assert.equal(
                runs.length,
                2,
                'Thread reply must enter the direct handler once',
              );
              assert(
                runs.every(
                  (run) =>
                    run.status === 'failed' &&
                    run.finishedAt &&
                    String(run.error).includes('The execution failed.'),
                ),
              );
              log('direct-reply.failed', {
                tasks: runs,
                httpStatus: manual.status,
              });
            }
            // Already ingested messages are not automatically processed again after failure.
            const before = modelCalls;
            const repeated = await business.poll('recruiting');
            assert.equal(repeated.recruiting, 0);
            assert.equal(modelCalls, before);
            log('poll.repeated', { counts: repeated, modelCalls });
          }
          log('poll.finished');
          await h.close();
          applicationClosed = true;
        } else {
          const closing = h.close();
          setTimeout(() => gate.resolve(), 300);
          await closing;
          applicationClosed = true;
        }
        log('close.done', { cost: cost(), modelCalls, modelActive, terminal });
        assert(
          terminal,
          'The real scheduled firing must publish a terminal event',
        );
        if (phase === 'before') {
          if (expectFailure && pollError !== undefined) {
            assert(
              pollError instanceof AggregateError,
              'A real business failure must reject poll',
            );
            assert.equal(pollError.message, 'MAIL_PROCESSING_FAILED');
            assert(
              pollError.errors.some(
                (error: unknown) =>
                  error instanceof Error &&
                  error.message.includes('The execution failed.'),
              ),
            );
            log('poll.failure', { counts: object(pollError).counts });
          } else if (!expectFailure) assert.equal(pollError, undefined);
        }
        const tasks = terminal.tasks as ObjectView[];
        assert(
          tasks.some(
            (task) => task.task === 'recruitingAssistant.mailReplyRecruiting',
          ),
          'A nonempty message must enter the real recruiting reply task',
        );
        assert.equal(terminal.event, 'ScheduleEnd');
        const replies = tasks.filter(
          (task) => task.task === 'recruitingAssistant.mailReplyRecruiting',
        );
        const drafts = (terminal.messages as ObjectView[]).filter(
          (message) => message.status === 'draft',
        );
        if (expectFailure) {
          assert(tasks.some((task) => task.status === 'failed'));
          assert(
            tasks
              .filter((task) => task.status === 'failed')
              .every(
                (task) =>
                  typeof task.error === 'string' &&
                  task.error.includes('The execution failed.') &&
                  task.finishedAt,
              ),
          );
          assert(
            replies.some(
              (task) =>
                task.status === 'failed' && task.conversationSessionId === null,
            ),
          );
          assert.equal(drafts.length, result === 'mixed' ? 1 : 0);
          assert(
            (terminal.occurrences as ObjectView[]).some(
              (row) =>
                row.status === 'failed' &&
                row.finishedAt &&
                row.reason === 'MAIL_PROCESSING_FAILED',
            ),
          );
          if (result === 'mixed')
            assert(replies.some((task) => task.status === 'succeeded'));
        } else {
          assert(
            tasks.every((task) => task.status === 'succeeded'),
            'Mail business tasks must succeed before dependencies are released',
          );
          assert.equal(
            drafts.length,
            1,
            'The real handler must save one reply draft',
          );
          assert.equal(typeof replies[0]?.conversationSessionId, 'string');
          assert(
            (terminal.occurrences as ObjectView[]).some(
              (row) => row.status === 'succeeded' && row.finishedAt,
            ),
          );
        }
        assert(modelCalls > 0, 'The real native model connection must execute');
        assert.equal(modelActive, 0);
        await h.close();
        log('close.repeated');
      } finally {
        try {
          if (!applicationClosed) await h.close();
        } finally {
          clearInterval(timer);
          client.removeListener('query', onQuery);
          unsubscribe();
          for (const restore of restores.reverse()) restore();
          await new Promise<void>((resolve, reject) =>
            model.close((error) => (error ? reject(error) : resolve())),
          );
          log('probe.cleaned');
        }
      }
    },
  };
}
