import type { Locator, Page } from '@playwright/test'

import {
  click,
  expect,
  login,
  press,
  runtimeValue,
  test,
  type BrowserMetrics,
  type Prototype,
} from './fixtures.js'


const submitWagtailReview = async (
  page: Page,
  metrics: BrowserMetrics,
  action: string,
  configure?: () => Promise<void>,
): Promise<void> => {
  await page.locator('select[name="action"]').selectOption(action)
  await page.locator('textarea[name="reason"]').fill(`VAL-02B browser ${action} synthetic review`)
  if (configure) await configure()
  await click(page.getByTestId('apply-review'), metrics)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText(/action recorded with an operation log/i)).toBeVisible()
}

const selectFirstRealOption = async (locator: Locator): Promise<void> => {
  const options = locator.locator('option:not([value=""])')
  expect(await options.count()).toBeGreaterThan(0)
  await locator.selectOption({ index: 1 })
}

const runWagtailReview = async (page: Page, metrics: BrowserMetrics): Promise<void> => {
  const reviewPath = runtimeValue('VAL02B_WAGTAIL_REVIEW_PATH')
  test.skip(!reviewPath, 'VAL02B_WAGTAIL_REVIEW_PATH must identify the seeded synthetic candidate')
  await page.goto(reviewPath!)
  await expect(page.getByTestId('candidate-review')).toBeVisible()
  expect(await page.getByTestId('candidate-images').locator('figure').count()).toBeGreaterThanOrEqual(2)

  await submitWagtailReview(page, metrics, 'accept_field', async () => {
    await page.locator('select[name="field_name"]').selectOption('title')
    await selectFirstRealOption(page.locator('select[name="target_prototype"]'))
  })
  await submitWagtailReview(page, metrics, 'reject_field', async () => {
    await page.locator('select[name="field_name"]').selectOption('scale')
  })
  await submitWagtailReview(page, metrics, 'select_main', async () => {
    await selectFirstRealOption(page.locator('select[name="target_prototype"]'))
    await selectFirstRealOption(page.locator('select[name="candidate_image"]'))
  })
  await submitWagtailReview(page, metrics, 'attach', async () => {
    await selectFirstRealOption(page.locator('select[name="target_version"]'))
  })
  await submitWagtailReview(page, metrics, 'complete')
  await expect(page.getByTestId('review-work-item')).toContainText(/completed/i)
  const logCountText = await page.getByTestId('operation-log-count').textContent()
  expect(Number.parseInt(logCountText ?? '', 10)).toBeGreaterThan(0)
}

const clickPayloadAction = async (
  page: Page,
  metrics: BrowserMetrics,
  locator: Locator,
  endpoint: RegExp = /review-action/,
): Promise<void> => {
  const responsePromise = page.waitForResponse(
    (response) => endpoint.test(new URL(response.url()).pathname) && response.request().method() === 'POST',
  )
  await click(locator, metrics)
  const response = await responsePromise
  expect(response.ok(), `review endpoint returned HTTP ${response.status()}`).toBeTruthy()
  await expect(page.getByTestId('review-status')).toContainText(/recorded|audited|completed/i)
}

const runPayloadReview = async (page: Page, metrics: BrowserMetrics): Promise<void> => {
  await page.goto('/admin/candidate-review')
  await expect(page.getByTestId('candidate-review-workbench')).toBeVisible()
  const candidateID = runtimeValue('VAL02B_PAYLOAD_BROWSER_CANDIDATE_ID')
  if (candidateID) await page.getByTestId('candidate-select').selectOption(candidateID)
  expect(await page.getByTestId('candidate-image').count()).toBeGreaterThanOrEqual(2)

  await clickPayloadAction(page, metrics, page.getByTestId('accept-title'))
  const rejection = page.locator('[data-testid^="reject-"]:not([data-testid="reject-title"])').first()
  await clickPayloadAction(page, metrics, rejection)

  const targets = page.getByTestId('target-prototype')
  const allowed = targets.locator('option', { hasText: '(allowed)' }).first()
  expect(await allowed.count()).toBe(1)
  await targets.selectOption(await allowed.getAttribute('value') || '')

  await clickPayloadAction(page, metrics, page.locator('[data-testid^="select-main-image-"]').first())
  await clickPayloadAction(page, metrics, page.getByTestId('publish-formal-target'))
  await page.getByTestId('audit-reason').fill('VAL-02B browser completed synthetic review')
  await clickPayloadAction(
    page,
    metrics,
    page.getByTestId('complete-review-work-item'),
    /operation-logs\/domain-action/,
  )
  await expect(page.getByTestId('review-status')).toContainText(/completed and audited/i)
}

test.describe.configure({ mode: 'serial' })

test('BG-01 real Chrome administrator login', async ({ gateMetrics, page, prototype }) => {
  await login(page, prototype, gateMetrics)
  await expect(page).not.toHaveURL(/\/admin\/login\/?(?:\?|$)/)
})

test('BG-02 complete candidate review through the real browser', async ({
  gateMetrics,
  page,
  prototype,
}) => {
  await login(page, prototype, gateMetrics)
  if (prototype === 'wagtail') await runWagtailReview(page, gateMetrics)
  else await runPayloadReview(page, gateMetrics)
})

const gridColumnCount = async (page: Page): Promise<number> =>
  page.locator('.gallery-grid').evaluate((element) => {
    const columns = window.getComputedStyle(element).gridTemplateColumns
    return columns.split(' ').filter(Boolean).length
  })

const galleryCardSource = async (page: Page, prototype: Prototype): Promise<string> => {
  if (prototype === 'wagtail') {
    return (await page.locator('[data-lightbox-image]').getAttribute('src')) || ''
  }
  return (await page.getByRole('dialog', { name: '图片查看器' }).locator('img').getAttribute('src')) || ''
}

const enableAdultImagesAndSmallPages = async (
  page: Page,
  metrics: BrowserMetrics,
  prototype: Prototype,
): Promise<void> => {
  if (prototype === 'wagtail') {
    await page.goto('/admin/domain-operations/')
    await page.locator('select[name="action"]').selectOption('settings')
    await page.locator('textarea[name="payload"]').fill(JSON.stringify({
      page_size: 2,
      show_adult_images: true,
    }))
    await page.locator('textarea[name="reason"]').fill('VAL-02B browser visibility and pagination gate')
    await click(page.getByTestId('apply-domain-operation'), metrics)
    await page.waitForLoadState('networkidle')
    await expect(page.getByText(/audited domain operation completed/i)).toBeVisible()
    return
  }

  await page.goto('/admin/domain-operations')
  await page.getByLabel('Domain command', { exact: true }).selectOption('update-settings')
  await page.getByLabel('Domain command parameters', { exact: true }).fill(JSON.stringify({
    settings: { galleryPageSize: 2, showAdultImages: true },
  }))
  await page.getByLabel('Domain command reason', { exact: true }).fill('VAL-02B browser visibility and pagination gate')
  const responsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname.endsWith('/operation-logs/domain-action')
      && response.request().method() === 'POST',
  )
  await click(page.getByRole('button', { name: 'Run audited command' }), metrics)
  const response = await responsePromise
  expect(response.ok(), `settings endpoint returned HTTP ${response.status()}`).toBeTruthy()
  await expect(
    page.getByRole('status').filter({ hasText: /committed with an OperationLog/i }),
  ).toContainText(/committed with an OperationLog/i)
}

test('BG-03/BG-04 public search, gallery, lightbox and responsive layout', async ({
  gateMetrics,
  page,
  prototype,
}, testInfo) => {
  await page.goto('/')
  await page.locator('input[name="q"]').fill('林')
  await click(page.getByRole('button', { name: /搜索/ }), gateMetrics)
  await page.waitForLoadState('networkidle')
  await expect(page.getByText('星轨纪事')).toBeVisible()
  await expect(page.getByText('月庭物语')).toBeVisible()

  await page.goto('/')
  await page.locator('input[name="q"]').fill('月庭林')
  await click(page.getByRole('button', { name: /搜索/ }), gateMetrics)
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/characters\/[^/?]+/)
  await expect(page.locator('.gallery-card')).toHaveCount(0)

  await login(page, prototype, gateMetrics)
  await enableAdultImagesAndSmallPages(page, gateMetrics, prototype)

  await page.goto('/')
  await page.locator('input[name="q"]').fill('月庭林')
  await click(page.getByRole('button', { name: /搜索/ }), gateMetrics)
  await page.waitForLoadState('networkidle')
  expect(await page.locator('.gallery-card').count()).toBeGreaterThan(0)

  await page.goto('/')
  await page.locator('input[name="q"]').fill('Pilot Lin')
  await click(page.getByRole('button', { name: /搜索/ }), gateMetrics)
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/\/characters\/[^/?]+/)
  const cards = page.locator('.gallery-card')
  const cardCount = await cards.count()
  expect(cardCount).toBe(2)
  const image = cards.first().locator('img')
  await expect(image).toBeVisible()
  const imageGeometry = await image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    height: element.height,
    naturalHeight: element.naturalHeight,
    naturalWidth: element.naturalWidth,
    objectFit: window.getComputedStyle(element).objectFit,
    width: element.width,
  }))
  expect(imageGeometry.complete).toBeTruthy()
  expect(imageGeometry.naturalWidth).toBeGreaterThan(0)
  expect(imageGeometry.naturalHeight).toBeGreaterThan(0)
  expect(imageGeometry.objectFit).toBe('contain')

  for (const [width, expectedColumns] of [[1280, 4], [800, 3], [480, 2]] as const) {
    await page.setViewportSize({ height: 900, width })
    expect(await gridColumnCount(page)).toBe(expectedColumns)
  }

  await click(cards.first(), gateMetrics)
  if (prototype === 'wagtail') await expect(page.locator('[data-lightbox]')).toHaveAttribute('open', '')
  else await expect(page.getByRole('dialog', { name: '图片查看器' })).toBeVisible()
  const firstSource = await galleryCardSource(page, prototype)
  const zoom = prototype === 'wagtail'
    ? page.locator('[data-zoom]')
    : page.getByRole('button', { name: '放大', exact: true })
  await click(zoom, gateMetrics)
  if (prototype === 'wagtail') await expect(page.locator('[data-lightbox-image]')).toHaveClass(/zoomed/)
  else await expect(page.getByRole('dialog').locator('img')).toHaveCSS('transform', /matrix/)

  const previous = prototype === 'wagtail'
    ? page.locator('[data-prev]')
    : page.getByRole('button', { name: '上一张', exact: true })
  const next = prototype === 'wagtail'
    ? page.locator('[data-next]')
    : page.getByRole('button', { name: '下一张', exact: true })
  const close = prototype === 'wagtail'
    ? page.locator('[data-close]')
    : page.getByRole('button', { name: '关闭', exact: true })
  await click(previous, gateMetrics)
  const previousSource = await galleryCardSource(page, prototype)
  await click(next, gateMetrics)
  expect(await galleryCardSource(page, prototype)).toBe(firstSource)
  expect(previousSource).not.toBe(firstSource)
  await click(next, gateMetrics)
  expect(await galleryCardSource(page, prototype)).toBe(previousSource)
  await click(next, gateMetrics)
  expect(await galleryCardSource(page, prototype)).toBe(firstSource)

  await press(page, 'Escape', gateMetrics)
  if (prototype === 'wagtail') await expect(page.locator('[data-lightbox]')).not.toHaveAttribute('open', '')
  else await expect(page.getByRole('dialog', { name: '图片查看器' })).toHaveCount(0)

  await click(cards.first(), gateMetrics)
  await click(close, gateMetrics)
  if (prototype === 'wagtail') await expect(page.locator('[data-lightbox]')).not.toHaveAttribute('open', '')
  else await expect(page.getByRole('dialog', { name: '图片查看器' })).toHaveCount(0)

  await expect(page.locator('a[download], button:has-text("下载")')).toHaveCount(0)
  await expect(page.locator(
    '.gallery-card figcaption, .gallery-card dl, .gallery-card .figure-details, .gallery-card [data-testid="figure-details"]',
  )).toHaveCount(0)
  const paginationLinks = await page.getByRole('navigation').getByRole('link').count()
  expect(paginationLinks).toBeGreaterThan(0)
  await click(page.getByRole('navigation').getByRole('link', { name: /下一页/ }), gateMetrics)
  await page.waitForLoadState('networkidle')
  await expect(page).toHaveURL(/[?&]page=2(?:&|$)/)
  await expect(page.locator('.gallery-card')).toHaveCount(1)
  await expect(page.getByRole('navigation').getByRole('link', { name: /上一页/ })).toBeVisible()
  await testInfo.attach('val02b-gallery-observations', {
    body: Buffer.from(JSON.stringify({
      schema_version: 1,
      card_count: cardCount,
      image_geometry: imageGeometry,
      pagination_link_count: paginationLinks,
      pagination_page_two_card_count: 1,
      responsive_columns: { desktop: 4, mobile: 2, tablet: 3 },
      settings_toggle: { adult_default_hidden: true, adult_visible_after_audited_setting: true },
    })),
    contentType: 'application/json',
  })
})
