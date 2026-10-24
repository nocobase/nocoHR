import type { Application } from '@nocobase/app-server/application';
import { mailServiceToken as nativeMailToken } from '@nocobase/app-plugin-mail/server';
import { mailServiceToken } from '../../server/providers/hr/tokens.ts';

interface RunState {
  id: string;
  accountId: string;
  status: string;
}

/** Observe public instance methods only; never change their arguments, result or timing. */
export function observeMailClose(
  application: Application,
  suite: string,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
) {
  const native = application.container.resolve(nativeMailToken);
  const business = application.container.resolve(mailServiceToken);
  const pending = new Map<number, { stage: string; started: number }>();
  const runs = new Map<string, RunState>();
  const restore: (() => void)[] = [];
  let sequence = 0;
  let reads = 0;
  const report = (event: string, details: Record<string, unknown> = {}) =>
    write(
      `MAIL_CLOSE ${JSON.stringify({
        suite,
        pid: process.pid,
        t: performance.now(),
        event,
        ...details,
      })}\n`,
    );
  function remember(run: RunState) {
    const previous = runs.get(run.id);
    runs.set(run.id, {
      id: run.id,
      accountId: run.accountId,
      status: run.status,
    });
    if (!previous || previous.status !== run.status)
      report('sync.state', {
        id: run.id,
        accountId: run.accountId,
        status: run.status,
      });
  }
  function observe<TArgs extends unknown[], TResult>(
    target: object,
    key: string,
    original: (...args: TArgs) => Promise<TResult>,
    settled?: (result: TResult) => void,
  ) {
    const observed = function (this: unknown, ...args: TArgs) {
      const call = ++sequence;
      const started = performance.now();
      pending.set(call, { stage: key, started });
      const finish = (event: string) => {
        pending.delete(call);
        if (key !== 'listSyncRuns')
          report(`${key}.${event}`, { call, ms: performance.now() - started });
      };
      if (key !== 'listSyncRuns') report(`${key}.begin`, { call });
      try {
        const result = Reflect.apply(original, this, args) as Promise<TResult>;
        void result.then(
          (value) => {
            settled?.(value);
            finish('done');
          },
          () => finish('failed'),
        );
        return result;
      } catch (error) {
        finish('failed');
        throw error;
      }
    };
    Object.assign(target, { [key]: observed });
    restore.push(() => {
      if (Reflect.get(target, key) === observed)
        Object.assign(target, { [key]: original });
    });
  }
  observe(business, 'poll', business.poll);
  observe(native, 'startSync', native.startSync, remember);
  observe(native, 'listSyncRuns', native.listSyncRuns, (result) => {
    reads += 1;
    for (const run of result) remember(run);
  });
  report('installed');
  return {
    snapshot: () => ({
      mailReads: reads,
      mailRuns: [...runs.values()],
      mailPending: [...pending].map(([call, { stage, started }]) => ({
        call,
        stage,
        ms: performance.now() - started,
      })),
    }),
    restore: () => {
      for (const undo of restore.reverse()) undo();
    },
  };
}
