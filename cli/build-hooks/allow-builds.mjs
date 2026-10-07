// Carries this application's install-script decisions into the deployment tree's `dist/pnpm-workspace.yaml`.
//
// `@nocobase/app-cli` writes that file with its own `allowBuilds` list, without this application's entries such as
// `protobufjs: false` (the Feishu SDK's protobufjs only prints a notice from its install script). The build's own
// install of `dist/` then needs `pnpm_config_strict_dep_builds=false` (the `build` script sets it), and pnpm leaves
// `protobufjs: set this to true or false` in the generated file — so a later `pnpm install --prod` inside `dist/` on
// a server, the documented repair when `node_modules` was left out of a copy, stops with ERR_PNPM_IGNORED_BUILDS.
//
// Runs as an `afterBuild` hook (cli/build-hooks/index.ts): after the install, before `--tar` packs `dist/`. It only
// settles entries pnpm left undecided, using the application's own `true`/`false`; an entry the application has not
// decided either is reported and left for a person, never guessed. Remove it once app-cli carries the application's
// `allowBuilds` into `dist/`.
import fs from 'node:fs';
import path from 'node:path';

// A build script, not a CLI command: it reports through stdout/stderr and finds the application root from its own path.
const root = path.resolve(import.meta.dirname, '../..');
const ENTRY = /^(\s+)(['"]?)([^'"\s:#][^'":#]*)\2:\s*(.*?)\s*$/u;

/** The `allowBuilds` entries of a pnpm-workspace.yaml, by package name, with the line each sits on. */
function allowBuilds(lines) {
  const entries = new Map();
  const start = lines.findIndex((line) => /^allowBuilds:\s*$/u.test(line));
  if (start < 0) return entries;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || /^\s+#/u.test(line)) continue;
    const match = ENTRY.exec(line);
    if (!match || !match[1]) break;
    entries.set(match[3].trim(), { index: i, value: match[4], match });
  }
  return entries;
}

const read = (file) => fs.readFileSync(file, 'utf8').split('\n');
const appEntries = allowBuilds(read(path.join(root, 'pnpm-workspace.yaml')));
const distFile = path.join(root, 'dist', 'pnpm-workspace.yaml');
if (!fs.existsSync(distFile)) {
  process.stderr.write(
    `${path.relative(root, distFile)} does not exist; nothing to settle.\n`,
  );
  process.exit(1);
}
const distLines = read(distFile);
const settled = [];
const undecided = [];
for (const [name, entry] of allowBuilds(distLines)) {
  if (entry.value === 'true' || entry.value === 'false') continue;
  const decision = appEntries.get(name)?.value;
  if (decision !== 'true' && decision !== 'false') {
    undecided.push(name);
    continue;
  }
  const [, indent, quote] = entry.match;
  distLines[entry.index] = `${indent}${quote}${name}${quote}: ${decision}`;
  settled.push(`${name}: ${decision}`);
}
if (settled.length) fs.writeFileSync(distFile, distLines.join('\n'));
process.stdout.write(
  settled.length
    ? `Settled in dist/pnpm-workspace.yaml from the application's allowBuilds: ${settled.join(', ')}\n`
    : 'dist/pnpm-workspace.yaml has no undecided install scripts.\n',
);
if (undecided.length)
  process.stderr.write(
    `Still undecided in dist/pnpm-workspace.yaml (add them to allowBuilds in pnpm-workspace.yaml): ${undecided.join(', ')}\n`,
  );
