import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import { loadGalleryByQuery } from '../src/gallery/read-model.js'
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

async function exists(value) {
  try { await access(value); return true } catch { return false }
}

async function locateSystemChrome() {
  for (const candidate of systemChromeCandidates()) if (await exists(candidate)) return candidate
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
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command,
  ], { windowsHide: true })
  const identity = JSON.parse(stdout.trim())
  assert.match(identity.ProductName || '', /Google Chrome/iu)
  assert.match(identity.FileVersion || '', /^\d+(?:\.\d+){3}$/u)
  return identity
}

export function summarizeMultiCharacterRuntime(cheshire, rem) {
  const cheshireObjects = new Set(cheshire.products.flatMap((product) => product.images.map((image) => image.sha256)))
  const remObjects = new Set(rem.products.flatMap((product) => product.images.map((image) => image.sha256)))
  const crossCharacterObjects = [...cheshireObjects].filter((sha256) => remObjects.has(sha256)).length
  const coverCounts = (gallery) => ({
    automatic: gallery.products.filter((product) => product.coverImage && product.coverSelectionSource !== 'manual_override').length,
    manual: gallery.products.filter((product) => product.coverSelectionSource === 'manual_override').length,
    missing: gallery.products.filter((product) => !product.coverImage).length,
  })
  return {
    characters: 2,
    cheshire: { products: cheshire.products.length, images: cheshire.summary.images, covers: coverCounts(cheshire) },
    rem: {
      products: rem.products.length,
      images: rem.summary.images,
      manufacturers: new Set(rem.products.map((product) => product.manufacturer)).size,
      classifications: {
        scale: rem.summary.likely_scale,
        prize: rem.summary.likely_prize,
        static: rem.summary.likely_static,
        unknown: rem.summary.unknown,
        other: rem.summary.other,
      },
      covers: coverCounts(rem),
    },
    sha256Objects: new Set([...cheshireObjects, ...remObjects]).size,
    crossCharacterObjects,
  }
}

async function validateRuntime(runtimeRoot) {
  if (!(await exists(runtimeRoot))) throw Object.assign(new Error('Personal gallery runtime is missing.'), { code: 'runtime_data_missing' })
  const cheshire = await loadGalleryByQuery(runtimeRoot, 'cheshire')
  const rem = await loadGalleryByQuery(runtimeRoot, 'rem')
  if (!cheshire || !rem) throw Object.assign(new Error('Both character galleries are required.'), { code: 'runtime_data_missing' })
  const summary = summarizeMultiCharacterRuntime(cheshire, rem)
  try {
    assert.equal(cheshire.status, 'completed')
    assert.equal(cheshire.products.length, 7)
    assert.equal(cheshire.summary.images, 65)
    assert.equal(cheshire.summary.indexCovers, 7)
    assert.equal(cheshire.summary.productsWithoutImages, 0)
    assert.equal(rem.status, 'completed')
    assert.ok(rem.products.length >= 8)
    assert.ok(rem.summary.images >= 30)
    assert.ok(summary.rem.manufacturers >= 4)
    assert.equal(rem.summary.indexCovers, rem.products.length)
    assert.equal(rem.summary.productsWithoutImages, 0)
    assert.equal(rem.summary.unknown, 0)
    assert.equal(rem.summary.other, 0)
    return { cheshire, rem, summary }
  } catch (cause) {
    throw Object.assign(new Error('The real two-character runtime failed integrity checks.'), {
      code: 'runtime_data_corrupt', cause,
    })
  }
}

async function removeProfile(directory) {
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

async function launchSystemChrome(executablePath) {
  for (const headless of [false, true]) {
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp04-chrome-'))
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, launchOptions(executablePath, headless))
      return { context, profileDirectory, headed: !headless }
    } catch (error) {
      await removeProfile(profileDirectory)
      if (headless) throw Object.assign(new Error('System Google Chrome could not be launched.'), {
        code: 'system_chrome_launch_failed', cause: error,
      })
    }
  }
}

function coverSignature(page) {
  return page.locator('.reference-cover').evaluateAll((items) => items.map((item) => ({
    productId: item.closest('.product-card')?.dataset.productId,
    sha256: item.dataset.sha256,
    source: item.dataset.coverSource,
  })))
}

async function waitForGallery(page) {
  await page.locator('body[data-gallery-status="completed"]').waitFor()
}

async function responsiveResult(page) {
  const cases = [[1280, 4], [900, 3], [600, 2]]
  const output = []
  for (const [width, expected] of cases) {
    await page.setViewportSize({ width, height: 900 })
    const template = await page.locator('#product-grid').evaluate((node) => getComputedStyle(node).gridTemplateColumns)
    const actual = countGridColumns(template)
    assert.equal(actual, expected)
    output.push({ width, expected, actual, status: 'pass' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  return output
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
    if (url.hostname === 'hpoi.net' || url.hostname.endsWith('.hpoi.net')) network.hpoiRequests += 1
    else if (url.hostname === 'api.firecrawl.dev' || url.hostname.endsWith('.firecrawl.dev')) network.firecrawlRequests += 1
    else if (['goodsmile.com', 'alter-web.jp', 'apex-toys.com', 'amiami.jp'].some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) network.officialSourceRequests += 1
    else network.otherExternalRequests += 1
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket(/.*/u, async (socket) => {
    if (isAllowedLoopbackWebSocket(socket.url())) {
      network.loopbackWebSockets += 1
      return socket.connectToServer()
    }
    network.externalRequests += 1
    return socket.close({ code: 1008, reason: 'loopback_only' })
  })

  const page = context.pages()[0] || await context.newPage()
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  const galleryLinks = page.locator('#character-galleries a')
  await galleryLinks.first().waitFor()
  assert.equal(await galleryLinks.count(), 2)
  assert.match(await page.locator('#character-galleries').textContent(), /柴郡/u)
  assert.match(await page.locator('#character-galleries').textContent(), /蕾姆/u)

  await page.locator('#character-galleries .recent-run', { hasText: '柴郡' }).locator('a').click()
  await waitForGallery(page)
  assert.equal(await page.locator('.product-card').count(), 7)
  assert.equal(await page.locator('.reference-cover').count(), 7)
  const cheshireCovers = await coverSignature(page)

  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.locator('#character-galleries .recent-run', { hasText: '蕾姆' }).locator('a').click()
  await waitForGallery(page)
  assert.equal(await page.locator('.product-card').count(), runtime.rem.products.length)
  assert.equal(await page.locator('.reference-cover').count(), runtime.rem.products.length)
  assert.equal(await page.locator('.no-image-placeholder').count(), 0)
  const responsive = await responsiveResult(page)
  const typeValues = await page.locator('#classification-filter option').evaluateAll((options) => options.map((item) => item.value))
  assert.ok(typeValues.includes('likely_scale'))
  assert.ok(typeValues.includes('likely_static'))
  assert.equal(typeValues.includes('unknown'), false)
  assert.equal(typeValues.includes('other'), false)
  await page.locator('#classification-filter').selectOption('likely_static')
  assert.equal(await page.locator('.product-card').count(), runtime.rem.summary.likely_static)
  await page.locator('#classification-filter').selectOption('all')
  await page.locator('#manufacturer-filter').selectOption({ index: 1 })
  assert.ok(await page.locator('.product-card').count() > 0)
  await page.locator('#manufacturer-filter').selectOption('all')

  const product = runtime.rem.products.find((candidate) => candidate.images.length >= 2)
  assert.ok(product)
  await page.goto(`${BASE_URL}/gallery/characters/rem/products/${encodeURIComponent(product.id)}`, { waitUntil: 'networkidle' })
  await waitForGallery(page)
  assert.equal(await page.locator('.detail-image-tile').count(), product.images.length)
  await page.locator('.image-open').first().click()
  await page.locator('#lightbox').waitFor({ state: 'visible' })
  await page.locator('#zoom-in').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '125%')
  await page.keyboard.press('ArrowRight')
  assert.match((await page.locator('#lightbox-position').textContent()).trim(), /^2\s*\//u)
  await page.keyboard.press('Escape')
  await page.locator('#lightbox').waitFor({ state: 'hidden' })

  const currentSha = await page.locator('#current-cover .reference-cover').getAttribute('data-sha256')
  const alternatives = page.locator('.detail-image-tile').filter({ hasNot: page.locator(`img[data-sha256="${currentSha}"]`) })
  assert.ok(await alternatives.count() > 0)
  const manualSha = await alternatives.first().locator('img').getAttribute('data-sha256')
  const saved = page.waitForResponse((response) => response.url() === `${BASE_URL}/api/preferences/rem` && response.status() === 200)
  await alternatives.first().getByRole('button', { name: '设为封面' }).click()
  await saved
  await page.reload({ waitUntil: 'networkidle' })
  await waitForGallery(page)
  assert.equal(await page.locator('#current-cover .reference-cover').getAttribute('data-sha256'), manualSha)

  await page.goto(`${BASE_URL}/gallery/characters/cheshire`, { waitUntil: 'networkidle' })
  await waitForGallery(page)
  assert.deepEqual(await coverSignature(page), cheshireCovers)
  const userAgent = await page.evaluate(() => navigator.userAgent)
  assert.match(userAgent, /Chrome\//u)
  assert.doesNotMatch(userAgent, /Edg\//u)
  const extensionsLoaded = [
    ...context.pages().map((item) => item.url()),
    ...context.backgroundPages().map((item) => item.url()),
    ...context.serviceWorkers().map((item) => item.url()),
  ].filter((value) => value.startsWith('chrome-extension://')).length
  assert.equal(extensionsLoaded, 0)
  assert.equal(network.externalRequests, 0)
  return {
    home: { characters: 2, distinctRoutes: true },
    cheshire: { products: 7, images: 65, coversPreserved: true },
    rem: {
      products: runtime.rem.products.length,
      images: runtime.rem.summary.images,
      oneCoverPerProduct: true,
      detail: true,
      lightbox: true,
      zoom: true,
      filters: true,
      manualCoverPersisted: true,
    },
    responsive,
    network,
    extensionsLoaded,
  }
}

async function writeResult(result) {
  const output = process.env.MVP04_SYSTEM_CHROME_RESULT || path.join(os.tmpdir(), 'figure-gallery-mvp04-system-chrome-result.json')
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, output)
  return output
}

export async function runAcceptance() {
  const runtimeRoot = process.env.PERSONAL_GALLERY_ROOT ? path.resolve(process.env.PERSONAL_GALLERY_ROOT) : DEFAULT_RUNTIME_ROOT
  const runtime = await validateRuntime(runtimeRoot)
  const executablePath = await locateSystemChrome()
  const identity = await readChromeIdentity(executablePath)
  let context
  let profileDirectory
  try {
    const launched = await launchSystemChrome(executablePath)
    context = launched.context
    profileDirectory = launched.profileDirectory
    const acceptance = await performAcceptance(context, runtime)
    await context.close()
    context = null
    assert.equal(await removeProfile(profileDirectory), true)
    profileDirectory = null
    return {
      schemaVersion: 1,
      task: 'MVP-04',
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
      },
      runtime: runtime.summary,
      ...acceptance,
      artifacts: { screenshots: 0, videos: 0, traces: 0 },
    }
  } finally {
    if (context) await context.close().catch(() => {})
    if (profileDirectory) assert.equal(await removeProfile(profileDirectory), true)
  }
}

async function main() {
  try {
    const result = await runAcceptance()
    const resultFile = await writeResult(result)
    console.log(JSON.stringify({ ...result, resultFile }, null, 2))
  } catch (error) {
    const status = ['runtime_data_missing', 'runtime_data_corrupt'].includes(error?.code)
      ? error.code
      : ['system_chrome_not_found', 'system_chrome_launch_failed'].includes(error?.code)
        ? 'environment_blocked'
        : 'fail'
    await writeResult({
      schemaVersion: 1,
      task: 'MVP-04',
      status,
      failureCode: error?.code || 'acceptance_assertion_failed',
      failureMessage: String(error?.message || 'Acceptance assertion failed.').slice(0, 300),
    })
    console.error(`${status}: ${error?.code || 'acceptance_assertion_failed'}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
