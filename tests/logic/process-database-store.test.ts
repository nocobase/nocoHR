// @vitest-environment node
import { fileURLToPath } from 'node:url';

import {
  createDatabaseTest,
  describeMigration,
} from '@nocobase/app-testing/server';
import { expect, vi } from 'vitest';
import { z } from 'zod';

import { DatabaseProcessStore } from '../../server/providers/processes/database-store.js';
import {
  ProcessEngine,
  type ProcessDefinition,
  type ProcessHandler,
} from '../../server/providers/processes/engine.js';

const sources = [
  {
    packageName: 'test/capability-state',
    directory: fileURLToPath(
      new URL('../fixtures/capability-migrations', import.meta.url),
    ),
  },
];
const test = createDatabaseTest({ migrations: sources });

describeMigration('202610270032_create_process_execution_state', {
  sources,
  async up({ expectCollection }) {
    await expectCollection('processRuns').toHaveIndex(['eventKey'], {
      unique: true,
    });
    await expectCollection('processNodeRuns').toHaveField('runId');
  },
  async down({ expectCollection }) {
    await expectCollection('processRuns').not.toExist();
    await expectCollection('processNodeRuns').not.toExist();
  },
});

const definition: ProcessDefinition = {
  key: 'approval',
  hash: 'revision',
  enabled: true,
  inputSchema: z.strictObject({ text: z.string() }),
  entry: 'write',
  nodes: [
    { key: 'write', type: 'run', handler: 'write', next: 'done' },
    { key: 'done', type: 'terminate', outcome: 'success' },
  ],
};

test('persists node results across workers and deduplicates concurrent acceptance and execution', async ({
  connection,
}) => {
  const resolve = async () => definition;
  const first = new DatabaseProcessStore(connection, resolve);
  const second = new DatabaseProcessStore(connection, resolve);
  const work = vi.fn<ProcessHandler>(async () => ({ saved: true }));
  const handlers = new Map([['write', work]]);
  const engine = new ProcessEngine(first, handlers, async () => undefined);
  const restarted = new ProcessEngine(second, handlers, async () => undefined);
  await Promise.all([
    engine.trigger(definition, { text: 'draft' }, 'event'),
    restarted.trigger(definition, { text: 'draft' }, 'event'),
  ]);
  await Promise.all([engine.step('event'), restarted.step('event')]);
  await restarted.step('event');
  expect(work).toHaveBeenCalledTimes(1);
  expect(await second.find('event')).toMatchObject({
    status: 'success',
    output: { write: { saved: true } },
  });
  expect(await connection.repository('processRuns').count()).toBe(1);
  expect(await connection.repository('processNodeRuns').count()).toBe(2);
  await expect(
    restarted.trigger(definition, { text: 'different' }, 'event'),
  ).rejects.toThrow('PROCESS_EVENT_CONFLICT');
});

test('refuses changed artifacts and never replays a running node after a worker disappears', async ({
  connection,
}) => {
  const store = new DatabaseProcessStore(connection, async () => definition);
  const work = vi.fn<ProcessHandler>(async () => true);
  const engine = new ProcessEngine(
    store,
    new Map([['write', work]]),
    async () => undefined,
  );
  await engine.trigger(definition, { text: 'draft' }, 'event');
  expect(await store.claim('event', 'write')).toBe(true);
  await engine.step('event');
  expect(work).not.toHaveBeenCalled();
  expect((await store.find('event'))?.status).toBe('running');
  const changed = new DatabaseProcessStore(connection, async () => ({
    ...definition,
    nodes: [],
  }));
  await expect(changed.find('event')).rejects.toThrow(
    'PROCESS_ARTIFACT_CHANGED',
  );
  await store.finishRun('event', 'uncertain');
  expect((await store.find('event'))?.status).toBe('uncertain');
});
