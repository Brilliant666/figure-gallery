import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { collectGallery } from '../../src/collectors/index.js'
import { GalleryStore } from '../../src/storage/gallery-store.js'
import { FirecrawlFetchProvider } from '../../src/providers/firecrawl-fetch-provider.js'
import * as deterministicParsers from '../../src/parsers/index.js'

const CHARACTER_1 = 'https://www.hpoi.net/charactar/1'
const CHARACTER_2 = 'https://www.hpoi.net/charactar/1?page=2'
const PRODUCT_1 = 'https://www.hpoi.net/hobby/101'
const PRODUCT_2 = 'https://www.hpoi.net/hobby/102'

async function storeFor(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'figure-gallery-collector-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, store: await new GalleryStore(root).initialize() }
}

const parsers = {
  parseCharacterPage(result) {
    if (result.marker === 'character-1') {
      return {
        productUrls: [PRODUCT_1, PRODUCT_1],
        nextPageUrl: CHARACTER_2,
        warnings: ['synthetic duplicate link'],
      }
    }
    return { productUrls: [PRODUCT_2], nextPageUrl: null, warnings: [] }
  },
  parseProductPage(result) {
    return {
      sourceItemId: result.id,
      title: result.title,
      classification: result.classification,
      imageUrls: [`https://img.example.test/${result.id}.png`],
    }
  },
}

function provider({ changedTitle = false } = {}) {
  return {
    async fetchPage({ kind, url }) {
      if (kind === 'character') {
        return { status: 200, finalUrl: url, marker: url === CHARACTER_1 ? 'character-1' : 'character-2', rawHtml: '<main>ok</main>' }
      }
      const id = url.endsWith('101') ? '101' : '102'
      return {
        status: 200,
        finalUrl: url,
        id,
        title: id === '101' && changedTitle ? 'Changed synthetic title' : `Synthetic ${id}`,
        classification: id === '101' ? 'likely_scale' : 'unknown',
        rawHtml: '<main>product</main>',
      }
    },
  }
}

const noDelay = async () => {}
const allowImageUrl = (url) => new URL(url).hostname === 'img.example.test'

test('sequential collector follows only explicit pagination, deduplicates URLs, and reports new/unchanged/changed', async (t) => {
  const { store } = await storeFor(t)
  const imageObjects = new Set()
  const downloadImage = async ({ url }) => {
    const duplicate = imageObjects.has(url)
    imageObjects.add(url)
    return { duplicate }
  }
  const common = {
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: provider(),
    storage: store,
    parsers,
    downloadImage,
    allowImageUrl,
    sleep: noDelay,
    limits: { maxListPages: 20, maxProducts: 200, maxImagesPerProduct: 5, maxRetries: 0, requestDelayMs: 0 },
  }
  const first = await collectGallery(common)
  assert.equal(first.status, 'completed')
  assert.equal(first.counters.pages, 2)
  assert.equal(first.counters.productsDiscovered, 2)
  assert.equal(first.counters.productsNew, 2)
  assert.equal(first.counters.likelyScale, 1)
  assert.equal(first.counters.unknown, 1)
  assert.equal(first.counters.uniqueObjects, 2)

  const second = await collectGallery(common)
  assert.equal(second.counters.productsNew, 0)
  assert.equal(second.counters.productsUnchanged, 2)
  assert.equal(second.counters.duplicateImages, 2)

  const third = await collectGallery({ ...common, provider: provider({ changedTitle: true }) })
  assert.equal(third.counters.productsChanged, 1)
  assert.equal(third.counters.productsUnchanged, 1)
  const summary = JSON.parse(await readFile(store.runFile(third.runId, 'products.json'), 'utf8'))
  const changed = summary.find((entry) => entry.state === 'changed')
  assert.deepEqual(changed.changedFields, ['title'])
})

test('one recoverable product-page failure is recorded and later products continue', async (t) => {
  const { store } = await storeFor(t)
  let failedAttempts = 0
  const fakeProvider = {
    async fetchPage({ kind, url }) {
      if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', marker: 'character-1', finalUrl: url }
      if (url === PRODUCT_1) {
        failedAttempts += 1
        const error = new Error('synthetic timeout')
        error.code = 'ETIMEDOUT'
        throw error
      }
      return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url, id: '102', title: 'Synthetic 102', classification: 'unknown' }
    },
  }
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: fakeProvider,
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1, PRODUCT_2] }),
      parseProductPage: (result) => ({
        sourceItemId: result.id,
        title: result.title,
        classification: result.classification,
        imageUrls: [],
      }),
    },
    downloadImage: async () => assert.fail('no images should be downloaded'),
    allowImageUrl,
    sleep: noDelay,
    limits: { maxRetries: 1, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(failedAttempts, 2)
  assert.equal(result.counters.productFailures, 1)
  assert.equal(result.counters.productsProcessed, 1)
  const failures = JSON.parse(await readFile(store.runFile(result.runId, 'failures.json'), 'utf8'))
  assert.equal(failures.length, 1)
  assert.equal(failures[0].code, 'ETIMEDOUT')
})

for (const scenario of [
  { name: '401', response: { status: 401, rawHtml: '' }, reason: 'http_401' },
  { name: '403', response: { status: 403, rawHtml: '' }, reason: 'http_403' },
  { name: '429', response: { status: 429, rawHtml: '' }, reason: 'http_429' },
  { name: 'captcha', response: { status: 200, rawHtml: '<title>Captcha - verify you are human</title>' }, reason: 'captcha' },
  { name: 'login', response: { status: 200, rawHtml: '<title>Login required</title><p>Sign in to continue</p>' }, reason: 'login_required' },
  { name: 'robots refusal', response: { status: 200, robotsDenied: true, rawHtml: '' }, reason: 'robots_denied' },
]) {
  test(`${scenario.name} stops immediately without retry`, async (t) => {
    const { store } = await storeFor(t)
    let calls = 0
    const result = await collectGallery({
      query: 'synthetic-character',
      characterUrl: CHARACTER_1,
      provider: { async fetchPage() { calls += 1; return { ...scenario.response, finalUrl: CHARACTER_1 } } },
      storage: store,
      parsers,
      allowImageUrl,
      sleep: noDelay,
      limits: { maxRetries: 2, requestDelayMs: 0 },
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.stopReason, scenario.reason)
    assert.equal(calls, 1)
  })
}

test('three consecutive identical access errors stop the run while preserving earlier records', async (t) => {
  const { store } = await storeFor(t)
  const productUrls = [101, 102, 103, 104].map((id) => `https://www.hpoi.net/hobby/${id}`)
  let productCalls = 0
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage({ kind, url }) {
        if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url }
        productCalls += 1
        const error = new Error('synthetic access transport refusal')
        error.code = 'ACCESS_TRANSPORT_REFUSED'
        throw error
      },
    },
    storage: store,
    parsers: { ...parsers, parseCharacterPage: () => ({ productUrls }) },
    allowImageUrl,
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.stopReason, 'consecutive_access_errors')
  assert.equal(productCalls, 3)
  assert.equal(result.counters.productFailures, 3)
})

test('non-allowlisted next page and final redirect are blocked', async (t) => {
  const { store } = await storeFor(t)
  const nextBlocked = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url } } },
    storage: store,
    parsers: { ...parsers, parseCharacterPage: () => ({ productUrls: [], nextPageUrl: 'https://evil.example/page/2' }) },
    allowImageUrl,
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(nextBlocked.status, 'blocked')
  assert.equal(nextBlocked.stopReason, 'page_url_not_allowed')

  const redirected = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage() { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: 'https://evil.example/redirect' } } },
    storage: store,
    parsers,
    allowImageUrl,
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(redirected.status, 'blocked')
  assert.equal(redirected.stopReason, 'page_redirect_not_allowed')
})

test('character discovery returns disambiguation candidates and does not let the collector guess', async (t) => {
  const { store } = await storeFor(t)
  let fetchCalls = 0
  const result = await collectGallery({
    query: 'same-name',
    provider: {
      async discoverCharacter() {
        return { candidates: [
          { title: 'Same Name', work: 'Work A', url: 'https://www.hpoi.net/charactar/1' },
          { title: 'Same Name', work: 'Work B', url: 'https://www.hpoi.net/charactar/2' },
        ] }
      },
      async fetchPage() { fetchCalls += 1 },
    },
    storage: store,
    parsers,
    allowImageUrl,
    sleep: noDelay,
  })
  assert.equal(result.status, 'needs_disambiguation')
  assert.equal(result.disambiguationCandidates.length, 2)
  assert.equal(fetchCalls, 0)
})

test('all provider requests are sequential and AbortSignal preserves completed product data', async (t) => {
  const { store } = await storeFor(t)
  const controller = new AbortController()
  let active = 0
  let maximumActive = 0
  const urls = [101, 102, 103].map((id) => `https://www.hpoi.net/hobby/${id}`)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage({ kind, url }) {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url }
        return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url, id: url.split('/').at(-1), title: url, classification: 'unknown' }
      },
    },
    storage: store,
    parsers: { ...parsers, parseCharacterPage: () => ({ productUrls: urls }) },
    downloadImage: async () => ({ duplicate: false }),
    allowImageUrl,
    sleep: noDelay,
    signal: controller.signal,
    progress(event) {
      if (event.phase === 'product' && event.counters.productsProcessed === 1) controller.abort()
    },
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(maximumActive, 1)
  assert.equal(result.status, 'stopped')
  assert.equal(result.counters.productsProcessed, 1)
  assert.equal(result.counters.productsNew, 1)
})

test('max page and product limits mark partial_by_limit without guessing pages', async (t) => {
  const { store } = await storeFor(t)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url } } },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1, PRODUCT_2], nextPageUrl: CHARACTER_2 }),
      parseProductPage: ({ url }) => ({ sourceItemId: url.split('/').at(-1), title: 'Limited product', imageUrls: [] }),
    },
    allowImageUrl,
    sleep: noDelay,
    limits: { maxProducts: 1, maxListPages: 20, maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'partial_by_limit')
  assert.equal(result.stopReason, 'max_products')
  assert.equal(result.counters.productsDiscovered, 1)
  assert.equal(result.counters.productsProcessed, 1)
})

test('a product cap truncating the final page is still reported as partial_by_limit', async (t) => {
  const { store } = await storeFor(t)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url } } },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1, PRODUCT_2], nextPageUrl: null }),
      parseProductPage: ({ url }) => ({ sourceItemId: url.split('/').at(-1), title: 'Limited product', imageUrls: [] }),
    },
    allowImageUrl,
    sleep: noDelay,
    limits: { maxProducts: 1, maxListPages: 20, maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'partial_by_limit')
  assert.equal(result.stopReason, 'max_products')
  assert.equal(result.counters.productsDiscovered, 1)
})

test('an image-per-product cap records omitted public candidates and partial status', async (t) => {
  const { store } = await storeFor(t)
  const imageCandidates = [1, 2, 3].map((value) => `https://img.example.test/${value}.png`)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url } } },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1], nextPageUrl: null }),
      parseProductPage: () => ({ sourceItemId: '101', title: 'Image-limited product', imageUrls: imageCandidates }),
    },
    allowImageUrl,
    downloadImage: async () => ({ duplicate: false }),
    sleep: noDelay,
    limits: { maxImagesPerProduct: 2, maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'partial_by_limit')
  assert.equal(result.stopReason, 'max_images_per_product')
  assert.equal(result.counters.imageUrls, 3)
  assert.equal(result.counters.imageUrlsOmitted, 1)
  assert.equal(result.counters.imagesDownloaded, 2)
  const warnings = JSON.parse(await readFile(store.runFile(result.runId, 'parser-warnings.json'), 'utf8'))
  assert.equal(warnings.some((warning) => warning.kind === 'image_limit_reached' && warning.omitted === 1), true)
})

test('provider is mandatory and is never constructed implicitly', async (t) => {
  const { store } = await storeFor(t)
  await assert.rejects(
    collectGallery({ query: 'synthetic-character', characterUrl: CHARACTER_1, storage: store, parsers }),
    /requires a provider/,
  )
})

test('credential-bearing explicit character URLs are rejected before any run manifest is created', async (t) => {
  const { root, store } = await storeFor(t)
  const secret = 'synthetic-page-secret'
  await assert.rejects(
    collectGallery({
      query: 'synthetic-character',
      characterUrl: `https://user:${secret}@www.hpoi.net/charactar/1?token=${secret}`,
      provider: provider(),
      storage: store,
      parsers,
    }),
    (error) => error?.code === 'page_url_not_allowed',
  )
  const files = await readdir(root, { recursive: true })
  const persisted = []
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    persisted.push(await readFile(path.join(root, file), 'utf8'))
  }
  assert.equal(persisted.join('\n').includes(secret), false)
  assert.equal(files.some((name) => name.startsWith('runs')), true)
  assert.equal(files.filter((name) => /^runs[\\/].+run\.json$/.test(name)).length, 0)
})

test('collector honors the owner-requested run ID for progressive browser polling', async (t) => {
  const { store } = await storeFor(t)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    requestedRunId: 'browser-visible-run-001',
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>empty</main>', finalUrl: url } } },
    storage: store,
    parsers: { ...parsers, parseCharacterPage: () => ({ productUrls: [], nextPageUrl: null }) },
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.runId, 'browser-visible-run-001')
  assert.equal((await store.readRun('browser-visible-run-001')).status, 'completed')
})

test('Firecrawl-shaped searchCharacters/scrape API is supported with one retry layer only', async (t) => {
  const { store } = await storeFor(t)
  let scrapeInvocations = 0
  let internalAttempts = 0
  const fakeProvider = {
    async searchCharacters(query) {
      assert.equal(query, 'synthetic-character')
      return { web: [{ title: 'Synthetic Character', url: CHARACTER_1 }] }
    },
    async scrape() {
      scrapeInvocations += 1
      for (let attempt = 0; attempt < 3; attempt += 1) internalAttempts += 1
      const error = new Error('provider exhausted its own retries')
      error.name = 'ProviderRequestError'
      error.category = 'network_or_sdk_error'
      throw error
    },
  }
  const result = await collectGallery({
    query: 'synthetic-character',
    provider: fakeProvider,
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterCandidates: ({ searchResults }) => searchResults.map((candidate) => ({ ...candidate, confidence: 'high' })),
      resolveCharacterMatch: (candidates) => ({ status: 'matched', match: candidates[0], candidates }),
    },
    sleep: noDelay,
    limits: { maxRetries: 2, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'failed')
  assert.equal(scrapeInvocations, 1)
  assert.equal(internalAttempts, 3)
})

test('image requests are sequential, delayed, and restricted to hosts discovered on that product page', async (t) => {
  const { store } = await storeFor(t)
  const sleepCalls = []
  let active = 0
  let maximumActive = 0
  const imageUrls = [1, 2, 3].map((number) => `https://img.example.test/${number}.png`)
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage({ kind, url }) {
        if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url }
        return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url, id: '101', title: 'Synthetic', classification: 'unknown' }
      },
    },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1] }),
      parseProductPage: (result) => ({
        sourceItemId: result.id,
        title: result.title,
        classification: result.classification,
        candidateImages: imageUrls.map((url) => ({ url, kind: 'product' })),
        discoveredImageHosts: ['img.example.test'],
      }),
    },
    downloadImage: async ({ url, sourceProductUrl, allowImageUrl }) => {
      assert.equal(allowImageUrl(url, { sourceProductUrl }), true)
      assert.equal(allowImageUrl('https://evil.example/a.png', { sourceProductUrl }), false)
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { duplicate: false }
    },
    sleep: async (milliseconds) => sleepCalls.push(milliseconds),
    limits: { maxRetries: 0, requestDelayMs: 1_500 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.counters.imagesDownloaded, 3)
  assert.equal(maximumActive, 1)
  assert.ok(sleepCalls.length >= 3)
  assert.ok(sleepCalls.every((milliseconds) => milliseconds > 0 && milliseconds <= 1_500))
})

test('real image manifest registrations are coalesced once per product', async (t) => {
  const { store } = await storeFor(t)
  const batches = []
  const registerImages = store.registerImages.bind(store)
  store.registerImages = async (registrations) => {
    batches.push(registrations.length)
    return registerImages(registrations)
  }
  let imageNumber = 0
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: { async fetchPage({ url }) { return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url } } },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1], nextPageUrl: null }),
      parseProductPage: () => ({
        sourceItemId: '101',
        title: 'Batch image product',
        imageUrls: ['https://img.example.test/one.png', 'https://img.example.test/two.png'],
      }),
    },
    allowImageUrl,
    downloadImage: async ({ url, deferRegistration }) => {
      imageNumber += 1
      const sha256 = String(imageNumber).repeat(64)
      return {
        sha256,
        extension: 'png',
        mime: 'image/png',
        bytes: 100,
        width: 8,
        height: 6,
        path: store.objectPath(sha256, 'png'),
        duplicate: false,
        originalUrl: url,
        finalUrl: url,
        registrationDeferred: deferRegistration,
      }
    },
    sleep: noDelay,
    limits: { maxImagesPerProduct: 2, maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.counters.imagesDownloaded, 2)
  assert.deepEqual(batches, [2])
})

test('actual Firecrawl provider adapters and deterministic parsers connect end-to-end without network', async (t) => {
  const { store } = await storeFor(t)
  let searchCalls = 0
  let scrapeCalls = 0
  const client = {
    async search() {
      searchCalls += 1
      return { web: [{ title: 'Synthetic Character', url: CHARACTER_1 }] }
    },
    async scrape(url) {
      scrapeCalls += 1
      if (url === CHARACTER_1) {
        return {
          rawHtml: `<main><h1>Synthetic Character</h1><a href="${PRODUCT_1}">Product</a></main>`,
          links: [PRODUCT_1],
          images: [],
          metadata: { sourceURL: url, statusCode: 200 },
        }
      }
      return {
        rawHtml: '<html><head><meta property="og:title" content="Synthetic Figure"><meta property="og:image" content="https://img.example.test/101.png"></head><body><div data-product-id="101"></div></body></html>',
        links: [],
        images: ['https://img.example.test/101.png'],
        product: { title: 'Synthetic Figure' },
        metadata: { sourceURL: url, statusCode: 200 },
      }
    },
  }
  let tick = Date.parse('2026-07-16T00:00:00.000Z')
  const liveProvider = new FirecrawlFetchProvider({
    apiKey: 'fixture',
    gate: { allowed: true, missing: [] },
    maxRetries: 2,
    requestDelayMs: 1_500,
    client,
    now: () => { tick += 2_000; return tick },
    sleep: noDelay,
  })
  const result = await collectGallery({
    query: 'Synthetic Character',
    provider: liveProvider,
    storage: store,
    parsers: deterministicParsers,
    downloadImage: async ({ url, sourceProductUrl, allowImageUrl }) => {
      assert.equal(typeof url, 'string')
      assert.equal(allowImageUrl(url, { sourceProductUrl }), true)
      return { duplicate: false }
    },
    sleep: noDelay,
    limits: { maxRetries: 2, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.counters.productsProcessed, 1)
  assert.equal(result.counters.imagesDownloaded, 1)
  assert.equal(searchCalls, 1)
  assert.equal(scrapeCalls, 2)
  assert.equal(result.counters.firecrawlOperations, 3)
  assert.equal(result.counters.firecrawlRequests, 3)
  const requests = JSON.parse(await readFile(store.runFile(result.runId, 'requests.json'), 'utf8'))
  assert.equal(requests.length, 3)
  assert.deepEqual(requests.map((request) => request.requestType), ['search', 'character', 'product'])
  for (const request of requests) {
    assert.equal(request.firecrawlSuccess, true)
    assert.equal(request.statusCode, 200)
    assert.equal(typeof request.startedAt, 'string')
    assert.equal(typeof request.endedAt, 'string')
    assert.equal(typeof request.durationMs, 'number')
    assert.equal(typeof request.retries, 'number')
    assert.ok(Object.hasOwn(request, 'creditUsage'))
    assert.ok(Object.hasOwn(request, 'finalSourceUrl'))
  }
})

test('blocked provider request summary is persisted once before the run stops', async (t) => {
  const { store } = await storeFor(t)
  const requestRecord = {
    url: CHARACTER_1,
    requestType: 'character',
    startedAt: '2026-07-16T00:00:00.000Z',
    endedAt: '2026-07-16T00:00:01.000Z',
    durationMs: 1_000,
    firecrawlSuccess: false,
    statusCode: 403,
    finalSourceUrl: CHARACTER_1,
    retries: 0,
    creditUsage: 1,
    failureCategory: 'http_403',
  }
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage() {
        const error = new Error('Source access stopped: http_403.')
        error.name = 'ProviderBlockedError'
        error.category = 'http_403'
        error.statusCode = 403
        error.requestRecord = requestRecord
        throw error
      },
    },
    storage: store,
    parsers,
    sleep: noDelay,
    limits: { maxRetries: 2, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.stopReason, 'http_403')
  assert.equal(result.counters.firecrawlOperations, 1)
  assert.equal(result.counters.firecrawlRequests, 1)
  const requests = JSON.parse(await readFile(store.runFile(result.runId, 'requests.json'), 'utf8'))
  assert.equal(requests.length, 1)
  assert.equal(requests[0].firecrawlSuccess, false)
  assert.equal(requests[0].failureCategory, 'http_403')
})

test('ordinary image failures increment imageFailures and later images continue', async (t) => {
  const { store } = await storeFor(t)
  let imageCall = 0
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage({ kind, url }) {
        if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url }
        return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url, id: '101', title: 'Synthetic', classification: 'unknown' }
      },
    },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1] }),
      parseProductPage: (result) => ({
        sourceItemId: result.id,
        title: result.title,
        classification: result.classification,
        imageUrls: ['https://img.example.test/fail.png', 'https://img.example.test/pass.png'],
      }),
    },
    downloadImage: async () => {
      imageCall += 1
      if (imageCall === 1) {
        const error = new Error('synthetic invalid image')
        error.code = 'invalid_magic'
        throw error
      }
      return { duplicate: false }
    },
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'completed')
  assert.equal(result.counters.imageFailures, 1)
  assert.equal(result.counters.imagesDownloaded, 1)
  const failures = JSON.parse(await readFile(store.runFile(result.runId, 'failures.json'), 'utf8'))
  assert.equal(failures.filter((failure) => failure.kind === 'image').length, 1)
})

test('three consecutive identical image access errors stop while validation failures do not count', async (t) => {
  const { store } = await storeFor(t)
  const imageUrls = [1, 2, 3, 4].map((number) => `https://img.example.test/${number}.png`)
  let calls = 0
  const result = await collectGallery({
    query: 'synthetic-character',
    characterUrl: CHARACTER_1,
    provider: {
      async fetchPage({ kind, url }) {
        if (kind === 'character') return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url }
        return { status: 200, rawHtml: '<main>ok</main>', finalUrl: url, id: '101', title: 'Synthetic', classification: 'unknown' }
      },
    },
    storage: store,
    parsers: {
      ...parsers,
      parseCharacterPage: () => ({ productUrls: [PRODUCT_1] }),
      parseProductPage: (result) => ({
        sourceItemId: result.id,
        title: result.title,
        classification: result.classification,
        imageUrls,
      }),
    },
    downloadImage: async () => {
      calls += 1
      const error = new Error('synthetic network refusal')
      error.code = 'network_error'
      throw error
    },
    sleep: noDelay,
    limits: { maxRetries: 0, requestDelayMs: 0 },
  })
  assert.equal(result.status, 'blocked')
  assert.equal(result.stopReason, 'consecutive_access_errors')
  assert.equal(calls, 3)
  assert.equal(result.counters.imageFailures, 3)
})
