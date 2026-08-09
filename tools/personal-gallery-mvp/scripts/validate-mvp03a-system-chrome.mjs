import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import { loadGalleryByQuery, resolveMediaObject } from '../src/gallery/read-model.js'
import {
  countGridColumns,
  isAllowedLoopbackRequest,
  isAllowedLoopbackWebSocket,
  systemChromeCandidates,
} from './validate-real-system-chrome.mjs'

const execFileAsync = promisify(execFile)
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = path.resolve(TOOL_ROOT, '..', '..')
const DEFAULT_RUNTIME_ROOT = path.join(REPOSITORY_ROOT, '.local', 'personal-gallery')
const BASE_URL = 'http://127.0.0.1:4317'
const INDEX_PATH = '/gallery/characters/cheshire'
const MEDIA_PATH_PATTERN = /^\/media\/([a-f\d]{64})$/i

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

async function locateSystemChrome() {
  for (const candidate of systemChromeCandidates()) {
    if (await exists(candidate)) return candidate
  }
  throw Object.assign(new Error('Google Chrome Stable was not found in an allowed system path.'), {
    code: 'system_chrome_not_found',
  })
}

async function readChromeIdentity(executablePath) {
  const escaped = executablePath.replaceAll("'", "''")
  const command = [
    `$item = Get-Item -LiteralPath '${escaped}'`,
    '$value = [ordered]@{ ProductName = $item.VersionInfo.ProductName; FileVersion = $item.VersionInfo.FileVersion }',
    '$value | ConvertTo-Json -Compress',
  ].join('; ')
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
    { windowsHide: true },
  )
  const identity = JSON.parse(stdout.trim())
  assert.match(identity.ProductName || '', /Google Chrome/i)
  assert.match(identity.FileVersion || '', /^\d+(?:\.\d+){3}$/)
  return identity
}

async function findTransientFiles(directory) {
  const matches = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) matches.push(...await findTransientFiles(target))
    else if (/\.(?:tmp|part)$/i.test(entry.name)) matches.push(target)
  }
  return matches
}

export function summarizeCoverReview(gallery) {
  const withImages = gallery.products.filter((product) => product.images.length > 0)
  return {
    reviewed: withImages.length,
    automatic: withImages.filter((product) => product.coverSelectionSource !== 'manual_override').length,
    manualOverride: withImages.filter((product) => product.coverSelectionSource === 'manual_override').length,
    missing: gallery.products.filter((product) => !product.coverImage).length,
  }
}

async function validateRuntime(runtimeRoot) {
  if (!(await exists(runtimeRoot))) {
    throw Object.assign(new Error('The real personal-gallery runtime is missing.'), { code: 'runtime_data_missing' })
  }
  let gallery
  try {
    gallery = await loadGalleryByQuery(runtimeRoot, 'cheshire')
  } catch (cause) {
    throw Object.assign(new Error('The real Cheshire runtime could not be read.'), {
      code: 'runtime_data_corrupt',
      cause,
    })
  }
  if (!gallery) {
    throw Object.assign(new Error('The stable Cheshire gallery record is missing.'), {
      code: 'runtime_data_missing',
    })
  }
  try {
    assert.equal(gallery.status, 'completed')
    assert.equal(gallery.sourceMode, 'official_sources')
    assert.equal(gallery.products.length, 7)
    assert.equal(gallery.summary.images, 62)
    assert.equal(gallery.summary.indexCovers, 7)
    assert.equal(gallery.summary.productsWithoutImages, 0)
    assert.equal(gallery.summary.unknown, 0)
    assert.equal(gallery.failures.length, 0)
    const apex = gallery.products.find((product) => /APEX/i.test(`${product.manufacturer} ${product.title}`))
    assert.ok(apex)
    assert.equal(apex.sourceDomain, 'amiami.jp')
    assert.equal(apex.images.length, 1)
    assert.equal(apex.failureCount, 0)
    const alter = gallery.products.find((product) => product.sourceDomain === 'alter-web.jp')
    assert.ok(alter)
    assert.equal(alter.images.length, 6)

    const referenced = new Set(gallery.products.flatMap((product) => product.images.map((image) => image.sha256)))
    assert.equal(referenced.size, 62)
    for (const digest of referenced) {
      const objectPath = await resolveMediaObject(runtimeRoot, digest)
      assert.ok(objectPath)
      assert.equal(sha256(await readFile(objectPath)), digest)
    }
    assert.equal((await findTransientFiles(runtimeRoot)).length, 0)
    const coverReview = summarizeCoverReview(gallery)
    assert.deepEqual(coverReview, { reviewed: 7, automatic: 3, manualOverride: 4, missing: 0 })
    return { gallery, objectCount: referenced.size, coverReview }
  } catch (cause) {
    throw Object.assign(new Error('The real Cheshire runtime failed the MVP-03A integrity gate.'), {
      code: 'runtime_data_corrupt',
      cause,
    })
  }
}

async function removeTemporaryProfile(directory) {
  if (!directory) return true
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  return !(await exists(directory))
}

function launchOptions(executablePath, headless) {
  return {
    executablePath,
    headless,
    acceptDownloads: false,
    serviceWorkers: 'block',
    viewport: { width: 1280, height: 900 },
    args: [
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-sync',
      '--disable-default-apps',
      '--disable-extensions',
      '--metrics-recording-only',
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    ],
  }
}

async function launchWithFallback(executablePath) {
  let profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp03a-chrome-'))
  try {
    const context = await chromium.launchPersistentContext(profileDirectory, launchOptions(executablePath, false))
    return { context, headed: true, profileDirectory }
  } catch (headedError) {
    await removeTemporaryProfile(profileDirectory)
    profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp03a-chrome-'))
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, launchOptions(executablePath, true))
      return { context, headed: false, profileDirectory }
    } catch (cause) {
      await removeTemporaryProfile(profileDirectory)
      throw Object.assign(new Error('System Google Chrome could not be launched.'), {
        code: 'system_chrome_launch_failed', cause, headedError,
      })
    }
  }
}

function requestCategory(url) {
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'hpoi.net' || hostname.endsWith('.hpoi.net')) return 'hpoiRequests'
  if (hostname === 'api.firecrawl.dev' || hostname.endsWith('.firecrawl.dev')) return 'firecrawlRequests'
  if (['goodsmile.com', 'goodsmilearts.com', 'alter-web.jp', 'apex-toys.com', 'amiami.jp'].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  )) return 'officialSourceRequests'
  return 'otherExternalRequests'
}

async function waitForComplete(page) {
  await page.locator('body[data-gallery-status="completed"]').waitFor()
}

async function decodeAll(locator) {
  const paths = []
  for (let index = 0; index < await locator.count(); index += 1) {
    const image = locator.nth(index)
    await image.scrollIntoViewIfNeeded()
    assert.equal(await image.evaluate(async (element) => {
      try { await element.decode() } catch { return false }
      return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0
    }), true)
    const source = await image.getAttribute('src')
    assert.match(source || '', MEDIA_PATH_PATTERN)
    paths.push(source)
  }
  return paths
}

async function validateResponsive(page) {
  const cases = [
    { viewport: { width: 1280, height: 900 }, expected: 4 },
    { viewport: { width: 900, height: 900 }, expected: 3 },
    { viewport: { width: 600, height: 900 }, expected: 2 },
  ]
  const results = []
  for (const item of cases) {
    await page.setViewportSize(item.viewport)
    const template = await page.locator('#product-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns)
    const actual = countGridColumns(template)
    assert.equal(actual, item.expected)
    results.push({ ...item, actual, status: 'pass' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  return results
}

async function validateLightbox(page, expectedImages) {
  const images = page.locator('.detail-image-tile .image-open')
  assert.equal(await images.count(), expectedImages)
  await images.first().click()
  const lightbox = page.locator('#lightbox')
  await lightbox.waitFor({ state: 'visible' })
  assert.match((await page.locator('#lightbox-position').textContent()).trim(), new RegExp(`^1\\s*/\\s*${expectedImages}$`))
  assert.equal(await page.locator('#lightbox-previous').isDisabled(), true)
  await page.locator('#zoom-actual').click()
  assert.equal(await page.locator('#lightbox-stage').evaluate((node) => node.classList.contains('actual')), true)
  await page.locator('#zoom-in').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '125%')
  await page.keyboard.press('ArrowRight')
  assert.match((await page.locator('#lightbox-position').textContent()).trim(), /^2\s*\//)
  await page.keyboard.press('ArrowLeft')
  assert.match((await page.locator('#lightbox-position').textContent()).trim(), /^1\s*\//)
  await page.locator('#zoom-fit').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '100%')
  await page.keyboard.press('Escape')
  await lightbox.waitFor({ state: 'hidden' })
  return { open: true, productScopedNavigation: true, zoom: true, fit: true, escapeClose: true }
}

async function performAcceptance(context, runtime) {
  const network = {
    loopbackRequests: 0,
    loopbackWebSockets: 0,
    externalRequests: 0,
    hpoiRequests: 0,
    firecrawlRequests: 0,
    officialSourceRequests: 0,
    otherExternalRequests: 0,
  }
  const mediaResponses = []
  await context.route('**/*', async (route) => {
    const value = route.request().url()
    let url
    try { url = new URL(value) } catch { return route.continue() }
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue()
    if (isAllowedLoopbackRequest(value)) {
      network.loopbackRequests += 1
      return route.continue()
    }
    network.externalRequests += 1
    network[requestCategory(url)] += 1
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket(/.*/, async (socket) => {
    if (isAllowedLoopbackWebSocket(socket.url())) {
      network.loopbackWebSockets += 1
      return socket.connectToServer()
    }
    network.externalRequests += 1
    return socket.close({ code: 1008, reason: 'loopback_only' })
  })
  context.on('response', (response) => {
    try {
      const url = new URL(response.url())
      if (isAllowedLoopbackRequest(response.url()) && MEDIA_PATH_PATTERN.test(url.pathname)) {
        mediaResponses.push({ path: url.pathname, status: response.status() })
      }
    } catch {
      // Non-URL resources are irrelevant to the loopback media gate.
    }
  })

  const page = context.pages()[0] || await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const response = await page.goto(`${BASE_URL}${INDEX_PATH}`, { waitUntil: 'networkidle' })
  assert.equal(response?.status(), 200)
  await waitForComplete(page)
  assert.equal(await page.locator('.product-card').count(), 7)
  assert.equal(await page.locator('.reference-cover').count(), 7)
  assert.equal(await page.locator('.no-image-placeholder').count(), 0)
  assert.equal(await page.locator('.detail-image-tile').count(), 0)
  assert.equal(await page.locator('#management-status').evaluate((node) => node.open), false)
  const coverPaths = await decodeAll(page.locator('.reference-cover'))
  assert.equal(new Set(coverPaths).size, 7)
  const indexMediaRequests = new Set(mediaResponses.map((item) => item.path)).size
  assert.equal(indexMediaRequests, 7)

  const typeOptions = await page.locator('#classification-filter option').allTextContents()
  assert.deepEqual(typeOptions, ['全部类型', '比例手办'])
  assert.equal(await page.locator('#classification-filter option[value="unknown"]').count(), 0)

  const responsive = await validateResponsive(page)
  const manufacturerOptions = await page.locator('#manufacturer-filter option').count()
  assert.ok(manufacturerOptions > 2)
  await page.locator('#manufacturer-filter').selectOption({ index: 1 })
  const filteredCount = await page.locator('.product-card').count()
  assert.ok(filteredCount > 0 && filteredCount < 7)
  assert.equal(await page.locator('.reference-cover').count() <= filteredCount, true)
  await page.locator('#manufacturer-filter').selectOption('all')
  assert.equal(await page.locator('.product-card').count(), 7)

  const visitProducts = runtime.gallery.products.filter((product) => product.images.length >= 8).slice(0, 3)
  assert.equal(visitProducts.length, 3)
  const details = []
  let lightbox
  for (const [index, product] of visitProducts.entries()) {
    const before = mediaResponses.length
    await page.goto(`${BASE_URL}${INDEX_PATH}/products/${encodeURIComponent(product.id)}`, { waitUntil: 'networkidle' })
    await waitForComplete(page)
    assert.equal(await page.locator('#product-detail.hidden').count(), 0)
    assert.equal(Number((await page.locator('#detail-image-count').textContent()).trim()), product.images.length)
    assert.equal(await page.locator('.detail-image-tile').count(), product.images.length)
    const paths = await decodeAll(page.locator('.detail-image-tile img'))
    assert.equal(new Set(paths).size, product.images.length)
    const requests = new Set(mediaResponses.slice(before).map((item) => item.path)).size
    assert.equal(requests, product.images.length)
    details.push({ imageCount: product.images.length, mediaRequests: requests, status: 'pass' })
    if (index === 0) lightbox = await validateLightbox(page, product.images.length)
  }

  const apex = runtime.gallery.products.find((product) => /APEX/i.test(`${product.manufacturer} ${product.title}`))
  await page.goto(`${BASE_URL}${INDEX_PATH}/products/${encodeURIComponent(apex.id)}`, { waitUntil: 'networkidle' })
  await waitForComplete(page)
  assert.equal(await page.locator('.detail-image-tile').count(), 1)
  assert.equal((await page.locator('#detail-image-count').textContent()).trim(), '1')
  assert.equal((await page.locator('#detail-failure-count').textContent()).trim(), '0')
  assert.equal(await page.locator('#detail-failure-list li').count(), 0)
  assert.equal(await page.locator('#detail-no-images').isHidden(), true)

  await page.goto(`${BASE_URL}${INDEX_PATH}`, { waitUntil: 'networkidle' })
  await waitForComplete(page)
  const beforeReload = await page.locator('.reference-cover').evaluateAll((items) => items.map((item) => ({
    productId: item.closest('.product-card')?.dataset.productId,
    sha256: item.dataset.sha256,
    source: item.dataset.coverSource,
  })))
  await page.reload({ waitUntil: 'networkidle' })
  await waitForComplete(page)
  const afterReload = await page.locator('.reference-cover').evaluateAll((items) => items.map((item) => ({
    productId: item.closest('.product-card')?.dataset.productId,
    sha256: item.dataset.sha256,
    source: item.dataset.coverSource,
  })))
  assert.deepEqual(afterReload, beforeReload)
  assert.equal(afterReload.filter((item) => item.source === 'manual_override').length, 4)

  const userAgent = await page.evaluate(() => navigator.userAgent)
  assert.match(userAgent, /Chrome\//)
  assert.doesNotMatch(userAgent, /Edg\//)
  const extensionContexts = [
    ...context.pages().map((item) => item.url()),
    ...context.backgroundPages().map((item) => item.url()),
    ...context.serviceWorkers().map((item) => item.url()),
  ].filter((value) => value.startsWith('chrome-extension://')).length
  assert.equal(extensionContexts, 0)
  assert.equal(mediaResponses.every((item) => item.status === 200), true)
  assert.equal(network.externalRequests, 0)
  assert.equal(network.hpoiRequests, 0)
  assert.equal(network.firecrawlRequests, 0)
  assert.equal(network.officialSourceRequests, 0)

  return {
    index: {
      productCards: 7,
      coverImages: 7,
      noImagePlaceholders: 0,
      detailTiles: 0,
      indexMediaRequests,
      managementCollapsed: true,
    },
    details,
    apex: { localImages: 1, safeFailureRecords: 0, sourceDomain: 'amiami.jp' },
    filters: { productLevel: true, filteredCount },
    responsive,
    lightbox,
    preferredCoverReloadPersistence: true,
    network,
    extensionsLoaded: extensionContexts,
  }
}

async function writeResult(result) {
  const output = process.env.MVP03A_SYSTEM_CHROME_RESULT || path.join(
    os.tmpdir(),
    'figure-gallery-mvp03a-system-chrome-result.json',
  )
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, output)
  return output
}

export async function runAcceptance() {
  const runtimeRoot = process.env.PERSONAL_GALLERY_ROOT
    ? path.resolve(process.env.PERSONAL_GALLERY_ROOT)
    : DEFAULT_RUNTIME_ROOT
  const runtime = await validateRuntime(runtimeRoot)
  const executablePath = await locateSystemChrome()
  const identity = await readChromeIdentity(executablePath)
  let context
  let profileDirectory
  try {
    const launched = await launchWithFallback(executablePath)
    context = launched.context
    profileDirectory = launched.profileDirectory
    const acceptance = await performAcceptance(context, runtime)
    await context.close()
    context = null
    const profileDeleted = await removeTemporaryProfile(profileDirectory)
    assert.equal(profileDeleted, true)
    profileDirectory = null
    return {
      schemaVersion: 1,
      task: 'MVP-03A',
      status: 'pass',
      browser: {
        product: identity.ProductName,
        executable: executablePath,
        version: identity.FileVersion,
        headed: launched.headed,
        systemChrome: true,
        bundledChromiumUsed: false,
        temporaryCleanProfile: true,
        temporaryProfileDeleted: true,
        extensionsLoaded: acceptance.extensionsLoaded,
      },
      runtime: {
        products: runtime.gallery.products.length,
        images: runtime.gallery.summary.images,
        uniqueObjects: runtime.objectCount,
        coverReview: runtime.coverReview,
      },
      ...acceptance,
      artifacts: { screenshots: 0, videos: 0, traces: 0 },
    }
  } finally {
    if (context) await context.close().catch(() => {})
    if (profileDirectory) assert.equal(await removeTemporaryProfile(profileDirectory), true)
  }
}

async function main() {
  try {
    const result = await runAcceptance()
    const output = await writeResult(result)
    console.log(JSON.stringify({ ...result, resultFile: output }, null, 2))
  } catch (error) {
    const status = ['runtime_data_missing', 'runtime_data_corrupt'].includes(error?.code)
      ? error.code
      : ['system_chrome_not_found', 'system_chrome_launch_failed'].includes(error?.code)
        ? 'environment_blocked'
        : 'fail'
    const result = {
      schemaVersion: 1,
      task: 'MVP-03A',
      status,
      failureCode: error?.code || 'acceptance_assertion_failed',
      failureMessage: String(error?.message || 'Acceptance assertion failed.').slice(0, 300),
    }
    await writeResult(result)
    console.error(`${result.status}: ${result.failureCode}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
