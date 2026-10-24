import { AppCommand, CommandError } from '@nocobase/app-cli';
import { Flags } from '@oclif/core';

/** Run against an independently backed-up database, with legacy writers stopped; never starts workers. */
export default class MigrateAssistantHistory extends AppCommand {
  static override description =
    'Copy version-matched AI configuration or one owned transcript; retains all source rows and files. Drain and stop legacy writers before any copy.';
  static override flags = {
    'source-version': Flags.string({
      required: true,
      description:
        'Verified source plugin version; only 1.0.0-beta.30 is mapped.',
    }),
    configuration: Flags.boolean({
      default: false,
      description: 'Copy the bounded employee and model configuration unit.',
    }),
    preferences: Flags.boolean({
      default: false,
      description: 'Copy preferences for exactly the named user.',
    }),
    session: Flags.string({
      description: 'Copy exactly this legacy sessionId.',
    }),
    user: Flags.string({
      description: 'Require this owning userId for the selected session.',
    }),
  };
  public override async run() {
    const { flags } = await this.parse(MigrateAssistantHistory);
    if (
      flags['source-version'] !== '1.0.0-beta.30' ||
      (flags.configuration
        ? Boolean(flags.preferences || flags.session || flags.user)
        : flags.preferences
          ? !flags.user || Boolean(flags.session)
          : !flags.session || !flags.user)
    )
      throw new CommandError(
        'Choose configuration, one user’s preferences, or one session and owner, using the mapped source version.',
        { code: 'INVALID_LEGACY_MAPPING_REQUEST', exit: 2 },
      );
    try {
      const result = await this.withApp(async ({ app }) => {
        app.registerProviders();
        const [
          { databaseManagerToken },
          { driveManagerToken },
          { Readable },
          { default: Resources },
          { LegacyAssistantMigration },
          { mappedModels },
          { record },
        ] = await Promise.all([
          import('@nocobase/db'),
          import('@nocobase/app-server/drive'),
          import('node:stream'),
          import('../../server/ai/index.js'),
          import('../../server/providers/assistant/legacy-migration.js'),
          import('../../server/providers/assistant/model-configuration.js'),
          import('../../server/providers/assistant/legacy-contract.js'),
        ]);
        const db = app.container.resolve(databaseManagerToken);
        await db.connect();
        const resources = await new Resources().collect();
        const configuration =
          app.config.get<
            import('../../server/config/assistant.js').AssistantConfig
          >('assistant')!;
        const ai = app.config.get<
          import('../../server/providers/assistant/model-configuration.js').AIConfiguration
        >('ai') ?? { llmServices: {} };
        const copied = await db.repository('assistantModelServices').findMany({
          filter: (f) => f.string('id').ne('#defaults'),
          limit: 201,
        });
        if (copied.length > 200)
          throw new Error('LEGACY_CONFIGURATION_BATCH_LIMIT');
        const models = mappedModels(
          configuration,
          ai,
          copied.map(
            (row) =>
              record(
                row.settings,
              ) as unknown as import('../../server/providers/assistant/model-configuration.js').ModelSettings,
          ),
        );
        const migration = new LegacyAssistantMigration(
          db.connection(),
          resources.employees,
          resources.tools,
          models,
          ai,
          async (file) => {
            try {
              const stream = Readable.toWeb(
                (await app.container
                  .resolve(driveManagerToken)
                  .use(file.disk)
                  .getStream(file.path)) as import('node:stream').Readable,
              ) as ReadableStream<Uint8Array>;
              const reader = stream.getReader();
              try {
                await reader.read();
                return true;
              } finally {
                await reader.cancel();
              }
            } catch {
              return false;
            }
          },
          async (userId) => {
            const [{ authorizationToken }, { scopeForUser }] =
              await Promise.all([
                import('@nocobase/app-plugin-authorization/server'),
                import('../../server/providers/hr/authorize.js'),
              ]);
            const effect = String(
              (
                await (
                  await scopeForUser(
                    app.container.resolve(authorizationToken),
                    userId,
                  )
                ).authorize({
                  resource: { type: 'page', id: 'ai.settings' },
                  action: 'access',
                })
              ).effect,
            );
            return effect === 'allow' || effect === 'permit';
          },
        );
        return flags.configuration
          ? migration.configuration()
          : flags.preferences
            ? migration.preferences(flags.user!)
            : migration.conversation(flags.session!, flags.user!);
      });
      if (result.copied === 0) this.setStatus('success-noop');
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      throw new CommandError(
        'The legacy AI mapping was not committed; inspect the mapping prerequisites.',
        {
          code: /^[A-Z][A-Z0-9_]{1,80}$/u.test(message)
            ? message
            : 'UNMAPPED_LEGACY_RECORD',
        },
      );
    }
  }
}
