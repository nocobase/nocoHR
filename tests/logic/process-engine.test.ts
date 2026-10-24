import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
  ProcessEngine,
  validateProcessDefinition,
  type ProcessDefinition,
  type ProcessRun,
  type ProcessStore,
  type ProcessHandler,
} from '../../server/providers/processes/engine.js';

function fixture() {
  const rows = new Map<string, ProcessRun>();
  const store: ProcessStore = {
    async accept(run) {
      if (!rows.has(run.eventKey))
        rows.set(
          run.eventKey,
          structuredClone({ ...run, definition: undefined }) as ProcessRun,
        );
      const row = rows.get(run.eventKey)!;
      row.definition ??= run.definition;
      return { ...row };
    },
    async find(key) {
      const row = rows.get(key);
      return row && { ...row, output: { ...row.output } };
    },
    async claim(key, node) {
      const row = rows.get(key)!;
      if (row.status !== 'accepted' || row.next !== node) return false;
      row.status = 'running';
      return true;
    },
    async finishNode(key, node, result, next) {
      const row = rows.get(key)!;
      row.output[node] = result;
      row.next = next;
      row.status = 'accepted';
    },
    async finishRun(key, status) {
      rows.get(key)!.status = status;
    },
  };
  const work = vi.fn<ProcessHandler>(async () => 'saved');
  const handlers = new Map<string, ProcessHandler>([
    ['work', work],
    ['condition', vi.fn(async () => true)],
  ]);
  const authorize = vi.fn(async () => undefined);
  const definition: ProcessDefinition = {
    key: 'review',
    hash: 'revision-one',
    enabled: true,
    inputSchema: z.strictObject({ value: z.string() }),
    entry: 'check',
    nodes: [
      {
        key: 'check',
        type: 'condition',
        handler: 'condition',
        yes: 'save',
        no: 'stop',
      },
      { key: 'save', type: 'run', handler: 'work', next: 'done' },
      { key: 'done', type: 'terminate', outcome: 'success' },
      { key: 'stop', type: 'terminate', outcome: 'failed' },
    ],
  };
  return {
    engine: new ProcessEngine(store, handlers, authorize),
    store,
    rows,
    work,
    handlers,
    authorize,
    definition,
  };
}

describe('durable process execution', () => {
  it('deduplicates events and concurrent dispatch without repeating a node', async () => {
    const f = fixture();
    await Promise.all([
      f.engine.trigger(f.definition, { value: 'data' }, 'event'),
      f.engine.trigger(f.definition, { value: 'data' }, 'event'),
    ]);
    await f.engine.step('event');
    await Promise.all([f.engine.step('event'), f.engine.step('event')]);
    await f.engine.step('event');
    expect(f.work).toHaveBeenCalledTimes(1);
    expect(f.rows.get('event')?.status).toBe('success');
    expect(f.work.mock.calls[0]).toEqual([
      {
        input: { value: 'data' },
        upstream: { check: true },
        idempotencyKey: '["event","save"]',
      },
    ]);
  });

  it('rejects disabled definitions, missing handlers, bad input and changed event revisions', async () => {
    const f = fixture();
    await expect(
      f.engine.trigger(
        { ...f.definition, enabled: false },
        { value: 'data' },
        'event',
      ),
    ).rejects.toThrow('PROCESS_DISABLED');
    await expect(
      f.engine.trigger(f.definition, { value: 42 }, 'event'),
    ).rejects.toThrow('INVALID_PROCESS_INPUT');
    expect(() => validateProcessDefinition(f.definition, new Map())).toThrow(
      'PROCESS_HANDLER_NOT_AVAILABLE',
    );
    await f.engine.trigger(f.definition, { value: 'data' }, 'event');
    await expect(
      f.engine.trigger(
        { ...f.definition, hash: 'other' },
        { value: 'data' },
        'event',
      ),
    ).rejects.toThrow('PROCESS_EVENT_CONFLICT');
    await expect(
      f.engine.trigger(f.definition, { value: 'other input' }, 'event'),
    ).rejects.toThrow('PROCESS_EVENT_CONFLICT');
  });

  it('does not retry uncertain side effects after a worker failure', async () => {
    const f = fixture();
    await f.engine.trigger(f.definition, { value: 'data' }, 'event');
    await f.engine.step('event');
    f.work.mockRejectedValueOnce(new Error('reply lost after commit'));
    await expect(f.engine.step('event')).rejects.toThrow('reply lost');
    await f.engine.step('event');
    expect(f.rows.get('event')?.status).toBe('uncertain');
    expect(f.work).toHaveBeenCalledTimes(1);
  });

  it('rejects a cycle before executing any handler', () => {
    const f = fixture();
    expect(() =>
      validateProcessDefinition(
        {
          ...f.definition,
          entry: 'cycle',
          nodes: [
            { key: 'cycle', type: 'run', handler: 'work', next: 'cycle' },
          ],
        },
        f.handlers,
      ),
    ).toThrow('PROCESS_CYCLE');
    expect(f.work).not.toHaveBeenCalled();
  });

  it('keeps accepted state across engine instances', async () => {
    const f = fixture();
    await f.engine.trigger(f.definition, { value: 'data' }, 'event');
    await f.engine.step('event');
    const restarted = new ProcessEngine(f.store, f.handlers, f.authorize);
    await restarted.step('event');
    await restarted.step('event');
    expect(f.rows.get('event')?.output).toEqual({ check: true, save: 'saved' });
  });
});
