import { defineConfig } from '@playwright/test'
import os from 'node:os'
import path from 'node:path'

const repositoryRoot = path.resolve(import.meta.dirname, '../..')
const resultRoot = path.resolve(
  process.env.VAL02B_BROWSER_RESULTS_DIR ?? path.join(os.tmpdir(), 'figure-gallery-val02b-playwright'),
)

if (resultRoot === repositoryRoot || resultRoot.startsWith(`${repositoryRoot}${path.sep}`)) {
  throw new Error('VAL02B_BROWSER_RESULTS_DIR must be outside the repository.')
}

const browserChannel = process.env.VAL02B_BROWSER_CHANNEL || 'chrome'
const browserSelection = browserChannel === 'chromium' ? {} : { channel: browserChannel }

const loopbackURL = (name: string, fallback: string): string => {
  const value = process.env[name] || fallback
  const parsed = new URL(value)
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (!['127.0.0.1', '::1', 'localhost'].includes(hostname)) {
    throw new Error(`${name} must use a loopback hostname.`)
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`)
  }
  return parsed.origin
}

export default defineConfig({
  testDir: './tests',
  outputDir: path.join(resultRoot, 'artifacts'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(resultRoot, 'playwright-results.json') }],
  ],
  use: {
    ...browserSelection,
    headless: true,
    screenshot: 'off',
    video: 'off',
    trace: 'off',
    ignoreHTTPSErrors: false,
  },
  projects: [
    {
      name: 'wagtail-chrome',
      metadata: { prototype: 'wagtail' },
      use: { baseURL: loopbackURL('VAL02B_WAGTAIL_BASE_URL', 'http://127.0.0.1:8000') },
    },
    {
      name: 'payload-chrome',
      metadata: { prototype: 'payload' },
      use: { baseURL: loopbackURL('VAL02B_PAYLOAD_BASE_URL', 'http://127.0.0.1:3000') },
    },
  ],
})
