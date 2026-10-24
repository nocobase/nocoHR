// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Application } from '@nocobase/app-server/application';
import { observeSchedulerClose } from '../helpers/scheduler-close-diagnostics.ts';
import { fixtureProviderStates } from '../helpers/close-diagnostics.ts';

function fixture() {
  const events: Record<string, unknown>[] = [];
  const backend = {
    running: new Set(),
    queue: [],
    file: { write: () => Promise.resolve() },
    close() {
      return this.file.write();
    },
    execute: () => Promise.resolve(),
  };
  const executor = {
    backend,
    runner: { run: () => Promise.resolve(), emit: () => {} },
    delivery: Promise.resolve(),
    shutdown: () => backend.close(),
  };
  const service = {
    targets: {
      start: () => Promise.resolve(),
      describe: () => Promise.resolve(),
    },
    recordEvent: () => Promise.resolve(),
    reconcileOccurrences: () => Promise.resolve(),
  };
  const application = {
    providerRegistry: {
      providers: [
        {
          provider: {
            name: '@nocobase/app-plugin-scheduler',
            internals: { executor, service },
          },
        },
      ],
    },
    container: { resolveIfCreated: () => undefined },
  } as unknown as Application;
  return { application, executor, backend, service, events };
}

const install = (f: ReturnType<typeof fixture>) =>
  observeSchedulerClose(f.application, 'diagnostic-test', (line) => {
    f.events.push(JSON.parse(line.slice('SCHEDULER_CLOSE '.length)));
  });

describe('scheduler close observer', () => {
  it('keeps the same pending promise and receiver, then restores methods', async () => {
    const f = fixture();
    let finish!: () => void;
    const originalResult = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const original = function (this: unknown) {
      expect(this).toBe(f.executor);
      return originalResult;
    };
    f.executor.shutdown = original;
    const observer = install(f);
    try {
      const result = f.executor.shutdown();
      expect(result).toBe(originalResult);
      expect(observer.snapshot().schedulerPending).toEqual([
        expect.objectContaining({ stage: 'executor.shutdown' }),
      ]);
      finish();
      await result;
      expect(observer.snapshot().schedulerPending).toEqual([]);
    } finally {
      observer.restore();
    }
    expect(f.executor.shutdown).toBe(original);
  });

  it('keeps original synchronous and asynchronous errors', async () => {
    const f = fixture();
    const error = new Error('controlled failure');
    f.service.targets.start = () => {
      throw error;
    };
    const rejected = Promise.reject(error);
    f.service.recordEvent = () => rejected;
    const observer = install(f);
    try {
      expect(() => f.service.targets.start()).toThrow(error);
      const result = f.service.recordEvent();
      expect(result).toBe(rejected);
      await expect(result).rejects.toBe(error);
      expect(observer.snapshot().schedulerPending).toEqual([]);
      expect(
        f.events.filter((e) => String(e.event).endsWith('.failed')),
      ).toHaveLength(2);
    } finally {
      observer.restore();
    }
  });

  it('separates backend/state and event-delivery stages without logging payloads', async () => {
    const f = fixture();
    const observer = install(f);
    try {
      await f.executor.shutdown();
      f.executor.runner.emit();
      await f.executor.delivery;
      expect(observer.snapshot().schedulerPending).toEqual([]);
      const labels = f.events.map((e) => e.event);
      for (const stage of [
        'executor.shutdown',
        'backend.close',
        'state.write',
        'event.enqueue',
        'event.delivery',
      ]) {
        expect(labels).toContain(`${stage}.begin`);
        expect(labels).toContain(`${stage}.done`);
      }
      const begin = f.events.find((e) => e.event === 'backend.close.begin');
      expect(begin).toMatchObject({ running: 0, queued: 0 });
      expect(JSON.stringify(f.events)).not.toMatch(
        /payload|password|authorization/iu,
      );
    } finally {
      observer.restore();
    }
  });
});

describe('fixture dependency state snapshots', () => {
  it('can include released dependencies without changing provider states', () => {
    const entries = [
      { provider: { name: 'mail' }, state: 'ready' },
      { provider: { name: 'agents' }, state: 'shutdown' },
    ];
    const application = {
      providerRegistry: { providers: entries },
    } as unknown as Application;
    expect(fixtureProviderStates(application)).toEqual([
      { name: 'mail', state: 'ready' },
    ]);
    const snapshot = fixtureProviderStates(application, true);
    expect(snapshot).toEqual([
      { name: 'mail', state: 'ready' },
      { name: 'agents', state: 'shutdown' },
    ]);
    snapshot[0]!.state = 'observation-only';
    expect(entries[0]!.state).toBe('ready');
    expect(fixtureProviderStates()).toEqual([]);
  });
});
