import { expect, test } from '@playwright/test'

import { monitorLoopbackRequests } from './network-guard'

test.describe('Payload Admin authentication boundary', () => {
  test('redirects a protected Admin collection to the authentication surface', async ({ page }) => {
    const assertNoExternalRequests = monitorLoopbackRequests(page)
    const response = await page.goto('/admin/collections/users')
    expect(response?.status()).toBe(200)
    await expect(page).toHaveURL(/\/admin\/(login|create-first-user)/)
    await expect(page).not.toHaveURL(/\/admin\/collections\/users/)
    await expect(page.locator('input[name="email"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    assertNoExternalRequests()
  })
})
