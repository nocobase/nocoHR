import type { Application } from '@nocobase/app-server/application';
import {
  automationTasksToken,
  examServiceToken,
  knowledgeServiceToken,
  practiceServiceToken,
  sessionServiceToken,
} from '../../server/providers/hr/tokens.ts';

type ObjectView = Record<string, unknown>;
type Details = Record<string, string | number | undefined>;
const object = (value: unknown): ObjectView =>
  value !== null && typeof value === 'object' ? (value as ObjectView) : {};
const text = (value: unknown) =>
  typeof value === 'string' ? value : undefined;
const size = (value: unknown) => {
  const view = object(value);
  return typeof view.size === 'number' ? view.size : undefined;
};
const eventDetails = (args: unknown[]): Details => {
  const event = object(args[0]);
  return {
    eventName: text(event.name),
    jobName: text(event.jobName),
    jobId: text(event.jobId),
  };
};

/** Fixed-version, test-only views: never use these internals to drive execution. */
export function observeSchedulerClose(
  application: Application,
  suite: string,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
) {
  const registry = object(object(application).providerRegistry);
  const entries = registry.providers as { provider: ObjectView }[] | undefined;
  const provider = entries?.find(
    ({ provider: item }) => item.name === '@nocobase/app-plugin-scheduler',
  )?.provider;
  const internals = object(provider?.internals);
  const executor = object(internals.executor);
  const backend = object(executor.backend);
  const service = object(internals.service);
  const pending = new Map<
    number,
    { stage: string; started: number } & Details
  >();
  const restore: (() => void)[] = [];
  const deliveries = new WeakSet<object>();
  let sequence = 0;
  const report = (event: string, details: ObjectView = {}) => {
    write(
      `SCHEDULER_CLOSE ${JSON.stringify({
        suite,
        pid: process.pid,
        event,
        t: performance.now(),
        ...details,
      })}\n`,
    );
  };
  function begin(stage: string, details: Details) {
    const call = ++sequence;
    pending.set(call, { stage, started: performance.now(), ...details });
    report(`${stage}.begin`, { call, ...details });
    return (event: 'done' | 'failed') => {
      const entry = pending.get(call)!;
      pending.delete(call);
      report(`${stage}.${event}`, {
        call,
        ms: performance.now() - entry.started,
        ...details,
      });
    };
  }
  function observeResult(result: unknown, finish: ReturnType<typeof begin>) {
    if (typeof object(result).then === 'function') {
      // Observe settlement while returning the original result to the real caller.
      void (result as PromiseLike<unknown>).then(
        () => finish('done'),
        () => finish('failed'),
      );
    } else finish('done');
  }
  function wrap(
    target: ObjectView,
    key: string,
    stage: string,
    details: (args: unknown[]) => Details = () => ({}),
    after?: (args: unknown[]) => void,
  ) {
    const original = target[key];
    if (typeof original !== 'function') return;
    const observed = function (this: unknown, ...args: unknown[]) {
      const finish = begin(stage, details(args));
      let result: unknown;
      try {
        result = Reflect.apply(original, this, args);
      } catch (error) {
        finish('failed');
        throw error;
      }
      after?.(args);
      observeResult(result, finish);
      return result;
    };
    target[key] = observed;
    restore.push(() => {
      if (target[key] === observed) target[key] = original;
    });
  }
  wrap(executor, 'shutdown', 'executor.shutdown');
  wrap(backend, 'close', 'backend.close', () => ({
    running: size(backend.running),
    queued: Array.isArray(backend.queue) ? backend.queue.length : undefined,
  }));
  wrap(object(backend.file), 'write', 'state.write');
  wrap(backend, 'execute', 'firing', (args) => ({
    jobName: text(object(args[0]).name),
    scheduledAt:
      typeof object(args[0]).scheduledAt === 'number'
        ? (object(args[0]).scheduledAt as number)
        : undefined,
    target: text(object(object(object(args[1]).payload).target).type),
  }));
  wrap(object(executor.runner), 'run', 'handler', eventDetails);
  wrap(object(service.targets), 'start', 'target.start', (args) => ({
    target: text(args[0]),
  }));
  wrap(object(service.targets), 'describe', 'target.describe', (args) => ({
    target: text(args[0]),
  }));
  wrap(service, 'recordEvent', 'recordEvent', eventDetails);
  wrap(service, 'reconcileOccurrences', 'reconcile');
  wrap(
    object(executor.runner),
    'emit',
    'event.enqueue',
    eventDetails,
    (args) => {
      const delivery = executor.delivery;
      if (typeof object(delivery).then !== 'function') return;
      if (deliveries.has(delivery as object)) return;
      deliveries.add(delivery as object);
      observeResult(delivery, begin('event.delivery', eventDetails(args)));
    },
  );
  for (const [token, method] of [
    [knowledgeServiceToken, 'parsePending'],
    [examServiceToken, 'autoSubmitExpired'],
    [sessionServiceToken, 'runMaintenance'],
    [practiceServiceToken, 'abandonIdle'],
    [automationTasksToken, 'explainIncrementalSync'],
  ] as const) {
    // Do not construct services just to observe them.
    const existing = application.container.resolveIfCreated<unknown>(token);
    wrap(object(existing), method, `maintenance.${method}`);
  }
  report('installed', { methods: restore.length });
  return {
    snapshot: () => ({
      schedulerRunning: size(backend.running),
      schedulerQueued: Array.isArray(backend.queue)
        ? backend.queue.length
        : undefined,
      schedulerPending: [...pending].map(([call, { started, ...entry }]) => ({
        call,
        ...entry,
        ms: performance.now() - started,
      })),
    }),
    restore: () => {
      for (const undo of restore.reverse()) undo();
    },
  };
}
