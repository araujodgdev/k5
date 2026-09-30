import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'vault-pagination.spec.ts',
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    viewport: { width: 1280, height: 844 },
    screenshot: 'only-on-failure',
  },
});
