import process from 'node:process';
import { performance } from 'node:perf_hooks';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  createWriteStream,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const args = process.argv.slice(2);
const option = (key) => {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
};
const order = option('--order');
const phase = option('--phase');
const scenario = option('--result') ?? 'success';
assert(['success', 'failure', 'mixed'].includes(scenario));
assert(
  ['original', 'candidate'].includes(order),
  '--order original|candidate is required',
);
assert(['before', 'late'].includes(phase), '--phase before|late is required');
assert(option('--output'), '--output must name a new owned directory');
const output = path.resolve(option('--output'));
assert(!existsSync(output), 'Never overwrite previous evidence');
assert(
  existsSync(path.join(root, 'node_modules')),
  'Install the fixed application dependencies first',
);
for (const name of [
  '.env',
  '.env.local',
  'config.yml',
  'config.yaml',
  'config.local.yml',
  'config.json',
])
  assert(
    !existsSync(path.join(root, name)),
    `Refuse a checkout with runtime configuration: ${name}`,
  );
mkdirSync(output, { recursive: true });
const work = mkdtempSync(path.join(tmpdir(), 'mail-dependency-probe-'));
const tree = path.join(work, 'app');
const resources = path.join(work, 'resources');
mkdirSync(tree);
mkdirSync(resources);
const head = execFileSync(
  'git',
  ['rev-parse', option('--revision') ?? 'HEAD'],
  {
    cwd: root,
    encoding: 'utf8',
  },
).trim();
const archive = execFileSync('git', ['archive', head], {
  cwd: root,
  maxBuffer: 256 * 1024 * 1024,
});
execFileSync('tar', ['-x', '-C', tree], { input: archive });
symlinkSync(
  path.join(root, 'node_modules'),
  path.join(tree, 'node_modules'),
  'dir',
);
// These verification-only sources may be uncommitted during development; runtime stays at the recorded head.
for (const relative of [
  'tests/acceptance/mail-business-close-probe.ts',
  'tests/acceptance/mail-dependency-provider.ts',
  'tests/helpers/close-diagnostics.ts',
])
  copyFileSync(path.join(root, relative), path.join(tree, relative));
function replace(relative, before, after) {
  const file = path.join(tree, relative);
  const text = readFileSync(file, 'utf8');
  assert.equal(
    text.split(before).length,
    2,
    `Expected one anchor in ${relative}`,
  );
  writeFileSync(file, text.replace(before, after));
}
replace(
  'server/providers/index.ts',
  'const serviceProviders:',
  "import MailDependencyProbeProvider from '../../tests/acceptance/mail-dependency-provider.ts';\n\nconst serviceProviders:",
);
replace(
  'server/providers/index.ts',
  '  HrProvider,',
  '  HrProvider,\n  MailDependencyProbeProvider,',
);
replace(
  'tests/logic/talent-review-harness.ts',
  "process.env.HR_RECRUITING_DEMO = 'false';",
  "process.env.HR_RECRUITING_DEMO = 'true';",
);
replace(
  'tests/logic/talent-review-harness.ts',
  "      auth: { secret: 'test-auth-secret-at-least-32-characters' },",
  `      auth: { secret: 'test-auth-secret-at-least-32-characters' },\n      secrets: { keys: [{ version: 1, key: '${randomBytes(32).toString('base64')}' }] },`,
);
replace(
  'tests/logic/hr-file-security.test.ts',
  'let h: Harness;',
  "import { installMailBusinessProbe } from '../acceptance/mail-business-close-probe.ts';\nlet businessProbe: Awaited<ReturnType<typeof installMailBusinessProbe>>;\nlet h: Harness;",
);
replace(
  'tests/logic/hr-file-security.test.ts',
  "  h = await startHarness('hr-file-security');",
  "  h = await startHarness('hr-file-security');\n  businessProbe = await installMailBusinessProbe(h);",
);
replace(
  'tests/logic/hr-file-security.test.ts',
  'close: () => h?.close(),',
  'close: () => businessProbe.close(),',
);
replace(
  'vitest.config.ts',
  'const config = createReactVitestConfig({',
  "const config = createReactVitestConfig({\n  cacheDir: new URL('./.probe-vite-cache', import.meta.url).pathname,",
);
if (order === 'candidate')
  replace(
    'server/plugins.ts',
    '  scheduler,\n  mail,',
    '  mail,\n  scheduler,',
  );
const env = Object.fromEntries(
  ['PATH', 'HOME']
    .filter((key) => process.env[key] !== undefined)
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  TMPDIR: resources,
  TMP: resources,
  TEMP: resources,
  NODE_ENV: 'test',
  MAIL_PROBE_PHASE: phase,
  MAIL_PROBE_RESULT: scenario,
});
const started = performance.now();
const log = createWriteStream(path.join(output, 'run.log'), { flags: 'wx' });
const child = spawn(
  'pnpm',
  [
    'exec',
    'vitest',
    'run',
    'tests/logic/hr-file-security.test.ts',
    '--maxWorkers=1',
  ],
  { cwd: tree, env, stdio: ['ignore', 'pipe', 'pipe'] },
);
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
const status = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', (code, signal) => resolve({ code, signal }));
});
await new Promise((resolve) => log.end(resolve));
const leftovers = readdirSync(resources);
const result = {
  head,
  order,
  phase,
  scenario,
  ...status,
  elapsedMs: Math.round(performance.now() - started),
  leftoversRemovedAfterChildExit: leftovers,
  forcedTermination: false,
};
// Worker exit precedes deletion. A failed application's close is still a failed close.
rmSync(work, { recursive: true, force: true });
writeFileSync(
  path.join(output, 'result.json'),
  JSON.stringify(result, null, 2) + '\n',
);
process.stdout.write(JSON.stringify(result) + '\n');
process.exitCode = status.code ?? 1;
