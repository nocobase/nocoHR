import { defineCliPlugins, type AppCliPlugins } from '@nocobase/app-cli';
import scheduler from '@nocobase/app-plugin-scheduler/cli';
import agents from '@nocobase/app-plugin-agents/cli';
import foundation from '@nocobase/app-plugin-foundation/cli';

// Not a plugin package: the application's own build hooks, which only a CLI plugin entry can declare.
import buildHooks from './build-hooks/index.js';

// Array order is command registration order. A plugin contributes its commands
// by appearing in this list; removing its entry and its import removes them.
const cliPlugins: AppCliPlugins = defineCliPlugins([
  scheduler,
  buildHooks,
  agents,
  foundation,
]);

export default cliPlugins;
