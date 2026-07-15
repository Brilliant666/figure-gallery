import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  outputDir: 'test-results/playwright-output',
  reporter: [['list']],
  use: {
    browserName: 'chromium',
    channel: process.env.PLAYWRIGHT_USE_CHROME === 'true' ? 'chrome' : undefined,
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
  },
})
