import { expect, test } from '@playwright/test'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

import { createPersonalGalleryServer } from '../../src/server/server.js'

let root
let application
let baseUrl
let reportPath

async function syntheticPng(index) {
  return sharp({
    create: {
      width: 260 + (index % 3) * 20,
      height: 380 + (index % 5) * 15,
      channels: 3,
      background: { r: (41 + index * 17) % 255, g: (83 + index * 29) % 255, b: (131 + index * 37) % 255 },
    },
  }).png().toBuffer()
}

async function seedGallery() {
  root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-reference-index-'))
  const runId = '20260809T020304Z-synthetic-cheshire'
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  const imageCounts = [8, 10, 9, 10, 9, 10, 0]
  const imagesByProduct = []
  let imageIndex = 0
  for (const [productIndex, imageCount] of imageCounts.entries()) {
    const images = []
    for (let offset = 0; offset < imageCount; offset += 1) {
      const buffer = await syntheticPng(imageIndex)
      const sha256 = createHash('sha256').update(buffer).digest('hex')
      const directory = path.join(root, 'objects', 'sha256', sha256.slice(0, 2))
      await mkdir(directory, { recursive: true })
      await writeFile(path.join(directory, `${sha256}.png`), buffer)
      images.push({
        sha256,
        width: 260 + (imageIndex % 3) * 20,
        height: 380 + (imageIndex % 5) * 15,
        mime: 'image/png',
        sourceUrl: `https://images.synthetic.invalid/product-${productIndex + 1}/${offset + 1}.png`,
        isOfficialPrimary: offset === 0,
        alt: `Synthetic product ${productIndex + 1} angle ${offset + 1}`,
      })
      imageIndex += 1
    }
    imagesByProduct.push(images)
  }
  const manufacturers = ['ALTER', 'Good Smile Arts Shanghai', 'AniGame', 'Good Smile Arts Shanghai', 'ALTER', 'AniGame', 'APEX']
  const products = imageCounts.map((imageCount, index) => ({
    id: `official-synthetic-id-cheshire-${index + 1}`,
    sourceKind: 'official_manufacturer',
    sourceDomain: index % 2 === 0 ? 'alter-web.jp' : 'goodsmile.com',
    title: index === 6 ? 'Synthetic APEX Cheshire without local images' : `Synthetic Cheshire Figure ${index + 1}`,
    design: `Synthetic design ${index + 1}`,
    character: 'Cheshire',
    series: 'Azur Lane',
    manufacturer: manufacturers[index],
    classification: index === 2 ? 'unknown' : 'likely_scale',
    category: 'finished figure',
    scale: index % 2 === 0 ? '1/7' : '1/6',
    releaseDate: '2026-08',
    status: 'released',
    sourceUrl: `https://${index % 2 === 0 ? 'alter-web.jp' : 'goodsmile.com'}/product/synthetic-${index + 1}`,
    homepageImage: imagesByProduct[index][0]?.sourceUrl || null,
    imageUrls: index === 6
      ? [1, 2, 3].map((value) => `https://images.synthetic.invalid/apex-missing-${value}.png`)
      : imagesByProduct[index].map((image) => image.sourceUrl),
    images: imagesByProduct[index],
    imageCount,
  }))
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({
    runId,
    query: '柴郡',
    characterSlug: 'cheshire',
    sourceMode: 'official_sources',
    status: 'completed',
    startedAt: '2026-08-09T02:03:04Z',
    completedAt: '2026-08-09T02:03:10Z',
  }))
  await writeFile(path.join(runDirectory, 'products.json'), JSON.stringify(products))
  await writeFile(path.join(runDirectory, 'failures.json'), JSON.stringify(
    products[6].imageUrls.map((url) => ({ kind: 'image', code: 'http_404', status: 404, url })),
  ))
  await writeFile(path.join(root, 'preferences.json'), JSON.stringify({
    schemaVersion: 1,
    excludedProductIds: [],
    excludedImageSha256: [],
    preferredCoverImage: { [products[0].id]: imagesByProduct[0][1].sha256 },
    manualNote: { [products[0].id]: 'Synthetic shooting note' },
  }))
  return { products, imagesByProduct }
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

test('one-cover index and per-product detail work offline with 56 synthetic images', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const network = { hpoiRequests: 0, firecrawlRequests: 0, externalRequests: 0, loopbackRequests: 0 }
  const mediaRequests = { index: new Set(), detail: new Set() }
  let phase = 'index'
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      network.loopbackRequests += 1
      if (/^\/media\/[a-f\d]{64}$/iu.test(url.pathname)) mediaRequests[phase].add(url.pathname)
      return route.continue()
    }
    network.externalRequests += 1
    if (url.hostname === 'hpoi.net' || url.hostname.endsWith('.hpoi.net')) network.hpoiRequests += 1
    if (url.hostname === 'api.firecrawl.dev') network.firecrawlRequests += 1
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()

  await page.goto(`${baseUrl}/gallery/characters/cheshire`)
  await expect(page.locator('body')).toHaveAttribute('data-view', 'character')
  await expect(page.locator('#gallery-title')).toHaveText('柴郡')
  await expect(page.locator('.product-card')).toHaveCount(7)
  await expect(page.locator('.reference-cover')).toHaveCount(6)
  await expect(page.locator('.no-image-placeholder', { hasText: '暂无可用图片' })).toHaveCount(1)
  await expect(page.locator('.detail-image-tile')).toHaveCount(0)
  await expect(page.locator('#management-status')).not.toHaveAttribute('open', '')
  for (const image of await page.locator('.reference-cover').all()) {
    await image.scrollIntoViewIfNeeded()
    await expect(image).toHaveJSProperty('complete', true)
  }
  expect(mediaRequests.index.size).toBe(6)

  await page.locator('#manufacturer-filter').selectOption('ALTER')
  await expect(page.locator('.product-card')).toHaveCount(2)
  await page.locator('#manufacturer-filter').selectOption('all')
  await page.locator('#scale-filter').selectOption('1/6')
  await expect(page.locator('.product-card')).toHaveCount(3)
  await page.locator('#scale-filter').selectOption('all')
  await page.locator('#classification-filter').selectOption('unknown')
  await expect(page.locator('.product-card')).toHaveCount(1)
  await page.locator('#classification-filter').selectOption('all')

  const columnCount = () => page.locator('#product-grid').evaluate(
    (node) => getComputedStyle(node).gridTemplateColumns.split(' ').length,
  )
  expect(await columnCount()).toBe(4)
  await page.setViewportSize({ width: 900, height: 900 })
  expect(await columnCount()).toBe(3)
  await page.setViewportSize({ width: 600, height: 900 })
  expect(await columnCount()).toBe(2)
  await page.setViewportSize({ width: 1280, height: 900 })

  const firstCard = page.locator('.product-card').first()
  const originalCover = await firstCard.locator('.reference-cover').getAttribute('data-sha256')
  phase = 'detail'
  await firstCard.locator('.reference-card-link').click()
  await expect(page).toHaveURL(/\/gallery\/characters\/cheshire\/products\/official-synthetic-id-cheshire-1$/u)
  await expect(page.locator('body')).toHaveAttribute('data-view', 'product')
  await expect(page.locator('#product-title')).toHaveText('Synthetic Cheshire Figure 1')
  await expect(page.locator('.detail-image-tile')).toHaveCount(8)
  await expect(page.locator('#detail-image-count')).toHaveText('8')
  await expect(page.locator('#cover-selection')).toHaveText('人工选择')
  for (const image of await page.locator('.detail-image-tile img').all()) await image.scrollIntoViewIfNeeded()
  expect(mediaRequests.detail.size).toBe(8)

  await page.locator('.image-open').first().click()
  await expect(page.locator('#lightbox')).toBeVisible()
  await expect(page.locator('#lightbox-position')).toHaveText('1 / 8')
  await expect(page.locator('#lightbox-previous')).toBeDisabled()
  await page.locator('#zoom-in').click()
  await expect(page.locator('#zoom-value')).toHaveText('125%')
  await page.locator('#zoom-fit').click()
  await expect(page.locator('#zoom-value')).toHaveText('100%')
  await page.locator('#zoom-actual').click()
  await expect(page.locator('#lightbox-stage')).toHaveClass(/actual/u)
  while (await page.locator('#lightbox-next').isEnabled()) await page.keyboard.press('ArrowRight')
  await expect(page.locator('#lightbox-position')).toHaveText('8 / 8')
  await expect(page.locator('#lightbox-next')).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.locator('#lightbox')).toBeHidden()

  const alternate = page.locator('.detail-image-tile').nth(2)
  const alternateSha = await alternate.locator('img').getAttribute('data-sha256')
  const preferenceResponse = page.waitForResponse(
    (response) => response.url() === `${baseUrl}/api/preferences` && response.status() === 200,
  )
  await alternate.getByRole('button', { name: '设为封面' }).click()
  await preferenceResponse
  await page.locator('#detail-back-link').click()
  await expect(page.locator('.product-card').first().locator('.reference-cover')).toHaveAttribute('data-sha256', alternateSha)
  expect(alternateSha).not.toBe(originalCover)
  await page.reload()
  await expect(page.locator('.product-card').first().locator('.reference-cover')).toHaveAttribute('data-sha256', alternateSha)

  phase = 'detail'
  await page.locator('.product-card').first().locator('.reference-card-link').click()
  const excludedTile = page.locator('.detail-image-tile').first()
  const excludedSha = await excludedTile.locator('img').getAttribute('data-sha256')
  const excludeResponse = page.waitForResponse(
    (response) => response.url() === `${baseUrl}/api/preferences` && response.status() === 200,
  )
  await excludedTile.getByRole('button', { name: '排除图片' }).click()
  await excludeResponse
  await expect(page.locator(`img[data-sha256="${excludedSha}"]`)).toHaveCount(0)
  await detailShowExcludedCheck(page)
  const restoredTile = page.locator('.detail-image-tile').filter({ has: page.locator(`img[data-sha256="${excludedSha}"]`) })
  await expect(restoredTile).toHaveClass(/is-excluded/u)
  const restoreResponse = page.waitForResponse(
    (response) => response.url() === `${baseUrl}/api/preferences` && response.status() === 200,
  )
  await restoredTile.getByRole('button', { name: '恢复图片' }).click()
  await restoreResponse

  await page.locator('#detail-back-link').click()
  const apexCard = page.locator('.product-card').filter({ hasText: 'APEX' })
  await expect(apexCard.locator('.no-image-placeholder')).toHaveText('暂无可用图片')
  await apexCard.locator('.reference-card-link').click()
  await expect(page.locator('#detail-image-count')).toHaveText('0')
  await expect(page.locator('#detail-failure-count')).toHaveText('3')
  await expect(page.locator('#detail-failure-list li')).toHaveCount(3)
  await expect(page.locator('#detail-failure-list')).toContainText('HTTP 404')
  await expect(page.locator('#detail-no-images')).toBeVisible()

  expect(network.externalRequests).toBe(0)
  expect(network.hpoiRequests).toBe(0)
  expect(network.firecrawlRequests).toBe(0)

  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({
    status: 'pass',
    tests: { total: 1, passed: 1, failed: 0 },
    network,
    responsive: { desktop: 4, tablet: 3, mobile: 2 },
    productCards: 7,
    indexCovers: 6,
    indexImageRequests: mediaRequests.index.size,
    detailImageRequests: 8,
    totalFixtureImages: 56,
    noImagePlaceholders: 1,
    details: true,
    lightbox: true,
    zoom: true,
    productScopedNavigation: true,
    preferences: true,
    preferredCoverPersisted: true,
    excludeRestore: true,
    filtersByProduct: true,
    screenshots: 0,
    videos: 0,
    fixture: 'synthetic_seven_products_and_56_pngs',
  }, null, 2)}\n`)
  await context.close()
})

async function detailShowExcludedCheck(page) {
  await page.locator('#detail-show-excluded').check()
}
