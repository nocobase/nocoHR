import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'mail-completion.test.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'line',
  outputDir: path.join(tmpdir(), 'nocohr-mail-completion-browser'),
  use: { headless: true, trace: 'off' },
});
