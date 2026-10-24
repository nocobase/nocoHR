import { z } from 'zod';

import { capabilityRecordDigest } from '../upgrade/digest.js';
import type { ProcessDefinition, ProcessHandler } from './engine.js';
import { validateProcessDefinition } from './engine.js';

const identifier = z.string().min(1).max(128);
const node = z.discriminatedUnion('type', [
  z.strictObject({
    key: identifier,
    type: z.literal('run'),
    handler: identifier,
    next: identifier.optional(),
  }),
  z.strictObject({
    key: identifier,
    type: z.literal('condition'),
    handler: identifier,
    yes: identifier,
    no: identifier,
  }),
  z.strictObject({
    key: identifier,
    type: z.literal('terminate'),
    outcome: z.enum(['success', 'failed']),
  }),
]);
const payloadSchema = z.strictObject({
  formatVersion: z.literal(1),
  key: identifier,
  enabled: z.boolean(),
  entry: identifier,
  inputSchema: z.record(z.string(), z.unknown()),
  nodes: z.array(node).min(1).max(10_000),
});
const artifactSchema = payloadSchema.extend({
  hash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export type ProcessArtifact = z.infer<typeof artifactSchema>;

const supportedInputChecks: Record<string, readonly string[]> = {
  string: ['min_length', 'max_length', 'length_equals', 'string_format'],
  number: ['greater_than', 'less_than', 'multiple_of', 'number_format'],
  array: ['min_length', 'max_length', 'length_equals'],
};

/** Only declarative JSON input contracts are supported; inspect source nodes before conversion can omit them. */
function assertSupportedInput(
  schema: z.core.$ZodType,
  ancestors = new Set<z.core.$ZodType>(),
  property = false,
): void {
  const def = (schema as z.core.$ZodTypes)._zod.def;
  const unsupported = () => {
    throw new Error('UNSUPPORTED_PROCESS_INPUT_SCHEMA');
  };
  if (ancestors.has(schema) || ('coerce' in def && def.coerce)) unsupported();
  for (const check of def.checks ?? []) {
    const constraint = check._zod.def;
    if (!supportedInputChecks[def.type]?.includes(constraint.check))
      unsupported();
    if (
      constraint.check === 'string_format' &&
      (!('format' in constraint) ||
        constraint.format !== 'regex' ||
        !('pattern' in constraint) ||
        !(constraint.pattern instanceof RegExp) ||
        constraint.pattern.flags)
    )
      unsupported();
  }
  // Specialized string formats can carry their own check outside def.checks.
  if (def.type === 'string' && 'format' in def) unsupported();
  ancestors.add(schema);
  const visit = (child: z.core.$ZodType, field = false) =>
    assertSupportedInput(child, ancestors, field);
  switch (def.type) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'null':
    case 'literal':
    case 'enum':
    case 'unknown':
    case 'any':
    case 'never':
      break;
    case 'array':
      visit(def.element);
      break;
    case 'object':
      // A stripping object cannot round trip: JSON Schema either rejects or retains extra keys.
      if (!def.catchall) unsupported();
      for (const child of Object.values(def.shape)) visit(child, true);
      visit(def.catchall!);
      break;
    case 'record':
      // Enum keys imply required properties in Zod, which a JSON Schema record does not retain.
      if (def.keyType._zod.def.type !== 'string') unsupported();
      visit(def.keyType);
      visit(def.valueType);
      break;
    case 'tuple':
      for (const child of def.items) visit(child);
      if (def.rest) visit(def.rest);
      break;
    case 'union':
      for (const child of def.options) visit(child);
      break;
    case 'optional':
      // Optionality is encoded by an object's required list, not by a root JSON Schema.
      if (!property) unsupported();
      visit(def.innerType, true);
      break;
    case 'nullable':
      visit(def.innerType, property);
      break;
    case 'default':
      if (!z.json().safeParse(def.defaultValue).success) unsupported();
      visit(def.innerType);
      break;
    default:
      // Includes pipe/transform, catch, prefault, lazy and other source-only behavior.
      unsupported();
  }
  ancestors.delete(schema);
}

/** Compile serializable contracts; unsupported schema transforms fail before an artifact is published. */
export function compileProcessArtifact(
  definition: Omit<ProcessDefinition, 'hash'>,
  handlers: ReadonlyMap<string, ProcessHandler>,
): ProcessArtifact {
  validateProcessDefinition({ ...definition, hash: 'compiling' }, handlers);
  assertSupportedInput(definition.inputSchema);
  const payload = payloadSchema.parse({
    formatVersion: 1,
    key: definition.key,
    enabled: definition.enabled,
    entry: definition.entry,
    nodes: definition.nodes,
    inputSchema: z.toJSONSchema(definition.inputSchema),
  });
  // Also prove that source-free validation supports this schema before publishing it.
  z.fromJSONSchema(payload.inputSchema);
  return { ...payload, hash: capabilityRecordDigest(payload) };
}

/** Load only supported and intact definitions. No module path or handler body comes from a database row. */
export function loadProcessArtifact(
  value: unknown,
  handlers: ReadonlyMap<string, ProcessHandler>,
): ProcessDefinition {
  const parsed = artifactSchema.safeParse(value);
  if (!parsed.success) throw new Error('INVALID_PROCESS_ARTIFACT');
  const { hash, ...payload } = parsed.data;
  if (capabilityRecordDigest(payload) !== hash)
    throw new Error('PROCESS_ARTIFACT_DIGEST_MISMATCH');
  const definition: ProcessDefinition = {
    key: payload.key,
    hash,
    enabled: payload.enabled,
    entry: payload.entry,
    nodes: payload.nodes,
    inputSchema: z.fromJSONSchema(payload.inputSchema),
  };
  validateProcessDefinition(definition, handlers);
  return definition;
}
