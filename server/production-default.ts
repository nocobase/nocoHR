/**
 * Makes the compiled build run as production unless told otherwise.
 *
 * Every development-only switch in this application — the demo seeds and accounts, the local-file mailbox, the
 * development IM mock and org-sync routes, non-secure session cookies — keys on `NODE_ENV=production`. `pnpm start`
 * and the Dockerfile set it, but a deployment started as `node dist/server/standalone.js` (the deployment Skill's
 * own instruction for a service manager) or `node dist/cli/index.js db apply` does not, and it would quietly install
 * the demo company into a production database.
 *
 * The signal is the module's own file name: tsc emits `.js` into `dist/`, while `pnpm dev`, `pnpm nocobase` in the
 * source tree and Vitest all load the `.ts` source (the same signal `server/runtime.ts` uses for its deployment
 * root). An explicit `NODE_ENV`, including `development`, is always kept, so a compiled build can still be run as
 * development on purpose. Only the process environment counts: a `NODE_ENV` written in a deployment `.env` file
 * reaches the configuration sections but not `process.env`, so set it in the service's environment instead.
 *
 * Imported first by `server/standalone.ts` and `server/runtime.ts`, so it runs before anything reads the variable
 * — the CLI loads `runtime.js` without going through the standalone entry.
 */
export function isCompiledServerModule(file: string): boolean {
  return !/\.[cm]?tsx?$/.test(file);
}

/** Sets `NODE_ENV=production` when it is unset and `moduleFile` is compiled output; returns whether it did. */
export function applyProductionDefault(
  env: NodeJS.ProcessEnv,
  moduleFile: string,
): boolean {
  if (env.NODE_ENV || !isCompiledServerModule(moduleFile)) return false;
  env.NODE_ENV = 'production';
  return true;
}

applyProductionDefault(process.env, import.meta.filename);
