import { chromium } from '@playwright/test'

const forbiddenHost = (rawURL) => {
  const hostname = new URL(rawURL).hostname.toLowerCase().replace(/\.$/, '')
  return hostname === 'hpoi.net' || hostname.endsWith('.hpoi.net')
}

const channel = process.env.VAL02B_BROWSER_CHANNEL || 'chrome'
const startedAt = performance.now()
let browser

try {
  browser = await chromium.launch({ ...(channel === 'chromium' ? {} : { channel }), headless: true })
  const page = await browser.newPage()
  const forbiddenAttempts = []
  await page.route('**/*', async (route) => {
    if (forbiddenHost(route.request().url())) {
      forbiddenAttempts.push(route.request().url())
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  await page.setContent('<!doctype html><title>VAL-02B synthetic browser probe</title><main>synthetic</main>')
  const title = await page.title()
  const result = {
    schema_version: 1,
    probe: 'val02b-project-local-browser',
    status: title === 'VAL-02B synthetic browser probe' && forbiddenAttempts.length === 0 ? 'pass' : 'fail',
    channel,
    browser_version: browser.version(),
    headless: true,
    duration_ms: Math.round((performance.now() - startedAt) * 100) / 100,
    network: 'no external navigation',
    forbidden_attempt_count: forbiddenAttempts.length,
    screenshot: false,
    video: false,
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      schema_version: 1,
      probe: 'val02b-project-local-browser',
      status: 'environment_blocked',
      channel,
      error: error instanceof Error ? error.message : String(error),
    }, null, 2)}\n`,
  )
  process.exitCode = 1
} finally {
  await browser?.close()
}
