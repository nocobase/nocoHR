import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';

/** Dedicated synthetic host; this never opens an application deployment. */
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'process-presentation.test.ts',
  timeout: 90_000,
  workers: 1,
  reporter: 'line',
  outputDir: path.join(tmpdir(), 'nocohr-process-presentation-browser'),
  use: { headless: true, trace: 'off' },
});
