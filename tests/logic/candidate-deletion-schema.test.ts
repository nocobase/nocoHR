// @vitest-environment node
// 2026-10-07 readiness review: 202610200001 adds `candidates.deletionTokenHash` (indexed) and
// `deletionRequestedAt`. Its `up` leaves the index unnamed, so the builder calls it
// `idx_candidates_deletion_token_hash`, while its `down` drops `candidates_deletion_token_hash_index`:
// rolling the migration back fails and leaves both columns in place. The migration is merged, so it is
// not edited and no corrective migration can repair its `down` (AGENTS.md, “Migrations”); this test
// pins what the database holds so the documented workaround stays true.
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

it('names the deletion-token index idx_candidates_deletion_token_hash, which its down does not drop', async () => {
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
    // The down names an index that does not exist: the rollback fails and changes nothing.
    await expect(migrator.rollback()).rejects.toThrow(
      /candidates_deletion_token_hash_index/u,
    );
    expect(await indexes()).toContain('idx_candidates_deletion_token_hash');
    const columns = await db
      .query()
      .selectFrom('candidates')
      .select(['deletionTokenHash', 'deletionRequestedAt'])
      .limit(1)
      .execute();
    expect(columns).toEqual([]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
