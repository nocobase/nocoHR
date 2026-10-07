// @vitest-environment node
// S3/S5 (2026-10-07 readiness review): 202610250001 adds `hrFiles.purpose` and `uploadedByUserId` with their index,
// and its `down` removes exactly them, so a re-run converges.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const MIGRATION = '202610250001_hr_file_purpose';

it('adds the upload purpose and uploader to hrFiles and reverses cleanly', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-file-purpose-schema-'));
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
    const file = {
      id: '00000000-0000-4000-8000-0000000000aa',
      disk: 'local',
      key: 'objects/a.pdf',
      filename: 'a.pdf',
      ext: 'pdf',
      mimeType: 'application/pdf',
      size: 1,
      createdAt: now,
      updatedAt: now,
    };
    await db.query().insertInto('hrFiles').values(file).execute();
    const row = () =>
      db
        .query()
        .selectFrom('hrFiles')
        .selectAll()
        .where('id', '=', file.id)
        .executeTakeFirstOrThrow();
    expect('purpose' in (await row())).toBe(false);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    // Rows from before the migration keep both empty.
    expect(await row()).toMatchObject({
      purpose: null,
      uploadedByUserId: null,
    });
    await db
      .query()
      .updateTable('hrFiles')
      .set({ purpose: 'contract', uploadedByUserId: 'u1' })
      .where('id', '=', file.id)
      .execute();
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.rollback()).rolledBack).toEqual([MIGRATION]);
    const kept = await row();
    expect(kept.filename).toBe('a.pdf');
    expect('purpose' in kept).toBe(false);
    expect('uploadedByUserId' in kept).toBe(false);
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
