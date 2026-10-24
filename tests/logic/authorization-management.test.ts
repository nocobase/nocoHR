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
import { defaultAccess } from '@nocobase/app-plugin-authz-default-access/server';

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
  const manifest = findPackageJSON(
    '@nocobase/app-plugin-authorization/server',
    import.meta.url,
  );
  if (!manifest) throw new Error('Missing target authorization package');
  const defaultAccessManifest = findPackageJSON(
    '@nocobase/app-plugin-authz-default-access/server',
    import.meta.url,
  );
  if (!defaultAccessManifest)
    throw new Error('Missing target default-access package');
  await db
    .createMigrator({
      sources: [
        {
          packageName: '@nocobase/app-plugin-authorization',
          directory: path.join(
            path.dirname(manifest),
            'dist/database/migrations',
          ),
        },
        {
          packageName: '@nocobase/app-plugin-authz-default-access',
          directory: path.join(
            path.dirname(defaultAccessManifest),
            'dist/database/migrations',
          ),
        },
      ],
    })
    .latest();
  await db.builder().createCollection('documents', (collection) => {
    collection.string('id').primary();
    collection.string('title');
  });
  const authz = createAppAuthorization({
    database: db,
    connection: db.connection(),
    config: { plugins: [defaultAccess()] },
  });
  authz.database.collections.add({ name: 'documents', title: 'Documents' });
  const users = [
    'manager',
    'reader',
    'alice',
    'bob',
    'creator',
    'updater',
    'deleter',
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
  for (const [key, actions, defaultAccessActions] of [
    ['manager', ['read', 'assign'], ['read', 'create', 'update', 'delete']],
    ['reader', ['read'], ['read']],
  ] as const) {
    await authz.permissionSets.create({
      key,
      grants: [
        authz.settings.grant('authorization.permission-sets', actions),
        authz.settings.grant(
          'authorization.default-access',
          defaultAccessActions,
        ),
        ...(key === 'manager'
          ? [authz.settings.grant('authorization.inspector', ['inspect'])]
          : []),
      ],
    });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: key },
    });
  }
  for (const [key, actions] of [
    ['creator', ['create']],
    ['updater', ['update']],
    ['deleter', ['delete']],
  ] as const) {
    await authz.permissionSets.create({
      key,
      grants: [authz.settings.grant('authorization.default-access', actions)],
    });
    await authz.permissionSets.assign({
      permissionSet: key,
      subject: { type: 'user', id: key },
    });
  }
  await authz.permissionSets.create({
    key: 'operators',
    grants: [authz.pages.grant('sample')],
  });
  const assignment = await authz.permissionSets.assign({
    permissionSet: 'operators',
    subject: { type: 'user', id: 'alice' },
  });
  const requests: string[] = [];
  const costs: {
    endpoint: string;
    method: string;
    select: number;
    write: number;
    transaction: number;
  }[] = [];
  const client = await db.connection().client<{
    on: (event: string, listener: (query: { sql: string }) => void) => void;
  }>();
  client.on('query', (query) => requests.push(query.sql));
  const request = async (
    user: string,
    endpoint: string,
    method = 'GET',
    body?: unknown,
  ) => {
    const before = requests.length;
    const url = new URL('http://isolated.invalid' + endpoint);
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
    if (!response) throw new Error('Unregistered native route ' + endpoint);
    const sql = requests.slice(before);
    costs.push({
      endpoint,
      method,
      select: sql.filter((s) => /^\s*select/iu.test(s)).length,
      write: sql.filter((s) => /^\s*(?:insert|update|delete)/iu.test(s)).length,
      transaction: sql.filter((s) => /^\s*begin/iu.test(s)).length,
    });
    return response;
  };
  return { authz, assignment, request, requests, costs };
}

it('uses the native assign action for deletion and keeps no-permission and protected-role denials', async () => {
  const { authz, assignment, request, costs } = await fixture();
  const snapshot = await authz
    .for({ principal: { type: 'user', id: 'manager' } })
    .snapshot();
  expect(snapshot.unrestricted).toBe(false);
  expect(snapshot.permissions).toContainEqual({
    resource: { type: 'settings', id: 'authorization.permission-sets' },
    actions: ['assign', 'read'],
  });
  expect(
    await authz.for({ principal: { type: 'user', id: 'manager' } }).can({
      resource: { type: 'settings', id: 'authorization.permission-sets' },
      action: 'revoke',
    }),
  ).toBe(false);
  const endpoint = `/permissionSets/operators/assignments/${assignment.id}`;
  expect((await request('reader', endpoint, 'DELETE')).status).toBe(403);
  const unprotect = authz.permissionSets.protect({
    owner: 'fixture',
    keys: ['operators'],
    allow: ['assign'],
  });
  const protectedResponse = await request('manager', endpoint, 'DELETE');
  expect(protectedResponse.status).toBe(400);
  expect(await protectedResponse.json()).toMatchObject({
    error: { reason: 'PROTECTED_PERMISSION_SET' },
  });
  expect(await authz.permissionSets.listAssignments('operators')).toHaveLength(
    1,
  );
  unprotect();
  expect((await request('manager', endpoint, 'DELETE')).status).toBe(204);
  expect(await authz.permissionSets.listAssignments('operators')).toHaveLength(
    0,
  );
  console.info('Native assignment requests', JSON.stringify(costs));
});

it('uses native inspect, batch and configured access for restricted subjects and refuses unauthorized callers without writes', async () => {
  const { request, requests, costs } = await fixture();
  const inspect = {
    subject: { type: 'user', id: 'alice' },
    resource: { type: 'page', id: 'sample' },
    action: 'access',
  };
  expect((await request('manager', '/inspector/options')).status).toBe(200);
  const one = await request('manager', '/inspector/decide', 'POST', inspect);
  expect(one.status).toBe(200);
  expect(await one.json()).toMatchObject({
    data: { effect: 'permit', reasons: expect.any(Array) },
  });
  const batch = await request('manager', '/inspector/batchDecide', 'POST', {
    subject: inspect.subject,
    checks: [
      { resource: inspect.resource, action: 'access' },
      { resource: { type: 'page', id: 'other' }, action: 'access' },
    ],
  });
  expect(await batch.json()).toMatchObject({
    data: [
      { decision: { effect: 'permit' } },
      { decision: { effect: 'deny' } },
    ],
  });
  const configured = await request(
    'manager',
    '/inspector/configuredAccess?subjectType=user&subjectId=alice',
  );
  expect(await configured.json()).toMatchObject({
    data: {
      unrestricted: false,
      resources: [inspect.resource],
      identity: { subjects: [{ type: 'authenticated', id: '*' }] },
      sets: [{ key: 'operators', sources: [inspect.subject] }],
    },
  });
  expect(
    (await request('manager', '/inspector/subjects/user?page=1&pageSize=30'))
      .status,
  ).toBe(200);
  for (const endpoint of [
    '/inspector/options',
    '/inspector/configuredAccess?subjectType=user&subjectId=alice',
    '/inspector/subjects/user?page=1&pageSize=30',
  ])
    expect((await request('reader', endpoint)).status).toBe(403);
  expect(
    (await request('reader', '/inspector/decide', 'POST', inspect)).status,
  ).toBe(403);
  expect(
    (
      await request('reader', '/inspector/batchDecide', 'POST', {
        subject: inspect.subject,
        checks: [],
      })
    ).status,
  ).toBe(403);
  expect(
    requests.filter((sql) =>
      /^\s*(?:insert|update|delete|begin|savepoint)/iu.test(sql),
    ),
  ).toEqual([]);
  console.info('Native inspector requests', JSON.stringify(costs));
  console.info(
    'Native inspector sample SQL',
    JSON.stringify({
      select: requests.filter((sql) => /^\s*select/iu.test(sql)).length,
      write: 0,
    }),
  );
});

it('uses the target default-access routes with restricted action identities and native SQLite storage', async () => {
  const { request, costs } = await fixture();
  const resource = { type: 'database.collection', id: 'documents' };
  const options = await request('manager', '/defaultAccess/options');
  expect(options.status).toBe(200);
  expect(await options.json()).toMatchObject({ data: expect.any(Object) });
  expect(
    (
      await request(
        'manager',
        '/defaultAccess/records/documents?page=1&pageSize=20',
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await request(
        'alice',
        '/defaultAccess/records/documents?page=1&pageSize=20',
      )
    ).status,
  ).toBe(403);

  const invalid = await request('creator', '/defaultAccess', 'POST', {
    key: 'documents-baseline',
    resource,
    actions: [{ action: 'not-registered', selection: { type: 'all' } }],
  });
  expect(invalid.status).toBe(400);
  expect(await invalid.json()).toMatchObject({
    error: {
      reason: 'INVALID_AUTHORIZATION_INPUT',
      fieldViolations: expect.any(Array),
    },
  });

  const created = await request('creator', '/defaultAccess', 'POST', {
    key: 'documents-baseline',
    resource,
    actions: [{ action: 'read', selection: { type: 'all' } }],
  });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({
    data: {
      key: 'documents-baseline',
      resource,
      actions: [{ action: 'read', selection: { type: 'all' } }],
    },
  });

  const listed = await request('manager', '/defaultAccess');
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    data: [{ key: 'documents-baseline', resource }],
    meta: { total: 1 },
  });
  expect((await request('reader', '/defaultAccess')).status).toBe(200);
  expect((await request('alice', '/defaultAccess')).status).toBe(403);
  expect(
    (
      await request('reader', '/defaultAccess', 'POST', {
        key: 'denied-create',
        resource,
        actions: [{ action: 'read', selection: { type: 'all' } }],
      })
    ).status,
  ).toBe(403);

  const updated = await request(
    'updater',
    '/defaultAccess/documents-baseline',
    'PATCH',
    {
      actions: [
        { action: 'read', selection: { type: 'records', ids: ['doc-1'] } },
      ],
    },
  );
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({
    data: {
      key: 'documents-baseline',
      actions: [
        { action: 'read', selection: { type: 'records', ids: ['doc-1'] } },
      ],
    },
  });
  expect(
    (
      await request('reader', '/defaultAccess/documents-baseline', 'PATCH', {
        actions: [{ action: 'read', selection: { type: 'all' } }],
      })
    ).status,
  ).toBe(403);
  expect(
    (await request('deleter', '/defaultAccess/documents-baseline', 'DELETE'))
      .status,
  ).toBe(204);
  expect(
    await (await request('manager', '/defaultAccess')).json(),
  ).toMatchObject({
    data: [],
    meta: { total: 0 },
  });

  const reserved = await request('manager', '/defaultAccess', 'POST', {
    key: 'options',
    resource,
    actions: [{ action: 'read', selection: { type: 'all' } }],
  });
  expect(reserved.status).toBe(400);
  expect(await reserved.json()).toMatchObject({
    error: { reason: 'INVALID_INPUT' },
  });
  console.info('Native default-access requests', JSON.stringify(costs));
});
