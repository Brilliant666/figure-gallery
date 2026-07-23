import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { createPersonalGalleryServer } from '../../src/server/server.js'

let root
let application
let baseUrl
let reportPath
const network = { hpoiRequests: 0, firecrawlRequests: 0, externalRequests: 0, loopbackRequests: 0 }

async function syntheticPng(red, green, blue) {
  return sharp({
    create: { width: 240, height: 360, channels: 3, background: { r: red, g: green, b: blue } },
  })
    .png()
    .toBuffer()
}

async function seedGallery() {
  root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-browser-'))
  const runId = '20260716T020304Z-柴郡'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  const buffers = await Promise.all([
    syntheticPng(42, 110, 180),
    syntheticPng(188, 82, 108),
    syntheticPng(83, 145, 108),
    syntheticPng(148, 104, 190),
    syntheticPng(218, 155, 74),
    syntheticPng(74, 175, 192),
  ])
  const images = []
  for (const [index, buffer] of buffers.entries()) {
    const sha256 = createHash('sha256').update(buffer).digest('hex')
    const directory = path.join(root, 'objects', 'sha256', sha256.slice(0, 2))
    await mkdir(directory, { recursive: true })
    await writeFile(path.join(directory, `${sha256}.png`), buffer)
    images.push({ sha256, width: 240, height: 360, mime: 'image/png', alt: `Synthetic ${index + 1}` })
  }
  await writeFile(
    path.join(runDirectory, 'run.json'),
    JSON.stringify({
      query: '柴郡',
      characterSlug: 'cheshire',
      sourceMode: 'official_sources',
      status: 'completed',
      startedAt: '2026-07-16T02:03:04Z',
      completedAt: '2026-07-16T02:03:10Z',
      sourceStatus: {
        hpoi: {
          hpoiLiveStatus: 'blocked_by_source',
          stopReason: 'captcha',
          retryAllowed: false,
          blockedAt: '2026-07-17T18:12:58Z',
          consecutiveBlockedRuns: 3,
        },
      },
    }),
  )
  await writeFile(
    path.join(runDirectory, 'products.json'),
    JSON.stringify([
      {
        id: 'official-alter-web-jp-id-synthetic-cheshire-001',
        sourceKind: 'official_manufacturer',
        sourceDomain: 'alter-web.jp',
        discoveryQuery: 'アズールレーン チェシャー フィギュア',
        discoveryMethod: 'firecrawl_search',
        officialProductId: 'synthetic-cheshire-001',
        title: 'Synthetic ALTER-style Cheshire',
        character: 'Cheshire',
        series: 'Azur Lane',
        manufacturer: 'ALTER',
        classification: 'likely_scale',
        category: 'scale figure',
        scale: '1/7',
        releaseDate: '2026-08',
        status: 'released',
        sourceUrl: 'https://www.alter-web.jp/figure/synthetic-cheshire-001',
        images: images.slice(0, 3),
      },
      {
        id: 'official-goodsmile-com-id-synthetic-cheshire-002',
        sourceKind: 'official_distributor',
        sourceDomain: 'goodsmile.com',
        discoveryQuery: '"Azur Lane" Cheshire scale figure',
        discoveryMethod: 'firecrawl_search',
        officialProductId: 'synthetic-cheshire-002',
        title: 'Synthetic Cheshire: Summery Date!',
        character: 'Cheshire',
        series: 'Azur Lane',
        manufacturer: 'Good Smile Arts Shanghai',
        distributor: 'Good Smile Company',
        classification: 'likely_scale',
        category: 'finished figure',
        scale: '1/6',
        releaseDate: '2027-01',
        status: 'preorder',
        sourceUrl: 'https://www.goodsmile.com/en/product/synthetic-cheshire-002',
        images: images.slice(3, 6),
      },
    ]),
  )
  await writeFile(
    path.join(runDirectory, 'failures.json'),
    JSON.stringify([{ stage: 'image', reason: 'Synthetic interrupted download was cleaned up.' }]),
  )
  await writeFile(
    path.join(root, 'preferences.json'),
    JSON.stringify({ excludedProductIds: [], excludedImageSha256: [], preferredCoverImage: {}, manualNote: {} }),
  )
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(value)}\n`)
  await rename(temporary, filePath)
}

test.beforeAll(async () => {
  await seedGallery()
  application = createPersonalGalleryServer({
    config: {
      defaultQuery: '柴郡',
      firecrawlApiKey: null,
      firecrawlBaseUrl: 'https://api.firecrawl.dev',
      host: '127.0.0.1',
      imageMaxBytes: 20_971_520,
      liveFetchEnabled: false,
      maxImagesPerProduct: 5,
      maxListPages: 20,
      maxProducts: 200,
      maxRetries: 2,
      port: 0,
      requestConcurrency: 1,
      requestDelayMs: 1_500,
      root,
      writtenPermissionConfirmed: false,
    },
  })
  const address = await application.listen()
  baseUrl = `http://127.0.0.1:${address.port}`
  reportPath = path.resolve(
    process.env.MVP_BROWSER_RESULT || path.join('test-results', 'personal-gallery-browser-results.json'),
  )
})

test.afterAll(async () => {
  await application?.close()
  await rm(root, { recursive: true, force: true })
})

test('private gallery works at 4/3/2 breakpoints without external requests', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  let progressiveRequests = 0
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      network.loopbackRequests += 1
      if (url.pathname === '/api/gallery/run/synthetic-progressive-run') progressiveRequests += 1
      return route.continue()
    }
    network.externalRequests += 1
    if (url.hostname === 'hpoi.net' || url.hostname.endsWith('.hpoi.net')) network.hpoiRequests += 1
    if (url.hostname === 'api.firecrawl.dev') network.firecrawlRequests += 1
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`)
  await expect(page.locator('.source-notice')).toContainText('Hpoi 实时来源已停用')
  await expect(page.locator('.source-notice')).toContainText('Official sources')
  await expect(page.locator('#collect-form input[name="query"]')).toHaveValue('柴郡')
  await expect(page.locator('#collect-form input[name="maxSearchResults"]')).toBeVisible()
  await expect(page.locator('#collect-form input[name="maxProducts"]')).toBeVisible()
  await expect(page.locator('#collect-form input[name="maxImagesPerProduct"]')).toBeVisible()
  await expect(page.locator('#collect-form input[name="characterUrl"]')).toHaveCount(0)
  await expect(page.locator('#collect-form input[name="confirmOfficialSourceAccess"]')).toBeVisible()
  await expect(page.locator('#collect-form input[name="confirmOfficialSourceAccess"]')).not.toBeChecked()
  await expect(page.locator('#start-button')).toHaveText('开始官方来源收集')
  await expect(page.locator('#stop-button')).toBeVisible()

  await page.goto(`${baseUrl}/gallery/synthetic-progressive-run`)
  await expect(page.locator('body')).toHaveAttribute('data-gallery-status', 'waiting')
  await expect(page.locator('#gallery-title')).toContainText('正在建立')
  const progressiveDirectory = path.join(root, 'runs', 'synthetic-progressive-run')
  await mkdir(progressiveDirectory, { recursive: true })
  await Promise.all([
    writeJsonAtomic(path.join(progressiveDirectory, 'run.json'), {
      runId: 'synthetic-progressive-run',
      query: '柴郡',
      status: 'running',
      startedAt: '2026-07-16T03:00:00Z',
    }),
    writeJsonAtomic(path.join(progressiveDirectory, 'products.json'), []),
    writeJsonAtomic(path.join(progressiveDirectory, 'failures.json'), []),
  ])
  await expect(page.locator('body')).toHaveAttribute('data-gallery-status', 'running', { timeout: 5_000 })
  await expect(page.locator('#gallery-title')).toHaveText('柴郡')

  const progressiveBuffer = await syntheticPng(80, 150, 105)
  const progressiveSha = createHash('sha256').update(progressiveBuffer).digest('hex')
  const progressiveObjectDirectory = path.join(root, 'objects', 'sha256', progressiveSha.slice(0, 2))
  await mkdir(progressiveObjectDirectory, { recursive: true })
  await writeFile(path.join(progressiveObjectDirectory, `${progressiveSha}.png`), progressiveBuffer)
  await writeJsonAtomic(path.join(progressiveDirectory, 'products.json'), [
    {
      id: 'synthetic-progressive-product',
      title: 'Progressively available synthetic product',
      manufacturer: 'Synthetic Progressive Maker',
      classification: 'unknown',
      images: [{ sha256: progressiveSha, width: 240, height: 360, mime: 'image/png' }],
    },
  ])
  await expect(page.locator('.product-card')).toHaveCount(1, { timeout: 5_000 })
  await writeJsonAtomic(path.join(progressiveDirectory, 'run.json'), {
    runId: 'synthetic-progressive-run',
    query: '柴郡',
    status: 'completed',
    startedAt: '2026-07-16T03:00:00Z',
    completedAt: '2026-07-16T03:00:05Z',
  })
  await expect(page.locator('body')).toHaveAttribute('data-gallery-status', 'completed', { timeout: 5_000 })
  const requestsAtCompletion = progressiveRequests
  await page.waitForTimeout(1_900)
  expect(progressiveRequests).toBe(requestsAtCompletion)

  await page.goto(`${baseUrl}/gallery/characters/cheshire`)
  await expect(page.locator('#gallery-title')).toHaveText('柴郡')
  await expect(page.locator('#source-mode')).toHaveText('Official sources')
  await expect(page.locator('#hpoi-source-status')).toContainText('Blocked by captcha')
  await expect(page.locator('#hpoi-source-status')).toContainText('不会自动重试')
  await expect(page.locator('.product-card')).toHaveCount(2)
  await expect(page.locator('.image-open img')).toHaveCount(6)
  await expect(page.locator('.product-card .source-badge', { hasText: '官方商品页' })).toHaveCount(2)
  await expect(page.locator('.source-domain')).toContainText(['alter-web.jp', 'goodsmile.com'])
  await expect(page.getByRole('link', { name: '打开官方商品页' })).toHaveCount(2)
  const mediaSources = await page.locator('.image-open img').evaluateAll((images) =>
    images.map((image) => image.getAttribute('src')),
  )
  expect(mediaSources.every((source) => /^\/media\/[a-f\d]{64}$/i.test(source || ''))).toBe(true)

  await page.locator('#manufacturer-filter').selectOption('ALTER')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('#manufacturer-filter').selectOption('all')
  await page.locator('#design-filter').selectOption('Synthetic Cheshire: Summery Date!')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('#design-filter').selectOption('all')
  await page.locator('#scale-filter').selectOption('1/6')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('#scale-filter').selectOption('all')

  const columnCount = () =>
    page.locator('#product-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(await columnCount()).toBe(4)
  await page.setViewportSize({ width: 900, height: 900 })
  expect(await columnCount()).toBe(3)
  await page.setViewportSize({ width: 600, height: 900 })
  expect(await columnCount()).toBe(2)

  await page.locator('.image-open').first().click()
  await expect(page.locator('#lightbox')).toBeVisible()
  await expect(page.locator('#lightbox-position')).toContainText('1 /')
  await expect(page.locator('#lightbox-previous')).toBeDisabled()
  await page.locator('#zoom-in').click()
  await expect(page.locator('#zoom-value')).toHaveText('125%')
  await page.locator('#zoom-fit').click()
  await expect(page.locator('#zoom-value')).toHaveText('100%')
  await expect(page.locator('#lightbox-stage')).not.toHaveClass(/actual/)
  await page.locator('#zoom-actual').click()
  await expect(page.locator('#lightbox-stage')).toHaveClass(/actual/)
  await page.locator('#lightbox-next').click()
  await expect(page.locator('#lightbox-position')).toContainText('2 /')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('#lightbox-position')).toContainText('1 /')
  await page.locator('#lightbox-next').click()
  await page.locator('#lightbox-next').click()
  await page.locator('#lightbox-next').click()
  await expect(page.locator('#lightbox-position')).toHaveText('4 / 6')
  await expect(page.locator('#lightbox-product-title')).toHaveText('Synthetic Cheshire: Summery Date!')
  while (await page.locator('#lightbox-next').isEnabled()) await page.locator('#lightbox-next').click()
  await expect(page.locator('#lightbox-next')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('#lightbox')).toBeHidden()

  const preferredSha = await page
    .locator('.product-card')
    .first()
    .locator('.image-tile')
    .nth(1)
    .locator('img')
    .getAttribute('data-sha256')
  await page
    .locator('.product-card')
    .first()
    .locator('.image-tile')
    .nth(1)
    .getByRole('button', { name: '设为封面' })
    .click()
  await page.reload()
  await expect(page.locator('.product-card').first().locator('.image-tile').first().locator('img')).toHaveAttribute(
    'data-sha256',
    preferredSha,
  )
  page.once('dialog', (dialog) => dialog.accept('Synthetic shooting note'))
  await page.locator('.product-card').first().getByRole('button', { name: '添加备注' }).click()
  await page.reload()
  await expect(page.locator('.product-card').first().locator('.product-note')).toHaveText('Synthetic shooting note')

  await page.locator('.product-card').first().getByRole('button', { name: '排除图片' }).first().click()
  await page.reload()
  await page.locator('#show-excluded').check()
  await expect(page.getByRole('button', { name: '恢复图片' }).first()).toBeVisible()
  await page.getByRole('button', { name: '恢复图片' }).first().click()
  await page.getByRole('button', { name: '排除商品' }).first().click()
  await page.reload()
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('#show-excluded').check()
  await expect(page.getByRole('button', { name: '恢复商品' }).first()).toBeVisible()
  await page.getByRole('button', { name: '恢复商品' }).first().click()
  await page.reload()
  await expect(page.locator('.product-card')).toHaveCount(2)
  await expect(page.locator('#failure-list')).toContainText('Synthetic interrupted download')
  await expect(page.getByText('下载', { exact: true })).toHaveCount(0)

  expect(network.externalRequests).toBe(0)
  expect(network.hpoiRequests).toBe(0)
  expect(network.firecrawlRequests).toBe(0)

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(
    reportPath,
    `${JSON.stringify(
      {
        status: 'pass',
        tests: { total: 1, passed: 1, failed: 0 },
        network,
        responsive: { desktop: 4, tablet: 3, mobile: 2 },
        stableGalleryUrl: '/gallery/characters/cheshire',
        sourceMode: 'official_sources',
        hpoiStatus: 'blocked_by_source',
        productCards: 2,
        localImages: 6,
        lightbox: true,
        zoom: true,
        crossProductNavigation: true,
        boundaryNavigation: true,
        fitActual: true,
        homeForm: true,
        preferences: true,
        preferenceReload: true,
        preferredCover: true,
        manualNote: true,
        progressiveBrowsing: true,
        pollingStoppedAfterCompletion: true,
        failures: true,
        screenshots: 0,
        videos: 0,
        fixture: 'synthetic_official_style_manifest_and_png_only',
      },
      null,
      2,
    )}\n`,
  )
  await context.close()
})
