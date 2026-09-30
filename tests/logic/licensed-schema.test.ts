// @vitest-environment node
// V4-14 migration 202610120001: shifts.requiredCertificationIds and the start log's kind and machine number; applies
// over V4-13, keeps existing rows, and reverses by dropping only the columns it added.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const NAME = '202610120001_licensed_operation';

it('applies V4-14, converges and reverses', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-licensed-schema-'));
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
      directory:
        process.env.LICENSED_MIGRATIONS_DIR ??
        path.resolve(import.meta.dirname, '../../database/main/migrations'),
      packageName: 'hr',
    });
    await migrator.upTo('202610110001_create_talent_review');
    const stamp = { createdAt: new Date(), updatedAt: new Date() };
    await db
      .query()
      .insertInto('shifts')
      .values({
        id: 'shift-1',
        code: 'early',
        title: 'Early',
        startTime: '06:00:00',
        endTime: '14:00:00',
        breakMinutes: 30,
        isNight: false,
        departmentIds: null,
        active: true,
        ...stamp,
      })
      .execute();
    await db
      .query()
      .insertInto('demoBatchSignoffs')
      .values({
        id: 'log-1',
        batchNo: 'MO-24031',
        step: 'op20',
        employeeId: 'e1',
        userId: 'u1',
        signedAt: new Date(),
        certificateId: 'c1',
        certificateNo: 'CNC-OP-2026-00001',
        certificateStatus: 'valid',
        ...stamp,
      })
      .execute();
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
    await db
      .query()
      .updateTable('shifts')
      .set({ requiredCertificationIds: ['cert-cnc'] })
      .where('id', '=', 'shift-1')
      .execute();
    await db
      .query()
      .insertInto('demoBatchSignoffs')
      .values({
        id: 'log-2',
        batchNo: 'CK-24031',
        step: 'dispatch',
        employeeId: 'e1',
        userId: 'u1',
        signedAt: new Date(),
        certificateId: 'c2',
        certificateNo: 'EXT-1',
        certificateStatus: 'valid',
        kind: 'forkliftDispatch',
        machineNo: 'FL-03',
        ...stamp,
      })
      .execute();
    const shift = await db
      .query()
      .selectFrom('shifts')
      .select(['requiredCertificationIds'])
      .where('id', '=', 'shift-1')
      .executeTakeFirst();
    let required: unknown = shift?.requiredCertificationIds;
    for (let i = 0; i < 2 && typeof required === 'string'; i++)
      required = JSON.parse(required);
    expect(required).toEqual(['cert-cnc']);
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.rollback()).rolledBack).toEqual([NAME]);
    const rows = await db
      .query()
      .selectFrom('demoBatchSignoffs')
      .select(['id', 'certificateNo'])
      .orderBy('id')
      .execute();
    expect(rows.map((r) => r.id)).toEqual(['log-1', 'log-2']);
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
