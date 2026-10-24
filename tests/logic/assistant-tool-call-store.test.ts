// @vitest-environment node
import { fileURLToPath } from 'node:url';

import {
  createDatabaseTest,
  describeMigration,
} from '@nocobase/app-testing/server';
import { expect } from 'vitest';

import { DatabaseToolCallStore } from '../../server/providers/assistant/tool-call-store.js';
import {
  toolArgumentDigest,
  type StoredToolCall,
} from '../../server/providers/assistant/tool-executor.js';
import { copyCapabilityRecord } from '../../server/providers/upgrade/ledger.js';

const sources = [
  {
    packageName: 'test/capability-state',
    directory: fileURLToPath(
      new URL('../fixtures/capability-migrations', import.meta.url),
    ),
  },
];
const test = createDatabaseTest({ migrations: sources });

describeMigration('202610270031_create_capability_migration_state', {
  sources,
  async up({ expectCollection }) {
    await expectCollection('assistantToolCalls').toHaveField('arguments');
    await expectCollection('capabilityMigrationLedger').toHaveIndex(
      ['sourcePackage', 'sourceCollection', 'sourceKey'],
      { unique: true },
    );
  },
  async down({ expectCollection }) {
    await expectCollection('assistantToolCalls').not.toExist();
    await expectCollection('capabilityMigrationLedger').not.toExist();
  },
});

test('copies a record once, preserves new state on replay and rolls back failed ledger writes', async ({
  connection,
}) => {
  const call: StoredToolCall = {
    id: 'copied',
    userId: 'owner',
    sessionId: 'session',
    employee: 'hrAssistant',
    tool: 'saveDraft',
    arguments: { text: 'draft' },
    argumentDigest: toolArgumentDigest({ text: 'draft' }),
    status: 'pending',
  };
  const identity = {
    sourcePackage: 'legacy',
    sourceVersion: '1',
    sourceCollection: 'toolCalls',
    sourceKey: 'old-call',
    targetCollection: 'assistantToolCalls',
    targetKey: call.id,
  };
  const copy = async (transaction: typeof connection) =>
    new DatabaseToolCallStore(transaction).create(call);
  expect(await copyCapabilityRecord(connection, identity, call, copy)).toBe(
    'copied',
  );
  const store = new DatabaseToolCallStore(connection);
  await store.claim(call.id, 'pending', 'rejected');
  expect(await copyCapabilityRecord(connection, identity, call, copy)).toBe(
    'unchanged',
  );
  expect((await store.find(call.id))?.status).toBe('rejected');
  await expect(
    copyCapabilityRecord(
      connection,
      identity,
      { ...call, employee: 'changed' },
      copy,
    ),
  ).rejects.toThrow('CAPABILITY_MIGRATION_CONFLICT');

  const failedCall = { ...call, id: 'failed-copy' };
  await expect(
    copyCapabilityRecord(
      connection,
      { ...identity, sourceKey: 'failed', targetKey: failedCall.id },
      failedCall,
      async (transaction) => {
        await new DatabaseToolCallStore(transaction).create(failedCall);
        throw new Error('conversion failed');
      },
    ),
  ).rejects.toThrow('conversion failed');
  expect(await store.find(failedCall.id)).toBeUndefined();
  expect(await connection.repository('capabilityMigrationLedger').count()).toBe(
    1,
  );
});

test('persists tool state across store instances and atomically claims one execution', async ({
  connection,
}) => {
  const original = new DatabaseToolCallStore(connection);
  const call: StoredToolCall = {
    id: 'call',
    userId: 'owner',
    sessionId: 'session',
    employee: 'hrAssistant',
    tool: 'saveDraft',
    arguments: { text: 'draft' },
    argumentDigest: toolArgumentDigest({ text: 'draft' }),
    status: 'pending',
  };
  await original.create(call);
  const reopened = new DatabaseToolCallStore(connection);
  expect(await reopened.find('call')).toEqual({ ...call, auto: false });
  const claims = await Promise.all([
    original.claim('call', 'pending', 'executing'),
    reopened.claim('call', 'pending', 'executing'),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await reopened.complete('call', { id: 'draft' });
  expect((await original.find('call'))?.status).toBe('completed');
  expect((await original.find('call'))?.result).toEqual({ id: 'draft' });
  await expect(original.complete('call', {})).rejects.toThrow(
    'TOOL_CALL_STATE_CONFLICT',
  );
});
