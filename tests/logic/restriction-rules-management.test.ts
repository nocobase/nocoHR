// @vitest-environment node
import { findPackageJSON } from 'node:module';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import {
  createDatabaseManager,
  InMemoryCollectionMetadataStore,
} from '@nocobase/db';
import { sqlite } from '@nocobase/db-sqlite';
import { createAppAuthorization } from '@nocobase/app-plugin-authorization/server';
import { restrictionRules } from '@nocobase/app-plugin-authz-restriction-rules/server';
import type { RestrictionRule } from '@nocobase/authorization/restriction-rules';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const db = createDatabaseManager({
    default: 'main',
    connections: {
      main: sqlite({ filename: ':memory:', schemaManagement: 'managed' }),
    },
    metadataStore: new InMemoryCollectionMetadataStore(),
  });
  cleanup.push(() => db.destroy());
  const authManifest = findPackageJSON(
    '@nocobase/app-plugin-authorization/server',
    import.meta.url,
  );
  const restrictionManifest = findPackageJSON(
    '@nocobase/app-plugin-authz-restriction-rules/server',
    import.meta.url,
  );
  if (!authManifest || !restrictionManifest)
    throw new Error('Missing target authorization packages');
  await db
    .createMigrator({
      sources: [
        {
          packageName: '@nocobase/app-plugin-authorization',
          directory: path.join(
            path.dirname(authManifest),
            'dist/database/migrations',
          ),
        },
        {
          packageName: '@nocobase/app-plugin-authz-restriction-rules',
          directory: path.join(
            path.dirname(restrictionManifest),
            'dist/database/migrations',
          ),
        },
      ],
    })
    .latest();
  await db.builder().createCollection('employees', (collection) => {
    collection.string('id').primary();
    collection.string('name');
  });

  const authz = createAppAuthorization({
    database: db,
    connection: db.connection(),
    config: { plugins: [restrictionRules()] },
  });
  authz.database.collections.add({ name: 'employees', title: 'Employees' });
  const users = [
    'manager',
    'reader',
    'writer',
    'deleter',
    'outsider',
    'alice',
    'bob',
  ];
  authz.subjects.add('user', {
    filterActive: async (ids) => ids.filter((id) => users.includes(id)),
    administration: {
      title: 'User',
      selection: {
        type: 'collection',
        list: async ({ page, pageSize }) => ({
          items: users
            .slice((page - 1) * pageSize, page * pageSize)
            .map((id) => ({ id, title: id })),
          total: users.length,
        }),
        resolve: async (ids) =>
          ids
            .filter((id) => users.includes(id))
            .map((id) => ({ id, title: id })),
      },
    },
  });

  const grants = [
    ['manager', ['read', 'create', 'update', 'delete']],
    ['reader', ['read']],
    ['writer', ['read', 'update']],
    ['deleter', ['read', 'delete']],
  ] as const;
  for (const [key, actions] of grants) {
    await authz.permissionSets.create({
      key,
      grants: [
        authz.settings.grant('authorization.restriction-rules', actions),
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: key },
    });
  }

  const sql: string[] = [];
  const client = await db.connection().client<{
    on: (event: string, listener: (query: { sql: string }) => void) => void;
  }>();
  client.on('query', (query) => sql.push(query.sql));
  const costs: {
    user: string;
    path: string;
    method: string;
    select: number;
    writes: number;
    transactions: number;
  }[] = [];
  const request = async (
    user: string,
    route: string,
    method = 'GET',
    body?: unknown,
  ) => {
    const before = sql.length;
    const url = new URL(`http://isolated.invalid${route}`);
    const response = await authz.routes.handle({
      path: url.pathname,
      request: new Request(url, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            }),
      }),
      authorization: authz.for({ principal: { type: 'user', id: user } }),
    });
    if (!response)
      throw new Error(`Unregistered restriction-rules route ${route}`);
    const current = sql.slice(before);
    costs.push({
      user,
      path: route,
      method,
      select: current.filter((statement) => /^\s*select/iu.test(statement))
        .length,
      writes: current.filter((statement) =>
        /^\s*(?:insert|update|delete)/iu.test(statement),
      ).length,
      transactions: current.filter((statement) => /^\s*begin/iu.test(statement))
        .length,
    });
    return response;
  };
  return { authz, request, costs };
}

function rule(overrides: Partial<RestrictionRule> = {}): RestrictionRule {
  return {
    key: 'employee-handover',
    title: 'Employee handover',
    resource: { type: 'database.collection', id: 'employees' },
    subjects: [{ type: 'user', id: 'alice' }],
    actions: [
      {
        action: 'read',
        selection: { type: 'records', ids: ['employee-1'] },
      },
    ],
    reason: 'Cover an assigned handover',
    ...overrides,
  };
}

it('uses native action permissions for restricted reads, creates, updates and deletes', async () => {
  const { request, costs } = await fixture();
  const created = await request('manager', '/restrictionRules', 'POST', rule());
  expect(created.status).toBe(201);
  const createdBody = (await created.json()) as { data: RestrictionRule };
  expect(createdBody.data).toMatchObject({
    key: 'employee-handover',
  });

  expect((await request('reader', '/restrictionRules')).status).toBe(200);
  expect((await request('reader', '/restrictionRules/options')).status).toBe(
    200,
  );
  expect(
    (await request('reader', '/restrictionRules/subjects/user')).status,
  ).toBe(200);
  expect(
    (await request('reader', '/restrictionRules/records/employees')).status,
  ).toBe(200);
  expect(
    (
      await request(
        'reader',
        '/restrictionRules',
        'POST',
        rule({ key: 'reader-create' }),
      )
    ).status,
  ).toBe(403);
  expect((await request('outsider', '/restrictionRules')).status).toBe(403);
  expect(
    (
      await request(
        'outsider',
        '/restrictionRules',
        'POST',
        rule({ key: 'outsider-create' }),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await request(
        'outsider',
        '/restrictionRules/employee-handover',
        'PATCH',
        {
          title: 'Denied',
        },
      )
    ).status,
  ).toBe(403);
  expect(
    (await request('outsider', '/restrictionRules/employee-handover', 'DELETE'))
      .status,
  ).toBe(403);

  const update = await request(
    'writer',
    '/restrictionRules/employee-handover',
    'PATCH',
    {
      title: 'Updated handover',
    },
  );
  expect(update.status).toBe(200);
  const updatedBody = (await update.json()) as { data: RestrictionRule };
  const updated = updatedBody.data;
  expect(updated.title).toBe('Updated handover');
  expect(updated.actions).toEqual(rule().actions);
  expect(updated.subjects).toEqual(rule().subjects);
  expect(
    (
      await request('reader', '/restrictionRules/employee-handover', 'PATCH', {
        title: 'Denied',
      })
    ).status,
  ).toBe(403);
  expect(
    (await request('deleter', '/restrictionRules/employee-handover', 'DELETE'))
      .status,
  ).toBe(204);
  expect(
    (await request('writer', '/restrictionRules/employee-handover', 'DELETE'))
      .status,
  ).toBe(403);
  expect((await request('reader', '/restrictionRules')).status).toBe(200);
  expect(
    costs
      .filter(
        (item) =>
          ['reader', 'outsider'].includes(item.user) && item.method !== 'GET',
      )
      .every((item) => item.writes === 0),
  ).toBe(true);
  console.log('RESTRICTION_COSTS', JSON.stringify(costs));
});

it('allows all-record restrictions and key renames but rejects invalid rules without writing', async () => {
  const { request, costs } = await fixture();
  const allRecords = await request(
    'manager',
    '/restrictionRules',
    'POST',
    rule({
      key: 'all-records',
      actions: [{ action: 'read', selection: { type: 'all' } }],
    }),
  );
  expect(allRecords.status).toBe(201);
  expect(await allRecords.json()).toMatchObject({
    data: { actions: [{ action: 'read', selection: { type: 'all' } }] },
  });

  const renamed = await request(
    'writer',
    '/restrictionRules/all-records',
    'PATCH',
    { key: 'renamed-all-records' },
  );
  expect(renamed.status).toBe(200);
  expect(await renamed.json()).toMatchObject({
    data: {
      key: 'renamed-all-records',
      actions: [{ action: 'read', selection: { type: 'all' } }],
    },
  });

  const duplicateSubject = await request(
    'manager',
    '/restrictionRules',
    'POST',
    rule({
      key: 'duplicate-subject',
      subjects: [
        { type: 'user', id: 'alice' },
        { type: 'user', id: 'alice' },
      ],
    }),
  );
  expect(duplicateSubject.status).toBe(400);
  expect(await duplicateSubject.json()).toMatchObject({
    error: { reason: 'INVALID_INPUT' },
  });
  const reservedKey = await request(
    'manager',
    '/restrictionRules',
    'POST',
    rule({ key: 'options' }),
  );
  expect(reservedKey.status).toBe(400);
  expect(await reservedKey.json()).toMatchObject({
    error: { reason: 'INVALID_INPUT' },
  });
  expect(costs.slice(-2).every((item) => item.writes === 0)).toBe(true);
  console.log('RESTRICTION_VALIDATION_COSTS', JSON.stringify(costs.slice(-2)));
});
