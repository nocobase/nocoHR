// @vitest-environment node
// V4-13 migration 202610110001: applies over V4-12, adds trainingSessions.instructorProfileId (instructorUserId stays required), reverses cleanly.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const NAME = '202610110001_create_talent_review';
const TABLES = [
  'talentReviews',
  'talentPlacements',
  'successionPlans',
  'competencyModelVersions',
  'practicalAssessments',
  'practicalRecords',
  'certificationPracticals',
  'instructorProfiles',
  'trainingEvaluations',
  'knowledgeCandidates',
  'agentClients',
  'agentTokens',
  'agentCallLogs',
];

it('applies V4-13, converges and reverses', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-talent-review-schema-'));
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
    const migrator = db.createMigrator({
      directory: path.resolve(import.meta.dirname, '../../database/main/migrations'),
      packageName: 'hr',
    });
    await migrator.upTo('202610100001_create_performance');
    const stamp = { createdAt: new Date(), updatedAt: new Date() };
    await db
      .query()
      .insertInto('trainingSessions')
      .values({
        id: 's1',
        courseId: 'c1',
        title: 'Session',
        instructorUserId: 'u1',
        startAt: new Date(),
        endAt: new Date(),
        location: 'Room',
        capacity: 10,
        status: 'scheduled',
        ownerUserId: 'owner',
        ...stamp,
      })
      .execute();
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
    for (const table of TABLES)
      expect(await db.collections().getPhysical(table)).toBeDefined();
    await db
      .query()
      .insertInto('trainingSessions')
      .values({
        id: 's2',
        courseId: 'c1',
        title: 'External',
        instructorUserId: 'owner',
        instructorProfileId: 'p1',
        startAt: new Date(),
        endAt: new Date(),
        location: 'Room',
        capacity: 10,
        status: 'scheduled',
        ownerUserId: 'owner',
        ...stamp,
      })
      .execute();
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.rollback()).rolledBack).toEqual([NAME]);
    for (const table of TABLES)
      expect(await db.collections().getPhysical(table)).toBeUndefined();
    const restored = await db
      .query()
      .selectFrom('trainingSessions')
      .select(['id', 'instructorUserId'])
      .orderBy('id')
      .execute();
    expect(restored.map((r) => r.instructorUserId)).toEqual(['u1', 'owner']);
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
