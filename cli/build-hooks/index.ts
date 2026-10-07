import { defineCliPlugin, type AppCliPlugin } from '@nocobase/app-cli';

/**
 * This application's own build hooks. A build hook can only be declared by a CLI plugin, so the application
 * registers this one in `cli/plugins.ts`; it is not a package and contributes no commands.
 *
 * `afterBuild` settles the install-script decisions `@nocobase/app-cli` leaves out of `dist/pnpm-workspace.yaml`
 * (see `allow-builds.mjs`), so `pnpm install --prod` inside a deployed `dist/` works without extra settings.
 */
const buildHooks: AppCliPlugin = defineCliPlugin({
  packageName: '@hr/build-hooks',
  description: "The application's own build hooks.",
  buildHooks: {
    afterBuild: [
      {
        label: 'Settle install scripts in dist/pnpm-workspace.yaml',
        command: ['node', 'cli/build-hooks/allow-builds.mjs'],
      },
    ],
  },
});

export default buildHooks;
