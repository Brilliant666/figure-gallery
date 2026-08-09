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
let fixtureState

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

async function storeObject(buffer) {
  const sha256 = createHash('sha256').update(buffer).digest('hex')
  const directory = path.join(root, 'objects', 'sha256', sha256.slice(0, 2))
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(directory, `${sha256}.png`), buffer)
  return sha256
}

async function seedCharacter({ characterId, slug, displayName, work, productCount, imagesPerProduct, startIndex }) {
  const runId = `20260809T02030${slug === 'cheshire' ? '4' : '5'}Z-synthetic-${slug}`
  const runDirectory = path.join(root, 'runs', runId)
  await mkdir(runDirectory, { recursive: true })
  const imagesByProduct = []
  let imageIndex = startIndex
  for (let productIndex = 0; productIndex < productCount; productIndex += 1) {
    const images = []
    for (let offset = 0; offset < imagesPerProduct; offset += 1) {
      const shared = productIndex === 0 && offset === 0
      const buffer = shared ? fixtureState.sharedBuffer : await syntheticPng(imageIndex)
      const sha256 = await storeObject(buffer)
      images.push({
        sha256,
        width: shared ? 300 : 260 + (imageIndex % 3) * 20,
        height: shared ? 420 : 380 + (imageIndex % 5) * 15,
        mime: 'image/png',
        sourceUrl: `https://images.synthetic.invalid/${slug}-${productIndex + 1}/${offset + 1}.png`,
        isOfficialPrimary: offset === 0,
        alt: `Synthetic ${displayName} product ${productIndex + 1} angle ${offset + 1}`,
      })
      if (!shared) imageIndex += 1
    }
    imagesByProduct.push(images)
  }
  const remManufacturers = ['Good Smile Company', 'KADOKAWA', 'ALTER', 'FuRyu']
  const products = Array.from({ length: productCount }, (_unused, index) => {
    const sourceDomain = index % 3 === 0 ? 'alter-web.jp' : index % 3 === 1 ? 'goodsmile.com' : 'apex-toys.com'
    return {
      id: `official-synthetic-id-${slug}-${index + 1}`,
      characterId,
      characterSlug: slug,
      sourceKind: 'official_manufacturer',
      sourceDomain,
      title: index === 0 ? 'Synthetic Shared Figure Title' : `Synthetic ${displayName} Figure ${index + 1}`,
      design: `Synthetic design ${index + 1}`,
      character: displayName,
      series: work,
      manufacturer: slug === 'rem' ? remManufacturers[index % remManufacturers.length] : ['ALTER', 'Good Smile Arts Shanghai', 'AniGame', 'APEX'][index % 4],
      classification: slug === 'rem' && index >= 6 ? 'likely_prize' : 'likely_scale',
      category: slug === 'rem' && index >= 6 ? 'prize figure' : 'finished scale figure',
      scale: slug === 'rem' && index >= 6 ? 'non-scale' : index % 2 === 0 ? '1/7' : '1/6',
      releaseDate: '2026-08',
      status: 'released',
      sourceUrl: `https://${sourceDomain}/products/synthetic-${slug}-${index + 1}`,
      homepageImage: imagesByProduct[index][0].sourceUrl,
      imageUrls: imagesByProduct[index].map((image) => image.sourceUrl),
      images: imagesByProduct[index],
      imageCount: imagesPerProduct,
    }
  })
  await writeFile(path.join(runDirectory, 'run.json'), JSON.stringify({
    runId,
    query: displayName,
    characterId,
    characterSlug: slug,
    characterDisplayName: displayName,
    sourceMode: 'official_sources',
    status: 'completed',
    startedAt: '2026-08-09T02:03:04Z',
    completedAt: '2026-08-09T02:03:10Z',
  }))
  await writeFile(path.join(runDirectory, 'products.json'), JSON.stringify(products))
  await writeFile(path.join(runDirectory, 'failures.json'), '[]')
  const preferenceDirectory = path.join(root, 'characters', slug)
  await mkdir(preferenceDirectory, { recursive: true })
  await writeFile(path.join(preferenceDirectory, 'preferences.json'), JSON.stringify({
    schemaVersion: 2,
    excludedProductIds: [],
    excludedImageSha256: [],
    products: slug === 'cheshire' ? {
      [products[0].id]: {
        preferredCoverImageId: imagesByProduct[0][1].sha256,
        manualNote: 'Synthetic Cheshire shooting note',
      },
    } : {},
    preferredCoverImage: slug === 'cheshire' ? { [products[0].id]: imagesByProduct[0][1].sha256 } : {},
    manualNote: slug === 'cheshire' ? { [products[0].id]: 'Synthetic Cheshire shooting note' } : {},
  }))
  return { runId, products, imagesByProduct }
}

async function seedGallery() {
  root = await mkdtemp(path.join(os.tmpdir(), 'personal-gallery-two-characters-'))
  fixtureState = { sharedBuffer: await syntheticPng(9_999) }
  fixtureState.cheshire = await seedCharacter({
    characterId: 'azur-lane:cheshire',
    slug: 'cheshire',
    displayName: '柴郡',
    work: 'Azur Lane',
    productCount: 7,
    imagesPerProduct: 8,
    startIndex: 0,
  })
  fixtureState.rem = await seedCharacter({
    characterId: 'rezero:rem',
    slug: 'rem',
    displayName: '蕾姆',
    work: 'Re:ZERO -Starting Life in Another World-',
    productCount: 10,
    imagesPerProduct: 4,
    startIndex: 100,
  })
}

test.beforeAll(async () => {
  await seedGallery()
  application = createPersonalGalleryServer({
    config: {
      defaultQuery: '',
      firecrawlApiKey: null,
      firecrawlBaseUrl: 'https://api.firecrawl.dev',
      host: '127.0.0.1',
      imageMaxBytes: 20_971_520,
      liveFetchEnabled: false,
      maxImagesPerProduct: 5,
      maxListPages: 20,
      maxProducts: 200,
      maxRetries: 2,
      officialMaxCandidates: 80,
      officialMaxImagesPerProduct: 10,
      officialMaxProducts: 80,
      officialMaxQueries: 30,
      officialMaxRetries: 2,
      officialMaxSearchResultsPerQuery: 10,
      officialRequestDelayMs: 1_000,
      officialImageRequestDelayMs: 1_000,
      port: 0,
      requestConcurrency: 1,
      requestDelayMs: 1_500,
      root,
      writtenPermissionConfirmed: false,
    },
  })
  const address = await application.listen()
  baseUrl = `http://127.0.0.1:${address.port}`
  reportPath = path.resolve(process.env.MVP_BROWSER_RESULT || path.join('test-results', 'personal-gallery-browser-results.json'))
})

test.afterAll(async () => {
  await application?.close()
  await rm(root, { recursive: true, force: true })
})

test('two-character galleries isolate routes and preferences while sharing immutable objects', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const network = { hpoiRequests: 0, firecrawlRequests: 0, externalRequests: 0, loopbackRequests: 0 }
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (['127.0.0.1', 'localhost'].includes(url.hostname)) {
      network.loopbackRequests += 1
      return route.continue()
    }
    network.externalRequests += 1
    if (url.hostname === 'hpoi.net' || url.hostname.endsWith('.hpoi.net')) network.hpoiRequests += 1
    if (url.hostname === 'api.firecrawl.dev') network.firecrawlRequests += 1
    return route.abort('blockedbyclient')
  })
  const page = await context.newPage()

  await page.goto(baseUrl)
  await expect(page.locator('#character-galleries')).toContainText('柴郡')
  await expect(page.locator('#character-galleries')).toContainText('蕾姆')
  await expect(page.locator('#character-galleries a')).toHaveCount(2)

  await page.goto(`${baseUrl}/gallery/characters/cheshire`)
  await expect(page.locator('#gallery-title')).toHaveText('柴郡')
  await expect(page.locator('.product-card')).toHaveCount(7)
  await expect(page.locator('.reference-cover')).toHaveCount(7)
  const cheshireCover = await page.locator('.product-card').first().locator('.reference-cover').getAttribute('data-sha256')
  const sharedSha = fixtureState.cheshire.imagesByProduct[0][0].sha256
  expect(cheshireCover).toBe(fixtureState.cheshire.imagesByProduct[0][1].sha256)

  await page.goto(`${baseUrl}/gallery/characters/rem`)
  await expect(page.locator('#gallery-title')).toHaveText('蕾姆')
  await expect(page.locator('.product-card')).toHaveCount(10)
  await expect(page.locator('.reference-cover')).toHaveCount(10)
  await expect(page.locator('.product-card').first()).toContainText('Synthetic Shared Figure Title')
  await page.locator('#classification-filter').selectOption('likely_scale')
  await expect(page.locator('.product-card')).toHaveCount(6)
  await page.locator('#classification-filter').selectOption('likely_prize')
  await expect(page.locator('.product-card')).toHaveCount(4)
  await page.locator('#classification-filter').selectOption('all')

  const columnCount = () => page.locator('#product-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(' ').length)
  expect(await columnCount()).toBe(4)
  await page.setViewportSize({ width: 900, height: 900 })
  expect(await columnCount()).toBe(3)
  await page.setViewportSize({ width: 600, height: 900 })
  expect(await columnCount()).toBe(2)
  await page.setViewportSize({ width: 1280, height: 900 })

  await page.locator('.product-card').first().locator('.reference-card-link').click()
  await expect(page).toHaveURL(/\/gallery\/characters\/rem\/products\/official-synthetic-id-rem-1$/u)
  await expect(page.locator('#product-title')).toHaveText('Synthetic Shared Figure Title')
  await expect(page.locator('.detail-image-tile')).toHaveCount(4)
  await page.locator('.image-open').first().click()
  await expect(page.locator('#lightbox')).toBeVisible()
  await page.locator('#zoom-in').click()
  await expect(page.locator('#zoom-value')).toHaveText('125%')
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('#lightbox-position')).toHaveText('2 / 4')
  await page.keyboard.press('Escape')
  await expect(page.locator('#lightbox')).toBeHidden()

  const alternateSha = await page.locator('.detail-image-tile').nth(2).locator('img').getAttribute('data-sha256')
  const coverSaved = page.waitForResponse((response) =>
    response.url() === `${baseUrl}/api/preferences/rem` && response.status() === 200,
  )
  await page.locator('.detail-image-tile').nth(2).getByRole('button', { name: '设为封面' }).click()
  await coverSaved
  await page.reload()
  await expect(page.locator('#current-cover .reference-cover')).toHaveAttribute('data-sha256', alternateSha)
  const exclusionSaved = page.waitForResponse((response) =>
    response.url() === `${baseUrl}/api/preferences/rem` && response.status() === 200,
  )
  await page.locator('.detail-image-tile').first().getByRole('button', { name: '排除图片' }).click()
  await exclusionSaved
  await page.reload()
  await expect(page.locator(`img[data-sha256="${sharedSha}"]`)).toHaveCount(0)

  await page.goto(`${baseUrl}/gallery/characters/cheshire/products/official-synthetic-id-cheshire-1`)
  await expect(page.locator('#product-title')).toHaveText('Synthetic Shared Figure Title')
  await expect(page.locator(`img[data-sha256="${sharedSha}"]`)).toHaveCount(1)
  await expect(page.locator('#current-cover .reference-cover')).toHaveAttribute('data-sha256', cheshireCover)
  await expect(page.locator('#product-note')).toHaveText('Synthetic Cheshire shooting note')

  expect(network.externalRequests).toBe(0)
  expect(network.hpoiRequests).toBe(0)
  expect(network.firecrawlRequests).toBe(0)
  await mkdir(path.dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify({
    status: 'pass',
    tests: { total: 1, passed: 1, failed: 0 },
    network,
    characters: [
      { slug: 'cheshire', products: 7, images: 56 },
      { slug: 'rem', products: 10, images: 40 },
    ],
    responsive: { desktop: 4, tablet: 3, mobile: 2 },
    routesIsolated: true,
    storageIsolated: true,
    preferencesIsolated: true,
    sharedObjectStore: true,
    sharedObjects: 1,
    sameTitleDifferentCharacter: true,
    oneCoverPerProduct: true,
    detailImages: true,
    filters: true,
    lightbox: true,
    zoom: true,
    screenshots: 0,
    videos: 0,
    fixture: 'synthetic_two_characters_7_and_10_products',
  }, null, 2)}\n`)
  await context.close()
})
