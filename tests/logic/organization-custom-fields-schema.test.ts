// @vitest-environment node
// Migration 202610210001: customFields on departments and positions; applies over the earlier history, keeps existing
// rows, stores added-field values, and reverses by dropping only the two columns it added.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { expect, it } from 'vitest';

const NAME = '202610210001_extend_custom_fields_organization';

const decode = (value: unknown): unknown => {
  let v = value;
  for (let i = 0; i < 2 && typeof v === 'string'; i++) v = JSON.parse(v);
  return v;
};

it('adds customFields to departments and positions, and reverses', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'hr-org-custom-schema-'));
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
      directory: path.resolve(
        import.meta.dirname,
        '../../database/main/migrations',
      ),
      packageName: 'hr',
    });
    await migrator.upTo('202610200002_recruiting_source_name');
    const stamp = { createdAt: new Date(), updatedAt: new Date() };
    await db
      .query()
      .insertInto('departments')
      .values({
        id: 'store-1',
        code: 'S001',
        title: '南京东路店',
        parentId: null,
        managerId: null,
        active: true,
        sortOrder: 0,
        ...stamp,
      })
      .execute();
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
    await db.repository('departments').updateOne({
      filter: { id: 'store-1' },
      values: { customFields: { storeArea: 320 } },
    });
    const department = await db
      .query()
      .selectFrom('departments')
      .select(['title', 'customFields'])
      .where('id', '=', 'store-1')
      .executeTakeFirstOrThrow();
    expect(department.title).toBe('南京东路店');
    expect(decode(department.customFields)).toEqual({ storeArea: 320 });
    const positionColumns = await db
      .query()
      .selectFrom('positions')
      .select(['id', 'customFields'])
      .execute();
    expect(positionColumns).toEqual([]);
    expect((await db.collections().diagnose()).issues).toEqual([]);

    expect((await migrator.rollback()).rolledBack).toEqual([NAME]);
    const kept = await db
      .query()
      .selectFrom('departments')
      .selectAll()
      .where('id', '=', 'store-1')
      .executeTakeFirstOrThrow();
    expect(kept.code).toBe('S001');
    expect('customFields' in kept).toBe(false);
    expect((await db.collections().diagnose()).issues).toEqual([]);
    expect((await migrator.upTo(NAME)).executed).toEqual([NAME]);
  } finally {
    await db.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
}, 120_000);
