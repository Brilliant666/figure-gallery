import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { access, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import { loadConfig } from '../src/config.js'
import { loadGalleryByQuery } from '../src/gallery/read-model.js'
import { createDefaultRuntime } from '../src/server/runtime-adapter.js'
import { createPersonalGalleryServer } from '../src/server/server.js'
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
const BASELINES = Object.freeze({
  cheshire: { products: 7, images: 65 },
  rem: { products: 11, images: 89 },
})

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

async function removeProfile(directory) {
  if (!directory) return true
  await rm(directory, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
  return !(await exists(directory))
}

async function launchSystemChrome(executablePath) {
  for (const headless of [false, true]) {
    const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp05-chrome-'))
    try {
      const context = await chromium.launchPersistentContext(profileDirectory, {
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
      })
      return { context, profileDirectory, headed: !headless }
    } catch (error) {
      await removeProfile(profileDirectory)
      if (headless) throw Object.assign(new Error('System Google Chrome could not be launched.'), {
        code: 'system_chrome_launch_failed', cause: error,
      })
    }
  }
}

function directAccessIsZero(coverage) {
  return [
    'hpoiDirectHttpRequests',
    'hpoiDirectBrowserNavigations',
    'hpoiScrapeRequests',
    'hpoiApiRequests',
  ].every((key) => Number(coverage?.directAccess?.[key]) === 0)
}

async function loadRuntime(runtimeRoot, runtime) {
  if (!(await exists(runtimeRoot))) throw Object.assign(new Error('Personal gallery runtime is missing.'), { code: 'runtime_data_missing' })
  const characters = {}
  for (const slug of ['cheshire', 'rem']) {
    const gallery = await loadGalleryByQuery(runtimeRoot, slug)
    const discovery = await runtime.loadDiscovery(slug)
    if (!gallery || !discovery?.coverage) throw Object.assign(new Error(`Gallery or discovery coverage is missing for ${slug}.`), { code: 'runtime_data_missing' })
    assert.equal(gallery.status, 'completed')
    assert.ok(gallery.products.length >= BASELINES[slug].products)
    assert.ok(gallery.summary.images >= BASELINES[slug].images)
    assert.ok(Number(discovery.coverage.metrics?.hpoiIndexedCandidates) > 0)
    assert.equal(directAccessIsZero(discovery.coverage), true)
    characters[slug] = {
      gallery,
      discovery,
      preferences: JSON.stringify(gallery.preferences),
      addedProducts: gallery.products.length - BASELINES[slug].products,
      addedImages: gallery.summary.images - BASELINES[slug].images,
    }
  }
  return characters
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

async function validateCharacter(page, slug, state) {
  await page.goto(`${BASE_URL}/gallery/characters/${slug}`, { waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  assert.equal(await page.locator('.product-card').count(), state.gallery.products.length)
  const responsive = await responsiveResult(page)
  const product = state.gallery.products.find((entry) => entry.images.length >= 2)
  assert.ok(product, `${slug} requires at least one multi-image product for lightbox validation.`)
  await page.goto(`${BASE_URL}/gallery/characters/${slug}/products/${encodeURIComponent(product.id)}`, { waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  assert.equal(await page.locator('.detail-image-tile').count(), product.images.length)
  await page.locator('.image-open').first().click()
  await page.locator('#lightbox').waitFor({ state: 'visible' })
  await page.locator('#zoom-in').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '125%')
  await page.keyboard.press('ArrowRight')
  assert.match((await page.locator('#lightbox-position').textContent()).trim(), /^2\s*\//u)
  await page.keyboard.press('Escape')
  await page.locator('#lightbox').waitFor({ state: 'hidden' })

  await page.goto(`${BASE_URL}/discovery/${slug}`, { waitUntil: 'networkidle' })
  await page.locator('#candidate-rows tr').first().waitFor()
  assert.equal(await page.locator('#candidate-rows tr').count(), state.discovery.candidates.length)
  assert.match(await page.locator('.source-notice').textContent(), /HPOI-DIRECT-0/u)
  assert.equal(await page.locator('a[href*="hpoi.net"]').count(), 0)
  return {
    products: state.gallery.products.length,
    images: state.gallery.summary.images,
    covers: state.gallery.summary.indexCovers,
    newProductCards: state.addedProducts,
    newImages: state.addedImages,
    detail: true,
    lightbox: true,
    zoom: true,
    responsive,
    coverageCandidates: state.discovery.candidates.length,
  }
}

async function performAcceptance(context, runtimeState) {
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
  await page.locator('#character-galleries .recent-run').first().waitFor()
  assert.equal(await page.locator('#character-galleries .recent-run').count(), 2)
  assert.match(await page.locator('#character-galleries').textContent(), /柴郡/u)
  assert.match(await page.locator('#character-galleries').textContent(), /蕾姆/u)
  assert.equal(await page.locator('#character-galleries a', { hasText: '收录覆盖' }).count(), 2)

  const cheshire = await validateCharacter(page, 'cheshire', runtimeState.cheshire)
  const rem = await validateCharacter(page, 'rem', runtimeState.rem)
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
  return { cheshire, rem, network, extensionsLoaded }
}

async function writeResult(result) {
  const output = process.env.MVP05_SYSTEM_CHROME_RESULT || path.join(os.tmpdir(), 'figure-gallery-mvp05-system-chrome-result.json')
  const temporary = `${output}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(result, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, output)
  return output
}

export async function runAcceptance() {
  const loaded = loadConfig()
  const config = {
    ...loaded,
    host: '127.0.0.1',
    port: 4317,
    liveFetchEnabled: false,
    officialLiveFetchEnabled: false,
    root: process.env.PERSONAL_GALLERY_ROOT ? path.resolve(process.env.PERSONAL_GALLERY_ROOT) : DEFAULT_RUNTIME_ROOT,
  }
  const runtime = createDefaultRuntime(config)
  const runtimeState = await loadRuntime(config.root, runtime)
  const application = createPersonalGalleryServer({ config, runtime })
  const executablePath = await locateSystemChrome()
  const identity = await readChromeIdentity(executablePath)
  let context
  let profileDirectory
  try {
    await application.listen()
    const launched = await launchSystemChrome(executablePath)
    context = launched.context
    profileDirectory = launched.profileDirectory
    const acceptance = await performAcceptance(context, runtimeState)
    await context.close()
    context = null
    assert.equal(await removeProfile(profileDirectory), true)
    profileDirectory = null
    for (const slug of ['cheshire', 'rem']) {
      const after = await loadGalleryByQuery(config.root, slug)
      assert.equal(JSON.stringify(after.preferences), runtimeState[slug].preferences)
    }
    return {
      schemaVersion: 1,
      task: 'MVP-05',
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
      ...acceptance,
      preferencesPreserved: true,
      artifacts: { screenshots: 0, videos: 0, traces: 0 },
    }
  } finally {
    if (context) await context.close().catch(() => {})
    if (profileDirectory) assert.equal(await removeProfile(profileDirectory), true)
    await application.close().catch(() => {})
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
      task: 'MVP-05',
      status,
      failureCode: error?.code || 'acceptance_assertion_failed',
      failureMessage: String(error?.message || 'Acceptance assertion failed.').slice(0, 300),
    })
    console.error(`${status}: ${error?.code || 'acceptance_assertion_failed'}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
