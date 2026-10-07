// @vitest-environment node
// 202610200001 adds `candidates.deletionTokenHash` (indexed) and `deletionRequestedAt`. Its `up` leaves the
// index unnamed, so the builder calls it `idx_candidates_deletion_token_hash`. Its `down` used to drop
// `candidates_deletion_token_hash_index`, which never existed, so rolling back failed; the `down` was corrected
// on 2026-10-07 with the user's approval. This test keeps up and down symmetric.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const MIGRATION = '202610200001_candidate_deletion_requests';

/** The part of the query builder this test uses on SQLite's catalogue. */
interface IndexQuery {
  where(column: string, op: '=', value: string): IndexQuery;
  execute(): Promise<{ name: string }[]>;
}
interface SqliteMaster {
  selectFrom(table: string): { select(columns: string[]): IndexQuery };
}

it('creates idx_candidates_deletion_token_hash and drops it again on down', async () => {
  const directory = mkdtempSync(
    path.join(tmpdir(), 'candidate-deletion-schema-'),
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
    const indexes = async () =>
      (
        await (db.query() as unknown as SqliteMaster)
          .selectFrom('sqlite_master')
          .select(['name'])
          .where('tbl_name', '=', 'candidates')
          .where('type', '=', 'index')
          .execute()
      ).map((row) => row.name);
    expect(await indexes()).toContain('idx_candidates_deletion_token_hash');
    expect(await indexes()).not.toContain(
      'candidates_deletion_token_hash_index',
    );
    // The down drops the index and both columns, and the migration applies again afterwards.
    expect((await migrator.rollback()).rolledBack).toContain(MIGRATION);
    expect(await indexes()).not.toContain('idx_candidates_deletion_token_hash');
    await expect(
      db
        .query()
        .selectFrom('candidates')
        .select(['deletionTokenHash'])
        .limit(1)
        .execute(),
    ).rejects.toThrow();
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    expect(await indexes()).toContain('idx_candidates_deletion_token_hash');
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
