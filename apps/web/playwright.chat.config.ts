import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: 'chat-feedback.spec.ts', workers: 1, timeout: 60_000,
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:3000', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { viewport: { width: 390, height: 844 } } },
  ],
});
