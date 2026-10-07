import { defineMigration, type MigrationDefinition } from '@nocobase/db';

/**
 * Readiness review 2026-10-07: the MCP endpoint's per-token limit counted the
 * call log, which parallel requests read before any of them wrote, and which
 * tools/list, initialize and ping never reached. Each token now counts its
 * requests of the current minute itself (`rateWindow`: when that minute
 * began, in milliseconds since the epoch, a 64-bit integer so it cannot
 * overflow; `rateCount`: requests in it), updated
 * conditionally so concurrent requests cannot pass the limit together.
 */
const migration: MigrationDefinition = defineMigration({
  name: '202610260003_agent_token_rate_window',
  async up({ builder }) {
    await builder.alterCollection('agentTokens', (c) => {
      c.bigInt('rateWindow').nullable();
      c.integer('rateCount').notNull().defaultTo(0);
    });
  },
  async down({ builder }) {
    await builder.alterCollection('agentTokens', (c) => {
      c.dropFields('rateWindow', 'rateCount');
    });
  },
});

export default migration;
