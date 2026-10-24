import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  compileProcessArtifact,
  loadProcessArtifact,
  type ProcessArtifact,
} from './artifact.js';
import type { ProcessDefinition, ProcessHandler } from './engine.js';

const entry = z.strictObject({
  key: z.string().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
});
const manifest = z.array(entry).max(200);

/** Explicit manifest; filenames cannot originate from HTTP input or stored module paths. */
export class ProcessCatalog {
  private readonly artifacts = new Map<string, ProcessArtifact>();
  public constructor(
    private readonly handlers: ReadonlyMap<string, ProcessHandler>,
  ) {}
  public async load(directory: string) {
    const root = await realpath(directory);
    const manifestBytes = await readFile(path.join(root, 'manifest.json'));
    if (manifestBytes.length > 262144)
      throw new Error('PROCESS_MANIFEST_TOO_LARGE');
    const entries = manifest.parse(JSON.parse(manifestBytes.toString()));
    const loaded = new Map<string, ProcessArtifact>();
    for (const item of entries) {
      const file = await realpath(path.join(root, `${item.hash}.json`));
      if (path.dirname(file) !== root)
        throw new Error('INVALID_PROCESS_ARTIFACT_PATH');
      const bytes = await readFile(file);
      if (bytes.length > 1048576) throw new Error('PROCESS_ARTIFACT_TOO_LARGE');
      const artifact: unknown = JSON.parse(bytes.toString());
      const definition = loadProcessArtifact(artifact, this.handlers);
      if (
        definition.key !== item.key ||
        definition.hash !== item.hash ||
        loaded.has(item.hash)
      )
        throw new Error('PROCESS_MANIFEST_CONFLICT');
      loaded.set(item.hash, artifact as ProcessArtifact);
    }
    this.artifacts.clear();
    for (const [hash, artifact] of loaded) this.artifacts.set(hash, artifact);
  }
  public list() {
    return [...this.artifacts.values()].map(
      ({ key, hash, enabled, inputSchema }) => ({
        key,
        hash,
        enabled,
        inputSchema,
      }),
    );
  }
  public artifact(key: string, hash: string): ProcessArtifact {
    const artifact = this.artifacts.get(hash);
    if (!artifact || artifact.key !== key)
      throw new Error('MISSING_PROCESS_ARTIFACT');
    return structuredClone(artifact);
  }
  public resolve(key: string, hash: string) {
    return loadProcessArtifact(this.artifact(key, hash), this.handlers);
  }
}

export async function writeProcessArtifacts(
  directory: string,
  definitions: readonly Omit<ProcessDefinition, 'hash'>[],
  handlers: ReadonlyMap<string, ProcessHandler>,
) {
  const artifacts = definitions.map((definition) =>
    compileProcessArtifact(definition, handlers),
  );
  if (
    artifacts.length > 200 ||
    new Set(artifacts.map((a) => a.hash)).size !== artifacts.length
  )
    throw new Error('PROCESS_MANIFEST_CONFLICT');
  await mkdir(directory, { recursive: true });
  for (const artifact of artifacts)
    await writeFile(
      path.join(directory, `${artifact.hash}.json`),
      JSON.stringify(artifact),
    );
  // Publish only after every artifact compiled and was written; no deployment data is touched.
  await writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify(artifacts.map(({ key, hash }) => ({ key, hash }))),
  );
}
