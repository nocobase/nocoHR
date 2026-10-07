import { defineCliPlugins, type AppCliPlugins } from '@nocobase/app-cli';
import aiEmployee from '@nocobase/app-plugin-ai-employee/cli';
import scheduler from '@nocobase/app-plugin-scheduler/cli';
import workflow from '@nocobase/app-plugin-workflow/cli';

// Not a plugin package: the application's own build hooks, which only a CLI plugin entry can declare.
import buildHooks from './build-hooks/index.js';

// Array order is command registration order. A plugin contributes its commands
// by appearing in this list; removing its entry and its import removes them.
const cliPlugins: AppCliPlugins = defineCliPlugins([
  workflow,
  scheduler,
  aiEmployee,
  buildHooks,
]);

export default cliPlugins;
