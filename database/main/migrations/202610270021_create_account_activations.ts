import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * 上线准备 · 批量开通账号并发激活链接.
 *
 * - `accountActivations`: one activation link of an employee's login account.
 *   Only the SHA-256 of the token is kept (the token is at least 192 random
 *   bits and leaves the server once, in the message or in HR's dialog). A
 *   link opens nothing after `expiresAt`, once `usedAt` is set (single use),
 *   or once `revokedAt` is set (re-sent, revoked by HR, or the account was
 *   activated another way).
 * - `accountActivationEvents`: the audit log of every issue, send, failure,
 *   hand-over, revocation, activation and refusal; the per-HR and
 *   per-employee send limits count it.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610270021_create_account_activations',
  async up({ builder }) {
    await builder.createCollection('accountActivations', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('employeeId', { length: 64 }).notNull();
      c.string('userId', { length: 64 }).notNull();
      c.string('tokenHash', { length: 64 }).notNull();
      c.datetime('expiresAt').notNull();
      c.datetime('usedAt').nullable();
      c.datetime('revokedAt').nullable();
      // resent | revoked | activatedElsewhere | accountChanged
      c.string('revokedReason', { length: 32 }).nullable();
      // feishu | email | manual
      c.string('channel', { length: 16 }).notNull();
      // sent | failed | manual
      c.string('deliveryStatus', { length: 16 }).notNull();
      // Where the link went, masked (a@*** or the office-suite name); never the token.
      c.string('sentTo', { length: 320 }).nullable();
      c.string('createdBy', { length: 64 }).notNull();
      c.datetime('createdAt').notNull();
      c.datetime('updatedAt').notNull();
      c.unique('tokenHash', { name: 'account_activations_hash_unique' });
      c.index('employeeId', { name: 'account_activations_employee_index' });
      c.index('userId', { name: 'account_activations_user_index' });
    });
    await builder.createCollection('accountActivationEvents', (c) => {
      c.string('id', { length: 64 }).notNull();
      c.primary('id');
      c.string('activationId', { length: 64 }).nullable();
      c.string('employeeId', { length: 64 }).nullable();
      c.string('userId', { length: 64 }).nullable();
      // accountCreated | issued | sent | failed | manual | revoked | activated | refused
      c.string('event', { length: 32 }).notNull();
      c.string('channel', { length: 16 }).nullable();
      // The HR user who acted; null for the employee's own activation.
      c.string('actorUserId', { length: 64 }).nullable();
      // The client address of a public request (activation, refusal).
      c.string('ip', { length: 64 }).nullable();
      c.string('detail', { length: 200 }).nullable();
      c.datetime('createdAt').notNull();
      c.index(['actorUserId', 'createdAt'], {
        name: 'account_activation_events_actor_index',
      });
      c.index(['employeeId', 'createdAt'], {
        name: 'account_activation_events_employee_index',
      });
    });
  },
  async down({ builder }) {
    await builder.dropCollection('accountActivationEvents');
    await builder.dropCollection('accountActivations');
  },
});

export default migration;
