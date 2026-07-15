import { expect, test } from '@playwright/test'

import { monitorLoopbackRequests } from './network-guard'

test.describe('formal initialization surface', () => {
  test('renders only the baseline placeholder', async ({ page }) => {
    const assertNoExternalRequests = monitorLoopbackRequests(page)
    await page.goto('/')
    await expect(page).toHaveTitle('Figure Gallery')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Figure Gallery')
    await expect(page.getByText('formal initialization baseline', { exact: true })).toBeVisible()
    await expect(page.locator('form, input')).toHaveCount(0)
    assertNoExternalRequests()
  })

  test('exposes distinct live and ready probes', async ({ page }) => {
    const assertNoExternalRequests = monitorLoopbackRequests(page)
    const live = await page.goto('/api/health/live')
    expect(live?.status()).toBe(200)
    expect(JSON.parse(await page.locator('body').innerText())).toMatchObject({ status: 'ok' })

    const ready = await page.goto('/api/health/ready')
    expect(ready?.status()).toBe(200)
    expect(JSON.parse(await page.locator('body').innerText())).toMatchObject({ status: 'ok' })
    assertNoExternalRequests()
  })
})
