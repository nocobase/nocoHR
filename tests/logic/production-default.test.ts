// @vitest-environment node

// A compiled build (`node dist/server/standalone.js`, `node dist/cli/index.js`) runs as production unless NODE_ENV
// says otherwise; the TypeScript sources that `pnpm dev`, the source CLI and Vitest load are left alone.
import { describe, expect, it } from 'vitest';

import {
  applyProductionDefault,
  isCompiledServerModule,
} from '../../server/production-default.ts';

describe('production default', () => {
  it('treats emitted JavaScript as compiled and TypeScript sources as not', () => {
    expect(
      isCompiledServerModule('/srv/app/dist/server/production-default.js'),
    ).toBe(true);
    expect(isCompiledServerModule('/repo/server/production-default.ts')).toBe(
      false,
    );
    expect(isCompiledServerModule('/repo/server/production-default.mts')).toBe(
      false,
    );
  });

  it('sets production for a compiled module when NODE_ENV is unset or empty', () => {
    for (const initial of [undefined, '']) {
      const env: NodeJS.ProcessEnv = { NODE_ENV: initial };
      expect(
        applyProductionDefault(
          env,
          '/srv/app/dist/server/production-default.js',
        ),
      ).toBe(true);
      expect(env.NODE_ENV).toBe('production');
    }
  });

  it('keeps an explicit NODE_ENV, including development', () => {
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'development' };
    expect(
      applyProductionDefault(env, '/srv/app/dist/server/production-default.js'),
    ).toBe(false);
    expect(env.NODE_ENV).toBe('development');
  });

  it('leaves the TypeScript sources (pnpm dev, Vitest) unchanged', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(
      applyProductionDefault(env, '/repo/server/production-default.ts'),
    ).toBe(false);
    expect(env.NODE_ENV).toBeUndefined();
    // Importing the module under Vitest did not switch this process to production either.
    expect(process.env.NODE_ENV).not.toBe('production');
  });
});
