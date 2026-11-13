import { defineConfig } from '@playwright/test'

/** End-to-end tests drive the built app (`pnpm build`) through Playwright's Electron support. */
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 30_000,
  // One worker: tests run one after another, and test/e2e/app.ts caps open app instances at 5.
  workers: 1,
  globalSetup: './test/e2e/global-setup.ts',
  globalTeardown: './test/e2e/global-teardown.ts',
  reporter: [['list']],
})
