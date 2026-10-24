import { AppCommand, CommandError } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';
import path from 'node:path';
export default class MigrateProcessHistory extends AppCommand {
  static override description =
    'Copy one verified legacy process revision and terminal histories; stop old writers before copying.';
  static override flags = {
    'source-version': Flags.string({ required: true }),
    workflow: Flags.string({ required: true }),
    hash: Flags.string({ required: true }),
    user: Flags.string({ required: true }),
  };
  public override async run() {
    const { flags } = await this.parse(MigrateProcessHistory);
    if (flags['source-version'] !== '1.0.0-beta.32')
      throw new CommandError(
        'Only the verified workflow source version is mapped.',
        { code: 'INVALID_SOURCE_VERSION', exit: 2 },
      );
    try {
      return await this.withApp(async ({ app }) => {
        app.registerProviders();
        const [
          { databaseManagerToken },
          { authorizationToken },
          { scopeForUser },
          { ProcessCatalog },
          { ProcessHistory },
          { registerProcessAuthorization },
          registry,
        ] = await Promise.all([
          import('@nocobase/db'),
          import('@nocobase/app-plugin-authorization/server'),
          import('../../server/providers/hr/authorize.js'),
          import('../../server/providers/processes/catalog.js'),
          import('../../server/providers/processes/history.js'),
          import('../../server/providers/processes/authorization.js'),
          import('../../server/processes/index.js'),
        ]);
        const db = app.container.resolve(databaseManagerToken);
        await db.connect();
        // This command registers providers without booting workers. Retain the
        // authorization catalog explicitly before checking the saved grant.
        registerProcessAuthorization(app.container.resolve(authorizationToken));
        const authorize = async (user: string) => {
          const effect = String(
            (
              await (
                await scopeForUser(
                  app.container.resolve(authorizationToken),
                  user,
                )
              ).authorize({
                resource: { type: 'settings', id: 'workflow' },
                action: 'manage',
              })
            ).effect,
          );
          if (effect !== 'allow' && effect !== 'permit')
            throw new Error('PROCESS_FORBIDDEN');
        };
        const catalog = new ProcessCatalog(registry.processHandlers);
        await catalog.load(
          path.resolve(import.meta.dirname, '../../server/processes/artifacts'),
        );
        return new ProcessHistory(db.connection(), authorize).copy(
          flags.user,
          flags.workflow,
          flags.hash,
          catalog,
          registry.legacyProcessModules,
        );
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      throw new CommandError(
        'The process history unit was not committed; inspect mapping prerequisites.',
        {
          code: /^[A-Z][A-Z0-9_]{1,80}$/u.test(reason)
            ? reason
            : 'PROCESS_HISTORY_COPY_FAILED',
          exit: 2,
        },
      );
    }
  }
}
