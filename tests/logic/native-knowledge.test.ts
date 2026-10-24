// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire, registerHooks } from 'node:module';
import { createTestApp, type TestApp } from '@nocobase/app-testing/server';
import { knowledgeToken } from '@nocobase/app-plugin-knowledge/server';
import { agentsToken } from '@nocobase/app-plugin-agents/server/tokens';
import { authorizationToken } from '@nocobase/app-plugin-authorization/server';
import {
  apiKeyScopesToken,
  scopedApiKeysToken,
} from '@nocobase/app-plugin-api-keys/server';
import { userManagementServiceToken } from '@nocobase/app-plugin-users/server/tokens';
import { createStandaloneServer } from '../../server/standalone.js';
import { nativeKnowledgeIndexToken } from '../../server/providers/native-knowledge/indexer.js';
import { nativeKnowledgeServiceToken } from '../../server/providers/native-knowledge/service.js';
import type { NativeKnowledgeConfig } from '../../server/config/native-knowledge.js';
import { scopeForUser } from '../../server/providers/hr/authorize.js';
import { knowledgeServiceToken } from '../../server/providers/hr/tokens.js';
import {
  kbDocumentResource,
  VISIBLE_DOCUMENTS_SCOPE,
  knowledgeAssistantResource,
} from '../../server/providers/hr/learning-resources.js';

const loader = registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (
        (error as { code?: string }).code === 'ERR_MODULE_NOT_FOUND' &&
        specifier.startsWith('.') &&
        specifier.endsWith('.js') &&
        (context.parentURL ?? '').replace(/[?#].*$/u, '').endsWith('.ts') &&
        !context.parentURL?.includes('/node_modules/')
      )
        return next(specifier.slice(0, -3) + '.ts', context);
      throw error;
    }
  },
});
let app: TestApp;
const inputs: string[][] = [];
const vectorSQL: string[] = [];
const SQLite = createRequire(
  createRequire(import.meta.url).resolve(
    '@nocobase/app-plugin-agents/package.json',
  ),
)('better-sqlite3');
let vectorTransactions = 0;
const exec = SQLite.prototype.exec;
const execSpy = vi.spyOn(SQLite.prototype, 'exec').mockImplementation(function (
  this: { name: string },
  sql: string,
) {
  if (this.name.endsWith('vectors.sqlite')) vectorSQL.push(sql);
  return exec.call(this, sql);
});
const transaction = SQLite.prototype.transaction;
const txSpy = vi
  .spyOn(SQLite.prototype, 'transaction')
  .mockImplementation(function (this: { name: string }, work: () => unknown) {
    const run = transaction.call(this, work);
    if (!this.name.endsWith('vectors.sqlite')) return run;
    return new Proxy(run, {
      apply(target, thisArg, args) {
        vectorTransactions++;
        return Reflect.apply(target, thisArg, args);
      },
    });
  });
const prepare = SQLite.prototype.prepare;
const vectorSpy = vi
  .spyOn(SQLite.prototype, 'prepare')
  .mockImplementation(function (this: { name: string }, sql: string) {
    const statement = prepare.call(this, sql);
    if (this.name.endsWith('vectors.sqlite'))
      for (const method of ['get', 'all', 'run']) {
        const run = statement[method];
        statement[method] = function (...args: unknown[]) {
          vectorSQL.push(sql);
          return run.apply(this, args);
        };
      }
    return statement;
  });
let fail = false;
let beforeEmbedding: (() => Promise<void>) | undefined;
const model = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const input = JSON.parse(raw) as {
    input: string[] | string;
    dimensions?: number;
  };
  const texts = Array.isArray(input.input) ? input.input : [input.input];
  inputs.push(texts);
  await beforeEmbedding?.();
  if (fail) {
    res
      .writeHead(503)
      .end('{"error":{"message":"controlled embedding unavailable"}}');
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' }).end(
    JSON.stringify({
      object: 'list',
      model: 'controlled-embedding',
      data: texts.map((text, index) => ({
        object: 'embedding',
        index,
        embedding: Array.from({ length: input.dimensions ?? 3 }, (_, i) =>
          i === 0 ? 1 : i === 1 && text.includes('payroll') ? 1 : 0,
        ),
      })),
      usage: { prompt_tokens: texts.length, total_tokens: texts.length },
    }),
  );
});
let root: string, reader: string, cookie: string, readerCookie: string;
let modelService: string;
let assignment: string;
let useAssignment: string;
const alpha = { scope: 'hr', scopeId: 'alpha' },
  beta = { scope: 'hr', scopeId: 'beta' };
let doc: string, secret: string;
const ctx = async (userId: string) => ({
  userId,
  authz: await scopeForUser(
    app.application.container.resolve(authorizationToken),
    userId,
  ),
});
let fixtureConfig: NativeKnowledgeConfig;
const config = () => fixtureConfig;
async function cost<T>(
  name: string,
  work: () => Promise<T>,
  exclude: () => boolean = () => false,
) {
  const sql: string[] = [];
  const db = await app.connection.client<{
    on(event: string, cb: (q: { sql: string }) => void): void;
    removeListener(event: string, cb: (q: { sql: string }) => void): void;
  }>();
  const listener = (q: { sql: string }) => {
    if (!exclude()) sql.push(q.sql);
  };
  const before = inputs.length;
  const vectorBefore = vectorSQL.length;
  const txBefore = vectorTransactions;
  db.on('query', listener);
  try {
    return await work();
  } finally {
    db.removeListener('query', listener);
    process.stdout.write(
      'KNOWLEDGE_COST ' +
        JSON.stringify({
          name,
          embeddingRequests: inputs.length - before,
          vectorStatements: vectorSQL.length - vectorBefore,
          vectorTransactions: vectorTransactions - txBefore,
          vectorKnn: vectorSQL
            .slice(vectorBefore)
            .filter((q) => q.includes('vec_distance_')).length,
          usageInserts: sql.filter(
            (q) => /^insert/iu.test(q) && /ag_model_usage/iu.test(q),
          ).length,
          ...Object.fromEntries(
            ['select', 'insert', 'update', 'delete', 'begin', 'commit'].map(
              (v) => [
                v,
                sql.filter((q) => new RegExp('^' + v + '\\b', 'i').test(q))
                  .length,
              ],
            ),
          ),
        }) +
        '\n',
    );
  }
}
async function indexed(id: string, version?: number) {
  const container = app.application.container,
    kb = container.resolve(knowledgeToken),
    index = container.resolve(nativeKnowledgeIndexToken);
  // A bounded test observer waits for committed notifications and the official worker.
  for (let attempt = 0; attempt < 250; attempt++) {
    await container.resolve(agentsToken).vectors.drain();
    const current = await kb.chunksOf(kb.connection(), id);
    const state = (await index.collection.states([id + ':0']))?.get(id + ':0');
    if (
      !current.doc || !current.chunks.length
        ? state === undefined
        : state?.state === 'done' &&
          state.metadata.version === (version ?? current.doc.version) &&
          state.metadata.gate === current.doc.gate
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw Error('Official vector index did not settle for ' + id);
}
beforeAll(async () => {
  await new Promise<void>((resolve) => model.listen(0, '127.0.0.1', resolve));
  app = await createTestApp({
    createServer: createStandaloneServer,
    server: { env: { HR_DEMO_SEED: 'false' } },
    config: {
      auth: { secret: randomBytes(32).toString('hex') },
      secrets: {
        keys: [{ version: 1, key: randomBytes(32).toString('base64') }],
      },
      nativeKnowledge: {
        spaces: [
          { ...alpha, title: 'HR handbook', relatedUserIds: [] },
          { ...beta, title: 'Finance restricted', relatedUserIds: [] },
        ],
        embedding: null,
      },
      processes: { enabled: false },
      workflow: { enabled: false },
      assistant: { enabled: false },
      feishu: { enabled: false },
      knowledge: { cleanup: false },
    },
  });
  const login = await app.request('/auth/sign-in/username', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({ username: 'nocobase', password: 'admin123' }),
  });
  if (login.status !== 200) throw Error('Synthetic native root sign-in failed');
  root = ((await login.json()) as { user: { id: string } }).user.id;
  cookie = login.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ');
  const container = app.application.container;
  fixtureConfig =
    app.application.config.get<NativeKnowledgeConfig>('nativeKnowledge');
  const readConfig = app.application.config.get.bind(app.application.config);
  vi.spyOn(app.application.config, 'get').mockImplementation((key: string) =>
    key === 'nativeKnowledge' ? fixtureConfig : readConfig(key),
  );
  const user = await container.resolve(userManagementServiceToken).create({
    name: 'Knowledge reader',
    username: 'knowledge_reader',
    email: 'knowledge-reader@example.invalid',
    password: 'controlled-knowledge-password',
  });
  reader = user.id;
  config().spaces[0].relatedUserIds.push(reader);
  const readerLogin = await app.request('/auth/sign-in/username', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost' },
    body: JSON.stringify({
      username: 'knowledge_reader',
      password: 'controlled-knowledge-password',
    }),
  });
  if (readerLogin.status !== 200)
    throw Error('Synthetic native reader sign-in failed');
  readerCookie = readerLogin.headers
    .getSetCookie()
    .map((h) => h.split(';')[0])
    .join('; ');
  const authz = container.resolve(authorizationToken);
  await authz.permissionSets.create({
    key: 'knowledge-reader',
    grants: [
      knowledgeAssistantResource
        .reference()
        .grant({ use: { kbDocuments: 'allRecords' } }),
      kbDocumentResource
        .reference()
        .grant({ view: { kbDocuments: 'allRecords' } }),
    ],
  });
  await authz.permissionSets.create({
    key: 'knowledge-native-read',
    grants: [
      {
        resource: { type: 'kb', id: 'kb.knowledge' },
        actions: [{ action: 'read.related' }],
      },
    ],
  });
  assignment = (
    await authz.permissionSets.assign({
      subject: { type: 'user', id: reader },
      permissionSet: 'knowledge-native-read',
    })
  ).id;
  useAssignment = (
    await authz.permissionSets.assign({
      subject: { type: 'user', id: reader },
      permissionSet: 'knowledge-reader',
    })
  ).id;
  const address = model.address();
  if (!address || typeof address === 'string') throw Error('model address');
  const service = await container.resolve(agentsToken).models.services.create({
    title: 'Controlled embedding',
    provider: 'openai-compatible',
    apiKey: 'synthetic-key',
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    models: [
      { value: 'controlled-embedding', kind: 'embedding', dimensions: 3 },
    ],
  });
  modelService = service.name;
  config().embedding = {
    modelService: service.name,
    model: 'controlled-embedding',
  };
  const kb = container.resolve(knowledgeToken);
  doc = (
    await kb.docs.create(
      { userId: root },
      {
        ...alpha,
        title: 'Holiday handbook',
        content: '# Leave\n\nHoliday policy for authorized employees.',
      },
    )
  ).id;
  secret = (
    await kb.docs.create(
      { userId: root },
      {
        ...beta,
        title: 'Payroll confidential',
        content:
          '# Finance\n\nPrivate payroll policy never visible to the HR reader.',
      },
    )
  ).id;
  await indexed(doc);
  await indexed(secret);
}, 60_000);
afterAll(async () => {
  await app?.close();
  model.closeAllConnections();
  await new Promise<void>((resolve) => model.close(() => resolve()));
  loader.deregister();
  vectorSpy.mockRestore();
  execSpy.mockRestore();
  txSpy.mockRestore();
});
describe('native Knowledge application connection', () => {
  it('boots real sqlite-vec and retrieves only explicitly admitted spaces', async () => {
    const container = app.application.container;
    expect(await container.resolve(agentsToken).vectors.status()).toMatchObject(
      { available: true, store: { type: 'sqlite-vec' } },
    );
    await container.resolve(agentsToken).vectors.drain();
    const modelBefore = inputs.length;
    const vectorBefore = vectorSQL.length;
    const result = await cost('search-native', async () =>
      container
        .resolve(nativeKnowledgeServiceToken)
        .search(await ctx(reader), 'holiday'),
    );
    expect(JSON.stringify(result)).not.toContain('relatedUserIds');
    expect(JSON.stringify(result)).not.toContain('Finance restricted');
    expect(result.native.status).toBe('ready');
    expect(result.spaces.map((s) => s.space.scopeId)).toEqual(['alpha']);
    expect(result.native.items.map((h) => h.docId)).toContain(doc);
    expect(result.native.items.map((h) => h.docId)).not.toContain(secret);
    expect(inputs.slice(modelBefore)).toEqual([['holiday']]);
    expect(
      vectorSQL
        .slice(vectorBefore)
        .some(
          (q) =>
            q.includes('vec_distance_') &&
            q.includes('spaceId') &&
            q.includes('gate'),
        ),
    ).toBe(true);
    expect(
      result.native.items.some((h) =>
        h.providers.some((p) => p.name === 'hr-vector'),
      ),
    ).toBe(true);
  });
  it('serves documented native routes through the original authenticated entry', async () => {
    const swagger = await app.request('/swagger', { headers: { cookie } });
    expect(swagger.status).toBe(200);
    const api = await swagger.text();
    expect(api).toContain('/knowledge/docs/{docId}');
    expect(api).toContain('searchHrKnowledgeSources');
    const response = await app.request('/knowledge/docs/' + doc, {
      headers: { cookie },
    });
    expect(response.status).toBe(200);
    expect((await app.request('/knowledge/docs/' + doc)).status).toBe(401);
  });
  it('rejects a real scoped API key on official direct and aggregate HTTP before reading content', async () => {
    const container = app.application.container,
      keys = container.resolve(scopedApiKeysToken);
    const identity = (await ctx(root)).authz.identity;
    // A test-only declaration issues a real constrained key; production key policy is unchanged.
    const release = container.resolve(apiKeyScopesToken).groups.add({
      id: 'controlled.knowledge',
      category: 'account',
      title: 'Synthetic page-only credential',
      levels: { read: [{ kind: 'page', id: 'talent.knowledge' }] },
    });
    const group = (await keys.scopeOptions(root)).groups.find(
      (group) => group.id === 'controlled.knowledge',
    );
    if (!group)
      throw Error('No native key scope is available in the test application');
    const issued = await keys.create(
      root,
      {
        name: 'Synthetic limited knowledge key',
        scope: { groups: { [group.id]: { level: 'read' } } },
        expiresInDays: 1,
      },
      identity,
    );
    try {
      const before = inputs.length;
      for (const target of [
        '/knowledge/docs/' + doc,
        '/knowledge/docs/' + doc + '/versions/1',
        '/talent/kb/spaces',
        '/talent/kb/search?q=holiday',
      ]) {
        const response = await cost('restricted-http-' + target, () =>
          app.request(target, { headers: { 'x-api-key': issued.secret } }),
        );
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain('Holiday policy');
      }
      expect(inputs.length).toBe(before);
    } finally {
      await keys.revoke(root, issued.key.id);
      release();
    }
  });
  it('keeps native node ACLs below hard space admission, including direct versions and files', async () => {
    const kb = app.application.container.resolve(knowledgeToken);
    // Even a native custom grant in beta cannot widen the application space admission.
    config().spaces[1].relatedUserIds.push(reader);
    await kb.permissions.replace({ userId: root }, secret, {
      mode: 'custom',
      entries: [{ subject: { type: 'user', id: reader }, level: 'manage' }],
    });
    config().spaces[1].relatedUserIds = [];
    for (const suffix of [
      '',
      '/versions',
      '/versions/1',
      '/file',
      '/permissions',
      '/access',
      '/index',
    ]) {
      const response = await app.request('/knowledge/docs/' + secret + suffix, {
        headers: { cookie: readerCookie },
      });
      expect(response.status).toBe(404);
      expect(await response.text()).not.toContain('Private payroll');
    }
    await expect(kb.docs.get({ userId: reader }, secret)).rejects.toMatchObject(
      { status: 404 },
    );
  });
  it('filters private nodes inside admitted spaces before the vector topK', async () => {
    const container = app.application.container,
      kb = container.resolve(knowledgeToken);
    const privateDoc = await kb.docs.create(
      { userId: root },
      {
        ...alpha,
        title: 'Private nearest',
        content: '# Secret\n\npayroll secret text for another reader.',
      },
    );
    await kb.permissions.replace({ userId: root }, privateDoc.id, {
      mode: 'custom',
      entries: [],
    });
    await indexed(privateDoc.id);
    const before = vectorSQL.length;
    const result = await cost('search-node-acl', async () =>
      container
        .resolve(nativeKnowledgeServiceToken)
        .search(await ctx(reader), 'payroll'),
    );
    expect(
      result.native.items.some(
        (h) => h.docId === privateDoc.id || h.docId === secret,
      ),
    ).toBe(false);
    // Nonmatching text still appears by real vector similarity; visible hits are not canned text matches.
    expect(
      result.native.items.some(
        (h) =>
          h.docId === doc && h.providers.some((p) => p.name === 'hr-vector'),
      ),
    ).toBe(true);
    expect(
      vectorSQL
        .slice(before)
        .some((q) => q.includes('vec_distance_') && q.includes('gate')),
    ).toBe(true);
    await expect(
      kb.docs.get({ userId: reader }, privateDoc.id),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('rejects restricted and mismatched identities before refresh, reads or embedding', async () => {
    const container = app.application.container,
      authz = container.resolve(authorizationToken);
    const unrestricted = await ctx(reader);
    const subjects = vi.spyOn(authz.subjects, 'resolveFor');
    const before = inputs.length;
    const restricted = authz.for({
      ...unrestricted.authz.identity,
      keyScope: {
        keyId: 'controlled-key',
        allows: () => true,
        objects: () => [],
        permissions: null,
      },
    });
    try {
      await cost('restricted-entry', async () => {
        await expect(
          container
            .resolve(nativeKnowledgeServiceToken)
            .search({ userId: reader, authz: restricted }, 'holiday'),
        ).rejects.toMatchObject({ status: 403 });
        await expect(
          container
            .resolve(knowledgeServiceToken)
            .search({ userId: reader, authz: restricted }, 'holiday'),
        ).rejects.toMatchObject({ status: 403 });
      });
      expect(subjects).not.toHaveBeenCalled();
      expect(inputs.length).toBe(before);
      await expect(
        container
          .resolve(nativeKnowledgeServiceToken)
          .search({ userId: root, authz: unrestricted.authz }, 'holiday'),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      subjects.mockRestore();
    }
  });
  it('refuses revoked HR use on native and aggregate direct reads', async () => {
    const container = app.application.container,
      authz = container.resolve(authorizationToken);
    await authz.permissionSets.revoke(useAssignment);
    try {
      const result = await cost('revoked-entry', async () =>
        container
          .resolve(nativeKnowledgeServiceToken)
          .search(await ctx(reader), 'holiday')
          .catch((error) => error),
      );
      expect(result).toMatchObject({ status: 403 });
      expect(
        (
          await app.request('/knowledge/docs/' + doc, {
            headers: { cookie: readerCookie },
          })
        ).status,
      ).toBe(404);
    } finally {
      useAssignment = (
        await authz.permissionSets.assign({
          subject: { type: 'user', id: reader },
          permissionSet: 'knowledge-reader',
        })
      ).id;
    }
  });
  it('shows contains fallback with no model and with a failed query embedding', async () => {
    const container = app.application.container,
      service = container.resolve(nativeKnowledgeServiceToken);
    const saved = config().embedding;
    config().embedding = null;
    try {
      const found = await cost('no-model-fallback', async () =>
        service.search(await ctx(reader), 'holiday'),
      );
      expect(found.native).toMatchObject({
        status: 'ready',
        semantic: 'unavailable',
      });
      expect(found.native.items.some((h) => h.docId === doc)).toBe(true);
    } finally {
      config().embedding = saved;
    }
    fail = true;
    try {
      const found = await cost('failed-model-fallback', async () =>
        service.search(await ctx(reader), 'holiday'),
      );
      expect(found.native).toMatchObject({
        status: 'ready',
        semantic: 'unavailable',
      });
      expect(found.native.items.some((h) => h.docId === doc)).toBe(true);
    } finally {
      fail = false;
    }
  }, 15_000);
  it('maintains the real official index for versions, unchanged text, ACL changes and archive', async () => {
    const container = app.application.container,
      kb = container.resolve(knowledgeToken),
      vectors = container.resolve(agentsToken).vectors;
    let document = await cost('index-create', async () => {
      const created = await kb.docs.create(
        { userId: root },
        {
          ...alpha,
          title: 'Incremental index',
          content: '# Incremental\n\nUnique incremental initial text.',
        },
      );
      await indexed(created.id);
      return created;
    });
    await expect
      .poll(async () => {
        await vectors.drain();
        return (await kb.indexing.doc({ userId: root }, document.id)).state;
      })
      .toBe('done');
    const requestsBeforeMetadata = inputs.length;
    await cost('index-unchanged', async () => {
      document = await kb.docs.update({ userId: root }, document.id, {
        expectedVersion: document.version,
        title: document.title + ' renamed',
        content: document.content,
      });
      await indexed(document.id, document.version);
    });
    expect(inputs.length).toBe(requestsBeforeMetadata);
    await cost('index-reindex-unchanged', async () => {
      await kb.indexing.reindex({ userId: root }, document.id);
      await indexed(document.id, document.version);
    });
    expect(inputs.length).toBe(requestsBeforeMetadata);
    await cost('index-update', async () => {
      document = await kb.docs.update({ userId: root }, document.id, {
        expectedVersion: document.version,
        content: '# Incremental\n\nChanged incremental body.',
      });
      await indexed(document.id, document.version);
    });
    await expect
      .poll(async () => {
        await vectors.drain();
        return (await kb.indexing.doc({ userId: root }, document.id)).state;
      })
      .toBe('done');
    const found = await container
      .resolve(nativeKnowledgeServiceToken)
      .search(await ctx(reader), 'incremental');
    expect(found.native.items.map((hit) => hit.docId)).toContain(document.id);
    expect(
      found.native.items
        .filter((h) => h.docId === document.id)
        .every((h) => h.version === document.version),
    ).toBe(true);
    await cost('index-acl', async () => {
      await kb.permissions.replace({ userId: root }, document.id, {
        mode: 'custom',
        entries: [],
      });
      await indexed(document.id);
    });
    const hidden = await container
      .resolve(nativeKnowledgeServiceToken)
      .search(await ctx(reader), 'incremental');
    expect(hidden.native.items.some((h) => h.docId === document.id)).toBe(
      false,
    );
    await cost('index-archive', async () => {
      await kb.docs.archive({ userId: root }, document.id);
      await indexed(document.id);
    });
    expect(
      (await kb.docs.get({ userId: root }, document.id)).archivedAt,
    ).not.toBeNull();
    const archived = await container
      .resolve(nativeKnowledgeServiceToken)
      .search(await ctx(root), 'incremental');
    expect(archived.native.items.some((h) => h.docId === document.id)).toBe(
      false,
    );
  });
  it('builds a new model dimension using the official queue without migrating source documents', async () => {
    const container = app.application.container,
      kb = container.resolve(knowledgeToken),
      agents = container.resolve(agentsToken);
    const before = await app.connection.repository('kbDocs').count();
    await cost('index-dimension-change', async () => {
      await agents.models.services.update(modelService, {
        models: [
          { value: 'controlled-embedding', kind: 'embedding', dimensions: 4 },
        ],
      });
      await kb.indexing.reindex({ userId: root }, doc);
      await expect
        .poll(
          async () => {
            await agents.vectors.drain();
            return (
              await container
                .resolve(nativeKnowledgeIndexToken)
                .collection.status()
            ).active?.dimension;
          },
          { timeout: 5000, interval: 20 },
        )
        .toBe(4);
    });
    await expect
      .poll(async () => {
        await agents.vectors.drain();
        return (await kb.indexing.doc({ userId: root }, doc)).state;
      })
      .toBe('done');
    expect(await app.connection.repository('kbDocs').count()).toBe(before);
    await cost('index-model-change', async () => {
      await agents.models.services.update(modelService, {
        models: [
          { value: 'controlled-embedding', kind: 'embedding', dimensions: 4 },
          { value: 'alternate-embedding', kind: 'embedding', dimensions: 3 },
        ],
      });
      config().embedding = { modelService, model: 'alternate-embedding' };
      await kb.indexing.reindex({ userId: root }, doc);
      await expect
        .poll(
          async () => {
            await agents.vectors.drain();
            return (
              await container
                .resolve(nativeKnowledgeIndexToken)
                .collection.status()
            ).active?.model;
          },
          { timeout: 5000, interval: 20 },
        )
        .toBe('alternate-embedding');
    });
    expect(await app.connection.repository('kbDocs').count()).toBe(before);

    expect(
      (
        await container
          .resolve(nativeKnowledgeServiceToken)
          .search(await ctx(reader), 'holiday')
      ).native.items.some((h) => h.docId === doc),
    ).toBe(true);
  });

  it('rechecks native grants after query embedding before returning excerpts or directory metadata', async () => {
    const container = app.application.container,
      authz = container.resolve(authorizationToken);
    beforeEmbedding = async () => {
      beforeEmbedding = undefined;
      await authz.permissionSets.revoke(assignment);
    };
    try {
      const found = await cost('revoke-during-query', async () =>
        container
          .resolve(nativeKnowledgeServiceToken)
          .search(await ctx(reader), 'holiday'),
      );
      expect(found.native.items).toEqual([]);
      expect(found.spaces).toEqual([]);
      expect(JSON.stringify(found)).not.toContain('Holiday policy');
    } finally {
      beforeEmbedding = undefined;
      assignment = (
        await authz.permissionSets.assign({
          subject: { type: 'user', id: reader },
          permissionSet: 'knowledge-native-read',
        })
      ).id;
    }
  });
  it('keeps authorized direct search results and the official response envelope', async () => {
    const response = await cost('direct-search-authorized', () =>
      app.request('/knowledge/search?scope=hr&scopeId=alpha&q=holiday', {
        headers: { cookie: readerCookie },
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta).toEqual({});
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docId: doc,
          title: 'Holiday handbook',
          version: 1,
        }),
      ]),
    );
    expect(JSON.stringify(body)).toContain('Holiday policy');
    expect(JSON.stringify(body)).not.toContain('Confidential payroll');
  });

  it('rechecks direct HTTP search revocation during embedding', async () => {
    const authz = app.application.container.resolve(authorizationToken);
    let changingGrant = false;
    beforeEmbedding = async () => {
      beforeEmbedding = undefined;
      changingGrant = true;
      try {
        await cost('direct-search-fixture-revoke', () =>
          authz.permissionSets.revoke(assignment),
        );
      } finally {
        changingGrant = false;
      }
    };
    try {
      const response = await cost(
        'direct-search-revoked',
        () =>
          app.request('/knowledge/search?scope=hr&scopeId=alpha&q=holiday', {
            headers: { cookie: readerCookie },
          }),
        () => changingGrant,
      );
      const body = await response.json();
      expect(response.status).toBe(200);
      expect(body).toEqual({ data: [], meta: {} });
      expect(JSON.stringify(body)).not.toContain('Holiday');
      expect(JSON.stringify(body)).not.toContain(doc);
    } finally {
      beforeEmbedding = undefined;
      assignment = (
        await authz.permissionSets.assign({
          subject: { type: 'user', id: reader },
          permissionSet: 'knowledge-native-read',
        })
      ).id;
    }
  });
  it('rechecks HR use revocation on the direct reader search', async () => {
    const authz = app.application.container.resolve(authorizationToken);
    beforeEmbedding = async () => {
      beforeEmbedding = undefined;
      await authz.permissionSets.revoke(useAssignment);
    };
    try {
      const response = await app.request(
        '/knowledge/search?scope=hr&scopeId=alpha&q=holiday',
        {
          headers: { cookie: readerCookie },
        },
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ data: [], meta: {} });
    } finally {
      beforeEmbedding = undefined;
      useAssignment = (
        await authz.permissionSets.assign({
          subject: { type: 'user', id: reader },
          permissionSet: 'knowledge-reader',
        })
      ).id;
    }
  });

  it.each(['title', 'content'] as const)(
    'omits a direct hit whose %s version changes after retrieval and keeps the fresh version searchable',
    async (field) => {
      const kb = app.application.container.resolve(knowledgeToken);
      const original = await kb.docs.create(
        { userId: root },
        {
          ...alpha,
          title: 'Versionguard before',
          content: 'Versionguard original authorized content.',
        },
      );
      await indexed(original.id);
      const search = kb.docs.search;
      let updated = original;
      // Run real retrieval, then commit a real version at the last await before the application returns hits.
      const boundary = vi
        .spyOn(kb.docs, 'search')
        .mockImplementationOnce(async (...args) => {
          const hits = await search(...args);
          expect(
            hits.some(
              (hit) =>
                hit.docId === original.id && hit.version === original.version,
            ),
          ).toBe(true);
          updated = await kb.docs.update({ userId: root }, original.id, {
            expectedVersion: original.version,
            title: field === 'title' ? 'Versionguard after' : original.title,
            content:
              field === 'content'
                ? 'Versionguard updated authorized content.'
                : original.content,
          });
          return hits;
        });
      try {
        const response = await app.request(
          '/knowledge/search?scope=hr&scopeId=alpha&q=versionguard',
          {
            headers: { cookie: readerCookie },
          },
        );
        expect(response.status).toBe(200);
        const body = await response.json();
        expect(
          body.data.some((hit: { docId: string }) => hit.docId === original.id),
        ).toBe(false);
        expect(JSON.stringify(body)).not.toContain('Versionguard before');
        expect(JSON.stringify(body)).not.toContain(
          'Versionguard original authorized content',
        );
      } finally {
        boundary.mockRestore();
      }
      await indexed(original.id, updated.version);
      const fresh = await app.request(
        '/knowledge/search?scope=hr&scopeId=alpha&q=versionguard',
        {
          headers: { cookie: readerCookie },
        },
      );
      expect(fresh.status).toBe(200);
      expect((await fresh.json()).data).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            docId: original.id,
            version: updated.version,
            title: updated.title,
          }),
        ]),
      );
      await kb.docs.archive({ userId: root }, original.id);
      await indexed(original.id);
    },
  );

  it('rechecks files, historical versions, exports and one-time proposal tickets after space revocation', async () => {
    const container = app.application.container,
      kb = container.resolve(knowledgeToken),
      authz = container.resolve(authorizationToken);
    const file = await cost('file-upload-index', async () => {
      const created = await kb.files.upload(
        { userId: root },
        { ...alpha, title: 'Authorized attachment' },
        new File(['Holiday attachment confidential body.'], 'holiday.txt', {
          type: 'text/plain',
        }),
      );
      await kb.files.idle();
      expect(
        (await kb.docs.get({ userId: root }, created.id)).content,
      ).toContain('Holiday attachment');
      await indexed(created.id);
      return created;
    });
    const downloaded = await kb.files.content({ userId: reader }, file.id);
    expect(await new Response(downloaded.body).text()).toContain(
      'Holiday attachment',
    );
    await authz.permissionSets.create({
      key: 'knowledge-propose',
      grants: [
        {
          resource: { type: 'kb', id: 'kb.knowledge' },
          actions: [{ action: 'propose.related' }],
        },
      ],
    });
    const propose = (
      await authz.permissionSets.assign({
        subject: { type: 'user', id: reader },
        permissionSet: 'knowledge-propose',
      })
    ).id;
    const ticket = await kb.proposals.ticket(
      { userId: reader },
      {
        kind: 'create',
        space: alpha,
        title: 'Ticket upload',
        reason: 'Controlled proposal',
        filename: 'ticket.txt',
      },
    );
    await authz.permissionSets.revoke(assignment);
    try {
      for (const suffix of [
        '',
        '/versions',
        '/versions/1',
        '/file',
        '/file?version=1',
      ])
        expect(
          (
            await app.request('/knowledge/docs/' + file.id + suffix, {
              headers: { cookie: readerCookie },
            })
          ).status,
        ).toBe(404);
      await expect(
        kb.files.content({ userId: reader }, file.id),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        kb.readable({ userId: reader }, [alpha]),
      ).rejects.toMatchObject({ status: 404 });
      const response = await cost('revoked-ticket', () =>
        app.request('/knowledge/tickets/' + ticket.id + '/redeem', {
          method: 'POST',
          headers: {
            authorization: 'Bearer ' + ticket.token,
            'content-type': 'application/octet-stream',
            'content-disposition': 'attachment; filename="ticket.txt"',
          },
          body: 'No longer admitted',
        }),
      );
      expect(response.status).toBe(404);
      expect(await app.connection.repository('kbProposals').count()).toBe(0);
    } finally {
      assignment = (
        await authz.permissionSets.assign({
          subject: { type: 'user', id: reader },
          permissionSet: 'knowledge-native-read',
        })
      ).id;
      await authz.permissionSets.revoke(propose);
    }
  });
  it.each(['use-narrow', 'view-narrow', 'no-view', 'no-use'] as const)(
    'intersects legacy use and view before body retrieval: %s',
    async (mode) => {
      const container = app.application.container,
        authz = container.resolve(authorizationToken);
      const user = await container.resolve(userManagementServiceToken).create({
        name: mode,
        username: 'knowledge_' + mode.replace('-', '_'),
        email: mode + '@example.invalid',
        password: randomBytes(24).toString('hex'),
      });
      const grants = [];
      if (mode !== 'no-use')
        grants.push(
          knowledgeAssistantResource.reference().grant({
            use: {
              kbDocuments:
                mode === 'use-narrow' ? VISIBLE_DOCUMENTS_SCOPE : 'allRecords',
            },
          }),
        );
      if (mode !== 'no-view')
        grants.push(
          kbDocumentResource.reference().grant({
            view: {
              kbDocuments:
                mode === 'view-narrow' ? VISIBLE_DOCUMENTS_SCOPE : 'allRecords',
            },
          }),
        );
      await authz.permissionSets.create({ key: 'search-' + mode, grants });
      await authz.permissionSets.assign({
        subject: { type: 'user', id: user.id },
        permissionSet: 'search-' + mode,
      });
      const stamp = { createdAt: new Date(), updatedAt: new Date() };
      for (const [id, owner] of [
        [mode + '-own', user.id],
        [mode + '-private', root],
      ])
        await app.connection.repository('kbDocuments').createOne({
          values: {
            id,
            title: id,
            docNo: id,
            category: 'policy',
            fileId: 'synthetic-not-opened',
            contentText:
              '# Holiday\n\nHoliday ' +
              (owner === root ? 'SECRET' : 'authorized legacy text'),
            parseStatus: 'ready',
            visibility: 'restricted',
            ownerUserId: owner,
            active: true,
            reviewStatus: 'confirmed',
            ...stamp,
          },
        });
      const entry = await ctx(user.id);
      if (mode === 'no-use') {
        await expect(
          cost('legacy-' + mode, () =>
            container
              .resolve(nativeKnowledgeServiceToken)
              .search(entry, 'holiday'),
          ),
        ).rejects.toMatchObject({ status: 403 });
      } else {
        const result = await cost('legacy-' + mode, () =>
          container
            .resolve(nativeKnowledgeServiceToken)
            .search(entry, 'holiday'),
        );
        expect(result.legacy.items.map((h) => h.documentId)).toEqual(
          mode === 'no-view' ? [] : [mode + '-own'],
        );
        if (mode === 'no-view') expect(result.legacy.status).toBe('forbidden');
        expect(JSON.stringify(result)).not.toContain('SECRET');
        expect(result.native.items).toEqual([]);
        if (mode !== 'no-view') {
          const own = await container
            .resolve(knowledgeServiceToken)
            .getDocument(entry, mode + '-own');
          expect(own?.id).toBe(mode + '-own');
        }
      }
    },
  );
});
