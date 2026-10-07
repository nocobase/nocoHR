// @vitest-environment node
// 初始数据导入 (上线准备): 202610270001 creates `dataImportBatches` and adds `positions.departmentId`, and its
// `down` removes exactly them, so a re-run converges.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const MIGRATION = '202610270001_create_data_import_batches';

it('creates the import batches and the position department, and reverses cleanly', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-data-import-schema-'));
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
    const now = new Date();
    await db
      .query()
      .insertInto('jobFamilies')
      .values({
        id: 'jf-1',
        code: 'office',
        title: '职能序列',
        description: null,
        active: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    await db
      .query()
      .insertInto('positions')
      .values({
        id: 'pos-1',
        code: 'hr',
        title: '人事专员',
        jobFamilyId: 'jf-1',
        active: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    const position = () =>
      db
        .query()
        .selectFrom('positions')
        .selectAll()
        .where('id', '=', 'pos-1')
        .executeTakeFirstOrThrow();
    expect('departmentId' in (await position())).toBe(false);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    expect(await position()).toMatchObject({ departmentId: null });
    await db
      .query()
      .insertInto('dataImportBatches')
      .values({
        id: 'IMP-DEP-20261027-0001',
        kind: 'departments',
        importedByUserId: 'u1',
        createdCount: 1,
        updatedCount: 0,
        unchangedCount: 0,
        recordIds: { created: ['d1'], updated: [] },
        createdAt: now,
        updatedAt: now,
      })
      .execute();
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.rollback()).rolledBack).toEqual([MIGRATION]);
    const kept = await position();
    expect(kept.title).toBe('人事专员');
    expect('departmentId' in kept).toBe(false);
    await expect(
      db.query().selectFrom('dataImportBatches').selectAll().execute(),
    ).rejects.toThrow();
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
