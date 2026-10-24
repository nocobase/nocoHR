import { expect, it } from 'vitest';
import { z } from 'zod';

import {
  compileProcessArtifact,
  loadProcessArtifact,
} from '../../server/providers/processes/artifact.js';
import type { ProcessHandler } from '../../server/providers/processes/engine.js';

const handlers = new Map<string, ProcessHandler>([['work', async () => true]]);
const source = {
  key: 'review',
  enabled: true,
  entry: 'work',
  inputSchema: z.strictObject({ text: z.string().min(1) }),
  nodes: [{ key: 'work', type: 'run' as const, handler: 'work' }],
};

it('validates inputs after a JSON round trip without the original source schema', () => {
  const artifact = compileProcessArtifact(source, handlers);
  const restored = loadProcessArtifact(
    JSON.parse(JSON.stringify(artifact)),
    handlers,
  );
  expect(restored.inputSchema.safeParse({ text: '' }).success).toBe(false);
  expect(
    restored.inputSchema.safeParse({ text: 'draft', extra: true }).success,
  ).toBe(false);
  expect(restored.inputSchema.parse({ text: 'draft' })).toEqual({
    text: 'draft',
  });
  expect(restored.hash).toBe(artifact.hash);
});

it('refuses tampered, unknown-node and missing-handler artifacts before execution', () => {
  const artifact = compileProcessArtifact(source, handlers);
  expect(() =>
    loadProcessArtifact({ ...artifact, entry: 'other' }, handlers),
  ).toThrow('PROCESS_ARTIFACT_DIGEST_MISMATCH');
  expect(() =>
    loadProcessArtifact(
      { ...artifact, nodes: [{ key: 'work', type: 'unknown' }] },
      handlers,
    ),
  ).toThrow('INVALID_PROCESS_ARTIFACT');
  expect(() => loadProcessArtifact(artifact, new Map())).toThrow(
    'PROCESS_HANDLER_NOT_AVAILABLE',
  );
});

it('rejects nonserializable input contracts rather than dropping their validation', () => {
  expect(() =>
    compileProcessArtifact(
      { ...source, inputSchema: z.string().transform(Number) },
      handlers,
    ),
  ).toThrow();
});

it.each([
  z
    .object({ start: z.number(), end: z.number() })
    .refine((x) => x.end > x.start),
  z.object({ start: z.number(), end: z.number() }).superRefine((x, ctx) => {
    if (x.end <= x.start)
      ctx.addIssue({ code: 'custom', message: 'Invalid range' });
  }),
  z.object({ ranges: z.array(z.number().refine((x) => x > 0)).optional() }),
  z.union([z.string().refine((x) => x === 'allowed'), z.number()]),
  z.number().check((ctx) => {
    if (ctx.value < 0)
      ctx.issues.push({
        code: 'custom',
        message: 'Negative',
        input: ctx.value,
      });
  }),
  z.number().overwrite((x) => Math.abs(x)),
])(
  'refuses custom constraints anywhere in a published input schema',
  (inputSchema) => {
    expect(() =>
      compileProcessArtifact({ ...source, inputSchema }, handlers),
    ).toThrow('UNSUPPORTED_PROCESS_INPUT_SCHEMA');
  },
);

it.each([
  z
    .number()
    .refine((n) => n > 0)
    .pipe(z.number()),
  z.number().pipe(z.number().refine((n) => n > 0)),
  z.number().pipe(z.number()),
  z.coerce.number(),
  z.coerce.boolean(),
  z.coerce.string(),
  z.number().catch(0),
  z.number().prefault(0),
])(
  'rejects source-only composition both directly and inside JSON structures',
  (inputSchema) => {
    for (const schema of [
      inputSchema,
      z.strictObject({ value: inputSchema }),
      z.array(inputSchema),
      z.union([z.null(), inputSchema]),
      z.record(z.string(), inputSchema),
    ]) {
      expect(() =>
        compileProcessArtifact({ ...source, inputSchema: schema }, handlers),
      ).toThrow('UNSUPPORTED_PROCESS_INPUT_SCHEMA');
    }
  },
);

const standardInputs: [z.ZodType, unknown, unknown][] = [
  [z.number().int().min(1).max(10), 3, 1.5],
  [z.enum(['a', 'b']), 'a', 'c'],
  [z.array(z.string().min(2)).nullable(), ['ab'], ['a']],
  [z.record(z.string(), z.number().min(0)), { a: 1 }, { a: -1 }],
  [z.tuple([z.string(), z.number()]), ['a', 1], ['a', '1']],
  [z.union([z.string().min(2), z.number().min(1)]), 'ab', 0],
  [z.number().default(2), undefined, 'bad'],
  [z.strictObject({ n: z.number().optional() }), {}, { n: 'bad' }],
  [z.looseObject({ n: z.number() }), { n: 1, extra: true }, { n: 'bad' }],
];
it.each(standardInputs)(
  'preserves supported standard input parsing through compilation and JSON',
  (inputSchema, good, bad) => {
    const restored = loadProcessArtifact(
      JSON.parse(
        JSON.stringify(
          compileProcessArtifact({ ...source, inputSchema }, handlers),
        ),
      ),
      handlers,
    );
    expect(restored.inputSchema.parse(good)).toEqual(inputSchema.parse(good));
    expect(restored.inputSchema.safeParse(bad).success).toBe(false);
  },
);

it.each([
  z.object({ n: z.number() }),
  z.record(z.enum(['a', 'b']), z.number()),
  z.number().optional(),
  z.string().regex(/^a$/iu),
  z.unknown().default(new Date('2026-01-01T00:00:00Z')),
])(
  'refuses structural semantics that the supported JSON contract cannot retain',
  (inputSchema) => {
    expect(() =>
      compileProcessArtifact({ ...source, inputSchema }, handlers),
    ).toThrow('UNSUPPORTED_PROCESS_INPUT_SCHEMA');
  },
);
