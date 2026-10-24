import type { DatabaseConnection } from '@nocobase/db';

/** Synthetic fixture of .30's public collection contract after the disk forward migration, without old implementation code. */
export async function legacyCollections(db: DatabaseConnection) {
  await db.builder.createCollection('aiEmployees', (c) => {
    c.string('username').primary();
    for (const key of [
      'nickname',
      'position',
      'avatar',
      'bio',
      'about',
      'description',
      'defaultPrompt',
      'greeting',
      'category',
    ])
      c.string(key).nullable();
    for (const key of [
      'chatSettings',
      'skillSettings',
      'modelSettings',
      'dataSourceSettings',
      'knowledgeBase',
    ])
      c.json(key).nullable();
    for (const key of [
      'enabled',
      'builtIn',
      'deprecated',
      'enableKnowledgeBase',
    ])
      c.boolean(key).nullable();
    c.integer('sort').nullable();
    c.datetime('createdAt').nullable();
    c.datetime('updatedAt').nullable();
  });
  await db.builder.createCollection('usersAiEmployees', (c) => {
    c.string('userId').notNull();
    c.string('aiEmployee').notNull();
    c.primary(['userId', 'aiEmployee']);
    c.text('prompt').nullable();
    c.integer('sort').nullable();
  });
  await db.builder.createCollection('llmServices', (c) => {
    c.string('name').primary();
    c.string('provider');
    c.string('title');
    c.json('options');
    c.json('enabledModels');
    c.json('modelOptions');
    c.boolean('enabled');
    c.integer('sort').nullable();
  });
  await db.builder.createCollection('aiSettings', (c) => {
    c.string('id').primary();
    c.json('options');
    c.string('defaultLlmService');
    c.string('defaultModel');
  });
  await db.builder.createCollection('aiConversations', (c) => {
    c.string('sessionId').primary();
    for (const key of [
      'userId',
      'aiEmployeeUsername',
      'llmActiveState',
      'category',
      'from',
      'scope',
      'topicId',
      'title',
    ])
      c.string(key).nullable();
    c.json('options');
    c.boolean('read');
    c.integer('thread').notNull();
    c.datetime('createdAt');
    c.datetime('updatedAt');
  });
  await db.builder.createCollection('aiMessages', (c) => {
    c.bigInt('messageId').primary();
    c.string('sessionId');
    c.string('role');
    for (const key of [
      'content',
      'toolCalls',
      'attachments',
      'workContext',
      'metadata',
    ])
      c.json(key).nullable();
    c.datetime('createdAt');
    c.datetime('updatedAt');
  });
  await db.builder.createCollection('aiToolMessages', (c) => {
    c.bigInt('id').primary();
    c.bigInt('messageId');
    for (const key of [
      'sessionId',
      'toolCallId',
      'toolName',
      'status',
      'invokeStatus',
      'execution',
    ])
      c.string(key).nullable();
    c.json('content').nullable();
    c.json('userDecision').nullable();
    c.boolean('auto').nullable();
    c.bigInt('invokeStartTime').nullable();
    c.bigInt('invokeEndTime').nullable();
    c.datetime('createdAt');
    c.datetime('updatedAt');
  });
  await db.builder.createCollection('aiFiles', (c) => {
    c.string('id').primary();
    for (const key of [
      'filename',
      'disk',
      'path',
      'mimetype',
      'createdById',
      'url',
      'preview',
      'extname',
    ])
      c.string(key).nullable();
    c.integer('size');
    c.json('meta');
  });
  await db.builder.createCollection('legacyMigrationHistory', (c) => {
    c.string('id').primary();
    c.string('namespace');
    c.string('checksum');
  });
  await db.repository('legacyMigrationHistory').createOne({
    values: {
      id: 'original-task',
      namespace: '@nocobase/app-plugin-ai-employee',
      checksum: 'synthetic-original-checksum',
    },
  });
}
