import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * V1 step 3 (组织同步与岗位变动):
 *
 * - `departments` / `employees` get the office-suite identity they are bound
 *   to (`externalProvider` + `externalId` / `externalUserId`, each pair
 *   unique) and `employees.syncLocked` for people a sync must not move;
 * - `jobEvents.syncRunId` names the sync that produced a `source=sync`
 *   event, and `processError` keeps why its handler failed, for the 岗位变动
 *   page to show and retry;
 * - `positionAliases` maps an office-suite job title to a position; only
 *   confirmed rows take part in a sync;
 * - `orgSyncRuns` records every sync with its statistics and its open
 *   issues (the pending items HR works through).
 *
 * No user data sync plugin is installed, so the run log and the issues live
 * in the application (V1-03 allows this when no plugin log exists).
 */
const migration: MigrationDefinition = defineMigration({
  name: '202609290009_create_org_sync',
  async up({ builder }) {
    await builder.alterCollection('departments', (c) => {
      // feishu | dingtalk | wecom
      c.string('externalProvider', { length: 16 }).nullable();
      c.string('externalId', { length: 128 }).nullable();
      c.unique(['externalProvider', 'externalId'], {
        name: 'departments_external_unique',
      });
    });
    await builder.alterCollection('employees', (c) => {
      c.string('externalProvider', { length: 16 }).nullable();
      c.string('externalUserId', { length: 128 }).nullable();
      c.boolean('syncLocked').notNull().defaultTo(false);
      c.unique(['externalProvider', 'externalUserId'], {
        name: 'employees_external_unique',
      });
    });
    await builder.alterCollection('jobEvents', (c) => {
      c.string('syncRunId', { length: 64 }).nullable();
      c.text('processError').nullable();
    });
    await builder.createCollection('positionAliases', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('provider', { length: 16 }).notNull();
      c.string('externalTitle').notNull();
      c.string('positionId', { length: 64 }).notNull();
      // manual | ai | import
      c.string('source', { length: 16 }).notNull().defaultTo('manual');
      // draft | confirmed
      c.string('reviewStatus', { length: 16 }).notNull().defaultTo('confirmed');
      c.text('draftReason').nullable();
      c.string('confirmedBy', { length: 64 }).nullable();
      c.datetime('confirmedAt').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique(['provider', 'externalTitle'], {
        name: 'position_aliases_title_unique',
      });
    });
    await builder.createCollection('orgSyncRuns', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('provider', { length: 16 }).notNull();
      // full | incremental
      c.string('mode', { length: 16 }).notNull();
      // nocohr | external, as it was when the run started
      c.string('orgMaster', { length: 16 }).notNull();
      c.string('triggeredBy', { length: 64 }).nullable();
      c.datetime('startedAt').notNull();
      c.datetime('finishedAt').nullable();
      // running | succeeded | partial | failed
      c.string('status', { length: 16 }).notNull();
      c.json('stats').nullable();
      // The pending items: key, type, externalId, employeeId, departmentId, detail, status, actionId, handling and AI notes.
      c.json('issues').nullable();
      c.text('error').nullable();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.index('startedAt', { name: 'org_sync_runs_started_index' });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('orgSyncRuns');
    await builder.dropCollection('positionAliases');
    await builder.alterCollection('jobEvents', (c) => {
      c.dropFields('syncRunId', 'processError');
    });
    // Dropping the columns drops their unique index with them; on SQLite the
    // altered table never received the named index, so dropping it by name fails.
    await builder.alterCollection('employees', (c) => {
      c.dropFields('externalProvider', 'externalUserId', 'syncLocked');
    });
    await builder.alterCollection('departments', (c) => {
      c.dropFields('externalProvider', 'externalId');
    });
  },
});

export default migration;
