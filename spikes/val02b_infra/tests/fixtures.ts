import { expect, test as base, type Locator, type Page, type TestInfo } from '@playwright/test'


export type Prototype = 'wagtail' | 'payload'

export type BrowserMetrics = {
  clicks: number
  console_error_count: number
  duration_ms: number
  forbidden_request_count: number
  forbidden_request_hosts: string[]
  hpoi_request_attempt_count: number
  keyboard_actions: number
  main_frame_navigations: number
  network_failure_count: number
  network_failures: Array<{
    error_text: string
    method: string
    url: string
  }>
  prototype: Prototype
}

type GateFixtures = {
  gateMetrics: BrowserMetrics
  prototype: Prototype
}

const isLoopback = (hostname: string): boolean =>
  ['127.0.0.1', '::1', 'localhost'].includes(hostname.toLowerCase().replace(/\.$/, ''))

const isHpoi = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase().replace(/\.$/, '')
  return normalized === 'hpoi.net' || normalized.endsWith('.hpoi.net')
}

export const test = base.extend<GateFixtures>({
  prototype: async ({}, use, testInfo) => {
    const prototype = testInfo.project.metadata.prototype
    if (prototype !== 'wagtail' && prototype !== 'payload') {
      throw new Error('Playwright project metadata must identify wagtail or payload.')
    }
    await use(prototype)
  },
  gateMetrics: async ({ page, prototype }, use, testInfo) => {
    const startedAt = performance.now()
    const metrics: BrowserMetrics = {
      clicks: 0,
      console_error_count: 0,
      duration_ms: 0,
      forbidden_request_count: 0,
      forbidden_request_hosts: [],
      hpoi_request_attempt_count: 0,
      keyboard_actions: 0,
      main_frame_navigations: 0,
      network_failure_count: 0,
      network_failures: [],
      prototype,
    }
    page.on('console', (message) => {
      if (message.type() === 'error') metrics.console_error_count += 1
    })
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) metrics.main_frame_navigations += 1
    })
    page.on('requestfailed', (request) => {
      metrics.network_failure_count += 1
      if (metrics.network_failures.length < 20) {
        const url = new URL(request.url())
        metrics.network_failures.push({
          error_text: request.failure()?.errorText ?? 'unknown',
          method: request.method(),
          url: `${url.origin}${url.pathname}`,
        })
      }
    })
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (['http:', 'https:'].includes(url.protocol) && !isLoopback(url.hostname)) {
        metrics.forbidden_request_count += 1
        if (!metrics.forbidden_request_hosts.includes(url.hostname)) {
          metrics.forbidden_request_hosts.push(url.hostname)
        }
        if (isHpoi(url.hostname)) metrics.hpoi_request_attempt_count += 1
        await route.abort('blockedbyclient')
        return
      }
      await route.continue()
    })
    await use(metrics)
    metrics.duration_ms = Math.round((performance.now() - startedAt) * 100) / 100
    await attachMetrics(testInfo, metrics)
    expect(metrics.hpoi_request_attempt_count, 'Hpoi request attempts must remain zero').toBe(0)
    expect(
      metrics.forbidden_request_count,
      `browser requests must remain loopback-only; blocked hosts=${metrics.forbidden_request_hosts.join(',')}`,
    ).toBe(0)
  },
})

export { expect }

export const click = async (locator: Locator, metrics: BrowserMetrics): Promise<void> => {
  metrics.clicks += 1
  await locator.click()
}

export const press = async (
  page: Page,
  key: string,
  metrics: BrowserMetrics,
): Promise<void> => {
  metrics.keyboard_actions += 1
  await page.keyboard.press(key)
}

export const attachMetrics = async (
  testInfo: TestInfo,
  metrics: BrowserMetrics,
  extra: Record<string, unknown> = {},
): Promise<void> => {
  await testInfo.attach('val02b-browser-metrics', {
    body: Buffer.from(JSON.stringify({ schema_version: 1, ...metrics, ...extra })),
    contentType: 'application/json',
  })
}

export const runtimeValue = (name: string): string | undefined => {
  const value = process.env[name]
  return value && value.trim() ? value : undefined
}

const firstRuntimeValue = (...names: string[]): string | undefined =>
  names.map(runtimeValue).find((value) => value !== undefined)

export const login = async (
  page: Page,
  prototype: Prototype,
  metrics: BrowserMetrics,
): Promise<void> => {
  const loginPath = prototype === 'wagtail' ? '/admin/login/' : '/admin/login'
  const identity =
    prototype === 'wagtail'
      ? firstRuntimeValue('VAL02_WAGTAIL_ADMIN_USERNAME', 'VAL02B_WAGTAIL_ADMIN_USERNAME')
      : firstRuntimeValue('VAL02_PAYLOAD_ADMIN_EMAIL', 'VAL02B_PAYLOAD_ADMIN_EMAIL')
  const password =
    prototype === 'wagtail'
      ? firstRuntimeValue('VAL02_WAGTAIL_ADMIN_PASSWORD', 'VAL02B_WAGTAIL_ADMIN_PASSWORD', 'VAL02B_ADMIN_PASSWORD')
      : firstRuntimeValue('VAL02_PAYLOAD_ADMIN_PASSWORD', 'VAL02B_PAYLOAD_ADMIN_PASSWORD')
  test.skip(!identity || !password, `runtime-only ${prototype} browser credentials are required`)
  await page.goto(loginPath)
  await page.locator(prototype === 'wagtail' ? 'input[name="username"]' : 'input[name="email"]').fill(identity!)
  await page.locator('input[name="password"]').fill(password!)
  await click(page.getByRole('button', { name: /log in|login|sign in|登录/i }), metrics)
  await page.waitForLoadState('networkidle')
  await expect(page.locator('input[name="password"]')).toHaveCount(0)
}
