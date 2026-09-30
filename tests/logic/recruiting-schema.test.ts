// @vitest-environment node
// V2-07: the recruiting migration creates its eight tables with their keys and unique constraints, and
// its `down` removes exactly them (on SQLite, without dropping named indexes) so a re-run converges.
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const MIGRATION = '202610090001_create_recruiting';
const tables = [
  'workforcePlans',
  'jobRequisitions',
  'jobPostings',
  'candidates',
  'applications',
  'interviews',
  'offers',
  'newHireCheckIns',
];
const stamp = {
  createdAt: '2026-10-09T00:00:00.000Z',
  updatedAt: '2026-10-09T00:00:00.000Z',
};

it('applies V2-07, enforces its unique keys and reverses cleanly', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-recruiting-schema-'));
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
    const directoryOfMigrations = path.resolve(import.meta.dirname, '../../database/main/migrations');
    const migrator = db.createMigrator({ directory: directoryOfMigrations, packageName: 'hr' });
    // Everything before V2-07 in one batch, V2-07 alone in the next, so a rollback reverses only it.
    const names = readdirSync(directoryOfMigrations)
      .filter((f) => /^\d{12}_.*\.ts$/u.test(f))
      .map((f) => f.replace(/\.ts$/u, ''))
      .sort();
    const previous = names[names.indexOf(MIGRATION) - 1];
    await migrator.upTo(previous);
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    for (const table of tables)
      expect(await db.collections().getPhysical(table)).toBeDefined();
    await db.repository('departments').createOne({
      values: { id: 'd', code: 'D', title: 'D', parentId: null, managerId: null, active: true, sortOrder: 0, ...stamp },
    });
    await db.repository('jobFamilies').createOne({
      values: { id: 'f', code: 'f', title: 'F', description: null, sortOrder: 0, ...stamp },
    }).catch(() => undefined);
    await db.repository('positions').createOne({
      values: { id: 'p', code: 'p', title: 'P', jobFamilyId: 'f', grade: null, active: true, sortOrder: 0, ...stamp },
    }).catch(() => undefined);
    const plan = {
      departmentId: 'd',
      positionId: 'p',
      month: '2026-11',
      plannedOutput: 100,
      source: 'api',
      calculation: {},
      calculationHash: 'h',
      status: 'calculated',
      ...stamp,
    };
    await db.repository('workforcePlans').createOne({ values: { id: 'w1', ...plan } });
    await expect(
      db.repository('workforcePlans').createOne({ values: { id: 'w2', ...plan } }),
    ).rejects.toThrow();
    const candidate = {
      name: 'C',
      sourceChannel: 'import',
      consentAt: stamp.createdAt,
      consentBy: 'recruiter',
      retentionUntil: '2028-10-09',
      lastActivityAt: stamp.createdAt,
      ...stamp,
    };
    await db.repository('candidates').createOne({ values: { id: 'c1', ...candidate } });
    const created = await db.repository('candidates').findOne({ filter: { id: 'c1' } });
    expect(created).toMatchObject({ parseStatus: 'none' });
    expect((await migrator.rollback()).rolledBack).toContain(MIGRATION);
    for (const table of tables)
      expect(await db.collections().getPhysical(table)).toBeUndefined();
    expect(await db.collections().getPhysical('employees')).toBeDefined();
    expect((await migrator.upTo(MIGRATION)).executed).toEqual([MIGRATION]);
    for (const table of tables)
      expect(await db.collections().getPhysical(table)).toBeDefined();
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
