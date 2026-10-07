// @vitest-environment node
// 上线准备: 202610270021 creates the activation links (one row per link, the token's hash unique) and their audit
// log, and its `down` drops exactly them.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const MIGRATION = '202610270021_create_account_activations';

it('creates the activation tables and reverses cleanly', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'account-activation-schema-'),
  );
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({
        filename: path.join(directory, 'test.sqlite'),
        schemaManagement: 'managed',
      }),
    },
    metadataStore: new InMemoryCollectionMetadataStore(),
  });
  try {
    const migrations = path.resolve(
      import.meta.dirname,
      '../../database/main/migrations',
    );
    const migrator = db.createMigrator({
      directory: migrations,
      packageName: 'hr',
    });
    const names = readdirSync(migrations)
      .filter((f) => /^\d{12}_.*\.ts$/u.test(f))
      .map((f) => f.replace(/\.ts$/u, ''))
      .sort();
    await migrator.upTo(names[names.indexOf(MIGRATION) - 1]);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    const now = new Date();
    const link = {
      id: 'a1',
      employeeId: 'e1',
      userId: 'u1',
      tokenHash: 'f'.repeat(64),
      expiresAt: now,
      usedAt: null,
      revokedAt: null,
      revokedReason: null,
      channel: 'manual',
      deliveryStatus: 'manual',
      sentTo: null,
      createdBy: 'hr',
      createdAt: now,
      updatedAt: now,
    };
    await db.query().insertInto('accountActivations').values(link).execute();
    await expect(
      db
        .query()
        .insertInto('accountActivations')
        .values({ ...link, id: 'a2' })
        .execute(),
    ).rejects.toThrow();
    await db
      .query()
      .insertInto('accountActivationEvents')
      .values({
        id: 'v1',
        activationId: 'a1',
        employeeId: 'e1',
        userId: 'u1',
        event: 'issued',
        channel: null,
        actorUserId: 'hr',
        ip: null,
        detail: null,
        createdAt: now,
      })
      .execute();
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.rollback()).rolledBack).toEqual([MIGRATION]);
    for (const table of ['accountActivations', 'accountActivationEvents'])
      await expect(
        db.query().selectFrom(table).selectAll().execute(),
      ).rejects.toThrow();
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
