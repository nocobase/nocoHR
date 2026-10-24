import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { tmpdir } from 'node:os';
export default defineConfig({
  testDir: import.meta.dirname,
  testMatch: 'native-knowledge.test.ts',
  timeout: 180_000,
  workers: 1,
  reporter: 'line',
  outputDir: path.join(tmpdir(), 'nocohr-native-knowledge-browser'),
  use: { headless: true, trace: 'off' },
});
