import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { chromium } from '@playwright/test'

import {
  loadGalleryByQuery,
  normalizePreferences,
  resolveMediaObject,
} from '../src/gallery/read-model.js'

const execFileAsync = promisify(execFile)
const TOOL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REPOSITORY_ROOT = path.resolve(TOOL_ROOT, '..', '..')
const DEFAULT_RUNTIME_ROOT = path.join(REPOSITORY_ROOT, '.local', 'personal-gallery')
const BASE_URL = 'http://127.0.0.1:4317'
const GALLERY_PATH = '/gallery/characters/cheshire'
const MEDIA_PATH_PATTERN = /^\/media\/([a-f\d]{64})$/i

export function systemChromeCandidates(platform = process.platform) {
  if (platform !== 'win32') return []
  return [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ]
}

export function isAllowedLoopbackRequest(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port === '4317'
  } catch {
    return false
  }
}

export function isAllowedLoopbackWebSocket(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'ws:' && url.hostname === '127.0.0.1' && url.port === '4317'
  } catch {
    return false
  }
}

export function countGridColumns(value) {
  return String(value || '').trim().split(/\s+/).filter(Boolean).length
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function computeAcceptanceDigest(value) {
  const canonical = {
    status: value.status,
    browser: value.browser,
    gallery: value.gallery,
    network: value.network,
    responsive: value.responsive,
    interactions: value.interactions,
    artifacts: value.artifacts,
  }
  return sha256(JSON.stringify(canonical))
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

async function readChromeFileIdentity(executablePath) {
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
  assert.match(identity.ProductName || '', /Google Chrome/i, 'The selected binary is not Google Chrome.')
  assert.match(identity.FileVersion || '', /^\d+(?:\.\d+){3}$/, 'Chrome file version is unavailable.')
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

async function validateRuntime(runtimeRoot) {
  try {
    if (!(await exists(runtimeRoot))) {
      throw Object.assign(new Error('The real personal-gallery runtime is missing.'), {
        code: 'runtime_data_missing',
      })
    }
    const gallery = await loadGalleryByQuery(runtimeRoot, 'cheshire')
    if (!gallery) {
      throw Object.assign(new Error('The stable Cheshire gallery record is missing.'), {
        code: 'runtime_data_missing',
      })
    }
    assert.equal(gallery.status, 'completed', 'The stable Cheshire gallery is not complete.')
    assert.equal(gallery.sourceMode, 'official_sources', 'The stable gallery is not official-source mode.')
    assert.equal(gallery.products.length, 2, 'The stable gallery must contain exactly two products.')
    assert.equal(gallery.failures.length, 0, 'The stable gallery contains a current failure.')

    const referencedSha256 = new Set(
      gallery.products.flatMap((product) => product.images.map((image) => image.sha256)),
    )
    assert.ok(referencedSha256.size >= 19, 'The stable gallery must reference at least 19 objects.')
    for (const digest of referencedSha256) {
      const objectPath = await resolveMediaObject(runtimeRoot, digest)
      assert.ok(objectPath, 'A product references a missing local media object.')
      const bytes = await readFile(objectPath)
      assert.equal(sha256(bytes), digest, 'A local media object does not match its SHA-256 identity.')
    }
    assert.equal((await findTransientFiles(runtimeRoot)).length, 0, 'The runtime contains a .tmp or .part file.')

    const preferencesPath = path.join(runtimeRoot, 'preferences.json')
    const preferencesBytes = await readFile(preferencesPath)
    const preferencesJson = JSON.parse(preferencesBytes.toString('utf8'))
    const preferences = normalizePreferences(preferencesJson)
    return {
      gallery,
      objectCount: referencedSha256.size,
      preferences,
      preferencesBytes,
      preferencesPath,
      preferencesHash: sha256(preferencesBytes),
    }
  } catch (error) {
    if (error?.code === 'runtime_data_missing') throw error
    if (error?.code === 'ENOENT') {
      throw Object.assign(new Error('A required real runtime file is missing.'), {
        code: 'runtime_data_missing',
        cause: error,
      })
    }
    throw Object.assign(new Error('The real Cheshire runtime failed its integrity checks.'), {
      code: 'runtime_data_corrupt',
      cause: error,
    })
  }
}

async function atomicRestore(file, bytes) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, bytes, { flag: 'wx' })
  await rename(temporary, file)
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
  let profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp02-chrome-'))
  try {
    const context = await chromium.launchPersistentContext(
      profileDirectory,
      launchOptions(executablePath, false),
    )
    return { context, headed: true, profileDirectory }
  } catch (headedError) {
    if (!(await removeTemporaryProfile(profileDirectory))) {
      throw Object.assign(new Error('The headed Chrome fallback profile could not be removed.'), {
        code: 'temporary_profile_cleanup_failed',
        cause: headedError,
      })
    }
    profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-mvp02-chrome-'))
    try {
      const context = await chromium.launchPersistentContext(
        profileDirectory,
        launchOptions(executablePath, true),
      )
      return { context, headed: false, profileDirectory }
    } catch (headlessError) {
      if (!(await removeTemporaryProfile(profileDirectory))) {
        throw Object.assign(new Error('The headless Chrome profile could not be removed.'), {
          code: 'temporary_profile_cleanup_failed',
          cause: headlessError,
        })
      }
      throw Object.assign(new Error('System Google Chrome could not be launched in headed or headless mode.'), {
        code: 'system_chrome_launch_failed',
        cause: headlessError,
        headedCause: headedError,
      })
    }
  }
}

function requestCategory(url) {
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'hpoi.net' || hostname.endsWith('.hpoi.net')) return 'hpoiRequests'
  if (hostname === 'api.firecrawl.dev' || hostname.endsWith('.firecrawl.dev')) return 'firecrawlRequests'
  if (
    ['goodsmile.com', 'goodsmilearts.com', 'alter-web.jp'].some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    )
  ) return 'officialSourceRequests'
  return 'otherExternalRequests'
}

async function waitForPreferencesResponse(page, action) {
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${BASE_URL}/api/preferences` && response.status() === 200,
  )
  await action()
  await responsePromise
}

async function sanitizedGalleryState(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/gallery/character/cheshire', {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new Error(`gallery ${response.status}`)
    const value = await response.json()
    return {
      preferences: value.preferences,
      products: value.products.map((product) => ({
        id: product.id,
        preferredCoverImage: product.preferredCoverImage,
        note: product.note,
        images: product.images.map((image) => ({
          sha256: image.sha256,
          excluded: image.excluded,
          mediaUrl: image.mediaUrl,
        })),
      })),
    }
  })
}

async function validateResponsiveColumns(page) {
  const cases = [
    { viewport: { width: 1280, height: 900 }, expected: 4 },
    { viewport: { width: 900, height: 900 }, expected: 3 },
    { viewport: { width: 600, height: 900 }, expected: 2 },
  ]
  const results = []
  for (const item of cases) {
    await page.setViewportSize(item.viewport)
    const template = await page.locator('#product-grid').evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns,
    )
    const actual = countGridColumns(template)
    assert.equal(actual, item.expected, `Expected ${item.expected} gallery columns.`)
    results.push({ viewport: item.viewport, expected: item.expected, actual, status: 'pass' })
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  return results
}

async function validateLightbox(page) {
  await page.locator('.image-open').first().click()
  const lightbox = page.locator('#lightbox')
  await lightbox.waitFor({ state: 'visible' })
  assert.equal(await page.locator('#lightbox-previous').isDisabled(), true)
  const firstPosition = (await page.locator('#lightbox-position').textContent()).trim()
  assert.match(firstPosition, /^1\s*\/\s*19$/)

  await page.locator('#zoom-fit').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '100%')
  assert.equal(await page.locator('#lightbox-stage').evaluate((node) => node.classList.contains('actual')), false)
  assert.equal(await page.locator('#lightbox-image').evaluate((node) => node.style.transform), 'scale(1)')
  assert.notEqual(await page.locator('#lightbox-image').evaluate((node) => getComputedStyle(node).maxWidth), 'none')
  await page.locator('#zoom-actual').click()
  assert.equal(await page.locator('#lightbox-stage').evaluate((node) => node.classList.contains('actual')), true)
  assert.equal(await page.locator('#lightbox-image').evaluate((node) => getComputedStyle(node).maxWidth), 'none')
  await page.locator('#zoom-in').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '125%')
  assert.equal(await page.locator('#lightbox-image').evaluate((node) => node.style.transform), 'scale(1.25)')
  await page.locator('#zoom-out').click()
  assert.equal((await page.locator('#zoom-value').textContent()).trim(), '100%')
  assert.equal(await page.locator('#lightbox-image').evaluate((node) => node.style.transform), 'scale(1)')

  const firstTitle = (await page.locator('#lightbox-product-title').textContent()).trim()
  const firstImageSource = await page.locator('#lightbox-image').getAttribute('src')
  await page.keyboard.press('ArrowRight')
  assert.notEqual((await page.locator('#lightbox-position').textContent()).trim(), firstPosition)
  assert.notEqual(await page.locator('#lightbox-image').getAttribute('src'), firstImageSource)
  await page.keyboard.press('ArrowLeft')
  assert.equal((await page.locator('#lightbox-position').textContent()).trim(), firstPosition)
  assert.equal(await page.locator('#lightbox-image').getAttribute('src'), firstImageSource)

  let crossedProduct = false
  for (let index = 0; index < 19; index += 1) {
    if ((await page.locator('#lightbox-product-title').textContent()).trim() !== firstTitle) {
      crossedProduct = true
      break
    }
    if (await page.locator('#lightbox-next').isDisabled()) break
    await page.keyboard.press('ArrowRight')
  }
  assert.equal(crossedProduct, true, 'Lightbox navigation did not cross the product boundary.')

  while (!(await page.locator('#lightbox-next').isDisabled())) await page.keyboard.press('ArrowRight')
  const lastPosition = (await page.locator('#lightbox-position').textContent()).trim()
  const lastImageSource = await page.locator('#lightbox-image').getAttribute('src')
  await page.keyboard.press('ArrowRight')
  assert.equal((await page.locator('#lightbox-position').textContent()).trim(), lastPosition)
  assert.equal(await page.locator('#lightbox-image').getAttribute('src'), lastImageSource)
  while (!(await page.locator('#lightbox-previous').isDisabled())) await page.keyboard.press('ArrowLeft')
  const restoredFirstPosition = (await page.locator('#lightbox-position').textContent()).trim()
  const restoredFirstSource = await page.locator('#lightbox-image').getAttribute('src')
  await page.keyboard.press('ArrowLeft')
  assert.equal((await page.locator('#lightbox-position').textContent()).trim(), restoredFirstPosition)
  assert.equal(await page.locator('#lightbox-image').getAttribute('src'), restoredFirstSource)

  await page.keyboard.press('Escape')
  await lightbox.waitFor({ state: 'hidden' })
  return {
    open: true,
    fit: true,
    actualSize: true,
    zoomIn: true,
    zoomOut: true,
    rightAndLeft: true,
    crossProductNavigation: true,
    firstAndLastBoundaries: true,
    escapeClose: true,
  }
}

async function validatePreferencePersistence(page, runtime) {
  const candidateProduct = runtime.gallery.products.find(
    (product) => !product.excluded && product.images.filter((image) => !image.excluded).length >= 2,
  )
  assert.ok(candidateProduct, 'No product has enough visible images for preference validation.')
  const visible = candidateProduct.images.filter((image) => !image.excluded)
  const excludedTarget = visible[0]
  const coverTarget = visible.find((image) => image.sha256 !== candidateProduct.preferredCoverImage)
  assert.ok(coverTarget, 'No alternate cover is available for preference validation.')

  const excludedSelector = `img[data-sha256="${excludedTarget.sha256}"]`
  let tile = page.locator('.image-tile').filter({ has: page.locator(excludedSelector) })
  await waitForPreferencesResponse(page, () => tile.locator('.image-action').last().click())
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  assert.equal(await page.locator(excludedSelector).count(), 0)
  await page.locator('#show-excluded').check()
  tile = page.locator('.image-tile').filter({ has: page.locator(excludedSelector) })
  assert.equal(await tile.evaluate((node) => node.classList.contains('is-excluded')), true)
  await waitForPreferencesResponse(page, () => tile.locator('.image-action').last().click())
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  let state = await sanitizedGalleryState(page)
  assert.equal(state.preferences.excludedImageSha256.includes(excludedTarget.sha256), false)

  const coverSelector = `img[data-sha256="${coverTarget.sha256}"]`
  tile = page.locator('.image-tile').filter({ has: page.locator(coverSelector) })
  await waitForPreferencesResponse(page, () => tile.locator('.cover-action').click())
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  state = await sanitizedGalleryState(page)
  const persistedProduct = state.products.find((product) => product.id === candidateProduct.id)
  assert.equal(persistedProduct?.preferredCoverImage, coverTarget.sha256)
  const card = page.locator('.product-card').filter({ has: page.locator(coverSelector) })
  assert.equal(await card.locator('.image-open img').first().getAttribute('data-sha256'), coverTarget.sha256)

  const noteValue = `MVP02 system Chrome check ${randomUUID().slice(0, 8)}`
  const responsePromise = page.waitForResponse(
    (response) => response.url() === `${BASE_URL}/api/preferences` && response.status() === 200,
  )
  page.once('dialog', async (dialog) => {
    assert.equal(dialog.type(), 'prompt')
    await dialog.accept(noteValue)
  })
  await card.locator('.card-actions button').nth(1).click()
  await responsePromise
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  state = await sanitizedGalleryState(page)
  const notedProduct = state.products.find((product) => product.id === candidateProduct.id)
  assert.equal(notedProduct?.note, noteValue)
  assert.equal((await page.locator('.product-note').filter({ hasText: noteValue }).textContent()).trim(), noteValue)

  return { excludeRestore: true, preferredCoverPersisted: true, manualNotePersisted: true }
}

async function performBrowserAcceptance(context, runtime) {
  const network = {
    loopbackRequests: 0,
    loopbackWebSockets: 0,
    externalRequests: 0,
    externalHttpRequests: 0,
    externalWebSocketRequests: 0,
    hpoiRequests: 0,
    firecrawlRequests: 0,
    officialSourceRequests: 0,
    otherExternalRequests: 0,
  }
  const mediaResponses = new Map()
  await context.route('**/*', async (route) => {
    const value = route.request().url()
    let url
    try {
      url = new URL(value)
    } catch {
      return route.continue()
    }
    if (!['http:', 'https:'].includes(url.protocol)) return route.continue()
    if (isAllowedLoopbackRequest(value)) {
      network.loopbackRequests += 1
      return route.continue()
    }
    network.externalRequests += 1
    network.externalHttpRequests += 1
    network[requestCategory(url)] += 1
    return route.abort('blockedbyclient')
  })
  await context.routeWebSocket(/.*/, async (socket) => {
    const value = socket.url()
    let url
    try {
      url = new URL(value)
    } catch {
      network.externalRequests += 1
      network.externalWebSocketRequests += 1
      network.otherExternalRequests += 1
      return socket.close({ code: 1008, reason: 'loopback_only' })
    }
    if (isAllowedLoopbackWebSocket(value)) {
      network.loopbackWebSockets += 1
      socket.connectToServer()
      return
    }
    network.externalRequests += 1
    network.externalWebSocketRequests += 1
    network[requestCategory(url)] += 1
    return socket.close({ code: 1008, reason: 'loopback_only' })
  })
  context.on('response', (response) => {
    try {
      const url = new URL(response.url())
      const match = url.pathname.match(MEDIA_PATH_PATTERN)
      if (isAllowedLoopbackRequest(response.url()) && match) mediaResponses.set(match[1], response.status())
    } catch {
      // Non-URL browser resources do not participate in the HTTP gate.
    }
  })

  const page = context.pages()[0] || await context.newPage()
  await page.setViewportSize({ width: 1280, height: 900 })
  const response = await page.goto(`${BASE_URL}${GALLERY_PATH}`, { waitUntil: 'networkidle' })
  assert.equal(response?.status(), 200)
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  assert.match((await page.title()).trim(), /柴郡/)
  assert.equal((await page.locator('#gallery-title').textContent()).trim(), '柴郡')
  assert.equal((await page.locator('#source-mode').textContent()).trim(), 'Official sources')
  assert.match(await page.locator('#hpoi-source-status').textContent(), /Blocked by captcha/i)
  assert.equal(await page.locator('.product-card').count(), 2)
  const cardText = await page.locator('.product-card').allTextContents()
  const alterCardIndex = cardText.findIndex((value) => /ALTER/i.test(value))
  const goodSmileCardIndex = cardText.findIndex((value) => /Good Smile/i.test(value))
  assert.ok(alterCardIndex >= 0, 'The ALTER product card is missing.')
  assert.ok(goodSmileCardIndex >= 0, 'The Good Smile product card is missing.')
  assert.notEqual(alterCardIndex, goodSmileCardIndex, 'ALTER and Good Smile must be separate product cards.')
  assert.equal((await page.locator('#failure-count').textContent()).trim(), '0')

  const images = page.locator('.image-open img')
  assert.equal(await images.count(), runtime.objectCount)
  const mediaPaths = []
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index)
    const source = await image.getAttribute('src')
    assert.match(source || '', MEDIA_PATH_PATTERN)
    mediaPaths.push(source)
    await image.scrollIntoViewIfNeeded()
    const decoded = await image.evaluate(async (element) => {
      try {
        await element.decode()
      } catch {
        return false
      }
      return element.complete && element.naturalWidth > 0 && element.naturalHeight > 0
    })
    assert.equal(decoded, true, 'A gallery image is broken.')
  }
  assert.equal(new Set(mediaPaths).size, runtime.objectCount)
  const localMedia = await page.evaluate(async (paths) => Promise.all(paths.map(async (mediaPath) => {
    const mediaResponse = await fetch(mediaPath, { cache: 'no-store' })
    const bytes = await mediaResponse.arrayBuffer()
    return {
      status: mediaResponse.status,
      contentType: mediaResponse.headers.get('content-type') || '',
      bytes: bytes.byteLength,
    }
  })), mediaPaths)
  assert.equal(localMedia.every((item) => item.status === 200 && /^image\//.test(item.contentType) && item.bytes > 0), true)
  assert.equal([...mediaResponses.values()].filter((status) => status !== 200).length, 0)

  const responsive = await validateResponsiveColumns(page)
  const lightbox = await validateLightbox(page)
  const preferences = await validatePreferencePersistence(page, runtime)

  await atomicRestore(runtime.preferencesPath, runtime.preferencesBytes)
  assert.equal(sha256(await readFile(runtime.preferencesPath)), runtime.preferencesHash)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('body[data-gallery-status="completed"]').waitFor()
  const restoredState = await sanitizedGalleryState(page)
  assert.deepEqual(restoredState.preferences, runtime.preferences)

  const userAgent = await page.evaluate(() => navigator.userAgent)
  assert.match(userAgent, /Chrome\//)
  assert.doesNotMatch(userAgent, /Edg\//)
  const extensionContexts = [
    ...context.pages().map((item) => item.url()),
    ...context.backgroundPages().map((item) => item.url()),
    ...context.serviceWorkers().map((item) => item.url()),
  ].filter((value) => value.startsWith('chrome-extension://')).length

  assert.equal(network.externalRequests, 0)
  assert.equal(network.hpoiRequests, 0)
  assert.equal(network.firecrawlRequests, 0)
  assert.equal(network.officialSourceRequests, 0)
  assert.equal(extensionContexts, 0)
  network.applicationNavigationGuarded = true
  return {
    productCards: 2,
    localObjects: runtime.objectCount,
    localImages: await images.count(),
    mediaHttp: {
      checked: localMedia.length,
      http200: localMedia.filter((item) => item.status === 200).length,
      failures: localMedia.filter((item) => item.status !== 200).length,
    },
    manufacturers: {
      alter: alterCardIndex >= 0,
      goodSmile: goodSmileCardIndex >= 0,
      separateCards: alterCardIndex !== goodSmileCardIndex,
    },
    responsive,
    lightbox,
    preferences: { ...preferences, originalBytesRestored: true },
    network,
    extensionsLoaded: extensionContexts,
  }
}

async function writeResult(result) {
  const output = process.env.MVP02_SYSTEM_CHROME_RESULT || path.join(
    os.tmpdir(),
    'figure-gallery-mvp02-system-chrome-result.json',
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
  const fileIdentity = await readChromeFileIdentity(executablePath)
  let context = null
  let profileDirectory = null
  let profileDeleted = false
  try {
    const launched = await launchWithFallback(executablePath)
    context = launched.context
    profileDirectory = launched.profileDirectory
    const validation = await performBrowserAcceptance(context, runtime)
    const chromeVersion = fileIdentity.FileVersion
    await context.close()
    context = null
    profileDeleted = await removeTemporaryProfile(profileDirectory)
    assert.equal(profileDeleted, true)
    const result = {
      schemaVersion: 1,
      task: 'MVP-02-FINAL',
      gate: 'MVP02-11',
      status: 'pass',
      browser: {
        product: fileIdentity.ProductName,
        executable: executablePath,
        version: chromeVersion,
        headed: launched.headed,
        systemChrome: true,
        bundledChromiumUsed: false,
        temporaryCleanProfile: true,
        temporaryProfileDeleted: profileDeleted,
        extensionsLoaded: validation.extensionsLoaded,
        userProfileRead: false,
      },
      gallery: {
        productCards: validation.productCards,
        localObjects: validation.localObjects,
        localImages: validation.localImages,
        mediaHttp: validation.mediaHttp,
        manufacturers: validation.manufacturers,
      },
      network: validation.network,
      responsive: validation.responsive,
      interactions: {
        ...validation.lightbox,
        ...validation.preferences,
      },
      artifacts: { screenshots: 0, videos: 0, traces: 0 },
    }
    return { ...result, resultDigest: computeAcceptanceDigest(result) }
  } finally {
    if (context) await context.close().catch(() => {})
    if (profileDirectory && !profileDeleted) {
      profileDeleted = await removeTemporaryProfile(profileDirectory)
      assert.equal(profileDeleted, true, 'The temporary Chrome profile could not be removed.')
    }
    if (sha256(await readFile(runtime.preferencesPath)) !== runtime.preferencesHash) {
      await atomicRestore(runtime.preferencesPath, runtime.preferencesBytes)
    }
    assert.equal(sha256(await readFile(runtime.preferencesPath)), runtime.preferencesHash)
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
      task: 'MVP-02-FINAL',
      gate: 'MVP02-11',
      status,
      failureCode: error?.code || 'acceptance_assertion_failed',
    }
    await writeResult(result)
    console.error(`${result.status}: ${result.failureCode}`)
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
